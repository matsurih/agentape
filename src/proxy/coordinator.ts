import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type MatchIndex,
  buildMatchIndex,
  findHttpMatch,
  findMcpMatch,
  findRpcMatch,
} from "../cassette/matcher.js";
import { redactHeaders, redactUrl, redactValue } from "../cassette/redact.js";
import type {
  Cassette,
  HttpInteraction,
  HttpRequest,
  HttpResponse,
  Interaction,
  McpRpcInteraction,
  McpToolInteraction,
} from "../cassette/schema.js";
import { describeUnmatched, type UnmatchedCall } from "../cassette/diff.js";
import { logger } from "../utils/logger.js";

export type Mode = "record" | "replay";

export interface CoordinatorOptions {
  mode: Mode;
  cassette: Cassette;
  redactEmails?: boolean;
}

export interface CoordinatorState {
  mode: Mode;
  baseUrl: string;
  port: number;
  shutdown(): Promise<void>;
  /** Final cassette (with anything appended during record). */
  getCassette(): Cassette;
  unmatched: UnmatchedCall[];
  matchedCount: number;
}

interface InternalState {
  cassette: Cassette;
  index: MatchIndex;
  unmatched: UnmatchedCall[];
  matchedCount: number;
}

export async function startCoordinator(opts: CoordinatorOptions): Promise<CoordinatorState> {
  const state: InternalState = {
    cassette: structuredClone(opts.cassette),
    index: buildMatchIndex(opts.cassette.interactions),
    unmatched: [],
    matchedCount: 0,
  };

  const server = createServer((req, res) => {
    handleRequest(req, res, opts, state).catch((err) => {
      logger.error(`coordinator error: ${(err as Error).message}`);
      try {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: (err as Error).message }));
      } catch {
        // already closed
      }
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });

  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    mode: opts.mode,
    baseUrl,
    port: addr.port,
    async shutdown() {
      await closeServer(server);
    },
    getCassette() {
      return state.cassette;
    },
    get unmatched() {
      return state.unmatched;
    },
    get matchedCount() {
      return state.matchedCount;
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: CoordinatorOptions,
  state: InternalState
): Promise<void> {
  if (!req.url || !req.method) {
    res.statusCode = 400;
    res.end();
    return;
  }
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/health") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, mode: opts.mode }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/mode") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ mode: opts.mode }));
    return;
  }

  const body = await readJson(req);

  if (req.method === "POST" && url.pathname === "/record/http") {
    handleRecordHttp(body, opts, state);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/record/mcp") {
    handleRecordMcp(body, opts, state);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/replay/http") {
    const result = handleReplayHttp(body, state);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "POST" && url.pathname === "/replay/mcp") {
    const result = handleReplayMcp(body, state);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "POST" && url.pathname === "/record/rpc") {
    handleRecordRpc(body, opts, state);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/replay/rpc") {
    const result = handleReplayRpc(body, state);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result));
    return;
  }

  res.statusCode = 404;
  res.end();
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function handleRecordHttp(
  body: any,
  opts: CoordinatorOptions,
  state: InternalState
): void {
  const request = body?.request as HttpRequest | undefined;
  const response = body?.response as HttpResponse | undefined;
  const durationMs = body?.durationMs as number | undefined;
  if (!request || !response) return;

  const safeRequest: HttpRequest = {
    method: request.method,
    url: redactUrl(request.url),
    headers: redactHeaders(request.headers),
    body: redactValue(request.body ?? null, { maskEmails: opts.redactEmails }) as unknown,
  };
  const safeResponse: HttpResponse = {
    status: response.status,
    headers: redactHeaders(response.headers),
    body: redactValue(response.body ?? null, { maskEmails: opts.redactEmails }) as unknown,
  };

  const id = nextId(state.cassette);
  const interaction: HttpInteraction = {
    id,
    type: "http",
    request: safeRequest,
    response: safeResponse,
    metadata: {
      recordedAt: new Date().toISOString(),
      durationMs,
    },
  };
  state.cassette.interactions.push(interaction);
}

