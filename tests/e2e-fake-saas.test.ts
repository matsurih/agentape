/**
 * End-to-end test: drives the fake-saas MCP server through agent-vcr
 * record then replay. In the replay phase the real fake-saas server is
 * never spawned (we replace it with `false`, a command guaranteed to
 * exit non-zero if invoked) — so a successful run proves replay used
 * only the cassette.
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
const agentScript = join(root, "examples/mcp-fake-saas/agent.mjs");
const fakeServer = join(root, "fake-saas/src/server.js");

// E2E exercises the *built* CLI so we can spawn `agent-vcr mcp-proxy`
// from a child process. Skipped when dist/ is not present.
const cliDist = join(root, "dist/cli.js");
const haveBuild = existsSync(cliDist);

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "agent-vcr-e2e-"));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe.skipIf(!haveBuild)("e2e fake-saas record/replay", () => {
  it("records a session, then replays it without the real server", async () => {
    const cassette = join(tmp, "fake-saas.json");

    // RECORD: agent → mcp-proxy (record) → real fake-saas
    const recCode = await runRecord(
      [
        "node",
        agentScript,
        "--",
        "node",
        cliDist,
        "mcp-proxy",
        "--",
        "node",
        fakeServer,
      ],
      { cassette, name: "fake-saas" }
    );
    expect(recCode).toBe(0);

    const raw = await readFile(cassette, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.interactions.length).toBeGreaterThan(0);
    const tools = parsed.interactions.filter((i: any) => i.type === "mcp.tool");
    expect(tools.length).toBeGreaterThan(0);
    const toolNames = new Set(tools.map((t: any) => t.tool));
    expect(toolNames.has("gmail.search")).toBe(true);

    // REPLAY: agent → mcp-proxy (replay). Real server is replaced with
    // /bin/false; if the proxy ever spawns it the run dies non-zero.
    const repCode = await runReplay(
      [
        "node",
        agentScript,
        "--",
        "node",
        cliDist,
        "mcp-proxy",
        "--",
        "/bin/false",
      ],
      { cassette }
    );
    expect(repCode).toBe(0);
  }, 30000);
});
