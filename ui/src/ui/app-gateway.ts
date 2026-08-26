// Control UI module implements app gateway behavior.
import { ConnectErrorDetailCodes } from "../../../packages/gateway-protocol/src/connect-error-details.js";
import {
  GATEWAY_EVENT_UPDATE_AVAILABLE,
  type GatewayUpdateAvailableEventPayload,
} from "../../../src/gateway/events.js";
import {
  normalizeGatewayComposerScope,
  normalizeGatewayCredentialScope,
} from "../app/gateway-scope.ts";
import {
  clearPendingQueueItemsForRun,
  createChatSessionsLoadOverrides,
  flushChatQueueForEvent,
  hasReconnectableQueuedChatSends,
  loadServerChatTurns,
  markQueuedChatSendsWaitingForReconnect,
  recordChatSendServerTiming,
  recordFirstAssistantChatTiming,
  refreshChatAvatar,
  scopedAgentListParamsForRefreshTarget,
  retryReconnectableQueuedChatSends,
  scopedAgentListParamsForSession,
  scopedAgentParamsForSession,
  type ChatDetachedSendRecovery,
} from "./app-chat.ts";
import type { EventLogEntry } from "./app-events.ts";
import {
  applySettings,
  loadCron,
  refreshActiveTab,
  setLastActiveSessionKey,
  syncUrlWithSessionKey,
} from "./app-settings.ts";
import {
  handleAgentEvent,
  handleSessionOperationEvent,
  resetToolStream,
  type AgentEventPayload,
  type SessionOperationEventPayload,
} from "./app-tool-stream.ts";
import { shouldReloadHistoryForFinalEvent } from "./chat-event-reload.ts";
import {
  loadChatComposerSnapshot,
  migrateChatComposerState,
  persistChatComposerState,
  restoreChatComposerState,
} from "./chat/composer-persistence.ts";
import { reconcileChatRunLifecycle } from "./chat/run-lifecycle.ts";
import { parseChatSideResult, type ChatSideResult } from "./chat/side-result.ts";
import { formatConnectError } from "./connect-error.ts";
import {
  recordControlUiConnectTiming,
  recordControlUiRpcTiming,
} from "./control-ui-performance.ts";
import { loadAgents, type AgentsState } from "./controllers/agents.ts";
import {
  loadAssistantIdentity,
  type AssistantIdentityState,
} from "./controllers/assistant-identity.ts";
import {
  loadChatHistory,
  loadChatGoals,
  loadChatWorkTasks,
  handleChatEvent,
  type ChatEventPayload,
  type ChatState,
} from "./controllers/chat.ts";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.ts";
import { loadDevices, type DevicesState } from "./controllers/devices.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import {
  clearResolvedExecApprovalPrompt,
  enqueueExecApprovalPrompt,
  parseExecApprovalRequested,
  parseExecApprovalResolved,
  parsePluginApprovalRequested,
  pruneExecApprovalQueue,
} from "./controllers/exec-approval.ts";
import { loadHealthState, type HealthState } from "./controllers/health.ts";
import { loadPccDashboard } from "./controllers/pcc.ts";
import {
  applySessionsChangedEvent,
  loadSessions,
  subscribeSessions,
  syncSelectedSessionMessageSubscription,
  type SessionsState,
} from "./controllers/sessions.ts";
import {
  resolveGatewayErrorDetailCode,
  type GatewayEventFrame,
  type GatewayHelloOk,
} from "./gateway.ts";
import { GatewayBrowserClient } from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import type { PccDashboardState } from "./pcc/application/state.ts";
import {
  areUiSessionKeysEquivalent,
  buildAgentMainSessionKey,
  isUiGlobalSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
  resolveUiDefaultAgentId,
  resolveUiGlobalAliasAgentId,
  resolveUiSelectedGlobalAgentId,
} from "./session-key.ts";
import type { UiSettings } from "./storage.ts";
import type {
  AgentsListResult,
  PresenceEntry,
  HealthSummary,
  SessionsListResult,
  StatusSummary,
  UpdateAvailable,
} from "./types.ts";
import type { ChatQueueItem, ChatSessionRefreshTarget } from "./ui-types.ts";

function isGenericBrowserFetchFailure(message: string): boolean {
  return /^(?:typeerror:\s*)?(?:fetch failed|failed to fetch)$/i.test(message.trim());
}

type GatewayHost = {
  settings: UiSettings;
  password: string;
  clientInstanceId: string;
  client: GatewayBrowserClient | null;
  connected: boolean;
  hello: GatewayHelloOk | null;
  lastError: string | null;
  lastErrorCode: string | null;
  chatError?: string | null;
  chatComposerMemoryOwner: object;
  onboarding?: boolean;
  eventLogBuffer: EventLogEntry[];
  eventLog: EventLogEntry[];
  tab: Tab;
  presenceEntries: PresenceEntry[];
  presenceError: string | null;
  presenceStatus: StatusSummary | null;
  agentsLoading: boolean;
  agentsList: AgentsListResult | null;
  agentsError: string | null;
  healthLoading: boolean;
  healthResult: HealthSummary | null;
  healthError: string | null;
  debugHealth: HealthSummary | null;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  serverVersion: string | null;
  pendingUpdateExpectedVersion: string | null;
  pendingUpdateHandoff: boolean;
  updateStatusBanner: { tone: "danger" | "warn" | "info"; text: string } | null;
  sessionKey: string;
  sessionsShowArchived: boolean;
  chatRunId: string | null;
  pendingAbort?: { runId?: string | null; sessionKey: string; agentId?: string } | null;
  refreshSessionsAfterChat: Map<string, ChatSessionRefreshTarget>;
  sessionsLoading?: boolean;
  sessionsResult?: SessionsListResult | null;
  sessionsResultAgentId?: string | null;
  sessionsError?: string | null;
  chatAgentSessionRowsByAgent?: Record<string, SessionsListResult["sessions"]>;
  chatSessionPickerOpen?: boolean;
  chatSessionPickerSurface?: "desktop" | "mobile" | "sidebar" | null;
  chatSessionPickerQuery?: string;
  chatSessionPickerAppliedQuery?: string;
  chatSessionPickerLoading?: boolean;
  chatSessionPickerError?: string | null;
  chatSessionPickerResult?: SessionsListResult | null;
  chatModelOverrides?: Record<string, unknown>;
  sessionsExpandedCheckpointKey?: string | null;
  sessionsCheckpointItemsByKey?: Record<string, unknown>;
  sessionsCheckpointLoadingKey?: string | null;
  sessionsCheckpointBusyKey?: string | null;
  sessionsCheckpointErrorByKey?: Record<string, string>;
  chatMessage: string;
  chatSending?: boolean;
  chatSendingGatewayGeneration?: number | null;
  chatQueueGatewayGeneration?: number;
  chatQueue: ChatQueueItem[];
  chatQueueBySession?: Record<string, ChatQueueItem[]>;
  chatQueuePaused?: boolean;
  chatQueuePausedBySession?: Record<string, boolean>;
  chatQueuePausePendingBySession?: Record<string, boolean>;
  chatQueuePauseTransitionsBySession?: Record<string, Promise<boolean>>;
  chatQueueCreateTransitionsBySession?: Record<string, Set<Promise<boolean>>>;
  chatAttachments?: import("./ui-types.ts").ChatAttachment[];
  chatSubmitGuards?: Map<string, Promise<void>>;
  chatModelSwitchPromises?: Record<string, Promise<boolean>>;
  chatProjectBusy?: boolean;
  chatGoalBusy?: boolean;
  chatComposerPersistTimer?: ReturnType<typeof globalThis.setTimeout> | number | null;
  chatComposerPersistSnapshot?: unknown;
  chatMessages?: unknown[];
  chatMessagesBySession?: unknown;
  chatToolMessages?: unknown[];
  chatSideResult?: ChatSideResult | null;
  chatSideResultTerminalRuns?: Set<string>;
  chatStream?: string | null;
  chatStreamSegments?: unknown[];
  chatStreamStartedAt?: number | null;
  chatTargetRunId?: string | null;
  chatTargetAuditTs?: number | null;
  chatTargetStatus?: string | null;
  chatLocalInputHistoryBySession?: Record<string, Array<{ text: string; ts: number }>>;
  chatInputHistorySessionKey?: string | null;
  chatInputHistoryItems?: string[] | null;
  chatInputHistoryIndex?: number;
  chatDraftBeforeHistory?: string | null;
  sidebarContent?: unknown;
  sidebarError?: string | null;
  chatComposerProvisionalRestore?: {
    sessionKey: string;
    gatewayScope?: string;
    chatMessage: string;
    chatQueue: ChatQueueItem[];
    chatQueuePaused: boolean;
  } | null;
  chatComposerPrincipalRestore?: {
    sessionKey: string;
    chatMessage: string;
    chatQueue: ChatQueueItem[];
    chatQueueBySession: Record<string, ChatQueueItem[]>;
    chatQueuePaused: boolean;
    chatQueuePausedBySession: Record<string, boolean>;
    chatAttachments: import("./ui-types.ts").ChatAttachment[];
    chatLocalInputHistoryBySession: Record<string, Array<{ text: string; ts: number }>>;
    chatInputHistorySessionKey: string | null;
    chatInputHistoryItems: string[] | null;
    chatInputHistoryIndex: number;
    chatDraftBeforeHistory: string | null;
  } | null;
  chatComposerPersistenceSuspended?: boolean;
  chatDetachedSendRecoveries?: ChatDetachedSendRecovery[];
  chatComposerRetryingCurrentGateway?: boolean;
  execApprovalGatewayGeneration?: number;
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalBusy: boolean;
  execApprovalError: string | null;
  updateAvailable: UpdateAvailable | null;
  currentSessionId?: string | null;
  reconnectResumeSessionId?: string | null;
  reconcileWebPushState?: () => Promise<void> | void;
  realtimeTalkOptionsOpen?: boolean;
  fetchRealtimeTalkCatalog?: () => Promise<void>;
  sessionsChangedReloadTimer?: number | ReturnType<typeof globalThis.setTimeout> | null;
  controlUiBootstrapReady?: Promise<void> | null;
  activeGatewayConnection?: {
    gatewayUrl: string;
    token: string;
    password: string;
    scope: string;
  } | null;
};

