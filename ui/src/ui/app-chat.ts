import type {
  ChatTurnSummary,
  ExecutionStateSnapshot,
} from "../../../packages/gateway-protocol/src/index.js";
// Control UI module implements app chat behavior.
import { isNonTerminalAgentRunStatus } from "../../../src/shared/agent-run-status.js";
import { normalizeGatewayComposerScope } from "../app/gateway-scope.ts";
import { setLastActiveSessionKey } from "./app-last-active-session.ts";
import { scheduleChatScroll, resetChatScroll } from "./app-scroll.ts";
import { resetToolStream } from "./app-tool-stream.ts";
import {
  cloneChatAttachmentsMetadata,
  discardChatAttachmentDataUrls,
  getChatAttachmentDataUrl,
  releaseChatAttachmentPayloads,
} from "./chat/attachment-payload-store.ts";
import {
  INTERRUPTED_MODEL_WAIT_ERROR,
  loadChatComposerSnapshot,
  persistStoredChatComposerQueue,
  removeStoredChatComposerQueueItem,
} from "./chat/composer-persistence.ts";
import {
  handleChatDraftChange,
  handleChatInputHistoryKey,
  navigateChatInputHistory,
  recordNonTranscriptInputHistory,
  resetChatInputHistoryNavigation,
  type ChatInputHistoryKeyInput,
  type ChatInputHistoryKeyResult,
  type ChatInputHistoryState,
} from "./chat/input-history.ts";
import { reconcileChatRunLifecycle } from "./chat/run-lifecycle.ts";
import { clearChatMessagesFromCache, type ChatMessageCache } from "./chat/session-message-cache.ts";
import type { ChatSideResult } from "./chat/side-result.ts";
import { executeSlashCommand } from "./chat/slash-command-executor.ts";
import {
  applyRemoteSlashCommandsResult,
  parseSlashCommand,
  refreshSlashCommands,
} from "./chat/slash-commands.ts";
import { formatConnectError } from "./connect-error.ts";
import { resolveControlUiAuthHeader } from "./control-ui-auth.ts";
import {
  controlUiNowMs,
  recordControlUiPerformanceEvent,
  roundedControlUiDurationMs,
  scheduleControlUiAfterPaint,
} from "./control-ui-performance.ts";
import {
  abortChatRun,
  appendUserChatMessage,
  buildApiAttachments,
  loadChatHistory,
  requestChatSend,
  requestSkillWorkshopRevisionChatSend,
  sendDetachedChatMessage,
  sendSteerChatMessage,
  type ChatEventPayload,
  type ChatHistoryResult,
  type ChatMetadataResult,
  type ChatSendAck,
  type ChatState,
  isGatewayMethodAdvertised,
} from "./controllers/chat.ts";
import { applyModelCatalogResult, loadModels } from "./controllers/models.ts";
import {
  applyChatHistorySessionInfo,
  loadSessions,
  type LoadSessionsOverrides,
  type SessionsState,
} from "./controllers/sessions.ts";
import { GatewayRequestError, type GatewayBrowserClient, type GatewayHelloOk } from "./gateway.ts";
import { normalizeBasePath } from "./navigation.ts";
import {
  areUiSessionKeysEquivalent,
  DEFAULT_AGENT_ID,
  isUiGlobalSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
  resolveUiDefaultAgentId,
  resolveUiGlobalAliasAgentId,
  resolveUiKnownSelectedGlobalAgentId,
  resolveUiSelectedGlobalAgentId,
} from "./session-key.ts";
import { isSessionRunActive } from "./session-run-state.ts";
import { normalizeLowercaseStringOrEmpty, normalizeOptionalString } from "./string-coerce.ts";
import type {
  AgentsListResult,
  ChatModelOverride,
  GatewaySessionRow,
  ModelCatalogEntry,
} from "./types.ts";
import type { SessionsListResult } from "./types.ts";
import type {
  ChatAttachment,
  ChatQueueItem,
  ChatQueueSkillWorkshopRevision,
  ChatSessionRefreshTarget,
} from "./ui-types.ts";
import { generateUUID } from "./uuid.ts";
import { isRenderableControlUiAvatarUrl } from "./views/agents-utils.ts";

export type ChatHost = ChatInputHistoryState & {
  client: GatewayBrowserClient | null;
  chatStream: string | null;
  connected: boolean;
  chatAttachments: ChatAttachment[];
  chatQueue: ChatQueueItem[];
  chatQueueBySession?: Record<string, ChatQueueItem[]>;
  chatQueuePausedBySession?: Record<string, boolean>;
  chatQueuePausePendingBySession?: Record<string, boolean>;
  chatQueuePauseTransitionsBySession?: Record<string, Promise<boolean>>;
  chatQueueCreateTransitionsBySession?: Record<string, Set<Promise<boolean>>>;
  chatQueueGatewayGeneration?: number;
  chatQueuePaused?: boolean;
  /** Gateway switching suspends sends until the new connection reaches hello. */
  chatComposerPersistenceSuspended?: boolean;
  chatDetachedSendRecoveries?: ChatDetachedSendRecovery[];
  chatMessagesBySession?: ChatMessageCache;
  chatRunId: string | null;
  chatSending: boolean;
  chatSendingGatewayGeneration?: number | null;
  lastError?: string | null;
  chatError?: string | null;
  basePath: string;
  settings?: { gatewayUrl?: string | null; token?: string | null };
  password?: string | null;
  hello: GatewayHelloOk | null;
  chatAvatarUrl: string | null;
  chatAvatarSource?: string | null;
  chatAvatarStatus?: "none" | "local" | "remote" | "data" | null;
  chatAvatarReason?: string | null;
  chatSideResult?: ChatSideResult | null;
  chatSideResultTerminalRuns?: Set<string>;
  chatModelOverrides: Record<string, ChatModelOverride | null>;
  chatModelSwitchPromises?: Record<string, Promise<boolean>>;
  chatModelsLoading: boolean;
  chatModelCatalog: ModelCatalogEntry[];
  chatExecutionState?: ExecutionStateSnapshot | null;
  sessionsResult?: SessionsListResult | null;
  sessionsError?: string | null;
  sessionsShowArchived?: boolean;
  updateComplete?: Promise<unknown>;
  requestUpdate?: () => void;
  refreshSessionsAfterChat: Map<string, ChatSessionRefreshTarget>;
  pendingAbort?: { runId?: string | null; sessionKey: string; agentId?: string } | null;
  chatSubmitGuards?: Map<string, Promise<void>>;
  chatSendTimingsByRun?: Map<string, ChatSendTimingEntry>;
  assistantAgentId?: string | null;
  agentsList?: ChatAgentsListSnapshot | null;
  agentsSelectedId?: string | null;
  eventLogBuffer?: unknown[];
  eventLog?: unknown[];
  tab?: string;
  /** Callback for slash-command side effects that need app-level access. */
  onSlashAction?: (action: string) => void | Promise<void>;
};

type ChatAgentsListSnapshot = Partial<Omit<AgentsListResult, "agents">> & {
  agents?: Array<{ id: string }>;
};

type ChatMetadataApplyResult = {
  commands: boolean;
  models: boolean;
};

const GATEWAY_CHANGED_CHAT_SEND_ERROR =
  "Gateway changed before this message was accepted. It is ready to retry after reconnect.";
const GATEWAY_CHANGED_DETACHED_SEND_ERROR =
  "Gateway changed before this detached message was accepted. Verify it was not delivered, then retry it.";
const GATEWAY_CHANGED_DETACHED_SEND_ACCEPTED_ERROR =
  "Gateway changed after this detached message was accepted. It is queued with the original request ID for safe retry.";

function setChatError(host: ChatHost, error: string | null) {
  host.lastError = error;
  host.chatError = error;
}

function clearMatchingChatError(host: ChatHost, prefix: string) {
  if (host.chatError?.startsWith(prefix)) {
    host.chatError = null;
  }
  if (host.lastError?.startsWith(prefix)) {
    host.lastError = null;
  }
}

type AcceptedChatSendAck = ChatSendAck & { status: "started" | "in_flight" | "ok" };
type TerminalFailureChatSendAck = ChatSendAck & { status: "timeout" | "error" };

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

export type ChatSendOptions = {
  confirmReset?: boolean;
  flowId?: string;
  restoreDraft?: boolean;
  skillWorkshopRevision?: ChatQueueSkillWorkshopRevision;
  turnMode?: "queue" | "steer";
};

export type ChatAbortOptions = {
  preserveDraft?: boolean;
};

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
  mainKey?: string;
};

// Chat pickers need recency-free session rows so older channel chats remain selectable.
export const CHAT_SESSIONS_ACTIVE_MINUTES = 0;
export const CHAT_SESSIONS_REFRESH_LIMIT = 50;

export type ChatDetachedSendRecovery = {
  gatewayScope: string;
  sessionKey: string;
  queue: ChatQueueItem[];
};

export function createChatSessionsLoadOverrides(
  state: { sessionsShowArchived?: boolean },
  options: { offset?: number; append?: boolean; search?: string | null } = {},
): LoadSessionsOverrides {
  const overrides: LoadSessionsOverrides = {
    activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
    limit: CHAT_SESSIONS_REFRESH_LIMIT,
    includeGlobal: true,
    includeUnknown: true,
    configuredAgentsOnly: true,
  };

  if (typeof state.sessionsShowArchived === "boolean") {
    overrides.showArchived = state.sessionsShowArchived;
  }
  const search = normalizeOptionalString(options.search ?? undefined);
  if (search) {
    overrides.search = search;
  }
  const offset =
    typeof options.offset === "number" && Number.isFinite(options.offset)
      ? Math.max(0, Math.floor(options.offset))
      : 0;
  if (offset > 0) {
    overrides.offset = offset;
  }
  if (options.append === true) {
    overrides.append = true;
  }
  return overrides;
}
export {
  handleChatDraftChange,
  handleChatInputHistoryKey,
  navigateChatInputHistory,
  resetChatInputHistoryNavigation,
};
export type { ChatInputHistoryKeyInput, ChatInputHistoryKeyResult };

export function isChatBusy(host: ChatHost) {
  return host.chatSending || Boolean(host.chatRunId);
}

export function hasAbortableSessionRun(host: {
  chatRunId?: string | null;
  sessionKey: string;
  sessionsResult?: SessionsListResult | null;
}): boolean {
  if (host.chatRunId) {
    return true;
  }
  return Boolean(
    host.sessionsResult?.sessions.some(
      (session) => session.key === host.sessionKey && isSessionRunActive(session),
    ),
  );
}

export function isChatStopCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = normalizeLowercaseStringOrEmpty(trimmed);
  if (normalized === "/stop") {
    return true;
  }
  return (
    normalized === "stop" ||
    normalized === "esc" ||
    normalized === "abort" ||
    normalized === "wait" ||
    normalized === "exit"
  );
}

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

function readHelloDefaultAgentId(host: Pick<ChatHost, "hello">): string | undefined {
  const snapshot = host.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  return snapshot?.sessionDefaults?.defaultAgentId?.trim() || undefined;
}

function scopedAgentIdForSession(host: ChatHost, sessionKey: string | undefined | null) {
  return isUiGlobalSessionKey(sessionKey)
    ? resolveUiKnownSelectedGlobalAgentId(host)
    : (resolveUiGlobalAliasAgentId(host, sessionKey) ?? undefined);
}

