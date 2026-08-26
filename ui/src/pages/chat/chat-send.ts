// Control UI module implements app chat behavior.
import { shouldForwardModelCommandToServer } from "../../../../src/auto-reply/commands-registry.shared.js";
import { isNonTerminalAgentRunStatus } from "../../../../src/shared/agent-run-status.js";
import {
  GatewayRequestError,
  type GatewayBrowserClient,
  type GatewayHelloOk,
} from "../../api/gateway.ts";
import type { AgentsListResult } from "../../api/types.ts";
import { normalizeGatewayComposerScope } from "../../app/gateway-scope.ts";
import { setLastActiveSessionKey } from "../../app/settings.ts";
import type {
  ChatAttachment,
  ChatQueueItem,
  ChatQueueSkillWorkshopRevision,
} from "../../lib/chat/chat-types.ts";
import { parseSlashCommand } from "../../lib/chat/commands.ts";
import {
  scopedAgentIdForSession,
  visibleSessionMatches,
  type SessionCapability,
  type SessionRefreshTarget,
} from "../../lib/sessions/index.ts";
import {
  isUiGlobalSessionKey,
  normalizeAgentId,
  resolveUiSelectedSessionAgentId,
} from "../../lib/sessions/session-key.ts";
import { normalizeLowercaseStringOrEmpty } from "../../lib/string-coerce.ts";
import { generateUUID } from "../../lib/uuid.ts";
import {
  discardChatAttachmentDataUrls,
  getChatAttachmentDataUrl,
  releaseChatAttachmentPayloads,
} from "./attachment-payload-store.ts";
import {
  dispatchChatSlashCommand,
  type ChatCommandHost,
  type ChatCommandResetOptions,
  shouldQueueLocalSlashCommand,
} from "./chat-commands.ts";
import { loadChatHistory, type ChatState } from "./chat-history.ts";
import {
  enqueueChatMessage,
  excludeComposerAttachments,
  findQueuedMessageForAction,
  isChatQueuePausedForSession,
  persistQueuedMessagesForSession,
  readChatQueueForSession,
  removeQueuedMessageWithoutReleasing,
  removeVisibleOrScopedQueuedMessageWithoutReleasing,
  updateQueuedMessage,
  updateQueuedMessageForSession,
} from "./chat-queue.ts";
import type {
  ChatSendAck,
  ChatSendAckServerTiming,
  ChatSendTimingEntry,
} from "./chat-send-contract.ts";
import {
  chatSendAckServerTimingEventFields,
  recordChatSendTiming,
  registerChatSendTiming,
  schedulePendingSendPaintTiming,
  updateChatSendAckTiming,
} from "./chat-send-timing.ts";
import { refreshChatSessionListForTarget } from "./chat-session.ts";
import {
  INTERRUPTED_MODEL_WAIT_ERROR,
  loadChatComposerSnapshot,
  removeStoredChatComposerQueueItem,
  persistStoredChatComposerQueue,
  type ChatComposerScope,
} from "./composer-persistence.ts";
import { formatConnectError } from "./connect-error.ts";
import {
  handleChatDraftChange,
  handleChatInputHistoryKey,
  navigateChatInputHistory,
  recordNonTranscriptInputHistory,
  resetChatInputHistoryNavigation,
  type ChatInputHistoryKeyInput,
  type ChatInputHistoryKeyResult,
  type ChatInputHistoryState,
} from "./input-history.ts";
import { controlUiNowMs, roundedControlUiDurationMs } from "./performance.ts";
import {
  handleAbortChat,
  isChatBusy,
  isChatStopCommand,
  reconcileChatRunLifecycle,
} from "./run-lifecycle.ts";
import { scheduleChatScroll, resetChatScroll } from "./scroll.ts";
import { resetToolStream } from "./tool-stream.ts";
import { buildUserChatMessageContentBlocks } from "./user-message-content.ts";

export type ChatHost = ChatInputHistoryState &
  ChatCommandHost & {
    sessions: SessionCapability;
    client: GatewayBrowserClient | null;
    chatStream: string | null;
    connected: boolean;
    chatAttachments: ChatAttachment[];
    chatQueue: ChatQueueItem[];
    chatQueuePaused?: boolean;
    chatQueuePausedBySession?: Record<string, boolean>;
    chatQueueBySession?: Record<string, ChatQueueItem[]>;
    /** Gateway switching suspends sends until the new connection reaches hello. */
    chatComposerPersistenceSuspended?: boolean;
    chatDetachedSendRecoveries?: Array<{
      gatewayScope: string;
      sessionKey: string;
      queue: ChatQueueItem[];
    }>;
    /** Identifies the Gateway principal that owns in-flight queue sends. */
    chatQueueGatewayGeneration?: number;
    /** Owner for memory-only composer persistence when browser storage is unavailable. */
    chatComposerMemoryOwner?: object;
    chatRunId: string | null;
    chatSending: boolean;
    lastError?: string | null;
    chatError?: string | null;
    hello: GatewayHelloOk | null;
    password?: string | null;
    settings?: { gatewayUrl?: string | null; token?: string | null };
    chatModelSwitchPromises?: Record<string, Promise<boolean>>;
    updateComplete?: Promise<unknown>;
    requestUpdate?: () => void;
    refreshSessionsAfterChat: Map<string, SessionRefreshTarget>;
    chatSubmitGuards?: Map<string, Promise<void>>;
    chatSendTimingsByRun?: Map<string, ChatSendTimingEntry>;
    eventLogBuffer?: unknown[];
    assistantAgentId?: string | null;
    agentsList?: ChatAgentsListSnapshot | null;
    /** Selected message to reply to (right-click / keyboard shortcut). */
    chatReplyTarget?: { messageId: string; text: string; senderLabel?: string | null } | null;
  };

type ChatAgentsListSnapshot = Partial<Omit<AgentsListResult, "agents">> & {
  agents?: AgentsListResult["agents"];
};

function setChatError(
  host: { lastError?: string | null; chatError?: string | null },
  error: string | null,
) {
  host.lastError = error;
  host.chatError = error;
}

function sendResetSlashCommand(
  host: ChatHost,
  message: string,
  opts: ChatCommandResetOptions,
): Promise<void> {
  return sendChatMessageNow(host, message, {
    refreshSessions: true,
    previousDraft: opts.previousDraft,
    restoreDraft: opts.restoreDraft,
  }).then(() => undefined);
}

type AcceptedChatSendAck = ChatSendAck & { status: "started" | "in_flight" | "ok" };
type TerminalFailureChatSendAck = ChatSendAck & { status: "timeout" | "error" };

const GATEWAY_CHANGED_CHAT_SEND_ERROR =
  "Gateway changed before this message was accepted. It is ready to retry after reconnect.";
const GATEWAY_CHANGED_DETACHED_SEND_ACCEPTED_ERROR =
  "Gateway changed after this detached message was accepted. It is queued with the original request ID for safe retry.";

function isAcceptedChatSendAck(ack: ChatSendAck | null): ack is AcceptedChatSendAck {
  return ack != null && (ack.status === "ok" || isNonTerminalAgentRunStatus(ack.status));
}

