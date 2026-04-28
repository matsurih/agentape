import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrCreateCassette, saveCassette } from "../cassette/cassette.js";
import { startCoordinator } from "../proxy/coordinator.js";
import { runCommand } from "../utils/command.js";
import { logger } from "../utils/logger.js";

export interface RecordOptions {
  cassette: string;
  name?: string;
  redactEmails?: boolean;
}

function hookPath(): string {
  // dist/commands/record.js → ../proxy/http-hook.cjs
  const here = fileURLToPath(new URL(".", import.meta.url));
  return resolve(here, "../proxy/http-hook.cjs");
}

export async function runRecord(command: string[], opts: RecordOptions): Promise<number> {
  const cassettePath = resolve(opts.cassette);
  const name = opts.name ?? cassetteNameFromPath(cassettePath);
  const cassette = await loadOrCreateCassette(cassettePath, name);
  cassette.interactions = []; // overwrite on every record run for MVP

  const coord = await startCoordinator({
    mode: "record",
    cassette,
    redactEmails: opts.redactEmails,
  });

  const env: NodeJS.ProcessEnv = {
    AGENT_VCR_COORDINATOR: coord.baseUrl,
    AGENT_VCR_MODE: "record",
    NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, `--require ${hookPath()}`),
  };

  logger.info(`record mode → cassette: ${cassettePath}`);
  logger.dim(`coordinator: ${coord.baseUrl}`);

  let exitCode = 0;
  try {
    const result = await runCommand(command, { env });
    exitCode = result.exitCode;
  } finally {
    const finalCassette = coord.getCassette();
    finalCassette.createdAt = new Date().toISOString();
    await saveCassette(cassettePath, finalCassette);
    await coord.shutdown();
    logger.ok(`recorded ${finalCassette.interactions.length} interaction(s) → ${cassettePath}`);
  }
  return exitCode;
}

function cassetteNameFromPath(p: string): string {
  return p
    .split(/[\\/]/)
    .pop()!
    .replace(/\.json$/i, "");
}

function appendNodeOption(existing: string | undefined, addition: string): string {
  if (!existing) return addition;
  return `${existing} ${addition}`;
}