function visibleSessionMatches(
  host: ChatHost,
  sessionKey: string,
  agentId: string | undefined,
): boolean {
  if (host.sessionKey !== sessionKey) {
    const hostAliasAgentId = resolveUiGlobalAliasAgentId(host, host.sessionKey);
    if (!hostAliasAgentId || !isUiGlobalSessionKey(sessionKey)) {
      return false;
    }
    const expectedAgentId = agentId ?? host.agentsList?.defaultId ?? readHelloDefaultAgentId(host);
    return expectedAgentId
      ? hostAliasAgentId === normalizeAgentId(expectedAgentId)
      : hostAliasAgentId === normalizeAgentId("main");
  }
  if (!isUiGlobalSessionKey(sessionKey)) {
    return true;
  }
  const selectedAgentId = resolveUiKnownSelectedGlobalAgentId(host);
  const expectedAgentId = agentId ?? host.agentsList?.defaultId ?? readHelloDefaultAgentId(host);
  return expectedAgentId
    ? selectedAgentId === normalizeAgentId(expectedAgentId)
    : selectedAgentId === undefined;
}

export function scopedAgentParamsForSession(
  host: Pick<ChatHost, "assistantAgentId" | "agentsList" | "hello">,
  sessionKey: string,
) {
  const agentId = isUiGlobalSessionKey(sessionKey)
    ? resolveUiKnownSelectedGlobalAgentId(host)
    : resolveUiGlobalAliasAgentId(host, sessionKey);
  return agentId ? { agentId } : {};
}

export function scopedAgentListParamsForSession(
  host: Pick<ChatHost, "assistantAgentId" | "agentsList" | "hello">,
  sessionKey: string,
) {
  const parsed = parseAgentSessionKey(sessionKey);
  const normalizedSessionKey = normalizeLowercaseStringOrEmpty(sessionKey);
  const agentId =
    parsed?.agentId ??
    (normalizedSessionKey === "global"
      ? resolveUiKnownSelectedGlobalAgentId(host)
      : normalizedSessionKey === "unknown"
        ? undefined
        : resolveUiDefaultAgentId(host));
  return agentId ? { agentId: normalizeAgentId(agentId) } : {};
}

export function scopedAgentListParamsForRefreshTarget(
  host: Pick<ChatHost, "assistantAgentId" | "agentsList" | "hello">,
  target: ChatSessionRefreshTarget,
) {
  const agentId =
    normalizeOptionalString(target.agentId) ??
    scopedAgentListParamsForSession(host, target.sessionKey).agentId;
  return agentId ? { agentId: normalizeAgentId(agentId) } : {};
}

export async function handleAbortChat(host: ChatHost, opts?: ChatAbortOptions) {
  const activeRunId = host.chatRunId;
  const clearDraft = () => {
    if (opts?.preserveDraft) {
      return;
    }
    host.chatMessage = "";
    resetChatInputHistoryNavigation(host);
  };
  // If disconnected but this session is abortable, queue the abort for when we reconnect.
  if (!host.connected && hasAbortableSessionRun(host)) {
    clearDraft();
    host.pendingAbort = {
      runId: activeRunId,
      sessionKey: host.sessionKey,
      ...scopedAgentParamsForSession(host, host.sessionKey),
    };
    return;
  }
  if (!host.connected) {
    return;
  }
  clearDraft();
  await abortChatRun(host as unknown as ChatState);
}

function enqueueChatMessage(
  host: ChatHost,
  text: string,
  attachments?: ChatAttachment[],
  refreshSessions?: boolean,
  localCommand?: { args: string; name: string },
): ChatQueueItem | null {
  const trimmed = text.trim();
  const hasAttachments = Boolean(attachments && attachments.length > 0);
  if (!trimmed && !hasAttachments) {
    return null;
  }
  const item: ChatQueueItem = {
    id: generateUUID(),
    text: trimmed,
    createdAt: Date.now(),
    attachments: hasAttachments ? cloneChatAttachmentsMetadata(attachments ?? []) : undefined,
    refreshSessions,
    localCommandArgs: localCommand?.args,
    localCommandName: localCommand?.name,
    sessionKey: host.sessionKey,
    agentId: scopedAgentIdForSession(host, host.sessionKey),
  };
  host.chatQueue = [...host.chatQueue, item];
  return item;
}

function enqueuePendingRunMessage(
  host: ChatHost,
  text: string,
  pendingRunId: string,
  attachments?: ChatAttachment[],
) {
  const trimmed = text.trim();
  const hasAttachments = Boolean(attachments && attachments.length > 0);
  if (!trimmed && !hasAttachments) {
    return;
  }
  host.chatQueue = [
    ...host.chatQueue,
    {
      id: generateUUID(),
      text: trimmed,
      createdAt: Date.now(),
      kind: "steered",
      attachments: hasAttachments ? cloneChatAttachmentsMetadata(attachments ?? []) : undefined,
      pendingRunId,
    },
  ];
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
  turnMode: "queue" | "steer" = "queue",
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
    ...(turnMode === "steer" ? { kind: "steered" as const } : {}),
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

function updateQueuedMessage(
  host: ChatHost,
  id: string,
  update: (item: ChatQueueItem) => ChatQueueItem,
): ChatQueueItem | null {
  return updateQueuedMessageForSession(host, host.sessionKey, id, update);
}

function readChatQueueForSession(host: ChatHost, sessionKey: string): ChatQueueItem[] {
  return sessionKey === host.sessionKey
    ? host.chatQueue
    : (host.chatQueueBySession?.[sessionKey] ?? []);
}

function writeChatQueueForSession(host: ChatHost, sessionKey: string, queue: ChatQueueItem[]) {
  if (sessionKey === host.sessionKey) {
    host.chatQueue = queue;
    return;
  }
  const queueBySession = { ...host.chatQueueBySession };
  if (queue.length > 0) {
    queueBySession[sessionKey] = queue;
  } else {
    delete queueBySession[sessionKey];
  }
  host.chatQueueBySession = queueBySession;
  host.requestUpdate?.();
}

function currentChatQueueGatewayGeneration(host: ChatHost): number {
  return host.chatQueueGatewayGeneration ?? 0;
}

type ChatQueueGatewayGuard = {
  client: GatewayBrowserClient | null;
  generation: number;
  gatewayScope: string;
  persistenceState: Parameters<typeof persistStoredChatComposerQueue>[0];
};

function captureChatQueueGatewayGuard(host: ChatHost): ChatQueueGatewayGuard {
  return {
    client: host.client,
    generation: currentChatQueueGatewayGeneration(host),
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
      chatComposerPersistenceSuspended: host.chatComposerPersistenceSuspended,
    },
  };
}

function isCurrentChatQueueGateway(host: ChatHost, guard: ChatQueueGatewayGuard): boolean {
  return (
    host.client === guard.client && currentChatQueueGatewayGeneration(host) === guard.generation
  );
}

type ChatTurnsListResponse = { turns?: ChatTurnSummary[] };

function isExecutionStateSnapshot(
  value: ChatTurnsListResponse | ExecutionStateSnapshot,
): value is ExecutionStateSnapshot {
  return (
    "snapshotRevision" in value &&
    typeof value.snapshotRevision === "string" &&
    "sessionKey" in value &&
    typeof value.sessionKey === "string" &&
    "health" in value
  );
}
type ChatTurnResponse = { turn?: ChatTurnSummary };
type ChatTurnMutationResponse = {
  found?: boolean;
  applied?: boolean;
  reason?: string;
  turn?: ChatTurnSummary;
};

function queueItemFromServerTurn(turn: ChatTurnSummary, existing?: ChatQueueItem): ChatQueueItem {
  return {
    id: turn.id,
    text: turn.message,
    createdAt: turn.createdAt,
    kind: turn.mode === "steer" ? "steered" : "queued",
    ...(existing?.attachments?.length ? { attachments: existing.attachments } : {}),
    sessionKey: turn.sessionKey,
    ...(turn.agentId ? { agentId: turn.agentId } : {}),
    serverTurnId: turn.id,
    serverRevision: turn.revision,
    serverPhase: turn.phase,
    ...(turn.activitySummary ? { serverActivitySummary: turn.activitySummary } : {}),
    serverLastActivityAt: turn.lastActivityAt,
    serverAdmissionOpen: turn.admissionOpen,
    serverAttachmentCount: turn.attachmentCount,
    ...(turn.runId ? { sendRunId: turn.runId } : {}),
    ...(turn.phase === "failed" ? { sendState: "failed" as const } : {}),
    ...(turn.lastError ? { sendError: turn.lastError } : {}),
  };
}

function applyServerTurnToQueue(host: ChatHost, turn: ChatTurnSummary): ChatQueueItem {
  const sessionKey = turn.sessionKey;
  const queue = readChatQueueForSession(host, sessionKey);
  const existing = queue.find((entry) => entry.serverTurnId === turn.id || entry.id === turn.id);
  const next = queueItemFromServerTurn(turn, existing);
  writeChatQueueForSession(
    host,
    sessionKey,
    [
      ...queue.filter((entry) => entry.serverTurnId !== turn.id && entry.id !== turn.id),
      next,
    ].toSorted((left, right) => left.createdAt - right.createdAt),
  );
  return next;
}

export async function loadServerChatTurns(
  host: ChatHost,
  sessionKey = host.sessionKey,
  options: { gatewayGuard?: ChatQueueGatewayGuard } = {},
): Promise<void> {
  const gatewayGuard = options.gatewayGuard ?? captureChatQueueGatewayGuard(host);
  if (!gatewayGuard.client || !host.connected || !isCurrentChatQueueGateway(host, gatewayGuard)) {
    return;
  }
  if (isGatewayMethodAdvertised(host as unknown as ChatState, "chat.turns.list") !== true) {
    return;
  }
  const client = gatewayGuard.client;
  try {
    const response =
      isGatewayMethodAdvertised(host as unknown as ChatState, "executionState.get") === true
        ? await client.request<ExecutionStateSnapshot>("executionState.get", {
            sessionKey,
            includeTerminal: true,
          })
        : await client.request<ChatTurnsListResponse>("chat.turns.list", {
            sessionKey,
            includeTerminal: true,
          });
    if (
      host.client !== client ||
      !host.connected ||
      !isCurrentChatQueueGateway(host, gatewayGuard)
    ) {
      return;
    }
    const visibleTurns = (response.turns ?? []).filter(
      (turn) => turn.phase !== "delivered" && turn.phase !== "cancelled",
    );
    if (isExecutionStateSnapshot(response)) {
      host.chatExecutionState = response;
    }
    const visibleIds = new Set(visibleTurns.map((turn) => turn.id));
    const queue = readChatQueueForSession(host, sessionKey);
    const retainedLocal = queue.filter(
      (entry) => !entry.serverTurnId || visibleIds.has(entry.serverTurnId),
    );
    const removed = queue.filter(
      (entry) => entry.serverTurnId && !visibleIds.has(entry.serverTurnId),
    );
    const existingById = new Map(
      retainedLocal
        .filter((entry) => entry.serverTurnId)
        .map((entry) => [entry.serverTurnId!, entry] as const),
    );
    const localOnly = retainedLocal.filter((entry) => !entry.serverTurnId);
    const serverItems = visibleTurns.map((turn) =>
      queueItemFromServerTurn(turn, existingById.get(turn.id)),
    );
    writeChatQueueForSession(
      host,
      sessionKey,
      [...localOnly, ...serverItems].toSorted((left, right) => left.createdAt - right.createdAt),
    );
    for (const item of removed) {
      releaseChatAttachmentPayloads(excludeComposerAttachments(host, item.attachments));
    }
    clearMatchingChatError(host, "Could not refresh queued turns:");
  } catch (error) {
    // Older or temporarily unavailable gateways keep the browser queue usable.
    setChatError(host, `Could not refresh queued turns: ${formatConnectError(error)}`);
  }
}

