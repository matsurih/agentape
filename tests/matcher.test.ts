import { describe, expect, it } from "vitest";
import {
  buildMatchIndex,
  findHttpMatch,
  findMcpMatch,
  findRpcMatch,
  hashJson,
  httpMatchKey,
  mcpMatchKey,
  normalizeUrl,
  rpcMatchKey,
  sortObjectDeep,
  stableStringify,
} from "../src/cassette/matcher.js";
import type { Interaction } from "../src/cassette/schema.js";

describe("sortObjectDeep / stableStringify", () => {
  it("produces same hash regardless of key order", () => {
    const a = { z: 1, a: { y: 2, x: [1, { c: 3, b: 4 }] } };
    const b = { a: { x: [1, { b: 4, c: 3 }], y: 2 }, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(hashJson(a)).toBe(hashJson(b));
  });

  it("sorts nested objects but preserves array order", () => {
    const sorted = sortObjectDeep({ b: [3, 2, 1], a: 0 });
    expect(JSON.stringify(sorted)).toBe('{"a":0,"b":[3,2,1]}');
  });
});

describe("normalizeUrl", () => {
  it("sorts query params", () => {
    expect(normalizeUrl("https://x.test/p?b=2&a=1")).toBe(
      "https://x.test/p?a=1&b=2"
    );
  });

  it("strips trailing slashes from path (but not root)", () => {
    expect(normalizeUrl("https://x.test/p/")).toBe("https://x.test/p");
    expect(normalizeUrl("https://x.test/")).toBe("https://x.test/");
  });

  it("drops fragment", () => {
    expect(normalizeUrl("https://x.test/p#frag")).toBe("https://x.test/p");
  });
});

describe("matchKey functions", () => {
  it("HTTP match key is uppercase method + normalized URL + body hash", () => {
    const k1 = httpMatchKey({ method: "get", url: "https://x.test/p?b=2&a=1", headers: {}, body: null });
    const k2 = httpMatchKey({ method: "GET", url: "https://x.test/p?a=1&b=2", headers: {}, body: null });
    expect(k1).toBe(k2);
  });

  it("MCP match key is stable across input key order", () => {
    expect(mcpMatchKey("gmail.search", { q: "x", limit: 10 })).toBe(
      mcpMatchKey("gmail.search", { limit: 10, q: "x" })
    );
  });

  it("RPC match key", () => {
    expect(rpcMatchKey("tools/list", null)).toBe(rpcMatchKey("tools/list", null));
  });
});

describe("match index", () => {
  const interactions: Interaction[] = [
    {
      id: "int_001",
      type: "http",
      request: { method: "GET", url: "https://api.example.com/users/1", headers: {}, body: null },
      response: { status: 200, headers: {}, body: { id: 1, name: "Alice" } },
      metadata: {},
    },
    {
      id: "int_002",
      type: "mcp.tool",
      tool: "gmail.search",
      input: { query: "from:stripe" },
      output: { messages: [] },
      metadata: {},
    },
    {
      id: "int_003",
      type: "mcp.rpc",
      rpcMethod: "tools/list",
      params: null,
      result: { tools: [] },
      metadata: {},
    },
  ];

  it("finds an HTTP interaction by request", () => {
    const idx = buildMatchIndex(interactions);
    const found = findHttpMatch(idx, {
      method: "get",
      url: "https://api.example.com/users/1",
      headers: {},
      body: null,
    });
    expect(found?.id).toBe("int_001");
  });

  it("returns null when no HTTP match", () => {
    const idx = buildMatchIndex(interactions);
    const found = findHttpMatch(idx, {
      method: "GET",
      url: "https://api.example.com/users/2",
      headers: {},
      body: null,
    });
    expect(found).toBeNull();
  });

  it("finds an MCP tool interaction by tool+input", () => {
    const idx = buildMatchIndex(interactions);
    const found = findMcpMatch(idx, "gmail.search", { query: "from:stripe" });
    expect(found?.id).toBe("int_002");
  });

  it("finds an MCP RPC interaction by method+params", () => {
    const idx = buildMatchIndex(interactions);
    const found = findRpcMatch(idx, "tools/list", null);
    expect(found?.id).toBe("int_003");
  });
});