function isTerminalFailureChatSendAck(ack: ChatSendAck | null): ack is TerminalFailureChatSendAck {
  return ack?.status === "timeout" || ack?.status === "error";
}

function formatTerminalChatSendAckError(
  ack: TerminalFailureChatSendAck,
  context: "chat" | "detached" | "steer",
): string {
  if (ack.status === "error") {
    if (context === "steer") {
      return "Steer failed before it reached the run; try again.";
    }
    return "Chat failed before the run started; try again.";
  }
  if (context === "detached") {
    return "The active run ended before the detached message was accepted.";
  }
  if (context === "steer") {
    return "The active run ended before the steer message was accepted.";
  }
  return "The run ended before the message was accepted.";
}

type ChatSendOptions = {
  confirmReset?: boolean;
  restoreDraft?: boolean;
  skillWorkshopRevision?: ChatQueueSkillWorkshopRevision;
};

function dataUrlToBase64(dataUrl: string): { content: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], content: match[2] };
}

function buildApiAttachments(attachments?: ChatAttachment[]) {
  const hasAttachments = attachments && attachments.length > 0;
  return hasAttachments
    ? attachments
        .map((att) => {
          const dataUrl = getChatAttachmentDataUrl(att);
          const parsed = dataUrl ? dataUrlToBase64(dataUrl) : null;
          if (!parsed) {
            return null;
          }
          return {
            type: parsed.mimeType.startsWith("image/") ? "image" : "file",
            mimeType: parsed.mimeType,
            fileName: att.fileName,
            content: parsed.content,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : undefined;
}

function normalizeAckTimingValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export type {
  ChatSendAck,
  ChatSendAckServerTiming,
  ChatSendAckStatus,
} from "./chat-send-contract.ts";

function normalizeChatSendAckServerTiming(value: unknown): ChatSendAckServerTiming | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const receivedToAckMs = normalizeAckTimingValue(record.receivedToAckMs);
  const loadSessionMs = normalizeAckTimingValue(record.loadSessionMs);
  const prepareAttachmentsMs = normalizeAckTimingValue(record.prepareAttachmentsMs);
  const timing: ChatSendAckServerTiming = {
    ...(receivedToAckMs !== undefined ? { receivedToAckMs } : {}),
    ...(loadSessionMs !== undefined ? { loadSessionMs } : {}),
    ...(prepareAttachmentsMs !== undefined ? { prepareAttachmentsMs } : {}),
  };
  return Object.keys(timing).length > 0 ? timing : undefined;
}

function normalizeChatSendAck(payload: unknown, fallbackRunId: string): ChatSendAck {
  if (!payload || typeof payload !== "object") {
    return { runId: fallbackRunId, status: "started" };
  }
  const record = payload as Record<string, unknown>;
  const runId =
    typeof record.runId === "string" && record.runId.trim() ? record.runId.trim() : fallbackRunId;
  const status = record.status;
  const serverTiming = normalizeChatSendAckServerTiming(record.serverTiming);
  return {
    runId,
    status:
      status === "in_flight" || status === "ok" || status === "timeout" || status === "error"
        ? status
        : "started",
    ...(serverTiming ? { serverTiming } : {}),
  };
}

export async function requestChatSend(
  state: ChatState,
  params: {
    message: string;
    attachments?: ChatAttachment[];
    runId: string;
    sessionKey?: string;
    agentId?: string;
  },
): Promise<ChatSendAck> {
  const routing = resolveChatSendRouting(state, params);
  const controlUiReconnectResume = Boolean(
    routing.sessionId && state.reconnectResumeSessionId === routing.sessionId,
  );
  const payload = await state.client!.request("chat.send", {
    sessionKey: routing.sessionKey,
    ...(isUiGlobalSessionKey(routing.sessionKey) && routing.selectedAgentId
      ? { agentId: routing.selectedAgentId }
      : {}),
    ...(routing.sessionId ? { sessionId: routing.sessionId } : {}),
    ...(controlUiReconnectResume ? { __controlUiReconnectResume: true } : {}),
    message: params.message,
    deliver: false,
    idempotencyKey: params.runId,
    attachments: buildApiAttachments(params.attachments),
  });
  if (controlUiReconnectResume) {
    state.reconnectResumeSessionId = null;
  }
  return normalizeChatSendAck(payload, params.runId);
}

function resolveChatSendRouting(
  state: ChatState,
  params: {
    sessionKey?: string;
    agentId?: string;
  },
): { selectedAgentId?: string; sessionId?: string; sessionKey: string } {
  const sessionKey = params.sessionKey ?? state.sessionKey;
  const selectedAgentId = params.agentId
    ? normalizeAgentId(params.agentId)
    : resolveUiSelectedSessionAgentId(state);
  const currentSessionId = state.currentSessionId;
  const canReuseCurrentSessionId =
    sessionKey === state.sessionKey &&
    (!isUiGlobalSessionKey(sessionKey) ||
      (selectedAgentId !== undefined &&
        selectedAgentId === resolveUiSelectedSessionAgentId(state)));
  const sessionId =
    canReuseCurrentSessionId && typeof currentSessionId === "string" && currentSessionId.trim()
      ? currentSessionId.trim()
      : undefined;
  return {
    sessionKey,
    ...(selectedAgentId ? { selectedAgentId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export async function requestSkillWorkshopRevisionChatSend(
  state: ChatState,
  params: {
    proposalId: string;
    instructions: string;
    runId: string;
    sessionKey?: string;
    agentId?: string;
    targetAgentId?: string;
  },
): Promise<ChatSendAck> {
  const routing = resolveChatSendRouting(state, {
    sessionKey: params.sessionKey,
    agentId: params.targetAgentId,
  });
  const payload = await state.client!.request("skills.proposals.requestRevision", {
    ...(params.agentId ? { agentId: normalizeAgentId(params.agentId) } : {}),
    ...(routing.selectedAgentId ? { targetAgentId: routing.selectedAgentId } : {}),
    proposalId: params.proposalId,
    instructions: params.instructions,
    sessionKey: routing.sessionKey,
    ...(routing.sessionId ? { sessionId: routing.sessionId } : {}),
    idempotencyKey: params.runId,
  });
  return normalizeChatSendAck(payload, params.runId);
}

function appendUserChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
  timestamp = Date.now(),
) {
  const entry = {
    role: "user" as const,
    content: buildUserChatMessageContentBlocks(message, attachments),
    timestamp,
  };
  state.chatMessages = [...state.chatMessages, entry];
  return entry;
}

async function sendChatMessageWithGeneratedRunId(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
  runId = generateUUID(),
): Promise<ChatSendAck | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }
  setChatError(state, null);
  try {
    return await requestChatSend(state, { message: msg, attachments, runId });
  } catch (err) {
    setChatError(state, formatConnectError(err));
    return null;
  }
}

export async function sendDetachedChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
  runId?: string,
): Promise<ChatSendAck | null> {
  return sendChatMessageWithGeneratedRunId(state, message, attachments, runId);
}

export async function sendSteerChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
): Promise<ChatSendAck | null> {
  return sendChatMessageWithGeneratedRunId(state, message, attachments);
}

export {
  handleChatDraftChange,
  handleChatInputHistoryKey,
  navigateChatInputHistory,
  resetChatInputHistoryNavigation,
};
export type { ChatInputHistoryKeyInput, ChatInputHistoryKeyResult };

function isChatResetCommand(text: string) {
  const parsed = parseSlashCommand(text);
  if (!parsed || (parsed.command.key !== "new" && parsed.command.key !== "reset")) {
    return false;
  }
  if (parsed.command.key === "new") {
    return true;
  }
  if (/^soft(?:\s|$)/.test(normalizeLowercaseStringOrEmpty(parsed.args))) {
    return false;
  }
  return true;
}

function confirmChatResetCommand(text: string) {
  if (!isChatResetCommand(text)) {
    return true;
  }
  if (typeof globalThis.confirm !== "function") {
    return false;
  }
  return globalThis.confirm("Start a new session? This will reset the current chat.");
}

function isBtwCommand(text: string) {
  return /^\/(?:btw|side)(?::|\s|$)/i.test(text.trim());
}

function enqueuePendingSendMessage(
  host: ChatHost,
  text: string,
  attachments?: ChatAttachment[],
  refreshSessions?: boolean,
  submittedAtMs = controlUiNowMs(),
  sendState: ChatQueueItem["sendState"] = host.connected && host.client
    ? "sending"
    : "waiting-reconnect",
  skillWorkshopRevision?: ChatQueueSkillWorkshopRevision,
): ChatQueueItem | null {
  const trimmed = text.trim();
  const hasAttachments = Boolean(attachments && attachments.length > 0);
  if (!trimmed && !hasAttachments) {
    return null;
  }
  const pending: ChatQueueItem = {
    id: generateUUID(),
    text: trimmed,
    createdAt: Date.now(),
    attachments: hasAttachments ? attachments : undefined,
    refreshSessions,
    sendAttempts: 0,
    sendRunId: generateUUID(),
    sendState,
    sendSubmittedAtMs: submittedAtMs,
    sessionKey: host.sessionKey,
    agentId: scopedAgentIdForSession(host, host.sessionKey),
    ...(skillWorkshopRevision ? { skillWorkshopRevision } : {}),
  };
  host.chatQueue = [...host.chatQueue, pending];
  recordChatSendTiming(host, pending, "pending-visible", submittedAtMs);
  if (sendState === "waiting-model" || sendState === "waiting-reconnect") {
    recordChatSendTiming(host, pending, sendState, submittedAtMs);
  }
  schedulePendingSendPaintTiming(host, pending, submittedAtMs);
  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0], true, false, {
    source: "manual",
  });
  return pending;
}

