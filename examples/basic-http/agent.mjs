#!/usr/bin/env node
/**
 * Trivial HTTP "agent": fires a couple of fetch() calls. Run under
 * `agentape record/replay` to capture and replay them.
 */

const base = process.env.BASIC_HTTP_BASE ?? "https://jsonplaceholder.typicode.com";

async function main() {
  const r1 = await fetch(`${base}/todos/1`);
  const j1 = await r1.json();
  console.log("todo:", j1.id, j1.title);

  const r2 = await fetch(`${base}/users/1`);
  const j2 = await r2.json();
  console.log("user:", j2.id, j2.name);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
