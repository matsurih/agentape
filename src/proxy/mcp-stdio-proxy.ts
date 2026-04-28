/**
 * MCP stdio proxy.
 *
 * Used as the MCP server command in place of the real one when running
 * under agentape. Talks JSON-RPC 2.0 over stdio to the MCP client (parent),
 * and either:
 *   - record mode: spawns the real MCP server as a child, pipes traffic both
 *     ways, and reports request/response pairs to the agentape coordinator;
 *   - replay mode: does not spawn anything, answers requests from the
 *     coordinator's cassette.
 *
 * Notifications (no `id`) are passed through in record mode and silently
 * dropped in replay mode.
 */

import { spawn } from "node:child_process";

const COORDINATOR_URL = process.env.AGENTAPE_COORDINATOR;
const MODE = process.env.AGENTAPE_MODE as "record" | "replay" | undefined;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingRequest {
  method: string;
  params: unknown;
  startedAt: number;
}

const pending = new Map<string | number, PendingRequest>();

/** In-flight coordinator POSTs we must drain before exiting record mode. */
const inflight = new Set<Promise<unknown>>();

async function postJson(path: string, payload: unknown): Promise<any> {
  if (!COORDINATOR_URL) throw new Error("AGENTAPE_COORDINATOR not set");
  const p = (async () => {
    const res = await fetch(COORDINATOR_URL + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  })();
  inflight.add(p);
  p.finally(() => inflight.delete(p));
  return p;
}

async function drainInflight(): Promise<void> {
  while (inflight.size > 0) {
    await Promise.allSettled([...inflight]);
  }
}

function writeToClient(msg: JsonRpcMessage): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function makeLineSplitter(onLine: (line: string) => void) {
  let buf = "";
  return (chunk: Buffer | string) => {
    buf += chunk.toString("utf8");
    let idx = buf.indexOf("\n");
    while (idx !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (line) onLine(line);
      idx = buf.indexOf("\n");
    }
  };
}

function isToolCall(method: string | undefined): boolean {
  return method === "tools/call";
}

interface ToolCallParams {
  name?: string;
  arguments?: unknown;
}

async function handleClientRequestReplay(msg: JsonRpcMessage): Promise<void> {
  if (!msg.method) return;
  if (msg.id === undefined || msg.id === null) {
    return;
  }

  if (isToolCall(msg.method)) {
    const p = (msg.params as ToolCallParams) || {};
    const tool = p.name || "";
    const input = p.arguments ?? null;
    const result = await postJson("/replay/mcp", { tool, input });
    if (result.matched) {
      writeToClient({
        jsonrpc: "2.0",
        id: msg.id,
        result: result.output,
      });
    } else {
      writeToClient({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32000, message: `[agentape] No matching cassette for tool ${tool}` },
      });
    }
    return;
  }

  const result = await postJson("/replay/rpc", {
    rpcMethod: msg.method,
    params: msg.params ?? null,
  });
  if (result.matched) {
    if (result.error !== undefined) {
      writeToClient({ jsonrpc: "2.0", id: msg.id, error: result.error });
    } else {
      writeToClient({ jsonrpc: "2.0", id: msg.id, result: result.result });
    }
  } else {
    writeToClient({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `[agentape] No matching cassette for ${msg.method}` },
    });
  }
}

async function reportToolCall(reqMsg: JsonRpcMessage, resMsg: JsonRpcMessage): Promise<void> {
  const p = (reqMsg.params as ToolCallParams) || {};
  const tool = p.name || "";
  const input = p.arguments ?? null;
  const isError = resMsg.error !== undefined;
  const output = isError ? resMsg.error : resMsg.result;
  await postJson("/record/mcp", {
    tool,
    input,
    output,
    isError,
  }).catch(() => {});
}

async function reportRpc(reqMsg: JsonRpcMessage, resMsg: JsonRpcMessage): Promise<void> {
  await postJson("/record/rpc", {
    rpcMethod: reqMsg.method,
    params: reqMsg.params ?? null,
    result: resMsg.error === undefined ? resMsg.result : undefined,
    error: resMsg.error,
  }).catch(() => {});
}

function parseTargetCommand(): string[] {
  const args = process.argv.slice(2);
  const sep = args.indexOf("--");
  if (sep === -1) {
    if (args.length > 0) return args;
    throw new Error(
      "[agentape mcp-proxy] target server command not specified. Usage: agentape mcp-proxy -- <cmd> [args...]",
    );
  }
  return args.slice(sep + 1);
}

async function runReplay(): Promise<void> {
  const onLine = makeLineSplitter((line) => {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    handleClientRequestReplay(msg).catch((err) => {
      if (msg.id !== undefined && msg.id !== null) {
        writeToClient({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: `[agentape] ${(err as Error).message}` },
        });
      }
    });
  });
  process.stdin.on("data", onLine);
  process.stdin.on("end", () => process.exit(0));
}

async function runRecord(targetCmd: string[]): Promise<void> {
  if (targetCmd.length === 0) {
    process.stderr.write("[agentape mcp-proxy] target server command required in record mode\n");
    process.exit(2);
  }
  const child = spawn(targetCmd[0], targetCmd.slice(1), {
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
  });

  const onClientLine = makeLineSplitter((line) => {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      child.stdin?.write(`${line}\n`);
      return;
    }
    if (msg.id !== undefined && msg.id !== null && typeof msg.method === "string") {
      pending.set(msg.id, {
        method: msg.method,
        params: msg.params ?? null,
        startedAt: Date.now(),
      });
    }
    child.stdin?.write(`${JSON.stringify(msg)}\n`);
  });

  const onServerLine = makeLineSplitter((line) => {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(`${line}\n`);
      return;
    }
    if (msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
      const req = pending.get(msg.id)!;
      pending.delete(msg.id);
      const reqMsg: JsonRpcMessage = {
        jsonrpc: "2.0",
        id: msg.id,
        method: req.method,
        params: req.params,
      };
      if (isToolCall(req.method)) {
        reportToolCall(reqMsg, msg);
      } else {
        reportRpc(reqMsg, msg);
      }
    }
    process.stdout.write(`${JSON.stringify(msg)}\n`);
  });

  process.stdin.on("data", onClientLine);
  child.stdout?.on("data", onServerLine);
  child.on("exit", async (code) => {
    await drainInflight();
    process.exit(code ?? 0);
  });
  process.stdin.on("end", () => {
    child.stdin?.end();
  });
  // If our parent (the agent) terminates us, still try to flush.
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(sig, async () => {
      try {
        child.kill(sig);
      } catch {
        // child already gone
      }
      await drainInflight();
      process.exit(0);
    });
  }
}

async function main(): Promise<void> {
  if (!COORDINATOR_URL || !MODE) {
    process.stderr.write(
      "[agentape mcp-proxy] AGENTAPE_COORDINATOR / AGENTAPE_MODE not set. Run via agentape record/replay.\n",
    );
    process.exit(2);
  }
  if (MODE === "replay") {
    await runReplay();
  } else {
    const target = parseTargetCommand();
    await runRecord(target);
  }
}

main().catch((err) => {
  process.stderr.write(`[agentape mcp-proxy] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
