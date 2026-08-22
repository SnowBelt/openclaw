import { describe, expect, it } from "vitest";
import { configureAiTransportHost, getAiTransportHost, lockAiTransportHost } from "./host.js";

describe("AI transport host lifecycle", () => {
  it("freezes the installed host and rejects later replacement", () => {
    const guardedFetch = (() => Promise.resolve(new Response())) as typeof fetch;
    configureAiTransportHost({ buildModelFetch: () => guardedFetch });
    lockAiTransportHost();

    const host = getAiTransportHost();
    expect(Object.isFrozen(host)).toBe(true);
    expect(() => configureAiTransportHost({ buildModelFetch: () => undefined })).toThrow(
      "already locked",
    );
    const mutableView = host as unknown as { buildModelFetch: typeof guardedFetch };
    expect(() => {
      mutableView.buildModelFetch = guardedFetch;
    }).toThrow();
    expect(host.buildModelFetch({} as never)).toBe(guardedFetch);
  });
});