async function createServerChatTurn(
  host: ChatHost,
  item: ChatQueueItem,
  mode: "queue" | "steer",
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  if (isGatewayMethodAdvertised(host as unknown as ChatState, "chat.turns.create") !== true) {
    return false;
  }
  const sessionKey = item.sessionKey ?? host.sessionKey;
  const gatewayGuard = captureChatQueueGatewayGuard(host);
  if (!gatewayGuard.client) {
    return false;
  }
  const transition = (async () => {
    try {
      const response = await gatewayGuard.client!.request<ChatTurnResponse>("chat.turns.create", {
        sessionKey: item.sessionKey ?? host.sessionKey,
        ...(item.agentId ? { agentId: item.agentId } : {}),
        message: item.text,
        attachments: buildApiAttachments(item.attachments),
        mode,
        idempotencyKey: item.sendRunId ?? item.id,
      });
      if (!response.turn) {
        throw new Error("Gateway returned no queued turn.");
      }
      if (!isCurrentChatQueueGateway(host, gatewayGuard)) {
        return false;
      }
      const queue = readChatQueueForSession(host, sessionKey);
      const local = queue.find((entry) => entry.id === item.id);
      writeChatQueueForSession(
        host,
        sessionKey,
        queue.filter((entry) => entry.id !== item.id),
      );
      applyServerTurnToQueue(host, response.turn);
      const mapped = readChatQueueForSession(host, response.turn.sessionKey).find(
        (entry) => entry.serverTurnId === response.turn?.id,
      );
      if (mapped && local?.attachments?.length) {
        updateQueuedMessageForSession(host, response.turn.sessionKey, mapped.id, (entry) => ({
          ...entry,
          attachments: local.attachments,
        }));
      }
      return true;
    } catch (error) {
      if (!isCurrentChatQueueGateway(host, gatewayGuard)) {
        return false;
      }
      const sendError = formatConnectError(error);
      updateQueuedMessageForSession(host, sessionKey, item.id, (entry) => ({
        ...entry,
        sendState: "failed",
        sendError,
      }));
      return false;
    }
  })();
  const transitions = new Set(host.chatQueueCreateTransitionsBySession?.[sessionKey]);
  transitions.add(transition);
  host.chatQueueCreateTransitionsBySession = {
    ...host.chatQueueCreateTransitionsBySession,
    [sessionKey]: transitions,
  };
  void transition.finally(() => {
    const current = host.chatQueueCreateTransitionsBySession?.[sessionKey];
    if (!current?.has(transition)) {
      return;
    }
    const remaining = new Set(current);
    remaining.delete(transition);
    const next = { ...host.chatQueueCreateTransitionsBySession };
    if (remaining.size > 0) {
      next[sessionKey] = remaining;
    } else {
      delete next[sessionKey];
    }
    host.chatQueueCreateTransitionsBySession = next;
  });
  return transition;
}

async function mutateServerChatTurn(
  host: ChatHost,
  item: ChatQueueItem,
  method: "chat.turns.setMode" | "chat.turns.cancel" | "chat.turns.retry",
  extra: Record<string, unknown> = {},
  gatewayGuard: ChatQueueGatewayGuard = captureChatQueueGatewayGuard(host),
  options: { retryRevisionConflict?: boolean } = {},
): Promise<ChatTurnMutationResponse | null> {
  if (
    !gatewayGuard.client ||
    !host.connected ||
    !isCurrentChatQueueGateway(host, gatewayGuard) ||
    !item.serverTurnId ||
    item.serverRevision == null
  ) {
    return null;
  }
  const sessionKey = item.sessionKey ?? host.sessionKey;
  const idempotencyKey = generateUUID();
  const requestMutation = async (candidate: ChatQueueItem) =>
    await gatewayGuard.client!.request<ChatTurnMutationResponse>(method, {
      turnId: candidate.serverTurnId,
      sessionKey,
      expectedRevision: candidate.serverRevision,
      idempotencyKey,
      ...extra,
    });
  try {
    let current = item;
    let response = await requestMutation(current);
    if (!isCurrentChatQueueGateway(host, gatewayGuard)) {
      return null;
    }
    if (response.turn) {
      applyServerTurnToQueue(host, response.turn);
    }
    if (
      options.retryRevisionConflict !== false &&
      !response.applied &&
      response.reason === "revision_conflict"
    ) {
      await loadServerChatTurns(host, sessionKey, { gatewayGuard });
      if (!isCurrentChatQueueGateway(host, gatewayGuard)) {
        return null;
      }
      const refreshed = readChatQueueForSession(host, sessionKey).find(
        (entry) => entry.serverTurnId === item.serverTurnId,
      );
      if (refreshed?.serverRevision != null) {
        current = refreshed;
        response = await requestMutation(current);
        if (!isCurrentChatQueueGateway(host, gatewayGuard)) {
          return null;
        }
        if (response.turn) {
          applyServerTurnToQueue(host, response.turn);
        }
      }
    }
    if (!response.applied && response.found !== false) {
      updateQueuedMessageForSession(host, sessionKey, current.id, (entry) => ({
        ...entry,
        sendError: response.reason ?? "Queue action was not applied.",
      }));
    } else if (response.applied) {
      updateQueuedMessageForSession(host, sessionKey, current.id, (entry) => ({
        ...entry,
        sendError: undefined,
      }));
    }
    return response;
  } catch (error) {
    if (!isCurrentChatQueueGateway(host, gatewayGuard)) {
      return null;
    }
    updateQueuedMessageForSession(host, sessionKey, item.id, (entry) => ({
      ...entry,
      sendError: formatConnectError(error),
    }));
    return null;
  }
}

function setChatErrorForSession(host: ChatHost, sessionKey: string, error: string): void {
  if (host.sessionKey === sessionKey) {
    setChatError(host, error);
  }
}

function updateQueuedMessageForSession(
  host: ChatHost,
  sessionKey: string,
  id: string,
  update: (item: ChatQueueItem) => ChatQueueItem,
): ChatQueueItem | null {
  let nextItem: ChatQueueItem | null = null;
  const nextQueue = readChatQueueForSession(host, sessionKey).map((item) => {
    if (item.id !== id) {
      return item;
    }
    nextItem = update(item);
    return nextItem;
  });
  writeChatQueueForSession(host, sessionKey, nextQueue);
  return nextItem;
}

function persistQueuedMessagesForSession(
  host: ChatHost,
  sessionKey: string,
  options: {
    requireComplete?: boolean;
    gatewayGuard?: ChatQueueGatewayGuard;
    queue?: ChatQueueItem[];
  } = {},
): boolean {
  const persistenceState = options.gatewayGuard?.persistenceState;
  const queue = options.queue ?? readChatQueueForSession(host, sessionKey);
  if (persistenceState) {
    return persistStoredChatComposerQueue(
      persistenceState,
      sessionKey,
      queue,
      options.queue === undefined && sessionKey === host.sessionKey
        ? host.chatQueuePaused === true
        : undefined,
      options.queue === undefined && sessionKey === host.sessionKey
        ? { requireComplete: options.requireComplete, draft: host.chatMessage }
        : { requireComplete: options.requireComplete },
    );
  }
  const { requireComplete } = options;
  return persistStoredChatComposerQueue(
    host,
    sessionKey,
    queue,
    options.queue === undefined && sessionKey === host.sessionKey
      ? host.chatQueuePaused === true
      : undefined,
    options.queue === undefined && sessionKey === host.sessionKey
      ? { requireComplete, draft: host.chatMessage }
      : { requireComplete },
  );
}

function recoverQueuedSendAfterGatewayChange(
  host: ChatHost,
  sessionKey: string,
  id: string,
  gatewayGuard?: ChatQueueGatewayGuard,
): boolean {
  const recovered = updateQueuedMessageForSession(host, sessionKey, id, (item) => ({
    ...item,
    sendError: GATEWAY_CHANGED_CHAT_SEND_ERROR,
    sendState: "waiting-reconnect",
  }));
  if (!recovered) {
    return false;
  }
  persistQueuedMessagesForSession(host, sessionKey, {
    requireComplete: true,
    gatewayGuard,
  });
  if (host.sessionKey === sessionKey) {
    setChatError(host, GATEWAY_CHANGED_CHAT_SEND_ERROR);
  }
  return true;
}

