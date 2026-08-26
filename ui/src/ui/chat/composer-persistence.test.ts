// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../../test-helpers/storage.ts";
import type { ChatQueueItem } from "../ui-types.ts";
import {
  loadChatComposerSnapshot,
  migrateChatComposerState,
  persistChatComposerState,
  persistStoredChatComposerQueue,
  persistStoredChatComposerSet,
  recoverLegacyChatComposerState,
  removeStoredChatComposerQueueItem,
  restoreChatComposerState,
} from "./composer-persistence.ts";

function createState(overrides: Partial<Parameters<typeof persistChatComposerState>[0]> = {}) {
  const settings = overrides.settings ?? {
    gatewayUrl: "ws://gateway.test/control",
    token: "test-token",
  };
  return {
    settings,
    hello: settings.token ? { auth: { deviceToken: "test-device" } } : null,
    chatComposerMemoryOwner: {},
    sessionKey: "agent:lily:main",
    chatMessage: "",
    chatQueue: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", createStorageMock());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat composer persistence", () => {
  it("does not restore bootstrap-token state before the device identity is known", () => {
    const preHello = createState({ hello: null, chatMessage: "bootstrap-only draft" });
    expect(persistChatComposerState(preHello)).toBe(true);
    preHello.chatMessage = "";
    expect(restoreChatComposerState(preHello)).toBe(false);
    expect(preHello.chatMessage).toBe("");
  });

  it("restores an authenticated token session when no device token is issued", () => {
    const state = createState({
      hello: { auth: {} },
      chatMessage: "shared-token draft",
    });
    expect(persistChatComposerState(state)).toBe(true);
    state.chatMessage = "";

    expect(restoreChatComposerState(state)).toBe(true);
    expect(state.chatMessage).toBe("shared-token draft");
  });

  it("restores draft text and queued messages for the same gateway session", () => {
    const queue: ChatQueueItem[] = [
      {
        id: "queued-1",
        text: "follow up after tools finish",
        createdAt: 1,
        attachments: [
          {
            id: "att-1",
            mimeType: "image/png",
            fileName: "screen.png",
            dataUrl: "data:image/png;base64,AAA",
          },
        ],
      },
    ];
    persistChatComposerState(
      createState({
        chatMessage: "unsent draft",
        chatQueue: queue,
      }),
    );

    const restored = createState();
    expect(restoreChatComposerState(restored)).toBe(true);

    expect(restored.chatMessage).toBe("unsent draft");
    expect(restored.chatQueue).toEqual(queue);
  });

  it("preserves Skill Workshop revision metadata on queued sends", () => {
    persistChatComposerState(
      createState({
        chatQueue: [
          {
            id: "revision-queued",
            text: "Make the support files 5",
            createdAt: 1,
            sessionKey: "agent:lily:main",
            agentId: "lily",
            sendState: "waiting-reconnect",
            skillWorkshopRevision: {
              proposalId: "support-file-sampler-20260531-68207b7b7f",
              agentId: "proposal-owner",
            },
          },
        ],
      }),
    );

    const restored = createState();
    expect(restoreChatComposerState(restored)).toBe(true);

    expect(restored.chatQueue).toEqual([
      {
        id: "revision-queued",
        text: "Make the support files 5",
        createdAt: 1,
        sessionKey: "agent:lily:main",
        agentId: "lily",
        sendState: "waiting-reconnect",
        skillWorkshopRevision: {
          proposalId: "support-file-sampler-20260531-68207b7b7f",
          agentId: "proposal-owner",
        },
      },
    ]);
  });

  it("scopes persisted composers by gateway and session key", () => {
    persistChatComposerState(createState({ chatMessage: "main draft" }));

    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "test-token" },
          hello: { auth: { deviceToken: "test-device" } },
        },
        "agent:lily:other",
      ),
    ).toBeNull();
    expect(
      loadChatComposerSnapshot(
        { settings: { gatewayUrl: "ws://other-gateway.test/control" } },
        "agent:lily:main",
      ),
    ).toBeNull();
  });

  it("does not restore a composer across credentials on the same gateway", () => {
    const longGatewayUrl = `ws://gateway.test/${"long-path-".repeat(40)}`;
    persistChatComposerState(
      createState({
        settings: { gatewayUrl: longGatewayUrl, token: "credential-a" },
        chatMessage: "private draft",
      }),
    );

    expect(
      loadChatComposerSnapshot(
        { settings: { gatewayUrl: longGatewayUrl, token: "credential-b" } },
        "agent:lily:main",
      ),
    ).toBeNull();

    persistChatComposerState(
      createState({
        settings: { gatewayUrl: "ws://gateway.test/control", token: "" },
        hello: { auth: { deviceToken: "device-a" } },
        chatMessage: "private device draft",
      }),
    );
    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "" },
          hello: { auth: { deviceToken: "device-b" } },
        },
        "agent:lily:main",
      ),
    ).toBeNull();

    persistChatComposerState(
      createState({
        settings: { gatewayUrl: "ws://gateway.test/control", token: "" },
        password: "password-a",
        chatMessage: "private password draft",
      }),
    );
    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "" },
          password: "password-b",
        },
        "agent:lily:main",
      ),
    ).toBeNull();
  });

  it("keys authenticated composer state by device identity over a shared token", () => {
    const state = createState({
      settings: { gatewayUrl: "ws://gateway.test/control", token: "shared-token" },
      hello: { auth: { deviceToken: "device-a" } },
      chatMessage: "device A draft",
    });
    persistChatComposerState(state);

    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "shared-token" },
          hello: { auth: { deviceToken: "device-b" } },
        },
        state.sessionKey,
      ),
    ).toBeNull();
    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "shared-token" },
          hello: { auth: { deviceToken: "device-a" } },
        },
        state.sessionKey,
      ),
    ).toMatchObject({ draft: "device A draft" });
  });

  it("keeps password-only composer state in memory until device authentication", () => {
    const memoryOwner = {};
    const state = createState({
      settings: { gatewayUrl: "ws://gateway.test/control", token: "" },
      password: "password-a",
      chatMessage: "password draft",
      chatQueuePaused: true,
      chatComposerMemoryOwner: memoryOwner,
    });

    expect(persistChatComposerState(state)).toBe(true);

    expect(loadChatComposerSnapshot(state, state.sessionKey)).toMatchObject({
      draft: "password draft",
      queuePaused: true,
    });
    expect(
      restoreChatComposerState(
        createState({
          settings: { gatewayUrl: "ws://gateway.test/control", token: "" },
          password: "password-a",
          chatComposerMemoryOwner: memoryOwner,
        }),
      ),
    ).toBe(true);
    expect(
      loadChatComposerSnapshot(
        createState({
          settings: { gatewayUrl: "ws://gateway.test/control", token: "" },
          password: "password-b",
          chatComposerMemoryOwner: memoryOwner,
        }),
        state.sessionKey,
      ),
    ).toBeNull();
    expect(
      loadChatComposerSnapshot(
        createState({
          settings: { gatewayUrl: "ws://gateway.test/control", token: "" },
          password: "password-a",
          chatComposerMemoryOwner: {},
        }),
        state.sessionKey,
      ),
    ).toBeNull();
  });

  it("persists composer state for a credential-less Gateway by endpoint", () => {
    const state = createState({
      settings: { gatewayUrl: "ws://trusted-proxy.test/control", token: "" },
      password: "",
      hello: { auth: {} },
      chatMessage: "trusted proxy draft",
    });

    expect(persistChatComposerState(state)).toBe(true);
    expect(loadChatComposerSnapshot(state, state.sessionKey)).toMatchObject({
      draft: "trusted proxy draft",
    });
  });

  it("does not restore a credential-less composer before hello resolves the principal", () => {
    const state = createState({
      settings: { gatewayUrl: "ws://trusted-proxy.test/control", token: "" },
      password: "",
      hello: null,
    });
    const legacyKey =
      "openclaw.control.chatComposer.v1:" + encodeURIComponent("ws://trusted-proxy.test/control");
    sessionStorage.setItem(
      legacyKey,
      JSON.stringify({
        version: 1,
        sessions: {
          "agent:lily:main\u0000agent:lily": { draft: "paired-device draft", updatedAt: 1 },
        },
      }),
    );

    expect(loadChatComposerSnapshot(state, state.sessionKey)).toBeNull();
    expect(restoreChatComposerState(state)).toBe(false);
    expect(state.chatMessage).toBe("");
    expect(sessionStorage.getItem(legacyKey)).not.toBeNull();
  });

  it("does not claim ownerless legacy composer state for an anonymous scope", () => {
    const state = createState({
      settings: { gatewayUrl: "ws://trusted-proxy.test/control", token: "" },
      password: "",
      hello: null,
    });
    const legacyKey =
      "openclaw.control.chatComposer.v1:" + encodeURIComponent("ws://trusted-proxy.test/control");
    const storeSessionKey = "agent:lily:main\u0000agent:lily";
    sessionStorage.setItem(
      legacyKey,
      JSON.stringify({
        version: 1,
        sessions: {
          [storeSessionKey]: { draft: "legacy draft", updatedAt: 1 },
        },
      }),
    );

    expect(restoreChatComposerState(state)).toBe(false);
    expect(state.chatMessage).toBe("");
    expect(sessionStorage.getItem(legacyKey)).not.toBeNull();
  });

  it("keeps ownerless legacy composer state isolated during persistence", () => {
    const state = createState({
      settings: { gatewayUrl: "ws://trusted-proxy.test/control", token: "" },
      password: "",
      hello: null,
    });
    const legacyKey =
      "openclaw.control.chatComposer.v1:" + encodeURIComponent("ws://trusted-proxy.test/control");
    const legacyRaw = JSON.stringify({
      version: 1,
      sessions: {
        "agent:lily:main\u0000agent:lily": { draft: "legacy draft", updatedAt: 1 },
      },
    });
    sessionStorage.setItem(legacyKey, legacyRaw);
    expect(
      persistStoredChatComposerQueue(
        state,
        state.sessionKey,
        [{ id: "queued", text: "must survive", createdAt: 2 }],
        true,
        { requireComplete: true },
      ),
    ).toBe(true);
    expect(sessionStorage.getItem(legacyKey)).toBe(legacyRaw);
  });

  it("recovers legacy composer state only after explicit owner confirmation", () => {
    const state = createState({
      settings: { gatewayUrl: "ws://trusted-proxy.test/control", token: "current-token" },
      hello: { auth: {} },
    });
    const legacyKey =
      "openclaw.control.chatComposer.v1:" + encodeURIComponent("ws://trusted-proxy.test/control");
    sessionStorage.setItem(
      legacyKey,
      JSON.stringify({
        version: 1,
        sessions: {
          "agent:lily:main\u0000agent:lily": { draft: "legacy draft", updatedAt: 1 },
        },
      }),
    );

    expect(recoverLegacyChatComposerState(state, { confirmOwnerless: true })).toBe(true);
    expect(restoreChatComposerState(state)).toBe(true);
    expect(state.chatMessage).toBe("legacy draft");
    expect(sessionStorage.getItem(legacyKey)).toBeNull();
  });

  it("offers legacy recovery through the normal restore path", () => {
    const state = createState({
      settings: { gatewayUrl: "ws://trusted-proxy.test/control", token: "current-token" },
      hello: { auth: {} },
    });
    const legacyKey =
      "openclaw.control.chatComposer.v1:" + encodeURIComponent("ws://trusted-proxy.test/control");
    sessionStorage.setItem(
      legacyKey,
      JSON.stringify({
        version: 1,
        sessions: {
          "agent:lily:main\u0000agent:lily": { draft: "legacy draft", updatedAt: 1 },
        },
      }),
    );
    const confirmRecovery = vi.fn(() => true);

    expect(restoreChatComposerState(state, { confirmLegacyRecovery: confirmRecovery })).toBe(true);
    expect(state.chatMessage).toBe("legacy draft");
    expect(confirmRecovery).toHaveBeenCalledOnce();

    state.chatMessage = "";
    expect(restoreChatComposerState(state, { confirmLegacyRecovery: confirmRecovery })).toBe(true);
    expect(state.chatMessage).toBe("legacy draft");
    expect(confirmRecovery).toHaveBeenCalledOnce();
  });

  it("migrates every stored session across a same-device token rotation", () => {
    const owner = {};
    const previous = createState({
      settings: { gatewayUrl: "ws://gateway.test/control", token: "" },
      hello: { auth: { deviceToken: "device-before" } },
      chatComposerMemoryOwner: owner,
      sessionKey: "agent:lily:main",
      chatMessage: "main draft",
    });
    persistChatComposerState(previous);
    persistChatComposerState({
      ...previous,
      sessionKey: "agent:lily:other",
      chatMessage: "other draft",
    });
    const next = {
      settings: { gatewayUrl: "ws://gateway.test/control", token: "" },
      hello: { auth: { deviceToken: "device-after" } },
      chatComposerMemoryOwner: owner,
    };

    expect(migrateChatComposerState(previous, next)).toBe(true);
    expect(loadChatComposerSnapshot(next, "agent:lily:main")).toMatchObject({
      draft: "main draft",
    });
    expect(loadChatComposerSnapshot(next, "agent:lily:other")).toMatchObject({
      draft: "other draft",
    });
    expect(loadChatComposerSnapshot(previous, "agent:lily:main")).toBeNull();
  });

  it("does not migrate an ownerless legacy composer into an authenticated scope", () => {
    const state = createState({
      settings: { gatewayUrl: "ws://gateway.test/control", token: "credential-a" },
      chatMessage: "legacy draft",
    });
    const legacyKey =
      "openclaw.control.chatComposer.v1:" + encodeURIComponent("ws://gateway.test/control");
    const storeSessionKey = "agent:lily:main\u0000agent:lily";
    sessionStorage.setItem(
      legacyKey,
      JSON.stringify({
        version: 1,
        sessions: {
          [storeSessionKey]: { draft: "legacy draft", updatedAt: 1 },
        },
      }),
    );

    expect(restoreChatComposerState(state)).toBe(false);
    expect(state.chatMessage).toBe("legacy draft");
    expect(loadChatComposerSnapshot(state, state.sessionKey)).toBeNull();
  });

  it("scopes global-session composers by selected agent", () => {
    const queued: ChatQueueItem = {
      id: "queued-global",
      text: "agent-specific prompt",
      createdAt: 1,
      sessionKey: "global",
      agentId: "agent-a",
    };
    persistChatComposerState(
      createState({
        assistantAgentId: "agent-a",
        sessionKey: "global",
        chatMessage: "agent A draft",
        chatQueue: [queued],
      }),
    );

    expect(
      loadChatComposerSnapshot(
        { settings: { gatewayUrl: "ws://gateway.test/control" }, assistantAgentId: "agent-b" },
        "global",
      ),
    ).toBeNull();

    const restored = createState({ assistantAgentId: "agent-a", sessionKey: "global" });
    expect(restoreChatComposerState(restored)).toBe(true);
    expect(restored.chatMessage).toBe("agent A draft");
    expect(restored.chatQueue).toEqual([queued]);
  });

  it("clears the stored session when both draft and queue are empty", () => {
    persistChatComposerState(createState({ chatMessage: "clear me" }));
    persistChatComposerState(createState());

    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "test-token" },
          hello: { auth: { deviceToken: "test-device" } },
        },
        "agent:lily:main",
      ),
    ).toBeNull();
  });

  it("persists a paused empty queue so the pause state survives a reload", () => {
    persistChatComposerState(createState({ chatQueuePaused: true }));

    const restored = createState();
    expect(restoreChatComposerState(restored)).toBe(true);
    expect(restored.chatQueue).toEqual([]);
    expect(restored.chatQueuePaused).toBe(true);
  });

  it("keeps ordinary composer persistence best effort around transient queue items", () => {
    persistChatComposerState(
      createState({
        chatQueue: [
          {
            id: "sending-1",
            text: "already in flight",
            createdAt: 1,
            sendState: "sending",
          },
          { id: "queued-1", text: "keep this retryable prompt", createdAt: 2 },
        ],
      }),
    );

    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "test-token" },
          hello: { auth: { deviceToken: "test-device" } },
        },
        "agent:lily:main",
      ),
    ).toEqual({
      draft: "",
      queue: [{ id: "queued-1", text: "keep this retryable prompt", createdAt: 2 }],
    });
  });

  it("allows strict persistence while a direct send is in flight", () => {
    expect(
      persistChatComposerState(
        createState({
          chatQueue: [
            {
              id: "sending-1",
              text: "already in flight",
              createdAt: 1,
              sendState: "sending",
            },
            { id: "queued-1", text: "must survive a Gateway switch", createdAt: 2 },
          ],
        }),
        "agent:lily:main",
        { requireComplete: true },
      ),
    ).toBe(true);
    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "test-token" },
          hello: { auth: { deviceToken: "test-device" } },
        },
        "agent:lily:main",
      ),
    ).toEqual({
      draft: "",
      queue: [{ id: "queued-1", text: "must survive a Gateway switch", createdAt: 2 }],
    });
  });

  it("clears the submitted draft in the same strict queue write", () => {
    const state = createState({ chatMessage: "submitted prompt" });
    const queue: ChatQueueItem[] = [{ id: "queued-1", text: "submitted prompt", createdAt: 1 }];

    expect(
      persistStoredChatComposerQueue(state, state.sessionKey, queue, true, {
        requireComplete: true,
        draft: "",
      }),
    ).toBe(true);
    expect(loadChatComposerSnapshot(state, state.sessionKey)).toEqual({
      draft: "",
      queue,
      queuePaused: true,
    });
  });

  it("keeps ordinary stored-queue persistence best effort above the strict limit", () => {
    const queue = Array.from({ length: 51 }, (_, index) => ({
      id: `queued-${index}`,
      text: `queued prompt ${index}`,
      createdAt: index,
    }));

    expect(persistStoredChatComposerQueue(createState(), "agent:lily:main", queue, false)).toBe(
      true,
    );
    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "test-token" },
          hello: { auth: { deviceToken: "test-device" } },
        },
        "agent:lily:main",
      )?.queue,
    ).toHaveLength(50);
    expect(
      persistStoredChatComposerQueue(createState(), "agent:lily:main", queue, true, {
        requireComplete: true,
      }),
    ).toBe(false);
  });

  it("commits all Gateway-switch composer updates as one verified store replacement", () => {
    expect(
      persistStoredChatComposerSet(createState(), [
        {
          sessionKey: "agent:lily:main",
          draft: "active draft",
          queue: [{ id: "active-1", text: "active prompt", createdAt: 1 }],
          queuePaused: false,
        },
        {
          sessionKey: "agent:lily:other",
          queue: [{ id: "inactive-1", text: "inactive prompt", createdAt: 2 }],
          queuePaused: true,
        },
      ]),
    ).toBe(true);

    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "test-token" },
          hello: { auth: { deviceToken: "test-device" } },
        },
        "agent:lily:main",
      ),
    ).toEqual({
      draft: "active draft",
      queue: [{ id: "active-1", text: "active prompt", createdAt: 1 }],
    });
    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "test-token" },
          hello: { auth: { deviceToken: "test-device" } },
        },
        "agent:lily:other",
      ),
    ).toEqual({
      draft: "",
      queue: [{ id: "inactive-1", text: "inactive prompt", createdAt: 2 }],
      queuePaused: true,
    });
  });

  it("preserves every password-only composer update during a Gateway switch", () => {
    const memoryOwner = {};
    const state = createState({
      settings: { gatewayUrl: "ws://gateway.test/control", token: "" },
      hello: { auth: {} },
      password: "password-a",
      chatComposerMemoryOwner: memoryOwner,
    });
    const updates = Array.from({ length: 21 }, (_, index) => ({
      sessionKey: `agent:lily:session-${index}`,
      draft: `draft ${index}`,
      queue: [],
      queuePaused: false,
    }));

    expect(persistStoredChatComposerSet(state, updates)).toBe(true);

    for (const update of updates) {
      expect(loadChatComposerSnapshot(state, update.sessionKey)).toMatchObject({
        draft: update.draft,
      });
    }
  });

  it("can preserve a pause chosen while reconnecting", () => {
    persistChatComposerState(createState({ chatQueuePaused: true }));

    const restored = createState({ chatQueuePaused: false });
    expect(
      restoreChatComposerState(restored, {
        preserveCurrent: true,
        preserveCurrentQueuePaused: true,
      }),
    ).toBe(true);
    expect(restored.chatQueuePaused).toBe(false);
  });

  it("clears a provisional pause when the resolved session has no stored snapshot", () => {
    const restored = createState({
      chatMessage: "keep this draft",
      chatQueue: [{ id: "queued-1", text: "keep this queued", createdAt: 1 }],
      chatQueuePaused: true,
    });

    expect(
      restoreChatComposerState(restored, {
        preserveCurrent: true,
        preserveCurrentQueuePaused: false,
      }),
    ).toBe(false);
    expect(restored.chatMessage).toBe("keep this draft");
    expect(restored.chatQueue).toEqual([
      { id: "queued-1", text: "keep this queued", createdAt: 1 },
    ]);
    expect(restored.chatQueuePaused).toBe(false);
  });

  it("does not restore queued attachments without payload data", () => {
    persistChatComposerState(
      createState({
        chatQueue: [
          {
            id: "queued-1",
            text: "needs attachment",
            createdAt: 1,
            attachments: [{ id: "att-1", mimeType: "image/png", fileName: "screen.png" }],
          },
        ],
      }),
    );

    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "test-token" },
          hello: { auth: { deviceToken: "test-device" } },
        },
        "agent:lily:main",
      ),
    ).toBeNull();
  });

  it("keeps in-memory queue items when the stored snapshot only has a draft", () => {
    persistChatComposerState(createState({ chatMessage: "stored draft" }));
    const restored = createState({
      chatQueue: [{ id: "queued-1", text: "memory queue", createdAt: 1 }],
    });

    expect(restoreChatComposerState(restored)).toBe(true);

    expect(restored.chatMessage).toBe("stored draft");
    expect(restored.chatQueue).toEqual([{ id: "queued-1", text: "memory queue", createdAt: 1 }]);
  });

  it("keeps failed queued messages failed after restore", () => {
    const failed: ChatQueueItem = {
      id: "failed-1",
      text: "manual retry only",
      createdAt: 1,
      sendError: "send blocked",
      sendRunId: "run-failed",
      sendState: "failed",
    };
    persistChatComposerState(createState({ chatQueue: [failed] }));

    const restored = createState();
    expect(restoreChatComposerState(restored)).toBe(true);

    expect(restored.chatQueue).toEqual([failed]);
  });

  it("preserves legacy error-only queued messages for manual retry", () => {
    persistChatComposerState(
      createState({
        chatQueue: [
          {
            id: "legacy-failed-1",
            text: "retry only after review",
            createdAt: 1,
            sendError: "previous send failed",
          },
        ],
      }),
    );

    const restored = createState();
    expect(restoreChatComposerState(restored)).toBe(true);

    expect(restored.chatQueue).toEqual([
      {
        id: "legacy-failed-1",
        text: "retry only after review",
        createdAt: 1,
        sendError: "previous send failed",
      },
    ]);
  });

  it("does not restore in-flight sends that may already have reached the gateway", () => {
    persistChatComposerState(
      createState({
        chatQueue: [
          {
            id: "sending-1",
            text: "possibly already sent",
            createdAt: 1,
            sendRunId: "run-sending",
            sendState: "sending",
          },
        ],
      }),
    );

    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "test-token" },
          hello: { auth: { deviceToken: "test-device" } },
        },
        "agent:lily:main",
      ),
    ).toBeNull();
  });

  it("restores pre-request model-wait sends for manual retry only", () => {
    persistChatComposerState(
      createState({
        chatQueue: [
          {
            id: "waiting-model-1",
            text: "not sent yet",
            createdAt: 1,
            sendRunId: "run-waiting-model",
            sendState: "waiting-model",
          },
        ],
      }),
    );

    const restored = createState();
    expect(restoreChatComposerState(restored)).toBe(true);

    expect(restored.chatQueue).toEqual([
      {
        id: "waiting-model-1",
        text: "not sent yet",
        createdAt: 1,
        sendRunId: "run-waiting-model",
        sendState: "failed",
        sendError: "Model selection was interrupted. Review and retry when ready.",
      },
    ]);
  });

  it("removes one stored queued item without dropping the stored draft", () => {
    persistChatComposerState(
      createState({
        chatMessage: "keep this draft",
        chatQueue: [
          { id: "remove-me", text: "stale queued send", createdAt: 1 },
          { id: "keep-me", text: "still queued", createdAt: 2 },
        ],
      }),
    );

    removeStoredChatComposerQueueItem(createState(), "agent:lily:main", "remove-me");

    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "test-token" },
          hello: { auth: { deviceToken: "test-device" } },
        },
        "agent:lily:main",
      ),
    ).toEqual({
      draft: "keep this draft",
      queue: [{ id: "keep-me", text: "still queued", createdAt: 2 }],
    });
  });

  it("does not restore steered messages tied to a previous active run", () => {
    persistChatComposerState(
      createState({
        chatQueue: [
          {
            id: "steered-1",
            text: "stale steer",
            createdAt: 1,
            kind: "steered",
            pendingRunId: "run-before-refresh",
          },
        ],
      }),
    );

    expect(
      loadChatComposerSnapshot(
        {
          settings: { gatewayUrl: "ws://gateway.test/control", token: "test-token" },
          hello: { auth: { deviceToken: "test-device" } },
        },
        "agent:lily:main",
      ),
    ).toBeNull();
  });
});
