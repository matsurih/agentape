import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const srcDir = join(root, "src");
const distDir = join(root, "dist");

async function* walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const ASSET_EXTS = [".cjs", ".json"];

let copied = 0;
for await (const file of walk(srcDir)) {
  if (!ASSET_EXTS.some((ext) => file.endsWith(ext))) continue;
  const rel = relative(srcDir, file);
  const dest = join(distDir, rel);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(file, dest);
  copied++;
}

// Make the bin shebang executable.
try {
  const cli = join(distDir, "cli.js");
  await stat(cli);
  await import("node:fs/promises").then(({ chmod }) => chmod(cli, 0o755));
} catch {
  // ok if not present yet
}

process.stdout.write(`copy-assets: copied ${copied} file(s)\n`);