function isRecoverableChatSendError(err: unknown, formattedError: string): boolean {
  if (err instanceof GatewayRequestError) {
    return err.retryable;
  }
  return /gateway (?:not connected|closed)|websocket|disconnected/i.test(formattedError);
}

function restoreComposerAfterFailedSend(
  host: ChatHost,
  opts: {
    previousAttachments?: ChatAttachment[];
    previousDraft?: string;
  },
) {
  if (opts.previousDraft != null && !host.chatMessage.trim()) {
    host.chatMessage = opts.previousDraft;
  }
  if (opts.previousAttachments?.length && host.chatAttachments.length === 0) {
    host.chatAttachments = opts.previousAttachments;
  }
}

function cancelPendingSendBeforeRequest(
  host: ChatHost,
  queued: ChatQueueItem,
  opts: {
    previousAttachments?: ChatAttachment[];
    previousDraft?: string;
    restoreComposer?: boolean;
  },
) {
  const removed = removeVisibleOrScopedQueuedMessageWithoutReleasing(
    host,
    queued.id,
    queued.sessionKey,
  );
  const restoreComposer = opts.restoreComposer !== false && removed != null;
  const willRestoreDraft =
    restoreComposer && opts.previousDraft != null && !host.chatMessage.trim();
  const willRestoreAttachments = Boolean(
    restoreComposer &&
    opts.previousAttachments?.length &&
    host.chatAttachments.length === 0 &&
    (willRestoreDraft || !host.chatMessage.trim()),
  );
  if (restoreComposer) {
    if (willRestoreDraft) {
      host.chatMessage = opts.previousDraft ?? "";
    }
    if (willRestoreAttachments) {
      host.chatAttachments = opts.previousAttachments ?? [];
    }
  }
  if (removed?.sessionKey) {
    removeStoredChatComposerQueueItem(host, removed.sessionKey, removed.id);
  }
  if (removed && !willRestoreAttachments) {
    releaseChatAttachmentPayloads(excludeComposerAttachments(host, removed.attachments));
  }
}

type QueuedChatSendResult = "sent" | "pending" | "failed";

type ChatGatewayGuard = {
  client: GatewayBrowserClient | null;
  generation: number;
  gatewayScope: string;
  persistenceState: ChatComposerScope;
};

function captureChatGatewayGuard(host: ChatHost): ChatGatewayGuard {
  return {
    client: host.client,
    generation: host.chatQueueGatewayGeneration ?? 0,
    gatewayScope: normalizeGatewayComposerScope(
      host.settings?.gatewayUrl,
      host.hello?.auth?.deviceToken || host.settings?.token || host.password,
    ),
    persistenceState: {
      settings: host.settings ? { ...host.settings } : undefined,
      password: host.password,
      assistantAgentId: host.assistantAgentId,
      agentsList: host.agentsList,
      hello: host.hello,
      chatComposerMemoryOwner: host.chatComposerMemoryOwner,
      chatQueuePaused: host.chatQueuePaused,
      chatComposerPersistenceSuspended: host.chatComposerPersistenceSuspended,
    },
  };
}

function isCurrentChatGateway(host: ChatHost, guard: ChatGatewayGuard): boolean {
  return (
    host.connected &&
    host.client === guard.client &&
    (host.chatQueueGatewayGeneration ?? 0) === guard.generation
  );
}

function mergeDetachedRecoveryQueue(...queues: ChatQueueItem[][]): ChatQueueItem[] {
  const merged = new Map<string, ChatQueueItem>();
  for (const queue of queues) {
    for (const item of queue) {
      merged.set(item.id, item);
    }
  }
  return [...merged.values()];
}

function mergeDetachedSendRecoveryIntoLiveQueue(
  host: ChatHost,
  sessionKey: string,
  gatewayGuard: ChatGatewayGuard | undefined,
  recoveryQueue: ChatQueueItem[],
): boolean {
  if (!gatewayGuard || !host.connected || !host.hello) {
    return false;
  }
  const activeScope = normalizeGatewayComposerScope(
    host.settings?.gatewayUrl,
    host.hello?.auth?.deviceToken || host.settings?.token || host.password,
  );
  if (activeScope !== gatewayGuard.gatewayScope) {
    return false;
  }
  const currentQueue = readChatQueueForSession(host, sessionKey);
  const existingIds = new Set(currentQueue.map((item) => item.id));
  const nextQueue = [...currentQueue, ...recoveryQueue.filter((item) => !existingIds.has(item.id))];
  if (sessionKey === host.sessionKey) {
    host.chatQueue = nextQueue;
  } else {
    host.chatQueueBySession = {
      ...host.chatQueueBySession,
      [sessionKey]: nextQueue,
    };
  }
  host.requestUpdate?.();
  return true;
}

