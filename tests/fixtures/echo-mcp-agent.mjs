#!/usr/bin/env node
/**
 * Test-only fixture: tiny JSON-RPC client that drives the echo MCP server
 * through agent-vcr's mcp-proxy. Used by the e2e test.
 */

import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1 || sep === argv.length - 1) {
  console.error("Usage: echo-mcp-agent.mjs -- <mcp server cmd...>");
  process.exit(2);
}
const serverCmd = argv.slice(sep + 1);
const server = spawn(serverCmd[0], serverCmd.slice(1), {
  stdio: ["pipe", "pipe", "inherit"],
});

let nextId = 1;
const pending = new Map();
let buf = "";

server.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let i = buf.indexOf("\n");
  while (i !== -1) {
    const line = buf.slice(0, i).replace(/\r$/, "");
    buf = buf.slice(i + 1);
    if (line) onLine(line);
    i = buf.indexOf("\n");
  }
});

function onLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`RPC error: ${msg.error.message}`));
    else resolve(msg.result);
  }
}

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

await rpc("initialize", { protocolVersion: "0.1.0", capabilities: {} });
const list = await rpc("tools/list", {});
console.log("tools:", list.tools.map((t) => t.name).join(","));

const a = await rpc("tools/call", { name: "echo", arguments: { x: 1 } });
console.log("echo:", JSON.stringify(a));

const b = await rpc("tools/call", { name: "double", arguments: { n: 21 } });
console.log("double:", JSON.stringify(b));

server.stdin.end();
server.kill();
process.exit(0);