function mergeDetachedSendRecoveryIntoLiveQueue(
  host: ChatHost,
  sessionKey: string,
  gatewayGuard: ChatQueueGatewayGuard | undefined,
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
  writeChatQueueForSession(host, sessionKey, nextQueue);
  return true;
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

function enqueueDetachedSendRecovery(
  host: ChatHost,
  params: {
    sessionKey: string;
    agentId?: string;
    message: string;
    attachments?: ChatAttachment[];
    gatewayGuard?: ChatQueueGatewayGuard;
    sendRunId?: string;
    accepted?: boolean;
  },
): void {
  const sendRunId = params.sendRunId ?? generateUUID();
  const sendAccepted = params.accepted === true;
  const item: ChatQueueItem = {
    id: generateUUID(),
    text: params.message,
    createdAt: Date.now(),
    ...(params.attachments?.length ? { attachments: params.attachments } : {}),
    sendError: sendAccepted
      ? GATEWAY_CHANGED_DETACHED_SEND_ACCEPTED_ERROR
      : GATEWAY_CHANGED_DETACHED_SEND_ERROR,
    sendRunId,
    sendState: sendAccepted ? "waiting-reconnect" : "failed",
    sessionKey: params.sessionKey,
    ...(params.agentId ? { agentId: params.agentId } : {}),
  };
  const previousSnapshot = params.gatewayGuard
    ? loadChatComposerSnapshot(params.gatewayGuard.persistenceState, params.sessionKey)
    : null;
  const matchingRecovery = params.gatewayGuard
    ? (host.chatDetachedSendRecoveries ?? []).find(
        (recovery) =>
          recovery.gatewayScope === params.gatewayGuard?.gatewayScope &&
          recovery.sessionKey === params.sessionKey,
      )
    : undefined;
  const recoveryQueue = mergeDetachedRecoveryQueue(
    matchingRecovery?.queue ?? [],
    previousSnapshot?.queue ?? [],
    [item],
  );
  let persisted = true;
  if (params.gatewayGuard) {
    // A detached message belongs to the Gateway that accepted the request. Do
    // not put it in the replacement principal's live queue, where Retry could
    // send it through the wrong Gateway; persist it in the captured scope only.
    persisted = persistQueuedMessagesForSession(host, params.sessionKey, {
      requireComplete: true,
      gatewayGuard: params.gatewayGuard,
      queue: recoveryQueue,
    });
    // Keep a one-shot in-memory copy even when durable persistence succeeds.
    // Reconnect may restore a non-empty provisional queue and skip storage;
    // without this buffer the detached item could be lost on the next write.
    host.chatDetachedSendRecoveries = [
      ...(host.chatDetachedSendRecoveries ?? []).filter(
        (recovery) =>
          recovery.gatewayScope !== params.gatewayGuard?.gatewayScope ||
          recovery.sessionKey !== params.sessionKey,
      ),
      {
        gatewayScope: params.gatewayGuard.gatewayScope,
        sessionKey: params.sessionKey,
        queue: recoveryQueue,
      },
    ];
    mergeDetachedSendRecoveryIntoLiveQueue(
      host,
      params.sessionKey,
      params.gatewayGuard,
      recoveryQueue,
    );
  } else {
    writeChatQueueForSession(host, params.sessionKey, recoveryQueue);
    persistQueuedMessagesForSession(host, params.sessionKey, {
      requireComplete: true,
    });
  }
  if (host.sessionKey === params.sessionKey) {
    setChatError(
      host,
      !persisted
        ? "Gateway changed before this detached message was accepted. Browser storage was unavailable; it remains in memory and will be restored only when the original Gateway reconnects."
        : sendAccepted
          ? GATEWAY_CHANGED_DETACHED_SEND_ACCEPTED_ERROR
          : GATEWAY_CHANGED_DETACHED_SEND_ERROR,
    );
  }
}

export function isChatQueuePausePendingForSession(
  host: Pick<ChatHost, "chatQueuePausePendingBySession" | "sessionKey">,
  sessionKey: string,
): boolean {
  return host.chatQueuePausePendingBySession?.[sessionKey] === true;
}

export function isChatQueuePaused(
  host: Pick<ChatHost, "chatQueuePaused" | "chatQueuePausePendingBySession" | "sessionKey">,
): boolean {
  return host.chatQueuePaused === true || isChatQueuePausePendingForSession(host, host.sessionKey);
}

export function isChatQueuePausedForSession(
  host: Pick<ChatHost, "chatQueuePaused" | "chatQueuePausedBySession" | "sessionKey"> &
    Parameters<typeof loadChatComposerSnapshot>[0],
  sessionKey: string,
): boolean {
  if (isChatQueuePausePendingForSession(host, sessionKey)) {
    return true;
  }
  const remembered = host.chatQueuePausedBySession?.[sessionKey];
  if (remembered !== undefined) {
    return remembered;
  }
  if (sessionKey === host.sessionKey) {
    return host.chatQueuePaused === true;
  }
  return loadChatComposerSnapshot(host, sessionKey)?.queuePaused === true;
}

function rememberChatQueuePaused(host: ChatHost, sessionKey: string, paused: boolean): void {
  host.chatQueuePausedBySession = {
    ...host.chatQueuePausedBySession,
    [sessionKey]: paused,
  };
}

function rememberChatQueuePausePending(host: ChatHost, sessionKey: string, pending: boolean): void {
  const next = { ...host.chatQueuePausePendingBySession };
  if (pending) {
    next[sessionKey] = true;
  } else {
    delete next[sessionKey];
  }
  host.chatQueuePausePendingBySession = next;
}

function setChatQueuePausedForSession(
  host: ChatHost,
  sessionKey: string,
  paused: boolean,
  options: { requirePersistence?: boolean } = {},
): boolean {
  const persisted = persistStoredChatComposerQueue(
    host,
    sessionKey,
    readChatQueueForSession(host, sessionKey),
    paused,
    {
      requireComplete: options.requirePersistence === true,
      ...(sessionKey === host.sessionKey ? { draft: host.chatMessage } : {}),
    },
  );
  if (options.requirePersistence && !persisted) {
    return false;
  }
  rememberChatQueuePaused(host, sessionKey, paused);
  if (host.sessionKey === sessionKey) {
    host.chatQueuePaused = paused;
  }
  return true;
}

export async function setChatQueuePaused(host: ChatHost, paused: boolean): Promise<boolean> {
  if (host.chatComposerPersistenceSuspended) {
    setChatError(
      host,
      "Chat is reconnecting to the Gateway; wait for it to finish before pausing.",
    );
    host.requestUpdate?.();
    return false;
  }
  const sessionKey = host.sessionKey;
  const gatewayGuard = captureChatQueueGatewayGuard(host);
  const existingTransition = host.chatQueuePauseTransitionsBySession?.[sessionKey];
  if (existingTransition) {
    if (paused) {
      return existingTransition;
    }
    await existingTransition;
    if (!isCurrentChatQueueGateway(host, gatewayGuard)) {
      return false;
    }
  }

  if (!paused) {
    if (!isCurrentChatQueueGateway(host, gatewayGuard)) {
      return false;
    }
    const resumed = setChatQueuePausedForSession(host, sessionKey, false, {
      requirePersistence: true,
    });
    if (!resumed) {
      setChatErrorForSession(
        host,
        sessionKey,
        "Could not resume the queue safely because its browser state could not be saved. Retry Resume.",
      );
      host.requestUpdate?.();
      return true;
    }
    host.requestUpdate?.();
    void flushChatQueue(host);
    return false;
  }

  if (
    host.chatQueuePausedBySession?.[sessionKey] === true ||
    (host.sessionKey === sessionKey && host.chatQueuePaused === true)
  ) {
    return true;
  }

  // Latch before the first Gateway await. New sends and an already-starting
  // queue flush must observe the transition instead of racing the pause.
  rememberChatQueuePausePending(host, sessionKey, true);
  rememberChatQueuePaused(host, sessionKey, true);
  if (host.sessionKey === sessionKey) {
    host.chatQueuePaused = true;
  }
  host.requestUpdate?.();

  const transition = (async () => {
    const createTransitions = host.chatQueueCreateTransitionsBySession?.[sessionKey];
    if (createTransitions?.size) {
      await Promise.all(createTransitions);
    }
    if (!isCurrentChatQueueGateway(host, gatewayGuard)) {
      // Do not leave a speculative pause latched after the connection that
      // would have persisted it is gone; otherwise reload can resume queued
      // work even though the UI appeared paused.
      rememberChatQueuePaused(host, sessionKey, false);
      if (host.sessionKey === sessionKey) {
        host.chatQueuePaused = false;
      }
      return false;
    }
    if (
      !setChatQueuePausedForSession(host, sessionKey, true, {
        requirePersistence: true,
      })
    ) {
      setChatErrorForSession(
        host,
        sessionKey,
        "Could not pause new messages safely because this browser could not save the queue state. Retry Pause.",
      );
      // A failed strict commit must not leave a sticky in-memory pause that
      // the user cannot clear when storage is unavailable or over quota.
      setChatQueuePausedForSession(host, sessionKey, false);
      return false;
    }
    return true;
  })().finally(() => {
    const currentTransition = host.chatQueuePauseTransitionsBySession?.[sessionKey];
    const ownsTransition = currentTransition === transition;
    const canClearOrphanedPending =
      ownsTransition ||
      (currentTransition === undefined &&
        host.chatQueuePausePendingBySession?.[sessionKey] === true);
    if (!canClearOrphanedPending) {
      return;
    }
    if (ownsTransition) {
      const next = { ...host.chatQueuePauseTransitionsBySession };
      delete next[sessionKey];
      host.chatQueuePauseTransitionsBySession = next;
    }
    rememberChatQueuePausePending(host, sessionKey, false);
    host.requestUpdate?.();
  });
  host.chatQueuePauseTransitionsBySession = {
    ...host.chatQueuePauseTransitionsBySession,
    [sessionKey]: transition,
  };
  return transition;
}

export function toggleChatQueuePaused(host: ChatHost): Promise<boolean> {
  return setChatQueuePaused(host, !isChatQueuePaused(host));
}

function removeQueuedMessageWithoutReleasing(
  host: ChatHost,
  id: string,
  sessionKey = host.sessionKey,
): ChatQueueItem | null {
  const queue = readChatQueueForSession(host, sessionKey);
  const item = queue.find((entry) => entry.id === id) ?? null;
  writeChatQueueForSession(
    host,
    sessionKey,
    queue.filter((entry) => entry.id !== id),
  );
  return item;
}

function removeVisibleOrScopedQueuedMessageWithoutReleasing(
  host: ChatHost,
  id: string,
  sessionKey: string | undefined,
): ChatQueueItem | null {
  return (
    removeQueuedMessageWithoutReleasing(host, id) ??
    (sessionKey ? removeQueuedMessageWithoutReleasing(host, id, sessionKey) : null)
  );
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

type ChatSendTimingPhase =
  | "pending-visible"
  | "pending-painted"
  | "request-start"
  | "ack"
  | "server-dispatch-started"
  | "server-model-selected"
  | "server-agent-run-started"
  | "server-first-assistant-event"
  | "server-dispatch-completed"
  | "server-post-dispatch-completed"
  | "first-assistant-visible"
  | "terminal-before-delta"
  | "queued-busy"
  | "queued-server"
  | "waiting-model"
  | "waiting-reconnect"
  | "failed";

type ChatSendTimingEntry = {
  runId: string;
  sessionKey?: string;
  agentId?: string;
  sendAttempts: number;
  sendState?: ChatQueueItem["sendState"];
  submittedAtMs: number;
  requestStartedAtMs?: number;
  ackAtMs?: number;
  ackStatus?: ChatSendAck["status"];
  firstAssistantVisibleRecorded?: boolean;
};

type ChatSendServerTimingPhase =
  | "dispatch-started"
  | "model-selected"
  | "agent-run-started"
  | "first-assistant-event"
  | "dispatch-completed"
  | "post-dispatch-completed";

const CHAT_SEND_SERVER_TIMING_PHASES = new Set<ChatSendServerTimingPhase>([
  "dispatch-started",
  "model-selected",
  "agent-run-started",
  "first-assistant-event",
  "dispatch-completed",
  "post-dispatch-completed",
]);
const CHAT_SEND_SLOW_FIRST_ASSISTANT_MS = 1_500;

function chatSendTimingOptions(slow: boolean) {
  return { console: slow, warn: slow, maxBufferedEventsForType: 40 };
}

function recordChatSendTiming(
  host: ChatHost,
  item: Pick<
    ChatQueueItem,
    "sendRunId" | "sessionKey" | "agentId" | "sendAttempts" | "sendState" | "sendSubmittedAtMs"
  >,
  phase: ChatSendTimingPhase,
  startedAtMs = item.sendSubmittedAtMs,
  extra: Record<string, unknown> = {},
) {
  if (startedAtMs == null) {
    return;
  }
  recordControlUiPerformanceEvent(
    host as Parameters<typeof recordControlUiPerformanceEvent>[0],
    "control-ui.chat.send",
    {
      phase,
      durationMs: roundedControlUiDurationMs(controlUiNowMs() - startedAtMs),
      runId: item.sendRunId,
      sessionKey: item.sessionKey,
      agentId: item.agentId,
      sendAttempts: item.sendAttempts ?? 0,
      sendState: item.sendState,
      ...extra,
    },
    { console: false, maxBufferedEventsForType: 40 },
  );
}

function readChatSendServerTimingPhase(value: unknown): ChatSendServerTimingPhase | null {
  return typeof value === "string" &&
    (CHAT_SEND_SERVER_TIMING_PHASES as ReadonlySet<string>).has(value)
    ? (value as ChatSendServerTimingPhase)
    : null;
}

function readChatSendTimingNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function recordChatSendServerTiming(host: ChatHost, payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const record = payload as Record<string, unknown>;
  const phase = readChatSendServerTimingPhase(record.phase);
  const runId = typeof record.runId === "string" && record.runId.trim() ? record.runId.trim() : "";
  if (!phase || !runId) {
    return;
  }
  const entry = host.chatSendTimingsByRun?.get(runId);
  const nowMs = controlUiNowMs();
  const serverAckToPhaseMs = readChatSendTimingNumber(record.ackToPhaseMs);
  const serverReceivedToPhaseMs = readChatSendTimingNumber(record.receivedToPhaseMs);
  const serverDispatchStartedToPhaseMs = readChatSendTimingNumber(record.dispatchStartedToPhaseMs);
  const serverPostDispatchMs = readChatSendTimingNumber(record.postDispatchMs);
  const durationMs =
    entry?.submittedAtMs !== undefined
      ? roundedControlUiDurationMs(nowMs - entry.submittedAtMs)
      : serverAckToPhaseMs;
  if (durationMs === undefined) {
    return;
  }
  const slow = phase === "first-assistant-event" && durationMs >= CHAT_SEND_SLOW_FIRST_ASSISTANT_MS;
  recordControlUiPerformanceEvent(
    host as Parameters<typeof recordControlUiPerformanceEvent>[0],
    "control-ui.chat.send",
    {
      phase: `server-${phase}`,
      durationMs,
      runId,
      sessionKey:
        entry?.sessionKey ??
        (typeof record.sessionKey === "string" && record.sessionKey.trim()
          ? record.sessionKey.trim()
          : undefined),
      agentId:
        entry?.agentId ??
        (typeof record.agentId === "string" && record.agentId.trim()
          ? record.agentId.trim()
          : undefined),
      sendAttempts: entry?.sendAttempts ?? 0,
      sendState: entry?.sendState,
      ackStatus: entry?.ackStatus,
      serverPhase: phase,
      ...(serverAckToPhaseMs !== undefined ? { serverAckToPhaseMs } : {}),
      ...(serverReceivedToPhaseMs !== undefined ? { serverReceivedToPhaseMs } : {}),
      ...(serverDispatchStartedToPhaseMs !== undefined ? { serverDispatchStartedToPhaseMs } : {}),
      ...(serverPostDispatchMs !== undefined ? { serverPostDispatchMs } : {}),
      ...(typeof record.provider === "string" && record.provider.trim()
        ? { provider: record.provider.trim() }
        : {}),
      ...(typeof record.model === "string" && record.model.trim()
        ? { model: record.model.trim() }
        : {}),
      ...(typeof record.agentRunId === "string" && record.agentRunId.trim()
        ? { agentRunId: record.agentRunId.trim() }
        : {}),
      ...(slow ? { slow: true } : {}),
    },
    chatSendTimingOptions(slow),
  );
}

function ensureChatSendTimingEntries(host: ChatHost): Map<string, ChatSendTimingEntry> {
  if (host.chatSendTimingsByRun) {
    return host.chatSendTimingsByRun;
  }
  const entries = new Map<string, ChatSendTimingEntry>();
  host.chatSendTimingsByRun = entries;
  return entries;
}

function registerChatSendTiming(
  host: ChatHost,
  item: Pick<
    ChatQueueItem,
    "sendRunId" | "sessionKey" | "agentId" | "sendAttempts" | "sendState" | "sendSubmittedAtMs"
  >,
  runId: string,
  requestStartedAtMs: number,
) {
  ensureChatSendTimingEntries(host).set(runId, {
    runId,
    sessionKey: item.sessionKey,
    agentId: item.agentId,
    sendAttempts: item.sendAttempts ?? 0,
    sendState: item.sendState,
    submittedAtMs: item.sendSubmittedAtMs ?? requestStartedAtMs,
    requestStartedAtMs,
  });
}

function updateChatSendAckTiming(
  host: ChatHost,
  requestedRunId: string,
  ack: ChatSendAck,
  item: Pick<
    ChatQueueItem,
    "sessionKey" | "agentId" | "sendAttempts" | "sendState" | "sendSubmittedAtMs"
  >,
  requestStartedAtMs: number,
) {
  const entries = ensureChatSendTimingEntries(host);
  const existing = entries.get(requestedRunId);
  const submittedAtMs = existing?.submittedAtMs ?? item.sendSubmittedAtMs ?? requestStartedAtMs;
  const next: ChatSendTimingEntry = {
    ...(existing ?? {
      runId: ack.runId,
      sessionKey: item.sessionKey,
      agentId: item.agentId,
      sendAttempts: item.sendAttempts ?? 0,
      sendState: item.sendState,
      submittedAtMs,
      requestStartedAtMs,
    }),
    runId: ack.runId,
    sessionKey: existing?.sessionKey ?? item.sessionKey,
    agentId: existing?.agentId ?? item.agentId,
    ackAtMs: controlUiNowMs(),
    ackStatus: ack.status,
  };
  if (ack.runId !== requestedRunId) {
    entries.delete(requestedRunId);
  }
  entries.set(ack.runId, next);
}

function chatSendAckServerTimingEventFields(ack: ChatSendAck): Record<string, number> {
  const timing = ack.serverTiming;
  return {
    ...(typeof timing?.receivedToAckMs === "number"
      ? { serverReceivedToAckMs: timing.receivedToAckMs }
      : {}),
    ...(typeof timing?.loadSessionMs === "number"
      ? { serverLoadSessionMs: timing.loadSessionMs }
      : {}),
    ...(typeof timing?.prepareAttachmentsMs === "number"
      ? { serverPrepareAttachmentsMs: timing.prepareAttachmentsMs }
      : {}),
  };
}

function chatEventHasVisibleTerminalPayload(payload: ChatEventPayload): boolean {
  if (payload.state === "error" && payload.errorMessage?.trim()) {
    return true;
  }
  return Boolean(payload.message && typeof payload.message === "object");
}

function resolveFirstAssistantTimingPhase(
  host: ChatHost,
  payload: ChatEventPayload,
  entry: ChatSendTimingEntry,
): Extract<ChatSendTimingPhase, "first-assistant-visible" | "terminal-before-delta"> | null {
  if (entry.firstAssistantVisibleRecorded) {
    return null;
  }
  if (payload.state === "delta") {
    return typeof host.chatStream === "string" && host.chatStream.trim()
      ? "first-assistant-visible"
      : null;
  }
  if (payload.state === "final" || payload.state === "aborted" || payload.state === "error") {
    return chatEventHasVisibleTerminalPayload(payload) ? "terminal-before-delta" : null;
  }
  return null;
}

export function recordFirstAssistantChatTiming(
  host: ChatHost,
  payload: ChatEventPayload | undefined,
  handledState: ChatEventPayload["state"] | null,
) {
  if (!payload || !handledState || typeof payload.runId !== "string") {
    return;
  }
  const runId = payload.runId.trim();
  const entry = runId ? host.chatSendTimingsByRun?.get(runId) : undefined;
  if (!entry) {
    return;
  }
  const phase = resolveFirstAssistantTimingPhase(host, payload, entry);
  if (!phase) {
    if (payload.state === "final" || payload.state === "aborted" || payload.state === "error") {
      host.chatSendTimingsByRun?.delete(runId);
    }
    return;
  }

  const eventAtMs = controlUiNowMs();
  entry.firstAssistantVisibleRecorded = true;
  scheduleControlUiAfterPaint(host, () => {
    const paintedAtMs = controlUiNowMs();
    const durationMs = roundedControlUiDurationMs(paintedAtMs - entry.submittedAtMs);
    const slow = durationMs >= CHAT_SEND_SLOW_FIRST_ASSISTANT_MS;
    recordControlUiPerformanceEvent(
      host as Parameters<typeof recordControlUiPerformanceEvent>[0],
      "control-ui.chat.send",
      {
        phase,
        durationMs,
        runId,
        sessionKey: entry.sessionKey ?? payload.sessionKey,
        agentId: entry.agentId ?? payload.agentId,
        sendAttempts: entry.sendAttempts,
        sendState: entry.sendState,
        ackStatus: entry.ackStatus,
        eventState: payload.state,
        firstAssistantPaintMs: roundedControlUiDurationMs(paintedAtMs - eventAtMs),
        ...(entry.requestStartedAtMs != null
          ? {
              requestToFirstAssistantEventMs: roundedControlUiDurationMs(
                eventAtMs - entry.requestStartedAtMs,
              ),
            }
          : {}),
        ...(entry.ackAtMs != null
          ? {
              ackToFirstAssistantEventMs: roundedControlUiDurationMs(eventAtMs - entry.ackAtMs),
            }
          : {}),
        ...(slow ? { slow: true } : {}),
      },
      chatSendTimingOptions(slow),
    );
    if (phase === "terminal-before-delta") {
      host.chatSendTimingsByRun?.delete(runId);
    }
  });
}

function shouldRecordPendingSendPaint(item: ChatQueueItem): boolean {
  return (
    typeof item.sendSubmittedAtMs === "number" &&
    (item.sendState === "waiting-model" ||
      item.sendState === "sending" ||
      item.sendState === "waiting-reconnect")
  );
}

function schedulePendingSendPaintTiming(
  host: ChatHost,
  item: ChatQueueItem,
  startedAtMs = item.sendSubmittedAtMs,
) {
  const sessionKey = item.sessionKey ?? host.sessionKey;
  const sendRunId = item.sendRunId;
  if (!sendRunId || startedAtMs == null) {
    return;
  }
  scheduleControlUiAfterPaint(host as Parameters<typeof scheduleControlUiAfterPaint>[0], () => {
    if (!visibleSessionMatches(host, sessionKey, item.agentId)) {
      return;
    }
    const queued = readChatQueueForSession(host, sessionKey).find(
      (entry) => entry.id === item.id && entry.sendRunId === sendRunId,
    );
    if (!queued || !shouldRecordPendingSendPaint(queued)) {
      return;
    }
    recordChatSendTiming(host, queued, "pending-painted", startedAtMs);
  });
}

function ensureQueuedSendState(
  host: ChatHost,
  item: ChatQueueItem,
  fallbackSessionKey = host.sessionKey,
): ChatQueueItem {
  if (item.sendRunId && item.sendState) {
    return item;
  }
  const sessionKey = item.sessionKey ?? fallbackSessionKey;
  const agentId = item.agentId ?? scopedAgentIdForSession(host, sessionKey);
  const prepared: ChatQueueItem = {
    ...item,
    sendAttempts: item.sendAttempts ?? 0,
    sendRunId: item.sendRunId ?? generateUUID(),
    sendState: host.connected && host.client ? "sending" : "waiting-reconnect",
    sessionKey,
    agentId,
  };
  updateQueuedMessageForSession(host, sessionKey, item.id, () => prepared);
  return prepared;
}

async function sendQueuedChatMessage(
  host: ChatHost,
  id: string,
  opts?: {
    flowId?: string;
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
  const message = prepared.text.trim();
  const attachments = prepared.attachments ?? [];
  const hasAttachments = attachments.length > 0;
  if (!message && !hasAttachments) {
    removeQueuedMessageWithoutReleasing(host, id, prepared.sessionKey ?? host.sessionKey);
    return "sent";
  }
  if (prepared.skillWorkshopRevision && hasAttachments) {
    updateQueuedMessageForSession(host, prepared.sessionKey ?? host.sessionKey, id, (item) => ({
      ...item,
      sendError: "Skill Workshop revision requests do not support attachments.",
      sendState: "failed",
    }));
    return "failed";
  }
  const sessionKey = prepared.sessionKey ?? host.sessionKey;
  if (!host.connected || !host.client) {
    updateQueuedMessageForSession(host, sessionKey, id, (item) => ({
      ...item,
      sendState: "waiting-reconnect",
      sendError: undefined,
    }));
    return "pending";
  }

  const gatewayGuard = captureChatQueueGatewayGuard(host);
  const isCurrentGateway = () => isCurrentChatQueueGateway(host, gatewayGuard);

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
  host.chatSendingGatewayGeneration = gatewayGuard.generation;
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
          ...(opts?.flowId ? { flowId: opts.flowId } : {}),
        });
    if (!isCurrentGateway()) {
      recoverQueuedSendAfterGatewayChange(host, sessionKey, id, gatewayGuard);
      if (host.chatSendingGatewayGeneration === gatewayGuard.generation) {
        host.chatSending = false;
        host.chatSendingGatewayGeneration = null;
      }
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
      return "failed";
    }
    removeQueuedMessageWithoutReleasing(host, id, sessionKey);
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
        void loadSessions(host as unknown as SessionsState, {
          ...createChatSessionsLoadOverrides(host),
          ...scopedAgentListParamsForRefreshTarget(host, refreshTarget),
        });
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
    return "failed";
  } finally {
    if (isCurrentGateway() && host.chatSendingGatewayGeneration === gatewayGuard.generation) {
      host.chatSending = false;
      host.chatSendingGatewayGeneration = null;
    }
  }
}

