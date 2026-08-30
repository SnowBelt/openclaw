import { describe, expect, it } from "vitest";
import {
  evaluateBrowserStewardRuntimeGuard,
  isBrowserStewardSession,
  redactBrowserStewardCredentialMaterial,
  resolveBrowserStewardSessionBoundary,
} from "./browser-steward-runtime-guard.js";

describe("Browser Steward runtime guard", () => {
  it("matches only the exact Browser Steward session owner", () => {
    expect(isBrowserStewardSession("agent:browser-session-credential-steward:runtime-check")).toBe(
      true,
    );
    expect(isBrowserStewardSession("Agent:Browser-Session-Credential-Steward:Main")).toBe(true);
    expect(isBrowserStewardSession("agent:not-browser-session-credential-steward:main")).toBe(
      false,
    );
    expect(isBrowserStewardSession("agent:browser-session-credential-stewardish:main")).toBe(false);
    expect(isBrowserStewardSession("agent:main:browser-session-credential-steward")).toBe(false);
    expect(isBrowserStewardSession("browser-session-credential-steward")).toBe(false);
  });

  it("redacts session boundaries and classifies global and unscoped keys", () => {
    expect(resolveBrowserStewardSessionBoundary("global")).toEqual({
      kind: "global",
      ownerAgentId: "UNKNOWN",
      affectedSession: "GLOBAL",
    });
    expect(resolveBrowserStewardSessionBoundary("hook:gmail:abc")).toEqual({
      kind: "unscoped",
      ownerAgentId: "UNKNOWN",
      affectedSession: "UNSCOPED",
    });
    expect(resolveBrowserStewardSessionBoundary("agent:main:direct:person-123")).toEqual({
      kind: "other_agent",
      ownerAgentId: "main",
      affectedSession: "agent:main:REDACTED",
    });
    expect(
      JSON.stringify(resolveBrowserStewardSessionBoundary("agent:main:direct:person-123")),
    ).not.toContain("person-123");
  });

  it("requires approval for mutations and allows an approved mutation", () => {
    const request = {
      action: "navigate",
      profile: "work",
      agentSessionKey: "agent:main:direct:person-123",
    };
    expect(evaluateBrowserStewardRuntimeGuard(request)).toMatchObject({
      boundaryDecision: "approval_required",
      approvalRequired: true,
      affectedSession: "agent:main:REDACTED",
      sessionBoundary: { kind: "other_agent", ownerAgentId: "main" },
    });
    expect(JSON.stringify(evaluateBrowserStewardRuntimeGuard(request))).not.toContain("person-123");
    expect(
      evaluateBrowserStewardRuntimeGuard({
        action: "navigate",
        approved: true,
        agentSessionKey: "agent:browser-session-credential-steward:runtime-check",
      }),
    ).toMatchObject({
      boundaryDecision: "allow",
      sessionBoundary: { kind: "browser_steward" },
    });
  });

  it("allows only non-secret read-only actions without approval", () => {
    expect(evaluateBrowserStewardRuntimeGuard({ action: "status" })).toMatchObject({
      boundaryDecision: "allow",
      approvalRequired: false,
      dataSensitivity: "low",
    });
    expect(evaluateBrowserStewardRuntimeGuard({ action: "start" })).toMatchObject({
      boundaryDecision: "approval_required",
      approvalRequired: true,
    });
  });

  it("detects and redacts credential-like Browser input", () => {
    const rawSecret = "browser-steward-secret-123456";
    const decision = evaluateBrowserStewardRuntimeGuard({
      action: "act",
      request: { kind: "type", text: rawSecret },
    });
    expect(decision).toMatchObject({
      credentialExposureKind: "credential_material",
      approvalRequired: true,
      telemetryEvent: "browser_steward.blocked_credential_exposure",
    });
    expect(JSON.stringify(decision)).not.toContain(rawSecret);
    expect(
      redactBrowserStewardCredentialMaterial({
        action: "act",
        request: { kind: "type", text: rawSecret },
      }),
    ).toEqual({ action: "act", request: { kind: "type", text: "REDACTED" } });
    expect(
      redactBrowserStewardCredentialMaterial({ profile: "password", action: "status" }),
    ).toEqual({ profile: "REDACTED", action: "status" });
  });

  it("redacts private Browser routing metadata", () => {
    const redacted = redactBrowserStewardCredentialMaterial({
      action: "status",
      node: "node-123",
      sessionKey: "agent:main:direct:person-123",
      sessionId: "thread-123",
    });
    expect(redacted).toEqual({
      action: "status",
      node: "REDACTED",
      sessionKey: "REDACTED",
      sessionId: "REDACTED",
    });
    expect(JSON.stringify(redacted)).not.toMatch(/node-123|person-123|thread-123/u);
  });

  it("redacts URL paths that can contain one-time credentials", () => {
    const redacted = redactBrowserStewardCredentialMaterial({
      url: "https://example.com/reset/secret-token-123",
    });
    expect(redacted).toEqual({ url: "https://example.com" });
    expect(JSON.stringify(redacted)).not.toContain("secret-token-123");
  });

  it("handles cyclic requests without exposing their values", () => {
    const request: Record<string, unknown> = { token: "cycle-secret-123456" };
    request.self = request;
    const decision = evaluateBrowserStewardRuntimeGuard({ action: "act", request });
    expect(decision.approvalRequired).toBe(true);
    expect(JSON.stringify(decision)).not.toContain("cycle-secret-123456");
  });

  it("marks missing sessions as unknown", () => {
    expect(evaluateBrowserStewardRuntimeGuard({ action: "status" })).toMatchObject({
      affectedSession: "UNKNOWN",
      sessionBoundary: { kind: "unknown", ownerAgentId: "UNKNOWN" },
    });
  });
});
