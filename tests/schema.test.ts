import { describe, expect, it } from "vitest";
import { CassetteSchema, emptyCassette } from "../src/cassette/schema.js";

describe("CassetteSchema", () => {
  it("validates an empty cassette", () => {
    const c = emptyCassette("demo");
    expect(() => CassetteSchema.parse(c)).not.toThrow();
  });

  it("validates a cassette with mixed interaction types", () => {
    const c = {
      version: 1,
      name: "mixed",
      createdAt: new Date().toISOString(),
      interactions: [
        {
          id: "int_001",
          type: "http",
          request: { method: "GET", url: "https://x.test/", headers: {}, body: null },
          response: { status: 200, headers: {}, body: null },
          metadata: {},
        },
        {
          id: "int_002",
          type: "mcp.tool",
          tool: "search",
          input: { q: "x" },
          output: { hits: 0 },
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
      ],
    };
    expect(() => CassetteSchema.parse(c)).not.toThrow();
  });

  it("rejects unknown interaction type", () => {
    const c = {
      version: 1,
      name: "x",
      createdAt: new Date().toISOString(),
      interactions: [{ id: "i", type: "weird" }],
    };
    expect(() => CassetteSchema.parse(c)).toThrow();
  });

  it("rejects wrong version", () => {
    const c = { version: 2, name: "x", createdAt: "now", interactions: [] };
    expect(() => CassetteSchema.parse(c)).toThrow();
  });
});
