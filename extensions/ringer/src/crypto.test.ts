import { describe, expect, it } from "vitest";
import { createCallerAuth, sha256Bytes, stableStringify, verifyCallerAuth } from "./crypto.js";

describe("Local AI Assist caller proof", () => {
  it("binds a short-lived HMAC to canonical request bytes", () => {
    const payload = { z: [2, 1], a: "snapshot" };
    const secret = "a".repeat(64);
    const now = new Date("2026-08-23T12:00:00.000Z");
    const auth = createCallerAuth(payload, secret, now);
    expect(auth.digest).toBe(sha256Bytes(stableStringify(payload)));
    expect(() => verifyCallerAuth({ payload, auth, secret, now })).not.toThrow();
    expect(() =>
      verifyCallerAuth({ payload: { ...payload, a: "changed" }, auth, secret, now }),
    ).toThrow(/digest/u);
    expect(() =>
      verifyCallerAuth({ payload, auth, secret, now: new Date(now.getTime() + 61_000) }),
    ).toThrow(/expired/u);
  });
});
