// Queue store owns session-scoped Chat queue state and persistence.
import type { ChatQueueItem } from "../ui-types.ts";
import { persistStoredChatComposerQueue } from "./composer-persistence.ts";

type ChatQueueStoreHost = Parameters<typeof persistStoredChatComposerQueue>[0] & {
  sessionKey: string;
  chatQueue: ChatQueueItem[];
  chatQueueBySession?: Record<string, ChatQueueItem[]>;
  requestUpdate?: () => void;
};

export function readChatQueueForSession(
  host: ChatQueueStoreHost,
  sessionKey: string,
): ChatQueueItem[] {
  return sessionKey === host.sessionKey
    ? host.chatQueue
    : (host.chatQueueBySession?.[sessionKey] ?? []);
}

export function writeChatQueueForSession(
  host: ChatQueueStoreHost,
  sessionKey: string,
  queue: ChatQueueItem[],
): void {
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

export function updateQueuedMessageForSession(
  host: ChatQueueStoreHost,
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

export function persistQueuedMessagesForSession(
  host: ChatQueueStoreHost,
  sessionKey: string,
): void {
  persistStoredChatComposerQueue(host, sessionKey, readChatQueueForSession(host, sessionKey));
}

export function removeQueuedMessageWithoutReleasing(
  host: ChatQueueStoreHost,
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

export function removeVisibleOrScopedQueuedMessageWithoutReleasing(
  host: ChatQueueStoreHost,
  id: string,
  sessionKey: string | undefined,
): ChatQueueItem | null {
  return (
    removeQueuedMessageWithoutReleasing(host, id) ??
    (sessionKey ? removeQueuedMessageWithoutReleasing(host, id, sessionKey) : null)
  );
}

function chatQueueCollections(host: ChatQueueStoreHost): ChatQueueItem[][] {
  return [host.chatQueue, ...Object.values(host.chatQueueBySession ?? {})];
}

export function hasReconnectableQueuedChatSends(host: ChatQueueStoreHost): boolean {
  return chatQueueCollections(host).some((queue) =>
    queue.some((item) => item.sendRunId && item.sendState === "waiting-reconnect"),
  );
}

export function markQueuedChatSendsWaitingForReconnect(host: ChatQueueStoreHost): void {
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
