# MCP Fake SaaS demo

A minimal scripted "agent" that drives the [fake-saas](../../fake-saas) MCP
server over stdio. Used by `agent-vcr` for the canonical record → replay loop.

## Run directly (no agent-vcr)

```bash
node examples/mcp-fake-saas/agent.mjs -- node fake-saas/src/server.js
```

## Record once

```bash
agent-vcr record \
  --cassette cassettes/fake-saas.json \
  -- node examples/mcp-fake-saas/agent.mjs \
     -- agent-vcr mcp-proxy -- node fake-saas/src/server.js
```

## Replay (no real server is launched)

```bash
agent-vcr replay \
  --cassette cassettes/fake-saas.json \
  -- node examples/mcp-fake-saas/agent.mjs \
     -- agent-vcr mcp-proxy -- node fake-saas/src/server.js
```

In replay mode `agent-vcr mcp-proxy` ignores the wrapped command and answers
JSON-RPC requests entirely from the cassette.
