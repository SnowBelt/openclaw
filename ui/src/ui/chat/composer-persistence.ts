// Control UI chat module implements composer persistence behavior.
import { normalizeGatewayComposerScope } from "../../app/gateway-scope.ts";
import { getSafeSessionStorage } from "../../local-storage.ts";
import { DEFAULT_AGENT_ID, normalizeAgentId, parseAgentSessionKey } from "../session-key.ts";
import type { ChatAttachment, ChatQueueItem, ChatQueueSkillWorkshopRevision } from "../ui-types.ts";
import { getChatAttachmentDataUrl } from "./attachment-payload-store.ts";

const STORAGE_KEY_PREFIX = "openclaw.control.chatComposer.v1:";
const MAX_STORED_SESSIONS = 20;
const MAX_STORED_QUEUE_ITEMS = 50;
export const INTERRUPTED_MODEL_WAIT_ERROR =
  "Model selection was interrupted. Review and retry when ready.";

type ChatComposerPersistenceState = {
  settings?: { gatewayUrl?: string | null; token?: string | null };
  /** Stable per-page owner for password-only, memory-only composer state. */
  chatComposerMemoryOwner?: object;
  password?: string | null;
  assistantAgentId?: string | null;
  agentsList?: { defaultId?: string | null; mainKey?: string | null } | null;
  hello?: {
    auth?: { deviceToken?: unknown } | null;
    snapshot?: unknown;
  } | null;
  sessionKey: string;
  chatMessage: string;
  chatQueue: ChatQueueItem[];
  chatQueuePausedBySession?: Record<string, boolean>;
  chatQueuePaused?: boolean;
  chatComposerPersistenceSuspended?: boolean;
};

type StoredComposerSession = {
  draft?: string;
  queue?: ChatQueueItem[];
  queuePaused?: boolean;
  updatedAt: number;
};

type StoredComposerState = {
  version: 1;
  sessions: Record<string, StoredComposerSession>;
};

type RestoreOptions = {
  preserveCurrent?: boolean;
  preserveCurrentQueuePaused?: boolean;
  sessionKey?: string;
  /** Confirms that endpoint-only v1 records belong to this authenticated browser. */
  confirmLegacyRecovery?: () => boolean;
};

export type PersistChatComposerStateOptions = {
  requireComplete?: boolean;
  /** Explicitly replaces the stored draft; null clears it. Omitted preserves it. */
  draft?: string | null;
};

export type StoredChatComposerUpdate = {
  sessionKey: string;
  queue: ChatQueueItem[];
  queuePaused: boolean;
  /** Omit for inactive sessions to preserve their already-stored draft. */
  draft?: string;
};

export type ChatComposerIdentityState = Pick<ChatComposerPersistenceState, "settings" | "hello"> & {
  chatComposerMemoryOwner?: object;
  password?: string | null;
};

const inMemoryComposerStores = new WeakMap<object, Map<string, StoredComposerState>>();
const ownerlessPreHelloComposerStores = new Map<string, StoredComposerState>();
const legacyRecoveryPromptedOwners = new WeakSet<object>();

function resolveDeviceToken(state: ChatComposerIdentityState): string {
  return typeof state.hello?.auth?.deviceToken === "string"
    ? state.hello.auth.deviceToken.trim()
    : "";
}

function hasUnverifiedBootstrapToken(state: ChatComposerIdentityState): boolean {
  return Boolean(!state.hello && state.settings?.token?.trim());
}

function hasUnresolvedPreHelloIdentity(state: ChatComposerIdentityState): boolean {
  return !state.hello && !state.settings?.token?.trim() && !state.password?.trim();
}

function resolveMemoryComposerCredential(state: ChatComposerIdentityState): string {
  return (
    resolveDeviceToken(state) ||
    state.settings?.token?.trim() ||
    state.password?.trim() ||
    (hasUnverifiedBootstrapToken(state) ? "pre-hello" : "")
  );
}

