import { describe, expect, it } from "vitest";
import { startCoordinator } from "../src/proxy/coordinator.js";
import { emptyCassette } from "../src/cassette/schema.js";

describe("coordinator", () => {
  it("records HTTP interactions and serves them in replay", async () => {
    // Phase 1: record
    const recCass = emptyCassette("t");
    const rec = await startCoordinator({ mode: "record", cassette: recCass });
    let res = await fetch(`${rec.baseUrl}/record/http`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request: {
          method: "GET",
          url: "https://api.example.com/users/1",
          headers: { authorization: "Bearer secret" },
          body: null,
        },
        response: { status: 200, headers: {}, body: { id: 1, name: "Alice" } },
      }),
    });
    expect(res.status).toBe(200);
    const recorded = rec.getCassette();
    expect(recorded.interactions).toHaveLength(1);
    const i = recorded.interactions[0];
    if (i.type !== "http") throw new Error("expected http");
    expect(i.request.headers.authorization).toBe("[REDACTED]");
    await rec.shutdown();

    // Phase 2: replay
    const rep = await startCoordinator({ mode: "replay", cassette: recorded });
    res = await fetch(`${rep.baseUrl}/replay/http`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request: {
          method: "GET",
          url: "https://api.example.com/users/1",
          headers: {},
          body: null,
        },
      }),
    });
    const json = (await res.json()) as { matched: boolean; response?: any };
    expect(json.matched).toBe(true);
    expect(json.response.body.name).toBe("Alice");

    // Unmatched call should be tracked
    res = await fetch(`${rep.baseUrl}/replay/http`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request: { method: "GET", url: "https://api.example.com/users/2", headers: {}, body: null },
      }),
    });
    const json2 = (await res.json()) as { matched: boolean };
    expect(json2.matched).toBe(false);
    expect(rep.unmatched).toHaveLength(1);
    await rep.shutdown();
  });

  it("records MCP tool calls and serves them in replay", async () => {
    const cass = emptyCassette("mcp");
    const rec = await startCoordinator({ mode: "record", cassette: cass });
    await fetch(`${rec.baseUrl}/record/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tool: "gmail.search",
        input: { query: "from:stripe" },
        output: { messages: [{ id: "m1" }] },
      }),
    });
    const recorded = rec.getCassette();
    expect(recorded.interactions).toHaveLength(1);
    await rec.shutdown();

    const rep = await startCoordinator({ mode: "replay", cassette: recorded });
    const res = await fetch(`${rep.baseUrl}/replay/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tool: "gmail.search",
        input: { query: "from:stripe" },
      }),
    });
    const json = (await res.json()) as { matched: boolean; output?: any };
    expect(json.matched).toBe(true);
    expect(json.output.messages[0].id).toBe("m1");
    await rep.shutdown();
  });
});