type GatewayHostWithDeferredSessionMessageReload = GatewayHost & {
  pendingSessionMessageReloadSessionKey?: string | null;
};

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
  mainKey?: string;
  mainSessionKey?: string;
  scope?: string;
};

type GatewayHostWithShutdownMessage = GatewayHost & {
  pendingShutdownMessage?: string | null;
  resumeChatQueueAfterReconnect?: boolean;
};

type GatewayHostWithSideResults = GatewayHost & {
  chatSideResult?: ChatSideResult | null;
  chatSideResultTerminalRuns?: Set<string>;
};

type GatewayHostWithChatWorkRefresh = GatewayHost & {
  chatGoalEventRefreshTimer?: ReturnType<typeof globalThis.setTimeout> | null;
  chatTaskEventRefreshTimer?: ReturnType<typeof globalThis.setTimeout> | null;
};

type GatewayHostWithPcc = GatewayHost &
  PccDashboardState & {
    pccChangedReloadTimer?: ReturnType<typeof globalThis.setTimeout> | null;
  };

const SESSIONS_CHANGED_RELOAD_DEBOUNCE_MS = 5_000;
const DEFERRED_SESSION_MESSAGE_REPLAY_POLL_MS = 250;
const DEFERRED_SESSION_MESSAGE_REPLAY_TIMEOUT_MS = 10_000;
const UPDATE_RESTART_VERIFICATION_POLL_MS = 250;
const UPDATE_RESTART_VERIFICATION_TIMEOUT_MS = 10_000;
const UPDATE_HANDOFF_POLL_MS = 1_000;
const UPDATE_HANDOFF_TIMEOUT_MS = 35 * 60_000;
const UPDATE_HANDOFF_STARTED_REASON = "managed-service-handoff-started";
const UPDATE_RESTART_HEALTH_PENDING_REASON = "restart-health-pending";
const PENDING_UPDATE_HANDOFF_REASONS = new Set([
  UPDATE_HANDOFF_STARTED_REASON,
  UPDATE_RESTART_HEALTH_PENDING_REASON,
]);

function enqueueApprovalRequest(host: GatewayHost, entry: ExecApprovalRequest | null) {
  if (!entry) {
    return;
  }
  enqueueExecApprovalPrompt(host, entry);
}

function removeResolvedApprovalRequest(host: GatewayHost, payload: unknown) {
  const resolved = parseExecApprovalResolved(payload);
  if (resolved) {
    clearResolvedExecApprovalPrompt(host, resolved.id);
  }
}

function isTerminalChatState(
  state: ChatEventPayload["state"] | ReturnType<typeof handleChatEvent> | null | undefined,
): state is "final" | "aborted" | "error" {
  return state === "final" || state === "aborted" || state === "error";
}

function isChatTurnSessionChangedPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as { phase?: unknown; reason?: unknown };
  return (
    record.phase === "start" ||
    record.phase === "message" ||
    record.phase === "end" ||
    record.phase === "error" ||
    record.reason === "send" ||
    record.reason === "steer"
  );
}

function clearSessionsChangedReloadTimer(host: GatewayHost) {
  if (host.sessionsChangedReloadTimer == null) {
    return;
  }
  globalThis.clearTimeout(host.sessionsChangedReloadTimer);
  host.sessionsChangedReloadTimer = null;
}

function shouldRunDeferredSessionsReload(host: GatewayHost): boolean {
  return host.connected && Boolean(host.client) && host.tab !== "chat";
}

function scheduleSessionsChangedReload(host: GatewayHost) {
  clearSessionsChangedReloadTimer(host);
  host.sessionsChangedReloadTimer = globalThis.setTimeout(() => {
    host.sessionsChangedReloadTimer = null;
    if (!shouldRunDeferredSessionsReload(host)) {
      return;
    }
    void loadSessions(host as unknown as SessionsState);
  }, SESSIONS_CHANGED_RELOAD_DEBOUNCE_MS);
}

function scheduleChatWorkRefresh(host: GatewayHost, kind: "goal" | "task") {
  if (host.tab !== "chat" || !host.connected || !host.client) {
    return;
  }
  const workHost = host as GatewayHostWithChatWorkRefresh;
  const key = kind === "goal" ? "chatGoalEventRefreshTimer" : "chatTaskEventRefreshTimer";
  if (workHost[key]) {
    return;
  }
  workHost[key] = globalThis.setTimeout(() => {
    workHost[key] = null;
    if (kind === "goal") {
      void loadChatGoals(host as unknown as ChatState);
      return;
    }
    void loadChatWorkTasks(host as unknown as ChatState);
  }, 75);
}

function workEventMatchesCurrentSession(host: GatewayHost, payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return true;
  }
  const record = payload as {
    ownerKey?: unknown;
    sessionKey?: unknown;
    task?: { ownerKey?: unknown; sessionKey?: unknown };
  };
  const eventKey =
    (typeof record.ownerKey === "string" && record.ownerKey) ||
    (typeof record.sessionKey === "string" && record.sessionKey) ||
    (typeof record.task?.ownerKey === "string" && record.task.ownerKey) ||
    (typeof record.task?.sessionKey === "string" && record.task.sessionKey);
  return !eventKey || areUiSessionKeysEquivalent(eventKey, host.sessionKey);
}

type ConnectGatewayOptions = {
  reason?: "initial" | "seq-gap";
};

type UpdateRestartStatusResponse = {
  sentinel?: {
    kind?: string;
    status?: string;
    stats?: {
      reason?: string | null;
      after?: { version?: string | null } | null;
    } | null;
  } | null;
};

function resolveUpdateVerificationBanner(params: {
  expectedVersion: string;
  actualVersion: string | null;
}): { tone: "danger"; text: string } {
  const actualSuffix = params.actualVersion
    ? ` Expected v${params.expectedVersion}, running v${params.actualVersion}.`
    : "";
  return {
    tone: "danger",
    text: `Update installed but running version did not change — restart may have been blocked.${actualSuffix}`,
  };
}

function resolvePostRestartUpdateBanner(reason: string | null | undefined): {
  tone: "danger";
  text: string;
} {
  const normalizedReason = reason?.trim() || "restart-unhealthy";
  const guidance =
    normalizedReason === "restart-unhealthy"
      ? "The replacement process never became healthy and the previous process stayed up."
      : "Check the gateway logs for the replacement failure.";
  return {
    tone: "danger",
    text: `Update error: ${normalizedReason}. ${guidance}`,
  };
}

function resolvePendingUpdateHandoffTimeoutBanner(): {
  tone: "danger";
  text: string;
} {
  return {
    tone: "danger",
    text: "Update handoff started, but completion was not reported after reconnect. Run `openclaw update status` for the final result.",
  };
}

function isPendingUpdateHandoffSentinel(
  sentinel: UpdateRestartStatusResponse["sentinel"],
): boolean {
  const reason = sentinel?.stats?.reason;
  return (
    sentinel?.kind === "update" &&
    sentinel.status === "skipped" &&
    typeof reason === "string" &&
    PENDING_UPDATE_HANDOFF_REASONS.has(reason)
  );
}

async function verifyPendingUpdateVersion(
  host: GatewayHost,
  client: GatewayBrowserClient,
): Promise<void> {
  const expectedVersion = host.pendingUpdateExpectedVersion?.trim();
  const pendingHandoff = host.pendingUpdateHandoff;
  if (!expectedVersion && !pendingHandoff) {
    return;
  }
  const deadline =
    Date.now() +
    (pendingHandoff ? UPDATE_HANDOFF_TIMEOUT_MS : UPDATE_RESTART_VERIFICATION_TIMEOUT_MS);
  const pollMs = pendingHandoff ? UPDATE_HANDOFF_POLL_MS : UPDATE_RESTART_VERIFICATION_POLL_MS;
  while (host.client === client && host.connected && Date.now() < deadline) {
    let response: UpdateRestartStatusResponse | null;
    try {
      response = await client.request<UpdateRestartStatusResponse>("update.status", {});
    } catch {
      response = null;
    }
    const sentinel = response?.sentinel;
    if (isPendingUpdateHandoffSentinel(sentinel)) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, pollMs);
      });
      continue;
    }
    if (sentinel?.kind === "update" && sentinel.status && sentinel.status !== "ok") {
      host.pendingUpdateExpectedVersion = null;
      host.pendingUpdateHandoff = false;
      host.updateStatusBanner = resolvePostRestartUpdateBanner(sentinel.stats?.reason ?? null);
      return;
    }
    const actualVersion = sentinel?.stats?.after?.version?.trim() || null;
    if (
      sentinel?.kind === "update" &&
      sentinel.status === "ok" &&
      !actualVersion &&
      !expectedVersion
    ) {
      host.pendingUpdateExpectedVersion = null;
      host.pendingUpdateHandoff = false;
      return;
    }
    if (sentinel?.kind === "update" && actualVersion) {
      host.pendingUpdateExpectedVersion = null;
      host.pendingUpdateHandoff = false;
      if (expectedVersion && actualVersion !== expectedVersion) {
        host.updateStatusBanner = resolveUpdateVerificationBanner({
          expectedVersion,
          actualVersion,
        });
      }
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollMs);
    });
  }
  if (host.client !== client || !host.connected) {
    return;
  }
  const currentVersion = host.hello?.server?.version?.trim() || null;
  host.pendingUpdateExpectedVersion = null;
  host.pendingUpdateHandoff = false;
  if (expectedVersion && currentVersion !== expectedVersion) {
    host.updateStatusBanner = resolveUpdateVerificationBanner({
      expectedVersion,
      actualVersion: currentVersion,
    });
  } else if (pendingHandoff) {
    host.updateStatusBanner = resolvePendingUpdateHandoffTimeoutBanner();
  }
}

