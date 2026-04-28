#!/usr/bin/env node
/**
 * Fake SaaS World — minimal MCP-style stdio server used as a demo fixture.
 *
 * Speaks JSON-RPC 2.0 over newline-delimited JSON on stdio. Implements just
 * enough of the MCP protocol for agent-vcr's record/replay demo:
 *   - initialize
 *   - tools/list
 *   - tools/call: gmail.search, crm.searchDeals, invoice.listUnpaid,
 *     calendar.listEvents
 *
 * This is a demo fixture; not a faithful MCP server implementation.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "data");

function load(name) {
  return JSON.parse(readFileSync(join(dataDir, name), "utf8"));
}

const emails = load("emails.json");
const deals = load("crm-deals.json");
const invoices = load("invoices.json");
const events = load("calendar-events.json");

const TOOLS = [
  {
    name: "gmail.search",
    description: "Search the demo inbox by free-text query and optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        unrepliedOnly: { type: "boolean" },
        importantOnly: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "crm.searchDeals",
    description: "Search demo CRM deals by account name or contact email.",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
    },
  },
  {
    name: "invoice.listUnpaid",
    description: "List demo unpaid invoices.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "calendar.listEvents",
    description: "List demo upcoming calendar events.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", format: "date-time" },
        to: { type: "string", format: "date-time" },
      },
    },
  },
];

function gmailSearch({ query, unrepliedOnly, importantOnly }) {
  const q = String(query ?? "").toLowerCase();
  const matches = emails.filter((m) => {
    if (!q) return true;
    const hay = `${m.from} ${m.subject} ${m.snippet}`.toLowerCase();
    if (!hay.includes(q)) return false;
    if (unrepliedOnly && m.hasReply) return false;
    if (importantOnly && !m.important) return false;
    return true;
  });
  return { messages: matches };
}

function crmSearchDeals({ q }) {
  const needle = String(q ?? "").toLowerCase();
  const matches = deals.filter((d) =>
    `${d.account} ${d.primaryContact}`.toLowerCase().includes(needle)
  );
  return { deals: matches };
}

function invoiceListUnpaid() {
  return { invoices: invoices.filter((i) => !i.paid) };
}

function calendarListEvents({ from, to } = {}) {
  const start = from ? new Date(from).getTime() : -Infinity;
  const end = to ? new Date(to).getTime() : Infinity;
  const matches = events.filter((e) => {
    const t = new Date(e.start).getTime();
    return t >= start && t <= end;
  });
  return { events: matches };
}

function callTool(name, args) {
  switch (name) {
    case "gmail.search":
      return gmailSearch(args ?? {});
    case "crm.searchDeals":
      return crmSearchDeals(args ?? {});
    case "invoice.listUnpaid":
      return invoiceListUnpaid();
    case "calendar.listEvents":
      return calendarListEvents(args ?? {});
    default: {
      const err = new Error(`Unknown tool: ${name}`);
      err.code = -32601;
      throw err;
    }
  }
}

function handle(msg) {
  if (msg.method === "initialize") {
    return {
      protocolVersion: "0.1.0",
      serverInfo: { name: "fake-saas", version: "0.1.0" },
      capabilities: { tools: {} },
    };
  }
  if (msg.method === "tools/list") {
    return { tools: TOOLS };
  }
  if (msg.method === "tools/call") {
    const { name, arguments: args } = msg.params || {};
    return callTool(name, args);
  }
  if (msg.method === "ping") {
    return {};
  }
  const err = new Error(`Unknown method: ${msg.method}`);
  err.code = -32601;
  throw err;
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
  if (msg.id === undefined || msg.id === null) {
    // notification — ignore
    return;
  }
  try {
    const result = handle(msg);
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n`);
  } catch (e) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: e.code ?? -32000, message: e.message },
      })}\n`
    );
  }
}

process.stdin.on("end", () => process.exit(0));