function storageKeyForState(state: ChatComposerIdentityState): string | null {
  // After hello, the device token is the authenticated principal. A shared
  // bootstrap token must not make different paired devices share drafts.
  const deviceToken = resolveDeviceToken(state);
  if (hasUnverifiedBootstrapToken(state)) {
    // Do not persist or restore while the browser still has only the shared
    // bootstrap credential. Credential-less state is written durably for
    // failure reporting, but it is never read until hello resolves identity.
    return null;
  }
  const credential = deviceToken || state.settings?.token?.trim() || "";
  // Passwords are deliberately excluded: a deterministic password-derived
  // browser key would enable offline guessing from sessionStorage.
  if (!credential && state.password?.trim()) {
    return null;
  }
  const scope = normalizeGatewayComposerScope(state.settings?.gatewayUrl, credential);
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(scope).slice(0, 240)}`;
}

function inMemoryComposerStoreForState(
  state: ChatComposerIdentityState,
  create = false,
): StoredComposerState | null {
  const owner = state.chatComposerMemoryOwner;
  const gatewayScope = normalizeGatewayComposerScope(
    state.settings?.gatewayUrl,
    resolveMemoryComposerCredential(state),
  );
  if (!owner) {
    if (!hasUnresolvedPreHelloIdentity(state)) {
      return null;
    }
    const scope = normalizeGatewayComposerScope(state.settings?.gatewayUrl, "");
    let store = ownerlessPreHelloComposerStores.get(scope);
    if (!store && create) {
      store = { version: 1, sessions: {} };
      ownerlessPreHelloComposerStores.set(scope, store);
    }
    return store ?? null;
  }
  if (!gatewayScope) {
    return null;
  }
  let stores = inMemoryComposerStores.get(owner);
  if (!stores) {
    if (!create) {
      return null;
    }
    stores = new Map();
    inMemoryComposerStores.set(owner, stores);
  }
  let store = stores.get(gatewayScope);
  if (!store && !create && hasUnresolvedPreHelloIdentity(state)) {
    // A detached Gateway guard may not carry the page owner. Reuse only the
    // transient pre-hello mirror; it is never read after hello resolves.
    return ownerlessPreHelloComposerStores.get(gatewayScope) ?? null;
  }
  if (!store && create) {
    store = { version: 1, sessions: {} };
    stores.set(gatewayScope, store);
  }
  return store ?? null;
}

function writeInMemoryComposerStore(
  state: ChatComposerIdentityState,
  store: StoredComposerState,
  maxSessions = MAX_STORED_SESSIONS,
): void {
  const owner = state.chatComposerMemoryOwner;
  const gatewayScope = normalizeGatewayComposerScope(
    state.settings?.gatewayUrl,
    resolveMemoryComposerCredential(state),
  );
  if (!owner) {
    if (!hasUnresolvedPreHelloIdentity(state)) {
      return;
    }
    const scope = normalizeGatewayComposerScope(state.settings?.gatewayUrl, "");
    const entries = Object.entries(store.sessions)
      .toSorted((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_STORED_SESSIONS);
    if (entries.length === 0) {
      ownerlessPreHelloComposerStores.delete(scope);
    } else {
      ownerlessPreHelloComposerStores.set(scope, {
        version: 1,
        sessions: Object.fromEntries(entries),
      });
    }
    return;
  }
  if (!gatewayScope) {
    return;
  }
  let stores = inMemoryComposerStores.get(owner);
  if (!stores) {
    stores = new Map();
    inMemoryComposerStores.set(owner, stores);
  }
  const entries = Object.entries(store.sessions)
    .toSorted((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, maxSessions);
  if (entries.length === 0) {
    stores.delete(gatewayScope);
    return;
  }
  stores.set(gatewayScope, {
    version: 1,
    sessions: Object.fromEntries(entries),
  });
}

function inMemoryComposerSessionForState(
  state: ChatComposerIdentityState,
  storeSessionKey: string,
): StoredComposerSession | undefined {
  const session = inMemoryComposerStoreForState(state)?.sessions[storeSessionKey];
  if (session || !hasUnresolvedPreHelloIdentity(state)) {
    return session;
  }
  const scope = normalizeGatewayComposerScope(state.settings?.gatewayUrl, "");
  return ownerlessPreHelloComposerStores.get(scope)?.sessions[storeSessionKey];
}

function persistInMemoryComposerState(
  state: ChatComposerPersistenceState,
  sessionKey: string,
  draft: string,
  queue: ChatQueueItem[],
  queuePaused: boolean,
): boolean {
  const store = inMemoryComposerStoreForState(state, true);
  if (!store || !sessionKey.trim()) {
    return !draft && queue.length === 0 && !queuePaused;
  }
  const storeSessionKey = storageSessionKeyForState(state, sessionKey);
  if (!draft && queue.length === 0 && !queuePaused) {
    delete store.sessions[storeSessionKey];
  } else {
    store.sessions[storeSessionKey] = {
      ...(draft ? { draft } : {}),
      ...(queue.length > 0 ? { queue } : {}),
      ...(queuePaused ? { queuePaused: true } : {}),
      updatedAt: Date.now(),
    };
  }
  writeInMemoryComposerStore(state, store);
  return true;
}

function readStoreForState(storage: Storage, key: string): StoredComposerState {
  // Endpoint-only legacy records have no principal provenance. Leaving them
  // isolated prevents an anonymous or newly paired browser from claiming
  // another device's draft or queued work.
  return readStore(storage, key);
}

function legacyStorageKeyForState(state: ChatComposerIdentityState): string {
  const scope = state.settings?.gatewayUrl?.trim() || "default";
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(scope).slice(0, 240)}`;
}

function hasLegacyChatComposerState(state: ChatComposerIdentityState): boolean {
  if (hasUnverifiedBootstrapToken(state) || hasUnresolvedPreHelloIdentity(state)) {
    return false;
  }
  const storage = getSafeSessionStorage();
  const key = storage ? storageKeyForState(state) : null;
  const legacyKey = legacyStorageKeyForState(state);
  if (!storage || !key || legacyKey === key) {
    return false;
  }
  return Object.keys(readStore(storage, legacyKey).sessions).length > 0;
}

function confirmLegacyChatComposerRecovery(): boolean {
  if (typeof globalThis.confirm !== "function") {
    return false;
  }
  try {
    return globalThis.confirm(
      "Restore drafts and queued messages saved by an older OpenClaw Dashboard version for this Gateway?",
    );
  } catch {
    return false;
  }
}

function recoverLegacyChatComposerStateIfConfirmed(
  state: ChatComposerIdentityState,
  confirmRecovery: (() => boolean) | undefined,
): boolean {
  const owner = state.chatComposerMemoryOwner;
  if (!owner || legacyRecoveryPromptedOwners.has(owner) || !hasLegacyChatComposerState(state)) {
    return false;
  }
  // Avoid repeatedly interrupting reconnects/renders after a user declines or
  // a storage migration fails; a reload starts a fresh explicit recovery attempt.
  legacyRecoveryPromptedOwners.add(owner);
  return recoverLegacyChatComposerState(state, {
    confirmOwnerless: (confirmRecovery ?? confirmLegacyChatComposerRecovery)(),
  });
}

function readHelloDefaultAgentId(state: Pick<ChatComposerPersistenceState, "hello">) {
  const snapshot = state.hello?.snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return undefined;
  }
  const defaults = (snapshot as { sessionDefaults?: unknown }).sessionDefaults;
  if (!defaults || typeof defaults !== "object") {
    return undefined;
  }
  const defaultAgentId = (defaults as { defaultAgentId?: unknown }).defaultAgentId;
  return typeof defaultAgentId === "string" && defaultAgentId.trim()
    ? defaultAgentId.trim()
    : undefined;
}

