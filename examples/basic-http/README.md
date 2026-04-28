# Basic HTTP demo

```bash
# record once
agent-vcr record --cassette cassettes/basic-http.json -- node examples/basic-http/agent.mjs

# replay (no network)
agent-vcr replay --cassette cassettes/basic-http.json -- node examples/basic-http/agent.mjs
```