export function resolveControlUiClientVersion(params: {
  gatewayUrl: string;
  serverVersion: string | null;
  pageUrl?: string;
}): string | undefined {
  const serverVersion = params.serverVersion?.trim();
  if (!serverVersion) {
    return undefined;
  }
  const pageUrl =
    params.pageUrl ?? (typeof window === "undefined" ? undefined : window.location.href);
  if (!pageUrl) {
    return undefined;
  }
  try {
    const page = new URL(pageUrl);
    const gateway = new URL(params.gatewayUrl, page);
    const allowedProtocols = new Set(["ws:", "wss:", "http:", "https:"]);
    if (!allowedProtocols.has(gateway.protocol) || !isSameControlUiVersionEndpoint(page, gateway)) {
      return undefined;
    }
    return serverVersion;
  } catch {
    return undefined;
  }
}

function isSameControlUiVersionEndpoint(page: URL, gateway: URL): boolean {
  if (gateway.host === page.host) {
    return true;
  }
  return (
    isLoopbackHostname(page.hostname) &&
    isLoopbackHostname(gateway.hostname) &&
    resolveUrlEffectivePort(page) === resolveUrlEffectivePort(gateway)
  );
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.")
  );
}

function resolveUrlEffectivePort(url: URL): string {
  if (url.port) {
    return url.port;
  }
  switch (url.protocol) {
    case "http:":
    case "ws:":
      return "80";
    case "https:":
    case "wss:":
      return "443";
    default:
      return "";
  }
}

function normalizeSessionKeyForDefaults(
  value: string | undefined,
  defaults: SessionDefaultsSnapshot,
): string {
  const raw = (value ?? "").trim();
  const mainSessionKey = defaults.mainSessionKey?.trim();
  if (!mainSessionKey) {
    return raw;
  }
  if (!raw) {
    return mainSessionKey;
  }
  const mainKey = defaults.mainKey?.trim() || "main";
  const defaultAgentId = defaults.defaultAgentId?.trim();
  const isAlias =
    raw === "main" ||
    raw === mainKey ||
    (defaultAgentId &&
      (raw === `agent:${defaultAgentId}:main` || raw === `agent:${defaultAgentId}:${mainKey}`));
  return isAlias ? mainSessionKey : raw;
}

function applySessionDefaults(host: GatewayHost, defaults?: SessionDefaultsSnapshot) {
  if (!defaults?.mainSessionKey) {
    return;
  }

  // Detect if user has already selected a specific session (not an alias like "main").
  // If normalization doesn't change the value, it's a user-selected session.
  const normalizedSessionKey = normalizeSessionKeyForDefaults(host.sessionKey, defaults);
  const isUserSelectedSession = normalizedSessionKey === host.sessionKey;

  if (isUserSelectedSession) {
    // User has selected a specific session; preserve their choice
    // Only normalize lastActiveSessionKey, don't override current sessionKey
    const resolvedLastActiveSessionKey = normalizeSessionKeyForDefaults(
      host.settings.lastActiveSessionKey,
      defaults,
    );
    if (resolvedLastActiveSessionKey !== host.settings.lastActiveSessionKey) {
      applySettings(host as unknown as Parameters<typeof applySettings>[0], {
        ...host.settings,
        lastActiveSessionKey: resolvedLastActiveSessionKey,
      });
    }
    return; // Keep user's session selection
  }
  const resolvedSessionKey = normalizeSessionKeyForDefaults(host.sessionKey, defaults);
  const resolvedSettingsSessionKey = normalizeSessionKeyForDefaults(
    host.settings.sessionKey,
    defaults,
  );
  const resolvedLastActiveSessionKey = normalizeSessionKeyForDefaults(
    host.settings.lastActiveSessionKey,
    defaults,
  );
  const nextSessionKey = resolvedSessionKey || resolvedSettingsSessionKey || host.sessionKey;
  const nextSettings = {
    ...host.settings,
    sessionKey: resolvedSettingsSessionKey || nextSessionKey,
    lastActiveSessionKey: resolvedLastActiveSessionKey || nextSessionKey,
  };
  const shouldUpdateSettings =
    nextSettings.sessionKey !== host.settings.sessionKey ||
    nextSettings.lastActiveSessionKey !== host.settings.lastActiveSessionKey;
  if (nextSessionKey !== host.sessionKey) {
    host.sessionKey = nextSessionKey;
  }
  if (shouldUpdateSettings) {
    applySettings(host as unknown as Parameters<typeof applySettings>[0], nextSettings);
  }
}

function resolveMainSessionFallback(host: GatewayHost): string {
  const snapshot = host.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const mainSessionKey = snapshot?.sessionDefaults?.mainSessionKey?.trim();
  if (mainSessionKey) {
    return mainSessionKey;
  }
  const configuredMainKey =
    snapshot?.sessionDefaults?.mainKey?.trim() || host.agentsList?.mainKey?.trim();
  if (configuredMainKey && parseAgentSessionKey(configuredMainKey)) {
    return configuredMainKey;
  }
  const defaultAgentId = host.agentsList?.defaultId?.trim() || "main";
  return buildAgentMainSessionKey({
    agentId: defaultAgentId,
    mainKey: configuredMainKey,
  });
}

function resolveDefaultAgentId(host: GatewayHost): string {
  return resolveUiDefaultAgentId(host);
}

function resolveFreshDefaultAgentId(host: GatewayHost): string | undefined {
  const snapshot = host.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const defaults = snapshot?.sessionDefaults;
  const defaultAgentId = defaults?.defaultAgentId?.trim();
  if (defaultAgentId) {
    return normalizeAgentId(defaultAgentId);
  }
  const parsedMainSession = parseAgentSessionKey(defaults?.mainSessionKey ?? "");
  return parsedMainSession ? normalizeAgentId(parsedMainSession.agentId) : undefined;
}

function resolveSelectedGlobalAgentId(host: GatewayHost): string {
  return resolveUiSelectedGlobalAgentId(host);
}

function resolveSelectedGlobalEventAgentId(
  host: GatewayHost,
  agentId: string | undefined | null,
): string {
  return agentId ? normalizeAgentId(agentId) : resolveDefaultAgentId(host);
}

function globalAgentScopeMatches(
  host: GatewayHost,
  sessionKey: string | undefined | null,
  agentId: string | undefined | null,
): boolean {
  if (!isUiGlobalSessionKey(sessionKey)) {
    return true;
  }
  const selectedAgentId = isUiGlobalSessionKey(host.sessionKey)
    ? resolveSelectedGlobalAgentId(host)
    : resolveUiGlobalAliasAgentId(host, host.sessionKey);
  if (!selectedAgentId) {
    return true;
  }
  return resolveSelectedGlobalEventAgentId(host, agentId) === selectedAgentId;
}

function sessionMessageMatchesHost(
  host: GatewayHost,
  sessionKey: string | undefined,
  agentId: string | undefined | null,
): boolean {
  if (!sessionKey) {
    return false;
  }
  if (areUiSessionKeysEquivalent(sessionKey, host.sessionKey)) {
    return true;
  }
  const hostAliasAgentId = resolveUiGlobalAliasAgentId(host, host.sessionKey);
  return Boolean(
    hostAliasAgentId &&
    isUiGlobalSessionKey(sessionKey) &&
    resolveSelectedGlobalEventAgentId(host, agentId) === hostAliasAgentId,
  );
}

function chatSideResultAgentScopeMatches(host: GatewayHost, sideResult: ChatSideResult): boolean {
  return globalAgentScopeMatches(host, sideResult.sessionKey, sideResult.agentId);
}

function fallbackUnconfiguredSessionSelection(host: GatewayHost): boolean {
  const parsed = parseAgentSessionKey(host.sessionKey);
  if (!parsed) {
    return false;
  }
  const configuredAgentIds = new Set(
    (host.agentsList?.agents ?? []).map((entry) => normalizeAgentId(entry.id)),
  );
  if (configuredAgentIds.size === 0 || configuredAgentIds.has(normalizeAgentId(parsed.agentId))) {
    return false;
  }
  const nextSessionKey = resolveMainSessionFallback(host);
  host.sessionKey = nextSessionKey;
  applySettings(host as unknown as Parameters<typeof applySettings>[0], {
    ...host.settings,
    sessionKey: nextSessionKey,
    lastActiveSessionKey: nextSessionKey,
  });
  syncUrlWithSessionKey(
    host as unknown as Parameters<typeof syncUrlWithSessionKey>[0],
    nextSessionKey,
    true,
  );
  return true;
}

