/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../app-view-state.ts";
import {
  createModelCatalog,
  createSessionsListResult,
  DEFAULT_CHAT_MODEL_CATALOG,
} from "../chat-model.test-helpers.ts";
import {
  getChatAttachmentDataUrl,
  resetChatAttachmentPayloadStoreForTest,
} from "../chat/attachment-payload-store.ts";
import { renderChatQueue } from "../chat/chat-queue.ts";
import { buildRawSidebarContent } from "../chat/chat-sidebar-raw.ts";
import { renderWelcomeState } from "../chat/chat-welcome.ts";
import { renderChatSessionSelect } from "../chat/session-controls.ts";
import type { ExecApprovalRequest } from "../controllers/exec-approval.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ModelCatalogEntry } from "../types.ts";
import type { ChatQueueItem } from "../ui-types.ts";
import { renderChat, resetChatViewState } from "./chat.ts";

const refreshVisibleToolsEffectiveForCurrentSessionMock = vi.hoisted(() =>
  vi.fn(async (state: AppViewState) => {
    const agentId = state.agentsSelectedId ?? "main";
    const sessionKey = state.sessionKey;
    await state.client?.request("tools.effective", { agentId, sessionKey });
    const override = state.chatModelOverrides[sessionKey];
    state.toolsEffectiveResultKey = `${agentId}:${sessionKey}:model=${override?.value ?? "(default)"}`;
    state.toolsEffectiveResult = { agentId, profile: "coding", groups: [] };
  }),
);
const loadSessionsMock = vi.hoisted(() =>
  vi.fn(async (state: AppViewState) => {
    const res = await state.client?.request("sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
    });
    if (res) {
      state.sessionsResult = res as AppViewState["sessionsResult"];
    }
  }),
);

vi.mock("../icons.ts", () => ({
  icons: {},
}));

vi.mock("../chat/build-chat-items.ts", () => ({
  buildChatItems: (props: {
    messages: unknown[];
    stream: string | null;
    streamStartedAt: number | null;
  }) => {
    if (
      props.messages.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          (message as { __testDivider?: unknown }).__testDivider === true,
      )
    ) {
      return [
        {
          kind: "divider",
          key: "divider:compaction:test",
          label: "Compacted history",
          description:
            "Earlier turns are preserved in a compaction checkpoint. Open session checkpoints to branch or restore that pre-compaction view.",
          action: {
            kind: "session-checkpoints",
            label: "Open checkpoints",
          },
          timestamp: 1,
        },
      ];
    }
    if (props.messages.length > 0) {
      return [
        {
          kind: "group",
          key: "group:assistant:test",
          role: "assistant",
          messages: props.messages.map((message, index) => ({
            key: `message:${index}`,
            message,
          })),
          timestamp: 1,
          isStreaming: false,
        },
      ];
    }
    if (props.stream !== null) {
      return props.stream
        ? [
            {
              kind: "stream",
              key: "stream:test",
              text: props.stream,
              startedAt: props.streamStartedAt ?? 1,
            },
          ]
        : [{ kind: "reading-indicator", key: "reading:test" }];
    }
    return [];
  },
}));

vi.mock("../chat/grouped-render.ts", () => ({
  renderMessageGroup: (
    group: { messages: Array<{ message: unknown }> },
    opts: {
      targetTranscriptSeq?: number | null;
      onUseProposedPlan?: (prompt: string) => void;
    } = {},
  ) => {
    const element = document.createElement("div");
    const matchesTarget = group.messages.some(({ message }) => {
      const meta =
        message && typeof message === "object" && !Array.isArray(message)
          ? (message as { __openclaw?: { seq?: unknown } }).__openclaw
          : null;
      return typeof opts.targetTranscriptSeq === "number" && meta?.seq === opts.targetTranscriptSeq;
    });
    element.className = matchesTarget ? "chat-group chat-bubble--run-target" : "chat-group";
    element.textContent = group.messages
      .map(({ message }) => {
        if (typeof message === "object" && message !== null && "content" in message) {
          const content = (message as { content?: unknown }).content;
          if (typeof content === "string") {
            return content;
          }
          return content == null ? "" : JSON.stringify(content);
        }
        return String(message);
      })
      .join("\n");
    if (element.textContent.includes("<proposed_plan>")) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Use plan";
      button.addEventListener("click", () => {
        opts.onUseProposedPlan?.("PLEASE IMPLEMENT THIS PLAN:\n# Plan");
      });
      element.append(button);
    }
    return element;
  },
  renderReadingIndicatorGroup: () => {
    const element = document.createElement("div");
    element.className = "chat-reading-indicator";
    return element;
  },
  renderStreamingGroup: (text: string) => {
    const element = document.createElement("div");
    element.className = "chat-stream";
    element.textContent = text;
    return element;
  },
}));

vi.mock("../markdown.ts", () => ({
  toSanitizedMarkdownHtml: (value: string) => value,
}));

vi.mock("../chat/tool-expansion-state.ts", () => ({
  getExpandedToolCards: () => new Map<string, boolean>(),
  syncToolCardExpansionState: () => undefined,
}));

vi.mock("../controllers/agents.ts", () => ({
  refreshVisibleToolsEffectiveForCurrentSession: refreshVisibleToolsEffectiveForCurrentSessionMock,
}));

vi.mock("../controllers/sessions.ts", () => ({
  loadSessions: loadSessionsMock,
}));

vi.mock("./agents-utils.ts", () => ({
  isRenderableControlUiAvatarUrl: (value: string) =>
    /^data:image\//i.test(value) || (value.startsWith("/") && !value.startsWith("//")),
  agentLogoUrl: () => "/openclaw-logo.svg",
  assistantAvatarFallbackUrl: () => "apple-touch-icon.png",
  resolveChatAvatarRenderUrl: (
    candidate: string | null | undefined,
    agent: { identity?: { avatar?: string; avatarUrl?: string } },
  ) => {
    const isRenderableControlUiAvatarUrl = (value: string) =>
      /^data:image\//i.test(value) || (value.startsWith("/") && !value.startsWith("//"));
    if (typeof candidate === "string" && candidate.startsWith("blob:")) {
      return candidate;
    }
    for (const value of [candidate, agent.identity?.avatarUrl, agent.identity?.avatar]) {
      if (typeof value === "string" && isRenderableControlUiAvatarUrl(value)) {
        return value;
      }
    }
    return null;
  },
  resolveAssistantTextAvatar: (value: string | null | undefined) => {
    if (!value) {
      return null;
    }
    return value.length <= 3 ? value : null;
  },
}));

function renderQueue(params: {
  queue: ChatQueueItem[];
  canAbort?: boolean;
  onQueueSteer?: (id: string) => void;
}) {
  const container = document.createElement("div");
  render(
    renderChatQueue({
      queue: params.queue,
      canAbort: params.canAbort ?? true,
      onQueueSteer: params.onQueueSteer,
      onQueueRemove: () => undefined,
    }),
    container,
  );
  return container;
}

