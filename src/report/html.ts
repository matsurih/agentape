import type { Cassette } from "../cassette/schema.js";

export function renderHtml(c: Cassette): string {
  const sections = c.interactions.map((i) => renderInteraction(i)).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>agentape — ${escapeHtml(c.name)}</title>
<style>
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 980px; margin: 2em auto; padding: 0 1em; color: #1a1a1a; }
  h1 { border-bottom: 2px solid #ddd; padding-bottom: .25em; }
  h2 { background: #f4f6fb; padding: .4em .6em; border-left: 4px solid #3b82f6; }
  h2.mcp { border-left-color: #10b981; }
  h2.rpc { border-left-color: #a855f7; }
  pre { background: #0b1020; color: #e6e9f2; padding: 1em; overflow: auto; border-radius: 6px; font-size: 12px; }
  .meta { color: #666; font-size: 12px; }
  .err { color: #b91c1c; }
</style>
</head>
<body>
<h1>agentape — ${escapeHtml(c.name)}</h1>
<p class="meta">
  Created: ${escapeHtml(c.createdAt)}<br />
  Interactions: ${c.interactions.length}
</p>
${sections}
</body>
</html>`;
}

function renderInteraction(i: Cassette["interactions"][number]): string {
  if (i.type === "http") {
    return `<section>
  <h2>[${escapeHtml(i.id)}] HTTP — ${escapeHtml(i.request.method.toUpperCase())} ${escapeHtml(i.request.url)}</h2>
  <p class="meta">Status: ${i.response.status}${i.metadata?.durationMs !== undefined ? ` · ${i.metadata.durationMs}ms` : ""}</p>
  <h3>Request</h3>
  <pre>${escapeHtml(safeStringify(i.request))}</pre>
  <h3>Response</h3>
  <pre>${escapeHtml(safeStringify(i.response))}</pre>
</section>`;
  }
  if (i.type === "mcp.tool") {
    return `<section>
  <h2 class="mcp">[${escapeHtml(i.id)}] MCP tool — ${escapeHtml(i.tool)}</h2>
  ${i.metadata?.isError ? '<p class="err">⚠ Error response</p>' : ""}
  <h3>Input</h3>
  <pre>${escapeHtml(safeStringify(i.input))}</pre>
  <h3>Output</h3>
  <pre>${escapeHtml(safeStringify(i.output))}</pre>
</section>`;
  }
  return `<section>
  <h2 class="rpc">[${escapeHtml(i.id)}] MCP RPC — ${escapeHtml(i.rpcMethod)}</h2>
  <h3>Params</h3>
  <pre>${escapeHtml(safeStringify(i.params))}</pre>
  <h3>${i.error !== undefined ? "Error" : "Result"}</h3>
  <pre>${escapeHtml(safeStringify(i.error ?? i.result))}</pre>
</section>`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v ?? null, null, 2);
  } catch {
    return String(v);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