function canRefreshActiveTabBeforeAgents(host: GatewayHost): boolean {
  if (host.tab !== "chat") {
    return false;
  }
  if (isUiGlobalSessionKey(host.sessionKey)) {
    const freshDefaultAgentId = resolveFreshDefaultAgentId(host);
    if (!freshDefaultAgentId) {
      return false;
    }
    const carriedAgentId = host.assistantAgentId
      ? normalizeAgentId(host.assistantAgentId)
      : undefined;
    if (carriedAgentId && carriedAgentId !== freshDefaultAgentId) {
      return false;
    }
    const cachedDefaultAgentId = host.agentsList?.defaultId
      ? normalizeAgentId(host.agentsList.defaultId)
      : undefined;
    return !cachedDefaultAgentId || cachedDefaultAgentId === freshDefaultAgentId;
  }
  const parsed = parseAgentSessionKey(host.sessionKey);
  if (!parsed) {
    return true;
  }
  return normalizeAgentId(parsed.agentId) === resolveFreshDefaultAgentId(host);
}

function normalizeStartupRefreshError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function chatQueueMatches(left: ChatQueueItem[], right: ChatQueueItem[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

type HelloScopedComposerRestore = {
  persistCurrentComposer: boolean;
  preserveCurrentQueuePaused: boolean;
};

function forgetRememberedQueuePause(host: GatewayHost): void {
  if (!host.chatQueuePausedBySession) {
    return;
  }
  const next = { ...host.chatQueuePausedBySession };
  delete next[host.sessionKey];
  host.chatQueuePausedBySession = next;
}

function restoreDetachedSendRecoveries(host: GatewayHost, gatewayScope: string): boolean {
  const recoveries = host.chatDetachedSendRecoveries ?? [];
  const matching = recoveries.filter((recovery) => recovery.gatewayScope === gatewayScope);
  if (matching.length === 0) {
    return false;
  }
  for (const recovery of matching) {
    const currentQueue =
      recovery.sessionKey === host.sessionKey
        ? host.chatQueue
        : (host.chatQueueBySession?.[recovery.sessionKey] ?? []);
    const existingIds = new Set(currentQueue.map((item) => item.id));
    const nextQueue = [
      ...currentQueue,
      ...recovery.queue.filter((item) => !existingIds.has(item.id)),
    ];
    if (recovery.sessionKey === host.sessionKey) {
      host.chatQueue = nextQueue;
    } else {
      host.chatQueueBySession = {
        ...host.chatQueueBySession,
        [recovery.sessionKey]: nextQueue,
      };
    }
  }
  const matchingSet = new Set(matching);
  host.chatDetachedSendRecoveries = recoveries.filter((recovery) => !matchingSet.has(recovery));
  return true;
}

type PreviousGatewayComposerIdentity = {
  settings: { gatewayUrl?: string | null; token?: string | null };
  password: string;
  hello: GatewayHelloOk | null;
};

function clearPendingComposerPersistence(host: GatewayHost): void {
  if (host.chatComposerPersistTimer != null) {
    globalThis.clearTimeout(host.chatComposerPersistTimer);
  }
  host.chatComposerPersistTimer = null;
  host.chatComposerPersistSnapshot = null;
}

function clearGatewayPrincipalState(
  host: GatewayHost,
  previousIdentity: PreviousGatewayComposerIdentity,
): void {
  if (!host.chatComposerPersistenceSuspended) {
    // A same-client hello with a new device token is a token rotation. Park
    // the complete composer before clearing principal projections so a storage
    // quota or serialization failure cannot discard the operator's work.
    host.chatComposerPrincipalRestore = {
      sessionKey: host.sessionKey,
      chatMessage: host.chatMessage,
      chatQueue: [...host.chatQueue],
      chatQueueBySession: Object.fromEntries(
        Object.entries(host.chatQueueBySession ?? {}).map(([sessionKey, queue]) => [
          sessionKey,
          [...queue],
        ]),
      ),
      chatQueuePaused: host.chatQueuePaused === true,
      chatQueuePausedBySession: { ...host.chatQueuePausedBySession },
      chatAttachments: [...(host.chatAttachments ?? [])],
      chatLocalInputHistoryBySession: Object.fromEntries(
        Object.entries(host.chatLocalInputHistoryBySession ?? {}).map(([sessionKey, entries]) => [
          sessionKey,
          entries.map((entry) => ({ ...entry })),
        ]),
      ),
      chatInputHistorySessionKey: host.chatInputHistorySessionKey ?? null,
      chatInputHistoryItems: host.chatInputHistoryItems ? [...host.chatInputHistoryItems] : null,
      chatInputHistoryIndex: host.chatInputHistoryIndex ?? -1,
      chatDraftBeforeHistory: host.chatDraftBeforeHistory ?? null,
    };
    persistChatComposerState(
      {
        ...host,
        settings: previousIdentity.settings,
        password: previousIdentity.password,
        hello: previousIdentity.hello,
        chatComposerPersistenceSuspended: false,
      },
      host.sessionKey,
    );
  }
  clearPendingComposerPersistence(host);
  host.chatAttachments = [];
  host.chatMessage = "";
  host.chatQueue = [];
  host.chatQueueBySession = {};
  host.chatQueuePaused = false;
  host.chatQueuePausedBySession = {};
  host.chatQueuePausePendingBySession = {};
  host.chatQueuePauseTransitionsBySession = {};
  host.chatQueueCreateTransitionsBySession = {};
  host.chatQueueGatewayGeneration = (host.chatQueueGatewayGeneration ?? 0) + 1;
  host.chatSending = false;
  host.chatSendingGatewayGeneration = null;
  host.chatSubmitGuards?.clear();
  host.chatModelSwitchPromises = {};
  host.chatProjectBusy = false;
  host.chatGoalBusy = false;
  host.execApprovalGatewayGeneration = (host.execApprovalGatewayGeneration ?? 0) + 1;
  host.execApprovalQueue = [];
  host.execApprovalBusy = false;
  host.execApprovalError = null;
  host.chatComposerProvisionalRestore = null;
  host.chatComposerRetryingCurrentGateway = false;
  host.chatComposerPersistenceSuspended = true;
  host.chatMessages = [];
  host.chatMessagesBySession = new Map();
  // Clear every projection populated from the old Gateway principal before
  // the new hello snapshot can render it; otherwise session names, model
  // results, or tool side-results can cross a credential boundary.
  host.chatSideResult = null;
  host.chatSideResultTerminalRuns = new Set();
  host.sessionsLoading = false;
  host.sessionsResult = null;
  host.sessionsResultAgentId = null;
  host.sessionsError = null;
  host.chatAgentSessionRowsByAgent = {};
  host.chatSessionPickerOpen = false;
  host.chatSessionPickerSurface = null;
  host.chatSessionPickerQuery = "";
  host.chatSessionPickerAppliedQuery = "";
  host.chatSessionPickerLoading = false;
  host.chatSessionPickerError = null;
  host.chatSessionPickerResult = null;
  host.chatModelOverrides = {};
  host.sessionsExpandedCheckpointKey = null;
  host.sessionsCheckpointItemsByKey = {};
  host.sessionsCheckpointLoadingKey = null;
  host.sessionsCheckpointBusyKey = null;
  host.sessionsCheckpointErrorByKey = {};
  host.chatToolMessages = [];
  host.chatStream = null;
  host.chatStreamSegments = [];
  host.chatStreamStartedAt = null;
  host.chatTargetRunId = null;
  host.chatTargetAuditTs = null;
  host.chatTargetStatus = null;
  host.chatLocalInputHistoryBySession = {};
  host.chatInputHistorySessionKey = null;
  host.chatInputHistoryItems = null;
  host.chatInputHistoryIndex = -1;
  host.chatDraftBeforeHistory = null;
  host.sidebarContent = null;
  host.sidebarError = null;
  reconcileChatRunLifecycle(host as unknown as Parameters<typeof reconcileChatRunLifecycle>[0], {
    clearLocalRun: true,
    clearChatStream: true,
    clearToolStream: true,
    clearSideResultTerminalRuns: true,
    clearRunStatus: true,
  });
}

function prepareHelloScopedComposerRestore(
  host: GatewayHost,
  options: { principalChanged?: boolean } = {},
): HelloScopedComposerRestore {
  if (options.principalChanged) {
    const principalRestore = host.chatComposerPrincipalRestore;
    host.chatComposerPrincipalRestore = null;
    if (principalRestore) {
      host.chatMessage = principalRestore.chatMessage;
      host.chatQueue = [...principalRestore.chatQueue];
      host.chatQueueBySession = Object.fromEntries(
        Object.entries(principalRestore.chatQueueBySession).map(([sessionKey, queue]) => [
          sessionKey,
          [...queue],
        ]),
      );
      host.chatQueuePaused = principalRestore.chatQueuePaused;
      host.chatQueuePausedBySession = { ...principalRestore.chatQueuePausedBySession };
      host.chatAttachments = [...principalRestore.chatAttachments];
      host.chatLocalInputHistoryBySession = Object.fromEntries(
        Object.entries(principalRestore.chatLocalInputHistoryBySession).map(
          ([sessionKey, entries]) => [sessionKey, entries.map((entry) => ({ ...entry }))],
        ),
      );
      host.chatInputHistorySessionKey = principalRestore.chatInputHistorySessionKey;
      host.chatInputHistoryItems = principalRestore.chatInputHistoryItems
        ? [...principalRestore.chatInputHistoryItems]
        : null;
      host.chatInputHistoryIndex = principalRestore.chatInputHistoryIndex;
      host.chatDraftBeforeHistory = principalRestore.chatDraftBeforeHistory;
      return { persistCurrentComposer: true, preserveCurrentQueuePaused: true };
    }
    host.chatComposerProvisionalRestore = null;
    return { persistCurrentComposer: false, preserveCurrentQueuePaused: false };
  }
  const provisional = host.chatComposerProvisionalRestore;
  const resolvedGatewayScope = normalizeGatewayComposerScope(
    host.settings.gatewayUrl,
    host.hello?.auth?.deviceToken || host.settings.token || host.password,
  );
  if (host.chatComposerRetryingCurrentGateway) {
    const credentialMatches = !provisional || provisional.gatewayScope === resolvedGatewayScope;
    host.chatComposerRetryingCurrentGateway = false;
    host.chatComposerProvisionalRestore = null;
    if (!credentialMatches) {
      host.chatMessage = "";
      host.chatQueue = [];
      host.chatQueuePaused = false;
      forgetRememberedQueuePause(host);
      return { persistCurrentComposer: false, preserveCurrentQueuePaused: false };
    }
    return { persistCurrentComposer: true, preserveCurrentQueuePaused: true };
  }
  host.chatComposerProvisionalRestore = null;
  const snapshot = host.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const provisionalSessionKey = provisional
    ? normalizeSessionKeyForDefaults(provisional.sessionKey, snapshot?.sessionDefaults ?? {})
    : "";
  if (!provisional) {
    return { persistCurrentComposer: false, preserveCurrentQueuePaused: true };
  }
  // restoreChatComposerState records the resolved pause value in the session map. Comparing
  // it with the provisional snapshot distinguishes that restore from a real user edit.
  const pauseChangedDuringGatewaySwitch = host.chatQueuePaused !== provisional.chatQueuePaused;
  const preserveCurrentQueuePaused =
    pauseChangedDuringGatewaySwitch && host.chatQueuePaused === true;
  const composerChanged =
    host.chatMessage !== provisional.chatMessage ||
    !chatQueueMatches(host.chatQueue, provisional.chatQueue);
  if (!areUiSessionKeysEquivalent(provisionalSessionKey, host.sessionKey)) {
    // A Gateway switch resets the visible pause latch before hello. Restore the
    // target session's pause unless the user explicitly changed it after the switch.
    return {
      persistCurrentComposer: composerChanged || pauseChangedDuringGatewaySwitch,
      preserveCurrentQueuePaused,
    };
  }
  if (!loadChatComposerSnapshot(host, host.sessionKey)) {
    const preserveUnscopedQueuePaused = pauseChangedDuringGatewaySwitch
      ? preserveCurrentQueuePaused
      : provisional.chatQueuePaused;
    if (!preserveUnscopedQueuePaused) {
      forgetRememberedQueuePause(host);
    }
    return {
      persistCurrentComposer:
        composerChanged ||
        pauseChangedDuringGatewaySwitch ||
        Boolean(provisional.chatMessage.trim()) ||
        provisional.chatQueue.length > 0 ||
        provisional.chatQueuePaused,
      preserveCurrentQueuePaused: preserveUnscopedQueuePaused,
    };
  }
  if (composerChanged || pauseChangedDuringGatewaySwitch) {
    if (!pauseChangedDuringGatewaySwitch) {
      forgetRememberedQueuePause(host);
    }
    return {
      persistCurrentComposer: true,
      preserveCurrentQueuePaused,
    };
  }
  forgetRememberedQueuePause(host);
  // The pre-hello restore used fallback agent scope for offline recovery.
  // Once hello resolves the real scope, clear only an untouched provisional
  // draft so the scoped restore can replace it without clobbering user edits.
  host.chatMessage = "";
  host.chatQueue = [];
  return { persistCurrentComposer: false, preserveCurrentQueuePaused: false };
}

async function loadAgentsThenRefreshActiveTab(host: GatewayHost) {
  let initialRefreshError: Error | undefined;
  const refreshBeforeAgents = canRefreshActiveTabBeforeAgents(host);
  const agentsListBeforeStartup = host.agentsList;
  const initialRefresh = refreshBeforeAgents
    ? refreshActiveTab(host as unknown as Parameters<typeof refreshActiveTab>[0], {
        chatStartup: true,
      }).catch((err: unknown) => {
        initialRefreshError = normalizeStartupRefreshError(err);
      })
    : Promise.resolve();
  let refreshAfterAgents = !refreshBeforeAgents;
  let agentsError: Error | undefined;
  await initialRefresh;
  if (refreshBeforeAgents && host.agentsList && host.agentsList !== agentsListBeforeStartup) {
    if (initialRefreshError) {
      throw initialRefreshError;
    }
    return;
  }
  try {
    const composerBeforeAgentResolution = {
      chatMessage: host.chatMessage,
      chatQueue: [...host.chatQueue],
      chatQueuePaused: host.chatQueuePaused === true,
    };
    await loadAgents(host as unknown as AgentsState);
    const sessionFallbackChanged = fallbackUnconfiguredSessionSelection(host);
    if (sessionFallbackChanged) {
      const composerChangedDuringAgentResolution =
        host.chatMessage !== composerBeforeAgentResolution.chatMessage ||
        !chatQueueMatches(host.chatQueue, composerBeforeAgentResolution.chatQueue) ||
        (host.chatQueuePaused === true) !== composerBeforeAgentResolution.chatQueuePaused;
      if (!composerChangedDuringAgentResolution) {
        // Agent fallback changes the storage scope. Restore the target scope
        // after the new agent catalog is known, or the target draft/queue is
        // invisible until the next reload.
        restoreChatComposerState(
          host as unknown as Parameters<typeof restoreChatComposerState>[0],
          {
            sessionKey: host.sessionKey,
            // The visible composer may contain edits made before or while
            // agent discovery ran. Preserve them while rebinding the scope;
            // an empty composer still loads the resolved target snapshot.
            preserveCurrent: true,
            preserveCurrentQueuePaused: composerBeforeAgentResolution.chatQueuePaused,
          },
        );
      } else {
        // Preserve edits made while the agent catalog was loading, but bind
        // them to the resolved session before the next reconnect.
        persistChatComposerState(
          host as unknown as Parameters<typeof persistChatComposerState>[0],
          host.sessionKey,
        );
      }
    }
    refreshAfterAgents = sessionFallbackChanged || refreshAfterAgents;
  } catch (err: unknown) {
    agentsError = normalizeStartupRefreshError(err);
  }
  if (refreshAfterAgents) {
    await refreshActiveTab(host as unknown as Parameters<typeof refreshActiveTab>[0]);
  } else if (initialRefreshError) {
    throw initialRefreshError;
  }
  if (agentsError) {
    throw agentsError;
  }
}

async function loadAgentsThenRefreshActiveTabForClient(
  host: GatewayHost,
  client: GatewayBrowserClient,
) {
  if (host.client !== client) {
    return;
  }
  await loadAgentsThenRefreshActiveTab(host);
}

function scheduleDeferredStartupWork(callback: () => void) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }
  void Promise.resolve().then(callback);
}

