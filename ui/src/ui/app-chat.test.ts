/* @vitest-environment jsdom */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../test-helpers/storage.ts";
import type { ChatHost } from "./app-chat.ts";
import {
  getChatAttachmentDataUrl,
  getChatAttachmentPreviewUrl,
  registerChatAttachmentPayload,
  releaseChatAttachmentPayloads,
  resetChatAttachmentPayloadStoreForTest,
} from "./chat/attachment-payload-store.ts";
import { loadChatComposerSnapshot, persistChatComposerState } from "./chat/composer-persistence.ts";
import type { executeSlashCommand } from "./chat/slash-command-executor.ts";
import { loadSessions } from "./controllers/sessions.ts";
import type { GatewaySessionRow, SessionsListResult } from "./types.ts";

type ExecuteSlashCommand = typeof executeSlashCommand;

const { executeSlashCommandMock, setLastActiveSessionKeyMock } = vi.hoisted(() => ({
  executeSlashCommandMock: vi.fn(),
  setLastActiveSessionKeyMock: vi.fn(),
}));

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

vi.mock("./app-last-active-session.ts", () => ({
  setLastActiveSessionKey: (...args: unknown[]) => setLastActiveSessionKeyMock(...args),
}));

vi.mock("./chat/slash-command-executor.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chat/slash-command-executor.ts")>();
  return {
    ...actual,
    executeSlashCommand: (...args: Parameters<ExecuteSlashCommand>) => {
      const implementation = executeSlashCommandMock.getMockImplementation() as
        | ExecuteSlashCommand
        | undefined;
      return implementation
        ? executeSlashCommandMock(...args)
        : actual.executeSlashCommand(...args);
    },
  };
});

let handleSendChat: typeof import("./app-chat.ts").handleSendChat;
let steerQueuedChatMessage: typeof import("./app-chat.ts").steerQueuedChatMessage;
let navigateChatInputHistory: typeof import("./app-chat.ts").navigateChatInputHistory;
let handleAbortChat: typeof import("./app-chat.ts").handleAbortChat;
let hasAbortableSessionRun: typeof import("./app-chat.ts").hasAbortableSessionRun;
let refreshChat: typeof import("./app-chat.ts").refreshChat;
let refreshChatAvatar: typeof import("./app-chat.ts").refreshChatAvatar;
let clearPendingQueueItemsForRun: typeof import("./app-chat.ts").clearPendingQueueItemsForRun;
let removeQueuedMessage: typeof import("./app-chat.ts").removeQueuedMessage;
let retryQueuedChatMessage: typeof import("./app-chat.ts").retryQueuedChatMessage;
let markQueuedChatSendsWaitingForReconnect: typeof import("./app-chat.ts").markQueuedChatSendsWaitingForReconnect;
let retryReconnectableQueuedChatSends: typeof import("./app-chat.ts").retryReconnectableQueuedChatSends;
let setChatQueuePaused: typeof import("./app-chat.ts").setChatQueuePaused;
let loadServerChatTurns: typeof import("./app-chat.ts").loadServerChatTurns;
let recordChatSendServerTiming: typeof import("./app-chat.ts").recordChatSendServerTiming;
let recordFirstAssistantChatTiming: typeof import("./app-chat.ts").recordFirstAssistantChatTiming;

async function loadChatHelpers(): Promise<void> {
  ({
    handleSendChat,
    steerQueuedChatMessage,
    navigateChatInputHistory,
    handleAbortChat,
    hasAbortableSessionRun,
    refreshChat,
    refreshChatAvatar,
    clearPendingQueueItemsForRun,
    removeQueuedMessage,
    retryQueuedChatMessage,
    markQueuedChatSendsWaitingForReconnect,
    retryReconnectableQueuedChatSends,
    setChatQueuePaused,
    loadServerChatTurns,
    recordChatSendServerTiming,
    recordFirstAssistantChatTiming,
  } = await import("./app-chat.ts"));
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

type MockCallSource = {
  mock: {
    calls: ArrayLike<ReadonlyArray<unknown>>;
  };
};

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error(`expected ${label}`);
  }
  return value as Record<string, unknown>;
}

function mockArg(source: MockCallSource, callIndex: number, argIndex: number, label: string) {
  const call = source.mock.calls[callIndex];
  if (!call) {
    throw new Error(`expected mock call: ${label}`);
  }
  return call[argIndex];
}

function findRequestPayload(source: MockCallSource, method: string, label: string) {
  const call = Array.from(source.mock.calls).find((candidate) => candidate[0] === method);
  if (!call) {
    throw new Error(`expected request call: ${label}`);
  }
  return requireRecord(call[1], label);
}

function eventPayloads(host: ChatHost, event: string): Array<Record<string, unknown>> {
  return (host.eventLogBuffer ?? [])
    .filter((entry): entry is { event: string; payload: Record<string, unknown> } => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const candidate = entry as { event?: unknown; payload?: unknown };
      return (
        candidate.event === event &&
        Boolean(candidate.payload && typeof candidate.payload === "object")
      );
    })
    .map((entry) => entry.payload);
}

function fetchInit(source: MockCallSource, callIndex: number) {
  return requireRecord(mockArg(source, callIndex, 1, `fetch init ${callIndex}`), "fetch init");
}

function fetchUrl(source: MockCallSource, callIndex: number) {
  const input = mockArg(source, callIndex, 0, `fetch input ${callIndex}`);
  if (typeof input === "string" || input instanceof URL || input instanceof Request) {
    return requestUrl(input);
  }
  throw new Error(`expected fetch input ${callIndex}`);
}

function makeHost(overrides?: Partial<ChatHost>): ChatHost {
  const host = {
    client: null,
    chatMessages: [],
    chatStream: null,
    chatStreamSegments: [],
    chatToolMessages: [],
    connected: true,
    chatLoading: false,
    chatMessage: "",
    chatLocalInputHistoryBySession: {},
    chatInputHistorySessionKey: null,
    chatInputHistoryItems: null,
    chatInputHistoryIndex: -1,
    chatDraftBeforeHistory: null,
    chatAttachments: [],
    chatQueue: [],
    chatQueueBySession: {},
    chatRunId: null,
    chatSending: false,
    lastError: null,
    sessionKey: "agent:main",
    basePath: "",
    hello: null,
    chatAvatarUrl: null,
    chatAvatarSource: null,
    chatAvatarStatus: null,
    chatAvatarReason: null,
    chatSideResult: null,
    chatSideResultTerminalRuns: new Set<string>(),
    sessionsLoading: false,
    sessionsResult: null,
    sessionsResultAgentId: null,
    sessionsError: null,
    sessionsFilterActive: "0",
    sessionsFilterLimit: "50",
    sessionsIncludeGlobal: true,
    sessionsIncludeUnknown: true,
    sessionsShowArchived: false,
    sessionsExpandedCheckpointKey: null,
    sessionsCheckpointItemsByKey: {},
    sessionsCheckpointLoadingKey: null,
    sessionsCheckpointBusyKey: null,
    sessionsCheckpointErrorByKey: {},
    chatModelOverrides: {},
    chatModelSwitchPromises: {},
    chatModelsLoading: false,
    chatModelCatalog: [],
    refreshSessionsAfterChat: new Map(),
    toolStreamById: new Map(),
    toolStreamOrder: [],
    toolStreamSyncTimer: null,
    updateComplete: Promise.resolve(),
    ...overrides,
  };
  return host as ChatHost;
}

function createSessionsResult(sessions: GatewaySessionRow[]): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: sessions.length,
    defaults: { modelProvider: null, model: null, contextTokens: null },
    sessions,
  };
}

function row(key: string, overrides?: Partial<GatewaySessionRow>): GatewaySessionRow {
  return {
    key,
    kind: "direct",
    updatedAt: null,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  if (!resolve || !reject) {
    throw new Error("Expected deferred callbacks to be initialized");
  }
  return { promise, resolve, reject };
}

const neverSettlesPromise: Promise<never> = Promise.race([]);

function pendingPromise<T = unknown>(): Promise<T> {
  return neverSettlesPromise as Promise<T>;
}

async function raceWithMacrotask(promise: Promise<unknown>): Promise<"resolved" | "pending"> {
  return await Promise.race([
    promise.then(() => "resolved" as const),
    new Promise<"pending">((resolve) => {
      setImmediate(() => resolve("pending"));
    }),
  ]);
}

describe("refreshChat", () => {
  beforeAll(async () => {
    await loadChatHelpers();
  });

  it("dispatches chat refresh work without waiting for slow history or metadata RPCs", async () => {
    const request = vi.fn(() => pendingPromise());
    const requestUpdate = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      requestUpdate,
    });

    const refresh = refreshChat(host);
    const outcome = await raceWithMacrotask(refresh);

    expect(outcome).toBe("resolved");
    expect(host.chatLoading).toBe(true);
    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "main",
      limit: 100,
      offset: 0,
    });
    expect(request).not.toHaveBeenCalledWith("models.list", { view: "configured" });
    expect(request).not.toHaveBeenCalledWith("sessions.list", expect.anything());
    expect(request).not.toHaveBeenCalledWith("commands.list", {
      agentId: "main",
      includeArgs: true,
      scope: "text",
    });
    expect(requestUpdate).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("chat.metadata", { agentId: "main" }),
    );
    expect(request).not.toHaveBeenCalledWith("models.list", { view: "configured" });
    expect(request).not.toHaveBeenCalledWith("commands.list", expect.anything());
  });

  it("scopes global chat refresh session rows to the selected agent", async () => {
    const request = vi.fn(() => pendingPromise());
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "global",
      assistantAgentId: "work",
      agentsList: { defaultId: "main" },
    });

    const refresh = refreshChat(host);
    const outcome = await raceWithMacrotask(refresh);

    expect(outcome).toBe("resolved");
    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "global",
      agentId: "work",
      limit: 100,
      offset: 0,
    });
    expect(request).not.toHaveBeenCalledWith("sessions.list", expect.anything());
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("chat.metadata", { agentId: "work" }),
    );
  });

  it("scopes agent main aliases as selected global chat refreshes", async () => {
    const request = vi.fn(() => pendingPromise());
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "agent:work:main",
      agentsList: { defaultId: "main", mainKey: "main" },
    });

    const refresh = refreshChat(host);
    const outcome = await raceWithMacrotask(refresh);

    expect(outcome).toBe("resolved");
    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "agent:work:main",
      agentId: "work",
      limit: 100,
      offset: 0,
    });
    expect(request).not.toHaveBeenCalledWith("sessions.list", expect.anything());
  });

  it("scopes agent session refresh rows before the list limit", async () => {
    const request = vi.fn(() => pendingPromise());
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "agent:work:dashboard",
      agentsList: { defaultId: "main", mainKey: "main" },
    });

    const refresh = refreshChat(host);
    const outcome = await raceWithMacrotask(refresh);

    expect(outcome).toBe("resolved");
    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "agent:work:dashboard",
      limit: 100,
      offset: 0,
    });
    expect(request).not.toHaveBeenCalledWith("sessions.list", expect.anything());
  });

  it("uses hello default for global chat refresh before agents list loads", async () => {
    const request = vi.fn(() => pendingPromise());
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "global",
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: [] },
        snapshot: { sessionDefaults: { defaultAgentId: "ops" } },
      },
    });

    const refresh = refreshChat(host);
    const outcome = await raceWithMacrotask(refresh);

    expect(outcome).toBe("resolved");
    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "global",
      agentId: "ops",
      limit: 100,
      offset: 0,
    });
    expect(request).not.toHaveBeenCalledWith("sessions.list", expect.anything());
  });

  it("keeps unknown chat refresh session rows unscoped", async () => {
    const request = vi.fn(() => pendingPromise());
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "unknown",
      assistantAgentId: "work",
      agentsList: { defaultId: "main" },
    });

    const refresh = refreshChat(host);
    const outcome = await raceWithMacrotask(refresh);

    expect(outcome).toBe("resolved");
    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "unknown",
      limit: 100,
      offset: 0,
    });
    expect(request).not.toHaveBeenCalledWith("sessions.list", expect.anything());
  });

  it("can wait for history without waiting for secondary metadata refreshes", async () => {
    const history = createDeferred<unknown>();
    const requestUpdate = vi.fn();
    const request = vi.fn((method: string) => {
      if (method === "chat.history") {
        return history.promise;
      }
      return pendingPromise();
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      requestUpdate,
    });

    const refresh = refreshChat(host, { awaitHistory: true, scheduleScroll: false });
    const pendingOutcome = await raceWithMacrotask(refresh);

    expect(pendingOutcome).toBe("pending");
    history.resolve({
      messages: [{ role: "assistant", content: [{ type: "text", text: "ready" }] }],
    });

    await expect(refresh).resolves.toBeUndefined();
    expect(host.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "ready" }] },
    ]);
    expect(request).not.toHaveBeenCalledWith("models.list", { view: "configured" });
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("chat.metadata", { agentId: "main" }),
    );
    expect(request).not.toHaveBeenCalledWith("models.list", { view: "configured" });
    expect(requestUpdate).toHaveBeenCalled();
  });

  it("records chat history timing when a reload keeps active stream state visible", async () => {
    const request = vi.fn((method: string) => {
      if (method === "chat.history") {
        return Promise.resolve({
          messages: [{ role: "assistant", content: [{ type: "text", text: "ready" }] }],
        });
      }
      return pendingPromise();
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      chatRunId: "run-main",
      chatStream: "partial",
      eventLogBuffer: [],
    });

    await refreshChat(host, { awaitHistory: true, scheduleScroll: false });

    expect(host.chatStream).toBe("partial");
    expect(eventPayloads(host, "control-ui.chat.history")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "start",
          sessionKey: "main",
          previousRunId: "run-main",
        }),
        expect.objectContaining({
          phase: "applied",
          sessionKey: "main",
          previousRunId: "run-main",
          resetStream: true,
        }),
      ]),
    );
  });

  it("drains a restored queue after refresh proves the selected session is idle", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.history") {
        return {
          messages: [],
          sessionInfo: row("main", { hasActiveRun: false, status: "done" }),
        };
      }
      return {};
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      chatQueue: [{ id: "queued-1", text: "after reload", createdAt: 1 }],
    });

    await refreshChat(host, { scheduleScroll: false });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "main",
        message: "after reload",
      }),
    );
    expect(host.chatQueue).toEqual([]);
  });

  it("drains a restored queue from history metadata when the visible list is scoped elsewhere", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.history") {
        return {
          messages: [],
          sessionInfo: row("agent:work:dashboard", {
            hasActiveRun: false,
            status: "done",
          }),
        };
      }
      return {};
    });
    const previousSessionsResult = createSessionsResult([
      row("agent:main:main", { hasActiveRun: false, status: "done" }),
    ]);
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "agent:work:dashboard",
      sessionsResult: previousSessionsResult,
      chatQueue: [{ id: "queued-1", text: "after scoped reload", createdAt: 1 }],
    });
    (host as ChatHost & { sessionsResultAgentId: string }).sessionsResultAgentId = "main";

    await refreshChat(host, { scheduleScroll: false });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(host.sessionsResult).toBe(previousSessionsResult);
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "agent:work:dashboard",
        message: "after scoped reload",
      }),
    );
    expect(host.chatQueue).toEqual([]);
  });

  it("drains a restored queue when global history metadata answers an agent main alias", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.history") {
        return {
          messages: [],
          sessionInfo: row("global", {
            kind: "global",
            hasActiveRun: false,
            status: "done",
          }),
        };
      }
      return {};
    });
    const previousSessionsResult = createSessionsResult([
      row("agent:main:main", { hasActiveRun: false, status: "done" }),
    ]);
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "agent:work:main",
      agentsList: { defaultId: "main", mainKey: "main" },
      sessionsResult: previousSessionsResult,
      chatQueue: [{ id: "queued-1", text: "after global alias reload", createdAt: 1 }],
    });
    (host as ChatHost & { sessionsResultAgentId: string }).sessionsResultAgentId = "main";

    await refreshChat(host, { scheduleScroll: false });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "agent:work:main",
        message: "after global alias reload",
      }),
    );
    expect(request).not.toHaveBeenCalledWith("sessions.list", expect.anything());
    expect(host.chatQueue).toEqual([]);
  });

  it("drains a restored queue from fresh history metadata despite stale sessions errors", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.history") {
        return {
          messages: [],
          sessionInfo: row("main", { hasActiveRun: false, status: "done" }),
        };
      }
      return {};
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      sessionsError: "old sessions.list failure",
      chatQueue: [{ id: "queued-1", text: "after stale error", createdAt: 1 }],
    });

    await refreshChat(host, { scheduleScroll: false });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "main",
        message: "after stale error",
      }),
    );
    expect(host.chatQueue).toEqual([]);
  });

  it("keeps a restored queue while the selected session is still active", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.history") {
        return {
          messages: [],
          sessionInfo: row("main", { hasActiveRun: true, status: "running" }),
        };
      }
      return {};
    });
    const restoredQueue = [{ id: "queued-1", text: "after active run", createdAt: 1 }];
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      chatQueue: restoredQueue,
    });

    await refreshChat(host, { scheduleScroll: false });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(request).not.toHaveBeenCalledWith("chat.send", expect.anything());
    expect(host.chatQueue).toEqual(restoredQueue);
    expect(host.chatRunId).toBeNull();
  });

  it("keeps a restored queue when stale history says a newer active row is idle", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.history") {
        return {
          messages: [],
          sessionInfo: row("main", {
            hasActiveRun: false,
            status: "done",
            updatedAt: 5,
          }),
        };
      }
      return {};
    });
    const restoredQueue = [{ id: "queued-1", text: "after active run", createdAt: 1 }];
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      chatQueue: restoredQueue,
      sessionsResult: createSessionsResult([
        row("main", {
          hasActiveRun: true,
          status: "running",
          updatedAt: 10,
          startedAt: 9,
        }),
      ]),
    });

    await refreshChat(host, { scheduleScroll: false });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(request).not.toHaveBeenCalledWith("chat.send", expect.anything());
    expect(host.chatQueue).toEqual(restoredQueue);
    expect(host.sessionsResult?.sessions[0]).toMatchObject({
      hasActiveRun: true,
      status: "running",
      updatedAt: 10,
    });
  });

  it("keeps a restored queue when history has no selected-session metadata", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.history") {
        return { messages: [] };
      }
      return {};
    });
    const restoredQueue = [{ id: "queued-1", text: "after reload", createdAt: 1 }];
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      chatQueue: restoredQueue,
      sessionsResult: createSessionsResult([row("main", { hasActiveRun: false, status: "done" })]),
    });

    await refreshChat(host, { scheduleScroll: false });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(request).not.toHaveBeenCalledWith("chat.send", expect.anything());
    expect(host.chatQueue).toEqual(restoredQueue);
    expect(request).not.toHaveBeenCalledWith("sessions.list", expect.anything());
  });
});

