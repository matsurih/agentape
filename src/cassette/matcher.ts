import { createHash } from "node:crypto";
import type {
  HttpInteraction,
  HttpRequest,
  Interaction,
  McpRpcInteraction,
  McpToolInteraction,
} from "./schema.js";

export function sortObjectDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = sortObjectDeep(obj[k]);
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  const sorted = sortObjectDeep(value);
  return JSON.stringify(sorted ?? null);
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const entries = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    u.search = "";
    for (const [k, v] of entries) u.searchParams.append(k, v);
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    u.hash = "";
    return u.toString();
  } catch {
    return rawUrl;
  }
}

export function httpMatchKey(req: HttpRequest): string {
  const method = req.method.toUpperCase();
  const url = normalizeUrl(req.url);
  const bodyHash = hashJson(req.body ?? null);
  return `${method} ${url} body:${bodyHash}`;
}

export function mcpMatchKey(tool: string, input: unknown): string {
  const inputHash = hashJson(input ?? null);
  return `mcp:${tool} input:${inputHash}`;
}

export function rpcMatchKey(method: string, params: unknown): string {
  const paramsHash = hashJson(params ?? null);
  return `rpc:${method} params:${paramsHash}`;
}

export function interactionMatchKey(i: Interaction): string {
  if (i.type === "http") return httpMatchKey(i.request);
  if (i.type === "mcp.tool") return mcpMatchKey(i.tool, i.input);
  return rpcMatchKey(i.rpcMethod, i.params);
}

export interface MatchIndex {
  byKey: Map<string, Interaction[]>;
  consumed: Set<string>;
}

export function buildMatchIndex(interactions: Interaction[]): MatchIndex {
  const byKey = new Map<string, Interaction[]>();
  for (const i of interactions) {
    const key = interactionMatchKey(i);
    const list = byKey.get(key) ?? [];
    list.push(i);
    byKey.set(key, list);
  }
  return { byKey, consumed: new Set() };
}

export function findHttpMatch(index: MatchIndex, req: HttpRequest): HttpInteraction | null {
  const key = httpMatchKey(req);
  const list = index.byKey.get(key);
  if (!list || list.length === 0) return null;
  for (let i = 0; i < list.length; i++) {
    const id = `${key}#${i}`;
    if (!index.consumed.has(id) && list[i].type === "http") {
      index.consumed.add(id);
      return list[i] as HttpInteraction;
    }
  }
  const first = list.find((x) => x.type === "http") as HttpInteraction | undefined;
  return first ?? null;
}

export function findMcpMatch(
  index: MatchIndex,
  tool: string,
  input: unknown
): McpToolInteraction | null {
  const key = mcpMatchKey(tool, input);
  const list = index.byKey.get(key);
  if (!list || list.length === 0) return null;
  for (let i = 0; i < list.length; i++) {
    const id = `${key}#${i}`;
    if (!index.consumed.has(id) && list[i].type === "mcp.tool") {
      index.consumed.add(id);
      return list[i] as McpToolInteraction;
    }
  }
  const first = list.find((x) => x.type === "mcp.tool") as McpToolInteraction | undefined;
  return first ?? null;
}

export function findRpcMatch(
  index: MatchIndex,
  rpcMethod: string,
  params: unknown
): McpRpcInteraction | null {
  const key = rpcMatchKey(rpcMethod, params);
  const list = index.byKey.get(key);
  if (!list || list.length === 0) return null;
  for (let i = 0; i < list.length; i++) {
    const id = `${key}#${i}`;
    if (!index.consumed.has(id) && list[i].type === "mcp.rpc") {
      index.consumed.add(id);
      return list[i] as McpRpcInteraction;
    }
  }
  const first = list.find((x) => x.type === "mcp.rpc") as McpRpcInteraction | undefined;
  return first ?? null;
}