export function connectGateway(host: GatewayHost, options?: ConnectGatewayOptions) {
  const shutdownHost = host as GatewayHostWithShutdownMessage;
  const reconnectReason = options?.reason ?? "initial";
  shutdownHost.pendingShutdownMessage = null;
  shutdownHost.resumeChatQueueAfterReconnect = false;
  clearSessionsChangedReloadTimer(host);
  const connectionAtStart = host.activeGatewayConnection;
  const identityAtStart: PreviousGatewayComposerIdentity = {
    settings: { ...host.settings },
    password: host.password,
    hello: host.hello,
  };
  host.lastError = null;
  host.lastErrorCode = null;
  host.chatError = null;
  host.hello = null;
  host.connected = false;
  if (reconnectReason === "seq-gap") {
    host.execApprovalQueue = pruneExecApprovalQueue(host.execApprovalQueue);
    clearPendingQueueItemsForRun(
      host as unknown as Parameters<typeof clearPendingQueueItemsForRun>[0],
      host.chatRunId ?? undefined,
    );
    shutdownHost.resumeChatQueueAfterReconnect = true;
  } else {
    host.execApprovalQueue = pruneExecApprovalQueue(host.execApprovalQueue);
  }
  host.execApprovalError = null;

  const previousClient = host.client;
  const clientVersion = resolveControlUiClientVersion({
    gatewayUrl: host.settings.gatewayUrl,
    serverVersion: host.serverVersion,
  });
  const client = new GatewayBrowserClient({
    url: host.settings.gatewayUrl,
    token: host.settings.token.trim() ? host.settings.token : undefined,
    password: host.password.trim() ? host.password : undefined,
    clientName: "openclaw-control-ui",
    clientVersion,
    mode: "webchat",
    instanceId: host.clientInstanceId,
    onHello: (hello) => {
      if (host.client !== client) {
        return;
      }
      shutdownHost.pendingShutdownMessage = null;
      host.connected = true;
      host.lastError = null;
      host.lastErrorCode = null;
      host.chatError = null;
      const previousHello = host.hello;
      const effectiveCredential =
        hello.auth?.deviceToken || host.settings.token.trim() || host.password.trim() || "";
      const effectiveGatewayScope = normalizeGatewayComposerScope(
        host.settings.gatewayUrl,
        effectiveCredential,
      );
      const previousGatewayScope =
        host.activeGatewayConnection?.scope ?? connectionAtStart?.scope ?? null;
      const previousIdentity = previousHello
        ? {
            settings: { ...host.settings },
            password: host.password,
            hello: previousHello,
          }
        : identityAtStart;
      const principalChanged =
        previousGatewayScope !== null && previousGatewayScope !== effectiveGatewayScope;
      // Explicit Gateway switches already cleared and parked the old
      // principal's composer state before this client reached hello. Only a
      // same-client credential rotation needs this additional boundary reset.
      const needsPrincipalBoundaryReset =
        principalChanged && !host.chatComposerPersistenceSuspended;
      const sameGatewayEndpoint =
        normalizeGatewayCredentialScope(previousIdentity.settings.gatewayUrl ?? "") ===
        normalizeGatewayCredentialScope(host.settings.gatewayUrl ?? "");
      if (needsPrincipalBoundaryReset) {
        clearGatewayPrincipalState(host, previousIdentity);
      }
      host.hello = hello;
      if (needsPrincipalBoundaryReset && sameGatewayEndpoint) {
        migrateChatComposerState(previousIdentity, {
          settings: { ...host.settings },
          password: host.password,
          hello,
          chatComposerMemoryOwner: host.chatComposerMemoryOwner,
        });
      }
      host.activeGatewayConnection = {
        gatewayUrl: host.settings.gatewayUrl,
        token: host.settings.token,
        password: host.password,
        scope: effectiveGatewayScope,
      };
      if (host.realtimeTalkOptionsOpen) {
        void host.fetchRealtimeTalkCatalog?.();
      }
      applySnapshot(host, hello);
      const composerRestore = prepareHelloScopedComposerRestore(host, {
        principalChanged: needsPrincipalBoundaryReset,
      });
      restoreChatComposerState(host as unknown as Parameters<typeof restoreChatComposerState>[0], {
        preserveCurrent: true,
        preserveCurrentQueuePaused: composerRestore.preserveCurrentQueuePaused,
      });
      host.chatComposerPersistenceSuspended = false;
      if (composerRestore.persistCurrentComposer) {
        persistChatComposerState(
          host as unknown as Parameters<typeof persistChatComposerState>[0],
          host.sessionKey,
        );
      }
      if (restoreDetachedSendRecoveries(host, effectiveGatewayScope)) {
        host.chatError =
          "A detached message was restored after reconnecting to its original Gateway.";
      }
      // Process any pending abort from before the disconnect.
      if (host.pendingAbort) {
        const abort = host.pendingAbort;
        host.pendingAbort = null;
        void host.client
          .request(
            "chat.abort",
            abort.runId
              ? {
                  sessionKey: abort.sessionKey,
                  ...scopedAgentParamsForSession(host, abort.sessionKey),
                  ...(abort.agentId ? { agentId: abort.agentId } : {}),
                  runId: abort.runId,
                }
              : {
                  sessionKey: abort.sessionKey,
                  ...scopedAgentParamsForSession(host, abort.sessionKey),
                  ...(abort.agentId ? { agentId: abort.agentId } : {}),
                },
          )
          .catch((err: unknown) => {
            // Log to console for diagnostics; user sees no feedback for a stale abort
            // since the run likely completed during the disconnect window anyway.
            console.warn("[openclaw] pending abort failed:", err);
          });
      }
      // Reset orphaned chat run state from before disconnect.
      // Any in-flight run's final event was lost during the disconnect window.
      const orphanedRunId = host.chatRunId;
      const hadOrphanedRun =
        Boolean(orphanedRunId) ||
        (host as unknown as { chatStream?: string | null }).chatStream != null;
      reconcileChatRunLifecycle(
        host as unknown as Parameters<typeof reconcileChatRunLifecycle>[0],
        {
          outcome: hadOrphanedRun ? "interrupted" : undefined,
          sessionStatus: "killed",
          runId: orphanedRunId,
          sessionKey: host.sessionKey,
          clearLocalRun: true,
          clearChatStream: true,
          clearToolStream: true,
          clearSideResultTerminalRuns: true,
          clearRunStatus: !hadOrphanedRun,
        },
      );
      const hasReconnectableChatSends = hasReconnectableQueuedChatSends(
        host as unknown as Parameters<typeof hasReconnectableQueuedChatSends>[0],
      );
      if (shutdownHost.resumeChatQueueAfterReconnect || hasReconnectableChatSends) {
        // The interrupted run will never emit its terminal event now that the
        // old client is gone, so resume any deferred commands after hello.
        shutdownHost.resumeChatQueueAfterReconnect = false;
        if (hasReconnectableChatSends) {
          void retryReconnectableQueuedChatSends(
            host as unknown as Parameters<typeof retryReconnectableQueuedChatSends>[0],
          );
        }
        void flushChatQueueForEvent(
          host as unknown as Parameters<typeof flushChatQueueForEvent>[0],
        );
      }
      void subscribeSessions(host as unknown as SessionsState);
      void syncSelectedSessionMessageSubscription(
        host as unknown as SessionsState & { sessionKey: string },
        { force: true },
      );
      void loadAgentsThenRefreshActiveTabForClient(host, client);
      scheduleDeferredStartupWork(() => {
        if (host.client !== client) {
          return;
        }
        void loadControlUiBootstrapConfig(
          host as unknown as Parameters<typeof loadControlUiBootstrapConfig>[0],
          { applyIdentity: false },
        );
        void loadAssistantIdentity(host as unknown as AssistantIdentityState);
        if (host.tab !== "chat") {
          void refreshChatAvatar(host as unknown as Parameters<typeof refreshChatAvatar>[0]);
        }
        void loadHealthState(host as unknown as HealthState);
        // Re-run push reconciliation now that the gateway client is available.
        void host.reconcileWebPushState?.();
        void verifyPendingUpdateVersion(host, client);
      });
    },
    onClose: ({ code, reason, error }) => {
      if (host.client !== client) {
        return;
      }
      host.connected = false;
      let preserveProvisionalComposer = false;
      // A Gateway switch suspends browser persistence only until the new
      // client proves it reached hello. If it closes first, keep new drafts
      // and queue items in the provisional scope instead of writing them under
      // an unresolved target agent and replacing that Gateway's stored queue.
      if (host.chatComposerPersistenceSuspended) {
        const provisional = host.chatComposerProvisionalRestore;
        const composerChanged =
          !provisional ||
          !areUiSessionKeysEquivalent(provisional.sessionKey, host.sessionKey) ||
          host.chatMessage !== provisional.chatMessage ||
          !chatQueueMatches(host.chatQueue, provisional.chatQueue) ||
          host.chatQueuePaused !== provisional.chatQueuePaused;
        if (composerChanged) {
          // The target Gateway's agent scope is unknown until hello. Keep the
          // edits beside the provisional restore so the next hello can merge
          // them after resolving the target scope rather than clobbering a
          // target queue with the old Gateway's empty in-memory queue.
          host.chatComposerProvisionalRestore = {
            sessionKey: provisional?.sessionKey ?? host.sessionKey,
            ...(provisional?.gatewayScope ? { gatewayScope: provisional.gatewayScope } : {}),
            chatMessage: host.chatMessage,
            chatQueue: [...host.chatQueue],
            chatQueuePaused: host.chatQueuePaused === true,
          };
        }
        preserveProvisionalComposer = Boolean(host.chatComposerProvisionalRestore);
      }
      if (!preserveProvisionalComposer) {
        host.chatComposerPersistenceSuspended = false;
      }
      const currentSessionId =
        typeof host.currentSessionId === "string" ? host.currentSessionId.trim() : "";
      if (currentSessionId) {
        host.reconnectResumeSessionId = currentSessionId;
      }
      markQueuedChatSendsWaitingForReconnect(
        host as unknown as Parameters<typeof markQueuedChatSendsWaitingForReconnect>[0],
      );
      clearSessionsChangedReloadTimer(host);
      // Code 1012 = Service Restart (expected during config saves, don't show as error)
      host.lastErrorCode =
        resolveGatewayErrorDetailCode(error) ??
        (typeof error?.code === "string" ? error.code : null);
      if (code !== 1012) {
        if (error?.message) {
          host.lastError =
            host.lastErrorCode &&
            (host.lastErrorCode === ConnectErrorDetailCodes.PAIRING_REQUIRED ||
              isGenericBrowserFetchFailure(error.message))
              ? formatConnectError({
                  message: error.message,
                  details: error.details,
                  code: error.code,
                } as Parameters<typeof formatConnectError>[0])
              : error.message;
          return;
        }
        host.lastError =
          shutdownHost.pendingShutdownMessage ?? `disconnected (${code}): ${reason || "no reason"}`;
      } else {
        host.lastError = shutdownHost.pendingShutdownMessage ?? null;
        host.lastErrorCode = null;
      }
    },
    onEvent: (evt) => {
      if (host.client !== client) {
        return;
      }
      handleGatewayEvent(host, evt);
    },
    onRequestTiming: (timing) => {
      if (host.client !== client) {
        return;
      }
      recordControlUiRpcTiming(host, timing);
    },
    onConnectTiming: (timing) => {
      if (host.client !== client) {
        return;
      }
      recordControlUiConnectTiming(host, timing);
    },
    onGap: ({ expected, received }) => {
      if (host.client !== client) {
        return;
      }
      host.lastError = `event gap detected (expected seq ${expected}, got ${received}); reconnecting`;
      host.lastErrorCode = null;
      connectGateway(host, { reason: "seq-gap" });
    },
  });
  if (previousClient) {
    // Replacing a client invalidates its in-flight ACKs. Reclassify their
    // queue items before the new client can observe or retry them, and clear
    // the old global sending latch so the replacement can make progress.
    markQueuedChatSendsWaitingForReconnect(
      host as unknown as Parameters<typeof markQueuedChatSendsWaitingForReconnect>[0],
    );
    host.chatSending = false;
    host.chatSendingGatewayGeneration = null;
    // Approval requests use the same client-generation boundary. Release the
    // old latch before the replacement client can receive new approvals.
    host.execApprovalBusy = false;
  }
  host.client = client;
  previousClient?.stop();
  client.start();
}