function resolveComposerAgentScope(
  state: Pick<ChatComposerPersistenceState, "assistantAgentId" | "agentsList" | "hello">,
  sessionKey: string,
): string {
  const parsed = parseAgentSessionKey(sessionKey);
  if (parsed) {
    return normalizeAgentId(parsed.agentId);
  }
  const defaultAgentId =
    state.assistantAgentId?.trim() ||
    state.agentsList?.defaultId?.trim() ||
    readHelloDefaultAgentId(state) ||
    DEFAULT_AGENT_ID;
  return normalizeAgentId(defaultAgentId);
}

function storageSessionKeyForState(
  state: Pick<ChatComposerPersistenceState, "assistantAgentId" | "agentsList" | "hello">,
  sessionKey: string,
): string {
  const agentId = resolveComposerAgentScope(state, sessionKey);
  return `${sessionKey}\u0000agent:${agentId}`;
}

function readStore(storage: Storage, key: string): StoredComposerState {
  const raw = storage.getItem(key);
  if (!raw) {
    return { version: 1, sessions: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredComposerState>;
    if (
      !parsed ||
      parsed.version !== 1 ||
      !parsed.sessions ||
      typeof parsed.sessions !== "object"
    ) {
      return { version: 1, sessions: {} };
    }
    const sessions: Record<string, StoredComposerSession> = {};
    for (const [sessionKey, value] of Object.entries(parsed.sessions)) {
      const session = normalizeStoredSession(value);
      if (session) {
        sessions[sessionKey] = session;
      }
    }
    return { version: 1, sessions };
  } catch {
    return { version: 1, sessions: {} };
  }
}

function writeStore(
  storage: Storage,
  key: string,
  store: StoredComposerState,
  maxSessions = MAX_STORED_SESSIONS,
): void {
  const entries = Object.entries(store.sessions)
    .toSorted((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, maxSessions);
  if (entries.length === 0) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, JSON.stringify({ version: 1, sessions: Object.fromEntries(entries) }));
}

function mergeStoredComposerStates(
  previousStore: StoredComposerState,
  nextStore: StoredComposerState,
): StoredComposerState {
  const sessions = { ...previousStore.sessions };
  for (const [sessionKey, session] of Object.entries(nextStore.sessions)) {
    const previousSession = sessions[sessionKey];
    if (!previousSession || session.updatedAt >= previousSession.updatedAt) {
      sessions[sessionKey] = session;
    }
  }
  return { version: 1, sessions };
}

function containsAllComposerSessions(
  store: StoredComposerState,
  expected: StoredComposerState,
): boolean {
  return Object.keys(expected.sessions).every((sessionKey) =>
    Object.hasOwn(store.sessions, sessionKey),
  );
}

/**
 * Moves every recoverable composer session across an authenticated token
 * rotation. The same client instance is the caller's same-device boundary.
 */
export function migrateChatComposerState(
  previousState: ChatComposerIdentityState,
  nextState: ChatComposerIdentityState,
): boolean {
  if (hasUnresolvedPreHelloIdentity(previousState)) {
    // Anonymous endpoint state cannot be attributed to the authenticated
    // principal that hello may later establish.
    return false;
  }
  const previousKey = storageKeyForState(previousState);
  const nextKey = storageKeyForState(nextState);
  if (previousKey && nextKey) {
    if (previousKey === nextKey) {
      return true;
    }
    const storage = getSafeSessionStorage();
    if (!storage) {
      return false;
    }
    const previousRaw = storage.getItem(previousKey);
    const nextRaw = storage.getItem(nextKey);
    const previousStore = readStore(storage, previousKey);
    if (Object.keys(previousStore.sessions).length === 0) {
      return true;
    }
    try {
      const mergedStore = mergeStoredComposerStates(previousStore, readStore(storage, nextKey));
      writeStore(storage, nextKey, mergedStore, Number.POSITIVE_INFINITY);
      if (!containsAllComposerSessions(readStore(storage, nextKey), previousStore)) {
        throw new Error("composer scope migration verification failed");
      }
      storage.removeItem(previousKey);
      if (storage.getItem(previousKey) !== null) {
        throw new Error("composer scope migration cleanup failed");
      }
      return true;
    } catch {
      try {
        if (nextRaw === null) {
          storage.removeItem(nextKey);
        } else {
          storage.setItem(nextKey, nextRaw);
        }
        if (previousRaw === null) {
          storage.removeItem(previousKey);
        } else {
          storage.setItem(previousKey, previousRaw);
        }
      } catch {
        // Preserve the fail-closed result if storage rollback also fails.
      }
      return false;
    }
  }
  if (previousKey !== null || nextKey !== null) {
    return false;
  }
  const previousOwner = previousState.chatComposerMemoryOwner;
  const nextOwner = nextState.chatComposerMemoryOwner;
  const previousScope = previousOwner
    ? normalizeGatewayComposerScope(
        previousState.settings?.gatewayUrl,
        resolveMemoryComposerCredential(previousState),
      )
    : "";
  const nextScope = nextOwner
    ? normalizeGatewayComposerScope(
        nextState.settings?.gatewayUrl,
        resolveMemoryComposerCredential(nextState),
      )
    : "";
  if (!previousOwner || !nextOwner || previousOwner !== nextOwner || !previousScope || !nextScope) {
    return false;
  }
  if (previousScope === nextScope) {
    return true;
  }
  const stores = inMemoryComposerStores.get(previousOwner);
  const previousStore = stores?.get(previousScope);
  if (!stores || !previousStore || Object.keys(previousStore.sessions).length === 0) {
    return true;
  }
  const nextStore = stores.get(nextScope);
  const mergedStore = mergeStoredComposerStates(
    previousStore,
    nextStore ?? { version: 1, sessions: {} },
  );
  stores.set(nextScope, mergedStore);
  if (!containsAllComposerSessions(stores.get(nextScope)!, previousStore)) {
    if (nextStore) {
      stores.set(nextScope, nextStore);
    } else {
      stores.delete(nextScope);
    }
    return false;
  }
  stores.delete(previousScope);
  return true;
}

/**
 * Explicitly recovers endpoint-only v1 records after the operator confirms
 * that this browser's old drafts belong to the current principal.
 */
export function recoverLegacyChatComposerState(
  state: ChatComposerIdentityState,
  options: { confirmOwnerless: boolean },
): boolean {
  if (
    !options.confirmOwnerless ||
    hasUnverifiedBootstrapToken(state) ||
    hasUnresolvedPreHelloIdentity(state)
  ) {
    return false;
  }
  const storage = getSafeSessionStorage();
  const key = storage ? storageKeyForState(state) : null;
  const legacyKey = legacyStorageKeyForState(state);
  if (!storage || !key || legacyKey === key) {
    return false;
  }
  const legacyRaw = storage.getItem(legacyKey);
  const currentRaw = storage.getItem(key);
  const legacyStore = readStore(storage, legacyKey);
  if (Object.keys(legacyStore.sessions).length === 0) {
    return false;
  }
  try {
    const mergedStore = mergeStoredComposerStates(legacyStore, readStore(storage, key));
    writeStore(storage, key, mergedStore, Number.POSITIVE_INFINITY);
    if (!containsAllComposerSessions(readStore(storage, key), legacyStore)) {
      throw new Error("legacy composer recovery verification failed");
    }
    storage.removeItem(legacyKey);
    if (storage.getItem(legacyKey) !== null) {
      throw new Error("legacy composer recovery cleanup failed");
    }
    return true;
  } catch {
    try {
      if (currentRaw === null) {
        storage.removeItem(key);
      } else {
        storage.setItem(key, currentRaw);
      }
      if (legacyRaw === null) {
        storage.removeItem(legacyKey);
      } else {
        storage.setItem(legacyKey, legacyRaw);
      }
    } catch {
      // Preserve the fail-closed result if storage rollback also fails.
    }
    return false;
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeChatAttachment(value: unknown): ChatAttachment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const id = normalizeOptionalString(entry.id);
  const mimeType = normalizeOptionalString(entry.mimeType);
  if (!id || !mimeType) {
    return null;
  }
  const restored: ChatAttachment = { id, mimeType };
  const fileName = normalizeOptionalString(entry.fileName);
  if (fileName) {
    restored.fileName = fileName;
  }
  if (typeof entry.sizeBytes === "number" && Number.isFinite(entry.sizeBytes)) {
    restored.sizeBytes = entry.sizeBytes;
  }
  const dataUrl = normalizeOptionalString(entry.dataUrl);
  if (dataUrl) {
    restored.dataUrl = dataUrl;
  }
  return restored;
}

function serializeChatAttachment(attachment: ChatAttachment): ChatAttachment | null {
  const dataUrl = getChatAttachmentDataUrl(attachment);
  if (!dataUrl) {
    return null;
  }
  return {
    id: attachment.id,
    mimeType: attachment.mimeType,
    ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
    ...(typeof attachment.sizeBytes === "number" ? { sizeBytes: attachment.sizeBytes } : {}),
    dataUrl,
  };
}

function normalizeSkillWorkshopRevision(
  value: unknown,
): ChatQueueSkillWorkshopRevision | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entry = value as Record<string, unknown>;
  const proposalId = normalizeOptionalString(entry.proposalId);
  if (!proposalId) {
    return undefined;
  }
  const agentId = normalizeOptionalString(entry.agentId);
  return {
    proposalId,
    ...(agentId ? { agentId: normalizeAgentId(agentId) } : {}),
  };
}

function isRecoverableQueueItem(item: ChatQueueItem): boolean {
  return !item.serverTurnId && !item.pendingRunId && item.sendState !== "sending";
}

function serializeQueueItem(item: ChatQueueItem): ChatQueueItem | null {
  // Durable inbox turns are restored from the Gateway. Keeping a second
  // browser-owned copy would duplicate them after reconnect or device change.
  if (item.serverTurnId) {
    return null;
  }
  const id = normalizeOptionalString(item.id);
  const text = typeof item.text === "string" ? item.text : "";
  if (!id || (!text.trim() && !item.attachments?.length)) {
    return null;
  }
  if (item.pendingRunId) {
    return null;
  }
  if (item.sendState === "sending") {
    return null;
  }
  const attachments = item.attachments?.map(serializeChatAttachment) ?? [];
  if (item.attachments?.length && attachments.some((attachment) => attachment === null)) {
    return null;
  }
  const sendState =
    item.sendState === "failed" ||
    item.sendState === "waiting-reconnect" ||
    item.sendState === "waiting-model"
      ? item.sendState
      : undefined;
  const skillWorkshopRevision = normalizeSkillWorkshopRevision(item.skillWorkshopRevision);
  return {
    id,
    text,
    createdAt:
      typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
        ? item.createdAt
        : Date.now(),
    ...(item.kind === "queued" || item.kind === "steered" ? { kind: item.kind } : {}),
    ...(attachments.length ? { attachments: attachments as ChatAttachment[] } : {}),
    ...(typeof item.refreshSessions === "boolean" ? { refreshSessions: item.refreshSessions } : {}),
    ...(item.localCommandArgs ? { localCommandArgs: item.localCommandArgs } : {}),
    ...(item.localCommandName ? { localCommandName: item.localCommandName } : {}),
    ...(item.sessionKey ? { sessionKey: item.sessionKey } : {}),
    ...(item.agentId ? { agentId: item.agentId } : {}),
    ...(skillWorkshopRevision ? { skillWorkshopRevision } : {}),
    ...(sendState ? { sendState } : {}),
    ...(item.sendError ? { sendError: item.sendError } : {}),
    ...(item.sendRunId ? { sendRunId: item.sendRunId } : {}),
    ...(typeof item.sendAttempts === "number" && Number.isFinite(item.sendAttempts)
      ? { sendAttempts: item.sendAttempts }
      : {}),
  };
}

function serializeQueueForStorage(queue: ChatQueueItem[]): ChatQueueItem[] {
  return queue.map(serializeQueueItem).filter((item): item is ChatQueueItem => item !== null);
}

function normalizeQueueItem(value: unknown): ChatQueueItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const id = normalizeOptionalString(entry.id);
  const text = typeof entry.text === "string" ? entry.text : "";
  const createdAt =
    typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
      ? entry.createdAt
      : Date.now();
  if (!id || (!text.trim() && !Array.isArray(entry.attachments))) {
    return null;
  }
  const attachments = Array.isArray(entry.attachments)
    ? entry.attachments
        .map(normalizeChatAttachment)
        .filter((item): item is ChatAttachment => item !== null)
    : [];
  const item: ChatQueueItem = { id, text, createdAt };
  if (entry.kind === "queued" || entry.kind === "steered") {
    item.kind = entry.kind;
  }
  if (attachments.length) {
    item.attachments = attachments;
  }
  const refreshSessions = normalizeOptionalBoolean(entry.refreshSessions);
  if (refreshSessions !== undefined) {
    item.refreshSessions = refreshSessions;
  }
  if (entry.sendState === "failed" || entry.sendState === "waiting-reconnect") {
    item.sendState = entry.sendState;
  } else if (entry.sendState === "waiting-model") {
    item.sendState = "failed";
    item.sendError = INTERRUPTED_MODEL_WAIT_ERROR;
  }
  const sendError = normalizeOptionalString(entry.sendError);
  if (sendError) {
    item.sendError = sendError;
  }
  const sendRunId = normalizeOptionalString(entry.sendRunId);
  if (sendRunId) {
    item.sendRunId = sendRunId;
  }
  if (typeof entry.sendAttempts === "number" && Number.isFinite(entry.sendAttempts)) {
    item.sendAttempts = entry.sendAttempts;
  }
  const localCommandArgs = normalizeOptionalString(entry.localCommandArgs);
  if (localCommandArgs) {
    item.localCommandArgs = localCommandArgs;
  }
  const localCommandName = normalizeOptionalString(entry.localCommandName);
  if (localCommandName) {
    item.localCommandName = localCommandName;
  }
  const sessionKey = normalizeOptionalString(entry.sessionKey);
  if (sessionKey) {
    item.sessionKey = sessionKey;
  }
  const agentId = normalizeOptionalString(entry.agentId);
  if (agentId) {
    item.agentId = normalizeAgentId(agentId);
  }
  const skillWorkshopRevision = normalizeSkillWorkshopRevision(entry.skillWorkshopRevision);
  if (skillWorkshopRevision) {
    item.skillWorkshopRevision = skillWorkshopRevision;
  }
  return item;
}

