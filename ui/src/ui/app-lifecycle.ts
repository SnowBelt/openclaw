import { normalizeGatewayComposerScope } from "../app/gateway-scope.ts";
// Control UI module implements app lifecycle behavior.
import { connectGateway } from "./app-gateway.ts";
import {
  startLogsPolling,
  startNodesPolling,
  stopLogsPolling,
  stopNodesPolling,
  startDebugPolling,
  stopDebugPolling,
  startKalshiDashboardPolling,
  shouldPollKalshiDashboard,
  stopKalshiDashboardPolling,
  startDashboardPolling,
  stopDashboardPolling,
} from "./app-polling.ts";
import {
  observeTopbar,
  scheduleActivityScroll,
  scheduleChatScroll,
  scheduleLogsScroll,
} from "./app-scroll.ts";
import {
  applySettingsFromUrl,
  detachThemeListener,
  inferBasePath,
  syncTabWithLocation,
  syncThemeWithSettings,
} from "./app-settings.ts";
import { persistChatComposerState, restoreChatComposerState } from "./chat/composer-persistence.ts";
import {
  connectControlDirectorLayoutHealth,
  disconnectControlDirectorLayoutHealth,
  scheduleControlDirectorLayoutHealthCheck,
} from "./chat/layout-health.ts";
import { startControlUiResponsivenessObserver } from "./control-ui-performance.ts";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.ts";
import { stopWorkboardLifecycleRefresh, stopWorkboardPolling } from "./controllers/workboard.ts";
import type { Tab } from "./navigation.ts";
import type { ChatQueueItem } from "./ui-types.ts";

const CHAT_COMPOSER_DRAFT_PERSIST_DELAY_MS = 200;

type PendingChatComposerPersistSnapshot = {
  sessionKey: string;
  chatMessage: string;
  chatQueue: ChatQueueItem[];
  chatQueuePaused: boolean;
};

type LifecycleHost = {
  basePath: string;
  client?: { stop: () => void } | null;
  connectGeneration: number;
  connected?: boolean;
  tab: Tab;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAvatarSource?: string | null;
  assistantAvatarStatus?: "none" | "local" | "remote" | "data" | null;
  assistantAvatarReason?: string | null;
  assistantAgentId: string | null;
  serverVersion: string | null;
  localMediaPreviewRoots: string[];
  embedSandboxMode: "strict" | "scripts" | "trusted";
  allowExternalEmbedUrls: boolean;
  chatHasAutoScrolled: boolean;
  chatManualRefreshInFlight: boolean;
  settings?: { gatewayUrl?: string | null; token?: string | null };
  password?: string | null;
  sessionKey: string;
  chatMessage: string;
  chatQueue: ChatQueueItem[];
  chatQueuePaused: boolean;
  chatComposerProvisionalRestore?: {
    sessionKey: string;
    gatewayScope?: string;
    chatMessage: string;
    chatQueue: ChatQueueItem[];
    chatQueuePaused: boolean;
  } | null;
  chatComposerPersistenceSuspended?: boolean;
  chatComposerPersistTimer?: ReturnType<typeof globalThis.setTimeout> | number | null;
  chatComposerPersistSnapshot?: PendingChatComposerPersistSnapshot | null;
  pendingGatewayUrl?: string | null;
  realtimeTalkSession?: { stop: () => void } | null;
  realtimeTalkActive?: boolean;
  realtimeTalkStatus?: string;
  realtimeTalkDetail?: string | null;
  realtimeTalkTranscript?: string | null;
  realtimeTalkConversation?: unknown[];
  resetRealtimeTalkConversation?: () => void;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatStream: string | null;
  logsAutoFollow: boolean;
  logsAtBottom: boolean;
  logsEntries: unknown[];
  activityEntries: unknown[];
  activityAutoFollow: boolean;
  activityAtBottom: boolean;
  chatScrollFrame?: number | null;
  chatScrollTimeout?: number | null;
  logsScrollFrame?: number | null;
  activityScrollFrame?: number | null;
  sessionsChangedReloadTimer?: number | ReturnType<typeof globalThis.setTimeout> | null;
  agentsPanel?: string;
  kalshiDashboardPollInterval?: number | null;
  dashboardPollInterval?: number | null;
  dashboardPollInFlight?: boolean;
  refreshActiveDashboardTab?: () => Promise<void> | void;
  controlUiTabPaintSeq?: number;
  controlUiResponsivenessObserver?: { disconnect: () => void } | null;
  controlUiBootstrapReady?: Promise<void> | null;
  popStateHandler: () => void;
  topbarObserver: ResizeObserver | null;
};