function createChatHeaderState(
  overrides: {
    model?: string | null;
    modelProvider?: string | null;
    models?: ModelCatalogEntry[];
    defaultsThinkingDefault?: string;
    thinkingDefault?: string;
    omitSessionFromList?: boolean;
  } = {},
): { state: AppViewState; request: ReturnType<typeof vi.fn> } {
  let currentModel = overrides.model ?? null;
  let currentModelProvider = overrides.modelProvider ?? (currentModel ? "openai" : null);
  const omitSessionFromList = overrides.omitSessionFromList ?? false;
  const catalog = overrides.models ?? createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG);
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === "sessions.patch") {
      const nextModel = (params.model as string | null | undefined) ?? null;
      if (!nextModel) {
        currentModel = null;
        currentModelProvider = null;
      } else {
        const normalized = nextModel.trim();
        const slashIndex = normalized.indexOf("/");
        if (slashIndex > 0) {
          currentModelProvider = normalized.slice(0, slashIndex);
          currentModel = normalized.slice(slashIndex + 1);
        } else {
          currentModel = normalized;
          const matchingProviders = catalog
            .filter((entry) => entry.id === normalized)
            .map((entry) => entry.provider)
            .filter(Boolean);
          currentModelProvider =
            matchingProviders.length === 1 ? matchingProviders[0] : currentModelProvider;
        }
      }
      return { ok: true, key: "main" };
    }
    if (method === "chat.history") {
      return { messages: [], thinkingLevel: null };
    }
    if (method === "sessions.list") {
      return createSessionsListResult({
        model: currentModel,
        modelProvider: currentModelProvider,
        defaultsThinkingDefault: overrides.defaultsThinkingDefault,
        thinkingDefault: overrides.thinkingDefault,
        omitSessionFromList,
      });
    }
    if (method === "models.list") {
      return { models: catalog };
    }
    if (method === "tools.effective") {
      return {
        agentId: "main",
        profile: "coding",
        groups: [],
      };
    }
    throw new Error(`Unexpected request: ${method}`);
  });
  const state = {
    sessionKey: "main",
    connected: true,
    sessionsHideCron: true,
    sessionsResult: createSessionsListResult({
      model: currentModel,
      modelProvider: currentModelProvider,
      defaultsThinkingDefault: overrides.defaultsThinkingDefault,
      thinkingDefault: overrides.thinkingDefault,
      omitSessionFromList,
    }),
    chatModelOverrides: {},
    chatModelCatalog: catalog,
    chatModelsLoading: false,
    client: { request } as unknown as GatewayBrowserClient,
    settings: {
      gatewayUrl: "",
      token: "",
      locale: "en",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "claw",
      themeMode: "dark",
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
      borderRadius: 50,
      chatFocusMode: false,
      chatShowThinking: false,
    },
    chatMessage: "",
    chatStream: null,
    chatStreamStartedAt: null,
    chatRunId: null,
    chatQueue: [],
    chatMessages: [],
    chatLoading: false,
    chatThinkingLevel: null,
    lastError: null,
    chatAvatarUrl: null,
    basePath: "",
    hello: null,
    agentsList: null,
    agentsPanel: "overview",
    agentsSelectedId: null,
    toolsEffectiveLoading: false,
    toolsEffectiveLoadingKey: null,
    toolsEffectiveResultKey: null,
    toolsEffectiveError: null,
    toolsEffectiveResult: null,
    applySettings(next: AppViewState["settings"]) {
      state.settings = next;
    },
    loadAssistantIdentity: vi.fn(),
    resetToolStream: vi.fn(),
    resetChatScroll: vi.fn(),
  } as unknown as AppViewState & {
    client: GatewayBrowserClient;
    settings: AppViewState["settings"];
  };
  return { state, request };
}

async function flushTasks() {
  await vi.dynamicImportSettled();
}

function renderChatView(overrides: Partial<Parameters<typeof renderChat>[0]> = {}) {
  const container = document.createElement("div");
  render(
    renderChat({
      sessionKey: "main",
      onSessionKeyChange: () => undefined,
      thinkingLevel: null,
      showThinking: false,
      showToolCalls: true,
      loading: false,
      sending: false,
      compactionStatus: null,
      fallbackStatus: null,
      messages: [],
      sideResult: null,
      toolMessages: [],
      streamSegments: [],
      stream: null,
      streamStartedAt: null,
      assistantAvatarUrl: null,
      draft: "",
      queue: [],
      realtimeTalkActive: false,
      realtimeTalkStatus: "idle",
      realtimeTalkDetail: null,
      realtimeTalkTranscript: null,
      connected: true,
      canSend: true,
      disabledReason: null,
      error: null,
      sessions: null,
      focusMode: false,
      sidebarOpen: false,
      sidebarContent: null,
      sidebarError: null,
      splitRatio: 0.6,
      canvasPluginSurfaceUrl: null,
      embedSandboxMode: "scripts",
      allowExternalEmbedUrls: false,
      assistantName: "Val",
      assistantAvatar: null,
      userName: null,
      userAvatar: null,
      localMediaPreviewRoots: [],
      assistantAttachmentAuthToken: null,
      autoExpandToolCalls: false,
      attachments: [],
      onAttachmentsChange: () => undefined,
      showNewMessages: false,
      onScrollToBottom: () => undefined,
      onRefresh: () => undefined,
      onToggleFocusMode: () => undefined,
      getDraft: () => "",
      onDraftChange: () => undefined,
      onRequestUpdate: () => undefined,
      onSend: () => undefined,
      onCompact: () => undefined,
      onToggleRealtimeTalk: () => undefined,
      onDismissError: () => undefined,
      onAbort: () => undefined,
      onQueueRemove: () => undefined,
      onQueueSteer: () => undefined,
      onDismissSideResult: () => undefined,
      onNewSession: () => undefined,
      onClearHistory: () => undefined,
      onOpenSessionCheckpoints: () => undefined,
      agentsList: null,
      currentAgentId: "main",
      onAgentChange: () => undefined,
      onNavigateToAgent: () => undefined,
      onSessionSelect: () => undefined,
      onOpenSidebar: () => undefined,
      onCloseSidebar: () => undefined,
      onSplitRatioChange: () => undefined,
      onChatScroll: () => undefined,
      basePath: "",
      ...overrides,
    }),
    container,
  );
  return container;
}