function recoverQueuedSendAfterGatewayChange(
  host: ChatHost,
  sessionKey: string,
  id: string,
  gatewayGuard?: ChatGatewayGuard,
): boolean {
  const recovered = updateQueuedMessageForSession(host, sessionKey, id, (item) => ({
    ...item,
    sendError: GATEWAY_CHANGED_CHAT_SEND_ERROR,
    sendState: "waiting-reconnect",
  }));
  if (!recovered) {
    return false;
  }
  const queue = readChatQueueForSession(host, sessionKey);
  if (gatewayGuard) {
    persistStoredChatComposerQueue(
      gatewayGuard.persistenceState,
      sessionKey,
      queue,
      sessionKey === host.sessionKey ? gatewayGuard.persistenceState.chatQueuePaused : undefined,
      { requireComplete: true },
    );
  } else {
    persistQueuedMessagesForSession(host, sessionKey, { requirePersistence: true });
  }
  if (host.sessionKey === sessionKey) {
    setChatError(host, GATEWAY_CHANGED_CHAT_SEND_ERROR);
  }
  return true;
}

function ensureQueuedSendState(
  host: ChatHost,
  item: ChatQueueItem,
  fallbackSessionKey = host.sessionKey,
): ChatQueueItem {
  const sessionKey = item.sessionKey ?? fallbackSessionKey;
  const agentId = item.agentId ?? scopedAgentIdForSession(host, sessionKey);
  const prepared: ChatQueueItem = {
    ...item,
    sendAttempts: item.sendAttempts ?? 0,
    sendRunId: item.sendRunId ?? generateUUID(),
    sendState: item.sendState ?? (host.connected && host.client ? "sending" : "waiting-reconnect"),
    sessionKey,
    agentId,
  };
  if (
    prepared !== item &&
    (prepared.sessionKey !== item.sessionKey ||
      prepared.agentId !== item.agentId ||
      prepared.sendRunId !== item.sendRunId ||
      prepared.sendState !== item.sendState ||
      prepared.sendAttempts !== item.sendAttempts)
  ) {
    updateQueuedMessageForSession(host, sessionKey, item.id, () => prepared);
  }
  return prepared;
}

async function sendQueuedChatMessage(
  host: ChatHost,
  id: string,
  opts?: {
    previousAttachments?: ChatAttachment[];
    previousDraft?: string;
  },
  queuedSessionKey = host.sessionKey,
): Promise<QueuedChatSendResult> {
  const queued = readChatQueueForSession(host, queuedSessionKey).find((item) => item.id === id);
  if (!queued || queued.pendingRunId || queued.localCommandName) {
    return "failed";
  }
  if (isChatQueuePausedForSession(host, queuedSessionKey)) {
    return "pending";
  }
  const prepared = ensureQueuedSendState(host, queued, queuedSessionKey);
  const sessionKey = prepared.sessionKey ?? host.sessionKey;
  const message = prepared.text.trim();
  const attachments = prepared.attachments ?? [];
  const hasAttachments = attachments.length > 0;
  if (!message && !hasAttachments) {
    removeQueuedMessageWithoutReleasing(host, id, sessionKey);
    removeStoredChatComposerQueueItem(host, sessionKey, id);
    return "sent";
  }
  if (prepared.skillWorkshopRevision && hasAttachments) {
    updateQueuedMessageForSession(host, prepared.sessionKey ?? host.sessionKey, id, (item) => ({
      ...item,
      sendError: "Skill Workshop revision requests do not support attachments.",
      sendState: "failed",
    }));
    persistQueuedMessagesForSession(host, sessionKey);
    return "failed";
  }
  if (!host.connected || !host.client) {
    updateQueuedMessageForSession(host, sessionKey, id, (item) => ({
      ...item,
      sendState: "waiting-reconnect",
      sendError: undefined,
    }));
    persistQueuedMessagesForSession(host, sessionKey);
    return "pending";
  }

  const gatewayGuard = captureChatGatewayGuard(host);
  const isCurrentGateway = () => isCurrentChatGateway(host, gatewayGuard);

  const runId = prepared.sendRunId ?? generateUUID();
  const startedAt = Date.now();
  const requestStartedAtMs = controlUiNowMs();
  const sendingItem =
    updateQueuedMessageForSession(host, sessionKey, id, (item) => ({
      ...item,
      sendAttempts: (item.sendAttempts ?? 0) + 1,
      sendError: undefined,
      sendRunId: runId,
      sendState: "sending",
      sendRequestStartedAtMs: requestStartedAtMs,
      sessionKey,
      agentId: prepared.agentId,
    })) ?? prepared;
  registerChatSendTiming(host, sendingItem, runId, requestStartedAtMs);
  recordChatSendTiming(host, sendingItem, "request-start", sendingItem.sendSubmittedAtMs);
  host.chatSending = true;
  const isVisibleSession = () =>
    isCurrentGateway() && visibleSessionMatches(host, sessionKey, prepared.agentId);
  if (isVisibleSession()) {
    setChatError(host, null);
    reconcileChatRunLifecycle(host as unknown as Parameters<typeof reconcileChatRunLifecycle>[0], {
      clearRunStatus: true,
    });
  }

  try {
    const ack = prepared.skillWorkshopRevision
      ? await requestSkillWorkshopRevisionChatSend(host as unknown as ChatState, {
          proposalId: prepared.skillWorkshopRevision.proposalId,
          ...(prepared.skillWorkshopRevision.agentId
            ? { agentId: prepared.skillWorkshopRevision.agentId }
            : {}),
          ...(prepared.agentId ? { targetAgentId: prepared.agentId } : {}),
          instructions: message,
          runId,
          sessionKey,
        })
      : await requestChatSend(host as unknown as ChatState, {
          message,
          attachments: hasAttachments ? attachments : undefined,
          runId,
          sessionKey,
          agentId: prepared.agentId,
        });
    if (!isCurrentGateway()) {
      return "pending";
    }
    updateChatSendAckTiming(host, runId, ack, sendingItem, requestStartedAtMs);
    recordChatSendTiming(host, sendingItem, "ack", sendingItem.sendSubmittedAtMs, {
      ackStatus: ack.status,
      requestDurationMs: roundedControlUiDurationMs(controlUiNowMs() - requestStartedAtMs),
      ...chatSendAckServerTimingEventFields(ack),
    });
    if (isTerminalFailureChatSendAck(ack)) {
      const error = formatTerminalChatSendAckError(ack, "chat");
      updateQueuedMessageForSession(host, sessionKey, id, (item) => ({
        ...item,
        sendError: error,
        sendState: "failed",
      }));
      if (isVisibleSession()) {
        reconcileChatRunLifecycle(
          host as unknown as Parameters<typeof reconcileChatRunLifecycle>[0],
          {
            outcome: "interrupted",
            sessionStatus: ack.status === "error" ? "failed" : "killed",
            runId: ack.runId,
            sessionKey,
            clearLocalRun: true,
            clearChatStream: true,
            clearToolStream: true,
            clearSideResultTerminalRuns: true,
            publishRunStatus: false,
            armLocalTerminalReconcile: ack.runId === runId,
          },
        );
        setChatError(host, error);
        restoreComposerAfterFailedSend(host, opts ?? {});
      }
      recordChatSendTiming(host, sendingItem, "failed", sendingItem.sendSubmittedAtMs, {
        error,
        ackStatus: ack.status,
      });
      persistQueuedMessagesForSession(host, sessionKey);
      return "failed";
    }
    removeQueuedMessageWithoutReleasing(host, id, sessionKey);
    removeStoredChatComposerQueueItem(host, sessionKey, id);
    if (isVisibleSession()) {
      appendUserChatMessage(
        host as unknown as ChatState,
        message,
        hasAttachments ? attachments : undefined,
        startedAt,
      );
      if (ack.status === "ok") {
        reconcileChatRunLifecycle(
          host as unknown as Parameters<typeof reconcileChatRunLifecycle>[0],
          {
            outcome: "done",
            sessionStatus: "done",
            runId: ack.runId,
            sessionKey,
            clearLocalRun: true,
            clearChatStream: true,
            clearToolStream: true,
            clearSideResultTerminalRuns: true,
            publishRunStatus: false,
            armLocalTerminalReconcile: true,
          },
        );
        void loadChatHistory(host as unknown as ChatState);
      } else if (isNonTerminalAgentRunStatus(ack.status)) {
        const hasAlreadyAdoptedRunStream =
          host.chatRunId === ack.runId && typeof host.chatStream === "string";
        host.chatRunId = ack.runId;
        // Gateway can deliver the first delta before the chat.send ACK resolves.
        // Preserve that adopted stream; resetting here makes first replies vanish
        // until a later delta or final event arrives.
        if (!hasAlreadyAdoptedRunStream) {
          host.chatStream = "";
          (host as ChatHost & { chatStreamStartedAt?: number | null }).chatStreamStartedAt =
            startedAt;
        }
      } else {
        reconcileChatRunLifecycle(
          host as unknown as Parameters<typeof reconcileChatRunLifecycle>[0],
          {
            outcome: "interrupted",
            sessionStatus: ack.status === "error" ? "failed" : "killed",
            runId: ack.runId,
            sessionKey,
            clearLocalRun: true,
            clearChatStream: true,
            clearToolStream: true,
            clearSideResultTerminalRuns: true,
            publishRunStatus: false,
            armLocalTerminalReconcile: ack.runId === runId,
          },
        );
      }
    }
    if (prepared.refreshSessions) {
      const refreshTarget = {
        sessionKey,
        agentId: prepared.agentId,
      };
      if (ack.status === "ok") {
        void refreshChatSessionListForTarget(host, refreshTarget);
      } else if (isNonTerminalAgentRunStatus(ack.status)) {
        host.refreshSessionsAfterChat.set(ack.runId, refreshTarget);
      }
    }
    discardChatAttachmentDataUrls(excludeComposerAttachments(host, attachments));
    return "sent";
  } catch (err) {
    if (!isCurrentGateway()) {
      return "pending";
    }
    const error = formatConnectError(err);
    if (isRecoverableChatSendError(err, error)) {
      updateQueuedMessageForSession(host, sessionKey, id, (item) => ({
        ...item,
        sendError: error,
        sendState: "waiting-reconnect",
      }));
      if (isVisibleSession()) {
        setChatError(host, "Message will send when the Gateway reconnects.");
      }
      recordChatSendTiming(host, prepared, "waiting-reconnect", prepared.sendSubmittedAtMs, {
        error,
      });
      persistQueuedMessagesForSession(host, sessionKey);
      return "pending";
    }
    updateQueuedMessageForSession(host, sessionKey, id, (item) => ({
      ...item,
      sendError: error,
      sendState: "failed",
    }));
    if (isVisibleSession()) {
      setChatError(host, error);
      restoreComposerAfterFailedSend(host, opts ?? {});
    }
    recordChatSendTiming(host, prepared, "failed", prepared.sendSubmittedAtMs, { error });
    persistQueuedMessagesForSession(host, sessionKey);
    return "failed";
  } finally {
    if (isCurrentGateway()) {
      host.chatSending = false;
    }
  }
}