function normalizeStoredSession(value: unknown): StoredComposerSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const draft = typeof entry.draft === "string" ? entry.draft : undefined;
  const queue = Array.isArray(entry.queue)
    ? entry.queue
        .slice(0, MAX_STORED_QUEUE_ITEMS)
        .map(normalizeQueueItem)
        .filter((item): item is ChatQueueItem => item !== null)
    : undefined;
  const queuePaused = entry.queuePaused === true;
  if (!draft && (!queue || queue.length === 0) && !queuePaused) {
    return null;
  }
  return {
    ...(draft ? { draft } : {}),
    ...(queue && queue.length > 0 ? { queue } : {}),
    ...(queuePaused ? { queuePaused: true } : {}),
    updatedAt:
      typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
        ? entry.updatedAt
        : Date.now(),
  };
}

export function loadChatComposerSnapshot(
  state: Pick<
    ChatComposerPersistenceState,
    | "settings"
    | "password"
    | "assistantAgentId"
    | "agentsList"
    | "hello"
    | "chatComposerPersistenceSuspended"
  >,
  sessionKey: string,
): { draft: string; queue: ChatQueueItem[]; queuePaused?: boolean } | null {
  if (hasUnverifiedBootstrapToken(state)) {
    // A pre-hello connection may later authenticate with a paired-device token
    // that is not visible to the composer. Never render its shared scope.
    return null;
  }
  const storage = getSafeSessionStorage();
  try {
    const storeSessionKey = storageSessionKeyForState(state, sessionKey);
    const key = storage ? storageKeyForState(state) : null;
    if (hasUnresolvedPreHelloIdentity(state)) {
      // Memory is scoped to this live page and cannot contain another paired
      // device's persisted data. Persistent endpoint state remains deferred
      // until hello identifies whether this browser is anonymous or paired.
      const memorySession = normalizeStoredSession(
        inMemoryComposerSessionForState(state, storeSessionKey),
      );
      if (!memorySession) {
        return null;
      }
      return {
        draft: memorySession.draft ?? "",
        queue: memorySession.queue ?? [],
        ...(memorySession.queuePaused === true ? { queuePaused: true } : {}),
      };
    }
    if (!storage || !key) {
      const memorySession = normalizeStoredSession(
        inMemoryComposerSessionForState(state, storeSessionKey),
      );
      if (!memorySession) {
        return null;
      }
      return {
        draft: memorySession.draft ?? "",
        queue: memorySession.queue ?? [],
        ...(memorySession.queuePaused === true ? { queuePaused: true } : {}),
      };
    }
    const session = normalizeStoredSession(
      readStoreForState(storage, key).sessions[storeSessionKey],
    );
    if (!session) {
      return null;
    }
    return {
      draft: session.draft ?? "",
      queue: session.queue ?? [],
      ...(session.queuePaused === true ? { queuePaused: true } : {}),
    };
  } catch {
    return null;
  }
}

