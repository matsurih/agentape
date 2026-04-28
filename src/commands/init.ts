import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { emptyCassette } from "../cassette/schema.js";
import { logger } from "../utils/logger.js";

export interface InitOptions {
  cassette: string;
  name?: string;
  force?: boolean;
}

export async function runInit(opts: InitOptions): Promise<number> {
  const path = resolve(opts.cassette);
  if (existsSync(path) && !opts.force) {
    logger.error(`cassette already exists: ${path} (use --force to overwrite)`);
    return 1;
  }
  const c = emptyCassette(opts.name ?? cassetteNameFromPath(path));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(c, null, 2)}\n`, "utf8");
  logger.ok(`created empty cassette at ${path}`);
  return 0;
}

function cassetteNameFromPath(p: string): string {
  return p
    .split(/[\\/]/)
    .pop()!
    .replace(/\.json$/i, "");
}
