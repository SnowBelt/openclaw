/**
 * In-memory registry that associates browser tabs with OpenClaw sessions for
 * cleanup on session end or idle sweeps.
 */
import { createHash } from "node:crypto";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalLowercaseString,
} from "openclaw/plugin-sdk/string-coerce-runtime";
import type {
  BrowserStewardCredentialExposureKind,
  BrowserStewardCredentialExposureReasonCode,
  BrowserStewardRuntimeDecision,
  BrowserStewardSessionBoundary,
} from "./browser-steward-runtime-guard.js";
import { isBrowserStewardSession } from "./browser-steward-runtime-guard.js";
import { browserCloseTab } from "./client.js";

type BrowserStewardTrackedGuard = {
  boundaryDecision: "allow";
  requestedAction: string;
  affectedBrowserProfile: string;
  affectedSession: string;
  sessionBoundary: BrowserStewardSessionBoundary;
  credentialExposureKind: BrowserStewardCredentialExposureKind;
  credentialExposureReasonCode: BrowserStewardCredentialExposureReasonCode;
  approvalSource: "runtime";
  telemetryEvent: string;
};

type TrackedSessionBrowserTab = {
  targetId: string;
  baseUrl?: string;
  /** Redacted audit identity. The executable identity lives on a private symbol. */
  profile?: string;
  browserStewardRuntimeGuard?: BrowserStewardTrackedGuard;
  trackedAt: number;
  lastUsedAt: number;
};

type SessionBrowserTabIdentityParams = {
  sessionKey?: string;
  agentId?: string;
  targetId?: string;
  baseUrl?: string;
  profile?: string;
};

type TrackedSessionBrowserTabIdentity = {
  sessionStorageKey: string;
  redactedSessionKey: string;
  targetId: string;
  baseUrl?: string;
  profile?: string;
  executionProfile?: string;
};

type TrackedSessionBrowserTabs = {
  redactedSessionKey: string;
  tabs: Map<string, TrackedSessionBrowserTab>;
};

const TRACKED_TABS_BY_SESSION_KEY = Symbol.for("openclaw.browser.sessionTabRegistry.v1");
// Tool and cleanup paths can load this module through separate registries.
// A global symbol preserves the private execution identity across those
// instances while JSON serialization still omits it from tracked metadata.
const TRACKED_TAB_EXECUTION_PROFILE = Symbol.for(
  "openclaw.browser.sessionTabRegistry.executionProfile.v1",
);
type TrackedSessionBrowserTabWithExecutionProfile = TrackedSessionBrowserTab & {
  [TRACKED_TAB_EXECUTION_PROFILE]?: string;
};
type BrowserSessionTabRegistryGlobal = typeof globalThis & {
  [TRACKED_TABS_BY_SESSION_KEY]?: Map<string, TrackedSessionBrowserTabs>;
};

function getTrackedTabsBySession(): Map<string, TrackedSessionBrowserTabs> {
  const globalState = globalThis as BrowserSessionTabRegistryGlobal;
  // Plugin discovery can load the Browser tool and cleanup timer through separate
  // module registries. Process-global state keeps both paths on one cleanup registry.
  globalState[TRACKED_TABS_BY_SESSION_KEY] ??= new Map<string, TrackedSessionBrowserTabs>();
  return globalState[TRACKED_TABS_BY_SESSION_KEY];
}

const trackedTabsBySession = getTrackedTabsBySession();
const SAFE_SESSION_OWNER_ID_RE = /^[a-z0-9][a-z0-9 _-]{0,63}$/;

function normalizeSessionKey(raw: string): string {
  return normalizeOptionalLowercaseString(raw) ?? "";
}

function normalizeAgentId(raw: string | undefined): string | undefined {
  const normalized = normalizeOptionalLowercaseString(raw);
  return normalized;
}

function normalizeRedactedSessionOwnerId(raw: string): string | undefined {
  const normalized = normalizeOptionalLowercaseString(raw);
  return normalized && SAFE_SESSION_OWNER_ID_RE.test(normalized) ? normalized : undefined;
}

function toRegistrySessionKey(raw: string, agentId?: string): string {
  const normalized = normalizeSessionKey(raw);
  if (normalized !== "global") {
    return normalized;
  }
  const normalizedAgentId = normalizeAgentId(agentId);
  return normalizedAgentId ? `global\u0000agent:${normalizedAgentId}` : normalized;
}

function toSessionStorageKey(raw: string, agentId?: string): string {
  return createHash("sha256").update(toRegistrySessionKey(raw, agentId)).digest("base64url");
}