function handleRecordMcp(
  body: any,
  opts: CoordinatorOptions,
  state: InternalState
): void {
  const tool = body?.tool as string | undefined;
  if (!tool) return;
  const id = nextId(state.cassette);
  const interaction: McpToolInteraction = {
    id,
    type: "mcp.tool",
    tool,
    input: redactValue(body.input ?? null, { maskEmails: opts.redactEmails }),
    output: redactValue(body.output ?? null, { maskEmails: opts.redactEmails }),
    metadata: {
      recordedAt: new Date().toISOString(),
      durationMs: body?.durationMs,
      isError: body?.isError === true ? true : undefined,
    },
  };
  state.cassette.interactions.push(interaction);
}

function handleReplayHttp(body: any, state: InternalState):
  | { matched: true; response: HttpResponse }
  | { matched: false; error: string } {
  const request = body?.request as HttpRequest | undefined;
  if (!request) return { matched: false, error: "Missing request" };
  const found = findHttpMatch(state.index, request);
  if (!found) {
    const u: UnmatchedCall = {
      kind: "http",
      method: request.method,
      url: request.url,
      body: request.body ?? null,
    };
    state.unmatched.push(u);
    return { matched: false, error: "No matching HTTP interaction" };
  }
  state.matchedCount++;
  return { matched: true, response: found.response };
}

function handleReplayMcp(
  body: any,
  state: InternalState
):
  | { matched: true; output: unknown; isError?: boolean }
  | { matched: false; error: string } {
  const tool = body?.tool as string | undefined;
  if (!tool) return { matched: false, error: "Missing tool" };
  const input = body?.input ?? null;
  const found = findMcpMatch(state.index, tool, input);
  if (!found) {
    state.unmatched.push({ kind: "mcp.tool", tool, input });
    return { matched: false, error: "No matching MCP interaction" };
  }
  state.matchedCount++;
  return { matched: true, output: found.output, isError: found.metadata?.isError };
}

function handleRecordRpc(body: any, opts: CoordinatorOptions, state: InternalState): void {
  const rpcMethod = body?.rpcMethod as string | undefined;
  if (!rpcMethod) return;
  const id = nextId(state.cassette);
  const interaction: McpRpcInteraction = {
    id,
    type: "mcp.rpc",
    rpcMethod,
    params: redactValue(body.params ?? null, { maskEmails: opts.redactEmails }),
    result:
      body.result === undefined
        ? undefined
        : redactValue(body.result, { maskEmails: opts.redactEmails }),
    error:
      body.error === undefined
        ? undefined
        : redactValue(body.error, { maskEmails: opts.redactEmails }),
    metadata: {
      recordedAt: new Date().toISOString(),
      durationMs: body?.durationMs,
    },
  };
  state.cassette.interactions.push(interaction);
}

function handleReplayRpc(
  body: any,
  state: InternalState
):
  | { matched: true; result?: unknown; error?: unknown }
  | { matched: false; error: string } {
  const rpcMethod = body?.rpcMethod as string | undefined;
  if (!rpcMethod) return { matched: false, error: "Missing rpcMethod" };
  const params = body?.params ?? null;
  const found = findRpcMatch(state.index, rpcMethod, params);
  if (!found) {
    state.unmatched.push({ kind: "mcp.rpc", rpcMethod, params });
    return { matched: false, error: "No matching RPC interaction" };
  }
  state.matchedCount++;
  return { matched: true, result: found.result, error: found.error };
}

function nextId(c: Cassette): string {
  const n = c.interactions.length + 1;
  return `int_${n.toString().padStart(3, "0")}`;
}

export function formatUnmatched(unmatched: UnmatchedCall[], recorded: Interaction[]): string {
  return unmatched.map((u) => describeUnmatched(u, recorded)).join("\n\n");
}
