# agentape

> Record and replay your AI agent's tool calls. Test agents without spending tokens or hitting real APIs.

agentape is the [VCR](https://github.com/vcr/vcr) / [nock](https://github.com/nock/nock) / [msw](https://mswjs.io/) pattern, applied to AI agents — at the **process boundary**, not the SDK:

- Wrap your existing test command (`agentape record npm test`) — no library integration, no SDK monkey-patching.
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

agentape solves this with one verb: **record once, replay forever**.

## Quickstart

```bash
npm install --save-dev agentape

# 1. record once — hits the real APIs / MCP servers
npx agentape record npm test

# 2. replay forever — no network, no tokens
npx agentape replay npm test
```

The cassette is written to `cassettes/default.json` (override with `--cassette`).

## Commands

### `agentape record <command...>`

Spawns `<command...>` as a child process. Captures every outbound HTTP / MCP call into the cassette. Returns the child's exit code. Sensitive headers and keys are redacted on save.

```bash
agentape record --cassette cassettes/gmail-search.json npm test
agentape record --redact-emails npm run agent:test
```

### `agentape replay <command...>`

Spawns `<command...>` and serves recorded responses. Any unmatched call:

- causes the matching attempt to fail with a clear error in the child process
- gets summarized at the end with a diff against the closest recorded interactions
- pushes the exit code to non-zero so CI fails loudly

```bash
agentape replay --cassette cassettes/gmail-search.json npm test
```

### `agentape report`

Renders a human-readable report from a cassette:

```bash
agentape report --cassette cassettes/gmail-search.json --format markdown
agentape report --cassette cassettes/gmail-search.json --format html --output report.html
```

### `agentape init`

Creates an empty cassette skeleton:

```bash
agentape init --cassette cassettes/my-suite.json
```

### `agentape mcp-proxy`

Internal subcommand. Used in your MCP client config in place of the real MCP server command. See [MCP setup](#mcp-record--replay).

## How it works

When you run `agentape record npm test`:

1. agentape starts a localhost coordinator HTTP service.
2. It spawns your command with two extra environment variables: `AGENTAPE_COORDINATOR=http://127.0.0.1:<port>` and `AGENTAPE_MODE=record`.
3. It also injects a Node.js preload (`NODE_OPTIONS=--require .../http-hook.cjs`) into your child process so any `globalThis.fetch`, `http.request`, or `https.request` is mirrored to the coordinator.
4. MCP traffic is mirrored via `agentape mcp-proxy` — a stdio JSON-RPC pass-through that you point your agent's MCP server config at.
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

By default agentape uses **deterministic matching**:

- **HTTP**: `METHOD` + normalized URL (sorted query string, no fragment) + `sha256(body)` hash.
- **MCP tool call**: tool name + `sha256(deeply-sorted input JSON)` hash.
- **MCP JSON-RPC**: method name + `sha256(deeply-sorted params)` hash.

Headers are not part of the match key by default — auth headers vary across environments.

## MCP record / replay

Add `agentape mcp-proxy` in your MCP client config in place of the raw server command:

```jsonc
{
  "mcpServers": {
    "my-server": {
      "command": "agentape",
      "args": ["mcp-proxy", "--", "node", "path/to/your/mcp-server.js"]
    }
  }
}
```

In **record** mode the proxy spawns the wrapped server and copies stdio both ways while sniffing JSON-RPC pairs.

In **replay** mode the proxy ignores the wrapped command entirely and answers JSON-RPC requests from the cassette.

## GitHub Actions

[`examples/github-actions/agentape-replay.yml`](./examples/github-actions/agentape-replay.yml) shows a workflow that runs your agent test suite under `agentape replay` so no real API call leaves the runner. It also renders an HTML report and uploads it as an artifact.

## Security & redaction

Cassettes are committed to your repo, so we redact aggressively on save:

- `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, `X-Auth-Token` headers
- Object keys matching `api_key`, `apiKey`, `access_token`, `refresh_token`, `password`, `secret`, `token`, `auth`, `client_secret`, `private_key`, `session_id` (case-insensitive)
- Sensitive query parameters (same key set)
- URL userinfo (`https://user:pass@host`)
- Optionally email addresses with `--redact-emails`

Redactions appear as the literal string `[REDACTED]`.

> Even with redaction, **always review your cassette before committing it**. agentape can't tell when a payload contains a customer's PII or a leaked secret in a non-standard field name.

## Releasing

Publishing to npm is automated via GitHub Actions. Tagging a commit on `main` with `vX.Y.Z` triggers `.github/workflows/publish.yml`, which runs lint / build / tests, verifies the tag matches `package.json` version, and publishes with [npm provenance](https://docs.npmjs.com/generating-provenance-statements).

```bash
# from a clean main, with the version in package.json already bumped
git checkout main && git pull
git tag v0.1.0
git push origin v0.1.0
```

The workflow uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) — no `NPM_TOKEN` is required. The `agentape` package on npmjs.com must have this repository + workflow registered as a Trusted Publisher (Settings → Trusted Publisher on the package page).

## License

MIT