export function persistChatComposerState(
  state: ChatComposerPersistenceState,
  sessionKey: string = state.sessionKey,
  options: PersistChatComposerStateOptions = {},
): boolean {
  if (state.chatComposerPersistenceSuspended) {
    return false;
  }
  const draft = state.chatMessage;
  const localQueue = state.chatQueue.filter(isRecoverableQueueItem);
  const requireComplete = options.requireComplete === true;
  if (requireComplete) {
    return persistStoredChatComposerSet(state, [
      { sessionKey, draft, queue: localQueue, queuePaused: state.chatQueuePaused === true },
    ]);
  }
  const queue = serializeQueueForStorage(localQueue.slice(0, MAX_STORED_QUEUE_ITEMS));
  const queuePaused = state.chatQueuePaused === true;
  const storage = getSafeSessionStorage();
  if (!sessionKey.trim()) {
    return true;
  }
  try {
    const key = storage ? storageKeyForState(state) : null;
    if (!storage || !key) {
      return persistInMemoryComposerState(state, sessionKey, draft, queue, queuePaused);
    }
    const store = readStoreForState(storage, key);
    const storeSessionKey = storageSessionKeyForState(state, sessionKey);
    if (!draft && queue.length === 0 && !queuePaused) {
      delete store.sessions[storeSessionKey];
    } else {
      store.sessions[storeSessionKey] = {
        ...(draft ? { draft } : {}),
        ...(queue.length > 0 ? { queue } : {}),
        ...(queuePaused ? { queuePaused: true } : {}),
        updatedAt: Date.now(),
      };
    }
    writeStore(storage, key, store);
    if (hasUnresolvedPreHelloIdentity(state)) {
      writeInMemoryComposerStore(state, store);
    }
    return true;
  } catch {
    // Callers that clear in-memory state must inspect the result first.
    return false;
  }
}

