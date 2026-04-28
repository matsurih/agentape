import { spawn } from "node:child_process";

export interface RunCommandOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface RunCommandResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
}

export function runCommand(
  argv: string[],
  opts: RunCommandOptions = {},
): Promise<RunCommandResult> {
  if (argv.length === 0) {
    return Promise.reject(new Error("No command provided"));
  }
  const [cmd, ...args] = argv;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: false,
      env: { ...process.env, ...opts.env },
      cwd: opts.cwd ?? process.cwd(),
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolvePromise({ exitCode: code ?? (signal ? 1 : 0), signal });
    });
  });
}