describe("chat compaction divider", () => {
  it("falls back to the nearest historical assistant message when target run metadata is absent", () => {
    const auditTs = 1710000005000;
    const container = renderChatView({
      targetRunId: "run-historical-judge",
      targetAuditTs: auditTs,
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "older reply" }],
          timestamp: auditTs - 120_000,
          __openclaw: { seq: 3 },
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "guarded historical reply" }],
          timestamp: auditTs - 100,
          __openclaw: { seq: 4 },
        },
      ],
    });

    const bubble = container.querySelector<HTMLElement>(".chat-bubble--run-target");
    expect(bubble?.textContent).toContain("guarded historical reply");
  });

  it("scrolls the targeted Judge Guard transcript bubble into view once", async () => {
    const scrollIntoView = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      const auditTs = 1710000005000;
      renderChatView({
        targetRunId: "run-historical-judge-scroll",
        targetAuditTs: auditTs,
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "guarded historical reply" }],
            timestamp: auditTs - 100,
            __openclaw: { seq: 5 },
          },
        ],
      });

      await new Promise((resolve) => window.setTimeout(resolve, 0));

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("shows a target history action when a Judge Guard transcript target is not loaded", () => {
    const onLoadTargetHistory = vi.fn();
    const container = renderChatView({
      targetRunId: "run-missing-judge-target",
      targetAuditTs: 1710000005000,
      onLoadTargetHistory,
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "unrelated reply" }],
          timestamp: 1710000005000 - 3_600_000,
          __openclaw: { seq: 1 },
        },
      ],
    });

    const notice = container.querySelector<HTMLElement>(".chat-target-notice");
    expect(notice?.textContent).toContain("Judge Guard transcript target not found");
    expect(notice?.textContent).toContain("Load around target");
    notice?.querySelector("button")?.click();
    expect(onLoadTargetHistory).toHaveBeenCalledTimes(1);
  });

  it("shows exact Judge Guard target status after targeted history loads", () => {
    const container = renderChatView({
      targetRunId: "run-loaded-judge-target",
      targetStatus: "exact-run",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "target reply" }],
          timestamp: 1710000005000,
          __openclaw: { runId: "run-loaded-judge-target", seq: 1 },
        },
      ],
    });

    expect(container.querySelector(".chat-target-notice")?.textContent).toContain(
      "exact run match",
    );
  });

  it("shows fallback Judge Guard target status after timestamp fallback loads", () => {
    const container = renderChatView({
      targetRunId: "run-fallback-judge-target",
      targetAuditTs: 1710000005000,
      targetStatus: "timestamp-fallback",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "fallback reply" }],
          timestamp: 1710000004900,
          __openclaw: { seq: 1 },
        },
      ],
    });

    expect(container.querySelector(".chat-target-notice")?.textContent).toContain(
      "timestamp fallback",
    );
  });

  it("renders checkpoint recovery copy and action", () => {
    const onOpenSessionCheckpoints = vi.fn();
    const container = renderChatView({
      messages: [{ __testDivider: true }],
      onOpenSessionCheckpoints,
    });

    expect(container.textContent).toContain("Compacted history");
    expect(container.textContent).toContain("Earlier turns are preserved");
    const button = container.querySelector<HTMLButtonElement>(".chat-divider__action");
    expect(button?.textContent).toContain("Open checkpoints");

    button?.click();

    expect(onOpenSessionCheckpoints).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  loadSessionsMock.mockClear();
  refreshVisibleToolsEffectiveForCurrentSessionMock.mockClear();
  resetChatViewState();
  resetChatAttachmentPayloadStoreForTest();
  vi.unstubAllGlobals();
});

describe("chat loading skeleton", () => {
  it("shows the skeleton while the initial history load has no rendered content", () => {
    const container = renderChatView({ loading: true });

    expect(container.querySelector(".chat-loading-skeleton")).not.toBeNull();
    expect(container.querySelector(".agent-chat__welcome")).toBeNull();
  });

  it("keeps existing messages visible without the skeleton during a background reload", () => {
    const container = renderChatView({
      loading: true,
      messages: [
        {
          role: "assistant",
          content: "Already loaded answer",
          timestamp: 1,
        },
      ],
    });

    expect(container.querySelector(".chat-loading-skeleton")).toBeNull();
    expect(container.textContent).toContain("Already loaded answer");
  });

  it("keeps active stream content visible without the skeleton during a background reload", () => {
    const container = renderChatView({
      loading: true,
      stream: "Partial streamed answer",
      streamStartedAt: 1,
    });

    expect(container.querySelector(".chat-loading-skeleton")).toBeNull();
    expect(container.textContent).toContain("Partial streamed answer");
  });

  it("keeps the reading indicator visible without the skeleton before stream text arrives", () => {
    const container = renderChatView({
      loading: true,
      stream: "",
      streamStartedAt: 1,
    });

    expect(container.querySelector(".chat-loading-skeleton")).toBeNull();
    expect(container.querySelector(".chat-reading-indicator")).not.toBeNull();
  });
});