export function removeStoredChatComposerQueueItem(
  state: Pick<
    ChatComposerPersistenceState,
    | "settings"
    | "password"
    | "assistantAgentId"
    | "agentsList"
    | "hello"
    | "chatComposerPersistenceSuspended"
  >,
  sessionKey: string,
  id: string,
): void {
  const storage = getSafeSessionStorage();
  if (!sessionKey.trim() || !id.trim()) {
    return;
  }
  try {
    const key = storage ? storageKeyForState(state) : null;
    if (!storage || !key) {
      const store = inMemoryComposerStoreForState(state);
      if (!store) {
        return;
      }
      const storeSessionKey = storageSessionKeyForState(state, sessionKey);
      const session = normalizeStoredSession(store.sessions[storeSessionKey]);
      if (!session?.queue?.length) {
        return;
      }
      const queue = session.queue.filter((item) => item.id !== id);
      if (!session.draft && queue.length === 0 && session.queuePaused !== true) {
        delete store.sessions[storeSessionKey];
      } else {
        store.sessions[storeSessionKey] = {
          ...(session.draft ? { draft: session.draft } : {}),
          ...(queue.length ? { queue } : {}),
          ...(session.queuePaused ? { queuePaused: true } : {}),
          updatedAt: Date.now(),
        };
      }
      writeInMemoryComposerStore(state, store);
      return;
    }
    const store = readStoreForState(storage, key);
    const storeSessionKey = storageSessionKeyForState(state, sessionKey);
    const session = normalizeStoredSession(store.sessions[storeSessionKey]);
    if (!session?.queue?.length) {
      return;
    }
    const queue = session.queue.filter((item) => item.id !== id);
    if (!session.draft && queue.length === 0 && session.queuePaused !== true) {
      delete store.sessions[storeSessionKey];
    } else {
      store.sessions[storeSessionKey] = {
        ...(session.draft ? { draft: session.draft } : {}),
        ...(queue.length ? { queue } : {}),
        ...(session.queuePaused ? { queuePaused: true } : {}),
        updatedAt: Date.now(),
      };
    }
    writeStore(storage, key, store);
    if (hasUnresolvedPreHelloIdentity(state)) {
      writeInMemoryComposerStore(state, store);
    }
  } catch {
    // Best-effort only: queue persistence must not make cancellation fail.
  }
}

