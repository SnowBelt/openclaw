// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../../test-helpers/storage.ts";
import type { ChatHost } from "../app-chat.ts";
import {
  isChatQueuePaused,
  markQueuedChatSendsWaitingForReconnect,
  retryReconnectableQueuedChatSends,
  setChatQueuePaused,
  toggleChatQueuePaused,
} from "../app-chat.ts";
import { loadChatComposerSnapshot, persistChatComposerState } from "./composer-persistence.ts";

function createHost(): ChatHost {
  return {
    client: null,
    chatStream: null,
    connected: false,
    chatAttachments: [],
    chatQueue: [],
    chatQueueBySession: {},
    chatRunId: null,
    chatSending: false,
    basePath: "",
    settings: { gatewayUrl: "ws://gateway.test/control" },
    hello: null,
    chatAvatarUrl: null,
    chatModelOverrides: {},
    chatModelsLoading: false,
    chatModelCatalog: [],
    refreshSessionsAfterChat: new Map(),
    sessionKey: "agent:main:main",
    requestUpdate: vi.fn(),
  } as unknown as ChatHost;
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", createStorageMock());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat queue pause state", () => {
  it("treats the default-main alias as the selected queue", () => {
    const host = createHost();
    host.chatQueue = [{ id: "queued-alias", text: "wait", createdAt: 1 }];

    expect(setChatQueuePaused(host, true, "main")).toBe(true);
    expect(host.chatQueuePaused).toBe(true);
    expect(isChatQueuePaused(host, "agent:main:main")).toBe(true);
    expect(host.chatQueuePausedBySession).toEqual({ "agent:main:main": true });

    expect(setChatQueuePaused(host, false, "main")).toBe(false);
    expect(host.chatQueuePaused).toBe(false);
    expect(host.chatQueuePausedBySession).toEqual({});
  });

  it("pauses and resumes the selected session without losing its queue", () => {
    const host = createHost();
    host.chatQueue = [{ id: "queued-1", text: "wait", createdAt: 1 }];

    expect(setChatQueuePaused(host, true)).toBe(true);
    expect(isChatQueuePaused(host)).toBe(true);
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueuePausedBySession).toEqual({ "agent:main:main": true });

    expect(toggleChatQueuePaused(host)).toBe(false);
    expect(isChatQueuePaused(host)).toBe(false);
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueuePausedBySession).toEqual({});
  });

  it("keeps pause state isolated when another session is paused", () => {
    const host = createHost();

    setChatQueuePaused(host, true, "agent:other:main");

    expect(isChatQueuePaused(host)).toBe(false);
    expect(isChatQueuePaused(host, "agent:other:main")).toBe(true);
    expect(host.chatQueuePaused).toBeUndefined();
    expect(host.chatQueuePausedBySession).toEqual({ "agent:other:main": true });
  });

  it("persists offscreen reconnect completion so a reload cannot resend it", async () => {
    const queued = {
      id: "offscreen-1",
      text: "send once",
      createdAt: 1,
      sendRunId: "run-offscreen-1",
      sendState: "waiting-reconnect" as const,
      sessionKey: "agent:other:main",
    };
    const host = createHost();
    host.connected = true;
    host.client = {
      request: vi.fn(async () => ({ runId: "run-offscreen-1", status: "started" })),
    } as unknown as ChatHost["client"];
    host.chatQueueBySession = { "agent:other:main": [queued] };
    persistChatComposerState(
      {
        ...host,
        sessionKey: "agent:other:main",
        chatQueue: [queued],
      },
      "agent:other:main",
    );

    await retryReconnectableQueuedChatSends(host);

    expect(host.chatQueueBySession).toEqual({});
    expect(
      loadChatComposerSnapshot(
        { settings: { gatewayUrl: "ws://gateway.test/control" } },
        "agent:other:main",
      ),
    ).toBeNull();
  });

  it("persists offscreen sends when disconnect makes them reconnectable", () => {
    const queued = {
      id: "offscreen-disconnect-1",
      text: "retry after reconnect",
      createdAt: 1,
      sendRunId: "run-offscreen-disconnect-1",
      sendState: "sending" as const,
      sessionKey: "agent:other:main",
    };
    const host = createHost();
    host.chatQueueBySession = { "agent:other:main": [queued] };

    markQueuedChatSendsWaitingForReconnect(host);

    expect(
      loadChatComposerSnapshot(
        { settings: { gatewayUrl: "ws://gateway.test/control" } },
        "agent:other:main",
      ),
    ).toMatchObject({
      queue: [expect.objectContaining({ sendState: "waiting-reconnect" })],
    });
  });
});