describe("chat voice controls", () => {
  it("keeps Talk visible without the stale browser dictation button", () => {
    const container = renderChatView();

    expect(container.querySelector('[aria-label="Start Talk"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Voice input"]')).toBeNull();
  });

  it("lets users dismiss Talk start errors", () => {
    const onDismissError = vi.fn();
    const container = renderChatView({
      error: 'Realtime voice provider "openai" is not configured',
      realtimeTalkStatus: "error",
      realtimeTalkDetail: 'Realtime voice provider "openai" is not configured',
      onDismissError,
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Realtime voice provider "openai" is not configured',
    );

    container.querySelector<HTMLButtonElement>('[aria-label="Dismiss error"]')?.click();

    expect(onDismissError).toHaveBeenCalledTimes(1);
  });
});

describe("chat slash menu accessibility", () => {
  function inputDraft(container: HTMLElement, value: string) {
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).not.toBeNull();
    textarea!.value = value;
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function keydownComposer(container: HTMLElement, key: string) {
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).not.toBeNull();
    textarea!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  }

  it("wires command suggestions to the composer with stable active option ids", () => {
    let draft = "";
    const onDraftChange = vi.fn((next: string) => {
      draft = next;
    });
    let container = renderChatView({ draft, onDraftChange });

    inputDraft(container, "/");
    container = renderChatView({ draft, onDraftChange });

    const wrapper = container.querySelector<HTMLElement>(".agent-chat__composer-combobox");
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    const listbox = container.querySelector<HTMLElement>("#chat-slash-menu-listbox");
    const activeId = textarea?.getAttribute("aria-activedescendant");

    expect(wrapper?.hasAttribute("role")).toBe(false);
    expect(wrapper?.hasAttribute("aria-expanded")).toBe(false);
    expect(wrapper?.hasAttribute("aria-haspopup")).toBe(false);
    expect(wrapper?.hasAttribute("aria-controls")).toBe(false);
    expect(textarea?.hasAttribute("role")).toBe(false);
    expect(textarea?.hasAttribute("aria-expanded")).toBe(false);
    expect(textarea?.hasAttribute("aria-haspopup")).toBe(false);
    expect(textarea?.getAttribute("aria-controls")).toBe("chat-slash-menu-listbox");
    expect(textarea?.getAttribute("aria-autocomplete")).toBe("list");
    expect(listbox?.getAttribute("role")).toBe("listbox");
    expect(activeId).toMatch(/^chat-slash-option-command-/u);
    expect(listbox?.querySelector(`#${activeId}`)?.getAttribute("role")).toBe("option");
  });

  it("updates the active descendant and live announcement during command navigation", () => {
    let draft = "";
    const onDraftChange = vi.fn((next: string) => {
      draft = next;
    });
    let container = renderChatView({ draft, onDraftChange });

    inputDraft(container, "/");
    container = renderChatView({ draft, onDraftChange });
    const initialActiveId = container
      .querySelector<HTMLTextAreaElement>("textarea")
      ?.getAttribute("aria-activedescendant");

    keydownComposer(container, "ArrowDown");
    container = renderChatView({ draft, onDraftChange });

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    const nextActiveId = textarea?.getAttribute("aria-activedescendant");
    const activeOption = nextActiveId
      ? container.querySelector<HTMLElement>(`#${nextActiveId}`)
      : null;
    const status = container.querySelector<HTMLElement>("#chat-slash-active-announcement");

    expect(nextActiveId).toBeTruthy();
    expect(nextActiveId).not.toBe(initialActiveId);
    expect(activeOption?.getAttribute("aria-selected")).toBe("true");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent?.trim()).toBeTruthy();
    expect(status?.textContent).toContain(activeOption?.textContent?.trim().split(/\s+/u)[0]);
  });

  it("wires fixed argument suggestions with command-and-argument option ids", () => {
    let draft = "";
    const onDraftChange = vi.fn((next: string) => {
      draft = next;
    });
    let container = renderChatView({ draft, onDraftChange });

    inputDraft(container, "/tools ");
    container = renderChatView({ draft, onDraftChange });

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    const listbox = container.querySelector<HTMLElement>("#chat-slash-menu-listbox");
    const activeId = textarea?.getAttribute("aria-activedescendant");

    expect(listbox?.getAttribute("aria-label")).toBe("Command arguments");
    expect(activeId).toBe("chat-slash-option-arg-tools-compact");
    expect(listbox?.querySelector(`#${activeId}`)?.getAttribute("aria-selected")).toBe("true");
  });

  it("clears active descendant when suggestions close", () => {
    let draft = "";
    const onDraftChange = vi.fn((next: string) => {
      draft = next;
    });
    let container = renderChatView({ draft, onDraftChange });

    inputDraft(container, "/");
    container = renderChatView({ draft, onDraftChange });
    expect(
      container
        .querySelector<HTMLTextAreaElement>("textarea")
        ?.getAttribute("aria-activedescendant"),
    ).toBeTruthy();

    inputDraft(container, "plain message");
    container = renderChatView({ draft, onDraftChange });

    expect(container.querySelector(".slash-menu")).toBeNull();
    expect(
      container.querySelector<HTMLTextAreaElement>("textarea")?.hasAttribute("aria-expanded"),
    ).toBe(false);
    expect(
      container
        .querySelector<HTMLElement>(".agent-chat__composer-combobox")
        ?.hasAttribute("aria-expanded"),
    ).toBe(false);
    expect(
      container
        .querySelector<HTMLTextAreaElement>("textarea")
        ?.hasAttribute("aria-activedescendant"),
    ).toBe(false);
  });
});

describe("chat attachment picker", () => {
  it("accepts and previews non-video file attachments", async () => {
    const onAttachmentsChange = vi.fn();
    const container = renderChatView({ onAttachmentsChange });
    const input = container.querySelector<HTMLInputElement>(".agent-chat__file-input");
    const file = new File(["%PDF-1.4\n"], "brief.pdf", { type: "application/pdf" });

    expect(input).not.toBeNull();
    Object.defineProperty(input!, "files", {
      configurable: true,
      value: [file],
    });
    input?.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect(onAttachmentsChange).toHaveBeenCalledWith([
        expect.objectContaining({
          fileName: "brief.pdf",
          mimeType: "application/pdf",
          sizeBytes: file.size,
        }),
      ]);
    });

    const nextAttachments = onAttachmentsChange.mock.calls[0]?.[0] ?? [];
    expect(getChatAttachmentDataUrl(nextAttachments[0])).toMatch(/^data:application\/pdf;base64,/);
    const preview = renderChatView({ attachments: nextAttachments });
    expect(preview.querySelector(".chat-attachment-thumb--file")).not.toBeNull();
    expect(preview.textContent).toContain("brief.pdf");
  });

  it("filters video file attachments", () => {
    const onAttachmentsChange = vi.fn();
    const container = renderChatView({ onAttachmentsChange });
    const input = container.querySelector<HTMLInputElement>(".agent-chat__file-input");
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });

    expect(input).not.toBeNull();
    Object.defineProperty(input!, "files", {
      configurable: true,
      value: [file],
    });
    input?.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onAttachmentsChange).not.toHaveBeenCalled();
  });
});

describe("chat queue", () => {
  it("renders Steer only for queued messages during an active run", () => {
    const onQueueSteer = vi.fn();
    const container = renderQueue({
      onQueueSteer,
      queue: [
        { id: "queued-1", text: "tighten the plan", createdAt: 1 },
        { id: "steered-1", text: "already sent", createdAt: 2, kind: "steered" },
        { id: "local-1", text: "/status", createdAt: 3, localCommandName: "status" },
      ],
    });

    const steerButtons = container.querySelectorAll<HTMLButtonElement>(".chat-queue__steer");
    expect(steerButtons).toHaveLength(1);
    expect(steerButtons[0].textContent?.trim()).toBe("Steer");
    expect(container.querySelector(".chat-queue__badge")?.textContent?.trim()).toBe("Steered");

    steerButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onQueueSteer).toHaveBeenCalledWith("queued-1");

    const inactiveContainer = renderQueue({
      canAbort: false,
      onQueueSteer: vi.fn(),
      queue: [{ id: "queued-1", text: "tighten the plan", createdAt: 1 }],
    });

    expect(inactiveContainer.querySelector(".chat-queue__steer")).toBeNull();
  });
});

describe("chat sidebar raw content", () => {
  it("keeps markdown raw text toggles idempotent", () => {
    const rawMarkdown = "```ts\nconst value = 1;\n```";

    expect(
      buildRawSidebarContent({
        kind: "markdown",
        content: `\`\`\`\n${rawMarkdown}\n\`\`\``,
        rawText: rawMarkdown,
      }),
    ).toEqual({
      kind: "markdown",
      content: `\`\`\`\n${rawMarkdown}\n\`\`\``,
      rawText: rawMarkdown,
    });
  });
});

