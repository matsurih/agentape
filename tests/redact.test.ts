import { describe, expect, it } from "vitest";
import { REDACTED, redactHeaders, redactUrl, redactValue } from "../src/cassette/redact.js";

describe("redactHeaders", () => {
  it("redacts authorization and cookie headers regardless of case", () => {
    expect(
      redactHeaders({
        Authorization: "Bearer abc",
        Cookie: "session=1",
        "X-API-KEY": "k",
        accept: "application/json",
      })
    ).toEqual({
      Authorization: REDACTED,
      Cookie: REDACTED,
      "X-API-KEY": REDACTED,
      accept: "application/json",
    });
  });

  it("returns empty object for undefined", () => {
    expect(redactHeaders(undefined)).toEqual({});
  });
});

describe("redactValue", () => {
  it("redacts sensitive keys at any nesting depth", () => {
    const out = redactValue({
      api_key: "secret",
      nested: { password: "p", apiKey: "k", token: "t" },
      list: [{ refresh_token: "r" }, { name: "ok" }],
    }) as any;
    expect(out.api_key).toBe(REDACTED);
    expect(out.nested.password).toBe(REDACTED);
    expect(out.nested.apiKey).toBe(REDACTED);
    expect(out.nested.token).toBe(REDACTED);
    expect(out.list[0].refresh_token).toBe(REDACTED);
    expect(out.list[1].name).toBe("ok");
  });

  it("masks emails when option is enabled", () => {
    const out = redactValue("contact alice@example.com please", { maskEmails: true });
    expect(out).toBe("contact [EMAIL] please");
  });

  it("does not mask emails by default", () => {
    const out = redactValue("contact alice@example.com please");
    expect(out).toBe("contact alice@example.com please");
  });
});

describe("redactUrl", () => {
  it("redacts sensitive query parameters", () => {
    const u = redactUrl("https://api.example.com/x?api_key=foo&q=bar");
    expect(u).toContain("api_key=%5BREDACTED%5D");
    expect(u).toContain("q=bar");
  });

  it("redacts userinfo", () => {
    const u = redactUrl("https://user:pass@api.example.com/x");
    expect(u).toContain("%5BREDACTED%5D@api.example.com");
    expect(u).not.toContain("pass");
  });
});