export function handleGatewayEvent(host: GatewayHost, evt: GatewayEventFrame) {
  try {
    handleGatewayEventUnsafe(host, evt);
  } catch (err) {
    console.error("[gateway] handleGatewayEvent error:", evt.event, err);
  }
}

function handleTerminalChatEvent(
  host: GatewayHost,
  payload: ChatEventPayload | undefined,
  state: ReturnType<typeof handleChatEvent>,
  activeRunIdBeforeEvent: string | null,
): boolean {
  if (state !== "final" && state !== "error" && state !== "aborted") {
    return false;
  }
  if (isEventForDifferentActiveRun(payload, activeRunIdBeforeEvent)) {
    return false;
  }
  // Check if tool events were seen before resetting (resetToolStream clears toolStreamOrder).
  const toolHost = host as unknown as Parameters<typeof resetToolStream>[0];
  const hadToolEvents = toolHost.toolStreamOrder.length > 0;
  const flushQueue = () =>
    void flushChatQueueForEvent(host as unknown as Parameters<typeof flushChatQueueForEvent>[0]);
  clearPendingQueueItemsForRun(
    host as unknown as Parameters<typeof clearPendingQueueItemsForRun>[0],
    payload?.runId,
  );
  const runId = payload?.runId;
  const refreshTarget = runId ? host.refreshSessionsAfterChat.get(runId) : undefined;
  if (runId && refreshTarget) {
    host.refreshSessionsAfterChat.delete(runId);
    if (state === "final") {
      void loadSessions(host as unknown as SessionsState, {
        ...createChatSessionsLoadOverrides(host),
        ...scopedAgentListParamsForRefreshTarget(host, refreshTarget),
      });
    }
  }
  // Reload history when tools were used only if the terminal event did not carry
  // a renderable assistant message. Source-reply finals already contain the UI
  // response; an immediate transcript reload replaces the optimistic user bubble
  // with the persisted copy and causes a visible disappear/reappear flicker.
  if (hadToolEvents && state === "final") {
    if (activeRunIdBeforeEvent && !shouldReloadHistoryForFinalEvent(payload)) {
      flushQueue();
      return false;
    }
    const completedRunId = runId ?? null;
    void loadChatHistory(host as unknown as ChatState).finally(() => {
      if (completedRunId && host.chatRunId && host.chatRunId !== completedRunId) {
        return;
      }
      resetToolStream(toolHost);
      flushQueue();
    });
    return true;
  }
  resetToolStream(toolHost);
  flushQueue();
  return false;
}

