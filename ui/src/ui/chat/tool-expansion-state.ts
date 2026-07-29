// Control UI chat module implements tool expansion state behavior.
import type { ChatItem, MessageGroup } from "../types/chat-types.ts";
import { isToolResultMessage, normalizeRoleForGrouping } from "./role-normalizer.ts";
import { getOrCreateSessionCacheValue } from "./session-cache.ts";
import { extractToolCardsCached } from "./tool-cards.ts";

type ToolExpansionState = {
  autoExpandToolCalls: boolean;
  expanded: Map<string, boolean>;
  items: Array<ChatItem | MessageGroup> | null;
  renderVersion: number;
};

// Keep expansion facts in one LRU entry so eviction cannot split state.
// The version invalidates Lit without sorting every expanded-card id on each render.
const toolExpansionStateBySession = new Map<string, ToolExpansionState>();

function getToolExpansionState(sessionKey: string): ToolExpansionState {
  return getOrCreateSessionCacheValue(toolExpansionStateBySession, sessionKey, () => ({
    autoExpandToolCalls: false,
    expanded: new Map(),
    items: null,
    renderVersion: 0,
  }));
}

export function getExpandedToolCards(sessionKey: string): ReadonlyMap<string, boolean> {
  return getToolExpansionState(sessionKey).expanded;
}

export function getToolExpansionRenderVersion(sessionKey: string): number {
  return getToolExpansionState(sessionKey).renderVersion;
}

export function setToolCardExpanded(
  sessionKey: string,
  toolCardId: string,
  expanded: boolean,
): void {
  const state = getToolExpansionState(sessionKey);
  if (state.expanded.has(toolCardId) && state.expanded.get(toolCardId) === expanded) {
    return;
  }
  state.expanded.set(toolCardId, expanded);
  state.renderVersion++;
}

export function resetToolExpansionStateForTest() {
  toolExpansionStateBySession.clear();
}

export function syncToolCardExpansionState(
  sessionKey: string,
  items: Array<ChatItem | MessageGroup>,
  autoExpandToolCalls: boolean,
) {
  const state = getToolExpansionState(sessionKey);
  if (state.items === items && state.autoExpandToolCalls === autoExpandToolCalls) {
    return;
  }
  const previousAutoExpand = state.autoExpandToolCalls;
  const currentToolCardIds = new Set<string>();
  let changeCount = 0;
  for (const item of items) {
    if (item.kind !== "group") {
      continue;
    }
    for (const entry of item.messages) {
      const cards = extractToolCardsCached(entry.message, entry.key);
      for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
        const disclosureId = `${entry.key}:toolcard:${cardIndex}`;
        currentToolCardIds.add(disclosureId);
        if (state.expanded.has(disclosureId)) {
          continue;
        }
        state.expanded.set(disclosureId, autoExpandToolCalls);
        changeCount++;
      }
      const messageRecord = entry.message as Record<string, unknown>;
      const role = typeof messageRecord.role === "string" ? messageRecord.role : "unknown";
      const normalizedRole = normalizeRoleForGrouping(role);
      const isToolMessage =
        isToolResultMessage(entry.message) ||
        normalizedRole === "tool" ||
        role.toLowerCase() === "toolresult" ||
        role.toLowerCase() === "tool_result" ||
        typeof messageRecord.toolCallId === "string" ||
        typeof messageRecord.tool_call_id === "string";
      if (!isToolMessage) {
        continue;
      }
      const disclosureId = `toolmsg:${entry.key}`;
      currentToolCardIds.add(disclosureId);
      if (state.expanded.has(disclosureId)) {
        continue;
      }
      state.expanded.set(disclosureId, autoExpandToolCalls);
      changeCount++;
    }
  }
  if (autoExpandToolCalls && !previousAutoExpand) {
    for (const toolCardId of currentToolCardIds) {
      if (state.expanded.get(toolCardId) !== true) {
        state.expanded.set(toolCardId, true);
        changeCount++;
      }
    }
  }
  state.autoExpandToolCalls = autoExpandToolCalls;
  state.items = items;
  if (changeCount > 0) {
    state.renderVersion++;
  }
}