async function sendChatMessageNow(
  host: ChatHost,
  message: string,
  opts?: {
    flowId?: string;
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
    flowId: opts?.flowId,
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
  kind: "btw" | "message",
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

export async function withChatSubmitGuard<T>(
  host: { chatSubmitGuards?: Map<string, Promise<void>> },
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

function excludeComposerAttachments(
  host: ChatHost,
  attachments: readonly ChatAttachment[] | undefined,
): ChatAttachment[] | undefined {
  if (!attachments?.length) {
    return attachments ? [] : undefined;
  }
  const retainedIds = new Set((host.chatAttachments ?? []).map((attachment) => attachment.id));
  return attachments.filter((attachment) => !retainedIds.has(attachment.id));
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

async function sendDetachedBtwMessage(
  host: ChatHost,
  message: string,
  opts?: {
    sessionKey?: string;
    agentId?: string;
    previousDraft?: string;
    attachments?: ChatAttachment[];
    previousAttachments?: ChatAttachment[];
    gatewayGuard?: ChatQueueGatewayGuard;
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
  if (opts?.gatewayGuard && !isCurrentChatQueueGateway(host, opts.gatewayGuard)) {
    enqueueDetachedSendRecovery(host, {
      sessionKey: opts.sessionKey ?? host.sessionKey,
      agentId: opts.agentId,
      message,
      attachments: opts.attachments,
      gatewayGuard: opts.gatewayGuard,
      sendRunId,
      accepted: isAcceptedChatSendAck(ack),
    });
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
  const item = host.chatQueue.find((entry) => entry.id === id);
  if (!item) {
    return;
  }
  if (host.chatComposerPersistenceSuspended) {
    setChatError(
      host,
      "Chat is reconnecting to the Gateway; wait for it to finish before sending.",
    );
    return;
  }
  if (isChatQueuePaused(host)) {
    setChatError(host, "Queue is paused; resume it before steering a message.");
    return;
  }
  if (item.serverTurnId) {
    if (!item.serverAdmissionOpen) {
      return;
    }
    await mutateServerChatTurn(host, item, "chat.turns.setMode", {
      mode: item.kind === "steered" ? "queue" : "steer",
    });
    return;
  }
  if (!host.connected || !host.chatRunId || item.pendingRunId || item.localCommandName) {
    return;
  }
  const activeRunId = host.chatRunId;
  const message = item.text.trim();
  const attachments = item.attachments ?? [];
  const hasAttachments = attachments.length > 0;
  if (!message && !hasAttachments) {
    return;
  }

  host.chatQueue = host.chatQueue.map((entry) =>
    entry.id === id ? { ...entry, kind: "steered", pendingRunId: activeRunId } : entry,
  );
  const ack = await sendSteerChatMessage(
    host as unknown as ChatState,
    message,
    hasAttachments ? attachments : undefined,
  );
  if (!ack || isTerminalFailureChatSendAck(ack)) {
    host.chatQueue = host.chatQueue.map((entry) => (entry.id === id ? item : entry));
    if (isTerminalFailureChatSendAck(ack)) {
      setChatError(host, formatTerminalChatSendAckError(ack, "steer"));
    }
    return;
  }
  if (ack.status === "ok") {
    removeQueuedMessageWithoutReleasing(host, id, host.sessionKey);
  }
  releaseChatAttachmentPayloads(attachments);
  setLastActiveSessionKey(
    host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
    host.sessionKey,
  );
  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
}

async function flushChatQueue(host: ChatHost) {
  if (!host.connected || isChatBusy(host) || isChatQueuePaused(host)) {
    return;
  }
  const nextIndex = host.chatQueue.findIndex(
    (item) =>
      !item.serverTurnId &&
      !item.pendingRunId &&
      item.sendState !== "sending" &&
      item.sendState !== "waiting-model" &&
      item.sendState !== "failed" &&
      // Older persisted queue entries can retain the error without its state.
      // Keep those sends manual-retry-only instead of silently resubmitting them.
      !(item.sendError && !item.sendState) &&
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
      await dispatchSlashCommand(host, next.localCommandName, next.localCommandArgs ?? "");
      ok = true;
    } else if (
      !next.skillWorkshopRevision &&
      isGatewayMethodAdvertised(host as unknown as ChatState, "chat.turns.create") === true
    ) {
      const pending = updateQueuedMessage(host, next.id, (item) => ({
        ...item,
        sendError: undefined,
        sendState: undefined,
      }));
      ok = pending
        ? await createServerChatTurn(host, pending, pending.kind === "steered" ? "steer" : "queue")
        : false;
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

function isSelectedSessionKnownIdle(
  sessionsResult: SessionsListResult,
  sessionKey: string,
): boolean {
  const row = sessionsResult.sessions.find((session) =>
    areUiSessionKeysEquivalent(session.key, sessionKey),
  );
  return Boolean(row && !isSessionRunActive(row));
}

function isHistorySessionInfoForRequestedSession(
  host: ChatHost,
  historySessionKey: string | undefined,
  requestedSessionKey: string,
): boolean {
  if (areUiSessionKeysEquivalent(historySessionKey, requestedSessionKey)) {
    return true;
  }
  return Boolean(
    historySessionKey &&
    isUiGlobalSessionKey(historySessionKey) &&
    resolveUiGlobalAliasAgentId(host, requestedSessionKey),
  );
}

function findSelectedSessionRow(
  host: ChatHost,
  sessionsResult: SessionsListResult | null | undefined,
  sessionKey: string,
  historySessionKey: string | undefined,
): GatewaySessionRow | undefined {
  const requestedGlobalAgentId =
    historySessionKey && isUiGlobalSessionKey(historySessionKey)
      ? resolveUiGlobalAliasAgentId(host, sessionKey)
      : undefined;
  return sessionsResult?.sessions.find((session) => {
    if (areUiSessionKeysEquivalent(session.key, sessionKey)) {
      return true;
    }
    return (
      requestedGlobalAgentId != null &&
      resolveUiGlobalAliasAgentId(host, session.key) === requestedGlobalAgentId
    );
  });
}

function historyIdleProofIsStaleForSelectedRow(
  historySessionInfo: GatewaySessionRow,
  selectedRow: GatewaySessionRow | undefined,
): boolean {
  if (!selectedRow || !isSessionRunActive(selectedRow) || isSessionRunActive(historySessionInfo)) {
    return false;
  }
  const historyUpdatedAt =
    typeof historySessionInfo.updatedAt === "number" ? historySessionInfo.updatedAt : null;
  if (historyUpdatedAt == null) {
    return true;
  }
  const selectedUpdatedAt = typeof selectedRow.updatedAt === "number" ? selectedRow.updatedAt : 0;
  if (selectedUpdatedAt >= historyUpdatedAt) {
    return true;
  }
  const selectedStartedAt = typeof selectedRow.startedAt === "number" ? selectedRow.startedAt : 0;
  return selectedStartedAt >= historyUpdatedAt;
}

export function flushChatQueueAfterIdleSessionReconciliation(
  host: ChatHost,
  sessionKey: string,
  historyRefresh: Promise<ChatHistoryResult | undefined>,
  sessionsRefresh: Promise<unknown>,
  previousSessionsResult: SessionsListResult | null | undefined,
) {
  if (
    readChatQueueForSession(host, sessionKey).length === 0 ||
    isChatQueuePausedForSession(host, sessionKey)
  ) {
    return;
  }
  void Promise.allSettled([historyRefresh, sessionsRefresh]).then((results) => {
    const historyRefreshSettled = results[0];
    const sessionsRefreshSettled = results[1];
    const freshSessionsResult = host.sessionsResult;
    const historySessionInfo =
      historyRefreshSettled.status === "fulfilled"
        ? historyRefreshSettled.value?.sessionInfo
        : null;
    const selectedSessionRow = findSelectedSessionRow(
      host,
      freshSessionsResult,
      sessionKey,
      historySessionInfo?.key,
    );
    const historySessionKnownIdle = Boolean(
      historySessionInfo &&
      isHistorySessionInfoForRequestedSession(host, historySessionInfo.key, sessionKey) &&
      !isSessionRunActive(historySessionInfo) &&
      !historyIdleProofIsStaleForSelectedRow(historySessionInfo, selectedSessionRow),
    );
    const sessionsResultKnownIdle = freshSessionsResult
      ? isSelectedSessionKnownIdle(freshSessionsResult, sessionKey)
      : false;
    if (
      sessionsRefreshSettled.status !== "fulfilled" ||
      readChatQueueForSession(host, sessionKey).length === 0 ||
      !areUiSessionKeysEquivalent(host.sessionKey, sessionKey) ||
      (!freshSessionsResult && !historySessionKnownIdle) ||
      (freshSessionsResult === previousSessionsResult && !historySessionKnownIdle) ||
      (host.sessionsError && !historySessionKnownIdle) ||
      !(historySessionKnownIdle || sessionsResultKnownIdle)
    ) {
      return;
    }
    if (!isChatQueuePausedForSession(host, sessionKey)) {
      void flushChatQueue(host);
    }
  });
}

export async function removeQueuedMessage(host: ChatHost, id: string) {
  const serverItem = host.chatQueue.find((item) => item.id === id && item.serverTurnId);
  if (serverItem) {
    const result = await mutateServerChatTurn(host, serverItem, "chat.turns.cancel");
    if (result?.applied || result?.found === false) {
      const removed = host.chatQueue.filter((item) => item.id === id);
      host.chatQueue = host.chatQueue.filter((item) => item.id !== id);
      for (const item of removed) {
        releaseChatAttachmentPayloads(excludeComposerAttachments(host, item.attachments));
      }
    }
    return;
  }
  const removed = host.chatQueue.filter((item) => item.id === id);
  host.chatQueue = host.chatQueue.filter((item) => item.id !== id);
  for (const item of removed) {
    releaseChatAttachmentPayloads(excludeComposerAttachments(host, item.attachments));
  }
}

export function clearPendingQueueItemsForRun(host: ChatHost, runId: string | undefined) {
  if (!runId) {
    return;
  }
  const removed = host.chatQueue.filter((item) => item.pendingRunId === runId);
  host.chatQueue = host.chatQueue.filter((item) => item.pendingRunId !== runId);
  for (const item of removed) {
    releaseChatAttachmentPayloads(excludeComposerAttachments(host, item.attachments));
  }
}

type ChatQueueStoreHost = {
  chatQueue: ChatQueueItem[];
  chatQueueBySession?: Record<string, ChatQueueItem[]>;
};

function chatQueueCollections(host: ChatQueueStoreHost): ChatQueueItem[][] {
  return [host.chatQueue, ...Object.values(host.chatQueueBySession ?? {})];
}

export function hasReconnectableQueuedChatSends(host: ChatQueueStoreHost): boolean {
  return chatQueueCollections(host).some((queue) =>
    queue.some((item) => item.sendRunId && item.sendState === "waiting-reconnect"),
  );
}

export function markQueuedChatSendsWaitingForReconnect(host: ChatQueueStoreHost) {
  const markQueue = (queue: ChatQueueItem[]): { changed: boolean; queue: ChatQueueItem[] } => {
    let changed = false;
    const nextQueue = queue.map((item) => {
      if (!item.sendRunId || item.sendState !== "sending") {
        return item;
      }
      changed = true;
      return {
        ...item,
        sendState: "waiting-reconnect" as const,
      };
    });
    return { changed, queue: nextQueue };
  };

  const active = markQueue(host.chatQueue);
  if (active.changed) {
    host.chatQueue = active.queue;
  }

  let changed = false;
  const queueBySession = { ...host.chatQueueBySession };
  for (const [sessionKey, queue] of Object.entries(queueBySession)) {
    const next = markQueue(queue);
    if (next.changed) {
      changed = true;
      queueBySession[sessionKey] = next.queue;
    }
  }
  if (changed) {
    host.chatQueueBySession = queueBySession;
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
        !entry.serverTurnId &&
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
  const item = host.chatQueue.find((entry) => entry.id === id);
  if (isChatQueuePaused(host)) {
    setChatError(host, "Queue is paused; resume it before retrying.");
    return;
  }
  if (item?.serverTurnId) {
    await mutateServerChatTurn(host, item, "chat.turns.retry");
    return;
  }
  if (
    !item ||
    item.localCommandName ||
    item.pendingRunId ||
    item.sendState === "sending" ||
    item.sendState === "waiting-model"
  ) {
    return;
  }
  updateQueuedMessage(host, id, (entry) => ({
    ...entry,
    sendError: undefined,
    sendState: host.connected && host.client ? "sending" : "waiting-reconnect",
  }));
  if (
    host.connected &&
    host.client &&
    !item.skillWorkshopRevision &&
    isGatewayMethodAdvertised(host as unknown as ChatState, "chat.turns.create") === true
  ) {
    const pending = updateQueuedMessage(host, id, (entry) => ({
      ...entry,
      sendState: undefined,
    }));
    if (pending) {
      await createServerChatTurn(host, pending, pending.kind === "steered" ? "steer" : "queue");
    }
    return;
  }
  await sendQueuedChatMessage(host, id);
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
  const parsed = shouldInterpretChatCommands ? parseSlashCommand(message) : null;
  const submitGatewayGuard =
    host.connected && host.client ? captureChatQueueGatewayGuard(host) : null;
  const isSubmitGatewayCurrent = () =>
    !submitGatewayGuard || isCurrentChatQueueGateway(host, submitGatewayGuard);

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

  if (
    isChatQueuePausePendingForSession(host, submittedSessionKey) &&
    !isChatStopCommand(message) &&
    !(parsed?.command.key === "approve" && isChatBusy(host))
  ) {
    if (host.sessionKey === submittedSessionKey) {
      setChatError(host, "Queue pause is still being applied; try again when it finishes.");
    }
    return;
  }

  if (isChatQueuePaused(host) && (opts?.flowId != null || opts?.turnMode === "steer")) {
    setChatError(
      host,
      "Resume Chat before sending a goal or steer message so its routing is preserved.",
    );
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

    const isApprovalCommand = parsed?.command.key === "approve" && isChatBusy(host);
    if (isBtwCommand(message) && isChatQueuePaused(host)) {
      setChatError(host, "Chat is paused; resume it before sending a detached message.");
      return;
    }

    if (isBtwCommand(message) || isApprovalCommand) {
      const submitKey = chatSubmitKey(host, "btw", message, attachmentsToSend);
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
        if (isBtwCommand(message) && isChatQueuePaused(host)) {
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
        await sendDetachedBtwMessage(host, message, {
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
    if (parsed?.command.executeLocal) {
      if (
        (isChatBusy(host) || isChatQueuePaused(host)) &&
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
          isChatQueuePaused(host) &&
          !persistQueuedMessagesForSession(host, submittedSessionKey, { requireComplete: true })
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
      await dispatchSlashCommand(host, parsed.command.key, parsed.args, {
        previousDraft: prevDraft,
        restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
      });
      return;
    }
  }

  const refreshSessions = shouldInterpretChatCommands && isChatResetCommand(message);
  const submitKey = chatSubmitKey(
    host,
    "message",
    message,
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
      message,
      hasAttachments ? attachmentsToSend : undefined,
      refreshSessions,
      submittedAtMs,
      waitingForModel ? "waiting-model" : undefined,
      skillWorkshopRevision,
      opts?.turnMode,
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

    if (isChatQueuePaused(host)) {
      updateQueuedMessage(host, queued.id, (item) => ({
        ...item,
        sendError: undefined,
        sendState: host.connected && host.client ? undefined : "waiting-reconnect",
      }));
      if (
        !persistQueuedMessagesForSession(host, submittedSessionKey, {
          requireComplete: true,
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
      }
      return;
    }

    const serverInboxAdvertised =
      !opts?.flowId &&
      isGatewayMethodAdvertised(host as unknown as ChatState, "chat.turns.create") === true;
    if (serverInboxAdvertised) {
      const pending = updateQueuedMessage(host, queued.id, (item) => ({
        ...item,
        sendError: undefined,
        sendState: undefined,
      }));
      recordChatSendTiming(
        host,
        queued,
        isChatBusy(host) ? "queued-busy" : "queued-server",
        submittedAtMs,
      );
      if (pending) {
        await createServerChatTurn(host, pending, opts?.turnMode ?? "queue");
      }
      return;
    }

    if (isChatBusy(host)) {
      if (opts?.flowId) {
        cancelPendingSendBeforeRequest(host, queued, {
          previousDraft: cleared.previousDraft,
          previousAttachments: cleared.previousAttachments,
        });
        setChatError(host, "Wait for the current chat run to finish before continuing a goal.");
        return;
      }
      updateQueuedMessage(host, queued.id, (item) => ({
        ...item,
        sendError: undefined,
        sendState: undefined,
      }));
      recordChatSendTiming(host, queued, "queued-busy", submittedAtMs);
      // Legacy gateways without the durable inbox keep their browser-local queue.
      return;
    }

    await sendChatMessageNow(host, message, {
      flowId: opts?.flowId,
      queueItemId: queued.id,
      previousDraft: cleared.previousDraft,
      restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
      attachments: hasAttachments ? attachmentsToSend : undefined,
      previousAttachments: cleared.previousAttachments,
      restoreAttachments: Boolean(messageOverride && opts?.restoreDraft),
      refreshSessions,
      submittedAtMs,
    });
  });
}

function shouldQueueLocalSlashCommand(name: string): boolean {
  return !["stop", "export-session", "steer", "redirect", "new"].includes(name);
}

// ── Slash Command Dispatch ──

async function dispatchSlashCommand(
  host: ChatHost,
  name: string,
  args: string,
  sendOpts?: { previousDraft?: string; restoreDraft?: boolean },
) {
  switch (name) {
    case "stop":
      await handleAbortChat(host);
      return;
    case "new":
      if (!host.onSlashAction) {
        setChatError(host, "New Chat is unavailable.");
        return;
      }
      await host.onSlashAction("new-session");
      return;
    case "reset":
      await sendChatMessageNow(host, args ? `/reset ${args}` : "/reset", {
        refreshSessions: true,
        previousDraft: sendOpts?.previousDraft,
        restoreDraft: sendOpts?.restoreDraft,
      });
      return;
    case "clear":
      await clearChatHistory(host);
      return;
    case "export-session":
      await host.onSlashAction?.("export");
      return;
  }

  if (!host.client || !host.connected) {
    setChatError(host, "Gateway not connected");
    injectCommandResult(
      host,
      `Cannot run \`/${name}\`: Control UI is not connected to the Gateway.`,
    );
    scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
    return;
  }

  const targetSessionKey = host.sessionKey;
  let result: Awaited<ReturnType<typeof executeSlashCommand>>;
  try {
    result = await executeSlashCommand(host.client, targetSessionKey, name, args, {
      chatModelCatalog: host.chatModelCatalog,
      sessionsResult: host.sessionsResult,
      agentId: scopedAgentIdForSession(host, targetSessionKey),
    });
  } catch (err) {
    setChatError(host, String(err));
    injectCommandResult(host, `Command \`/${name}\` failed unexpectedly.`);
    scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
    return;
  }

  if (result.content) {
    injectCommandResult(host, result.content);
  }

  if (result.trackRunId) {
    host.chatRunId = result.trackRunId;
    host.chatStream = "";
    host.chatSending = false;
  }

  if (result.pendingCurrentRun && host.chatRunId) {
    enqueuePendingRunMessage(host, `/${name} ${args}`.trim(), host.chatRunId);
  }

  if (result.sessionPatch && "modelOverride" in result.sessionPatch) {
    host.chatModelOverrides = {
      ...host.chatModelOverrides,
      [targetSessionKey]: result.sessionPatch.modelOverride ?? null,
    };
    await host.onSlashAction?.("refresh-tools-effective");
  }

  if (result.action === "refresh") {
    await refreshChat(host);
  }

  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
}

function clearCachedChatMessagesForSession(host: ChatHost, sessionKey: string) {
  if (!host.chatMessagesBySession) {
    return;
  }
  clearChatMessagesFromCache(host.chatMessagesBySession, host, { sessionKey });
}

async function clearChatHistory(host: ChatHost) {
  if (!host.client || !host.connected) {
    return;
  }
  const hadActiveRun = hasAbortableSessionRun(host);
  try {
    await host.client.request("sessions.reset", {
      key: host.sessionKey,
      ...scopedAgentParamsForSession(host, host.sessionKey),
    });
    host.chatMessages = [];
    clearCachedChatMessagesForSession(host, host.sessionKey);
    host.chatSideResult = null;
    reconcileChatRunLifecycle(host as unknown as Parameters<typeof reconcileChatRunLifecycle>[0], {
      outcome: hadActiveRun ? "interrupted" : undefined,
      sessionStatus: "killed",
      runId: host.chatRunId,
      sessionKey: host.sessionKey,
      clearLocalRun: true,
      clearChatStream: true,
      clearToolStream: true,
      clearSideResultTerminalRuns: true,
      clearRunStatus: !hadActiveRun,
    });
    await loadChatHistory(host as unknown as ChatState);
  } catch (err) {
    setChatError(host, String(err));
  }
  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
}

function injectCommandResult(host: ChatHost, content: string) {
  host.chatMessages = [
    ...host.chatMessages,
    {
      role: "system",
      content,
      timestamp: Date.now(),
    },
  ];
}

export async function refreshChat(
  host: ChatHost,
  opts?: { scheduleScroll?: boolean; awaitHistory?: boolean; startup?: boolean },
) {
  const refreshedSessionKey = host.sessionKey;
  const refreshedClient = host.client;
  const refreshedAgentId = resolveAgentIdForSession(host);
  const requestUpdate = () => host.requestUpdate?.();
  const previousSessionsResult = host.sessionsResult;
  const historyLoad = loadChatHistory(host as unknown as ChatState, {
    startup: opts?.startup === true,
  });
  const serverTurnsRefresh = loadServerChatTurns(host, refreshedSessionKey);
  const historyRefresh = historyLoad.finally(() => {
    if (opts?.scheduleScroll !== false) {
      scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
    }
    requestUpdate();
  });
  const sessionsRefresh = historyLoad.then((history) => {
    if (history?.sessionInfo) {
      applyChatHistorySessionInfo(
        host as unknown as SessionsState,
        history.sessionInfo,
        history.defaults,
      );
    }
  });
  const startupMetadataRefresh =
    opts?.startup === true
      ? historyLoad.then((history) => {
          if (!history?.metadata || !refreshedClient) {
            return { commands: false, models: false };
          }
          if (
            host.client !== refreshedClient ||
            !host.connected ||
            host.sessionKey !== refreshedSessionKey ||
            resolveAgentIdForSession(host) !== refreshedAgentId
          ) {
            return { commands: false, models: false };
          }
          return applyChatMetadataResult(host, refreshedClient, refreshedAgentId, history.metadata);
        })
      : Promise.resolve({ commands: false, models: false });
  flushChatQueueAfterIdleSessionReconciliation(
    host,
    refreshedSessionKey,
    historyRefresh,
    sessionsRefresh,
    previousSessionsResult,
  );
  const secondaryRefresh = Promise.allSettled([
    sessionsRefresh,
    startupMetadataRefresh,
    serverTurnsRefresh,
  ]).finally(requestUpdate);
  scheduleChatMetadataRefresh(() => {
    if (host.sessionKey !== refreshedSessionKey || !host.connected) {
      return;
    }
    void startupMetadataRefresh
      .catch(() => ({ commands: false, models: false }))
      .then((metadataApplied) => {
        const metadataRefresh =
          opts?.startup === true && (metadataApplied.commands || metadataApplied.models)
            ? metadataApplied.models
              ? Promise.allSettled([])
              : Promise.allSettled([refreshChatModels(host)])
            : Promise.allSettled([refreshChatMetadata(host)]);
        return Promise.allSettled([refreshChatAvatar(host), metadataRefresh]);
      })
      .finally(requestUpdate);
  });
  void historyRefresh;
  void secondaryRefresh;
  if (opts?.awaitHistory === true) {
    await historyRefresh;
    return;
  }
  await Promise.resolve();
}

function scheduleChatMetadataRefresh(callback: () => void) {
  const requestIdleCallback =
    typeof globalThis.requestIdleCallback === "function" ? globalThis.requestIdleCallback : null;
  if (requestIdleCallback) {
    requestIdleCallback(callback, { timeout: 750 });
    return;
  }
  globalThis.setTimeout(callback, 50);
}

async function refreshChatModels(host: ChatHost) {
  if (!host.client || !host.connected) {
    host.chatModelsLoading = false;
    host.chatModelCatalog = [];
    return;
  }
  host.chatModelsLoading = true;
  try {
    host.chatModelCatalog = await loadModels(host.client);
  } finally {
    host.chatModelsLoading = false;
  }
}

export async function refreshChatCommands(host: ChatHost) {
  await refreshSlashCommands({
    client: host.client,
    agentId: resolveAgentIdForSession(host),
  });
}

function applyChatMetadataResult(
  host: ChatHost,
  client: GatewayBrowserClient,
  agentId: string | null | undefined,
  result: ChatMetadataResult,
): ChatMetadataApplyResult {
  const models = applyModelCatalogResult(result.models);
  if (models) {
    host.chatModelCatalog = models;
  }
  const commandsApplied = applyRemoteSlashCommandsResult({
    client,
    agentId,
    result,
  });
  return { commands: commandsApplied, models: Boolean(models) };
}

async function refreshChatMetadata(host: ChatHost) {
  if (!host.client || !host.connected) {
    host.chatModelsLoading = false;
    host.chatModelCatalog = [];
    return;
  }
  const client = host.client;
  const sessionKey = host.sessionKey;
  const agentId = resolveAgentIdForSession(host);
  const metadataAdvertised = isGatewayMethodAdvertised(
    host as unknown as ChatState,
    "chat.metadata",
  );
  if (metadataAdvertised === false) {
    await Promise.allSettled([refreshChatModels(host), refreshChatCommands(host)]);
    return;
  }

  host.chatModelsLoading = true;
  try {
    const result = await client.request<ChatMetadataResult>(
      "chat.metadata",
      agentId ? { agentId } : {},
    );
    if (
      host.client !== client ||
      !host.connected ||
      host.sessionKey !== sessionKey ||
      resolveAgentIdForSession(host) !== agentId
    ) {
      return;
    }
    const metadataApplied = applyChatMetadataResult(host, client, agentId, result);
    if (!metadataApplied.models || !metadataApplied.commands) {
      await Promise.allSettled([
        ...(metadataApplied.models ? [] : [refreshChatModels(host)]),
        ...(metadataApplied.commands ? [] : [refreshChatCommands(host)]),
      ]);
    }
  } catch {
    await Promise.allSettled([refreshChatModels(host), refreshChatCommands(host)]);
  } finally {
    if (host.client === client) {
      host.chatModelsLoading = false;
    }
  }
}

export const flushChatQueueForEvent = flushChatQueue;
const chatAvatarRequestVersions = new WeakMap<object, number>();

const chatAvatarObjectUrls = new WeakMap<object, string>();

function beginChatAvatarRequest(host: ChatHost): number {
  const key = host as object;
  const nextVersion = (chatAvatarRequestVersions.get(key) ?? 0) + 1;
  chatAvatarRequestVersions.set(key, nextVersion);
  return nextVersion;
}

function shouldApplyChatAvatarResult(
  host: ChatHost,
  version: number,
  sessionKey: string,
  agentId: string | null,
): boolean {
  return (
    chatAvatarRequestVersions.get(host as object) === version &&
    host.sessionKey === sessionKey &&
    resolveAgentIdForSession(host) === agentId
  );
}

function resolveAgentIdForSession(host: ChatHost): string | null {
  const parsed = parseAgentSessionKey(host.sessionKey);
  if (parsed?.agentId) {
    return parsed.agentId;
  }
  if (isUiGlobalSessionKey(host.sessionKey)) {
    return resolveUiSelectedGlobalAgentId(host) || DEFAULT_AGENT_ID;
  }
  return readHelloDefaultAgentId(host) || DEFAULT_AGENT_ID;
}

function buildAvatarMetaUrl(basePath: string, agentId: string): string {
  const base = normalizeBasePath(basePath);
  const encoded = encodeURIComponent(agentId);
  return base ? `${base}/avatar/${encoded}?meta=1` : `/avatar/${encoded}?meta=1`;
}

function clearChatAvatarUrl(host: ChatHost) {
  const key = host as object;
  const previousBlobUrl = chatAvatarObjectUrls.get(key);
  if (previousBlobUrl) {
    URL.revokeObjectURL(previousBlobUrl);
    chatAvatarObjectUrls.delete(key);
  }
  host.chatAvatarUrl = null;
}

function clearChatAvatarState(host: ChatHost) {
  clearChatAvatarUrl(host);
  host.chatAvatarSource = null;
  host.chatAvatarStatus = null;
  host.chatAvatarReason = null;
}

function setChatAvatarUrl(host: ChatHost, nextUrl: string | null) {
  const key = host as object;
  const previousBlobUrl = chatAvatarObjectUrls.get(key);
  if (previousBlobUrl && previousBlobUrl !== nextUrl) {
    URL.revokeObjectURL(previousBlobUrl);
    chatAvatarObjectUrls.delete(key);
  }
  if (nextUrl?.startsWith("blob:")) {
    chatAvatarObjectUrls.set(key, nextUrl);
  }
  host.chatAvatarUrl = nextUrl;
}

function setChatAvatarMeta(
  host: ChatHost,
  data: {
    avatarSource?: unknown;
    avatarStatus?: unknown;
    avatarReason?: unknown;
  },
) {
  const status =
    data.avatarStatus === "none" ||
    data.avatarStatus === "local" ||
    data.avatarStatus === "remote" ||
    data.avatarStatus === "data"
      ? data.avatarStatus
      : null;
  host.chatAvatarSource =
    typeof data.avatarSource === "string" && data.avatarSource.trim()
      ? data.avatarSource.trim()
      : null;
  host.chatAvatarStatus = status;
  host.chatAvatarReason =
    typeof data.avatarReason === "string" && data.avatarReason.trim()
      ? data.avatarReason.trim()
      : null;
}

function buildControlUiAuthHeaders(authHeader: string | null): Record<string, string> | undefined {
  return authHeader ? { Authorization: authHeader } : undefined;
}

function isLocalControlUiAvatarUrl(avatarUrl: string): boolean {
  return avatarUrl.startsWith("/");
}

export async function refreshChatAvatar(host: ChatHost) {
  if (!host.connected) {
    clearChatAvatarState(host);
    return;
  }
  const sessionKey = host.sessionKey;
  const requestVersion = beginChatAvatarRequest(host);
  const agentId = resolveAgentIdForSession(host);
  if (!agentId) {
    if (shouldApplyChatAvatarResult(host, requestVersion, sessionKey, agentId)) {
      clearChatAvatarState(host);
    }
    return;
  }
  clearChatAvatarState(host);
  const authHeader = resolveControlUiAuthHeader(host);
  const headers = buildControlUiAuthHeaders(authHeader);
  const url = buildAvatarMetaUrl(host.basePath, agentId);
  try {
    const res = await fetch(url, { method: "GET", ...(headers ? { headers } : {}) });
    if (!shouldApplyChatAvatarResult(host, requestVersion, sessionKey, agentId)) {
      return;
    }
    if (!res.ok) {
      clearChatAvatarState(host);
      return;
    }
    const data = (await res.json()) as {
      avatarUrl?: unknown;
      avatarSource?: unknown;
      avatarStatus?: unknown;
      avatarReason?: unknown;
    };
    if (!shouldApplyChatAvatarResult(host, requestVersion, sessionKey, agentId)) {
      return;
    }
    setChatAvatarMeta(host, data);
    const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl.trim() : "";
    if (!avatarUrl || !isRenderableControlUiAvatarUrl(avatarUrl)) {
      clearChatAvatarUrl(host);
      return;
    }
    if (!isLocalControlUiAvatarUrl(avatarUrl)) {
      setChatAvatarUrl(host, avatarUrl);
      return;
    }
    const avatarRes = await fetch(avatarUrl, {
      method: "GET",
      ...(headers ? { headers } : {}),
    });
    if (!avatarRes.ok) {
      if (shouldApplyChatAvatarResult(host, requestVersion, sessionKey, agentId)) {
        clearChatAvatarUrl(host);
      }
      return;
    }
    const blobUrl = URL.createObjectURL(await avatarRes.blob());
    if (!shouldApplyChatAvatarResult(host, requestVersion, sessionKey, agentId)) {
      URL.revokeObjectURL(blobUrl);
      return;
    }
    setChatAvatarUrl(host, blobUrl);
  } catch {
    if (shouldApplyChatAvatarResult(host, requestVersion, sessionKey, agentId)) {
      clearChatAvatarState(host);
    }
  }
}
