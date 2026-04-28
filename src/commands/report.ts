import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadCassette } from "../cassette/cassette.js";
import { renderHtml } from "../report/html.js";
import { renderMarkdown } from "../report/markdown.js";
import { logger } from "../utils/logger.js";

export interface ReportOptions {
  cassette: string;
  format: "markdown" | "html";
  output?: string;
}

export async function runReport(opts: ReportOptions): Promise<number> {
  const cassette = await loadCassette(opts.cassette);
  const rendered =
    opts.format === "html" ? renderHtml(cassette) : renderMarkdown(cassette);

  if (!opts.output) {
    process.stdout.write(rendered);
    return 0;
  }
  const outPath = resolve(opts.output);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, rendered, "utf8");
  logger.ok(`report written to ${outPath}`);
  return 0;
}
