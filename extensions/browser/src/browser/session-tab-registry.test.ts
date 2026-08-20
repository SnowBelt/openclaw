// Browser tests cover session tab registry plugin behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateBrowserStewardRuntimeGuard } from "./browser-steward-runtime-guard.js";
import {
  countTrackedSessionBrowserTabsForTests,
  getTrackedSessionBrowserTabsForTests,
  resetTrackedSessionBrowserTabsForTests,
  closeTrackedBrowserTabsForSessions,
  sweepTrackedBrowserTabs,
  touchSessionBrowserTab,
  trackSessionBrowserTab,
  untrackSessionBrowserTab,
} from "./session-tab-registry.js";

describe("session tab registry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTrackedSessionBrowserTabsForTests();
  });

  afterEach(() => {
    resetTrackedSessionBrowserTabsForTests();
    vi.useRealTimers();
  });

  it("tracks and closes tabs for normalized session keys", async () => {
    trackSessionBrowserTab({
      sessionKey: "Agent:Main:Main",
      targetId: "tab-a",
      baseUrl: "http://127.0.0.1:9222",
      profile: "OpenClaw",
    });
    trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "tab-b",
      baseUrl: "http://127.0.0.1:9222",
      profile: "OpenClaw",
    });
    expect(countTrackedSessionBrowserTabsForTests("agent:main:main")).toBe(2);

    const closeTab = vi.fn(async () => {});
    const closed = await closeTrackedBrowserTabsForSessions({
      sessionKeys: ["agent:main:main"],
      closeTab,
    });

    expect(closed).toBe(2);
    expect(closeTab).toHaveBeenCalledTimes(2);
    expect(closeTab).toHaveBeenNthCalledWith(1, {
      targetId: "tab-a",
      baseUrl: "http://127.0.0.1:9222",
      profile: "openclaw",
    });
    expect(closeTab).toHaveBeenNthCalledWith(2, {
      targetId: "tab-b",
      baseUrl: "http://127.0.0.1:9222",
      profile: "openclaw",
    });
    expect(countTrackedSessionBrowserTabsForTests()).toBe(0);
  });

  it("untracks specific tabs", async () => {
    trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "tab-a",
    });
    trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "tab-b",
    });
    untrackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "tab-a",
    });

    const closeTab = vi.fn(async () => {});
    const closed = await closeTrackedBrowserTabsForSessions({
      sessionKeys: ["agent:main:main"],
      closeTab,
    });

    expect(closed).toBe(1);
    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(closeTab).toHaveBeenCalledWith({
      targetId: "tab-b",
      baseUrl: undefined,
      profile: undefined,
    });
  });

  it("shares tracked tabs across separate plugin module instances", async () => {
    const firstInstance = await import("./session-tab-registry.js");
    firstInstance.trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "cross-instance-tab",
    });

    vi.resetModules();
    const secondInstance = await import("./session-tab-registry.js");
    expect(secondInstance.countTrackedSessionBrowserTabsForTests("agent:main:main")).toBe(1);

    secondInstance.untrackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "cross-instance-tab",
    });
    expect(firstInstance.countTrackedSessionBrowserTabsForTests("agent:main:main")).toBe(0);
  });

  it("deduplicates tabs and ignores expected close errors", async () => {
    trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "tab-a",
    });
    trackSessionBrowserTab({
      sessionKey: "main",
      targetId: "tab-a",
    });
    trackSessionBrowserTab({
      sessionKey: "main",
      targetId: "tab-b",
    });
    const warnings: string[] = [];
    const closeTab = vi
      .fn()
      .mockRejectedValueOnce(new Error("target not found"))
      .mockRejectedValueOnce(new Error("network down"));

    const closed = await closeTrackedBrowserTabsForSessions({
      sessionKeys: ["agent:main:main", "main"],
      closeTab,
      onWarn: (message) => warnings.push(message),
    });

    expect(closed).toBe(0);
    expect(closeTab).toHaveBeenCalledTimes(2);
    expect(warnings).toEqual(["failed to close tracked browser tab tab-b: Error: network down"]);
    expect(countTrackedSessionBrowserTabsForTests()).toBe(0);
  });

  it("sweeps idle tracked tabs and keeps recently touched tabs", async () => {
    vi.setSystemTime(1_000);
    trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "old-tab",
    });
    trackSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "active-tab",
    });
    touchSessionBrowserTab({
      sessionKey: "agent:main:main",
      targetId: "active-tab",
      now: 11_000,
    });

    const closeTab = vi.fn(async () => {});
    const closed = await sweepTrackedBrowserTabs({
      now: 11_000,
      idleMs: 5_000,
      closeTab,
    });

    expect(closed).toBe(1);
    expect(closeTab).toHaveBeenCalledWith({
      targetId: "old-tab",
      baseUrl: undefined,
      profile: undefined,
    });
    expect(countTrackedSessionBrowserTabsForTests("agent:main:main")).toBe(1);
  });

  it("caps tracked tabs per session by closing least recently used tabs first", async () => {
    vi.setSystemTime(1_000);
    trackSessionBrowserTab({ sessionKey: "agent:main:main", targetId: "tab-a" });
    vi.setSystemTime(2_000);
    trackSessionBrowserTab({ sessionKey: "agent:main:main", targetId: "tab-b" });
    vi.setSystemTime(3_000);
    trackSessionBrowserTab({ sessionKey: "agent:main:main", targetId: "tab-c" });

    const closeTab = vi.fn(async () => {});
    const closed = await sweepTrackedBrowserTabs({
      now: 4_000,
      maxTabsPerSession: 2,
      closeTab,
    });

    expect(closed).toBe(1);
    expect(closeTab).toHaveBeenCalledWith({
      targetId: "tab-a",
      baseUrl: undefined,
      profile: undefined,
    });
    expect(countTrackedSessionBrowserTabsForTests("agent:main:main")).toBe(2);
  });

  it("isolates global-session tabs and cleanup by trusted agent id", async () => {
    trackSessionBrowserTab({ sessionKey: "global", agentId: "main", targetId: "main-tab" });
    trackSessionBrowserTab({
      sessionKey: "global",
      agentId: "browser-session-credential-steward",
      targetId: "steward-tab",
    });

    expect(countTrackedSessionBrowserTabsForTests("global", "main")).toBe(1);
    expect(
      countTrackedSessionBrowserTabsForTests("global", "browser-session-credential-steward"),
    ).toBe(1);

    const sweepCloseTab = vi.fn(async () => {});
    await expect(
      sweepTrackedBrowserTabs({ now: Date.now(), maxTabsPerSession: 1, closeTab: sweepCloseTab }),
    ).resolves.toBe(0);
    expect(sweepCloseTab).not.toHaveBeenCalled();

    const closeTab = vi.fn(async () => {});
    await expect(
      closeTrackedBrowserTabsForSessions({
        sessionKeys: ["global"],
        agentId: "browser-session-credential-steward",
        closeTab,
      }),
    ).resolves.toBe(1);
    expect(closeTab).toHaveBeenCalledWith({
      targetId: "steward-tab",
      baseUrl: undefined,
      profile: undefined,
    });
    expect(countTrackedSessionBrowserTabsForTests("global", "main")).toBe(1);
    expect(
      countTrackedSessionBrowserTabsForTests("global", "browser-session-credential-steward"),
    ).toBe(0);
  });

  it("preserves configured legacy agent ids when isolating global tabs", async () => {
    trackSessionBrowserTab({ sessionKey: "global", agentId: "Team Ops", targetId: "ops-tab" });
    trackSessionBrowserTab({ sessionKey: "global", agentId: "Team QA", targetId: "qa-tab" });

    expect(countTrackedSessionBrowserTabsForTests("global", "Team Ops")).toBe(1);
    expect(countTrackedSessionBrowserTabsForTests("global", "Team QA")).toBe(1);

    const closeTab = vi.fn(async () => {});
    await closeTrackedBrowserTabsForSessions({
      sessionKeys: ["global"],
      agentId: "Team Ops",
      closeTab,
    });

    expect(closeTab).toHaveBeenCalledWith({
      targetId: "ops-tab",
      baseUrl: undefined,
      profile: undefined,
    });
    expect(countTrackedSessionBrowserTabsForTests("global", "Team QA")).toBe(1);
  });

  it("closes all global-session tabs when cleanup has no agent scope", async () => {
    trackSessionBrowserTab({ sessionKey: "global", agentId: "main", targetId: "main-tab" });
    trackSessionBrowserTab({
      sessionKey: "global",
      agentId: "browser-session-credential-steward",
      targetId: "steward-tab",
    });

    const closeTab = vi.fn(async () => {});
    await expect(
      closeTrackedBrowserTabsForSessions({ sessionKeys: ["global"], closeTab }),
    ).resolves.toBe(2);
    expect(closeTab).toHaveBeenCalledTimes(2);
    expect(countTrackedSessionBrowserTabsForTests()).toBe(0);
  });

  it("honors session filters during sweeps", async () => {
    vi.setSystemTime(1_000);
    trackSessionBrowserTab({ sessionKey: "agent:main:main", targetId: "primary-tab" });
    trackSessionBrowserTab({ sessionKey: "agent:main:subagent:child", targetId: "child-tab" });

    const closeTab = vi.fn(async () => {});
    const closed = await sweepTrackedBrowserTabs({
      now: 10_000,
      idleMs: 1,
      sessionFilter: (sessionKey) => !sessionKey.includes(":subagent:"),
      closeTab,
    });

    expect(closed).toBe(1);
    expect(closeTab).toHaveBeenCalledWith({
      targetId: "primary-tab",
      baseUrl: undefined,
      profile: undefined,
    });
    expect(countTrackedSessionBrowserTabsForTests()).toBe(1);
  });

  it("does not persist Browser Steward tab metadata without an allowed runtime decision", () => {
    trackSessionBrowserTab({
      sessionKey: "agent:browser-session-credential-steward:runtime-check",
      targetId: "tab-denied",
      profile: "user",
    });

    expect(
      countTrackedSessionBrowserTabsForTests(
        "agent:browser-session-credential-steward:runtime-check",
      ),
    ).toBe(0);
  });

  it("does not treat other agent ids containing the steward name as Browser Steward sessions", () => {
    trackSessionBrowserTab({
      sessionKey: "agent:not-browser-session-credential-steward:runtime-check",
      targetId: "tab-allowed",
      profile: "user",
    });

    expect(
      countTrackedSessionBrowserTabsForTests(
        "agent:not-browser-session-credential-steward:runtime-check",
      ),
    ).toBe(1);
  });

  it("persists only redacted Browser Steward runtime guard metadata", () => {
    trackSessionBrowserTab({
      sessionKey: "agent:browser-session-credential-steward:runtime-check",
      targetId: "tab-approved",
      profile: "user",
      browserStewardRuntimeDecision: {
        boundaryDecision: "allow",
        requestedAction: "open",
        affectedBrowserProfile: "user",
        affectedSession: "agent:browser-session-credential-steward:REDACTED",
        sessionBoundary: {
          kind: "browser_steward",
          ownerAgentId: "browser-session-credential-steward",
          affectedSession: "agent:browser-session-credential-steward:REDACTED",
        },
        credentialExposureKind: "none",
        credentialExposureReasonCode: "no_credential_material",
        credentialClassesInvolved: ["browser session"],
        dataSensitivity: "high",
        approvalRequired: false,
        safeNextAction: "proceed with redacted Browser Steward runtime guard metadata",
        telemetryEvent: "browser_steward.boundary_decision",
      },
    });

    const tracked = getTrackedSessionBrowserTabsForTests(
      "agent:browser-session-credential-steward:runtime-check",
    );
    expect(tracked).toHaveLength(1);
    expect(tracked[0]).toMatchObject({
      targetId: "tab-approved",
      profile: "user",
      browserStewardRuntimeGuard: {
        boundaryDecision: "allow",
        requestedAction: "open",
        affectedBrowserProfile: "user",
        affectedSession: "agent:browser-session-credential-steward:REDACTED",
        sessionBoundary: {
          kind: "browser_steward",
          ownerAgentId: "browser-session-credential-steward",
          affectedSession: "agent:browser-session-credential-steward:REDACTED",
        },
        credentialExposureKind: "none",
        credentialExposureReasonCode: "no_credential_material",
        approvalSource: "runtime",
        telemetryEvent: "browser_steward.boundary_decision",
      },
    });
    expect(JSON.stringify(tracked[0]?.browserStewardRuntimeGuard)).not.toContain("runtime-check");
    expect(JSON.stringify(tracked[0])).not.toContain("runtime-check");
    expect(JSON.stringify(tracked[0]?.browserStewardRuntimeGuard)).not.toMatch(
      /password|token|cookie|secret|privateKey|apiKey/i,
    );
  });

  it("keeps the omitted default profile executable during Browser Steward cleanup", async () => {
    const sessionKey = "agent:browser-session-credential-steward:runtime-check";
    trackSessionBrowserTab({
      sessionKey,
      targetId: "tab-default-profile",
      browserStewardRuntimeDecision: evaluateBrowserStewardRuntimeGuard({
        action: "open",
        agentSessionKey: sessionKey,
        approved: true,
      }),
    });
    const closeTab = vi.fn(async () => {});

    const closed = await closeTrackedBrowserTabsForSessions({
      sessionKeys: [sessionKey],
      closeTab,
    });

    expect(closed).toBe(1);
    expect(closeTab).toHaveBeenCalledWith({
      targetId: "tab-default-profile",
      baseUrl: undefined,
      profile: undefined,
    });
  });

  it("keeps a redacted profile's executable identity private for cleanup", async () => {
    const sessionKey = "agent:browser-session-credential-steward:runtime-check";
    const executableProfile = "sk-abcdefghijk";
    trackSessionBrowserTab({
      sessionKey,
      targetId: "tab-private-profile",
      profile: executableProfile,
      browserStewardRuntimeDecision: evaluateBrowserStewardRuntimeGuard({
        action: "open",
        profile: executableProfile,
        agentSessionKey: sessionKey,
        approved: true,
      }),
    });
    const tracked = getTrackedSessionBrowserTabsForTests(sessionKey);
    const closeTab = vi.fn(async () => {});

    expect(tracked[0]?.profile).toBe("redacted");
    expect(JSON.stringify(tracked)).not.toContain(executableProfile);

    const closed = await closeTrackedBrowserTabsForSessions({
      sessionKeys: [sessionKey],
      closeTab,
    });

    expect(closed).toBe(1);
    expect(closeTab).toHaveBeenCalledWith({
      targetId: "tab-private-profile",
      baseUrl: undefined,
      profile: executableProfile,
    });
  });

  it("preserves private profile identity across separate module registries", async () => {
    const sessionKey = "agent:browser-session-credential-steward:runtime-check";
    const executableProfile = "sk-abcdefghijk";
    trackSessionBrowserTab({
      sessionKey,
      targetId: "tab-cross-registry-profile",
      profile: executableProfile,
      browserStewardRuntimeDecision: evaluateBrowserStewardRuntimeGuard({
        action: "open",
        profile: executableProfile,
        agentSessionKey: sessionKey,
        approved: true,
      }),
    });
    vi.resetModules();
    const separatelyLoadedRegistry = await import("./session-tab-registry.js");
    const closeTab = vi.fn(async () => {});

    const closed = await separatelyLoadedRegistry.closeTrackedBrowserTabsForSessions({
      sessionKeys: [sessionKey],
      closeTab,
    });

    expect(closed).toBe(1);
    expect(closeTab).toHaveBeenCalledWith({
      targetId: "tab-cross-registry-profile",
      baseUrl: undefined,
      profile: executableProfile,
    });
  });

  it("updates tracked metadata with only the redacted credential classification", () => {
    const sessionKey = "agent:browser-session-credential-steward:runtime-check";
    trackSessionBrowserTab({
      sessionKey,
      targetId: "tab-approved",
      profile: "user",
      browserStewardRuntimeDecision: evaluateBrowserStewardRuntimeGuard({
        action: "open",
        profile: "user",
        agentSessionKey: sessionKey,
        approved: true,
      }),
    });

    const rawValue = "raw-do-not-store-123456";
    touchSessionBrowserTab({
      sessionKey,
      targetId: "tab-approved",
      profile: "user",
      browserStewardRuntimeDecision: evaluateBrowserStewardRuntimeGuard({
        action: "act",
        profile: "user",
        agentSessionKey: sessionKey,
        approved: true,
        request: { fn: `() => { document.body.dataset.password = "${rawValue}"; }` },
      }),
    });
    touchSessionBrowserTab({
      sessionKey,
      targetId: "tab-approved",
      profile: "user",
      browserStewardRuntimeDecision: evaluateBrowserStewardRuntimeGuard({
        action: "act",
        profile: "user",
        agentSessionKey: sessionKey,
        approved: true,
        request: { fn: "() => document.title" },
      }),
    });

    const trackedJson = JSON.stringify(getTrackedSessionBrowserTabsForTests(sessionKey));
    expect(trackedJson).toContain('"credentialExposureKind":"credential_material"');
    expect(trackedJson).toContain('"credentialExposureReasonCode":"credential_material_detected"');
    expect(trackedJson).not.toContain(rawValue);
  });

  it("never exposes malformed agent owners to registry sweep filters", async () => {
    const rawOwner = "secret=raw-owner-value-123456";
    trackSessionBrowserTab({
      sessionKey: `agent:${rawOwner}:main`,
      targetId: "tab-malformed-owner",
    });
    const observedSessionKeys: string[] = [];

    await sweepTrackedBrowserTabs({
      sessionFilter: (sessionKey) => {
        observedSessionKeys.push(sessionKey);
        return false;
      },
    });

    expect(observedSessionKeys).toEqual(["UNKNOWN"]);
    expect(JSON.stringify(observedSessionKeys)).not.toContain(rawOwner);
  });
});
