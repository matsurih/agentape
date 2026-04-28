import type { Cassette } from "../cassette/schema.js";

export function renderMarkdown(c: Cassette): string {
  const lines: string[] = [];
  lines.push(`# Agent VCR Report — ${c.name}`);
  lines.push("");
  lines.push(`- Created: ${c.createdAt}`);
  lines.push(`- Interactions: ${c.interactions.length}`);
  lines.push("");

  for (const i of c.interactions) {
    if (i.type === "http") {
      lines.push(`## [${i.id}] HTTP — ${i.request.method.toUpperCase()} ${i.request.url}`);
      lines.push("");
      lines.push(`- Status: ${i.response.status}`);
      if (i.metadata?.durationMs !== undefined) {
        lines.push(`- Duration: ${i.metadata.durationMs}ms`);
      }
      lines.push("");
      if (i.request.body !== null && i.request.body !== undefined) {
        lines.push("**Request body**:");
        lines.push("");
        lines.push("```json");
        lines.push(safeStringify(i.request.body));
        lines.push("```");
        lines.push("");
      }
      lines.push("**Response body**:");
      lines.push("");
      lines.push("```json");
      lines.push(safeStringify(i.response.body));
      lines.push("```");
      lines.push("");
    } else if (i.type === "mcp.tool") {
      lines.push(`## [${i.id}] MCP tool — ${i.tool}`);
      lines.push("");
      if (i.metadata?.durationMs !== undefined) {
        lines.push(`- Duration: ${i.metadata.durationMs}ms`);
      }
      if (i.metadata?.isError) {
        lines.push("- ⚠ Error response");
      }
      lines.push("");
      lines.push("**Input**:");
      lines.push("");
      lines.push("```json");
      lines.push(safeStringify(i.input));
      lines.push("```");
      lines.push("");
      lines.push("**Output**:");
      lines.push("");
      lines.push("```json");
      lines.push(safeStringify(i.output));
      lines.push("```");
      lines.push("");
    } else {
      lines.push(`## [${i.id}] MCP RPC — ${i.rpcMethod}`);
      lines.push("");
      lines.push("**Params**:");
      lines.push("");
      lines.push("```json");
      lines.push(safeStringify(i.params));
      lines.push("```");
      lines.push("");
      if (i.error !== undefined) {
        lines.push("**Error**:");
      } else {
        lines.push("**Result**:");
      }
      lines.push("");
      lines.push("```json");
      lines.push(safeStringify(i.error ?? i.result));
      lines.push("```");
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v ?? null, null, 2);
  } catch {
    return String(v);
  }
}