export function persistStoredChatComposerQueue(
  state: Pick<
    ChatComposerPersistenceState,
    | "settings"
    | "password"
    | "assistantAgentId"
    | "agentsList"
    | "hello"
    | "chatComposerPersistenceSuspended"
  >,
  sessionKey: string,
  queue: ChatQueueItem[],
  queuePaused?: boolean,
  options: PersistChatComposerStateOptions = {},
): boolean {
  if (state.chatComposerPersistenceSuspended) {
    return false;
  }
  const storage = getSafeSessionStorage();
  if (!sessionKey.trim()) {
    return false;
  }
  const key = storage ? storageKeyForState(state) : null;
  if (!storage || !key) {
    const store = inMemoryComposerStoreForState(state, true);
    if (!store) {
      return false;
    }
    const storeSessionKey = storageSessionKeyForState(state, sessionKey);
    const session = normalizeStoredSession(store.sessions[storeSessionKey]);
    const requireComplete = options.requireComplete === true;
    const localQueue = queue.filter(isRecoverableQueueItem);
    const queuedForStorage = requireComplete
      ? localQueue
      : localQueue.slice(0, MAX_STORED_QUEUE_ITEMS);
    const serializedQueue = serializeQueueForStorage(queuedForStorage);
    if (
      (requireComplete && localQueue.length > MAX_STORED_QUEUE_ITEMS) ||
      (requireComplete && serializedQueue.length !== localQueue.length)
    ) {
      return false;
    }
    const nextQueuePaused = queuePaused ?? session?.queuePaused === true;
    const nextDraft = Object.hasOwn(options, "draft")
      ? (options.draft ?? "")
      : (session?.draft ?? "");
    if (!nextDraft && serializedQueue.length === 0 && !nextQueuePaused) {
      delete store.sessions[storeSessionKey];
    } else {
      store.sessions[storeSessionKey] = {
        ...(nextDraft ? { draft: nextDraft } : {}),
        ...(serializedQueue.length ? { queue: serializedQueue } : {}),
        ...(nextQueuePaused ? { queuePaused: true } : {}),
        updatedAt: Date.now(),
      };
    }
    writeInMemoryComposerStore(state, store);
    return true;
  }
  if (!key) {
    return false;
  }
  let previousRaw: string | null = null;
  let previousRawCaptured = false;
  let persisted: boolean;
  try {
    previousRaw = storage.getItem(key);
    previousRawCaptured = true;
    const store = readStoreForState(storage, key);
    const storeSessionKey = storageSessionKeyForState(state, sessionKey);
    const session = normalizeStoredSession(store.sessions[storeSessionKey]);
    const requireComplete = options.requireComplete === true;
    // In-flight direct sends are already owned by the Gateway and cannot be
    // replayed safely; strict pause persistence only needs recoverable items.
    const localQueue = queue.filter(isRecoverableQueueItem);
    const queueSource = requireComplete ? localQueue : localQueue.slice(0, MAX_STORED_QUEUE_ITEMS);
    const serializedQueue = serializeQueueForStorage(queueSource);
    if (
      requireComplete &&
      (localQueue.length > MAX_STORED_QUEUE_ITEMS || serializedQueue.length !== localQueue.length)
    ) {
      throw new Error("composer queue cannot be persisted completely");
    }
    const nextQueuePaused = queuePaused ?? session?.queuePaused === true;
    const nextDraft = Object.hasOwn(options, "draft")
      ? (options.draft ?? "")
      : (session?.draft ?? "");
    if (!nextDraft && serializedQueue.length === 0 && !nextQueuePaused) {
      delete store.sessions[storeSessionKey];
    } else {
      store.sessions[storeSessionKey] = {
        ...(nextDraft ? { draft: nextDraft } : {}),
        ...(serializedQueue.length ? { queue: serializedQueue } : {}),
        ...(nextQueuePaused ? { queuePaused: true } : {}),
        updatedAt: Date.now(),
      };
    }
    writeStore(storage, key, store);
    if (!requireComplete) {
      if (hasUnresolvedPreHelloIdentity(state)) {
        writeInMemoryComposerStore(state, store);
      }
      return true;
    }
    const persistedSession = readStoreForState(storage, key).sessions[storeSessionKey];
    const persistedIds = persistedSession?.queue?.map((item) => item.id) ?? [];
    persisted =
      (persistedSession?.draft ?? "") === nextDraft &&
      persistedIds.length === serializedQueue.length &&
      persistedIds.every((id, index) => id === serializedQueue[index]?.id) &&
      (persistedSession?.queuePaused === true) === nextQueuePaused;
    if (persisted && hasUnresolvedPreHelloIdentity(state)) {
      writeInMemoryComposerStore(state, store);
    }
  } catch {
    persisted = false;
  }
  if (!persisted && previousRawCaptured) {
    try {
      if (previousRaw === null) {
        storage.removeItem(key);
      } else {
        storage.setItem(key, previousRaw);
      }
    } catch {
      // Best-effort rollback; the caller still receives the failed result.
    }
  }
  return persisted;
}