async function sendChatMessageNow(
  host: ChatHost,
  message: string,
  opts?: {
    queueItemId?: string;
    previousDraft?: string;
    restoreDraft?: boolean;
    attachments?: ChatAttachment[];
    previousAttachments?: ChatAttachment[];
    restoreAttachments?: boolean;
    refreshSessions?: boolean;
    submittedAtMs?: number;
  },
) {
  resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
  // Reset scroll state before sending to ensure auto-scroll works for the response
  resetChatScroll(host as unknown as Parameters<typeof resetChatScroll>[0]);
  const queued =
    opts?.queueItemId != null
      ? (host.chatQueue.find((item) => item.id === opts.queueItemId) ?? null)
      : enqueuePendingSendMessage(
          host,
          message,
          opts?.attachments,
          opts?.refreshSessions,
          opts?.submittedAtMs,
        );
  if (!queued) {
    return false;
  }
  const queuedSessionKey = queued.sessionKey ?? host.sessionKey;
  const result = await sendQueuedChatMessage(host, queued.id, {
    previousDraft: opts?.previousDraft,
    previousAttachments: opts?.previousAttachments,
  });
  const ok = result === "sent";
  if (ok && host.sessionKey === queuedSessionKey) {
    setLastActiveSessionKey(
      host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
      queuedSessionKey,
    );
    resetChatInputHistoryNavigation(host);
  }
  if (
    ok &&
    host.sessionKey === queuedSessionKey &&
    opts?.restoreDraft &&
    opts.previousDraft?.trim()
  ) {
    host.chatMessage = opts.previousDraft;
  }
  if (
    ok &&
    host.sessionKey === queuedSessionKey &&
    opts?.restoreAttachments &&
    opts.previousAttachments?.length
  ) {
    host.chatAttachments = opts.previousAttachments;
  }
  // Force scroll after sending to ensure viewport is at bottom for incoming stream
  if (host.sessionKey === queuedSessionKey) {
    scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0], true);
  }
  if (ok && host.sessionKey === queuedSessionKey && !host.chatRunId) {
    void flushChatQueue(host);
  }
  return ok;
}

function attachmentSubmitSignature(attachment: ChatAttachment): string {
  const dataUrl = getChatAttachmentDataUrl(attachment);
  return JSON.stringify([
    attachment.id,
    attachment.mimeType,
    attachment.fileName ?? "",
    attachment.sizeBytes ?? 0,
    dataUrl?.length ?? 0,
    dataUrl?.slice(0, 64) ?? "",
  ]);
}

function chatSubmitKey(
  host: ChatHost,
  kind: "detached" | "message",
  message: string,
  attachments: ChatAttachment[],
  skillWorkshopRevision?: ChatQueueSkillWorkshopRevision,
): string {
  return JSON.stringify([
    kind,
    host.sessionKey,
    message.trim(),
    skillWorkshopRevision?.proposalId ?? "",
    skillWorkshopRevision?.agentId ?? "",
    attachments.map(attachmentSubmitSignature),
  ]);
}