function isEventForDifferentActiveRun(
  payload: ChatEventPayload | undefined,
  activeRunId: string | null,
): boolean {
  return Boolean(activeRunId && payload && payload.runId !== activeRunId);
}

function handleChatGatewayEvent(host: GatewayHost, payload: ChatEventPayload | undefined) {
  if (payload?.sessionKey) {
    setLastActiveSessionKey(
      host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
      payload.sessionKey,
    );
  }
  const sideResultHost = host as GatewayHostWithSideResults;
  const isTrackedSideResultTerminalEvent =
    isTerminalChatState(payload?.state) &&
    typeof payload?.runId === "string" &&
    sideResultHost.chatSideResultTerminalRuns?.has(payload.runId) === true;
  if (isTrackedSideResultTerminalEvent && payload?.runId) {
    sideResultHost.chatSideResultTerminalRuns?.delete(payload.runId);
    return;
  }
  const activeRunIdBeforeEvent = host.chatRunId;
  const state = handleChatEvent(host as unknown as ChatState, payload);
  recordFirstAssistantChatTiming(
    host as unknown as Parameters<typeof recordFirstAssistantChatTiming>[0],
    payload,
    state,
  );
  const terminalEventIsForDifferentActiveRun = isEventForDifferentActiveRun(
    payload,
    activeRunIdBeforeEvent,
  );
  const historyReloaded = handleTerminalChatEvent(host, payload, state, activeRunIdBeforeEvent);
  const deferredReloadHost = host as GatewayHostWithDeferredSessionMessageReload;
  const deferredSessionKey = deferredReloadHost.pendingSessionMessageReloadSessionKey?.trim();
  const payloadSessionKey = payload?.sessionKey?.trim();
  const finalEventNeedsHistoryReload =
    state === "final" && shouldReloadHistoryForFinalEvent(payload);
  const shouldResolveDeferredSessionMessageReload = Boolean(
    deferredSessionKey &&
    payloadSessionKey &&
    areUiSessionKeysEquivalent(deferredSessionKey, payloadSessionKey) &&
    isTerminalChatState(state) &&
    !terminalEventIsForDifferentActiveRun &&
    areUiSessionKeysEquivalent(payloadSessionKey, host.sessionKey) &&
    !host.chatRunId,
  );
  const shouldReplayDeferredSessionMessageReload =
    shouldResolveDeferredSessionMessageReload &&
    (state !== "final" || finalEventNeedsHistoryReload);
  if (shouldResolveDeferredSessionMessageReload) {
    deferredReloadHost.pendingSessionMessageReloadSessionKey = null;
  }
  if (finalEventNeedsHistoryReload && !historyReloaded && !terminalEventIsForDifferentActiveRun) {
    void loadChatHistory(host as unknown as ChatState);
    return;
  }
  if (shouldReplayDeferredSessionMessageReload && !historyReloaded) {
    void loadChatHistory(host as unknown as ChatState);
  }
}

function flushChatQueueAfterSessionRunReconcile(
  host: GatewayHost,
  result: ReturnType<typeof applySessionsChangedEvent>,
  payload: { clientRunId?: unknown; runId?: unknown; sessionKey?: unknown } | undefined,
  fallbackRunId?: string | null,
): boolean {
  const runId =
    typeof payload?.clientRunId === "string" && payload.clientRunId.trim()
      ? payload.clientRunId
      : typeof payload?.runId === "string" && payload.runId.trim()
        ? payload.runId
        : (fallbackRunId ?? undefined);
  clearPendingQueueItemsForRun(
    host as unknown as Parameters<typeof clearPendingQueueItemsForRun>[0],
    runId,
  );
  const flushQueue = () =>
    void flushChatQueueForEvent(host as unknown as Parameters<typeof flushChatQueueForEvent>[0]);
  const publishRunStatus = () => {
    if (!result.applied || !result.clearedChatRunStatus || host.chatRunId) {
      return;
    }
    reconcileChatRunLifecycle(host as unknown as Parameters<typeof reconcileChatRunLifecycle>[0], {
      outcome: result.clearedChatRunStatus.phase,
      runId: result.clearedChatRunStatus.runId,
      sessionKey: result.clearedChatRunStatus.sessionKey,
      clearIndicators: false,
    });
  };
  const deferredReloadHost = host as GatewayHostWithDeferredSessionMessageReload;
  const pendingSessionKey = deferredReloadHost.pendingSessionMessageReloadSessionKey?.trim();
  const eventSessionKey = typeof payload?.sessionKey === "string" ? payload.sessionKey.trim() : "";
  if (
    pendingSessionKey &&
    areUiSessionKeysEquivalent(pendingSessionKey, host.sessionKey) &&
    (!eventSessionKey || areUiSessionKeysEquivalent(eventSessionKey, pendingSessionKey))
  ) {
    deferredReloadHost.pendingSessionMessageReloadSessionKey = null;
    const reloadSessionKey = pendingSessionKey;
    void Promise.resolve(loadChatHistory(host as unknown as ChatState)).finally(() => {
      if (areUiSessionKeysEquivalent(host.sessionKey, reloadSessionKey)) {
        publishRunStatus();
        flushQueue();
      }
    });
    return true;
  }
  publishRunStatus();
  flushQueue();
  return false;
}

function handleSessionMessageGatewayEvent(
  host: GatewayHost,
  payload: { sessionKey?: string; agentId?: string; runId?: unknown } | undefined,
) {
  const deferredReloadHost = host as GatewayHostWithDeferredSessionMessageReload;
  const sessionKey = payload?.sessionKey?.trim();
  if (!globalAgentScopeMatches(host, sessionKey, payload?.agentId)) {
    return;
  }
  const sessionMatchesHost = sessionMessageMatchesHost(host, sessionKey, payload?.agentId);
  const runIdBeforeApply = host.chatRunId;
  const result = applySessionsChangedEvent(host as unknown as SessionsState, payload);
  if (result.applied && result.clearedChatRun) {
    if (sessionMatchesHost) {
      deferredReloadHost.pendingSessionMessageReloadSessionKey = sessionKey;
    }
    if (flushChatQueueAfterSessionRunReconcile(host, result, payload, runIdBeforeApply)) {
      return;
    }
  }
  if (!sessionKey || !sessionMatchesHost) {
    return;
  }
  // Skip history reload while a chat run is active. The chat event handler
  // manages streaming state and appends the final assistant message. Reloading
  // history mid-run races with the optimistic user-message update and resets
  // chatStream, which delays the user message card from appearing until the
  // first LLM delta arrives.
  if (host.chatRunId) {
    // Gateway confirms the run is still active (plugin hook window, etc.).
    // Skip reload — the pending chat terminal owns history reconciliation.
    if ((payload as Record<string, unknown> | null)?.hasActiveRun === true) {
      deferredReloadHost.pendingSessionMessageReloadSessionKey = sessionKey;
      return;
    }
    deferredReloadHost.pendingSessionMessageReloadSessionKey = sessionKey;
    const refreshStartedAt = Date.now();
    const runIdBeforeRefresh = host.chatRunId;
    void loadSessions(host as unknown as SessionsState, {
      ...createChatSessionsLoadOverrides(host),
      ...scopedAgentListParamsForSession(host, host.sessionKey),
      publishChatRunStatus: false,
    }).finally(() =>
      replayDeferredSessionMessageReloadAfterSessionsRefresh(
        host,
        sessionKey,
        payload?.agentId,
        refreshStartedAt,
        runIdBeforeRefresh,
      ),
    );
    return;
  }
  deferredReloadHost.pendingSessionMessageReloadSessionKey = null;
  void loadChatHistory(host as unknown as ChatState);
}