export function persistStoredChatComposerSet(
  state: Pick<
    ChatComposerPersistenceState,
    | "settings"
    | "password"
    | "assistantAgentId"
    | "agentsList"
    | "hello"
    | "chatComposerPersistenceSuspended"
  >,
  updates: readonly StoredChatComposerUpdate[],
): boolean {
  if (state.chatComposerPersistenceSuspended) {
    return updates.every(
      (update) =>
        !update.draft &&
        update.queue.filter((item) => !item.serverTurnId).length === 0 &&
        !update.queuePaused,
    );
  }
  const storage = getSafeSessionStorage();
  if (updates.length === 0) {
    return true;
  }
  if (updates.some((update) => !update.sessionKey.trim())) {
    return updates.every(
      (update) =>
        !update.draft &&
        update.queue.filter((item) => !item.serverTurnId).length === 0 &&
        !update.queuePaused,
    );
  }

  const key = storage ? storageKeyForState(state) : null;
  if (!storage || !key) {
    const store = inMemoryComposerStoreForState(state, true);
    if (!store) {
      return updates.every(
        (update) =>
          !update.draft &&
          update.queue.filter((item) => !item.serverTurnId).length === 0 &&
          !update.queuePaused,
      );
    }
    const candidateStore: StoredComposerState = {
      version: 1,
      sessions: { ...store.sessions },
    };
    const expected = new Map<
      string,
      { draft: string; queue: ChatQueueItem[]; queuePaused: boolean }
    >();
    for (const update of updates) {
      const storeSessionKey = storageSessionKeyForState(state, update.sessionKey);
      const localQueue = update.queue.filter(isRecoverableQueueItem);
      const serializedQueue = serializeQueueForStorage(localQueue);
      if (
        localQueue.length > MAX_STORED_QUEUE_ITEMS ||
        serializedQueue.length !== localQueue.length
      ) {
        return false;
      }
      const currentSession = normalizeStoredSession(candidateStore.sessions[storeSessionKey]);
      const draft = Object.hasOwn(update, "draft")
        ? (update.draft ?? "")
        : (currentSession?.draft ?? "");
      if (!draft && serializedQueue.length === 0 && !update.queuePaused) {
        delete candidateStore.sessions[storeSessionKey];
      } else {
        candidateStore.sessions[storeSessionKey] = {
          ...(draft ? { draft } : {}),
          ...(serializedQueue.length ? { queue: serializedQueue } : {}),
          ...(update.queuePaused ? { queuePaused: true } : {}),
          updatedAt: Date.now(),
        };
      }
      expected.set(storeSessionKey, {
        draft,
        queue: serializedQueue,
        queuePaused: update.queuePaused,
      });
    }
    writeInMemoryComposerStore(state, candidateStore, Number.POSITIVE_INFINITY);
    const persistedStore = inMemoryComposerStoreForState(state);
    const committed = [...expected].every(([storeSessionKey, expectedSession]) => {
      const persisted = persistedStore?.sessions[storeSessionKey];
      const persistedIds = persisted?.queue?.map((item) => item.id) ?? [];
      return (
        persistedIds.length === expectedSession.queue.length &&
        persistedIds.every((id, index) => id === expectedSession.queue[index]?.id) &&
        (persisted?.draft ?? "") === expectedSession.draft &&
        (persisted?.queuePaused === true) === expectedSession.queuePaused
      );
    });
    if (!committed) {
      writeInMemoryComposerStore(state, store, Number.POSITIVE_INFINITY);
    }
    return committed;
  }
  let previousRaw: string | null = null;
  let previousRawCaptured = false;
  let committed: boolean;
  let restorationPassed = true;
  try {
    previousRaw = storage.getItem(key);
    previousRawCaptured = true;
    const currentStore = readStoreForState(storage, key);
    const candidateStore: StoredComposerState = {
      version: 1,
      sessions: { ...currentStore.sessions },
    };
    const expected = new Map<
      string,
      { draft: string; queue: ChatQueueItem[]; queuePaused: boolean }
    >();

    for (const update of updates) {
      const storeSessionKey = storageSessionKeyForState(state, update.sessionKey);
      if (expected.has(storeSessionKey)) {
        throw new Error("duplicate composer session update");
      }
      const localQueue = update.queue.filter(isRecoverableQueueItem);
      const serializedQueue = serializeQueueForStorage(localQueue);
      if (
        localQueue.length > MAX_STORED_QUEUE_ITEMS ||
        serializedQueue.length !== localQueue.length
      ) {
        throw new Error("composer queue cannot be persisted completely");
      }
      const currentSession = normalizeStoredSession(candidateStore.sessions[storeSessionKey]);
      const draft = Object.hasOwn(update, "draft")
        ? (update.draft ?? "")
        : (currentSession?.draft ?? "");
      if (!draft && serializedQueue.length === 0 && !update.queuePaused) {
        delete candidateStore.sessions[storeSessionKey];
      } else {
        candidateStore.sessions[storeSessionKey] = {
          ...(draft ? { draft } : {}),
          ...(serializedQueue.length ? { queue: serializedQueue } : {}),
          ...(update.queuePaused ? { queuePaused: true } : {}),
          updatedAt: Date.now(),
        };
      }
      expected.set(storeSessionKey, {
        draft,
        queue: serializedQueue,
        queuePaused: update.queuePaused,
      });
    }

    writeStore(storage, key, candidateStore);
    const persistedStore = readStoreForState(storage, key);
    committed = [...expected].every(([storeSessionKey, expectedSession]) => {
      const persisted = persistedStore.sessions[storeSessionKey];
      const persistedIds = persisted?.queue?.map((item) => item.id) ?? [];
      return (
        persistedIds.length === expectedSession.queue.length &&
        persistedIds.every((id, index) => id === expectedSession.queue[index]?.id) &&
        (persisted?.draft ?? "") === expectedSession.draft &&
        (persisted?.queuePaused === true) === expectedSession.queuePaused
      );
    });
    if (committed && hasUnresolvedPreHelloIdentity(state)) {
      writeInMemoryComposerStore(state, candidateStore, Number.POSITIVE_INFINITY);
    }
  } catch {
    committed = false;
  }

  if (!committed && previousRawCaptured) {
    try {
      if (previousRaw === null) {
        storage.removeItem(key);
      } else {
        storage.setItem(key, previousRaw);
      }
    } catch {
      restorationPassed = false;
    }
  }
  return committed && restorationPassed;
}

export function restoreChatComposerState(
  state: ChatComposerPersistenceState,
  options: RestoreOptions = {},
): boolean {
  const sessionKey = options.sessionKey ?? state.sessionKey;
  let snapshot = loadChatComposerSnapshot(state, sessionKey);
  if (!snapshot) {
    recoverLegacyChatComposerStateIfConfirmed(state, options.confirmLegacyRecovery);
    snapshot = loadChatComposerSnapshot(state, sessionKey);
  }
  const rememberedPause = state.chatQueuePausedBySession?.[sessionKey];
  if (!snapshot) {
    if (rememberedPause !== undefined) {
      state.chatQueuePaused = rememberedPause;
    } else if (!options.preserveCurrentQueuePaused) {
      state.chatQueuePaused = false;
    }
    if (state.chatQueuePausedBySession) {
      state.chatQueuePausedBySession = {
        ...state.chatQueuePausedBySession,
        [sessionKey]: state.chatQueuePaused === true,
      };
    }
    return false;
  }
  if (!options.preserveCurrent || !state.chatMessage) {
    state.chatMessage = snapshot.draft;
  }
  if ((!options.preserveCurrent && snapshot.queue.length > 0) || state.chatQueue.length === 0) {
    state.chatQueue = snapshot.queue;
  }
  if (rememberedPause !== undefined) {
    state.chatQueuePaused = rememberedPause;
  } else if (!options.preserveCurrentQueuePaused) {
    state.chatQueuePaused = snapshot.queuePaused === true;
  }
  if (state.chatQueuePausedBySession) {
    state.chatQueuePausedBySession = {
      ...state.chatQueuePausedBySession,
      [sessionKey]: state.chatQueuePaused === true,
    };
  }
  return true;
}
