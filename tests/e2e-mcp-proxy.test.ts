/**
 * End-to-end test: drives a minimal stdio MCP server through agentape's
 * record-then-replay flow. In the replay phase the real server is replaced
 * with `false` (a command guaranteed to exit non-zero if invoked) so a
 * successful run proves replay used only the cassette.
 */

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRecord } from "../src/commands/record.js";
import { runReplay } from "../src/commands/replay.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const agentScript = join(here, "fixtures/echo-mcp-agent.mjs");
const echoServer = join(here, "fixtures/echo-mcp-server.js");

// Exercises the *built* CLI so we can spawn `agentape mcp-proxy`. Skipped
// when dist/ is not present (e.g. first-time `npm test` without a build).
const cliDist = join(root, "dist/cli.js");
const haveBuild = existsSync(cliDist);

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "agentape-e2e-"));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe.skipIf(!haveBuild)("e2e mcp-proxy record/replay", () => {
  it("records a session, then replays it without the real server", async () => {
    const cassette = join(tmp, "echo.json");

    const recCode = await runRecord(
      ["node", agentScript, "--", "node", cliDist, "mcp-proxy", "--", "node", echoServer],
      { cassette, name: "echo" },
    );
    expect(recCode).toBe(0);

    const parsed = JSON.parse(await readFile(cassette, "utf8"));
    expect(parsed.interactions.length).toBeGreaterThan(0);
    const tools = parsed.interactions.filter((i: any) => i.type === "mcp.tool");
    const toolNames = new Set(tools.map((t: any) => t.tool));
    expect(toolNames.has("echo")).toBe(true);
    expect(toolNames.has("double")).toBe(true);

    // Real server replaced with `false`: replay must succeed without it.
    const repCode = await runReplay(
      ["node", agentScript, "--", "node", cliDist, "mcp-proxy", "--", "false"],
      { cassette },
    );
    expect(repCode).toBe(0);
  }, 30000);
});
