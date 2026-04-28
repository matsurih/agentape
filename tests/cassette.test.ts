import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadCassette,
  loadOrCreateCassette,
  saveCassette,
} from "../src/cassette/cassette.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-vcr-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cassette IO", () => {
  it("loadOrCreate returns empty cassette for non-existent file", async () => {
    const c = await loadOrCreateCassette(join(dir, "nope.json"), "nope");
    expect(c.interactions).toEqual([]);
    expect(c.name).toBe("nope");
    expect(c.version).toBe(1);
  });

  it("save then load round-trips", async () => {
    const path = join(dir, "rt.json");
    const c = await loadOrCreateCassette(path, "rt");
    c.interactions.push({
      id: "int_001",
      type: "http",
      request: { method: "GET", url: "https://x.test/", headers: {}, body: null },
      response: { status: 200, headers: {}, body: { ok: true } },
      metadata: {},
    });
    await saveCassette(path, c);
    const reloaded = await loadCassette(path);
    expect(reloaded.interactions).toHaveLength(1);
    expect(reloaded.interactions[0].id).toBe("int_001");
  });

  it("loadCassette throws on missing file", async () => {
    await expect(loadCassette(join(dir, "absent.json"))).rejects.toThrow();
  });
});
