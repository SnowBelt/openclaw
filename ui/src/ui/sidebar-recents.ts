import type { GatewaySessionRow } from "./types.ts";

export const DEFAULT_RECENT_CHAT_LIMIT = 9;

/**
 * Keeps pinned chats visible, then the newest unpinned chats, while retaining
 * the selected chat even when it falls outside the normal recent limit.
 */
export function selectSidebarRecentSessions(
  rows: readonly GatewaySessionRow[],
  selectedKey: string,
  unpinnedLimit = DEFAULT_RECENT_CHAT_LIMIT,
): GatewaySessionRow[] {
  const byMostRecent = (a: GatewaySessionRow, b: GatewaySessionRow) =>
    (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  const pinned = rows
    .filter((row) => row.pinned)
    .toSorted((a, b) => (b.pinnedAt ?? b.updatedAt ?? 0) - (a.pinnedAt ?? a.updatedAt ?? 0));
  const unpinned = rows
    .filter((row) => !row.pinned)
    .toSorted(byMostRecent)
    .slice(0, Math.max(0, unpinnedLimit));
  const selected = rows.find((row) => row.key === selectedKey);
  const combined = [...pinned, ...unpinned];
  if (selected && !combined.some((row) => row.key === selected.key)) {
    combined.push(selected);
  }
  return combined;
}
