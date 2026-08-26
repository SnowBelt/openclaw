/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeGatewayComposerScope } from "../app/gateway-scope.ts";
import { createStorageMock } from "../test-helpers/storage.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

function createExecApproval(overrides: Partial<ExecApprovalRequest> = {}): ExecApprovalRequest {
  return {
    id: "approval-1",
    kind: "exec",
    request: { command: "echo hello" },
    createdAtMs: 1000,
    expiresAtMs: Date.now() + 60_000,
    ...overrides,
  };
}

function createGatewayError(message: string, details?: unknown): Error {
  const err = new Error(message);
  Object.defineProperty(err, "gatewayCode", {
    value: "INVALID_REQUEST",
    enumerable: true,
  });
  Object.defineProperty(err, "details", {
    value: details,
    enumerable: true,
  });
  return err;
}

async function createApp(
  request: RequestFn,
  queue: ExecApprovalRequest[] = [createExecApproval()],
) {
  const { OpenClawApp } = await import("./app.ts");
  const app = Object.create(OpenClawApp.prototype) as InstanceType<typeof OpenClawApp>;
  Object.defineProperties(app, {
    client: { value: { request }, writable: true },
    execApprovalBusy: { value: false, writable: true },
    execApprovalError: { value: null, writable: true },
    execApprovalQueue: { value: queue, writable: true },
  });
  return app;
}

