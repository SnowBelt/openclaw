import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approveBrowserStewardRuntimeParams,
  finalizeBrowserStewardRuntimeParams,
  getBrowserStewardRuntimeApprovalBinding,
  getBrowserStewardRuntimePreparationFacts,
  isBrowserStewardRuntimeApproved,
  prepareBrowserStewardRuntimeParams,
} from "./browser-steward-approval.js";

afterEach(() => {
  vi.useRealTimers();
});

function prepare(rawText = "synthetic-browser-secret-123456") {
  return prepareBrowserStewardRuntimeParams(
    { action: "act", request: { kind: "type", text: rawText } },
    {
      toolCallId: "call-1",
      agentId: "main",
      sessionKey: "agent:main:direct:person-123",
      allowHostControl: true,
    },
  ) as Record<string, unknown>;
}

describe("Browser Steward runtime approval", () => {
  it("keeps raw values private while exposing redacted preparation facts", () => {
    const params = prepare();
    expect(JSON.stringify(params)).not.toContain("synthetic-browser-secret-123456");
    expect(Reflect.ownKeys(params).some((key) => typeof key === "symbol")).toBe(false);
    expect(params).toMatchObject({ action: "act", request: { kind: "type", text: "REDACTED" } });
    expect(params).not.toHaveProperty("target");
    expect(getBrowserStewardRuntimePreparationFacts(params)).toMatchObject({
      prepared: true,
      target: "runtime-selected",
      targetKind: "runtime",
      allowHostControl: true,
      binding: {
        action: "act",
        target: "runtime",
        profile: "UNKNOWN",
        affectedSession: "agent:main:REDACTED",
        agentId: "main",
      },
    });
    expect(JSON.stringify(getBrowserStewardRuntimePreparationFacts(params))).not.toContain(
      "person-123",
    );
  });

  it("keeps the target unresolved until the Browser runtime selects it", () => {
    const params = prepareBrowserStewardRuntimeParams(
      { action: "status" },
      {
        toolCallId: "sandbox-call",
        agentId: "main",
        sessionKey: "agent:main:main",
        sandboxBridgeAvailable: true,
        allowHostControl: false,
      },
    ) as Record<string, unknown>;

    expect(params).toMatchObject({ action: "status" });
    expect(params).not.toHaveProperty("target");
    expect(getBrowserStewardRuntimePreparationFacts(params)).toMatchObject({
      target: "runtime-selected",
      targetKind: "runtime",
      sandboxBridgeAvailable: true,
      allowHostControl: false,
    });
  });

  it("restores the exact private call only after one approval", () => {
    const params = prepare();
    expect(isBrowserStewardRuntimeApproved(params)).toBe(false);
    expect(approveBrowserStewardRuntimeParams(params)).toBe(true);
    expect(isBrowserStewardRuntimeApproved(params)).toBe(true);
    expect(getBrowserStewardRuntimeApprovalBinding(params)).toMatchObject({
      action: "act",
      target: "runtime",
    });
    const restored = finalizeBrowserStewardRuntimeParams(params, params);
    expect(restored).toEqual({
      action: "act",
      request: { kind: "type", text: "synthetic-browser-secret-123456" },
    });
    expect(() => finalizeBrowserStewardRuntimeParams(params, params)).toThrow(
      "approval expired or did not match",
    );
  });

  it("rejects a rewritten or replayed approved call", () => {
    const params = prepare();
    approveBrowserStewardRuntimeParams(params);
    const rewritten = { ...params, action: "navigate" };
    expect(() => finalizeBrowserStewardRuntimeParams(rewritten, params)).toThrow(
      "approval expired or did not match",
    );
    expect(JSON.stringify(rewritten)).not.toContain("synthetic-browser-secret-123456");
  });

  it("expires a pending approval after the bounded lease", () => {
    vi.useFakeTimers();
    const params = prepare();
    vi.advanceTimersByTime(60_001);
    expect(approveBrowserStewardRuntimeParams(params)).toBe(false);
    expect(() => finalizeBrowserStewardRuntimeParams(params, params)).toThrow(
      "approval expired or did not match",
    );
  });
});
