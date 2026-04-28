/**
 * agent-vcr HTTP intercept hook (CommonJS, preloaded via NODE_OPTIONS=--require).
 *
 * Monkey-patches globalThis.fetch and node:http/https request() so that every
 * outbound HTTP(S) call is mirrored to the agent-vcr coordinator running on
 * 127.0.0.1. In record mode the real call is performed and the result is
 * reported. In replay mode the cassette response is returned and the real
 * network is never touched.
 *
 * Calls to the coordinator itself are passed through unchanged.
 */

"use strict";

const http = require("node:http");
const https = require("node:https");
const { Readable } = require("node:stream");
const { EventEmitter } = require("node:events");

const COORDINATOR_URL = process.env.AGENT_VCR_COORDINATOR;
const MODE = process.env.AGENT_VCR_MODE; // "record" | "replay"

if (!COORDINATOR_URL || !MODE) {
  module.exports = {};
  return;
}

let coordinatorOrigin;
try {
  coordinatorOrigin = new URL(COORDINATOR_URL).origin;
} catch {
  module.exports = {};
  return;
}

const originalFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;

function isCoordinatorUrl(urlStr) {
  try {
    return new URL(urlStr).origin === coordinatorOrigin;
  } catch {
    return false;
  }
}

async function postJson(path, payload) {
  const f = originalFetch;
  if (!f) throw new Error("[agent-vcr] global fetch unavailable; Node 18+ required");
  const res = await f(COORDINATOR_URL + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

/* ---------------- fetch() interception ---------------- */

if (originalFetch) {
  globalThis.fetch = async function patchedFetch(input, init) {
    const url =
      typeof input === "string"
        ? input
        : input && typeof input === "object" && "url" in input
        ? input.url
        : String(input);
    if (isCoordinatorUrl(url)) {
      return originalFetch(input, init);
    }

    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    const headers = headersToObject((init && init.headers) || (input && input.headers));
    const reqBody = await extractBody(init, input);

    if (MODE === "replay") {
      const result = await postJson("/replay/http", {
        request: { method, url, headers, body: reqBody },
      });
      if (!result.matched) {
        throw new Error(`[agent-vcr] No matching cassette for ${method} ${url}`);
      }
      return buildFetchResponse(result.response);
    }

    const start = Date.now();
    const realRes = await originalFetch(input, init);
    const cloned = realRes.clone();
    const respHeaders = headersToObject(cloned.headers);
    const respBody = await readBody(cloned, respHeaders["content-type"]);
    await postJson("/record/http", {
      request: { method, url, headers, body: reqBody },
      response: { status: realRes.status, headers: respHeaders, body: respBody },
      durationMs: Date.now() - start,
    }).catch(() => {});
    return realRes;
  };
}

function headersToObject(h) {
  if (!h) return {};
  if (typeof h.forEach === "function") {
    const out = {};
    h.forEach((v, k) => {
      out[k] = String(v);
    });
    return out;
  }
  if (Array.isArray(h)) {
    const out = {};
    for (const [k, v] of h) out[String(k)] = String(v);
    return out;
  }
  if (typeof h === "object") {
    const out = {};
    for (const [k, v] of Object.entries(h)) out[String(k)] = String(v);
    return out;
  }
  return {};
}

async function extractBody(init, input) {
  const candidate = (init && init.body) ?? (input && input.body);
  if (candidate == null) return null;
  if (typeof candidate === "string") return tryParseJson(candidate);
  if (candidate instanceof Uint8Array) return Buffer.from(candidate).toString("base64");
  if (candidate instanceof ArrayBuffer) return Buffer.from(candidate).toString("base64");
  return null;
}

async function readBody(res, contentType) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  if (ct.startsWith("text/") || ct.includes("xml") || ct.includes("javascript")) {
    return await res.text();
  }
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  }
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function buildFetchResponse(stored) {
  const status = stored.status || 200;
  const headers = new Headers();
  for (const [k, v] of Object.entries(stored.headers || {})) headers.set(k, String(v));
  let bodyInit = null;
  if (stored.body == null) {
    bodyInit = null;
  } else if (typeof stored.body === "string") {
    bodyInit = stored.body;
  } else {
    bodyInit = JSON.stringify(stored.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  return new Response(bodyInit, { status, headers });
}

/* ---------------- node:http / node:https interception ---------------- */

function patchRawRequest(originalReq, isHttps) {
  return function patchedRequest(...args) {
    const opts = parseHttpArgs(args, isHttps);
    if (!opts) return originalReq.apply(this, args);
    if (isCoordinatorUrl(opts.url)) return originalReq.apply(this, args);

    if (MODE === "replay") {
      return makeReplayClientRequest(opts);
    }
    return makeRecordingClientRequest(originalReq, this, args, opts);
  };
}

function parseHttpArgs(args, isHttps) {
  let options;
  let callback;
  if (typeof args[0] === "string" || args[0] instanceof URL) {
    options = args[1] && typeof args[1] === "object" ? { ...args[1] } : {};
    const u = typeof args[0] === "string" ? new URL(args[0]) : args[0];
    options.protocol = u.protocol;
    options.hostname = u.hostname;
    options.port = u.port || (isHttps ? 443 : 80);
    options.path = `${u.pathname}${u.search || ""}`;
    callback = typeof args[1] === "function" ? args[1] : args[2];
  } else if (typeof args[0] === "object" && args[0] !== null) {
    options = { ...args[0] };
    callback = typeof args[1] === "function" ? args[1] : undefined;
  } else {
    return null;
  }
  const protocol = options.protocol || (isHttps ? "https:" : "http:");
  const hostname = options.hostname || options.host || "localhost";
  const port = options.port || (protocol === "https:" ? 443 : 80);
  const path = options.path || "/";
  const url = `${protocol}//${hostname}:${port}${path}`;
  return {
    url,
    method: (options.method || "GET").toUpperCase(),
    headers: options.headers || {},
    callback,
  };
}

function makeReplayClientRequest(opts) {
  const writeChunks = [];
  const fakeReq = new EventEmitter();
  fakeReq.setHeader = () => {};
  fakeReq.getHeader = () => undefined;
  fakeReq.removeHeader = () => {};
  fakeReq.setTimeout = () => fakeReq;
  fakeReq.setNoDelay = () => {};
  fakeReq.setSocketKeepAlive = () => {};
  fakeReq.write = (chunk) => {
    if (chunk) writeChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return true;
  };
  fakeReq.end = (chunk) => {
    if (chunk) writeChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    let body = null;
    if (writeChunks.length > 0) {
      body = tryParseJson(Buffer.concat(writeChunks).toString("utf8"));
    }
    postJson("/replay/http", {
      request: {
        method: opts.method,
        url: opts.url,
        headers: headersToObject(opts.headers),
        body,
      },
    })
      .then((result) => {
        if (!result.matched) {
          fakeReq.emit(
            "error",
            new Error(`[agent-vcr] No matching cassette for ${opts.method} ${opts.url}`)
          );
          return;
        }
        const fakeRes = buildIncomingMessage(result.response);
        if (opts.callback) opts.callback(fakeRes);
        fakeReq.emit("response", fakeRes);
      })
      .catch((e) => fakeReq.emit("error", e));
    return fakeReq;
  };
  fakeReq.abort = () => fakeReq.emit("abort");
  fakeReq.destroy = () => fakeReq.emit("close");
  return fakeReq;
}

function buildIncomingMessage(stored) {
  const status = stored.status || 200;
  let bodyBuf;
  if (stored.body == null) {
    bodyBuf = Buffer.alloc(0);
  } else if (typeof stored.body === "string") {
    bodyBuf = Buffer.from(stored.body, "utf8");
  } else {
    bodyBuf = Buffer.from(JSON.stringify(stored.body), "utf8");
  }
  const stream = Readable.from([bodyBuf]);
  stream.statusCode = status;
  stream.statusMessage = "OK";
  stream.headers = { ...(stored.headers || {}) };
  const hasContentType = Object.keys(stream.headers).some(
    (k) => k.toLowerCase() === "content-type"
  );
  if (!hasContentType && typeof stored.body === "object" && stored.body !== null) {
    stream.headers["content-type"] = "application/json";
  }
  stream.rawHeaders = [];
  for (const [k, v] of Object.entries(stream.headers)) {
    stream.rawHeaders.push(k, String(v));
  }
  return stream;
}

function makeRecordingClientRequest(originalReq, thisArg, args, opts) {
  const start = Date.now();
  const writeChunks = [];
  const realReq = originalReq.apply(thisArg, args);
  const realWrite = realReq.write.bind(realReq);
  const realEnd = realReq.end.bind(realReq);
  realReq.write = (chunk, ...rest) => {
    if (chunk) writeChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return realWrite(chunk, ...rest);
  };
  realReq.end = (chunk, ...rest) => {
    if (chunk) writeChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    return realEnd(chunk, ...rest);
  };
  realReq.on("response", (res) => {
    const respChunks = [];
    res.on("data", (c) => respChunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    res.on("end", () => {
      const reqBodyText = writeChunks.length ? Buffer.concat(writeChunks).toString("utf8") : "";
      const respBodyText = respChunks.length ? Buffer.concat(respChunks).toString("utf8") : "";
      const ct = String(res.headers["content-type"] || "").toLowerCase();
      let respBody = respBodyText || null;
      if (ct.includes("application/json") && respBodyText) {
        try {
          respBody = JSON.parse(respBodyText);
        } catch {
          /* keep as text */
        }
      }
      const reqBody = reqBodyText ? tryParseJson(reqBodyText) : null;
      postJson("/record/http", {
        request: {
          method: opts.method,
          url: opts.url,
          headers: headersToObject(opts.headers),
          body: reqBody,
        },
        response: { status: res.statusCode || 0, headers: { ...res.headers }, body: respBody },
        durationMs: Date.now() - start,
      }).catch(() => {});
    });
  });
  return realReq;
}

http.request = patchRawRequest(originalHttpRequest, false);
https.request = patchRawRequest(originalHttpsRequest, true);

/* http.get / https.get internally hold their own bound reference to the
 * original module's request(). Re-implement them so they pick up our
 * patched http.request / https.request. */
http.get = function patchedHttpGet(...args) {
  const req = http.request(...args);
  req.end();
  return req;
};
https.get = function patchedHttpsGet(...args) {
  const req = https.request(...args);
  req.end();
  return req;
};

module.exports = {};