describe("OpenClawApp exec approval decisions", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not switch Gateways while a chat continuation is still in flight after disconnect", async () => {
    const { OpenClawApp } = await import("./app.ts");
    const requestUpdate = vi.fn();
    const app = Object.create(OpenClawApp.prototype) as InstanceType<typeof OpenClawApp>;
    Object.defineProperties(app, {
      pendingGatewayUrl: { value: "ws://new-gateway.test/control", writable: true },
      pendingGatewayToken: { value: "new-token", writable: true },
      pendingGatewayPassword: { value: null, writable: true },
      connected: { value: false, writable: true },
      client: { value: null, writable: true },
      chatQueueCreateTransitionsBySession: { value: {}, writable: true },
      chatQueuePauseTransitionsBySession: { value: {}, writable: true },
      chatSending: { value: false, writable: true },
      chatRunId: { value: "stale-run", writable: true },
      chatStream: { value: null, writable: true },
      chatSubmitGuards: { value: new Set(["submit"]), writable: true },
      chatModelSwitchPromises: { value: {}, writable: true },
      chatProjectBusy: { value: false, writable: true },
      chatGoalBusy: { value: false, writable: true },
      chatError: { value: null, writable: true },
      requestUpdate: { value: requestUpdate },
    });

    app.handleGatewayUrlConfirm();

    expect(app.chatError).toContain("Finish the active Chat operation");
    expect(requestUpdate).toHaveBeenCalledOnce();
  });

  it("preserves a failed first-Gateway provisional composer before switching elsewhere", async () => {
    const { OpenClawApp } = await import("./app.ts");
    const connect = vi.fn();
    const app = Object.create(OpenClawApp.prototype) as InstanceType<typeof OpenClawApp>;
    Object.defineProperties(app, {
      activeGatewayConnection: { value: null, writable: true },
      settings: {
        value: { gatewayUrl: "ws://gateway-b.test/control", token: "token-b" },
        writable: true,
      },
      password: { value: "", writable: true },
      chatComposerProvisionalRestore: {
        value: {
          gatewayScope: "gateway-a-scope",
          sessionKey: "main",
          chatMessage: "old draft",
          chatQueue: [{ id: "old", text: "old queue", createdAt: 1 }],
          chatQueuePaused: true,
        },
        writable: true,
      },
      chatAttachments: { value: [], writable: true },
      chatMessage: { value: "old draft", writable: true },
      chatQueue: { value: [{ id: "old", text: "old queue", createdAt: 1 }], writable: true },
      chatQueueBySession: { value: {}, writable: true },
      chatQueuePaused: { value: true, writable: true },
      chatQueuePausedBySession: { value: { main: true }, writable: true },
      chatQueuePausePendingBySession: { value: {}, writable: true },
      chatQueuePauseTransitionsBySession: { value: {}, writable: true },
      chatQueueCreateTransitionsBySession: { value: {}, writable: true },
      chatComposerPersistenceSuspended: { value: true, writable: true },
      chatMessages: { value: ["old transcript"], writable: true },
      chatMessagesBySession: { value: new Map([["main", ["old"]]]), writable: true },
      chatToolMessages: { value: [{ id: "old-tool" }], writable: true },
      chatSideResult: { value: { kind: "old" }, writable: true },
      chatTargetRunId: { value: "old-run", writable: true },
      chatTargetAuditTs: { value: 1, writable: true },
      chatTargetStatus: { value: "exact-run", writable: true },
      chatLocalInputHistoryBySession: { value: { main: [{ text: "old", ts: 1 }] }, writable: true },
      chatInputHistorySessionKey: { value: "main", writable: true },
      chatInputHistoryItems: { value: ["old"], writable: true },
      chatInputHistoryIndex: { value: 0, writable: true },
      chatDraftBeforeHistory: { value: "old", writable: true },
      sidebarContent: { value: { kind: "old" }, writable: true },
      sidebarError: { value: "old error", writable: true },
      execApprovalQueue: { value: [{ id: "old-approval" }], writable: true },
      execApprovalBusy: { value: true, writable: true },
      execApprovalError: { value: "old approval error", writable: true },
      assistantAgentId: { value: "main", writable: true },
      agentsList: { value: { defaultId: "main" }, writable: true },
      chatRunId: { value: null, writable: true },
      chatStream: { value: null, writable: true },
      chatSideResultTerminalRuns: { value: new Set(["old-run"]), writable: true },
      chatRunStatus: { value: { phase: "running" }, writable: true },
      chatRunStatusClearTimer: { value: null, writable: true },
      requestUpdate: { value: vi.fn() },
      connect: { value: connect },
    });

    app.handleGatewayConnect();

    expect(app.chatComposerProvisionalRestore).toEqual({
      gatewayScope: "gateway-a-scope",
      sessionKey: "main",
      chatMessage: "old draft",
      chatQueue: [{ id: "old", text: "old queue", createdAt: 1 }],
      chatQueuePaused: true,
    });
    expect(app.chatMessage).toBe("old draft");
    expect(app.chatQueue).toEqual([{ id: "old", text: "old queue", createdAt: 1 }]);
    expect(app.chatError).toContain("unsaved Chat work is not lost");
    expect(connect).not.toHaveBeenCalled();
  });

  it("routes the normal Connect action through the guarded Gateway handoff", async () => {
    const { OpenClawApp } = await import("./app.ts");
    const applySettings = vi.fn();
    const handleGatewayUrlConfirm = vi.fn();
    const connect = vi.fn();
    const app = Object.create(OpenClawApp.prototype) as InstanceType<typeof OpenClawApp>;
    Object.defineProperties(app, {
      pendingGatewayUrl: { value: null, writable: true },
      pendingGatewayToken: { value: null, writable: true },
      pendingGatewayPassword: { value: null, writable: true },
      connected: { value: true, writable: true },
      settings: {
        value: {
          gatewayUrl: "ws://gateway-b.test/control",
          token: "token-b",
          sessionKey: "main",
        },
        writable: true,
      },
      password: { value: "", writable: true },
      hello: { value: null, writable: true },
      activeGatewayConnection: {
        value: {
          gatewayUrl: "ws://gateway-a.test/control",
          token: "token-a",
          password: "",
          scope: normalizeGatewayComposerScope("ws://gateway-a.test/control", "token-a"),
        },
        writable: true,
      },
      applySettings: { value: applySettings },
      handleGatewayUrlConfirm: { value: handleGatewayUrlConfirm },
      connect: { value: connect },
    });

    app.handleGatewayConnect();

    expect(app.pendingGatewayUrl).toBe("ws://gateway-b.test/control");
    expect(app.pendingGatewayToken).toBe("token-b");
    expect(app.pendingGatewayPassword).toBe("");
    expect(app.settings.gatewayUrl).toBe("ws://gateway-b.test/control");
    expect(applySettings).toHaveBeenCalledWith({
      gatewayUrl: "ws://gateway-a.test/control",
      token: "token-a",
      sessionKey: "main",
    });
    expect(handleGatewayUrlConfirm).toHaveBeenCalledOnce();
    expect(connect).not.toHaveBeenCalled();
  });

  it("routes same-Gateway credential edits through the guarded handoff while disconnected", async () => {
    const { OpenClawApp } = await import("./app.ts");
    const applySettings = vi.fn();
    const handleGatewayUrlConfirm = vi.fn();
    const connect = vi.fn();
    const app = Object.create(OpenClawApp.prototype) as InstanceType<typeof OpenClawApp>;
    Object.defineProperties(app, {
      pendingGatewayUrl: { value: null, writable: true },
      pendingGatewayToken: { value: null, writable: true },
      pendingGatewayPassword: { value: null, writable: true },
      connected: { value: false, writable: true },
      settings: {
        value: {
          gatewayUrl: "ws://gateway-a.test/control",
          token: "new-token",
          sessionKey: "main",
        },
        writable: true,
      },
      password: { value: "", writable: true },
      hello: { value: { auth: { deviceToken: "old-device-token" } }, writable: true },
      activeGatewayConnection: {
        value: {
          gatewayUrl: "ws://gateway-a.test/control",
          token: "old-token",
          password: "",
          scope: normalizeGatewayComposerScope("ws://gateway-a.test/control", "old-device-token"),
        },
        writable: true,
      },
      applySettings: { value: applySettings },
      handleGatewayUrlConfirm: { value: handleGatewayUrlConfirm },
      connect: { value: connect },
    });

    app.handleGatewayConnect();

    expect(app.pendingGatewayUrl).toBe("ws://gateway-a.test/control");
    expect(app.pendingGatewayToken).toBe("new-token");
    expect(handleGatewayUrlConfirm).toHaveBeenCalledOnce();
    expect(connect).not.toHaveBeenCalled();
  });

  it("does not reuse a provisional composer from another Gateway on retry", async () => {
    const { OpenClawApp } = await import("./app.ts");
    const connect = vi.fn();
    const requestUpdate = vi.fn();
    const app = Object.create(OpenClawApp.prototype) as InstanceType<typeof OpenClawApp>;
    Object.defineProperties(app, {
      pendingGatewayUrl: { value: "ws://gateway-b.test/control", writable: true },
      pendingGatewayToken: { value: "", writable: true },
      pendingGatewayPassword: { value: null, writable: true },
      connected: { value: false, writable: true },
      client: { value: null, writable: true },
      chatQueueCreateTransitionsBySession: { value: {}, writable: true },
      chatQueuePauseTransitionsBySession: { value: {}, writable: true },
      chatSending: { value: false, writable: true },
      chatRunId: { value: null, writable: true },
      chatStream: { value: null, writable: true },
      chatSubmitGuards: { value: new Set(), writable: true },
      chatModelSwitchPromises: { value: {}, writable: true },
      chatProjectBusy: { value: false, writable: true },
      chatGoalBusy: { value: false, writable: true },
      chatAttachments: { value: [], writable: true },
      chatComposerPersistenceSuspended: { value: true, writable: true },
      chatComposerProvisionalRestore: {
        value: {
          sessionKey: "main",
          gatewayScope: "ws://gateway-a.test/control",
          chatMessage: "Gateway A draft",
          chatQueue: [],
          chatQueuePaused: false,
        },
        writable: true,
      },
      chatMessage: { value: "", writable: true },
      chatQueue: { value: [], writable: true },
      chatQueuePaused: { value: false, writable: true },
      settings: {
        value: {
          gatewayUrl: "ws://gateway-b.test/control",
          token: "",
          sessionKey: "main",
        },
        writable: true,
      },
      password: { value: "", writable: true },
      sessionKey: { value: "main", writable: true },
      chatQueueBySession: { value: {}, writable: true },
      chatQueuePausedBySession: { value: {}, writable: true },
      chatQueuePausePendingBySession: { value: {}, writable: true },
      chatQueueGatewayGeneration: { value: 0, writable: true },
      assistantAgentId: { value: null, writable: true },
      agentsList: { value: null, writable: true },
      chatError: { value: null, writable: true },
      requestUpdate: { value: requestUpdate },
      connect: { value: connect },
    });

    app.handleGatewayUrlConfirm();

    expect(app.chatError).toContain("Clear the pending draft and queue");
    expect(connect).not.toHaveBeenCalled();
  });

  it("allows retrying the failed target Gateway without discarding its draft", async () => {
    const { normalizeGatewayComposerScope: normalizeScope } =
      await import("../app/gateway-scope.ts");
    const { OpenClawApp } = await import("./app.ts");
    const connect = vi.fn();
    const app = Object.create(OpenClawApp.prototype) as InstanceType<typeof OpenClawApp>;
    const targetScope = normalizeScope("ws://gateway-b.test/control", "token-b");
    Object.defineProperties(app, {
      pendingGatewayUrl: { value: "ws://gateway-b.test/control", writable: true },
      pendingGatewayToken: { value: "token-b", writable: true },
      pendingGatewayPassword: { value: null, writable: true },
      connected: { value: false, writable: true },
      client: { value: null, writable: true },
      chatQueueCreateTransitionsBySession: { value: {}, writable: true },
      chatQueuePauseTransitionsBySession: { value: {}, writable: true },
      chatSending: { value: false, writable: true },
      chatRunId: { value: null, writable: true },
      chatStream: { value: null, writable: true },
      chatSubmitGuards: { value: new Map(), writable: true },
      chatModelSwitchPromises: { value: {}, writable: true },
      chatProjectBusy: { value: false, writable: true },
      chatGoalBusy: { value: false, writable: true },
      chatAttachments: { value: [], writable: true },
      chatComposerPersistenceSuspended: { value: true, writable: true },
      chatComposerProvisionalRestore: {
        value: {
          gatewayScope: targetScope,
          sessionKey: "main",
          chatMessage: "retry draft",
          chatQueue: [{ id: "retry", text: "retry me", createdAt: 1 }],
          chatQueuePaused: false,
        },
        writable: true,
      },
      chatMessage: { value: "retry draft", writable: true },
      chatQueue: { value: [{ id: "retry", text: "retry me", createdAt: 1 }], writable: true },
      chatQueuePaused: { value: false, writable: true },
      settings: {
        value: {
          gatewayUrl: "ws://gateway-a.test/control",
          token: "token-a",
          sessionKey: "main",
          lastActiveSessionKey: "main",
          theme: "system",
          themeMode: "system",
          chatShowThinking: true,
          chatShowToolCalls: true,
          splitRatio: 0.6,
          navCollapsed: false,
          navWidth: 280,
          navGroupsCollapsed: {},
          borderRadius: 50,
        },
        writable: true,
      },
      password: { value: "", writable: true },
      hello: { value: null, writable: true },
      sessionKey: { value: "main", writable: true },
      chatQueueBySession: { value: {}, writable: true },
      chatQueuePausedBySession: { value: {}, writable: true },
      chatQueuePausePendingBySession: { value: {}, writable: true },
      chatQueueGatewayGeneration: { value: 0, writable: true },
      assistantAgentId: { value: null, writable: true },
      agentsList: { value: null, writable: true },
      chatError: { value: null, writable: true },
      requestUpdate: { value: vi.fn() },
      connect: { value: connect },
    });

    app.handleGatewayUrlConfirm();

    expect(app.chatError).toBeNull();
    expect(app.chatMessage).toBe("retry draft");
    expect(app.chatQueue).toHaveLength(1);
    expect(connect).toHaveBeenCalledOnce();
  });

  it("reuses a same-Gateway provisional composer with paired device auth", async () => {
    const { OpenClawApp } = await import("./app.ts");
    const connect = vi.fn();
    const requestUpdate = vi.fn();
    const gatewayUrl = "ws://gateway-a.test/control";
    const app = Object.create(OpenClawApp.prototype) as InstanceType<typeof OpenClawApp>;
    Object.defineProperties(app, {
      pendingGatewayUrl: { value: gatewayUrl, writable: true },
      pendingGatewayToken: { value: "", writable: true },
      pendingGatewayPassword: { value: null, writable: true },
      connected: { value: false, writable: true },
      client: { value: null, writable: true },
      chatQueueCreateTransitionsBySession: { value: {}, writable: true },
      chatQueuePauseTransitionsBySession: { value: {}, writable: true },
      chatSending: { value: false, writable: true },
      chatRunId: { value: null, writable: true },
      chatStream: { value: null, writable: true },
      chatSubmitGuards: { value: new Set(), writable: true },
      chatModelSwitchPromises: { value: {}, writable: true },
      chatProjectBusy: { value: false, writable: true },
      chatGoalBusy: { value: false, writable: true },
      chatAttachments: { value: [], writable: true },
      chatComposerPersistenceSuspended: { value: true, writable: true },
      chatComposerProvisionalRestore: {
        value: {
          sessionKey: "main",
          gatewayScope: normalizeGatewayComposerScope(gatewayUrl, "device-token"),
          chatMessage: "Gateway A draft",
          chatQueue: [],
          chatQueuePaused: false,
        },
        writable: true,
      },
      chatMessage: { value: "", writable: true },
      chatQueue: { value: [], writable: true },
      chatQueuePaused: { value: false, writable: true },
      settings: {
        value: {
          gatewayUrl,
          token: "",
          sessionKey: "main",
        },
        writable: true,
      },
      password: { value: "", writable: true },
      hello: { value: { auth: { deviceToken: "device-token" } }, writable: true },
      sessionKey: { value: "main", writable: true },
      chatQueueBySession: { value: {}, writable: true },
      chatQueuePausedBySession: { value: {}, writable: true },
      chatQueuePausePendingBySession: { value: {}, writable: true },
      chatQueueGatewayGeneration: { value: 0, writable: true },
      assistantAgentId: { value: null, writable: true },
      agentsList: { value: null, writable: true },
      chatError: { value: null, writable: true },
      requestUpdate: { value: requestUpdate },
      connect: { value: connect },
    });

    app.handleGatewayUrlConfirm();

    expect(app.chatComposerRetryingCurrentGateway).toBe(true);
    expect(connect).toHaveBeenCalledOnce();
    expect(app.chatError).toBeNull();
  });

  it("clears principal-owned Chat projections before switching Gateways", async () => {
    const { OpenClawApp } = await import("./app.ts");
    const connect = vi.fn();
    const app = Object.create(OpenClawApp.prototype) as InstanceType<typeof OpenClawApp>;
    Object.defineProperties(app, {
      pendingGatewayUrl: { value: "ws://gateway-b.test/control", writable: true },
      pendingGatewayToken: { value: "token-b", writable: true },
      pendingGatewayPassword: { value: null, writable: true },
      connected: { value: true, writable: true },
      client: { value: {}, writable: true },
      chatQueueCreateTransitionsBySession: { value: {}, writable: true },
      chatQueuePauseTransitionsBySession: { value: {}, writable: true },
      chatSubmitGuards: { value: new Map(), writable: true },
      chatModelSwitchPromises: { value: {}, writable: true },
      chatSending: { value: false, writable: true },
      chatRunId: { value: null, writable: true },
      chatStream: { value: null, writable: true },
      chatProjectBusy: { value: false, writable: true },
      chatGoalBusy: { value: false, writable: true },
      chatAttachments: { value: [], writable: true },
      chatComposerPersistenceSuspended: { value: false, writable: true },
      chatComposerProvisionalRestore: {
        value: {
          sessionKey: "main",
          gatewayScope: normalizeGatewayComposerScope("ws://gateway-a.test/control", "token-a"),
          chatMessage: "Gateway A provisional draft",
          chatQueue: [{ id: "gateway-a", text: "Gateway A queue", createdAt: 1 }],
          chatQueuePaused: false,
        },
        writable: true,
      },
      chatMessage: { value: "", writable: true },
      chatQueue: { value: [], writable: true },
      chatQueuePaused: { value: false, writable: true },
      chatQueueBySession: { value: {}, writable: true },
      chatQueuePausedBySession: { value: {}, writable: true },
      chatQueuePausePendingBySession: { value: {}, writable: true },
      chatQueueGatewayGeneration: { value: 0, writable: true },
      sessionKey: { value: "main", writable: true },
      settings: {
        value: {
          gatewayUrl: "ws://gateway-a.test/control",
          token: "token-a",
          sessionKey: "main",
          lastActiveSessionKey: "main",
          theme: "system",
          themeMode: "system",
          chatShowThinking: true,
          chatShowToolCalls: true,
          splitRatio: 0.6,
          navCollapsed: false,
          navWidth: 280,
          navGroupsCollapsed: {},
          borderRadius: 50,
        },
        writable: true,
      },
      password: { value: "", writable: true },
      hello: { value: { auth: { deviceToken: "device-token-a" } }, writable: true },
      assistantAgentId: { value: "main", writable: true },
      agentsList: { value: { defaultId: "main" }, writable: true },
      chatMessages: { value: ["old transcript"], writable: true },
      chatMessagesBySession: {
        value: new Map([["agent:main:main", ["old cached transcript"]]]),
        writable: true,
      },
      chatToolMessages: { value: [{ id: "old-tool" }], writable: true },
      chatStreamSegments: { value: [{ text: "old stream", ts: 1 }], writable: true },
      toolStreamById: { value: new Map([["old-tool", {}]]), writable: true },
      toolStreamOrder: { value: ["old-tool"], writable: true },
      toolStreamSyncTimer: { value: null, writable: true },
      chatSideResult: { value: { kind: "old" }, writable: true },
      chatSideResultTerminalRuns: { value: new Set(["old-run"]), writable: true },
      chatRunStatus: { value: { phase: "running" }, writable: true },
      chatRunStatusClearTimer: { value: null, writable: true },
      compactionStatus: { value: { active: true }, writable: true },
      compactionClearTimer: { value: null, writable: true },
      fallbackStatus: { value: { active: true }, writable: true },
      fallbackClearTimer: { value: null, writable: true },
      chatTargetRunId: { value: "old-run", writable: true },
      chatTargetAuditTs: { value: 1, writable: true },
      chatTargetStatus: { value: "exact-run", writable: true },
      chatLocalInputHistoryBySession: { value: { main: [{ text: "old", ts: 1 }] }, writable: true },
      chatInputHistorySessionKey: { value: "main", writable: true },
      chatInputHistoryItems: { value: ["old"], writable: true },
      chatInputHistoryIndex: { value: 0, writable: true },
      chatDraftBeforeHistory: { value: "old", writable: true },
      sidebarContent: { value: { kind: "old" }, writable: true },
      sidebarError: { value: "old sidebar error", writable: true },
      theme: { value: "system", writable: true },
      themeMode: { value: "system", writable: true },
      themeResolved: { value: "light", writable: true },
      applySessionKey: { value: "main", writable: true },
      tab: { value: "chat", writable: true },
      chatHasAutoScrolled: { value: false, writable: true },
      logsAtBottom: { value: false, writable: true },
      eventLog: { value: [], writable: true },
      eventLogBuffer: { value: [], writable: true },
      basePath: { value: "", writable: true },
      requestUpdate: { value: vi.fn() },
      connect: { value: connect },
    });

    app.handleGatewayUrlConfirm();

    expect(app.chatMessages).toEqual([]);
    expect(app.chatMessagesBySession).toEqual(new Map());
    expect(app.chatComposerProvisionalRestore).toEqual({
      sessionKey: "main",
      gatewayScope: normalizeGatewayComposerScope("ws://gateway-b.test/control", "token-b"),
      chatMessage: "",
      chatQueue: [],
      chatQueuePaused: false,
    });
    expect(app.chatToolMessages).toEqual([]);
    expect(app.chatStreamSegments).toEqual([]);
    expect(app.toolStreamById).toEqual(new Map());
    expect(app.toolStreamOrder).toEqual([]);
    expect(app.chatSideResult).toBeNull();
    expect(app.chatSideResultTerminalRuns).toEqual(new Set());
    expect(app.chatRunStatus).toBeNull();
    expect(app.chatLocalInputHistoryBySession).toEqual({});
    expect(app.sidebarContent).toBeNull();
    expect(app.sidebarError).toBeNull();
    expect(connect).toHaveBeenCalledOnce();
  });

  it("dismisses the active approval after same-decision idempotent success", async () => {
    const request = vi.fn<RequestFn>(async () => ({ ok: true }));
    const app = await createApp(request);

    await app.handleExecApprovalDecision("allow-once");

    expect(request).toHaveBeenCalledWith("exec.approval.resolve", {
      id: "approval-1",
      decision: "allow-once",
    });
    expect(app.execApprovalQueue).toEqual([]);
    expect(app.execApprovalError).toBeNull();
    expect(app.execApprovalBusy).toBe(false);
  });

  it("resolves network and remote-proof approvals through plugin approval resolve", async () => {
    const request = vi.fn<RequestFn>(async () => ({ ok: true }));
    const network = createExecApproval({
      id: "network-approval-1",
      kind: "network",
      request: { command: "Allow web search" },
    });
    const remoteProof = createExecApproval({
      id: "remote-proof-approval-1",
      kind: "remote_proof",
      request: { command: "Run remote proof" },
    });
    const app = await createApp(request, [network, remoteProof]);

    await app.handleExecApprovalDecision("allow-once");
    await app.handleExecApprovalDecision("deny");

    expect(request).toHaveBeenNthCalledWith(1, "plugin.approval.resolve", {
      id: "network-approval-1",
      decision: "allow-once",
    });
    expect(request).toHaveBeenNthCalledWith(2, "plugin.approval.resolve", {
      id: "remote-proof-approval-1",
      decision: "deny",
    });
    expect(app.execApprovalQueue).toEqual([]);
  });

  it("dismisses and refreshes when the backend reports an already resolved approval", async () => {
    const request = vi.fn<RequestFn>(async (method) => {
      if (method === "exec.approval.resolve") {
        throw createGatewayError("approval already resolved", {
          reason: "APPROVAL_ALREADY_RESOLVED",
        });
      }
      if (method === "exec.approval.list") {
        return [];
      }
      if (method === "plugin.approval.list") {
        return [];
      }
      return {};
    });
    const app = await createApp(request);

    await app.handleExecApprovalDecision("deny");

    expect(app.execApprovalQueue).toEqual([]);
    expect(app.execApprovalError).toBeNull();
    expect(app.execApprovalBusy).toBe(false);
    expect(request).toHaveBeenCalledWith("exec.approval.list", {});
    expect(request).toHaveBeenCalledWith("plugin.approval.list", {});
  });

  it("keeps the active approval open for unrelated errors", async () => {
    const request = vi.fn<RequestFn>(async () => {
      throw createGatewayError("gateway unavailable");
    });
    const active = createExecApproval();
    const app = await createApp(request, [active]);

    await app.handleExecApprovalDecision("deny");

    expect(app.execApprovalQueue).toEqual([active]);
    expect(app.execApprovalError).toBe("Approval failed: Error: gateway unavailable");
    expect(app.execApprovalBusy).toBe(false);
  });
});
