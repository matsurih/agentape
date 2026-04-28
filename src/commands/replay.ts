import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCassette } from "../cassette/cassette.js";
import { formatUnmatched, startCoordinator } from "../proxy/coordinator.js";
import { runCommand } from "../utils/command.js";
import { logger } from "../utils/logger.js";

export interface ReplayOptions {
  cassette: string;
  redactEmails?: boolean;
}

function hookPath(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return resolve(here, "../proxy/http-hook.cjs");
}

export async function runReplay(command: string[], opts: ReplayOptions): Promise<number> {
  const cassettePath = resolve(opts.cassette);
  const cassette = await loadCassette(cassettePath);

  const coord = await startCoordinator({
    mode: "replay",
    cassette,
    redactEmails: opts.redactEmails,
  });

  const env: NodeJS.ProcessEnv = {
    AGENTAPE_COORDINATOR: coord.baseUrl,
    AGENTAPE_MODE: "replay",
    NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, `--require ${hookPath()}`),
  };

  logger.info(`replay mode ← cassette: ${cassettePath}`);
  logger.dim(`${cassette.interactions.length} recorded interaction(s)`);

  let exitCode = 0;
  try {
    const result = await runCommand(command, { env });
    exitCode = result.exitCode;
  } finally {
    if (coord.unmatched.length > 0) {
      logger.error(`${coord.unmatched.length} unmatched call(s):`);
      logger.raw(formatUnmatched(coord.unmatched, cassette.interactions));
      if (exitCode === 0) exitCode = 1;
    } else {
      logger.ok(`replay matched ${coord.matchedCount} call(s) cleanly`);
    }
    await coord.shutdown();
  }
  return exitCode;
}

function appendNodeOption(existing: string | undefined, addition: string): string {
  if (!existing) return addition;
  return `${existing} ${addition}`;
}
