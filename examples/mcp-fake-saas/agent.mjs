#!/usr/bin/env node
/**
 * Minimal demo "agent" that talks JSON-RPC over stdio to an MCP server.
 *
 * It runs a tiny scripted scenario:
 *   - tools/list
 *   - gmail.search → unread important emails with "renewal"
 *   - crm.searchDeals → find the matching deal
 *   - invoice.listUnpaid
 *   - calendar.listEvents
 *
 * Usage:
 *   node agent.mjs -- node ../../fake-saas/src/server.js
 *
 * Or, under agent-vcr:
 *   agent-vcr record node agent.mjs -- agent-vcr mcp-proxy -- node ../../fake-saas/src/server.js
 */

import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1 || sep === argv.length - 1) {
  console.error("Usage: agent.mjs -- <mcp server cmd...>");
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
    if (line) onServerLine(line);
    i = buf.indexOf("\n");
  }
});

function onServerLine(line) {
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

async function main() {
  await rpc("initialize", { protocolVersion: "0.1.0", capabilities: {} });
  const tools = await rpc("tools/list", {});
  console.log(`fake-saas advertises ${tools.tools.length} tools`);

  const inbox = await rpc("tools/call", {
    name: "gmail.search",
    arguments: { query: "renewal", unrepliedOnly: true, importantOnly: true },
  });
  console.log(`gmail.search → ${inbox.messages.length} important unreplied messages`);

  for (const m of inbox.messages) {
    const account = m.from.split("@")[1].split(".")[0];
    const deals = await rpc("tools/call", {
      name: "crm.searchDeals",
      arguments: { q: account },
    });
    console.log(`crm.searchDeals(${account}) → ${deals.deals.length} deal(s)`);
  }

  const unpaid = await rpc("tools/call", {
    name: "invoice.listUnpaid",
    arguments: {},
  });
  console.log(`invoice.listUnpaid → ${unpaid.invoices.length} unpaid`);

  const cal = await rpc("tools/call", {
    name: "calendar.listEvents",
    arguments: { from: "2026-04-28T00:00:00Z", to: "2026-05-03T00:00:00Z" },
  });
  console.log(`calendar.listEvents → ${cal.events.length} upcoming`);

  server.stdin.end();
  server.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  server.kill();
  process.exit(1);
});
