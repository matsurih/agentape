/* Tiny logger so we don't pull in chalk for an MVP. */
const isTTY = !!process.stdout.isTTY;

const codes = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function paint(color: keyof typeof codes, s: string): string {
  if (!isTTY) return s;
  return `${codes[color]}${s}${codes.reset}`;
}

export const logger = {
  info(msg: string) {
    process.stderr.write(`${paint("cyan", "[agentape]")} ${msg}\n`);
  },
  ok(msg: string) {
    process.stderr.write(`${paint("green", "[agentape]")} ${msg}\n`);
  },
  warn(msg: string) {
    process.stderr.write(`${paint("yellow", "[agentape]")} ${msg}\n`);
  },
  error(msg: string) {
    process.stderr.write(`${paint("red", "[agentape]")} ${msg}\n`);
  },
  dim(msg: string) {
    process.stderr.write(`${paint("dim", msg)}\n`);
  },
  raw(msg: string) {
    process.stderr.write(`${msg}\n`);
  },
};