function toRedactedSessionKey(raw: string, agentId?: string): string {
  const normalized = normalizeSessionKey(raw);
  if (normalized === "global") {
    const normalizedAgentId = normalizeAgentId(agentId);
    const safeAgentId = normalizedAgentId
      ? normalizeRedactedSessionOwnerId(normalizedAgentId)
      : undefined;
    return safeAgentId
      ? `global:${safeAgentId}:REDACTED`
      : normalizedAgentId
        ? "global:REDACTED"
        : "global";
  }
  const parts = normalized.split(":");
  if (parts[0] === "agent") {
    const ownerAgentId = parts[1] ?? "";
    const hasMalformedEmptyTail =
      parts.length > 2 && !parts.slice(2).some((part) => part.trim().length > 0);
    const safeOwnerAgentId = normalizeRedactedSessionOwnerId(ownerAgentId);
    if (!safeOwnerAgentId || hasMalformedEmptyTail) {
      return "UNKNOWN";
    }
    const scope = parts[2];
    return scope === "subagent" || scope === "cron" || scope === "acp"
      ? `agent:${safeOwnerAgentId}:${scope}:REDACTED`
      : `agent:${safeOwnerAgentId}:REDACTED`;
  }
  const scope = parts[0];
  return scope === "subagent" || scope === "cron" || scope === "acp"
    ? `${scope}:REDACTED`
    : "UNSCOPED";
}

function normalizeTargetId(raw: string): string {
  return raw.trim();
}

function normalizeProfile(raw?: string): string | undefined {
  return normalizeOptionalLowercaseString(raw);
}