async function withChatSubmitGuard<T>(
  host: ChatHost,
  key: string,
  run: () => Promise<T>,
): Promise<T | undefined> {
  const guards = (host.chatSubmitGuards ??= new Map<string, Promise<void>>());
  if (guards.has(key)) {
    return undefined;
  }
  let releaseGuard!: () => void;
  const guard = new Promise<void>((resolve) => {
    releaseGuard = resolve;
  });
  guards.set(key, guard);
  try {
    return await run();
  } finally {
    releaseGuard();
    if (guards.get(key) === guard) {
      guards.delete(key);
    }
  }
}

function waitForPendingChatModelSwitch(
  host: ChatHost,
  sessionKey: string,
): Promise<boolean> | true {
  const pending = host.chatModelSwitchPromises?.[sessionKey];
  if (!pending) {
    return true;
  }
  return pending;
}

function clearSubmittedComposerState(
  host: ChatHost,
  submittedDraft: string,
  submittedAttachments: ChatAttachment[],
): {
  previousAttachments?: ChatAttachment[];
  previousDraft?: string;
} {
  const attachmentsUnchanged =
    host.chatAttachments.length === submittedAttachments.length &&
    host.chatAttachments.every(
      (attachment, index) =>
        attachmentSubmitSignature(attachment) ===
        attachmentSubmitSignature(submittedAttachments[index]),
    );
  const clearedDraft = host.chatMessage === submittedDraft && attachmentsUnchanged;
  const clearedAttachments = clearedDraft;
  if (clearedDraft) {
    host.chatMessage = "";
  }
  if (clearedAttachments) {
    host.chatAttachments = [];
  }
  if (clearedDraft || clearedAttachments) {
    resetChatInputHistoryNavigation(host);
  }
  return {
    previousAttachments: clearedAttachments ? submittedAttachments : undefined,
    previousDraft: clearedDraft ? submittedDraft : undefined,
  };
}

function snapshotChatAttachments(attachments: readonly ChatAttachment[]): ChatAttachment[] {
  return attachments.map((attachment) => {
    const dataUrl = getChatAttachmentDataUrl(attachment);
    return {
      ...attachment,
      ...(dataUrl ? { dataUrl } : {}),
    };
  });
}

async function sendDetachedCommandMessage(
  host: ChatHost,
  message: string,
  opts?: {
    sessionKey?: string;
    agentId?: string;
    previousDraft?: string;
    attachments?: ChatAttachment[];
    previousAttachments?: ChatAttachment[];
    gatewayGuard?: ChatGatewayGuard;
    sendRunId?: string;
  },
) {
  const sendRunId = opts?.sendRunId ?? generateUUID();
  const ack = await sendDetachedChatMessage(
    host as unknown as ChatState,
    message,
    opts?.attachments,
    sendRunId,
  );
  if (opts?.gatewayGuard && !isCurrentChatGateway(host, opts.gatewayGuard)) {
    const sessionKey = opts.sessionKey ?? host.sessionKey;
    const accepted = isAcceptedChatSendAck(ack);
    const previousSnapshot = loadChatComposerSnapshot(
      opts.gatewayGuard.persistenceState,
      sessionKey,
    );
    const recoveredItem: ChatQueueItem = {
      id: generateUUID(),
      text: message,
      createdAt: Date.now(),
      ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
      sendError: accepted
        ? GATEWAY_CHANGED_DETACHED_SEND_ACCEPTED_ERROR
        : "Gateway changed before this detached message was accepted. It was saved for review and retry.",
      sendRunId,
      sendState: accepted ? "waiting-reconnect" : "failed",
      sessionKey,
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
    };
    // A detached message belongs to the Gateway that accepted the request.
    // Persist it in that captured principal instead of the replacement
    // connection, where a retry could be sent to the wrong Gateway.
    const matchingRecovery = (host.chatDetachedSendRecoveries ?? []).find(
      (recovery) =>
        recovery.gatewayScope === opts.gatewayGuard?.gatewayScope &&
        recovery.sessionKey === sessionKey,
    );
    const recoveryQueue = mergeDetachedRecoveryQueue(
      matchingRecovery?.queue ?? [],
      previousSnapshot?.queue ?? [],
      [recoveredItem],
    );
    const persisted = persistStoredChatComposerQueue(
      opts.gatewayGuard.persistenceState,
      sessionKey,
      recoveryQueue,
      previousSnapshot?.queuePaused,
      { requireComplete: true },
    );
    // Keep a one-shot in-memory copy even when durable persistence succeeds.
    // Reconnect may restore a non-empty provisional queue and skip storage;
    // without this buffer the detached item could be lost on the next write.
    host.chatDetachedSendRecoveries = [
      ...(host.chatDetachedSendRecoveries ?? []).filter(
        (recovery) =>
          recovery.gatewayScope !== opts.gatewayGuard?.gatewayScope ||
          recovery.sessionKey !== sessionKey,
      ),
      {
        gatewayScope: opts.gatewayGuard.gatewayScope,
        sessionKey,
        queue: recoveryQueue,
      },
    ];
    mergeDetachedSendRecoveryIntoLiveQueue(host, sessionKey, opts.gatewayGuard, recoveryQueue);
    if (host.sessionKey === sessionKey) {
      setChatError(
        host,
        persisted
          ? accepted
            ? GATEWAY_CHANGED_DETACHED_SEND_ACCEPTED_ERROR
            : "Gateway changed before this detached message was accepted. It was saved for review and retry."
          : "Gateway changed before this detached message was accepted. Browser storage was unavailable; it remains in memory and will be restored only when the original Gateway reconnects.",
      );
    }
    return false;
  }
  const ok = isAcceptedChatSendAck(ack);
  if (!ok && opts?.previousDraft != null) {
    host.chatMessage = opts.previousDraft;
  }
  if (!ok && opts?.previousAttachments) {
    host.chatAttachments = opts.previousAttachments;
  }
  if (isTerminalFailureChatSendAck(ack)) {
    setChatError(host, formatTerminalChatSendAckError(ack, "detached"));
  }
  if (ok) {
    setLastActiveSessionKey(
      host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
      host.sessionKey,
    );
    releaseChatAttachmentPayloads(excludeComposerAttachments(host, opts?.attachments));
  }
  return ok;
}

export async function steerQueuedChatMessage(host: ChatHost, id: string) {
  if (!host.connected || !host.chatRunId) {
    return;
  }
  const activeRunId = host.chatRunId;
  const found = findQueuedMessageForAction(host, id);
  const item = found?.item;
  const sessionKey = found?.sessionKey ?? host.sessionKey;
  if (!item || item.pendingRunId || item.localCommandName || sessionKey !== host.sessionKey) {
    return;
  }
  const message = item.text.trim();
  const attachments = item.attachments ?? [];
  const hasAttachments = attachments.length > 0;
  if (!message && !hasAttachments) {
    return;
  }

  if (host.chatComposerPersistenceSuspended) {
    setChatError(
      host,
      "Chat is reconnecting to the Gateway; wait for it to finish before sending.",
    );
    return;
  }
  if (isChatQueuePausedForSession(host, sessionKey)) {
    setChatError(host, "Queue is paused; resume it before steering a message.");
    return;
  }

  updateQueuedMessageForSession(host, sessionKey, id, (entry) => ({
    ...entry,
    kind: "steered",
    pendingRunId: activeRunId,
  }));
  const ack = await sendSteerChatMessage(
    host as unknown as ChatState,
    message,
    hasAttachments ? attachments : undefined,
  );
  if (!ack || isTerminalFailureChatSendAck(ack)) {
    updateQueuedMessageForSession(host, sessionKey, id, () => item);
    if (isTerminalFailureChatSendAck(ack)) {
      setChatError(host, formatTerminalChatSendAckError(ack, "steer"));
    }
    return;
  }
  if (ack.status === "ok") {
    removeQueuedMessageWithoutReleasing(host, id, sessionKey);
  }
  releaseChatAttachmentPayloads(attachments);
  setLastActiveSessionKey(
    host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
    sessionKey,
  );
  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
}

