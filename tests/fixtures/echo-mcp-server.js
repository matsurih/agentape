#!/usr/bin/env node

const TOOLS = [
  { name: "echo", description: "Returns its input." },
  { name: "double", description: "Returns 2*n." },
];

function handle(msg) {
  if (msg.method === "initialize") {
    return { protocolVersion: "0.1.0", serverInfo: { name: "echo" }, capabilities: { tools: {} } };
  }
  if (msg.method === "tools/list") {
    return { tools: TOOLS };
  }
  if (msg.method === "tools/call") {
    const { name, arguments: args } = msg.params || {};
    if (name === "echo") return { value: args };
    if (name === "double") return { value: Number(args?.n ?? 0) * 2 };
    const e = new Error(`Unknown tool: ${name}`);
    e.code = -32601;
    throw e;
  }
  const e = new Error(`Unknown method: ${msg.method}`);
  e.code = -32601;
  throw e;
}

let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let i = buf.indexOf("\n");
  while (i !== -1) {
    const line = buf.slice(0, i).replace(/\r$/, "");
    buf = buf.slice(i + 1);
    if (line) processLine(line);
    i = buf.indexOf("\n");
  }
});

function processLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined || msg.id === null) return;
  try {
    const result = handle(msg);
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n`);
  } catch (e) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: e.code ?? -32000, message: e.message },
      })}\n`,
    );
  }
}

process.stdin.on("end", () => process.exit(0));