describe("refreshChatAvatar", () => {
  beforeAll(async () => {
    await loadChatHelpers();
  });

  afterEach(() => {
    resetChatAttachmentPayloadStoreForTest();
    vi.unstubAllGlobals();
  });

  it("uses a route-relative avatar endpoint before basePath bootstrap finishes", async () => {
    const createObjectURL = vi.fn(() => "blob:local-avatar");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = createObjectURL;
        static override revokeObjectURL = revokeObjectURL;
      },
    );
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url === "/avatar/main?meta=1") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ avatarUrl: "/avatar/main" }),
        });
      }
      if (url === "/avatar/main") {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(["avatar"]),
        });
      }
      throw new Error(`Unexpected avatar URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "", sessionKey: "agent:main" });
    await refreshChatAvatar(host);

    expect(fetchUrl(fetchMock as unknown as MockCallSource, 0)).toBe("/avatar/main?meta=1");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 0).method).toBe("GET");
    expect(fetchUrl(fetchMock as unknown as MockCallSource, 1)).toBe("/avatar/main");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 1).method).toBe("GET");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 1)).not.toHaveProperty("headers");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(host.chatAvatarUrl).toBe("blob:local-avatar");
  });

  it("prefers the paired device token for avatar metadata and local avatar URLs", async () => {
    const createObjectURL = vi.fn(() => "blob:device-avatar");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = createObjectURL;
        static override revokeObjectURL = revokeObjectURL;
      },
    );
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url === "/openclaw/avatar/main?meta=1") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ avatarUrl: "/avatar/main" }),
        });
      }
      if (url === "/avatar/main") {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(["avatar"]),
        });
      }
      throw new Error(`Unexpected avatar URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({
      basePath: "/openclaw/",
      sessionKey: "agent:main",
      settings: { token: "session-token" },
      password: "shared-password",
      hello: { auth: { deviceToken: "device-token" } } as ChatHost["hello"],
    });
    await refreshChatAvatar(host);

    expect(fetchUrl(fetchMock as unknown as MockCallSource, 0)).toBe(
      "/openclaw/avatar/main?meta=1",
    );
    expect(fetchInit(fetchMock as unknown as MockCallSource, 0).method).toBe("GET");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 0).headers).toEqual({
      Authorization: "Bearer device-token",
    });
    expect(fetchUrl(fetchMock as unknown as MockCallSource, 1)).toBe("/avatar/main");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 1).method).toBe("GET");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 1).headers).toEqual({
      Authorization: "Bearer device-token",
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(host.chatAvatarUrl).toBe("blob:device-avatar");
  });

  it("fetches local avatars through Authorization headers instead of tokenized URLs", async () => {
    const createObjectURL = vi.fn(() => "blob:session-avatar");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = createObjectURL;
        static override revokeObjectURL = revokeObjectURL;
      },
    );
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url === "/openclaw/avatar/main?meta=1") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ avatarUrl: "/avatar/main" }),
        });
      }
      if (url === "/avatar/main") {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(["avatar"]),
        });
      }
      throw new Error(`Unexpected avatar URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({
      basePath: "/openclaw/",
      sessionKey: "agent:main",
      settings: { token: "session-token" },
    });
    await refreshChatAvatar(host);

    expect(fetchUrl(fetchMock as unknown as MockCallSource, 0)).toBe(
      "/openclaw/avatar/main?meta=1",
    );
    expect(fetchInit(fetchMock as unknown as MockCallSource, 0).method).toBe("GET");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 0).headers).toEqual({
      Authorization: "Bearer session-token",
    });
    expect(fetchUrl(fetchMock as unknown as MockCallSource, 1)).toBe("/avatar/main");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 1).method).toBe("GET");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 1).headers).toEqual({
      Authorization: "Bearer session-token",
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(host.chatAvatarUrl).toBe("blob:session-avatar");
  });

  it("keeps mounted dashboard avatar endpoints under the normalized base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "/openclaw/", sessionKey: "agent:ops:main" });
    await refreshChatAvatar(host);

    expect(fetchUrl(fetchMock as unknown as MockCallSource, 0)).toBe("/openclaw/avatar/ops?meta=1");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 0).method).toBe("GET");
    expect(host.chatAvatarUrl).toBeNull();
  });

  it("drops remote avatar metadata so the control UI can rely on same-origin images only", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        avatarUrl: "https://example.com/avatar.png",
        avatarSource: "https://example.com/avatar.png",
        avatarStatus: "remote",
        avatarReason: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "", sessionKey: "agent:main" });
    await refreshChatAvatar(host);

    expect(host.chatAvatarUrl).toBeNull();
    expect(host.chatAvatarSource).toBe("https://example.com/avatar.png");
    expect(host.chatAvatarStatus).toBe("remote");
  });

  it("keeps unresolved IDENTITY.md avatar metadata when falling back to the logo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        avatarUrl: null,
        avatarSource: "assets/avatars/nova-portrait.png",
        avatarStatus: "none",
        avatarReason: "missing",
      }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "", sessionKey: "agent:main" });
    await refreshChatAvatar(host);

    expect(host.chatAvatarUrl).toBeNull();
    expect(host.chatAvatarSource).toBe("assets/avatars/nova-portrait.png");
    expect(host.chatAvatarStatus).toBe("none");
    expect(host.chatAvatarReason).toBe("missing");
  });

  it("ignores stale avatar responses after switching sessions", async () => {
    const createObjectURL = vi.fn(() => "blob:ops-avatar");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = createObjectURL;
        static override revokeObjectURL = revokeObjectURL;
      },
    );
    const mainRequest = createDeferred<{ avatarUrl?: string }>();
    const opsRequest = createDeferred<{ avatarUrl?: string }>();
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url === "/avatar/main?meta=1") {
        return Promise.resolve({
          ok: true,
          json: async () => mainRequest.promise,
        });
      }
      if (url === "/avatar/ops?meta=1") {
        return Promise.resolve({
          ok: true,
          json: async () => opsRequest.promise,
        });
      }
      if (url === "/avatar/ops") {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(["avatar"]),
        });
      }
      throw new Error(`Unexpected avatar URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "", sessionKey: "agent:main:main" });

    const firstRefresh = refreshChatAvatar(host);
    host.sessionKey = "agent:ops:main";
    const secondRefresh = refreshChatAvatar(host);

    mainRequest.resolve({ avatarUrl: "/avatar/main" });
    await firstRefresh;
    expect(host.chatAvatarUrl).toBeNull();

    opsRequest.resolve({ avatarUrl: "/avatar/ops" });
    await secondRefresh;

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(host.chatAvatarUrl).toBe("blob:ops-avatar");
    expect(fetchUrl(fetchMock as unknown as MockCallSource, 0)).toBe("/avatar/main?meta=1");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 0).method).toBe("GET");
    expect(fetchUrl(fetchMock as unknown as MockCallSource, 1)).toBe("/avatar/ops?meta=1");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 1).method).toBe("GET");
    expect(fetchUrl(fetchMock as unknown as MockCallSource, 2)).toBe("/avatar/ops");
    expect(fetchInit(fetchMock as unknown as MockCallSource, 2).method).toBe("GET");
  });

  it("ignores stale global avatar responses after switching selected agents", async () => {
    const createObjectURL = vi.fn(() => "blob:ops-avatar");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = createObjectURL;
        static override revokeObjectURL = revokeObjectURL;
      },
    );
    const workRequest = createDeferred<{ avatarUrl?: string }>();
    const opsRequest = createDeferred<{ avatarUrl?: string }>();
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = requestUrl(input);
      if (url === "/avatar/work?meta=1") {
        return Promise.resolve({
          ok: true,
          json: async () => workRequest.promise,
        });
      }
      if (url === "/avatar/ops?meta=1") {
        return Promise.resolve({
          ok: true,
          json: async () => opsRequest.promise,
        });
      }
      if (url === "/avatar/ops") {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(["avatar"]),
        });
      }
      throw new Error(`Unexpected avatar URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({
      basePath: "",
      sessionKey: "global",
      assistantAgentId: "work",
      agentsList: { defaultId: "main" },
    });

    const firstRefresh = refreshChatAvatar(host);
    host.assistantAgentId = "ops";
    const secondRefresh = refreshChatAvatar(host);

    workRequest.resolve({ avatarUrl: "/avatar/work" });
    await firstRefresh;
    expect(host.chatAvatarUrl).toBeNull();

    opsRequest.resolve({ avatarUrl: "/avatar/ops" });
    await secondRefresh;

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(host.chatAvatarUrl).toBe("blob:ops-avatar");
    expect(fetchUrl(fetchMock as unknown as MockCallSource, 0)).toBe("/avatar/work?meta=1");
    expect(fetchUrl(fetchMock as unknown as MockCallSource, 1)).toBe("/avatar/ops?meta=1");
    expect(fetchUrl(fetchMock as unknown as MockCallSource, 2)).toBe("/avatar/ops");
  });
});

describe("refreshChat", () => {
  beforeAll(async () => {
    await loadChatHelpers();
  });

  it("does not wait for secondary chat metadata refreshes before showing history", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => pendingPromise<Response>()) as never;
    try {
      const request = vi.fn((method: string) => {
        if (method === "chat.history") {
          return Promise.resolve({
            messages: [{ role: "assistant", content: [{ type: "text", text: "ready" }] }],
          });
        }
        return pendingPromise();
      });
      const host = makeHost({
        client: { request } as unknown as ChatHost["client"],
        sessionKey: "main",
      });

      const outcome = await raceWithMacrotask(refreshChat(host));

      expect(outcome).toBe("resolved");
      expect(host.chatMessages).toEqual([
        { role: "assistant", content: [{ type: "text", text: "ready" }] },
      ]);
      expect(request).not.toHaveBeenCalledWith("sessions.list", expect.anything());
      await vi.waitFor(() =>
        expect(request).toHaveBeenCalledWith("chat.metadata", { agentId: "main" }),
      );
      expect(request).not.toHaveBeenCalledWith("models.list", { view: "configured" });
      expect(request).not.toHaveBeenCalledWith("commands.list", expect.anything());
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("uses startup metadata without scheduling command or metadata follow-ups", async () => {
    const { resetSlashCommandsForTest } = await import("./chat/slash-commands.ts");
    resetSlashCommandsForTest();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as never;
    try {
      const request = vi.fn((method: string) => {
        if (method === "chat.startup") {
          return Promise.resolve({
            messages: [],
            metadata: {
              models: [{ id: "gpt-fast", name: "GPT Fast", provider: "openai" }],
            },
          });
        }
        return pendingPromise();
      });
      const host = makeHost({
        client: { request } as unknown as ChatHost["client"],
        sessionKey: "main",
      });

      await refreshChat(host, { startup: true });

      await vi.waitFor(() => expect(host.chatModelCatalog).toHaveLength(1));
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 75);
      });
      expect(request).toHaveBeenCalledWith("chat.startup", {
        sessionKey: "main",
        limit: 100,
        offset: 0,
      });
      expect(request).not.toHaveBeenCalledWith("chat.metadata", expect.anything());
      expect(request).not.toHaveBeenCalledWith("models.list", expect.anything());
      expect(request).not.toHaveBeenCalledWith("commands.list", expect.anything());
      expect(host.chatModelCatalog).toEqual([
        { id: "gpt-fast", name: "GPT Fast", provider: "openai" },
      ]);
    } finally {
      resetSlashCommandsForTest();
      globalThis.fetch = previousFetch;
    }
  });

  it("falls back to separate metadata RPCs when chat.metadata is not advertised", async () => {
    const request = vi.fn(() => pendingPromise());
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: [] },
        features: { events: [], methods: ["chat.history"] },
      },
    });

    await refreshChat(host);

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("models.list", { view: "configured" }),
    );
    expect(request).toHaveBeenCalledWith("commands.list", {
      agentId: "main",
      includeArgs: true,
      scope: "text",
    });
    expect(request).not.toHaveBeenCalledWith("chat.metadata", expect.anything());
  });

  it("falls back to separate metadata RPCs when an older gateway rejects chat.metadata", async () => {
    const { GatewayRequestError } = await import("./gateway.ts");
    const request = vi.fn((method: string) => {
      if (method === "chat.metadata") {
        return Promise.reject(
          new GatewayRequestError({
            code: "INVALID_REQUEST",
            message: "unknown method: chat.metadata",
          }),
        );
      }
      return pendingPromise();
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
    });

    await refreshChat(host);

    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith("models.list", { view: "configured" }),
    );
    expect(request).toHaveBeenCalledWith("commands.list", {
      agentId: "main",
      includeArgs: true,
      scope: "text",
    });
  });

  it("ignores stale chat.metadata results after the selected global agent changes", async () => {
    const { resetSlashCommandsForTest, SLASH_COMMANDS } = await import("./chat/slash-commands.ts");
    resetSlashCommandsForTest();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as never;
    const metadata = createDeferred<unknown>();
    const requestUpdate = vi.fn();
    try {
      const request = vi.fn((method: string) => {
        if (method === "chat.history") {
          return Promise.resolve({ messages: [], thinkingLevel: null });
        }
        if (method === "chat.metadata") {
          return metadata.promise;
        }
        return pendingPromise();
      });
      const host = makeHost({
        client: { request } as unknown as ChatHost["client"],
        sessionKey: "global",
        assistantAgentId: "work",
        requestUpdate,
      });

      await refreshChat(host);
      await vi.waitFor(() =>
        expect(request).toHaveBeenCalledWith("chat.metadata", { agentId: "work" }),
      );
      host.assistantAgentId = "ops";
      const updatesBeforeMetadata = requestUpdate.mock.calls.length;
      metadata.resolve({
        models: [{ id: "stale-model", name: "Stale Model", provider: "stale-provider" }],
        commands: [
          {
            acceptsArgs: false,
            description: "stale command",
            name: "stale-command",
            scope: "text",
            source: "native",
            textAliases: ["/stale-command"],
          },
        ],
      });

      await vi.waitFor(() =>
        expect(requestUpdate.mock.calls.length).toBeGreaterThan(updatesBeforeMetadata),
      );
      expect(host.chatModelCatalog).toEqual([]);
      expect(SLASH_COMMANDS.some((command) => command.name === "stale-command")).toBe(false);
    } finally {
      resetSlashCommandsForTest();
      globalThis.fetch = previousFetch;
    }
  });
});

describe("handleSendChat", () => {
  beforeAll(async () => {
    await loadChatHelpers();
  });

  beforeEach(() => {
    executeSlashCommandMock.mockReset();
    setLastActiveSessionKeyMock.mockReset();
    vi.stubGlobal("sessionStorage", createStorageMock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("cancels button-triggered /new resets when confirmation is declined", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "keep this draft",
      sessionKey: "agent:main",
    });

    await handleSendChat(host, "/new", { confirmReset: true, restoreDraft: true });

    expect(confirm).toHaveBeenCalledWith("Start a new session? This will reset the current chat.");
    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("keep this draft");
    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatRunId).toBeNull();
    expect(host.refreshSessionsAfterChat.size).toBe(0);
  });

  it("cancels button-triggered /new resets when confirmation is unavailable", async () => {
    vi.stubGlobal("confirm", undefined);
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "keep this draft",
      sessionKey: "agent:main",
    });

    await handleSendChat(host, "/new", { confirmReset: true, restoreDraft: true });

    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("keep this draft");
    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatRunId).toBeNull();
    expect(host.refreshSessionsAfterChat.size).toBe(0);
  });

  it("runs the fresh-session action for confirmed /new overrides", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const onSlashAction = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "restore me",
      sessionKey: "agent:main",
      onSlashAction,
    });

    await handleSendChat(host, "/new", { confirmReset: true, restoreDraft: true });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(onSlashAction).toHaveBeenCalledWith("new-session");
    expect(host.chatMessage).toBe("restore me");
    expect(host.refreshSessionsAfterChat.size).toBe(0);
  });

  it("routes typed /new through the fresh-session action without confirmation", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const onSlashAction = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "/new",
      sessionKey: "agent:main",
      onSlashAction,
    });

    await handleSendChat(host);

    expect(confirm).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(onSlashAction).toHaveBeenCalledWith("new-session");
    expect(host.chatMessage).toBe("");
  });

  it("does not queue typed /new behind an active run", async () => {
    const onSlashAction = vi.fn();
    const host = makeHost({
      chatMessage: "/new",
      chatRunId: "run-main",
      chatStream: "Working...",
      onSlashAction,
    });

    await handleSendChat(host);

    expect(onSlashAction).toHaveBeenCalledWith("new-session");
    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatRunId).toBe("run-main");
    expect(host.chatStream).toBe("Working...");
    expect(host.chatMessage).toBe("");
  });

  it("preserves typed /reset command dispatch without confirmation", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "/reset",
      sessionKey: "agent:main",
    });

    await handleSendChat(host);

    expect(confirm).not.toHaveBeenCalled();
    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    expect(payload.sessionKey).toBe("agent:main");
    expect(payload.message).toBe("/reset");
    expect(host.chatMessage).toBe("");
  });

  it.each([
    {
      input: "/reset soft please reload system prompt",
      expected: "/reset soft please reload system prompt",
    },
    {
      input: "/reset\tsoft please reload system prompt",
      expected: "/reset soft please reload system prompt",
    },
    {
      input: "/reset\nsoft please reload system prompt",
      expected: "/reset soft please reload system prompt",
    },
    {
      input: "/reset: soft please reload system prompt",
      expected: "/reset soft please reload system prompt",
    },
  ])("preserves $input args and skips confirmation dialog", async ({ input, expected }) => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: input,
      sessionKey: "agent:main",
    });

    await handleSendChat(host);

    expect(confirm).not.toHaveBeenCalled();
    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    expect(payload.sessionKey).toBe("agent:main");
    expect(payload.message).toBe(expected);
    expect(host.chatMessage).toBe("");
  });

  it.each([
    "/reset softish please archive",
    "/reset\tsoftish please archive",
    "/reset\nsoftish please archive",
    "/reset: softish please archive",
  ])("keeps %s on the hard-reset confirmation path", async (message) => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "keep this draft",
      sessionKey: "agent:main",
    });

    await handleSendChat(host, message, {
      confirmReset: true,
      restoreDraft: true,
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("keep this draft");
  });

  it("does not seed refreshSessionsAfterChat for a terminal timeout ack on a refreshing send", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "timeout" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "/reset",
      sessionKey: "agent:main",
    });

    await handleSendChat(host);

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    const runId = String(payload.idempotencyKey);
    const runState = host as ChatHost & {
      chatStreamStartedAt?: number | null;
      lastLocalTerminalReconcile?: unknown;
    };
    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
    expect(runState.chatStreamStartedAt).toBeNull();
    expect(runState.lastLocalTerminalReconcile).toMatchObject({
      phase: "interrupted",
      runId,
      sessionKey: "agent:main",
      sessionStatus: "killed",
    });
    expect(host.refreshSessionsAfterChat.size).toBe(0);
  });

  it("marks terminal error ACK sends failed instead of accepting the queued message", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "chat.send") {
        const payload = requireRecord(params, "chat send payload");
        return { runId: payload.idempotencyKey, status: "error" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "send before failing",
      sessionKey: "agent:main",
    });

    await handleSendChat(host);

    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatMessage).toBe("send before failing");
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]).toMatchObject({
      text: "send before failing",
      sendState: "failed",
      sendError: "Chat failed before the run started; try again.",
    });
    expect(host.lastError).toBe("Chat failed before the run started; try again.");
    expect(host.chatRunId).toBeNull();
  });

  it("records visible send timing phases for a normal chat send", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return {
          status: "started",
          serverTiming: {
            receivedToAckMs: 17,
            loadSessionMs: 4,
            prepareAttachmentsMs: 0.5,
          },
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "measure first send",
      eventLogBuffer: [],
      tab: "debug",
    });

    await handleSendChat(host);

    const sendEvents = eventPayloads(host, "control-ui.chat.send");
    expect(sendEvents.map((payload) => payload.phase)).toEqual(
      expect.arrayContaining(["pending-visible", "request-start", "ack"]),
    );
    const ack = sendEvents.find((payload) => payload.phase === "ack");
    expect(ack).toMatchObject({
      ackStatus: "started",
      sessionKey: "agent:main",
      sendState: "sending",
    });
    expect(ack?.durationMs).toEqual(expect.any(Number));
    expect(ack?.requestDurationMs).toEqual(expect.any(Number));
    expect(ack).toMatchObject({
      serverReceivedToAckMs: 17,
      serverLoadSessionMs: 4,
      serverPrepareAttachmentsMs: 0.5,
    });
  });

  it("records Gateway post-ACK server timing milestones for a chat send", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "measure server milestone",
      eventLogBuffer: [],
      tab: "debug",
    });

    await handleSendChat(host);

    const ack = eventPayloads(host, "control-ui.chat.send").find(
      (payload) => payload.phase === "ack",
    );
    const runId = typeof ack?.runId === "string" ? ack.runId : "";
    expect(runId).toMatch(uuidPattern);

    recordChatSendServerTiming(host, {
      phase: "agent-run-started",
      runId,
      sessionKey: "agent:main",
      agentId: "main",
      ackToPhaseMs: 12,
      receivedToPhaseMs: 25,
      dispatchStartedToPhaseMs: 8,
      agentRunId: "agent-run-1",
    });

    expect(eventPayloads(host, "control-ui.chat.send")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "server-agent-run-started",
          runId,
          sessionKey: "agent:main",
          agentId: "main",
          ackStatus: "started",
          serverPhase: "agent-run-started",
          serverAckToPhaseMs: 12,
          serverReceivedToPhaseMs: 25,
          serverDispatchStartedToPhaseMs: 8,
          agentRunId: "agent-run-1",
        }),
      ]),
    );
  });

  it("warns when the first assistant reply paint is slow", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      queueMicrotask(() => callback(0));
      return 1;
    });
    const runId = "run-slow-first-assistant";
    const host = makeHost({
      chatStream: "slow first token",
      eventLogBuffer: [],
      tab: "debug",
    });
    const timingHost = host as ChatHost & {
      chatSendTimingsByRun: Map<
        string,
        {
          runId: string;
          submittedAtMs: number;
          requestStartedAtMs: number;
          ackAtMs: number;
          ackStatus: "started";
          sendAttempts: number;
          sendState: "sending";
          sessionKey: string;
          agentId: string;
        }
      >;
    };
    timingHost.chatSendTimingsByRun = new Map([
      [
        runId,
        {
          runId,
          submittedAtMs: performance.now() - 2_000,
          requestStartedAtMs: performance.now() - 1_900,
          ackAtMs: performance.now() - 1_800,
          ackStatus: "started",
          sendAttempts: 1,
          sendState: "sending",
          sessionKey: "agent:main",
          agentId: "main",
        },
      ],
    ]);

    recordFirstAssistantChatTiming(
      host,
      {
        agentId: "main",
        runId,
        sessionKey: "agent:main",
        state: "delta",
      },
      "delta",
    );

    await vi.waitFor(() =>
      expect(eventPayloads(host, "control-ui.chat.send")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            phase: "first-assistant-visible",
            runId,
            slow: true,
          }),
        ]),
      ),
    );
    expect(warn).toHaveBeenCalledWith(
      "[openclaw] control-ui.chat.send",
      expect.objectContaining({
        phase: "first-assistant-visible",
        runId,
        slow: true,
      }),
    );
  });

  it("records pending send paint timing before a delayed chat.send ACK", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      queueMicrotask(() => callback(0));
      return 1;
    });
    const chatSend = createDeferred<{ status: "started" }>();
    const request = vi.fn((method: string) => {
      if (method === "chat.send") {
        return chatSend.promise;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "measure painted pending send",
      eventLogBuffer: [],
      tab: "debug",
    });

    const send = handleSendChat(host);

    await vi.waitFor(() =>
      expect(eventPayloads(host, "control-ui.chat.send").map((payload) => payload.phase)).toEqual(
        expect.arrayContaining(["pending-visible", "request-start", "pending-painted"]),
      ),
    );

    chatSend.resolve({ status: "started" });
    await send;

    const phasesAfterAck = eventPayloads(host, "control-ui.chat.send").map(
      (payload) => payload.phase,
    );
    expect(phasesAfterAck).toEqual(expect.arrayContaining(["ack"]));
  });

  it("waits for an in-flight model picker update before sending chat", async () => {
    const switchUpdate = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "use the newly selected model",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
    });

    const send = handleSendChat(host);
    await Promise.resolve();

    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("");
    expect(host.chatQueue[0]).toMatchObject({
      sendState: "waiting-model",
      text: "use the newly selected model",
    });

    switchUpdate.resolve(true);
    await send;

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    expect(payload.sessionKey).toBe("agent:main");
    expect(payload.message).toBe("use the newly selected model");
    expect(host.chatMessage).toBe("");
  });

  it("preserves draft edits made while waiting for a model picker update", async () => {
    const switchUpdate = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "send this",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    host.chatMessage = "keep typing";

    switchUpdate.resolve(true);
    await send;

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    expect(payload.sessionKey).toBe("agent:main");
    expect(payload.message).toBe("send this");
    expect(host.chatMessage).toBe("keep typing");
  });

  it("preserves attachment payloads for edited drafts after a delayed send", async () => {
    const switchUpdate = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const file = new File(["%PDF-1.4\n"], "brief.pdf", { type: "application/pdf" });
    const attachment = registerChatAttachmentPayload({
      attachment: {
        id: "delayed-att",
        mimeType: "application/pdf",
        fileName: "brief.pdf",
        sizeBytes: file.size,
      },
      dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
      file,
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatAttachments: [attachment],
      chatMessage: "send this",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    host.chatMessage = "keep typing with the attachment";

    switchUpdate.resolve(true);
    await send;

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    expect(payload.message).toBe("send this");
    const attachments = payload.attachments as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.content).toBe("JVBERi0xLjQK");
    expect(attachments[0]?.fileName).toBe("brief.pdf");
    expect(attachments[0]?.mimeType).toBe("application/pdf");
    expect(attachments[0]?.type).toBe("file");
    expect(host.chatMessage).toBe("keep typing with the attachment");
    expect(host.chatAttachments).toStrictEqual([]);
    expect(getChatAttachmentDataUrl(attachment)).toBeNull();
  });

  it("preserves edited attachments when attachments change during a delayed send", async () => {
    const switchUpdate = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const originalFile = new File(["original"], "original.pdf", { type: "application/pdf" });
    const editedFile = new File(["edited"], "edited.pdf", { type: "application/pdf" });
    const originalAttachment = registerChatAttachmentPayload({
      attachment: {
        id: "original-att",
        mimeType: "application/pdf",
        fileName: "original.pdf",
        sizeBytes: originalFile.size,
      },
      dataUrl: "data:application/pdf;base64,b3JpZ2luYWw=",
      file: originalFile,
    });
    const editedAttachment = registerChatAttachmentPayload({
      attachment: {
        id: "edited-att",
        mimeType: "application/pdf",
        fileName: "edited.pdf",
        sizeBytes: editedFile.size,
      },
      dataUrl: "data:application/pdf;base64,ZWRpdGVk",
      file: editedFile,
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatAttachments: [originalAttachment],
      chatMessage: "send this",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    host.chatAttachments = [editedAttachment];

    switchUpdate.resolve(true);
    await send;

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    expect(payload.message).toBe("send this");
    const attachments = payload.attachments as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.content).toBe("b3JpZ2luYWw=");
    expect(attachments[0]?.fileName).toBe("original.pdf");
    expect(attachments[0]?.mimeType).toBe("application/pdf");
    expect(attachments[0]?.type).toBe("file");
    expect(host.chatMessage).toBe("");
    expect(host.chatAttachments).toEqual([editedAttachment]);
    expect(getChatAttachmentDataUrl(originalAttachment)).toBeNull();
    expect(getChatAttachmentDataUrl(editedAttachment)).toBe("data:application/pdf;base64,ZWRpdGVk");
  });

  it("sends snapshotted attachment payloads when the composer removes them during a wait", async () => {
    const switchUpdate = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const file = new File(["original"], "original.pdf", { type: "application/pdf" });
    const attachment = registerChatAttachmentPayload({
      attachment: {
        id: "removed-att",
        mimeType: "application/pdf",
        fileName: "original.pdf",
        sizeBytes: file.size,
      },
      dataUrl: "data:application/pdf;base64,b3JpZ2luYWw=",
      file,
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatAttachments: [attachment],
      chatMessage: "send this",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    host.chatAttachments = [];
    releaseChatAttachmentPayloads([attachment]);

    switchUpdate.resolve(true);
    await send;

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    expect(payload.message).toBe("send this");
    const attachments = payload.attachments as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.content).toBe("b3JpZ2luYWw=");
    expect(attachments[0]?.fileName).toBe("original.pdf");
    expect(attachments[0]?.mimeType).toBe("application/pdf");
    expect(attachments[0]?.type).toBe("file");
    expect(host.chatMessage).toBe("");
    expect(host.chatAttachments).toStrictEqual([]);
    expect(getChatAttachmentDataUrl(attachment)).toBeNull();
  });

  it("does not wait on model picker updates from another session", async () => {
    const otherSessionSwitch = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "agent:other",
      chatMessage: "send in other session",
      chatModelSwitchPromises: { "agent:main": otherSessionSwitch.promise },
    });

    await handleSendChat(host);

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    expect(payload.sessionKey).toBe("agent:other");
    expect(payload.message).toBe("send in other session");
    otherSessionSwitch.resolve(false);
  });

  it("keeps the draft when a pending model picker update fails", async () => {
    const switchUpdate = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "do not send on rollback",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    switchUpdate.resolve(false);
    await send;

    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("do not send on rollback");
  });

  it("does not restore canceled attachments onto new draft text after model update failure", async () => {
    const switchUpdate = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const file = new File(["private"], "private.txt", { type: "text/plain" });
    const attachment = registerChatAttachmentPayload({
      attachment: {
        id: "private-att",
        mimeType: "text/plain",
        fileName: "private.txt",
        sizeBytes: file.size,
      },
      dataUrl: "data:text/plain;base64,cHJpdmF0ZQ==",
      file,
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatAttachments: [attachment],
      chatMessage: "send this attachment",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    host.chatMessage = "new unrelated draft";

    switchUpdate.resolve(false);
    await send;

    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("new unrelated draft");
    expect(host.chatAttachments).toStrictEqual([]);
    expect(getChatAttachmentDataUrl(attachment)).toBeNull();
  });

  it("does not restore a manually removed model-wait send after model update failure", async () => {
    const switchUpdate = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "remove this pending send",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    const queuedId = host.chatQueue[0]?.id;
    expect(queuedId).toEqual(expect.any(String));
    await removeQueuedMessage(host, queuedId);

    switchUpdate.resolve(false);
    await send;

    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("");
    expect(host.chatQueue).toStrictEqual([]);
  });

  it("keeps resolved model-wait sends queued under the submitted session after switching", async () => {
    const switchUpdate = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "send from session a",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
      sessionKey: "agent:main",
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    expect(host.chatMessage).toBe("");
    expect(host.chatQueue[0]?.text).toBe("send from session a");

    host.chatQueueBySession = { "agent:main": [...host.chatQueue] };
    host.chatQueue = [];
    host.sessionKey = "agent:other";
    host.chatMessage = "session b draft";
    switchUpdate.resolve(true);
    await send;

    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("session b draft");
    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatQueueBySession?.["agent:main"]?.[0]).toMatchObject({
      sendState: undefined,
      text: "send from session a",
    });
  });

  it("keeps failed model-wait sends retryable under the submitted session after switching", async () => {
    const switchUpdate = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "send from session a",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
      sessionKey: "agent:main",
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    host.chatQueueBySession = { "agent:main": [...host.chatQueue] };
    host.chatQueue = [];
    host.sessionKey = "agent:other";
    host.chatMessage = "";

    switchUpdate.resolve(false);
    await send;

    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("");
    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatQueueBySession?.["agent:main"]?.[0]).toMatchObject({
      sendError: "Model selection was interrupted. Review and retry when ready.",
      sendState: "failed",
      text: "send from session a",
    });
  });

  it("does not flush model-wait sends before the model picker update finishes", async () => {
    const switchUpdate = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "wait for selected model",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
      eventLogBuffer: [],
      tab: "debug",
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    expect(host.chatQueue[0]).toMatchObject({
      sendState: "waiting-model",
      text: "wait for selected model",
    });
    expect(eventPayloads(host, "control-ui.chat.send")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "waiting-model",
          sendState: "waiting-model",
        }),
      ]),
    );

    await retryReconnectableQueuedChatSends(host);
    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueue[0]?.sendState).toBe("waiting-model");

    switchUpdate.resolve(true);
    await send;

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    expect(payload.message).toBe("wait for selected model");
  });

  it("recovers a model-wait send when the Gateway changes before the update finishes", async () => {
    const switchUpdate = createDeferred<boolean>();
    const clientA = { request: vi.fn() };
    const clientB = { request: vi.fn() };
    const host = makeHost({
      client: clientA as unknown as ChatHost["client"],
      chatQueueGatewayGeneration: 1,
      chatMessage: "recover after Gateway change",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    expect(host.chatQueue[0]?.sendState).toBe("waiting-model");

    host.client = clientB as unknown as ChatHost["client"];
    host.chatQueueGatewayGeneration = 2;
    switchUpdate.resolve(true);
    await send;

    expect(clientA.request).not.toHaveBeenCalled();
    expect(host.chatQueue[0]).toMatchObject({
      text: "recover after Gateway change",
      sendState: "waiting-reconnect",
      sendError:
        "Gateway changed before this message was accepted. It is ready to retry after reconnect.",
    });
  });

  it("keeps slash-command model changes in sync with the chat header cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }) as unknown as typeof fetch,
    );
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "sessions.patch") {
        return {
          ok: true,
          key: "main",
          resolved: {
            modelProvider: "openai",
            model: "gpt-5-mini",
          },
        };
      }
      if (method === "chat.history") {
        return { messages: [], thinkingLevel: null };
      }
      if (method === "sessions.list") {
        return {
          ts: 0,
          path: "",
          count: 0,
          defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
          sessions: [],
        };
      }
      if (method === "models.list") {
        return {
          models: [{ id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai" }],
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const onSlashAction = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      chatMessage: "/model gpt-5-mini",
      onSlashAction,
    });

    await handleSendChat(host);

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      model: "gpt-5-mini",
    });
    expect(host.chatModelOverrides.main).toEqual({
      kind: "qualified",
      value: "openai/gpt-5-mini",
    });
    expect(onSlashAction).toHaveBeenCalledWith("refresh-tools-effective");
  });

  it("shows local slash-command feedback when the gateway client is unavailable", async () => {
    const host = makeHost({
      client: null,
      chatMessage: "/think",
      connected: true,
    });

    await handleSendChat(host);

    expect(host.chatMessage).toBe("");
    expect(host.chatMessages).toHaveLength(1);
    const feedback = requireRecord(host.chatMessages[0], "feedback message");
    expect(feedback.role).toBe("system");
    expect(feedback.content).toBe(
      "Cannot run `/think`: Control UI is not connected to the Gateway.",
    );
  });

  it("shows local slash-command feedback when dispatch fails unexpectedly", async () => {
    executeSlashCommandMock.mockRejectedValue(new Error("dispatch failed"));
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "/think",
      connected: true,
    });

    await handleSendChat(host);

    expect(executeSlashCommandMock).toHaveBeenCalledTimes(1);
    expect(host.chatMessage).toBe("");
    expect(host.lastError).toBe("Error: dispatch failed");
    expect(host.chatMessages).toHaveLength(1);
    const feedback = requireRecord(host.chatMessages[0], "feedback message");
    expect(feedback.role).toBe("system");
    expect(feedback.content).toBe("Command `/think` failed unexpectedly.");
  });

  it("sends /btw immediately while a main run is active without queueing it", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return {};
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatRunId: "run-main",
      chatStream: "Working...",
      chatMessage: "/btw what changed?",
    });

    await handleSendChat(host);

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    expect(payload.sessionKey).toBe("agent:main");
    expect(payload.message).toBe("/btw what changed?");
    expect(payload.deliver).toBe(false);
    const idempotencyKey = payload.idempotencyKey;
    expect(typeof idempotencyKey).toBe("string");
    expect(uuidPattern.test(idempotencyKey as string)).toBe(true);
    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatRunId).toBe("run-main");
    expect(host.chatStream).toBe("Working...");
    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatMessage).toBe("");
    expect(navigateChatInputHistory(host, "up")).toBe(true);
    expect(host.chatMessage).toBe("/btw what changed?");
  });

  it("does not send detached /btw messages while the chat queue is paused", async () => {
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueuePaused: true,
      chatMessage: "/btw wait until resumed",
    });

    await handleSendChat(host);

    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("/btw wait until resumed");
    expect(host.chatError).toBe("Chat is paused; resume it before sending a detached message.");
  });

  it("sends /approve directly while a paused run is waiting for approval", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueuePaused: true,
      chatRunId: "run-main",
      chatStream: "Waiting for approval...",
      chatMessage: "/approve approval-123 allow-once",
    });

    await handleSendChat(host);

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "approval command payload",
    );
    expect(payload.message).toBe("/approve approval-123 allow-once");
    expect(payload.deliver).toBe(false);
    expect(host.chatQueue).toStrictEqual([]);
  });

  it("does not send a detached /btw message if the queue pauses during a model wait", async () => {
    const switchUpdate = createDeferred<boolean>();
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return {};
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "/btw wait until resumed",
      chatModelSwitchPromises: { "agent:main": switchUpdate.promise },
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    host.chatQueuePaused = true;
    switchUpdate.resolve(true);
    await send;

    expect(request).not.toHaveBeenCalled();
    expect(host.chatMessage).toBe("/btw wait until resumed");
    expect(host.chatError).toBe("Chat is paused; resume it before sending a detached message.");
  });

  it("sends /side through the detached BTW path", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return {};
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatRunId: "run-main",
      chatStream: "Working...",
      chatMessage: "/side what changed?",
    });

    await handleSendChat(host);

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    expect(payload.message).toBe("/side what changed?");
    expect(payload.deliver).toBe(false);
    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatRunId).toBe("run-main");
  });

  it("sends /btw without adopting a main chat run when idle", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return {};
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "/btw summarize this",
    });

    await handleSendChat(host);

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "chat send payload",
    );
    expect(payload.message).toBe("/btw summarize this");
    expect(payload.deliver).toBe(false);
    expect(host.chatRunId).toBeNull();
    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatMessage).toBe("");
    expect(navigateChatInputHistory(host, "up")).toBe(true);
    expect(host.chatMessage).toBe("/btw summarize this");
  });

  it("keeps queued normal messages recallable before transcript history catches up", async () => {
    const host = makeHost({
      chatMessage: "queued while busy",
      chatRunId: "run-1",
    });

    await handleSendChat(host);

    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.text).toBe("queued while busy");
    expect(host.chatMessage).toBe("");
    expect(navigateChatInputHistory(host, "up")).toBe(true);
    expect(host.chatMessage).toBe("queued while busy");
  });

  it("persists busy sends on the Gateway and switches queue to steer by revision", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      const payload = requireRecord(params, `${method} payload`);
      if (method === "chat.turns.create") {
        expect(payload).toMatchObject({
          sessionKey: "agent:main",
          message: "change the active work",
          mode: "queue",
        });
        return {
          turn: {
            id: "turn-1",
            sessionKey: "agent:main",
            revision: 1,
            mode: "queue",
            phase: "pending",
            message: "change the active work",
            attachmentCount: 0,
            admissionOpen: true,
            runId: "dispatch-1",
            activitySummary: "Message acknowledged.",
            lastActivityAt: 100,
            createdAt: 100,
            updatedAt: 100,
          },
        };
      }
      if (method === "chat.turns.setMode") {
        expect(payload).toMatchObject({
          turnId: "turn-1",
          sessionKey: "agent:main",
          expectedRevision: 1,
          mode: "steer",
        });
        return {
          found: true,
          applied: true,
          turn: {
            id: "turn-1",
            sessionKey: "agent:main",
            revision: 2,
            mode: "steer",
            phase: "pending",
            message: "change the active work",
            attachmentCount: 0,
            admissionOpen: true,
            runId: "dispatch-1",
            activitySummary: "Steer acknowledged.",
            lastActivityAt: 110,
            createdAt: 100,
            updatedAt: 110,
          },
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "change the active work",
      chatRunId: "active-1",
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
        features: {
          events: ["taskFlow"],
          methods: ["chat.turns.create", "chat.turns.setMode", "chat.turns.list"],
        },
      },
    });

    await handleSendChat(host);

    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        id: "turn-1",
        serverTurnId: "turn-1",
        serverRevision: 1,
        serverAdmissionOpen: true,
        kind: "queued",
      }),
    ]);

    await steerQueuedChatMessage(host, "turn-1");

    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        id: "turn-1",
        serverRevision: 2,
        kind: "steered",
      }),
    ]);
  });

  it("keeps durable Gateway turns running while pausing new messages", async () => {
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueue: [
        {
          id: "turn-1",
          text: "keep this queued",
          createdAt: 1,
          sessionKey: "agent:main",
          kind: "queued",
          serverTurnId: "turn-1",
          serverRevision: 1,
          serverPhase: "pending",
          serverAdmissionOpen: true,
        },
      ],
    });

    expect(await setChatQueuePaused(host, true)).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueuePaused).toBe(true);
    expect(host.chatQueue[0]).toMatchObject({
      id: "turn-1",
      text: "keep this queued",
      kind: "queued",
      serverTurnId: "turn-1",
      serverPhase: "pending",
    });
  });

  it("pauses without touching restored server-turn attachments", async () => {
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueue: [
        {
          id: "turn-with-file",
          text: "keep the file attached",
          createdAt: 1,
          sessionKey: "agent:main",
          kind: "queued",
          serverTurnId: "turn-with-file",
          serverRevision: 1,
          serverPhase: "pending",
          serverAdmissionOpen: true,
          serverAttachmentCount: 1,
        },
      ],
    });

    expect(await setChatQueuePaused(host, true)).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueuePaused).toBe(true);
    expect(host.chatQueue[0]).toMatchObject({
      id: "turn-with-file",
      serverTurnId: "turn-with-file",
      serverAttachmentCount: 1,
    });
    expect(host.chatError).toBeUndefined();
  });

  it("does not retry a durable turn while the queue is paused", async () => {
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueuePaused: true,
      chatQueuePausedBySession: { "agent:main": true },
      chatQueue: [
        {
          id: "turn-paused",
          text: "do not retry this yet",
          createdAt: 1,
          sessionKey: "agent:main",
          kind: "queued",
          serverTurnId: "turn-paused",
          serverRevision: 2,
          serverPhase: "pending",
          serverAdmissionOpen: true,
        },
      ],
    });

    await retryQueuedChatMessage(host, "turn-paused");

    expect(request).not.toHaveBeenCalled();
    expect(host.chatError).toContain("Queue is paused");
  });

  it("flushes local queued messages when resuming an idle paused queue", async () => {
    const request = vi.fn(async (method: string) => {
      expect(method).toBe("chat.send");
      return { runId: "resumed-run", status: "ok" };
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueuePaused: true,
      chatQueuePausedBySession: { "agent:main": true },
      chatQueue: [
        {
          id: "paused-local",
          text: "send this after resume",
          createdAt: 1,
          sessionKey: "agent:main",
          kind: "queued",
        },
      ],
    });

    expect(await setChatQueuePaused(host, false)).toBe(false);
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "chat.send",
        expect.objectContaining({ message: "send this after resume" }),
      ),
    );
    expect(host.chatQueue).toEqual([]);
  });

  it("flushes resumed local messages through the durable turn inbox", async () => {
    const request = vi.fn(async (method: string) => {
      expect(method).toBe("chat.turns.create");
      return {
        turn: {
          id: "turn-resumed",
          sessionKey: "agent:main",
          revision: 1,
          mode: "queue",
          phase: "pending",
          message: "send this durably after resume",
          attachmentCount: 0,
          admissionOpen: true,
          lastActivityAt: 100,
          createdAt: 100,
          updatedAt: 100,
        },
      };
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueuePaused: true,
      chatQueuePausedBySession: { "agent:main": true },
      chatQueue: [
        {
          id: "paused-durable",
          text: "send this durably after resume",
          createdAt: 1,
          sessionKey: "agent:main",
          kind: "queued",
        },
      ],
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
        features: {
          events: ["taskFlow"],
          methods: ["chat.turns.create", "chat.turns.list"],
        },
      },
    });

    expect(await setChatQueuePaused(host, false)).toBe(false);
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "chat.turns.create",
        expect.objectContaining({
          message: "send this durably after resume",
          mode: "queue",
        }),
      ),
    );
    expect(host.chatQueue).toEqual([
      expect.objectContaining({ id: "turn-resumed", serverTurnId: "turn-resumed" }),
    ]);
  });

  it("blocks new sends while an in-flight Gateway create completes", async () => {
    const create = createDeferred<{
      turn: {
        id: string;
        sessionKey: string;
        revision: number;
        mode: "queue";
        phase: "pending";
        message: string;
        attachmentCount: number;
        admissionOpen: boolean;
        lastActivityAt: number;
        createdAt: number;
        updatedAt: number;
      };
    }>();
    const request = vi.fn(async (method: string) => {
      expect(method).toBe("chat.turns.create");
      return await create.promise;
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "wait for Gateway acknowledgement",
      chatRunId: "active-1",
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
        features: {
          events: ["taskFlow"],
          methods: ["chat.turns.create", "chat.turns.list"],
        },
      },
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    const pause = setChatQueuePaused(host, true);
    await Promise.resolve();
    expect(host.chatQueuePaused).toBe(true);
    expect(host.chatQueuePausePendingBySession?.["agent:main"]).toBe(true);

    host.chatMessage = "must wait";
    await handleSendChat(host);

    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.text).toBe("wait for Gateway acknowledgement");
    expect(request).toHaveBeenCalledTimes(1);

    create.resolve({
      turn: {
        id: "turn-created-before-pause",
        sessionKey: "agent:main",
        revision: 1,
        mode: "queue",
        phase: "pending",
        message: "wait for Gateway acknowledgement",
        attachmentCount: 0,
        admissionOpen: true,
        lastActivityAt: 100,
        createdAt: 100,
        updatedAt: 100,
      },
    });
    await send;
    expect(await pause).toBe(true);
    expect(host.chatQueuePausePendingBySession?.["agent:main"]).toBeUndefined();
    expect(host.chatQueue[0]?.serverTurnId).toBe("turn-created-before-pause");
  });

  it("clears a speculative pause when its Gateway changes before persistence", async () => {
    const create = createDeferred<boolean>();
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueueCreateTransitionsBySession: {
        "agent:main": new Set([create.promise]),
      },
    });

    const pause = setChatQueuePaused(host, true);
    await Promise.resolve();
    expect(host.chatQueuePaused).toBe(true);

    host.client = { request } as unknown as ChatHost["client"];
    host.chatQueueGatewayGeneration = 1;
    create.resolve(false);

    expect(await pause).toBe(false);
    expect(host.chatQueuePaused).toBe(false);
    expect(host.chatQueuePausedBySession?.["agent:main"]).toBe(false);
    expect(host.chatQueuePausePendingBySession?.["agent:main"]).toBeUndefined();
  });

  it("keeps a turn created before pause durable", async () => {
    const create = createDeferred<{
      turn: {
        id: string;
        sessionKey: string;
        revision: number;
        mode: "queue";
        phase: "pending";
        message: string;
        attachmentCount: number;
        admissionOpen: boolean;
        lastActivityAt: number;
        createdAt: number;
        updatedAt: number;
      };
    }>();
    const request = vi.fn(async (method: string) => {
      if (method === "chat.turns.create") {
        return await create.promise;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "continue if pause wins",
      chatRunId: "active-1",
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
        features: {
          events: ["taskFlow"],
          methods: ["chat.turns.create", "chat.turns.list"],
        },
      },
    });

    const send = handleSendChat(host);
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("chat.turns.create", expect.any(Object));

    const pause = setChatQueuePaused(host, true);
    await Promise.resolve();
    expect(host.chatQueuePaused).toBe(true);
    expect(host.chatQueuePausePendingBySession?.["agent:main"]).toBe(true);

    create.resolve({
      turn: {
        id: "turn-created-during-pause",
        sessionKey: "agent:main",
        revision: 1,
        mode: "queue",
        phase: "pending",
        message: "continue if pause wins",
        attachmentCount: 0,
        admissionOpen: true,
        lastActivityAt: 100,
        createdAt: 100,
        updatedAt: 100,
      },
    });

    await send;
    expect(await pause).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(host.chatQueue[0]?.serverTurnId).toBe("turn-created-during-pause");
    expect(host.chatQueue[0]?.text).toBe("continue if pause wins");
  });

  it("refuses to pause when local queued messages cannot be persisted", async () => {
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueue: Array.from({ length: 51 }, (_, index) => ({
        id: `turn-${index}`,
        text: `keep queued ${index}`,
        createdAt: index,
        sessionKey: "agent:main",
        kind: "queued" as const,
      })),
    });

    expect(await setChatQueuePaused(host, true)).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueuePaused ?? false).toBe(false);
    expect(host.chatError).toContain("could not save the queue state");
  });

  it("clears the pause latch when its final browser-state commit fails", async () => {
    const storage = createStorageMock();
    storage.setItem = () => {
      throw new Error("storage quota changed");
    };
    vi.stubGlobal("sessionStorage", storage);
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueue: [
        {
          id: "local-commit-failure",
          text: "keep this queued",
          createdAt: 1,
          sessionKey: "agent:main",
          kind: "queued",
        },
      ],
    });

    expect(await setChatQueuePaused(host, true)).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueuePaused).toBe(false);
    expect(host.chatQueuePausedBySession?.["agent:main"]).toBe(false);
    expect(host.chatError).toContain("could not save the queue state");
    expect(host.chatQueuePausePendingBySession?.["agent:main"]).toBeUndefined();
  });

  it("pauses without detaching a turn that has already started", async () => {
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueue: [
        {
          id: "turn-running",
          text: "already admitted",
          createdAt: 1,
          sessionKey: "agent:main",
          kind: "queued",
          serverTurnId: "turn-running",
          serverRevision: 2,
          serverPhase: "admitted",
          serverAdmissionOpen: false,
        },
      ],
    });

    expect(await setChatQueuePaused(host, true)).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueuePaused).toBe(true);
    expect(host.chatQueue[0]).toMatchObject({
      id: "turn-running",
      serverTurnId: "turn-running",
      serverPhase: "admitted",
    });
  });

  it("removes a missing server turn during refresh instead of replaying it locally", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.turns.list") {
        return { turns: [] };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
        features: {
          events: [],
          methods: ["chat.turns.list"],
        },
      },
      chatQueue: [
        {
          id: "turn-missing",
          text: "do not replay this",
          createdAt: 1,
          sessionKey: "agent:main",
          kind: "queued",
          serverTurnId: "turn-missing",
          serverRevision: 1,
          serverPhase: "pending",
          serverAdmissionOpen: true,
        },
      ],
    });

    await loadServerChatTurns(host, "agent:main");

    expect(request).toHaveBeenCalledWith("chat.turns.list", {
      sessionKey: "agent:main",
      includeTerminal: true,
    });
    expect(host.chatQueuePaused).toBeUndefined();
    expect(host.chatQueue).toEqual([]);
    expect(host.chatError).toBeUndefined();
  });

  it("keeps restored pause state while refreshing durable Gateway turns", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.turns.list") {
        return {
          turns: [
            {
              id: "turn-still-pending",
              sessionKey: "agent:main",
              revision: 1,
              mode: "queue",
              phase: "pending",
              message: "do not run while paused",
              attachmentCount: 0,
              admissionOpen: true,
              lastActivityAt: 100,
              createdAt: 100,
              updatedAt: 100,
            },
          ],
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueuePaused: true,
      chatQueuePausedBySession: { "agent:main": true },
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
        features: {
          events: [],
          methods: ["chat.turns.list"],
        },
      },
    });

    await loadServerChatTurns(host, "agent:main");

    expect(host.chatQueuePaused).toBe(true);
    expect(host.chatQueuePausedBySession?.["agent:main"]).toBe(true);
    expect(host.chatQueue[0]).toMatchObject({
      serverTurnId: "turn-still-pending",
      serverPhase: "pending",
    });
    expect(host.chatError).toBeUndefined();
  });

  it("refreshes and retries a queue mutation once after a revision conflict", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        found: true,
        applied: false,
        reason: "revision_conflict",
      })
      .mockResolvedValueOnce({
        turns: [
          {
            id: "turn-1",
            sessionKey: "agent:main",
            revision: 2,
            mode: "queue",
            phase: "pending",
            message: "change the active work",
            attachmentCount: 0,
            admissionOpen: true,
            lastActivityAt: 110,
            createdAt: 100,
            updatedAt: 110,
          },
        ],
      })
      .mockResolvedValueOnce({
        found: true,
        applied: true,
        turn: {
          id: "turn-1",
          sessionKey: "agent:main",
          revision: 3,
          mode: "steer",
          phase: "pending",
          message: "change the active work",
          attachmentCount: 0,
          admissionOpen: true,
          lastActivityAt: 120,
          createdAt: 100,
          updatedAt: 120,
        },
      });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatRunId: "active-1",
      chatQueue: [
        {
          id: "turn-1",
          text: "change the active work",
          createdAt: 100,
          sessionKey: "agent:main",
          serverTurnId: "turn-1",
          serverRevision: 1,
          serverPhase: "pending",
          serverAdmissionOpen: true,
        },
      ],
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
        features: {
          events: ["taskFlow"],
          methods: ["chat.turns.list", "chat.turns.setMode"],
        },
      },
    });

    await steerQueuedChatMessage(host, "turn-1");

    expect(request).toHaveBeenNthCalledWith(
      1,
      "chat.turns.setMode",
      expect.objectContaining({ expectedRevision: 1 }),
    );
    expect(request).toHaveBeenNthCalledWith(2, "chat.turns.list", {
      sessionKey: "agent:main",
      includeTerminal: true,
    });
    expect(request).toHaveBeenNthCalledWith(
      3,
      "chat.turns.setMode",
      expect.objectContaining({ expectedRevision: 2 }),
    );
    const firstArgs = request.mock.calls[0]?.[1];
    const retryArgs = request.mock.calls[2]?.[1];
    expect(firstArgs).toBeDefined();
    expect(retryArgs).toBeDefined();
    const firstKey = (firstArgs as { idempotencyKey?: string }).idempotencyKey;
    const retryKey = (retryArgs as { idempotencyKey?: string }).idempotencyKey;
    expect(retryKey).toBe(firstKey);
    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        serverTurnId: "turn-1",
        serverRevision: 3,
        kind: "steered",
        sendError: undefined,
      }),
    ]);
  });

  it("keeps a queue creation failure on the queue item instead of duplicating a sticky alert", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary gateway failure"))
      .mockResolvedValueOnce({
        turn: {
          id: "turn-retried",
          sessionKey: "agent:main",
          revision: 1,
          mode: "queue",
          phase: "pending",
          message: "queue this",
          attachmentCount: 0,
          admissionOpen: true,
          lastActivityAt: 200,
          createdAt: 200,
          updatedAt: 200,
        },
      });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "queue this",
      chatRunId: "active-1",
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
        features: {
          events: ["taskFlow"],
          methods: ["chat.turns.create", "chat.turns.list"],
        },
      },
    });

    await handleSendChat(host);

    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        text: "queue this",
        sendState: "failed",
        sendError: expect.stringContaining("temporary gateway failure"),
      }),
    ]);
    expect(host.lastError).toBeNull();
    expect(host.chatError).toBeUndefined();

    await retryQueuedChatMessage(host, host.chatQueue[0]!.id);

    expect(request).toHaveBeenNthCalledWith(
      2,
      "chat.turns.create",
      expect.objectContaining({ message: "queue this", mode: "queue" }),
    );
    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        id: "turn-retried",
        serverTurnId: "turn-retried",
        serverPhase: "pending",
      }),
    ]);
    expect(host.chatQueue[0]?.sendError).toBeUndefined();
  });

  it("preserves steer mode when retrying a failed durable queue creation", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary gateway failure"))
      .mockResolvedValueOnce({
        turn: {
          id: "turn-steered",
          sessionKey: "agent:main",
          revision: 1,
          mode: "steer",
          phase: "pending",
          message: "change the active work",
          attachmentCount: 0,
          admissionOpen: true,
          lastActivityAt: 200,
          createdAt: 200,
          updatedAt: 200,
        },
      });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "change the active work",
      chatRunId: "active-1",
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
        features: {
          events: ["taskFlow"],
          methods: ["chat.turns.create", "chat.turns.list"],
        },
      },
    });

    await handleSendChat(host, undefined, { turnMode: "steer" });

    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        kind: "steered",
        sendState: "failed",
      }),
    ]);

    await retryQueuedChatMessage(host, host.chatQueue[0]!.id);

    expect(request).toHaveBeenNthCalledWith(
      2,
      "chat.turns.create",
      expect.objectContaining({ message: "change the active work", mode: "steer" }),
    );
    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        id: "turn-steered",
        kind: "steered",
        serverTurnId: "turn-steered",
      }),
    ]);
  });

  it("persists an idle normal send before dispatch instead of bypassing the server inbox", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method !== "chat.turns.create") {
        throw new Error(`Unexpected request: ${method}`);
      }
      const payload = requireRecord(params, "chat.turns.create payload");
      expect(payload).toMatchObject({
        sessionKey: "agent:main",
        message: "acknowledge this immediately",
        mode: "queue",
      });
      return {
        turn: {
          id: "turn-idle-1",
          sessionKey: "agent:main",
          revision: 1,
          mode: "queue",
          phase: "pending",
          message: "acknowledge this immediately",
          attachmentCount: 0,
          admissionOpen: true,
          runId: "dispatch-idle-1",
          activitySummary: "Message acknowledged.",
          lastActivityAt: 100,
          createdAt: 100,
          updatedAt: 100,
        },
      };
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "acknowledge this immediately",
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
        features: {
          events: ["taskFlow"],
          methods: ["chat.turns.create", "chat.turns.list"],
        },
      },
    });

    await handleSendChat(host);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("chat.turns.create", expect.any(Object));
    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        id: "turn-idle-1",
        serverTurnId: "turn-idle-1",
        serverPhase: "pending",
        serverActivitySummary: "Message acknowledged.",
      }),
    ]);
    expect(host.chatMessages).toStrictEqual([]);
  });

  it("coalesces duplicate in-flight chat submits before the gateway acknowledges them", async () => {
    const sent = createDeferred<unknown>();
    const request = vi.fn((method: string) => {
      if (method === "chat.send") {
        return sent.promise;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
    });

    const first = handleSendChat(host, "same prompt");
    const second = handleSendChat(host, "same prompt");

    expect(request).toHaveBeenCalledTimes(1);
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.text).toBe("same prompt");
    expect(host.chatQueue[0]?.sendState).toBe("sending");
    expect(host.chatMessages).toStrictEqual([]);

    const queuedRunId = host.chatQueue[0]?.sendRunId;
    sent.resolve({ runId: queuedRunId, status: "started" });
    await Promise.all([first, second]);

    expect(request).toHaveBeenCalledTimes(1);
    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatMessages).toHaveLength(1);
  });

  it("keeps normal prompt text visible as pending until chat.send is acknowledged", async () => {
    const sent = createDeferred<unknown>();
    const request = vi.fn((method: string) => {
      if (method === "chat.send") {
        return sent.promise;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "do not lose this",
    });

    const send = handleSendChat(host);
    await Promise.resolve();

    expect(host.chatMessage).toBe("");
    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]).toMatchObject({
      text: "do not lose this",
      sendState: "sending",
      sessionKey: "agent:main",
    });
    const runId = host.chatQueue[0]?.sendRunId;
    expect(typeof runId).toBe("string");

    sent.resolve({ runId, status: "started" });
    await send;

    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatRunId).toBe(runId);
    expect(host.chatMessages).toHaveLength(1);
    const userMessage = requireRecord(host.chatMessages[0], "user message");
    expect(userMessage.role).toBe("user");
  });

  it("rejects a paused send when browser storage cannot durably save it", async () => {
    const storage = createStorageMock();
    storage.setItem = () => {
      throw new Error("storage quota changed");
    };
    vi.stubGlobal("sessionStorage", storage);
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "do not lose this paused prompt",
      chatQueuePaused: true,
      chatQueuePausedBySession: { "agent:main": true },
    });

    await handleSendChat(host);

    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatMessage).toBe("do not lose this paused prompt");
    expect(host.chatError).toContain("Could not queue this message safely");
  });

  it("rejects a paused local slash command when browser storage cannot durably save it", async () => {
    const storage = createStorageMock();
    storage.setItem = () => {
      throw new Error("storage quota changed");
    };
    vi.stubGlobal("sessionStorage", storage);
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "/compact",
      chatQueuePaused: true,
      chatQueuePausedBySession: { "agent:main": true },
      chatRunId: "active-run",
    });

    await handleSendChat(host);

    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatMessage).toBe("/compact");
    expect(host.chatError).toContain("Could not queue this message safely");
  });

  it("queues a local slash command from an idle paused chat", async () => {
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "/compact",
      chatQueuePaused: true,
      chatQueuePausedBySession: { "agent:main": true },
    });

    await handleSendChat(host);

    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]).toMatchObject({
      text: "/compact",
      localCommandName: "compact",
    });
  });

  it("does not send while a Gateway switch has persistence suspended", async () => {
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "wait for the new Gateway",
      chatComposerPersistenceSuspended: true,
    });

    await handleSendChat(host);

    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatMessage).toBe("wait for the new Gateway");
    expect(host.chatError).toBe(
      "Chat is reconnecting to the Gateway; wait for it to finish before sending.",
    );
  });

  it.each([
    { label: "goal", options: { flowId: "goal-1" } },
    { label: "steer", options: { turnMode: "steer" as const } },
  ])("does not queue a paused $label send without preserving its routing", async ({ options }) => {
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "preserve this routing",
      chatQueuePaused: true,
    });

    await handleSendChat(host, undefined, options);

    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatMessage).toBe("preserve this routing");
    expect(host.chatError).toBe(
      "Resume Chat before sending a goal or steer message so its routing is preserved.",
    );
  });

  it("does not persist a queue pause while a Gateway switch has persistence suspended", async () => {
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatComposerPersistenceSuspended: true,
    });

    expect(await setChatQueuePaused(host, true)).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueuePaused ?? false).toBe(false);
    expect(host.chatError).toBe(
      "Chat is reconnecting to the Gateway; wait for it to finish before pausing.",
    );
  });

  it("routes queued Skill Workshop revisions through the proposal request RPC", async () => {
    const sent = createDeferred<unknown>();
    const request = vi.fn((method: string) => {
      if (method === "skills.proposals.requestRevision") {
        return sent.promise;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "keep my draft",
    });
    (host as ChatHost & { currentSessionId?: string }).currentSessionId = "session-current";

    const send = handleSendChat(host, "Make the support files 5", {
      restoreDraft: true,
      skillWorkshopRevision: {
        proposalId: "support-file-sampler-20260531-68207b7b7f",
        agentId: "proposal-owner",
      },
    });
    await Promise.resolve();

    expect(host.chatQueue[0]).toMatchObject({
      text: "Make the support files 5",
      skillWorkshopRevision: {
        proposalId: "support-file-sampler-20260531-68207b7b7f",
        agentId: "proposal-owner",
      },
    });
    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "skills.proposals.requestRevision",
      "revision request payload",
    );
    expect(payload).toMatchObject({
      agentId: "proposal-owner",
      proposalId: "support-file-sampler-20260531-68207b7b7f",
      instructions: "Make the support files 5",
      sessionKey: "agent:main",
      sessionId: "session-current",
    });
    expect(payload).not.toHaveProperty("message");
    expect(payload).not.toHaveProperty("targetAgentId");

    sent.resolve({ runId: host.chatQueue[0]?.sendRunId, status: "started" });
    await send;

    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatMessages).toHaveLength(1);
    const userMessage = requireRecord(host.chatMessages[0], "user message");
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toEqual([{ type: "text", text: "Make the support files 5" }]);
  });

  it("retries failed Skill Workshop revisions through the proposal request RPC", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "skills.proposals.requestRevision") {
        return { runId: "revision-retry", status: "started" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatQueue: [
        {
          id: "revision-queue-item",
          text: "Add one more example",
          createdAt: 1,
          sendRunId: "revision-retry",
          sendState: "failed",
          sessionKey: "agent:main",
          skillWorkshopRevision: {
            proposalId: "support-file-sampler-20260531-68207b7b7f",
            agentId: "proposal-owner",
          },
        },
      ],
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
        features: {
          events: [],
          methods: ["chat.turns.create", "chat.turns.list"],
        },
      },
    });

    await retryQueuedChatMessage(host, "revision-queue-item");

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "skills.proposals.requestRevision",
      expect.objectContaining({
        proposalId: "support-file-sampler-20260531-68207b7b7f",
        agentId: "proposal-owner",
        instructions: "Add one more example",
        sessionKey: "agent:main",
      }),
    );
    expect(request).not.toHaveBeenCalledWith("chat.turns.create", expect.anything());
    expect(host.chatQueue).toStrictEqual([]);
  });

  it("treats slash-like Skill Workshop revision drafts as revision instructions", async () => {
    const sent = createDeferred<unknown>();
    const request = vi.fn((method: string) => {
      if (method === "skills.proposals.requestRevision") {
        return sent.promise;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
    });

    const send = handleSendChat(host, "/reset examples", {
      restoreDraft: true,
      skillWorkshopRevision: {
        proposalId: "support-file-sampler-20260531-68207b7b7f",
      },
    });
    await Promise.resolve();

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "skills.proposals.requestRevision",
      "revision slash payload",
    );
    expect(payload).toMatchObject({
      proposalId: "support-file-sampler-20260531-68207b7b7f",
      instructions: "/reset examples",
      sessionKey: "agent:main",
    });
    expect(payload).not.toHaveProperty("message");
    expect(host.chatQueue[0]).toMatchObject({
      refreshSessions: false,
      text: "/reset examples",
      skillWorkshopRevision: {
        proposalId: "support-file-sampler-20260531-68207b7b7f",
      },
    });

    sent.resolve({ runId: host.chatQueue[0]?.sendRunId, status: "started" });
    await send;

    expect(host.chatMessages[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "/reset examples" }],
    });
  });

  it("keeps ACK-completed sends idle when sessions.list returns a stale active row", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "chat.send") {
        const payload = requireRecord(params, "chat send payload");
        return { runId: payload.idempotencyKey, status: "ok" };
      }
      if (method === "chat.history") {
        return { messages: [] };
      }
      if (method === "sessions.list") {
        return createSessionsResult([
          row("agent:main", { hasActiveRun: true, status: "running", startedAt: 1 }),
        ]);
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "already done",
      sessionsResult: createSessionsResult([
        row("agent:main", { hasActiveRun: true, status: "running", startedAt: 1 }),
      ]),
    });

    await handleSendChat(host);
    await Promise.resolve();
    await loadSessions(host as unknown as Parameters<typeof loadSessions>[0]);

    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
    expect(hasAbortableSessionRun(host)).toBe(false);
    expect(host.sessionsResult?.sessions[0]).toMatchObject({
      hasActiveRun: false,
      status: "done",
    });
  });

  it("keeps delayed chat.send ACK effects scoped to the submitted session", async () => {
    const sent = createDeferred<unknown>();
    const request = vi.fn((method: string) => {
      if (method === "chat.send") {
        return sent.promise;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "stay with session A",
      sessionKey: "agent:a",
    });

    const send = handleSendChat(host);
    await Promise.resolve();

    const queuedRunId = host.chatQueue[0]?.sendRunId;
    expect(queuedRunId).toEqual(expect.any(String));

    host.chatQueueBySession = { "agent:a": [...host.chatQueue] };
    host.chatQueue = [];
    host.sessionKey = "agent:b";
    host.chatMessages = [];
    host.chatRunId = null;
    host.chatStream = null;

    sent.resolve({ runId: queuedRunId, status: "started" });
    await send;

    expect(host.sessionKey).toBe("agent:b");
    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatQueueBySession?.["agent:a"]).toBeUndefined();
  });

  it("ignores a delayed ACK from a replaced Gateway client", async () => {
    const sent = createDeferred<unknown>();
    const clientA = {
      request: vi.fn(() => sent.promise),
    };
    const clientB = { request: vi.fn() };
    const host = makeHost({
      client: clientA as unknown as ChatHost["client"],
      chatQueueGatewayGeneration: 1,
      chatMessage: "stay with Gateway A",
    });

    const send = handleSendChat(host, "stay with Gateway A");
    await Promise.resolve();
    expect(host.chatQueue[0]?.sendState).toBe("sending");

    host.client = clientB as unknown as ChatHost["client"];
    host.chatQueueGatewayGeneration = 2;
    host.chatSending = true;
    sent.resolve({ runId: host.chatQueue[0]?.sendRunId, status: "started" });
    await send;

    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatRunId).toBeNull();
    expect(host.chatSending).toBe(false);
    expect(host.chatQueue[0]?.sendState).toBe("waiting-reconnect");
  });

  it("ignores a delayed durable-turn result from a replaced client", async () => {
    const create = createDeferred<{
      turn: {
        id: string;
        sessionKey: string;
        revision: number;
        mode: "queue";
        phase: "pending";
        message: string;
        attachmentCount: number;
        admissionOpen: boolean;
        lastActivityAt: number;
        createdAt: number;
        updatedAt: number;
      };
    }>();
    const clientA = { request: vi.fn(() => create.promise) };
    const clientB = { request: vi.fn() };
    const host = makeHost({
      client: clientA as unknown as ChatHost["client"],
      chatQueueGatewayGeneration: 7,
      chatMessage: "do not duplicate this turn",
      chatRunId: "active-1",
      hello: {
        type: "hello-ok",
        protocol: 4,
        auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
        features: { methods: ["chat.turns.create", "chat.turns.list"] },
      },
    });

    const send = handleSendChat(host);
    await vi.waitFor(() =>
      expect(clientA.request).toHaveBeenCalledWith("chat.turns.create", expect.any(Object)),
    );

    host.client = clientB as unknown as ChatHost["client"];
    // The regression is specifically a client replacement without a generation bump.
    create.resolve({
      turn: {
        id: "stale-turn",
        sessionKey: "agent:main",
        revision: 1,
        mode: "queue",
        phase: "pending",
        message: "do not duplicate this turn",
        attachmentCount: 0,
        admissionOpen: true,
        lastActivityAt: 100,
        createdAt: 100,
        updatedAt: 100,
      },
    });
    await send;

    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.text).toBe("do not duplicate this turn");
    expect(host.chatQueue[0]?.serverTurnId).toBeUndefined();
    expect(clientB.request).not.toHaveBeenCalled();
  });

  it("keeps a detached message recoverable when its Gateway changes before the ACK", async () => {
    const sent = createDeferred<unknown>();
    let requestId: string | undefined;
    const clientA = {
      request: vi.fn((_method: string, payload: unknown) => {
        requestId = (payload as { idempotencyKey?: string }).idempotencyKey;
        return sent.promise;
      }),
    };
    const clientB = { request: vi.fn() };
    const host = makeHost({
      client: clientA as unknown as ChatHost["client"],
      chatQueueGatewayGeneration: 1,
      chatRunId: "run-main",
      chatStream: "Working...",
      chatMessage: "/btw preserve this message",
      settings: { gatewayUrl: "ws://gateway.test", token: "bootstrap-token" },
      hello: { auth: { deviceToken: "device-a" } } as unknown as ChatHost["hello"],
    });

    const send = handleSendChat(host);
    await vi.waitFor(() => expect(clientA.request).toHaveBeenCalled());

    expect(requestId).toEqual(expect.any(String));

    host.client = clientB as unknown as ChatHost["client"];
    host.chatQueueGatewayGeneration = 2;
    host.hello = { auth: { deviceToken: "device-b" } } as unknown as ChatHost["hello"];
    sent.resolve({ runId: "detached-run", status: "started" });
    await send;

    expect(host.chatQueue).toStrictEqual([]);
    expect(
      loadChatComposerSnapshot(
        { ...host, hello: { auth: { deviceToken: "device-a" } } } as unknown as ChatHost,
        "agent:main",
      )?.queue,
    ).toHaveLength(1);
    expect(
      loadChatComposerSnapshot(
        { ...host, hello: { auth: { deviceToken: "device-a" } } } as unknown as ChatHost,
        "agent:main",
      )?.queue[0],
    ).toMatchObject({
      sendState: "waiting-reconnect",
      sendRunId: requestId,
    });
    expect(
      loadChatComposerSnapshot(
        { ...host, hello: { auth: { deviceToken: "device-b" } } } as unknown as ChatHost,
        "agent:main",
      ),
    ).toBeNull();
    expect(host.chatDetachedSendRecoveries).toHaveLength(1);
    expect(host.chatDetachedSendRecoveries?.[0]?.queue[0]).toMatchObject({
      sendState: "waiting-reconnect",
      sendRunId: requestId,
    });
  });

  it("merges a late detached recovery after reconnecting to the same principal", async () => {
    const sent = createDeferred<{ status: "started" }>();
    const clientA = { request: vi.fn(() => sent.promise) };
    const clientB = { request: vi.fn() };
    const host = makeHost({
      client: clientA as unknown as ChatHost["client"],
      chatQueueGatewayGeneration: 1,
      chatRunId: "run-main",
      chatMessage: "/btw show this after reconnect",
      settings: { gatewayUrl: "ws://gateway.test", token: "bootstrap-token" },
      hello: { auth: { deviceToken: "device-a" } } as unknown as ChatHost["hello"],
    });

    const send = handleSendChat(host);
    await vi.waitFor(() => expect(clientA.request).toHaveBeenCalled());

    host.client = clientB as unknown as ChatHost["client"];
    host.chatQueueGatewayGeneration = 2;
    host.hello = { auth: { deviceToken: "device-a" } } as unknown as ChatHost["hello"];
    sent.resolve({ status: "started" });
    await send;

    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]).toMatchObject({
      text: "/btw show this after reconnect",
      sendState: "waiting-reconnect",
    });
  });

  it("keeps detached recovery in an old-Gateway buffer when storage fails", async () => {
    const storage = createStorageMock();
    storage.setItem = () => {
      throw new Error("storage quota changed");
    };
    vi.stubGlobal("sessionStorage", storage);
    const sent = createDeferred<unknown>();
    const clientA = { request: vi.fn(() => sent.promise) };
    const clientB = { request: vi.fn() };
    const host = makeHost({
      client: clientA as unknown as ChatHost["client"],
      chatQueueGatewayGeneration: 1,
      chatRunId: "run-main",
      chatMessage: "/btw keep this if storage fails",
      settings: { gatewayUrl: "ws://gateway.test", token: "bootstrap-token" },
      hello: { auth: { deviceToken: "device-a" } } as unknown as ChatHost["hello"],
    });

    const send = handleSendChat(host);
    await vi.waitFor(() => expect(clientA.request).toHaveBeenCalled());

    host.client = clientB as unknown as ChatHost["client"];
    host.chatQueueGatewayGeneration = 2;
    host.hello = { auth: { deviceToken: "device-b" } } as unknown as ChatHost["hello"];
    sent.resolve({ runId: "detached-run", status: "started" });
    await send;

    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatDetachedSendRecoveries).toHaveLength(1);
    expect(host.chatDetachedSendRecoveries?.[0]?.queue[0]?.text).toBe(
      "/btw keep this if storage fails",
    );
    expect(host.chatDetachedSendRecoveries?.[0]?.queue[0]).toMatchObject({
      sendState: "waiting-reconnect",
      sendRunId: expect.any(String),
    });
    expect(host.chatError).toContain("Browser storage was unavailable");
  });

  it("preserves multiple detached recoveries when storage fails", async () => {
    const storage = createStorageMock();
    storage.setItem = () => {
      throw new Error("storage quota changed");
    };
    vi.stubGlobal("sessionStorage", storage);
    const first = createDeferred<{ status: "started" }>();
    const second = createDeferred<{ status: "started" }>();
    let requestCount = 0;
    const clientA = {
      request: vi.fn(() => {
        requestCount += 1;
        return requestCount === 1 ? first.promise : second.promise;
      }),
    };
    const clientB = { request: vi.fn() };
    const host = makeHost({
      client: clientA as unknown as ChatHost["client"],
      chatQueueGatewayGeneration: 1,
      settings: { gatewayUrl: "ws://gateway.test", token: "bootstrap-token" },
      hello: { auth: { deviceToken: "device-a" } } as unknown as ChatHost["hello"],
    });

    const sendOne = handleSendChat(host, "/btw first detached message");
    const sendTwo = handleSendChat(host, "/btw second detached message");
    await vi.waitFor(() => expect(clientA.request).toHaveBeenCalledTimes(2));

    host.client = clientB as unknown as ChatHost["client"];
    host.chatQueueGatewayGeneration = 2;
    host.hello = { auth: { deviceToken: "device-b" } } as unknown as ChatHost["hello"];
    first.resolve({ status: "started" });
    await sendOne;
    second.resolve({ status: "started" });
    await sendTwo;

    expect(host.chatDetachedSendRecoveries).toHaveLength(1);
    expect(host.chatDetachedSendRecoveries?.[0]?.queue.map((item) => item.text)).toEqual([
      "/btw first detached message",
      "/btw second detached message",
    ]);
  });

  it("keeps a pre-ack socket close recoverable with the same run id", async () => {
    const request = vi.fn((method: string) => {
      if (method === "chat.send") {
        throw new Error("gateway closed (1006): network lost");
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "retry after reconnect",
    });

    await handleSendChat(host);

    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatQueue).toHaveLength(1);
    const queued = host.chatQueue[0];
    expect(queued?.text).toBe("retry after reconnect");
    expect(queued?.sendState).toBe("waiting-reconnect");
    expect(queued?.sendRunId).toEqual(expect.any(String));
    expect(host.lastError).toBe("Message will send when the Gateway reconnects.");
  });

  it("queues normal sends made while disconnected", async () => {
    const host = makeHost({
      client: null,
      connected: false,
      chatMessage: "send after reconnect",
      eventLogBuffer: [],
      tab: "debug",
    });

    await handleSendChat(host);

    expect(host.chatMessage).toBe("");
    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]).toMatchObject({
      text: "send after reconnect",
      sendState: "waiting-reconnect",
      sessionKey: "agent:main",
    });
    expect(host.chatQueue[0]?.sendRunId).toEqual(expect.any(String));
    expect(eventPayloads(host, "control-ui.chat.send")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "waiting-reconnect",
          sendState: "waiting-reconnect",
        }),
      ]),
    );
  });

  it("replays queued global sends under the originally selected agent", async () => {
    const request = vi.fn((method: string) => {
      if (method === "chat.send") {
        return Promise.resolve({ runId: "run-work", status: "started" });
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: null,
      connected: false,
      sessionKey: "global",
      assistantAgentId: "work",
      agentsList: { defaultId: "main" },
      chatMessage: "send to work later",
    });

    await handleSendChat(host);

    expect(host.chatQueue[0]).toMatchObject({
      text: "send to work later",
      sessionKey: "global",
      agentId: "work",
      sendState: "waiting-reconnect",
    });

    host.assistantAgentId = "main";
    host.client = { request } as unknown as ChatHost["client"];
    host.connected = true;
    await retryReconnectableQueuedChatSends(host);

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "queued global send payload",
    );
    expect(payload.sessionKey).toBe("global");
    expect(payload.agentId).toBe("work");
    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
  });

  it("does not replay a queued send from a paused inactive session", async () => {
    vi.stubGlobal("sessionStorage", createStorageMock());
    persistChatComposerState({
      settings: { gatewayUrl: "ws://gateway.test/control" },
      sessionKey: "agent:main",
      chatMessage: "",
      chatQueue: [],
      chatQueuePaused: true,
    });
    expect(
      loadChatComposerSnapshot(
        { settings: { gatewayUrl: "ws://gateway.test/control" } },
        "agent:main",
      ),
    ).toMatchObject({ queuePaused: true });
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      settings: { gatewayUrl: "ws://gateway.test/control" },
      sessionKey: "agent:other",
      chatQueueBySession: {
        "agent:main": [
          {
            id: "paused-inactive-send",
            text: "do not send yet",
            createdAt: 1,
            sessionKey: "agent:main",
            sendRunId: "run-paused",
            sendState: "waiting-reconnect",
          },
        ],
      },
    });

    await retryReconnectableQueuedChatSends(host);

    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueueBySession?.["agent:main"]?.[0]?.sendState).toBe("waiting-reconnect");
  });

  it("uses the in-memory pause state before browser storage for inactive sessions", async () => {
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "agent:other",
      chatQueuePausedBySession: { "agent:main": true },
      chatQueueBySession: {
        "agent:main": [
          {
            id: "memory-paused-send",
            text: "do not send while inactive",
            createdAt: 1,
            sessionKey: "agent:main",
            sendRunId: "run-memory-paused",
            sendState: "waiting-reconnect",
          },
        ],
      },
    });

    await retryReconnectableQueuedChatSends(host);

    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueueBySession?.["agent:main"]?.[0]?.sendState).toBe("waiting-reconnect");
  });

  it("does not auto-resend legacy error-only queue records", async () => {
    const request = vi.fn(async (method: string) => {
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      connected: true,
      chatQueue: [
        {
          id: "legacy-failed-1",
          text: "retry only after review",
          createdAt: 1,
          sendError: "previous send failed",
        },
      ],
    });

    await retryReconnectableQueuedChatSends(host);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueue[0]).toMatchObject({
      id: "legacy-failed-1",
      sendError: "previous send failed",
    });
    expect(host.chatQueue[0]?.sendState).toBeUndefined();
  });

  it("defers queued global send agent selection until defaults are known", async () => {
    const request = vi.fn((method: string) => {
      if (method === "chat.send") {
        return Promise.resolve({ runId: "run-work", status: "started" });
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: null,
      connected: false,
      sessionKey: "global",
      chatMessage: "send to default later",
    });

    await handleSendChat(host);

    expect(host.chatQueue[0]).toMatchObject({
      text: "send to default later",
      sessionKey: "global",
      sendState: "waiting-reconnect",
    });
    expect(host.chatQueue[0]?.agentId).toBeUndefined();

    host.agentsList = { defaultId: "work" };
    host.client = { request } as unknown as ChatHost["client"];
    host.connected = true;
    await retryReconnectableQueuedChatSends(host);

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "queued global send payload",
    );
    expect(payload.sessionKey).toBe("global");
    expect(payload.agentId).toBe("work");
  });

  it("marks saved session queued sends waiting after a disconnect", () => {
    const host = makeHost({
      chatQueue: [],
      chatQueueBySession: {
        "agent:a": [
          {
            id: "pending-send-a",
            text: "pending",
            createdAt: 1,
            sendRunId: "run-a",
            sendState: "sending",
            sessionKey: "agent:a",
          },
        ],
      },
    });

    markQueuedChatSendsWaitingForReconnect(host);

    expect(host.chatQueueBySession?.["agent:a"]?.[0]).toMatchObject({
      sendRunId: "run-a",
      sendState: "waiting-reconnect",
    });
  });

  it("marks validation failures visible and restores the composer", async () => {
    const request = vi.fn((method: string) => {
      if (method === "chat.send") {
        throw new Error("send blocked by session policy");
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessage: "blocked prompt",
    });

    await handleSendChat(host);

    expect(host.chatMessage).toBe("blocked prompt");
    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]).toMatchObject({
      text: "blocked prompt",
      sendState: "failed",
      sendError: "send blocked by session policy",
    });
  });

  it("restores the BTW draft when detached send fails", async () => {
    const host = makeHost({
      client: {
        request: vi.fn(async (method: string) => {
          if (method === "chat.send") {
            throw new Error("network down");
          }
          throw new Error(`Unexpected request: ${method}`);
        }),
      } as unknown as ChatHost["client"],
      chatRunId: "run-main",
      chatStream: "Working...",
      chatMessage: "/btw what changed?",
    });

    await handleSendChat(host);

    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatRunId).toBe("run-main");
    expect(host.chatStream).toBe("Working...");
    expect(host.chatMessage).toBe("/btw what changed?");
    expect(host.lastError).toBe("network down");
  });

  it("restores the BTW draft when detached send returns a terminal timeout ACK", async () => {
    const host = makeHost({
      client: {
        request: vi.fn(async (method: string) => {
          if (method === "chat.send") {
            return { runId: "btw-terminal", status: "timeout" };
          }
          throw new Error(`Unexpected request: ${method}`);
        }),
      } as unknown as ChatHost["client"],
      chatRunId: "run-main",
      chatStream: "Working...",
      chatMessage: "/btw what changed?",
    });

    await handleSendChat(host);

    expect(host.chatQueue).toStrictEqual([]);
    expect(host.chatRunId).toBe("run-main");
    expect(host.chatStream).toBe("Working...");
    expect(host.chatMessage).toBe("/btw what changed?");
    expect(host.lastError).toBe("The active run ended before the detached message was accepted.");
  });

  it("clears BTW side results when /clear resets chat history", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.reset") {
        return { ok: true };
      }
      if (method === "chat.history") {
        return { messages: [], thinkingLevel: null };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      chatMessage: "/clear",
      chatMessages: [{ role: "user", content: "hello", timestamp: 1 }],
      chatSideResult: {
        kind: "btw",
        runId: "btw-run-clear",
        sessionKey: "main",
        question: "what changed?",
        text: "Detached BTW result",
        isError: false,
        ts: 1,
      },
      chatSideResultTerminalRuns: new Set(["btw-run-clear"]),
    });

    await handleSendChat(host);

    expect(request).toHaveBeenCalledWith("sessions.reset", { key: "main" });
    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatSideResult).toBeNull();
    expect(host.chatSideResultTerminalRuns?.size).toBe(0);
    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
  });

  it("scopes /clear resets for selected-agent global sessions", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.reset") {
        return { ok: true };
      }
      if (method === "chat.history") {
        return { messages: [], thinkingLevel: null };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "global",
      assistantAgentId: "work",
      agentsList: { defaultId: "main" },
      chatMessage: "/clear",
      chatMessages: [{ role: "user", content: "hello", timestamp: 1 }],
      chatMessagesBySession: new Map([
        ["agent:work:main", [{ role: "assistant", content: "work history" }]],
        ["agent:main:main", [{ role: "assistant", content: "main history" }]],
      ]),
    });

    await handleSendChat(host);

    expect(request).toHaveBeenCalledWith("sessions.reset", {
      key: "global",
      agentId: "work",
    });
    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "global",
      agentId: "work",
      limit: 100,
      offset: 0,
    });
    expect(host.chatMessages).toStrictEqual([]);
    expect(host.chatMessagesBySession?.has("agent:work:main")).toBe(false);
    expect(host.chatMessagesBySession?.has("agent:main:main")).toBe(true);
  });

  it("shows a visible pending item for /steer on the active run", async () => {
    const host = makeHost({
      client: {
        request: vi.fn(async (method: string) => {
          if (method === "chat.send") {
            return { status: "started", runId: "run-1", messageSeq: 2 };
          }
          throw new Error(`Unexpected request: ${method}`);
        }),
      } as unknown as ChatHost["client"],
      chatRunId: "run-1",
      chatMessage: "/steer tighten the plan",
      sessionKey: "agent:main:main",
      sessionsResult: createSessionsResult([row("agent:main:main", { status: "running" })]),
    });

    await handleSendChat(host);

    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.text).toBe("/steer tighten the plan");
    expect(host.chatQueue[0]?.kind).toBe("steered");
    expect(host.chatQueue[0]?.pendingRunId).toBe("run-1");
  });

  it("steers a queued message into the active run without replacing run tracking", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started", runId: "steer-run" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatRunId: "run-1",
      chatStream: "Working...",
      chatQueue: [{ id: "queued-1", text: "tighten the plan", createdAt: 1 }],
      sessionKey: "agent:main:main",
    });

    await steerQueuedChatMessage(host, "queued-1");

    const payload = findRequestPayload(
      request as unknown as MockCallSource,
      "chat.send",
      "steered chat send payload",
    );
    const idempotencyKey = payload.idempotencyKey;
    expect(typeof idempotencyKey).toBe("string");
    expect(uuidPattern.test(idempotencyKey as string)).toBe(true);
    expect(payload).toEqual({
      sessionKey: "agent:main:main",
      message: "tighten the plan",
      deliver: false,
      idempotencyKey,
      attachments: undefined,
    });
    expect(host.chatRunId).toBe("run-1");
    expect(host.chatStream).toBe("Working...");
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.text).toBe("tighten the plan");
    expect(host.chatQueue[0]?.kind).toBe("steered");
    expect(host.chatQueue[0]?.pendingRunId).toBe("run-1");
  });

  it("does not steer a local queued message while the queue is paused", async () => {
    const request = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatRunId: "run-1",
      chatQueuePaused: true,
      chatQueuePausedBySession: { "agent:main:main": true },
      chatQueue: [{ id: "queued-1", text: "keep queued", createdAt: 1 }],
      sessionKey: "agent:main:main",
    });

    await steerQueuedChatMessage(host, "queued-1");

    expect(request).not.toHaveBeenCalled();
    expect(host.chatQueue[0]?.kind).toBeUndefined();
    expect(host.chatQueue[0]?.pendingRunId).toBeUndefined();
    expect(host.chatError).toBe("Queue is paused; resume it before steering a message.");
  });

  it("removes queued steer indicators when chat.send returns terminal ok", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "ok", runId: "steer-ok" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatRunId: "run-1",
      chatStream: "Working...",
      chatQueue: [{ id: "queued-1", text: "tighten the plan", createdAt: 1 }],
      sessionKey: "agent:main:main",
    });

    await steerQueuedChatMessage(host, "queued-1");

    expect(host.chatRunId).toBe("run-1");
    expect(host.chatStream).toBe("Working...");
    expect(host.chatQueue).toStrictEqual([]);
    expect(setLastActiveSessionKeyMock).toHaveBeenCalledWith(expect.anything(), "agent:main:main");
  });

  it("restores queued steer items when chat.send returns terminal error", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "error", runId: "steer-error" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const original = { id: "queued-1", text: "tighten the plan", createdAt: 1 };
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatRunId: "run-1",
      chatStream: "Working...",
      chatQueue: [original],
      sessionKey: "agent:main:main",
    });

    await steerQueuedChatMessage(host, "queued-1");

    expect(host.chatRunId).toBe("run-1");
    expect(host.chatStream).toBe("Working...");
    expect(host.chatQueue).toStrictEqual([original]);
    expect(host.lastError).toBe("Steer failed before it reached the run; try again.");
    expect(setLastActiveSessionKeyMock).not.toHaveBeenCalled();
  });

  it("removes pending steer indicators when the run finishes", () => {
    const host = makeHost({
      chatQueue: [
        {
          id: "pending",
          text: "/steer tighten the plan",
          createdAt: 1,
          pendingRunId: "run-1",
        },
        {
          id: "queued",
          text: "follow up",
          createdAt: 2,
        },
      ],
    });

    clearPendingQueueItemsForRun(host, "run-1");

    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.id).toBe("queued");
    expect(host.chatQueue[0]?.text).toBe("follow up");
  });

  it("drops sent attachment payload bytes while keeping the optimistic preview URL", async () => {
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = vi.fn(() => "blob:brief");
        static override revokeObjectURL = vi.fn();
      },
    );
    const request = vi.fn(async (method: string) => {
      if (method === "chat.send") {
        return { status: "started", runId: "run-1" };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const file = new File(["%PDF-1.4\n"], "brief.pdf", { type: "application/pdf" });
    const attachment = registerChatAttachmentPayload({
      attachment: {
        id: "att-1",
        mimeType: "application/pdf",
        fileName: "brief.pdf",
        sizeBytes: file.size,
      },
      dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
      file,
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatAttachments: [attachment],
      chatMessage: "summarize",
    });

    await handleSendChat(host);

    expect(getChatAttachmentDataUrl(attachment)).toBeNull();
    expect(getChatAttachmentPreviewUrl(attachment)).toBe("blob:brief");
    expect(host.chatMessages).toStrictEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "summarize" },
          {
            type: "attachment",
            attachment: {
              url: "blob:brief",
              kind: "document",
              label: "brief.pdf",
              mimeType: "application/pdf",
            },
          },
        ],
        timestamp: expect.any(Number),
      },
    ]);
  });

  it("releases queued attachment payloads when the queued item is removed", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = vi.fn(() => "blob:queued");
        static override revokeObjectURL = revokeObjectURL;
      },
    );
    const file = new File(["%PDF-1.4\n"], "brief.pdf", { type: "application/pdf" });
    const attachment = registerChatAttachmentPayload({
      attachment: {
        id: "queued-att",
        mimeType: "application/pdf",
        fileName: "brief.pdf",
        sizeBytes: file.size,
      },
      dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
      file,
    });
    const host = makeHost({
      chatQueue: [{ id: "queued", text: "later", createdAt: 1, attachments: [attachment] }],
    });

    void removeQueuedMessage(host, "queued");

    expect(host.chatQueue).toStrictEqual([]);
    expect(getChatAttachmentDataUrl(attachment)).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:queued");
  });
});

describe("handleAbortChat", () => {
  beforeAll(async () => {
    await loadChatHelpers();
  });

  it("preserves the draft for connected toolbar aborts", async () => {
    const request = vi.fn(async () => ({ aborted: true }));
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatRunId: "run-main",
      chatMessage: "next prompt",
      sessionKey: "agent:main",
    });

    await handleAbortChat(host, { preserveDraft: true });

    expect(request).toHaveBeenCalledWith("chat.abort", {
      runId: "run-main",
      sessionKey: "agent:main",
    });
    expect(host.chatMessage).toBe("next prompt");
    expect(host.chatRunId).toBe("run-main");
  });

  it("clears typed stop commands after aborting the active run", async () => {
    const request = vi.fn(async () => ({ aborted: true }));
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatRunId: "run-main",
      chatMessage: "/stop",
      sessionKey: "agent:main",
    });

    await handleSendChat(host);

    expect(request).toHaveBeenCalledWith("chat.abort", {
      runId: "run-main",
      sessionKey: "agent:main",
    });
    expect(host.chatMessage).toBe("");
  });

  it("queues the active run abort while disconnected", async () => {
    const host = makeHost({
      connected: false,
      chatRunId: "run-main",
      chatMessage: "draft",
      sessionKey: "agent:main",
    });

    await handleAbortChat(host);

    expect(host.pendingAbort).toEqual({ runId: "run-main", sessionKey: "agent:main" });
    expect(host.chatMessage).toBe("");
    expect(host.chatRunId).toBe("run-main");
  });

  it("preserves the draft when queueing a toolbar abort while disconnected", async () => {
    const host = makeHost({
      connected: false,
      chatRunId: "run-main",
      chatMessage: "draft",
      sessionKey: "agent:main",
    });

    await handleAbortChat(host, { preserveDraft: true });

    expect(host.pendingAbort).toEqual({ runId: "run-main", sessionKey: "agent:main" });
    expect(host.chatMessage).toBe("draft");
    expect(host.chatRunId).toBe("run-main");
  });

  it("queues a session-scoped abort while disconnected after active run state is recovered", async () => {
    const host = makeHost({
      connected: false,
      chatRunId: null,
      chatMessage: "draft",
      sessionKey: "agent:main",
      sessionsResult: createSessionsResult([
        row("agent:main", { hasActiveRun: true }),
        row("agent:other", { hasActiveRun: true }),
      ]),
    });

    await handleAbortChat(host);

    expect(host.pendingAbort).toEqual({ runId: null, sessionKey: "agent:main" });
    expect(host.chatMessage).toBe("");
  });

  it("queues selected-agent global aborts with agent scope while disconnected", async () => {
    const host = makeHost({
      connected: false,
      chatRunId: null,
      chatMessage: "draft",
      sessionKey: "global",
      assistantAgentId: "work",
      agentsList: { defaultId: "main" },
      sessionsResult: createSessionsResult([
        row("global", { hasActiveRun: true, agentId: "work" } as Partial<GatewaySessionRow>),
      ]),
    });

    await handleAbortChat(host);

    expect(host.pendingAbort).toEqual({
      runId: null,
      sessionKey: "global",
      agentId: "work",
    });
    expect(host.chatMessage).toBe("");
  });

  it("ignores stale active-run flags once the current session is terminal", () => {
    const host = makeHost({
      chatRunId: null,
      sessionKey: "agent:main",
      sessionsResult: createSessionsResult([
        row("agent:main", { hasActiveRun: true, status: "done" }),
        row("agent:other", { hasActiveRun: true, status: "running" }),
      ]),
    });

    expect(hasAbortableSessionRun(host)).toBe(false);
  });

  it("ignores stale running status once the gateway reports no active run", () => {
    const host = makeHost({
      chatRunId: null,
      sessionKey: "agent:main",
      sessionsResult: createSessionsResult([
        row("agent:main", { hasActiveRun: false, status: "running" }),
        row("agent:other", { hasActiveRun: true, status: "running" }),
      ]),
    });

    expect(hasAbortableSessionRun(host)).toBe(false);
  });

  it("keeps the draft when disconnected without an active run", async () => {
    const host = makeHost({
      connected: false,
      chatRunId: null,
      chatMessage: "draft",
    });

    await handleAbortChat(host);

    expect(host.pendingAbort).toBeUndefined();
    expect(host.chatMessage).toBe("draft");
  });
});

afterAll(() => {
  vi.doUnmock("./app-last-active-session.ts");
  vi.resetModules();
});
