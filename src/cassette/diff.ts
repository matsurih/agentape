import { stableStringify } from "./matcher.js";
import type { Interaction } from "./schema.js";

export interface UnmatchedHttp {
  kind: "http";
  method: string;
  url: string;
  body: unknown;
}

export interface UnmatchedMcp {
  kind: "mcp.tool";
  tool: string;
  input: unknown;
}

export interface UnmatchedRpc {
  kind: "mcp.rpc";
  rpcMethod: string;
  params: unknown;
}

export type UnmatchedCall = UnmatchedHttp | UnmatchedMcp | UnmatchedRpc;

export function describeUnmatched(call: UnmatchedCall, recorded: Interaction[]): string {
  const lines: string[] = [];
  if (call.kind === "http") {
    lines.push(`✗ Unmatched HTTP call: ${call.method.toUpperCase()} ${call.url}`);
    if (call.body !== null && call.body !== undefined && call.body !== "") {
      lines.push(`  body: ${truncate(stableStringify(call.body), 200)}`);
    }
    const candidates = recorded
      .filter((i): i is Extract<Interaction, { type: "http" }> => i.type === "http")
      .filter(
        (i) =>
          i.request.method.toUpperCase() === call.method.toUpperCase() ||
          sameOrigin(i.request.url, call.url)
      );
    if (candidates.length > 0) {
      lines.push("  Closest recorded HTTP interactions:");
      for (const c of candidates.slice(0, 3)) {
        lines.push(`    - [${c.id}] ${c.request.method.toUpperCase()} ${c.request.url}`);
      }
    }
  } else if (call.kind === "mcp.tool") {
    lines.push(`✗ Unmatched MCP tool call: ${call.tool}`);
    lines.push(`  input: ${truncate(stableStringify(call.input), 200)}`);
    const candidates = recorded
      .filter(
        (i): i is Extract<Interaction, { type: "mcp.tool" }> => i.type === "mcp.tool"
      )
      .filter((i) => i.tool === call.tool);
    if (candidates.length > 0) {
      lines.push("  Closest recorded MCP interactions:");
      for (const c of candidates.slice(0, 3)) {
        lines.push(`    - [${c.id}] ${c.tool} input=${truncate(stableStringify(c.input), 80)}`);
      }
    }
  } else {
    lines.push(`✗ Unmatched MCP RPC call: ${call.rpcMethod}`);
    lines.push(`  params: ${truncate(stableStringify(call.params), 200)}`);
    const candidates = recorded
      .filter((i): i is Extract<Interaction, { type: "mcp.rpc" }> => i.type === "mcp.rpc")
      .filter((i) => i.rpcMethod === call.rpcMethod);
    if (candidates.length > 0) {
      lines.push("  Closest recorded RPC interactions:");
      for (const c of candidates.slice(0, 3)) {
        lines.push(
          `    - [${c.id}] ${c.rpcMethod} params=${truncate(stableStringify(c.params), 80)}`
        );
      }
    }
  }
  return lines.join("\n");
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}
