# Agent VCR / Mock MCP

> Record and replay your AI agent's tool calls. Test agents without spending tokens or hitting real APIs.

Agent VCR is the [VCR](https://github.com/vcr/vcr) / [nock](https://github.com/nock/nock) / [msw](https://mswjs.io/) pattern, applied to AI agents:

- It captures **HTTP** requests, **MCP tool calls**, and **MCP JSON-RPC** traffic the first time you run your agent test suite.
- Every subsequent run replays the captured cassette — no real network, no real Gmail, no real Slack, no LLM tokens.
- Cassettes are plain JSON, easy to read in code review.

## Why

AI agent development is painful in CI:

- Every run costs LLM / API money.
- Every run touches real Gmail / Slack / GitHub / CRM.
- Real account data leaks into test fixtures.
- Tool call results are nondeterministic.
- Agent tests are flaky.
- MCP server behavior is hard to pin down.

Agent VCR solves this with one verb: **record once, replay forever**.

## Quickstart

```bash
npm install --save-dev agent-vcr

# 1. record once — hits the real APIs / MCP servers
npx agent-vcr record npm test

# 2. replay forever — no network, no tokens
npx agent-vcr replay npm test
```

The cassette is written to `cassettes/default.json` (override with `--cassette`).

## Commands

### `agent-vcr record <command...>`

Spawns `<command...>` as a child process. Captures every outbound HTTP / MCP call into the cassette. Returns the child's exit code. Sensitive headers and keys are redacted on save.

```bash
agent-vcr record --cassette cassettes/gmail-search.json npm test
agent-vcr record --redact-emails npm run agent:test
```

### `agent-vcr replay <command...>`

Spawns `<command...>` and serves recorded responses. Any unmatched call:

- causes the matching attempt to fail with a clear error in the child process
- gets summarized at the end with a diff against the closest recorded interactions
- pushes the exit code to non-zero so CI fails loudly

```bash
agent-vcr replay --cassette cassettes/gmail-search.json npm test
```

### `agent-vcr report`

Renders a human-readable report from a cassette:

```bash
agent-vcr report --cassette cassettes/gmail-search.json --format markdown
agent-vcr report --cassette cassettes/gmail-search.json --format html --output report.html
```

### `agent-vcr init`

Creates an empty cassette skeleton:

```bash
agent-vcr init --cassette cassettes/my-suite.json
```

### `agent-vcr mcp-proxy`

Internal subcommand. Used in your MCP client config in place of the real MCP server command. See [MCP setup](#mcp-record--replay).

## How it works

When you run `agent-vcr record npm test`:

1. agent-vcr starts a localhost coordinator HTTP service.
2. It spawns your command with two extra environment variables: `AGENT_VCR_COORDINATOR=http://127.0.0.1:<port>` and `AGENT_VCR_MODE=record`.
3. It also injects a Node.js preload (`NODE_OPTIONS=--require .../http-hook.cjs`) into your child process so any `globalThis.fetch`, `http.request`, or `https.request` is mirrored to the coordinator.
4. MCP traffic is mirrored via `agent-vcr mcp-proxy` — a stdio JSON-RPC pass-through that you point your agent's MCP server config at.
5. When the child exits, the cassette is saved with all interactions, redacted.

In replay mode the coordinator serves stored responses and the child process never reaches the network.

## Cassette JSON example

```json
{
  "version": 1,
  "name": "gmail-search",
  "createdAt": "2026-04-28T00:00:00.000Z",
  "interactions": [
    {
      "id": "int_001",
      "type": "mcp.tool",
      "tool": "gmail.search",
      "input": { "query": "from:stripe invoice" },
      "output": {
        "messages": [
          { "subject": "Your April invoice", "amount": "$24.00" }
        ]
      },
      "metadata": { "recordedAt": "2026-04-28T00:00:00.000Z" }
    },
    {
      "id": "int_002",
      "type": "http",
      "request": {
        "method": "GET",
        "url": "https://api.example.com/users/123",
        "headers": { "authorization": "[REDACTED]" },
        "body": null
      },
      "response": {
        "status": 200,
        "headers": { "content-type": "application/json" },
        "body": { "id": "123", "name": "Alice" }
      }
    }
  ]
}
```

## Matching

By default Agent VCR uses **deterministic matching**:

- **HTTP**: `METHOD` + normalized URL (sorted query string, no fragment) + `sha256(body)` hash.
- **MCP tool call**: tool name + `sha256(deeply-sorted input JSON)` hash.
- **MCP JSON-RPC**: method name + `sha256(deeply-sorted params)` hash.

Headers are not part of the match key by default — auth headers vary across environments. Custom matchers are not yet exposed but the design has a hook for it (see Roadmap).

## MCP record / replay

Add `agent-vcr mcp-proxy` in your MCP client config in place of the raw command:

```jsonc
{
  "mcpServers": {
    "fake-saas": {
      "command": "agent-vcr",
      "args": ["mcp-proxy", "--", "node", "fake-saas/src/server.js"]
    }
  }
}
```

In **record** mode the proxy spawns the wrapped server and copies stdio both ways while sniffing JSON-RPC pairs.

In **replay** mode the proxy ignores the wrapped command entirely and answers JSON-RPC requests from the cassette.

Try the bundled demo:

```bash
npm run build

# record
npx agent-vcr record \
  --cassette cassettes/fake-saas.json \
  -- node examples/mcp-fake-saas/agent.mjs \
     -- npx agent-vcr mcp-proxy -- node fake-saas/src/server.js

# replay (real server is never spawned)
npx agent-vcr replay \
  --cassette cassettes/fake-saas.json \
  -- node examples/mcp-fake-saas/agent.mjs \
     -- npx agent-vcr mcp-proxy -- /bin/false
```

## Fake SaaS World demo

[`fake-saas/`](./fake-saas) is a tiny scripted MCP-style stdio server we ship as a demo fixture. It serves four tools backed by JSON files: `gmail.search`, `crm.searchDeals`, `invoice.listUnpaid`, `calendar.listEvents`.

Run [`examples/mcp-fake-saas/agent.mjs`](./examples/mcp-fake-saas/agent.mjs) for a tiny scripted "agent" that exercises the tools. See its [README](./examples/mcp-fake-saas/README.md) for the full record / replay walkthrough.

## GitHub Actions

[`examples/github-actions/agent-vcr-replay.yml`](./examples/github-actions/agent-vcr-replay.yml) shows a workflow that runs your agent test suite under `agent-vcr replay` so no real API call leaves the runner. It also renders an HTML report and uploads it as an artifact.

## Security & redaction

Cassettes are committed to your repo, so we redact aggressively on save:

- `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, `X-Auth-Token` headers
- Object keys matching `api_key`, `apiKey`, `access_token`, `refresh_token`, `password`, `secret`, `token`, `auth`, `client_secret`, `private_key`, `session_id` (case-insensitive)
- Sensitive query parameters (same key set)
- URL userinfo (`https://user:pass@host`)
- Optionally email addresses with `--redact-emails`

Redactions appear as the literal string `[REDACTED]`.

> Even with redaction, **always review your cassette before committing it**. Agent VCR can't tell when a payload contains a customer's PII or a leaked secret in a non-standard field name.

## Non-goals

- ❌ Hosted SaaS / cloud cassette storage
- ❌ User accounts, billing, dashboards
- ❌ Replacement for LangSmith / Langfuse observability
- ❌ Generic LLM tracing
- ❌ Real Gmail / Slack / GitHub integrations
- ❌ Browser-side recording (Node.js only for now)
- ❌ HTTPS MITM at the OS proxy layer

## Roadmap

- Hosted cassette registry
- Team sharing & private run share
- CI dashboard
- MCP HTTP / SSE transport support
- OpenAI / Anthropic tool-call adapter
- LangChain / Mastra / Vercel AI SDK adapters
- Stronger secret scanner (entropy + pattern based)
- `agent-vcr sanitize` command
- Visual run diff
- Custom matcher hooks (`config.matcher.http(req) => key`)

## License

MIT