describe("chat welcome", () => {
  function renderWelcome(params: {
    assistantAvatar: string | null;
    assistantAvatarUrl?: string | null;
  }) {
    const container = document.createElement("div");
    render(
      renderWelcomeState({
        assistantName: "Val",
        assistantAvatar: params.assistantAvatar,
        assistantAvatarUrl: params.assistantAvatarUrl,
        onDraftChange: () => undefined,
        onSend: () => undefined,
      }),
      container,
    );
    return container;
  }

  it("renders configured assistant avatars and fallback in the welcome state", () => {
    let container = renderWelcome({ assistantAvatar: "VC", assistantAvatarUrl: null });

    const avatar = container.querySelector<HTMLElement>(".agent-chat__avatar");
    expect(avatar).not.toBeNull();
    expect(avatar?.tagName).toBe("DIV");
    expect(avatar?.textContent).toContain("VC");
    expect(avatar?.getAttribute("aria-label")).toBe("Val");

    container = renderWelcome({
      assistantAvatar: "avatars/val.png",
      assistantAvatarUrl: "blob:identity-avatar",
    });

    const imageAvatar = container.querySelector<HTMLImageElement>("img");
    expect(imageAvatar).not.toBeNull();
    expect(imageAvatar?.getAttribute("src")).toBe("blob:identity-avatar");
    expect(imageAvatar?.getAttribute("alt")).toBe("Val");
    expect(imageAvatar?.getAttribute("style")).toContain("width:108px");
    expect(imageAvatar?.getAttribute("style")).toContain("height:108px");

    container = renderWelcome({ assistantAvatar: null, assistantAvatarUrl: null });

    const fallbackAvatar = container.querySelector<HTMLImageElement>(
      ".agent-chat__avatar--logo img",
    );
    expect(fallbackAvatar).not.toBeNull();
    expect(fallbackAvatar?.getAttribute("src")).toBe("apple-touch-icon.png");
    expect(fallbackAvatar?.getAttribute("alt")).toBe("Val");
  });
});

describe("chat session controls", () => {
  it("filters chat sessions by agent and switches to that agent's recent session", async () => {
    const { state } = createChatHeaderState();
    const onSwitchSession = vi.fn();
    state.sessionKey = "agent:alpha:main";
    state.agentsList = {
      defaultId: "alpha",
      mainKey: "agent:alpha:main",
      scope: "all",
      agents: [
        { id: "alpha", name: "Deep Chat" },
        { id: "beta", name: "Coding" },
      ],
    };
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 4,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        { key: "agent:alpha:main", kind: "direct", updatedAt: 4 },
        { key: "agent:alpha:dashboard:alpha-recent", kind: "direct", updatedAt: 3 },
        { key: "agent:beta:dashboard:beta-recent", kind: "direct", updatedAt: 2 },
        { key: "agent:beta:main", kind: "direct", updatedAt: 1 },
      ],
    };

    const container = document.createElement("div");
    render(renderChatSessionSelect(state, onSwitchSession), container);

    const agentSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-agent-filter="true"]',
    );
    const sessionSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-session-select="true"]',
    );

    expect(agentSelect?.value).toBe("alpha");
    expect([...sessionSelect!.options].map((option) => option.value)).toEqual([
      "agent:alpha:main",
      "agent:alpha:dashboard:alpha-recent",
    ]);

    agentSelect!.value = "beta";
    agentSelect!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onSwitchSession).toHaveBeenCalledWith(state, "agent:beta:dashboard:beta-recent");
  });

  it("falls back to the selected agent's main session when no sessions exist yet", async () => {
    const { state } = createChatHeaderState();
    const onSwitchSession = vi.fn();
    state.sessionKey = "agent:alpha:main";
    state.agentsList = {
      defaultId: "alpha",
      mainKey: "agent:alpha:main",
      scope: "all",
      agents: [
        { id: "alpha", name: "Deep Chat" },
        { id: "beta", name: "Coding" },
      ],
    };
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 1,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [{ key: "agent:alpha:main", kind: "direct", updatedAt: 4 }],
    };

    const container = document.createElement("div");
    render(renderChatSessionSelect(state, onSwitchSession), container);

    const agentSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-agent-filter="true"]',
    );
    expect(agentSelect).not.toBeNull();

    agentSelect!.value = "beta";
    agentSelect!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onSwitchSession).toHaveBeenCalledWith(state, "agent:beta:main");
  });

  it("renders session switch feedback in the chat controls live region", () => {
    const { state } = createChatHeaderState();
    state.sessionSwitchNotice = { id: 1, text: "Switched to Coding" };
    state.sessionSwitchFlashKey = state.sessionKey;

    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const notice = container.querySelector<HTMLElement>(".chat-controls__session-notice");
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.getAttribute("aria-live")).toBe("polite");
    expect(notice?.textContent?.trim()).toBe("Switched to Coding");
    expect(container.querySelector(".chat-controls__session-row--flash")).not.toBeNull();
  });

  it("shows the active agent main session instead of a blank select when no row exists yet", () => {
    const { state } = createChatHeaderState();
    state.sessionKey = "agent:main:main";
    state.settings.sessionKey = "agent:main:main";
    state.agentsList = {
      defaultId: "main",
      mainKey: "agent:main:main",
      scope: "all",
      agents: [{ id: "main", name: "MB Black" }],
    };
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 0,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const sessionSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-session-select="true"]',
    );

    expect(sessionSelect?.value).toBe("agent:main:main");
    expect([...sessionSelect!.options].map((option) => option.value)).toEqual(["agent:main:main"]);
    expect(sessionSelect?.selectedOptions[0]?.textContent?.trim()).toBe("main");
  });

  it("patches the current session model and refreshes active tool visibility", async () => {
    const { state, request } = createChatHeaderState();
    state.agentsPanel = "tools";
    state.agentsSelectedId = "main";
    state.toolsEffectiveResultKey = "main:main";
    state.toolsEffectiveResult = {
      agentId: "main",
      profile: "coding",
      groups: [],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.value).toBe("");

    modelSelect!.value = "openai/gpt-5-mini";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      model: "openai/gpt-5-mini",
    });
    expect(request).not.toHaveBeenCalledWith("chat.history", expect.anything());
    await flushTasks();
    expect(loadSessionsMock).toHaveBeenCalledTimes(1);
    expect(state.sessionsResult?.sessions[0]?.model).toBe("gpt-5-mini");
    expect(state.sessionsResult?.sessions[0]?.modelProvider).toBe("openai");
    expect(request).toHaveBeenCalledWith("tools.effective", {
      agentId: "main",
      sessionKey: "main",
    });
    expect(state.toolsEffectiveResultKey).toBe("main:main:model=openai/gpt-5-mini");
  });

  it("clears the session model override back to the default model", async () => {
    const { state, request } = createChatHeaderState({ model: "gpt-5-mini" });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.value).toBe("openai/gpt-5-mini");

    modelSelect!.value = "";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      model: null,
    });
    await flushTasks();
    expect(loadSessionsMock).toHaveBeenCalledTimes(1);
    expect(state.sessionsResult?.sessions[0]?.model).toBeUndefined();
  });

  it("disables the chat header model picker while a run is active", () => {
    const { state } = createChatHeaderState();
    state.chatRunId = "run-123";
    state.chatStream = "Working";
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.disabled).toBe(true);
  });

  it("keeps the selected model visible when the active session is absent from sessions.list", async () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();

    modelSelect!.value = "openai/gpt-5-mini";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();
    render(renderChatSessionSelect(state), container);

    const rerendered = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(rerendered?.value).toBe("openai/gpt-5-mini");
  });

  it("uses default thinking options when the active session is absent", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionsResult = createSessionsListResult({
      defaultsModel: "gpt-5.5",
      defaultsProvider: "openai-codex",
      defaultsThinkingLevels: [
        { id: "off", label: "off" },
        { id: "adaptive", label: "adaptive" },
        { id: "xhigh", label: "xhigh" },
        { id: "max", label: "maximum" },
      ],
      omitSessionFromList: true,
    });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const thinkingSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-thinking-select="true"]',
    );
    const options = [...(thinkingSelect?.options ?? [])].map((option) => option.value);

    expect(options).toContain("adaptive");
    expect(options).toContain("xhigh");
    expect(options).toContain("max");
    expect(
      [...(thinkingSelect?.options ?? [])]
        .find((option) => option.value === "max")
        ?.textContent?.trim(),
    ).toBe("maximum");
  });

  it("labels chat thinking default from the active session row", () => {
    const { state } = createChatHeaderState({
      model: "gemma4:hermes-e4b",
      modelProvider: "ollama",
      thinkingDefault: "adaptive",
    });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const thinkingSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-thinking-select="true"]',
    );

    expect(thinkingSelect?.value).toBe("");
    expect(thinkingSelect?.options[0]?.textContent?.trim()).toBe("Default (adaptive)");
    expect(thinkingSelect?.title).toBe("Default (adaptive)");
  });

  it("always renders full thinking labels", () => {
    const { state } = createChatHeaderState({
      model: "gpt-5.5",
      modelProvider: "openai-codex",
      thinkingDefault: "high",
    });
    state.sessionsResult = createSessionsListResult({
      defaultsModel: "gpt-5.5",
      defaultsProvider: "openai-codex",
      defaultsThinkingDefault: "high",
      defaultsThinkingLevels: [
        { id: "off", label: "off" },
        { id: "low", label: "low" },
        { id: "medium", label: "medium" },
        { id: "high", label: "high" },
        { id: "xhigh", label: "xhigh" },
      ],
    });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const thinkingSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-thinking-select="true"]',
    );

    expect(container.querySelector('select[data-chat-thinking-select-compact="true"]')).toBeNull();
    expect(thinkingSelect?.value).toBe("");
    expect(thinkingSelect?.title).toBe("Default (high)");
    expect([...thinkingSelect!.options].map((option) => option.textContent?.trim())).toEqual([
      "Default (high)",
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("labels chat thinking default from session defaults when the row is absent", () => {
    const { state } = createChatHeaderState({
      defaultsThinkingDefault: "adaptive",
      omitSessionFromList: true,
    });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const thinkingSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-thinking-select="true"]',
    );

    expect(thinkingSelect?.value).toBe("");
    expect(thinkingSelect?.options[0]?.textContent?.trim()).toBe("Default (adaptive)");
    expect(thinkingSelect?.title).toBe("Default (adaptive)");
  });
});