export function handleConnected(host: LifecycleHost) {
  const connectGeneration = ++host.connectGeneration;
  host.basePath = inferBasePath();
  applySettingsFromUrl(host as unknown as Parameters<typeof applySettingsFromUrl>[0]);
  host.controlUiBootstrapReady = loadControlUiBootstrapConfig(
    host as unknown as Parameters<typeof loadControlUiBootstrapConfig>[0],
    { applyIdentity: false },
  );
  syncTabWithLocation(host as unknown as Parameters<typeof syncTabWithLocation>[0], true);
  const hasPendingGatewaySwitch =
    typeof host.pendingGatewayUrl === "string" && host.pendingGatewayUrl.trim();
  const hasProvisionalComposerRestore = Boolean(host.chatComposerProvisionalRestore);
  if (
    !hasPendingGatewaySwitch &&
    !hasProvisionalComposerRestore &&
    !host.chatComposerPersistenceSuspended &&
    restoreChatComposerState(host, { preserveCurrent: true })
  ) {
    host.chatComposerProvisionalRestore = {
      sessionKey: host.sessionKey,
      gatewayScope: normalizeGatewayComposerScope(
        host.settings?.gatewayUrl,
        host.settings?.token || host.password || "",
      ),
      chatMessage: host.chatMessage,
      chatQueue: [...host.chatQueue],
      chatQueuePaused: host.chatQueuePaused,
    };
  } else if (!hasProvisionalComposerRestore) {
    host.chatComposerProvisionalRestore = null;
  }
  syncThemeWithSettings(host as unknown as Parameters<typeof syncThemeWithSettings>[0]);
  window.addEventListener("popstate", host.popStateHandler);
  if (host.connectGeneration === connectGeneration) {
    connectGateway(host as unknown as Parameters<typeof connectGateway>[0]);
  }
  if (host.tab === "nodes") {
    startNodesPolling(host as unknown as Parameters<typeof startNodesPolling>[0]);
  }
  if (host.tab === "logs") {
    startLogsPolling(host as unknown as Parameters<typeof startLogsPolling>[0]);
  }
  if (host.tab === "debug") {
    startDebugPolling(host as unknown as Parameters<typeof startDebugPolling>[0]);
  }
  if (shouldPollKalshiDashboard(host)) {
    startKalshiDashboardPolling(
      host as unknown as Parameters<typeof startKalshiDashboardPolling>[0],
    );
  }
  startDashboardPolling(host as unknown as Parameters<typeof startDashboardPolling>[0]);
  host.controlUiResponsivenessObserver ??= startControlUiResponsivenessObserver(
    host as unknown as Parameters<typeof startControlUiResponsivenessObserver>[0],
  );
  connectControlDirectorLayoutHealth(
    host as unknown as Parameters<typeof connectControlDirectorLayoutHealth>[0],
  );
}

export function handleFirstUpdated(host: LifecycleHost) {
  observeTopbar(host as unknown as Parameters<typeof observeTopbar>[0]);
  scheduleControlDirectorLayoutHealthCheck(
    host as unknown as Parameters<typeof scheduleControlDirectorLayoutHealthCheck>[0],
  );
}

function cancelHostAnimationFrame(frame: number | null | undefined) {
  if (frame != null && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(frame);
  }
}

function clearHostTimeout(timeout: number | null | undefined) {
  if (timeout != null && typeof window.clearTimeout === "function") {
    window.clearTimeout(timeout);
  }
}

function clearHostGlobalTimeout(
  timeout: number | ReturnType<typeof globalThis.setTimeout> | null | undefined,
) {
  if (timeout != null) {
    globalThis.clearTimeout(timeout);
  }
}

function clearPendingChatComposerPersistence(host: LifecycleHost) {
  clearHostGlobalTimeout(host.chatComposerPersistTimer);
  host.chatComposerPersistTimer = null;
  host.chatComposerPersistSnapshot = null;
}

function flushPendingChatComposerPersistence(host: LifecycleHost) {
  if (host.chatComposerPersistenceSuspended) {
    clearPendingChatComposerPersistence(host);
    return;
  }
  const snapshot = host.chatComposerPersistSnapshot;
  if (host.chatComposerPersistTimer == null || !snapshot) {
    clearPendingChatComposerPersistence(host);
    return;
  }
  clearPendingChatComposerPersistence(host);
  persistChatComposerState(
    {
      ...host,
      sessionKey: snapshot.sessionKey,
      chatMessage: snapshot.chatMessage,
      chatQueue: snapshot.chatQueue,
      chatQueuePaused: snapshot.chatQueuePaused,
    },
    snapshot.sessionKey,
  );
}

function scheduleChatComposerDraftPersistence(host: LifecycleHost) {
  clearPendingChatComposerPersistence(host);
  host.chatComposerPersistSnapshot = {
    sessionKey: host.sessionKey,
    chatMessage: host.chatMessage,
    chatQueue: [...host.chatQueue],
    chatQueuePaused: host.chatQueuePaused,
  };
  host.chatComposerPersistTimer = globalThis.setTimeout(() => {
    flushPendingChatComposerPersistence(host);
  }, CHAT_COMPOSER_DRAFT_PERSIST_DELAY_MS);
}