async function flushChatQueue(host: ChatHost) {
  if (!host.connected || isChatBusy(host) || isChatQueuePausedForSession(host, host.sessionKey)) {
    return;
  }
  const nextIndex = host.chatQueue.findIndex(
    (item) =>
      !item.pendingRunId &&
      item.sendState !== "sending" &&
      item.sendState !== "waiting-model" &&
      item.sendState !== "failed" &&
      (item.sessionKey == null || item.sessionKey === host.sessionKey),
  );
  if (nextIndex < 0) {
    return;
  }
  const next = host.chatQueue[nextIndex];
  let ok = false;
  try {
    if (next.localCommandName) {
      host.chatQueue = host.chatQueue.filter((_, index) => index !== nextIndex);
      await dispatchChatSlashCommand(host, next.localCommandName, next.localCommandArgs ?? "", {
        sendResetMessage: (message, resetOpts) => sendResetSlashCommand(host, message, resetOpts),
      });
      ok = true;
    } else {
      ok = await sendChatMessageNow(host, next.text, {
        queueItemId: next.id,
        attachments: next.attachments,
        refreshSessions: next.refreshSessions,
      });
    }
  } catch (err) {
    setChatError(host, String(err));
  }
  if (!ok && next.localCommandName) {
    host.chatQueue = [next, ...host.chatQueue];
  } else if (ok && host.chatQueue.length > 0) {
    // Continue draining — local commands don't block on server response
    void flushChatQueue(host);
  }
}

export async function retryReconnectableQueuedChatSends(host: ChatHost) {
  if (!host.connected || !host.client || host.chatSending) {
    return;
  }
  const sessionKeys = [
    host.sessionKey,
    ...Object.keys(host.chatQueueBySession ?? {}).filter(
      (sessionKey) => sessionKey !== host.sessionKey,
    ),
  ];
  for (const sessionKey of sessionKeys) {
    if (isChatQueuePausedForSession(host, sessionKey)) {
      continue;
    }
    const item = readChatQueueForSession(host, sessionKey).find(
      (entry) =>
        entry.sendRunId &&
        entry.sendState === "waiting-reconnect" &&
        !entry.pendingRunId &&
        !entry.localCommandName,
    );
    if (!item) {
      continue;
    }
    await sendQueuedChatMessage(host, item.id, undefined, sessionKey);
    if (host.chatRunId) {
      return;
    }
  }
  if (!host.chatRunId) {
    void flushChatQueue(host);
  }
}

export async function retryQueuedChatMessage(host: ChatHost, id: string) {
  const found = findQueuedMessageForAction(host, id);
  const item = found?.item;
  const sessionKey = found?.sessionKey ?? host.sessionKey;
  if (
    !item ||
    item.localCommandName ||
    item.pendingRunId ||
    item.sendState === "sending" ||
    item.sendState === "waiting-model"
  ) {
    return;
  }
  if (isChatQueuePausedForSession(host, sessionKey)) {
    return;
  }
  updateQueuedMessageForSession(host, sessionKey, id, (entry) => ({
    ...entry,
    sendError: undefined,
    sendState: host.connected && host.client ? "sending" : "waiting-reconnect",
  }));
  await sendQueuedChatMessage(host, id, undefined, sessionKey);
  if (!host.chatRunId) {
    void flushChatQueue(host);
  }
}