function normalizeBaseUrl(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function toTrackedTabId(params: {
  targetId: string;
  baseUrl?: string;
  executionProfile?: string;
}): string {
  return `${params.targetId}\u0000${params.baseUrl ?? ""}\u0000${params.executionProfile ?? ""}`;
}

function toBrowserStewardTrackedGuard(
  decision: BrowserStewardRuntimeDecision | undefined,
): BrowserStewardTrackedGuard | undefined {
  if (!decision || decision.approvalRequired || decision.boundaryDecision !== "allow") {
    return undefined;
  }
  return {
    boundaryDecision: "allow",
    requestedAction: decision.requestedAction,
    affectedBrowserProfile: decision.affectedBrowserProfile,
    affectedSession: decision.affectedSession,
    sessionBoundary: decision.sessionBoundary,
    credentialExposureKind: decision.credentialExposureKind,
    credentialExposureReasonCode: decision.credentialExposureReasonCode,
    approvalSource: "runtime",
    telemetryEvent: decision.telemetryEvent,
  };
}

function mergeBrowserStewardTrackedGuard(params: {
  current?: BrowserStewardTrackedGuard;
  next?: BrowserStewardTrackedGuard;
}): BrowserStewardTrackedGuard | undefined {
  const { current, next } = params;
  if (!next) {
    return current;
  }
  if (!current || current.credentialExposureKind === "none") {
    return next;
  }
  if (
    current.credentialExposureKind === "credential_material" ||
    next.credentialExposureKind === "none"
  ) {
    return {
      ...next,
      credentialExposureKind: current.credentialExposureKind,
      credentialExposureReasonCode: current.credentialExposureReasonCode,
    };
  }
  return next;
}

function shouldAllowBrowserStewardMetadata(params: {
  sessionKey: string;
  browserStewardRuntimeDecision?: BrowserStewardRuntimeDecision;
}): boolean {
  return (
    !isBrowserStewardSession(params.sessionKey) ||
    Boolean(toBrowserStewardTrackedGuard(params.browserStewardRuntimeDecision))
  );
}

function resolveTrackedTabIdentity(
  params: SessionBrowserTabIdentityParams & { safeProfile?: string },
): TrackedSessionBrowserTabIdentity | undefined {
  const sessionKeyRaw = params.sessionKey?.trim();
  const targetIdRaw = params.targetId?.trim();
  if (!sessionKeyRaw || !targetIdRaw) {
    return undefined;
  }
  return {
    sessionStorageKey: toSessionStorageKey(sessionKeyRaw, params.agentId),
    redactedSessionKey: toRedactedSessionKey(sessionKeyRaw, params.agentId),
    targetId: normalizeTargetId(targetIdRaw),
    baseUrl: normalizeBaseUrl(params.baseUrl),
    profile: normalizeProfile(params.safeProfile ?? params.profile),
    executionProfile: normalizeProfile(params.profile),
  };
}

function trackedTabsForIdentity(
  identity: TrackedSessionBrowserTabIdentity,
): Map<string, TrackedSessionBrowserTab> | undefined {
  return trackedTabsBySession.get(identity.sessionStorageKey)?.tabs;
}

function deleteTrackedTab(identity: TrackedSessionBrowserTabIdentity): void {
  const trackedForSession = trackedTabsForIdentity(identity);
  if (!trackedForSession) {
    return;
  }
  trackedForSession.delete(toTrackedTabId(identity));
  if (trackedForSession.size === 0) {
    trackedTabsBySession.delete(identity.sessionStorageKey);
  }
}

function isIgnorableCloseError(err: unknown): boolean {
  const message = normalizeLowercaseStringOrEmpty(String(err));
  return (
    message.includes("tab not found") ||
    message.includes("target closed") ||
    message.includes("target not found") ||
    message.includes("no such target")
  );
}

/** Starts tracking a browser tab for later session cleanup. */
export function trackSessionBrowserTab(
  params: SessionBrowserTabIdentityParams & {
    browserStewardRuntimeDecision?: BrowserStewardRuntimeDecision;
  },
): void {
  if (
    !params.sessionKey ||
    !shouldAllowBrowserStewardMetadata({
      sessionKey: params.sessionKey,
      browserStewardRuntimeDecision: params.browserStewardRuntimeDecision,
    })
  ) {
    return;
  }
  const browserStewardRuntimeGuard = toBrowserStewardTrackedGuard(
    params.browserStewardRuntimeDecision,
  );
  const identity = resolveTrackedTabIdentity({
    ...params,
    ...(browserStewardRuntimeGuard && params.profile
      ? { safeProfile: browserStewardRuntimeGuard.affectedBrowserProfile }
      : {}),
  });
  if (!identity) {
    return;
  }
  const now = Date.now();
  const tracked: TrackedSessionBrowserTabWithExecutionProfile = {
    targetId: identity.targetId,
    baseUrl: identity.baseUrl,
    profile: identity.profile,
    [TRACKED_TAB_EXECUTION_PROFILE]: identity.executionProfile,
    ...(browserStewardRuntimeGuard ? { browserStewardRuntimeGuard } : {}),
    trackedAt: now,
    lastUsedAt: now,
  };
  const trackedId = toTrackedTabId({
    targetId: tracked.targetId,
    baseUrl: tracked.baseUrl,
    executionProfile: tracked[TRACKED_TAB_EXECUTION_PROFILE],
  });
  let trackedSession = trackedTabsBySession.get(identity.sessionStorageKey);
  if (!trackedSession) {
    trackedSession = { redactedSessionKey: identity.redactedSessionKey, tabs: new Map() };
    trackedTabsBySession.set(identity.sessionStorageKey, trackedSession);
  }
  const trackedForSession = trackedSession.tabs;
  const existing = trackedForSession.get(trackedId);
  trackedForSession.set(trackedId, {
    ...tracked,
    trackedAt: existing?.trackedAt ?? tracked.trackedAt,
  });
}

/** Updates last-used time for a tracked browser tab. */
export function touchSessionBrowserTab(
  params: SessionBrowserTabIdentityParams & {
    now?: number;
    browserStewardRuntimeDecision?: BrowserStewardRuntimeDecision;
  },
): void {
  if (
    !params.sessionKey ||
    !shouldAllowBrowserStewardMetadata({
      sessionKey: params.sessionKey,
      browserStewardRuntimeDecision: params.browserStewardRuntimeDecision,
    })
  ) {
    return;
  }
  const nextBrowserStewardRuntimeGuard = toBrowserStewardTrackedGuard(
    params.browserStewardRuntimeDecision,
  );
  const identity = resolveTrackedTabIdentity({
    ...params,
    ...(nextBrowserStewardRuntimeGuard && params.profile
      ? { safeProfile: nextBrowserStewardRuntimeGuard.affectedBrowserProfile }
      : {}),
  });
  if (!identity) {
    return;
  }
  const trackedForSession = trackedTabsForIdentity(identity);
  if (!trackedForSession) {
    return;
  }
  const trackedId = toTrackedTabId(identity);
  const tracked = trackedForSession.get(trackedId);
  if (!tracked) {
    return;
  }
  // A later safe read must not erase an earlier credential-exposure audit fact.
  const browserStewardRuntimeGuard = mergeBrowserStewardTrackedGuard({
    current: tracked.browserStewardRuntimeGuard,
    next: nextBrowserStewardRuntimeGuard,
  });
  trackedForSession.set(trackedId, {
    ...tracked,
    ...(browserStewardRuntimeGuard ? { browserStewardRuntimeGuard } : {}),
    lastUsedAt: params.now ?? Date.now(),
  });
}

/** Removes a browser tab from session cleanup tracking. */
export function untrackSessionBrowserTab(params: SessionBrowserTabIdentityParams): void {
  const identity = resolveTrackedTabIdentity(params);
  if (!identity) {
    return;
  }
  deleteTrackedTab(identity);
}

function takeTrackedTabsForSessionKeys(
  sessionKeys: Array<string | undefined>,
  agentId?: string,
): TrackedSessionBrowserTab[] {
  const uniqueSessionKeys = new Set<string>();
  let includeAllGlobalSessions = false;
  for (const key of sessionKeys) {
    if (!key?.trim()) {
      continue;
    }
    if (agentId === undefined && normalizeSessionKey(key) === "global") {
      includeAllGlobalSessions = true;
      continue;
    }
    uniqueSessionKeys.add(toSessionStorageKey(key, agentId));
  }
  if (includeAllGlobalSessions) {
    for (const [sessionStorageKey, trackedSession] of trackedTabsBySession) {
      if (
        trackedSession.redactedSessionKey === "global" ||
        trackedSession.redactedSessionKey.startsWith("global:")
      ) {
        uniqueSessionKeys.add(sessionStorageKey);
      }
    }
  }
  if (uniqueSessionKeys.size === 0) {
    return [];
  }
  const seenTrackedIds = new Set<string>();
  const tabs: TrackedSessionBrowserTab[] = [];
  for (const sessionStorageKey of uniqueSessionKeys) {
    const trackedSession = trackedTabsBySession.get(sessionStorageKey);
    if (!trackedSession || trackedSession.tabs.size === 0) {
      continue;
    }
    trackedTabsBySession.delete(sessionStorageKey);
    for (const tracked of trackedSession.tabs.values()) {
      const trackedId = toTrackedTabId({
        targetId: tracked.targetId,
        baseUrl: tracked.baseUrl,
        executionProfile: (tracked as TrackedSessionBrowserTabWithExecutionProfile)[
          TRACKED_TAB_EXECUTION_PROFILE
        ],
      });
      if (seenTrackedIds.has(trackedId)) {
        continue;
      }
      seenTrackedIds.add(trackedId);
      tabs.push(tracked);
    }
  }
  return tabs;
}

async function closeTrackedTabs(params: {
  tabs: TrackedSessionBrowserTab[];
  closeTab?: (tab: { targetId: string; baseUrl?: string; profile?: string }) => Promise<void>;
  onWarn?: (message: string) => void;
}): Promise<number> {
  if (params.tabs.length === 0) {
    return 0;
  }
  const closeTab =
    params.closeTab ??
    (async (tab: { targetId: string; baseUrl?: string; profile?: string }) => {
      await browserCloseTab(tab.baseUrl, tab.targetId, {
        profile: tab.profile,
      });
    });
  let closed = 0;
  for (const tab of params.tabs) {
    try {
      await closeTab({
        targetId: tab.targetId,
        baseUrl: tab.baseUrl,
        profile: (tab as TrackedSessionBrowserTabWithExecutionProfile)[
          TRACKED_TAB_EXECUTION_PROFILE
        ],
      });
      closed += 1;
    } catch (err) {
      if (!isIgnorableCloseError(err)) {
        params.onWarn?.(`failed to close tracked browser tab ${tab.targetId}: ${String(err)}`);
      }
    }
  }
  return closed;
}

/** Closes and untracks tabs for the supplied session keys. */
export async function closeTrackedBrowserTabsForSessions(params: {
  sessionKeys: Array<string | undefined>;
  agentId?: string;
  closeTab?: (tab: { targetId: string; baseUrl?: string; profile?: string }) => Promise<void>;
  onWarn?: (message: string) => void;
}): Promise<number> {
  return await closeTrackedTabs({
    tabs: takeTrackedTabsForSessionKeys(params.sessionKeys, params.agentId),
    closeTab: params.closeTab,
    onWarn: params.onWarn,
  });
}

function takeStaleTrackedTabs(params: {
  now: number;
  idleMs?: number;
  maxTabsPerSession?: number;
  sessionFilter?: (sessionKey: string) => boolean;
}): TrackedSessionBrowserTab[] {
  const tabsToClose: TrackedSessionBrowserTab[] = [];
  const takenIdsBySession = new Map<string, Set<string>>();
  const mark = (sessionKey: string, trackedId: string, tracked: TrackedSessionBrowserTab): void => {
    let takenForSession = takenIdsBySession.get(sessionKey);
    if (!takenForSession) {
      takenForSession = new Set();
      takenIdsBySession.set(sessionKey, takenForSession);
    }
    if (takenForSession.has(trackedId)) {
      return;
    }
    takenForSession.add(trackedId);
    tabsToClose.push(tracked);
  };

  for (const [sessionStorageKey, trackedSession] of trackedTabsBySession) {
    if (params.sessionFilter && !params.sessionFilter(trackedSession.redactedSessionKey)) {
      continue;
    }
    const trackedForSession = trackedSession.tabs;
    const entries = [...trackedForSession.entries()].toSorted(
      (a, b) => a[1].lastUsedAt - b[1].lastUsedAt || a[1].trackedAt - b[1].trackedAt,
    );
    if (params.idleMs && params.idleMs > 0) {
      for (const [trackedId, tracked] of entries) {
        if (params.now - tracked.lastUsedAt >= params.idleMs) {
          mark(sessionStorageKey, trackedId, tracked);
        }
      }
    }

    const remainingEntries = entries.filter(
      ([trackedId]) => !takenIdsBySession.get(sessionStorageKey)?.has(trackedId),
    );
    if (
      params.maxTabsPerSession &&
      params.maxTabsPerSession > 0 &&
      remainingEntries.length > params.maxTabsPerSession
    ) {
      const excess = remainingEntries.length - params.maxTabsPerSession;
      for (const [trackedId, tracked] of remainingEntries.slice(0, excess)) {
        mark(sessionStorageKey, trackedId, tracked);
      }
    }
  }

  for (const [sessionStorageKey, trackedIds] of takenIdsBySession) {
    const trackedSession = trackedTabsBySession.get(sessionStorageKey);
    if (!trackedSession) {
      continue;
    }
    const trackedForSession = trackedSession.tabs;
    for (const trackedId of trackedIds) {
      trackedForSession.delete(trackedId);
    }
    if (trackedForSession.size === 0) {
      trackedTabsBySession.delete(sessionStorageKey);
    }
  }
  return tabsToClose;
}

/** Closes and untracks stale or excess browser tabs across tracked sessions. */
export async function sweepTrackedBrowserTabs(params: {
  now?: number;
  idleMs?: number;
  maxTabsPerSession?: number;
  sessionFilter?: (sessionKey: string) => boolean;
  closeTab?: (tab: { targetId: string; baseUrl?: string; profile?: string }) => Promise<void>;
  onWarn?: (message: string) => void;
}): Promise<number> {
  return await closeTrackedTabs({
    tabs: takeStaleTrackedTabs({
      now: params.now ?? Date.now(),
      idleMs: params.idleMs,
      maxTabsPerSession: params.maxTabsPerSession,
      sessionFilter: params.sessionFilter,
    }),
    closeTab: params.closeTab,
    onWarn: params.onWarn,
  });
}

/** Clears tracked tab state for tests. */
export function resetTrackedSessionBrowserTabsForTests(): void {
  trackedTabsBySession.clear();
}

/** Counts tracked tabs for one session or all sessions in tests. */
export function countTrackedSessionBrowserTabsForTests(
  sessionKey?: string,
  agentId?: string,
): number {
  if (typeof sessionKey === "string" && sessionKey.trim()) {
    return trackedTabsBySession.get(toSessionStorageKey(sessionKey, agentId))?.tabs.size ?? 0;
  }
  let count = 0;
  for (const trackedSession of trackedTabsBySession.values()) {
    count += trackedSession.tabs.size;
  }
  return count;
}

export function getTrackedSessionBrowserTabsForTests(
  sessionKey?: string,
  agentId?: string,
): TrackedSessionBrowserTab[] {
  const sessionStorageKey =
    typeof sessionKey === "string" ? toSessionStorageKey(sessionKey, agentId) : undefined;
  const tabs: TrackedSessionBrowserTab[] = [];
  for (const [key, trackedSession] of trackedTabsBySession) {
    if (sessionStorageKey && key !== sessionStorageKey) {
      continue;
    }
    for (const tracked of trackedSession.tabs.values()) {
      tabs.push({
        ...tracked,
        ...(tracked.browserStewardRuntimeGuard
          ? { browserStewardRuntimeGuard: { ...tracked.browserStewardRuntimeGuard } }
          : {}),
      });
    }
  }
  return tabs;
}
