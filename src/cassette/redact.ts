export const REDACTED = "[REDACTED]";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
]);

const SENSITIVE_KEY_PATTERNS = [
  /^api[_-]?key$/i,
  /^access[_-]?token$/i,
  /^refresh[_-]?token$/i,
  /^password$/i,
  /^secret$/i,
  /^token$/i,
  /^auth(orization)?$/i,
  /^client[_-]?secret$/i,
  /^private[_-]?key$/i,
  /^session[_-]?id$/i,
];

const EMAIL_RE = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export interface RedactOptions {
  maskEmails?: boolean;
}

export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

export function redactValue(value: unknown, opts: RedactOptions = {}): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, opts));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactValue(v, opts);
      }
    }
    return out;
  }
  if (typeof value === "string" && opts.maskEmails) {
    return value.replace(EMAIL_RE, "[EMAIL]");
  }
  return value;
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    const params = u.searchParams;
    for (const key of Array.from(params.keys())) {
      if (isSensitiveKey(key)) {
        params.set(key, REDACTED);
      }
    }
    u.search = params.toString();
    if (u.username || u.password) {
      u.username = REDACTED;
      u.password = "";
    }
    return u.toString();
  } catch {
    return url;
  }
}