export async function handleSendChat(
  host: ChatHost,
  messageOverride?: string,
  opts?: ChatSendOptions,
) {
  const previousDraft = host.chatMessage;
  const message = (messageOverride ?? host.chatMessage).trim();
  const submittedAtMs = controlUiNowMs();
  const submittedSessionKey = host.sessionKey;
  const attachments = host.chatAttachments ?? [];
  const attachmentsToSend = messageOverride == null ? snapshotChatAttachments(attachments) : [];
  const hasAttachments = attachmentsToSend.length > 0;
  const skillWorkshopRevision = opts?.skillWorkshopRevision;
  const shouldInterpretChatCommands = !skillWorkshopRevision;
  const submitGatewayGuard = host.connected && host.client ? captureChatGatewayGuard(host) : null;
  const isSubmitGatewayCurrent = () =>
    !submitGatewayGuard || isCurrentChatGateway(host, submitGatewayGuard);

  if (!message && !hasAttachments) {
    return;
  }

  if (host.chatComposerPersistenceSuspended) {
    setChatError(
      host,
      "Chat is reconnecting to the Gateway; wait for it to finish before sending.",
    );
    return;
  }

  if (messageOverride != null && opts?.confirmReset && !confirmChatResetCommand(message)) {
    return;
  }

  if (shouldInterpretChatCommands) {
    if (isChatStopCommand(message)) {
      if (messageOverride == null) {
        recordNonTranscriptInputHistory(host, message);
      }
      await handleAbortChat(host);
      return;
    }

    const parsed = parseSlashCommand(message);
    if (isBtwCommand(message) && isChatQueuePausedForSession(host, submittedSessionKey)) {
      setChatError(host, "Chat is paused; resume it before sending a detached message.");
      return;
    }
    // The backend resolves /approve before active-run admission. Send it now so
    // the approval command cannot queue behind the run that is waiting for it.
    const shouldSendDetachedCommand =
      isBtwCommand(message) || (parsed?.command.key === "approve" && isChatBusy(host));
    if (shouldSendDetachedCommand) {
      const submitKey = chatSubmitKey(host, "detached", message, attachmentsToSend);
      await withChatSubmitGuard(host, submitKey, async () => {
        if (!isSubmitGatewayCurrent()) {
          return;
        }
        const modelSwitchReady = waitForPendingChatModelSwitch(host, submittedSessionKey);
        if (modelSwitchReady !== true && !(await modelSwitchReady)) {
          return;
        }
        if (!isSubmitGatewayCurrent()) {
          return;
        }
        if (host.sessionKey !== submittedSessionKey) {
          return;
        }
        if (isBtwCommand(message) && isChatQueuePausedForSession(host, submittedSessionKey)) {
          setChatError(host, "Chat is paused; resume it before sending a detached message.");
          return;
        }
        const cleared =
          messageOverride == null
            ? clearSubmittedComposerState(host, previousDraft, attachmentsToSend)
            : {};
        if (messageOverride == null) {
          recordNonTranscriptInputHistory(host, message);
        }
        await sendDetachedCommandMessage(host, message, {
          sessionKey: submittedSessionKey,
          agentId: scopedAgentIdForSession(host, submittedSessionKey),
          previousDraft: cleared.previousDraft,
          attachments: hasAttachments ? attachmentsToSend : undefined,
          previousAttachments: cleared.previousAttachments,
          gatewayGuard: submitGatewayGuard ?? undefined,
        });
      });
      return;
    }

    // Intercept local slash commands (/status, /model, /compact, etc.)
    const forwardModelCommand =
      parsed?.command.key === "model" && shouldForwardModelCommandToServer(parsed.args);
    if (parsed?.command.executeLocal && !forwardModelCommand) {
      if (
        (isChatBusy(host) || isChatQueuePausedForSession(host, submittedSessionKey)) &&
        shouldQueueLocalSlashCommand(parsed.command.key)
      ) {
        const cleared =
          messageOverride == null
            ? clearSubmittedComposerState(host, previousDraft, attachmentsToSend)
            : {};
        if (messageOverride == null) {
          recordNonTranscriptInputHistory(host, message);
        }
        const queued = enqueueChatMessage(host, message, undefined, isChatResetCommand(message), {
          args: parsed.args,
          name: parsed.command.key,
        });
        if (
          queued &&
          isChatQueuePausedForSession(host, submittedSessionKey) &&
          !persistQueuedMessagesForSession(host, submittedSessionKey, { requirePersistence: true })
        ) {
          cancelPendingSendBeforeRequest(host, queued, {
            previousDraft: cleared.previousDraft,
            previousAttachments: cleared.previousAttachments,
          });
          setChatError(
            host,
            "Could not queue this message safely while Chat is paused. Retry after freeing browser storage or resume Chat.",
          );
        }
        return;
      }
      const prevDraft = messageOverride == null ? previousDraft : undefined;
      if (messageOverride == null) {
        recordNonTranscriptInputHistory(host, message);
        host.chatMessage = "";
        host.chatAttachments = [];
        resetChatInputHistoryNavigation(host);
      }
      await dispatchChatSlashCommand(host, parsed.command.key, parsed.args, {
        previousDraft: prevDraft,
        restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
        sendResetMessage: (resetMessage, resetOpts) =>
          sendResetSlashCommand(host, resetMessage, resetOpts),
      });
      return;
    }
  }

  const replyTarget = host.chatReplyTarget;
  const effectiveMessage = replyTarget ? prependReplyQuote(message, replyTarget) : message;

  const refreshSessions = shouldInterpretChatCommands && isChatResetCommand(message);
  const submitKey = chatSubmitKey(
    host,
    "message",
    effectiveMessage,
    attachmentsToSend,
    skillWorkshopRevision,
  );
  await withChatSubmitGuard(host, submitKey, async () => {
    if (!isSubmitGatewayCurrent()) {
      return;
    }
    if (host.sessionKey !== submittedSessionKey) {
      return;
    }
    const cleared =
      messageOverride == null
        ? clearSubmittedComposerState(host, previousDraft, attachmentsToSend)
        : {};
    if (messageOverride == null) {
      recordNonTranscriptInputHistory(host, message);
    }

    const modelSwitchReady = waitForPendingChatModelSwitch(host, submittedSessionKey);
    const waitingForModel = modelSwitchReady !== true;
    const queued = enqueuePendingSendMessage(
      host,
      effectiveMessage,
      hasAttachments ? attachmentsToSend : undefined,
      refreshSessions,
      submittedAtMs,
      waitingForModel ? "waiting-model" : undefined,
      skillWorkshopRevision,
    );
    if (!queued) {
      return;
    }

    if (modelSwitchReady !== true && !(await modelSwitchReady)) {
      if (!isSubmitGatewayCurrent()) {
        recoverQueuedSendAfterGatewayChange(
          host,
          submittedSessionKey,
          queued.id,
          submitGatewayGuard ?? undefined,
        );
        return;
      }
      if (host.sessionKey === submittedSessionKey) {
        cancelPendingSendBeforeRequest(host, queued, {
          previousDraft: cleared.previousDraft,
          previousAttachments: cleared.previousAttachments,
        });
      } else {
        updateQueuedMessageForSession(host, submittedSessionKey, queued.id, (item) => ({
          ...item,
          sendError: INTERRUPTED_MODEL_WAIT_ERROR,
          sendState: "failed",
        }));
        persistQueuedMessagesForSession(host, submittedSessionKey);
      }
      return;
    }
    if (!isSubmitGatewayCurrent()) {
      recoverQueuedSendAfterGatewayChange(
        host,
        submittedSessionKey,
        queued.id,
        submitGatewayGuard ?? undefined,
      );
      return;
    }
    if (host.sessionKey !== submittedSessionKey) {
      updateQueuedMessageForSession(host, submittedSessionKey, queued.id, (item) => ({
        ...item,
        sendError: undefined,
        sendState: undefined,
      }));
      persistQueuedMessagesForSession(host, submittedSessionKey);
      return;
    }

    if (isChatQueuePausedForSession(host, submittedSessionKey)) {
      updateQueuedMessage(host, queued.id, (item) => ({
        ...item,
        sendError: undefined,
        sendState: undefined,
      }));
      recordChatSendTiming(host, queued, "queued-paused", submittedAtMs);
      if (
        !persistQueuedMessagesForSession(host, submittedSessionKey, {
          requirePersistence: true,
        })
      ) {
        cancelPendingSendBeforeRequest(host, queued, {
          previousDraft: cleared.previousDraft,
          previousAttachments: cleared.previousAttachments,
        });
        setChatError(
          host,
          "Could not queue this message safely while Chat is paused. Retry after freeing browser storage or resume Chat.",
        );
      } else if (
        replyTarget &&
        host.chatReplyTarget?.messageId === replyTarget.messageId &&
        host.sessionKey === submittedSessionKey
      ) {
        host.chatReplyTarget = null;
      }
      return;
    }

    if (isChatBusy(host)) {
      updateQueuedMessage(host, queued.id, (item) => ({
        ...item,
        sendError: undefined,
        sendState: undefined,
      }));
      recordChatSendTiming(host, queued, "queued-busy", submittedAtMs);
      return;
    }

    const accepted = await sendChatMessageNow(host, effectiveMessage, {
      queueItemId: queued.id,
      previousDraft: cleared.previousDraft,
      restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
      attachments: hasAttachments ? attachmentsToSend : undefined,
      previousAttachments: cleared.previousAttachments,
      restoreAttachments: Boolean(messageOverride && opts?.restoreDraft),
      refreshSessions,
      submittedAtMs,
    });
    if (
      accepted &&
      replyTarget &&
      host.chatReplyTarget?.messageId === replyTarget.messageId &&
      host.sessionKey === submittedSessionKey
    ) {
      host.chatReplyTarget = null;
    }
  });
}

function prependReplyQuote(
  message: string,
  replyTarget: NonNullable<ChatHost["chatReplyTarget"]>,
): string {
  const label = escapeMarkdownInline(replyTarget.senderLabel ?? "User");
  const text = replyTarget.text.trim();
  if (!text.includes("\n")) {
    return `> **${label}:** ${text}\n\n${message}`;
  }
  const quoted = text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `> **${label}:**\n${quoted}\n\n${message}`;
}

function escapeMarkdownInline(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

export const flushChatQueueForEvent = flushChatQueue;
