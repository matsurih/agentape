import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type Cassette, CassetteSchema, emptyCassette } from "./schema.js";

export async function loadCassette(filePath: string): Promise<Cassette> {
  const abs = resolve(filePath);
  if (!existsSync(abs)) {
    throw new Error(`Cassette not found: ${abs}`);
  }
  const raw = await readFile(abs, "utf8");
  const parsed = JSON.parse(raw);
  return CassetteSchema.parse(parsed);
}

export async function loadOrCreateCassette(filePath: string, name: string): Promise<Cassette> {
  const abs = resolve(filePath);
  if (!existsSync(abs)) return emptyCassette(name);
  const raw = await readFile(abs, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return CassetteSchema.parse(parsed);
  } catch {
    return emptyCassette(name);
  }
}

export async function saveCassette(filePath: string, cassette: Cassette): Promise<void> {
  const abs = resolve(filePath);
  await mkdir(dirname(abs), { recursive: true });
  const validated = CassetteSchema.parse(cassette);
  await writeFile(abs, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

export function nextInteractionId(c: Cassette): string {
  const n = c.interactions.length + 1;
  return `int_${n.toString().padStart(3, "0")}`;
}