export function handleDisconnected(host: LifecycleHost) {
  host.connectGeneration += 1;
  host.controlUiTabPaintSeq = (host.controlUiTabPaintSeq ?? 0) + 1;
  flushPendingChatComposerPersistence(host);
  window.removeEventListener("popstate", host.popStateHandler);
  stopNodesPolling(host as unknown as Parameters<typeof stopNodesPolling>[0]);
  stopLogsPolling(host as unknown as Parameters<typeof stopLogsPolling>[0]);
  stopDebugPolling(host as unknown as Parameters<typeof stopDebugPolling>[0]);
  stopKalshiDashboardPolling(host as unknown as Parameters<typeof stopKalshiDashboardPolling>[0]);
  stopDashboardPolling(host as unknown as Parameters<typeof stopDashboardPolling>[0]);
  stopWorkboardPolling(host);
  stopWorkboardLifecycleRefresh(host);
  cancelHostAnimationFrame(host.chatScrollFrame);
  host.chatScrollFrame = null;
  cancelHostAnimationFrame(host.logsScrollFrame);
  host.logsScrollFrame = null;
  cancelHostAnimationFrame(host.activityScrollFrame);
  host.activityScrollFrame = null;
  clearHostTimeout(host.chatScrollTimeout);
  host.chatScrollTimeout = null;
  clearHostGlobalTimeout(host.sessionsChangedReloadTimer);
  host.sessionsChangedReloadTimer = null;
  host.realtimeTalkSession?.stop();
  host.realtimeTalkSession = null;
  host.realtimeTalkActive = false;
  host.realtimeTalkStatus = "idle";
  host.realtimeTalkDetail = null;
  host.realtimeTalkTranscript = null;
  host.resetRealtimeTalkConversation?.();
  host.client?.stop();
  host.client = null;
  host.connected = false;
  detachThemeListener(host as unknown as Parameters<typeof detachThemeListener>[0]);
  host.topbarObserver?.disconnect();
  host.topbarObserver = null;
  host.controlUiResponsivenessObserver?.disconnect();
  host.controlUiResponsivenessObserver = null;
  disconnectControlDirectorLayoutHealth(
    host as unknown as Parameters<typeof disconnectControlDirectorLayoutHealth>[0],
  );
}

export function handleUpdated(host: LifecycleHost, changed: Map<PropertyKey, unknown>) {
  if (host.chatComposerPersistenceSuspended) {
    clearPendingChatComposerPersistence(host);
  } else if (changed.has("chatQueue") || changed.has("chatQueuePaused")) {
    clearPendingChatComposerPersistence(host);
    persistChatComposerState(host);
  } else if (changed.has("sessionKey")) {
    flushPendingChatComposerPersistence(host);
    if (changed.has("chatMessage")) {
      persistChatComposerState(host);
    }
  } else if (changed.has("chatMessage")) {
    scheduleChatComposerDraftPersistence(host);
  }
  if (host.tab === "chat") {
    scheduleControlDirectorLayoutHealthCheck(
      host as unknown as Parameters<typeof scheduleControlDirectorLayoutHealthCheck>[0],
    );
  }
  if (host.tab === "chat" && host.chatManualRefreshInFlight) {
    return;
  }
  if (
    host.tab === "chat" &&
    (changed.has("chatMessages") ||
      changed.has("chatToolMessages") ||
      changed.has("chatStream") ||
      changed.has("chatLoading") ||
      changed.has("realtimeTalkConversation") ||
      changed.has("tab"))
  ) {
    const forcedByTab = changed.has("tab");
    const forcedByLoad =
      changed.has("chatLoading") && changed.get("chatLoading") === true && !host.chatLoading;
    // Detect streaming start: chatStream changed from null/undefined to a string value
    const previousStream = changed.get("chatStream") as string | null | undefined;
    const streamJustStarted =
      changed.has("chatStream") &&
      (previousStream === null || previousStream === undefined) &&
      typeof host.chatStream === "string";
    scheduleChatScroll(
      host as unknown as Parameters<typeof scheduleChatScroll>[0],
      forcedByTab || forcedByLoad || streamJustStarted || !host.chatHasAutoScrolled,
    );
  }
  if (
    host.tab === "logs" &&
    (changed.has("logsEntries") || changed.has("logsAutoFollow") || changed.has("tab"))
  ) {
    if (host.logsAutoFollow && host.logsAtBottom) {
      scheduleLogsScroll(
        host as unknown as Parameters<typeof scheduleLogsScroll>[0],
        changed.has("tab") || changed.has("logsAutoFollow"),
      );
    }
  }
  if (
    host.tab === "activity" &&
    (changed.has("activityEntries") || changed.has("activityAutoFollow") || changed.has("tab"))
  ) {
    if (host.activityAutoFollow && host.activityAtBottom) {
      scheduleActivityScroll(
        host as unknown as Parameters<typeof scheduleActivityScroll>[0],
        changed.has("tab") || changed.has("activityAutoFollow"),
      );
    }
  }
}
