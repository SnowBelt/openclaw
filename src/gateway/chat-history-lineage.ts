import type { SessionEntry } from "../config/sessions/types.js";
import {
  attachOpenClawTranscriptMeta,
  readSessionMessagesPageWithStatsAsync,
} from "./session-transcript-readers.js";

type ChatHistoryLineagePage = {
  messages: unknown[];
  totalMessages: number;
};

type ChatHistoryLineageSegment = {
  messageCount: number;
  sessionId: string;
  startSeq: number;
};

function resolveLineageSessionIds(entry: SessionEntry | undefined, sessionId: string): string[] {
  const ids: string[] = [];
  for (const candidate of entry?.usageFamilySessionIds ?? []) {
    const normalized = candidate.trim();
    if (normalized && normalized !== sessionId && !ids.includes(normalized)) {
      ids.push(normalized);
    }
  }
  ids.push(sessionId);
  const rootSessionId = entry?.chatHistoryLineageRootSessionId?.trim();
  if (!rootSessionId) {
    return ids;
  }
  const rootIndex = ids.indexOf(rootSessionId);
  return rootIndex >= 0 ? ids.slice(rootIndex) : [sessionId];
}

export function hasChatHistoryLineage(entry: SessionEntry | undefined, sessionId: string): boolean {
  return resolveLineageSessionIds(entry, sessionId).length > 1;
}

async function resolveLineageSegments(params: {
  agentId: string;
  canonicalKey: string;
  entry: SessionEntry | undefined;
  sessionId: string;
  storePath: string;
}): Promise<ChatHistoryLineageSegment[]> {
  const counts = await Promise.all(
    resolveLineageSessionIds(params.entry, params.sessionId).map(async (lineageSessionId) => {
      const page = await readSessionMessagesPageWithStatsAsync(
        {
          agentId: params.agentId,
          sessionEntry: params.entry,
          sessionId: lineageSessionId,
          sessionKey: params.canonicalKey,
          storePath: params.storePath,
        },
        {
          offset: 0,
          maxMessages: 0,
          allowResetArchiveFallback: true,
        },
      );
      return { messageCount: page.totalMessages, sessionId: lineageSessionId };
    }),
  );
  let startSeq = 0;
  return counts.map((count) => {
    const segment = {
      messageCount: count.messageCount,
      sessionId: count.sessionId,
      startSeq,
    };
    startSeq += count.messageCount;
    return segment;
  });
}

/**
 * Reads one newest-first offset page across internal session-id rotations.
 * Global sequence numbers keep the existing numeric cursor valid even though
 * each transcript starts its own local sequence at one.
 */
export async function readChatHistoryLineagePage(params: {
  agentId: string;
  canonicalKey: string;
  entry: SessionEntry | undefined;
  maxMessages: number;
  offset: number;
  sessionId: string;
  storePath: string;
}): Promise<ChatHistoryLineagePage> {
  const segments = await resolveLineageSegments(params);
  const totalMessages = segments.reduce((total, segment) => total + segment.messageCount, 0);
  const endExclusive = Math.max(0, totalMessages - Math.min(params.offset, totalMessages));
  const start = Math.max(0, endExclusive - Math.max(0, params.maxMessages));
  const pages = await Promise.all(
    segments.map(async (segment) => {
      const segmentEnd = segment.startSeq + segment.messageCount;
      const overlapStart = Math.max(start, segment.startSeq);
      const overlapEnd = Math.min(endExclusive, segmentEnd);
      if (overlapStart >= overlapEnd) {
        return [];
      }
      const localEnd = overlapEnd - segment.startSeq;
      const page = await readSessionMessagesPageWithStatsAsync(
        {
          agentId: params.agentId,
          sessionEntry: params.entry,
          sessionId: segment.sessionId,
          sessionKey: params.canonicalKey,
          storePath: params.storePath,
        },
        {
          offset: segment.messageCount - localEnd,
          maxMessages: overlapEnd - overlapStart,
          allowResetArchiveFallback: true,
        },
      );
      return page.messages.map((message) => {
        const localSeq =
          message && typeof message === "object" && !Array.isArray(message)
            ? (message as { __openclaw?: { seq?: unknown } })["__openclaw"]?.seq
            : undefined;
        return typeof localSeq === "number"
          ? attachOpenClawTranscriptMeta(message, { seq: segment.startSeq + localSeq })
          : message;
      });
    }),
  );
  return { messages: pages.flat(), totalMessages };
}
