#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runRecord } from "./commands/record.js";
import { runReplay } from "./commands/replay.js";
import { runReport } from "./commands/report.js";
import { logger } from "./utils/logger.js";

const DEFAULT_CASSETTE = "cassettes/default.json";

async function main(): Promise<void> {
  // The "mcp-proxy" subcommand has its own argv parsing because everything
  // after `--` should reach the wrapped MCP server verbatim. We dispatch
  // before commander so it never sees those args.
  const argv = process.argv.slice(2);
  if (argv[0] === "mcp-proxy") {
    await import("./proxy/mcp-stdio-proxy.js");
    return;
  }

  const program = new Command();
  program
    .name("agent-vcr")
    .description("Record and replay AI agent tool calls, MCP calls, and HTTP requests.")
    .version("0.1.0");

  program
    .command("record")
    .description("Run a command, record HTTP and MCP traffic into a cassette")
    .argument("<command...>", "command to run (e.g. npm test)")
    .option("-c, --cassette <path>", "cassette path", DEFAULT_CASSETTE)
    .option("-n, --name <name>", "cassette name (defaults to filename)")
    .option("--redact-emails", "mask email addresses in recorded payloads", false)
    .allowUnknownOption(false)
    .action(async (command: string[], opts) => {
      const code = await runRecord(command, {
        cassette: opts.cassette,
        name: opts.name,
        redactEmails: opts.redactEmails,
      });
      process.exit(code);
    });

  program
    .command("replay")
    .description("Run a command in replay mode, serving recorded responses")
    .argument("<command...>", "command to run")
    .option("-c, --cassette <path>", "cassette path", DEFAULT_CASSETTE)
    .option("--redact-emails", "mask email addresses in payloads", false)
    .action(async (command: string[], opts) => {
      const code = await runReplay(command, {
        cassette: opts.cassette,
        redactEmails: opts.redactEmails,
      });
      process.exit(code);
    });

  program
    .command("report")
    .description("Render a human-readable report from a cassette")
    .option("-c, --cassette <path>", "cassette path", DEFAULT_CASSETTE)
    .option("-f, --format <fmt>", "markdown | html", "markdown")
    .option("-o, --output <path>", "output file (default: stdout)")
    .action(async (opts) => {
      if (opts.format !== "markdown" && opts.format !== "html") {
        logger.error(`unsupported format: ${opts.format}`);
        process.exit(2);
      }
      const code = await runReport({
        cassette: opts.cassette,
        format: opts.format,
        output: opts.output,
      });
      process.exit(code);
    });

  program
    .command("init")
    .description("Create an empty cassette file")
    .option("-c, --cassette <path>", "cassette path", DEFAULT_CASSETTE)
    .option("-n, --name <name>", "cassette name")
    .option("--force", "overwrite if exists", false)
    .action(async (opts) => {
      const code = await runInit({
        cassette: opts.cassette,
        name: opts.name,
        force: opts.force,
      });
      process.exit(code);
    });

  program
    .command("mcp-proxy")
    .description("Internal: stdio MCP proxy. Spawned by your MCP client.")
    .helpOption(false)
    .allowUnknownOption()
    .action(() => {
      // Unreachable: dispatched before commander parses argv. Listed only
      // so it shows in --help.
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  logger.error((err as Error).message);
  process.exit(1);
});