describe("chat Working Now surface", () => {
  it("renders an idle empty state", () => {
    const container = renderChatView();

    expect(container.querySelector("[data-chat-work-surface]")?.textContent).toContain(
      "Nothing running",
    );
    expect(container.querySelector("[data-chat-work-surface]")?.textContent).toContain(
      "Nothing is running.",
    );
  });

  it("renders active run, queue, task, and active session actions", () => {
    const onAbort = vi.fn();
    const onQueueRemove = vi.fn();
    const onWorkTaskCancel = vi.fn();
    const onSessionSelect = vi.fn();
    const container = renderChatView({
      canAbort: true,
      runStatus: { phase: "using_tool", detail: "checking files", runId: "run-1", updatedAt: 100 },
      queue: [{ id: "queue-1", text: "follow up", createdAt: 90 }],
      workTasks: [
        {
          id: "task-1",
          taskId: "task-1",
          title: "Remote proof",
          status: "running",
          progressSummary: "Watching CI",
          updatedAt: 80,
        },
      ],
      sessions: {
        ts: 0,
        path: "",
        count: 1,
        defaults: { modelProvider: null, model: null, contextTokens: null },
        sessions: [
          {
            key: "agent:main:research",
            kind: "direct",
            displayName: "Research lane",
            updatedAt: 70,
            hasActiveRun: true,
          },
        ],
      },
      onAbort,
      onQueueRemove,
      onWorkTaskCancel,
      onSessionSelect,
    });

    const surface = container.querySelector<HTMLElement>("[data-chat-work-surface]");
    expect(surface?.textContent).toContain("Working");
    expect(surface?.textContent).toContain("Val is checking files");
    expect(surface?.textContent).toContain("follow up");
    expect(surface?.textContent).toContain("Remote proof");
    expect(surface?.textContent).toContain("Watching CI");
    expect(surface?.textContent).toContain("Research lane");

    const buttons = [...surface!.querySelectorAll<HTMLButtonElement>("button")];
    buttons.find((button) => button.textContent?.includes("Stop"))?.click();
    buttons.find((button) => button.textContent?.includes("Remove"))?.click();
    buttons.find((button) => button.textContent?.includes("Cancel"))?.click();
    buttons.find((button) => button.textContent?.includes("Open"))?.click();

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onQueueRemove).toHaveBeenCalledWith("queue-1");
    expect(onWorkTaskCancel).toHaveBeenCalledWith("task-1");
    expect(onSessionSelect).toHaveBeenCalledWith("agent:main:research");
  });

  it("renders work status failures without hiding current work", () => {
    const container = renderChatView({
      workTasksError: "offline",
      workTasks: [{ id: "task-1", title: "Still visible", status: "running" }],
    });

    const surface = container.querySelector<HTMLElement>("[data-chat-work-surface]");
    expect(surface?.textContent).toContain("Work status unavailable");
    expect(surface?.textContent).toContain("Still visible");
  });

  it("does not render cancel for tasks without a task id", () => {
    const container = renderChatView({
      workTasks: [{ title: "No id task", status: "running" }],
    });

    const surface = container.querySelector<HTMLElement>("[data-chat-work-surface]");
    expect(surface?.textContent).toContain("No id task");
    expect(
      [...surface!.querySelectorAll("button")].map((button) => button.textContent),
    ).not.toContain("Cancel");
  });
});