function replayDeferredSessionMessageReloadAfterSessionsRefresh(
  host: GatewayHost,
  sessionKey: string,
  agentId: string | undefined | null,
  startedAt: number,
  completedRunId?: string | null,
) {
  const deferredReloadHost = host as GatewayHostWithDeferredSessionMessageReload;
  if (
    !areUiSessionKeysEquivalent(
      deferredReloadHost.pendingSessionMessageReloadSessionKey?.trim() ?? "",
      sessionKey,
    ) ||
    !sessionMessageMatchesHost(host, sessionKey, agentId)
  ) {
    return;
  }
  if (host.chatRunId) {
    if (
      host.sessionsLoading === true &&
      Date.now() - startedAt < DEFERRED_SESSION_MESSAGE_REPLAY_TIMEOUT_MS
    ) {
      globalThis.setTimeout(
        () =>
          replayDeferredSessionMessageReloadAfterSessionsRefresh(
            host,
            sessionKey,
            agentId,
            startedAt,
            completedRunId,
          ),
        DEFERRED_SESSION_MESSAGE_REPLAY_POLL_MS,
      );
    }
    return;
  }
  const row = (host as unknown as SessionsState).sessionsResult?.sessions.find((session) =>
    areUiSessionKeysEquivalent(session.key, sessionKey),
  );
  flushChatQueueAfterSessionRunReconcile(
    host,
    {
      applied: true,
      change: "updated",
      clearedChatRun: true,
      ...(row
        ? {
            clearedChatRunStatus: {
              phase: row.status === "done" ? "done" : "interrupted",
              runId: completedRunId ?? null,
              sessionKey,
            },
          }
        : {}),
    },
    { sessionKey },
    completedRunId,
  );
}

function handleGatewayEventUnsafe(host: GatewayHost, evt: GatewayEventFrame) {
  host.eventLogBuffer = [
    { ts: Date.now(), event: evt.event, payload: evt.payload },
    ...host.eventLogBuffer,
  ].slice(0, 250);
  if (host.tab === "debug" || host.tab === "overview") {
    host.eventLog = host.eventLogBuffer;
  }

  if (evt.event === "pcc.changed") {
    const pccHost = host as GatewayHostWithPcc;
    if (pccHost.tab !== "pcc" || pccHost.pccChangedReloadTimer) {
      return;
    }
    pccHost.pccChangedReloadTimer = globalThis.setTimeout(() => {
      pccHost.pccChangedReloadTimer = null;
      void loadPccDashboard(pccHost);
    }, 50);
    return;
  }

  if (evt.event === "pcc.presence") {
    const payload = evt.payload as { presence?: unknown } | undefined;
    if (Array.isArray(payload?.presence)) {
      (host as GatewayHostWithPcc).pccPresence =
        payload.presence as GatewayHostWithPcc["pccPresence"];
    }
    return;
  }

  if (evt.event === "agent" || evt.event === "session.tool") {
    if (host.onboarding) {
      return;
    }
    handleAgentEvent(
      host as unknown as Parameters<typeof handleAgentEvent>[0],
      evt.payload as AgentEventPayload | undefined,
    );
    return;
  }

  if (evt.event === "chat") {
    handleChatGatewayEvent(host, evt.payload as ChatEventPayload | undefined);
    return;
  }

  if (evt.event === "chat.send_timing") {
    recordChatSendServerTiming(
      host as unknown as Parameters<typeof recordChatSendServerTiming>[0],
      evt.payload,
    );
    return;
  }

  if (evt.event === "chat.side_result") {
    const sideResult = parseChatSideResult(evt.payload);
    if (
      !sideResult ||
      !sessionMessageMatchesHost(host, sideResult.sessionKey, sideResult.agentId) ||
      !chatSideResultAgentScopeMatches(host, sideResult)
    ) {
      return;
    }
    const sideResultHost = host as GatewayHostWithSideResults;
    sideResultHost.chatSideResult = sideResult;
    sideResultHost.chatSideResultTerminalRuns?.add(sideResult.runId);
    return;
  }

  if (evt.event === "taskFlow") {
    if (workEventMatchesCurrentSession(host, evt.payload)) {
      scheduleChatWorkRefresh(host, "goal");
      void loadServerChatTurns(
        host as unknown as Parameters<typeof loadServerChatTurns>[0],
        host.sessionKey,
      );
    }
    return;
  }

  if (evt.event === "task") {
    if (workEventMatchesCurrentSession(host, evt.payload)) {
      scheduleChatWorkRefresh(host, "task");
    }
    return;
  }

  if (evt.event === "session.message") {
    handleSessionMessageGatewayEvent(
      host,
      evt.payload as { sessionKey?: string; agentId?: string } | undefined,
    );
    return;
  }

  if (evt.event === "session.operation") {
    handleSessionOperationEvent(
      host as unknown as Parameters<typeof handleSessionOperationEvent>[0],
      evt.payload as SessionOperationEventPayload | undefined,
    );
    return;
  }

  if (evt.event === "presence") {
    const payload = evt.payload as { presence?: PresenceEntry[] } | undefined;
    if (payload?.presence && Array.isArray(payload.presence)) {
      host.presenceEntries = payload.presence;
      host.presenceError = null;
      host.presenceStatus = null;
    }
    return;
  }

  if (evt.event === "shutdown") {
    const payload = evt.payload as { reason?: unknown; restartExpectedMs?: unknown } | undefined;
    const reason =
      payload && typeof payload.reason === "string" && payload.reason.trim()
        ? payload.reason.trim()
        : "gateway stopping";
    const shutdownMessage =
      typeof payload?.restartExpectedMs === "number"
        ? `Restarting: ${reason}`
        : `Disconnected: ${reason}`;
    (host as GatewayHostWithShutdownMessage).pendingShutdownMessage = shutdownMessage;
    host.lastError = shutdownMessage;
    host.lastErrorCode = null;
    return;
  }

  if (evt.event === "sessions.changed") {
    const runIdBeforeApply = host.chatRunId;
    const result = applySessionsChangedEvent(host as unknown as SessionsState, evt.payload);
    if (result.applied) {
      if (result.clearedChatRun) {
        flushChatQueueAfterSessionRunReconcile(
          host,
          result,
          evt.payload as
            | { clientRunId?: unknown; runId?: unknown; sessionKey?: unknown }
            | undefined,
          runIdBeforeApply,
        );
      }
      return;
    }
    if (isChatTurnSessionChangedPayload(evt.payload)) {
      return;
    }
    scheduleSessionsChangedReload(host);
    return;
  }

  if (evt.event === "cron" && host.tab === "cron") {
    void loadCron(host as unknown as Parameters<typeof loadCron>[0]);
  }

  if (evt.event === "device.pair.requested" || evt.event === "device.pair.resolved") {
    void loadDevices(host as unknown as DevicesState, { quiet: true });
  }

  if (evt.event === "exec.approval.requested") {
    enqueueApprovalRequest(host, parseExecApprovalRequested(evt.payload));
    return;
  }

  if (evt.event === "exec.approval.resolved") {
    removeResolvedApprovalRequest(host, evt.payload);
    return;
  }

  if (evt.event === "plugin.approval.requested") {
    enqueueApprovalRequest(host, parsePluginApprovalRequested(evt.payload));
    return;
  }

  if (evt.event === "plugin.approval.resolved") {
    removeResolvedApprovalRequest(host, evt.payload);
    return;
  }

  if (evt.event === GATEWAY_EVENT_UPDATE_AVAILABLE) {
    const payload = evt.payload as GatewayUpdateAvailableEventPayload | undefined;
    host.updateAvailable = payload?.updateAvailable ?? null;
  }
}

export function applySnapshot(host: GatewayHost, hello: GatewayHelloOk) {
  const snapshot = hello.snapshot as
    | {
        presence?: PresenceEntry[];
        health?: HealthSummary;
        sessionDefaults?: SessionDefaultsSnapshot;
        updateAvailable?: UpdateAvailable;
      }
    | undefined;
  if (snapshot?.presence && Array.isArray(snapshot.presence)) {
    host.presenceEntries = snapshot.presence;
  }
  if (snapshot?.health) {
    host.debugHealth = snapshot.health;
    host.healthResult = snapshot.health;
  }
  if (snapshot?.sessionDefaults) {
    applySessionDefaults(host, snapshot.sessionDefaults);
  }
  host.updateAvailable = snapshot?.updateAvailable ?? null;
}
