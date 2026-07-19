import { describe, expect, it } from "vitest";
import { selectSidebarRecentSessions } from "./sidebar-recents.ts";
import type { GatewaySessionRow } from "./types.ts";

function row(
  key: string,
  updatedAt: number,
  overrides: Partial<GatewaySessionRow> = {},
): GatewaySessionRow {
  return { ...overrides, key, kind: overrides.kind ?? "direct", updatedAt };
}

describe("selectSidebarRecentSessions", () => {
  it("orders pinned chats first and limits only unpinned chats", () => {
    const selected = selectSidebarRecentSessions(
      [
        row("older", 1),
        row("newer", 3),
        row("pinned-old", 2, { pinned: true, pinnedAt: 5 }),
        row("pinned-new", 0, { pinned: true, pinnedAt: 8 }),
      ],
      "newer",
      1,
    );

    expect(selected.map((entry) => entry.key)).toEqual(["pinned-new", "pinned-old", "newer"]);
  });

  it("retains the selected chat outside the recent limit without duplicating it", () => {
    const rows = [row("newest", 3), row("middle", 2), row("selected", 1)];

    expect(selectSidebarRecentSessions(rows, "selected", 1).map((entry) => entry.key)).toEqual([
      "newest",
      "selected",
    ]);
    expect(selectSidebarRecentSessions(rows, "newest", 1).map((entry) => entry.key)).toEqual([
      "newest",
    ]);
  });
});
