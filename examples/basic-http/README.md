# Basic HTTP demo

```bash
# record once
agentape record --cassette cassettes/basic-http.json -- node examples/basic-http/agent.mjs

# replay (no network)
agentape replay --cassette cassettes/basic-http.json -- node examples/basic-http/agent.mjs
```