describe("chat approval cards", () => {
  const execApproval = (overrides: Partial<ExecApprovalRequest> = {}): ExecApprovalRequest => {
    const createdAtMs = Date.now();
    return {
      id: "approval-exec-1",
      kind: "exec",
      request: {
        command: "pnpm test ui/src/ui/views/chat.test.ts",
        cwd: "/Users/openclaw/OpenClaw",
        host: "gateway",
        security: "allowlist",
        ask: "on-miss",
        agentId: "main",
        resolvedPath: "/Users/openclaw/OpenClaw/node_modules/.bin/pnpm",
        sessionKey: "agent:main:chat",
        commandSpans: [{ startIndex: 0, endIndex: 9 }],
      },
      createdAtMs,
      expiresAtMs: createdAtMs + 120_000,
      ...overrides,
    };
  };
  const pluginApproval = (overrides: Partial<ExecApprovalRequest> = {}): ExecApprovalRequest => {
    const createdAtMs = Date.now();
    return {
      id: "approval-plugin-1",
      kind: "plugin",
      request: {
        command: "Install Calendar plugin",
        agentId: "main",
        sessionKey: "agent:main:chat",
      },
      pluginTitle: "Install Calendar plugin",
      pluginDescription: "Calendar access for scheduling tasks.",
      pluginSeverity: "medium",
      pluginId: "calendar",
      createdAtMs,
      expiresAtMs: createdAtMs + 300_000,
      ...overrides,
    };
  };

  it("does not render an intrusive card when no approval is pending", () => {
    const container = renderChatView({ execApprovalQueue: [] });

    expect(container.querySelector("[data-chat-approval-card]")).toBeNull();
  });

  it("renders exec approval metadata, highlighted command, and decisions", () => {
    const onExecApprovalDecision = vi.fn();
    const container = renderChatView({
      execApprovalQueue: [execApproval()],
      onExecApprovalDecision,
    });

    const card = container.querySelector<HTMLElement>("[data-chat-approval-card]")!;
    expect(card.textContent).toContain("Approval needed");
    expect(card.textContent).toContain("Exec approval needed");
    expect(card.textContent).toContain("pnpm test ui/src/ui/views/chat.test.ts");
    expect(card.textContent).toContain("gateway");
    expect(card.textContent).toContain("main");
    expect(card.textContent).toContain("agent:main:chat");
    expect(card.textContent).toContain("allowlist");
    expect(card.textContent).toContain("on-miss");
    expect(card.textContent).toContain("Expires in");
    expect(card.querySelector(".chat-approval-card__command-span")?.textContent).toBe("pnpm test");

    const buttons = [...card.querySelectorAll<HTMLButtonElement>("button")];
    buttons.find((button) => button.textContent?.includes("Allow once"))?.click();
    buttons.find((button) => button.textContent?.includes("Always allow"))?.click();
    buttons.find((button) => button.textContent?.includes("Deny"))?.click();

    expect(onExecApprovalDecision).toHaveBeenNthCalledWith(1, "allow-once");
    expect(onExecApprovalDecision).toHaveBeenNthCalledWith(2, "allow-always");
    expect(onExecApprovalDecision).toHaveBeenNthCalledWith(3, "deny");
  });

  it("renders plugin approval details and queue count", () => {
    const onExecApprovalDecision = vi.fn();
    const container = renderChatView({
      execApprovalQueue: [pluginApproval(), execApproval({ id: "approval-exec-2" })],
      onExecApprovalDecision,
    });

    const card = container.querySelector<HTMLElement>("[data-chat-approval-card]")!;
    expect(card.textContent).toContain("Install Calendar plugin");
    expect(card.textContent).toContain("Calendar access for scheduling tasks.");
    expect(card.textContent).toContain("medium");
    expect(card.textContent).toContain("calendar");
    expect(card.textContent).toContain("2 pending");

    card
      .querySelector<HTMLButtonElement>("button.danger, .btn.danger")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onExecApprovalDecision).toHaveBeenCalledWith("deny");
  });

  it("disables approval buttons while busy", () => {
    const container = renderChatView({
      execApprovalQueue: [execApproval()],
      execApprovalBusy: true,
    });

    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>("[data-chat-approval-card] button"),
    ];
    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it("renders errors while keeping the composer usable", () => {
    const onSend = vi.fn();
    const container = renderChatView({
      draft: "continue",
      getDraft: () => "continue",
      execApprovalQueue: [execApproval()],
      execApprovalError: "Approval failed: offline",
      onSend,
    });

    expect(container.querySelector("[data-chat-approval-card]")?.textContent).toContain(
      "Approval failed: offline",
    );
    container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')?.click();
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe("chat Plan Mode cards", () => {
  it("loads a proposed plan into the composer without sending it", () => {
    const onDraftChange = vi.fn();
    const onSend = vi.fn();
    const container = renderChatView({
      messages: [
        {
          role: "assistant",
          content: "<proposed_plan>\n# Plan\n</proposed_plan>",
        },
      ],
      onDraftChange,
      onSend,
    });

    const usePlanButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Use plan"),
    );
    expect(usePlanButton).toBeInstanceOf(HTMLButtonElement);
    usePlanButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onDraftChange).toHaveBeenCalledWith("PLEASE IMPLEMENT THIS PLAN:\n# Plan");
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("chat project picker", () => {
  const projectsList = {
    ok: true as const,
    ts: 1,
    count: 2,
    projects: [
      {
        id: "project-alpha",
        name: "Alpha Project",
        description: "Research context",
        memoryMode: "project_only" as const,
        createdAt: 1,
        updatedAt: 2,
        resources: [],
      },
      {
        id: "project-beta",
        name: "Beta Project",
        memoryMode: "project_only" as const,
        createdAt: 1,
        updatedAt: 3,
        resources: [],
      },
    ],
  };

  it("renders No Project when the active chat has no project id", () => {
    const container = renderChatView({
      projectsList,
      sessions: {
        ts: 0,
        path: "",
        count: 1,
        defaults: { modelProvider: null, model: null, contextTokens: null },
        sessions: [{ key: "main", kind: "direct", updatedAt: 1 }],
      },
    });

    expect(container.querySelector("[data-chat-project-picker]")?.textContent).toContain(
      "No Project",
    );
  });

  it("renders the current project name from the active session row", () => {
    const container = renderChatView({
      projectsList,
      sessions: {
        ts: 0,
        path: "",
        count: 1,
        defaults: { modelProvider: null, model: null, contextTokens: null },
        sessions: [
          {
            key: "main",
            kind: "direct",
            updatedAt: 1,
            projectId: "project-alpha",
          },
        ],
      },
    });

    expect(container.querySelector("[data-chat-project-picker]")?.textContent).toContain(
      "Alpha Project",
    );
  });

  it("exposes attach, detach, new-chat, and create actions", () => {
    const onProjectAttach = vi.fn();
    const onProjectDetach = vi.fn();
    const onNewProjectChat = vi.fn();
    const onProjectCreateAndAttach = vi.fn();
    const onProjectCreateFieldChange = vi.fn();
    const container = renderChatView({
      projectPickerOpen: true,
      projectCreateName: "New plan",
      projectsList,
      sessions: {
        ts: 0,
        path: "",
        count: 1,
        defaults: { modelProvider: null, model: null, contextTokens: null },
        sessions: [
          {
            key: "main",
            kind: "direct",
            updatedAt: 1,
            projectId: "project-alpha",
          },
        ],
      },
      onProjectAttach,
      onProjectDetach,
      onNewProjectChat,
      onProjectCreateAndAttach,
      onProjectCreateFieldChange,
    });

    const picker = container.querySelector<HTMLElement>("[data-chat-project-picker]")!;
    picker.querySelector<HTMLButtonElement>('[data-chat-project-action="attach"]')?.click();
    picker.querySelector<HTMLButtonElement>('[data-chat-project-action="detach"]')?.click();
    picker.querySelector<HTMLButtonElement>('[data-chat-project-action="new-chat"]')?.click();
    picker
      .querySelector<HTMLButtonElement>('[data-chat-project-action="create-and-attach"]')
      ?.click();
    const nameInput = picker.querySelector<HTMLInputElement>('input[placeholder="Project name"]')!;
    nameInput.value = "Edited plan";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onProjectAttach).toHaveBeenCalledWith("project-beta");
    expect(onProjectDetach).toHaveBeenCalledTimes(1);
    expect(onNewProjectChat).toHaveBeenCalledWith("project-alpha");
    expect(onProjectCreateAndAttach).toHaveBeenCalledTimes(1);
    expect(onProjectCreateFieldChange).toHaveBeenCalledWith("name", "Edited plan");
  });

  it("renders project loading failures without disabling chat", () => {
    const onSend = vi.fn();
    const container = renderChatView({
      projectPickerOpen: true,
      projectError: "offline",
      draft: "hello",
      getDraft: () => "hello",
      onSend,
    });

    const picker = container.querySelector<HTMLElement>("[data-chat-project-picker]");
    expect(picker?.textContent).toContain("Project status unavailable");
    container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')?.click();
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe("chat Pursue Goal surface", () => {
  it("renders no-goal state and starts from the draft", () => {
    const onGoalStart = vi.fn();
    const onGoalDraftChange = vi.fn();
    const container = renderChatView({
      draft: "Fix the flaky proof",
      getDraft: () => "Fix the flaky proof",
      goalPanelOpen: true,
      goalDraft: "Ship the feature with proof",
      onGoalStart,
      onGoalDraftChange,
    });

    const surface = container.querySelector<HTMLElement>("[data-chat-goal]");
    expect(surface?.textContent).toContain("Pursue Goal");
    expect(surface?.textContent).toContain("No goal");
    expect(surface?.textContent).toContain("Create durable work from the current request");

    surface?.querySelector<HTMLButtonElement>('[data-chat-goal-action="start"]')?.click();
    expect(onGoalStart).toHaveBeenCalledTimes(1);

    const goalInput = surface?.querySelector<HTMLTextAreaElement>("textarea");
    goalInput!.value = "Updated goal";
    goalInput!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onGoalDraftChange).toHaveBeenCalledWith("Updated goal");
  });

  it("renders running goal details and exposes continue and cancel actions", () => {
    const onGoalContinue = vi.fn();
    const onGoalCancel = vi.fn();
    const container = renderChatView({
      goalPanelOpen: true,
      goalFlows: [
        {
          id: "flow-1",
          flowId: "flow-1",
          status: "running",
          goal: "Finish Pursue Goal V1",
          currentStep: "Running local proof.",
          tasks: [
            {
              taskId: "task-1",
              status: "running",
              progressSummary: "Testing gateway linkage",
              judgeStatus: "pending",
            },
          ],
        },
      ],
      onGoalContinue,
      onGoalCancel,
    });

    const surface = container.querySelector<HTMLElement>("[data-chat-goal]")!;
    expect(surface.textContent).toContain("Finish Pursue Goal V1");
    expect(surface.textContent).toContain("Pursuing");
    expect(surface.textContent).toContain("Testing gateway linkage");
    expect(surface.textContent).toContain("Judge pending");

    surface.querySelector<HTMLButtonElement>('[data-chat-goal-action="continue"]')?.click();
    surface.querySelector<HTMLButtonElement>('[data-chat-goal-action="cancel"]')?.click();

    expect(onGoalContinue).toHaveBeenCalledWith("flow-1");
    expect(onGoalCancel).toHaveBeenCalledWith("flow-1");
  });

  it("shows blocked and cancelled states without enabling unsafe continuation", () => {
    const blocked = renderChatView({
      goalPanelOpen: true,
      goalFlows: [
        {
          id: "flow-blocked",
          status: "blocked",
          goal: "Collect remote proof",
          blockedSummary: "Waiting for GitHub Actions result.",
        },
      ],
    });
    expect(blocked.querySelector("[data-chat-goal]")?.textContent).toContain("Blocked");
    expect(blocked.querySelector("[data-chat-goal]")?.textContent).toContain(
      "Waiting for GitHub Actions result.",
    );

    const cancelled = renderChatView({
      goalPanelOpen: true,
      goalFlows: [
        {
          id: "flow-cancelled",
          status: "cancelled",
          goal: "Old goal",
          cancelRequestedAt: 1,
        },
      ],
    });
    const continueButton = cancelled.querySelector<HTMLButtonElement>(
      '[data-chat-goal-action="continue"]',
    );
    expect(cancelled.querySelector("[data-chat-goal]")?.textContent).toContain("Cancelled");
    expect(continueButton?.disabled).toBe(true);
  });

  it("renders goal loading failures while keeping chat usable", () => {
    const onSend = vi.fn();
    const container = renderChatView({
      goalPanelOpen: true,
      goalError: "offline",
      draft: "hello",
      getDraft: () => "hello",
      onSend,
    });

    const surface = container.querySelector<HTMLElement>("[data-chat-goal]");
    expect(surface?.textContent).toContain("Goal status unavailable");
    container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')?.click();
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
