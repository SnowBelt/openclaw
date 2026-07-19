import { describe, expect, it } from "vitest";
import {
  assessControlDirectorMemoryHealth,
  rebuildControlDirectorMemoryIndex,
  removeControlDirectorMemorySource,
  searchControlDirectorMemoryIndex,
  verifyControlDirectorMemoryRecord,
} from "./control-director-memory-index.js";

const DAY = 24 * 60 * 60 * 1_000;

describe("Control Director tiered memory projection", () => {
  it("keeps recent detail hot, compresses warm summaries, and stores cold references only", () => {
    const now = 100 * DAY;
    const records = rebuildControlDirectorMemoryIndex({
      agentId: "director",
      now,
      sources: [
        {
          sourceType: "task",
          sourceId: "hot",
          agentId: "director",
          title: "Yesterday deployment",
          summary: "x".repeat(600),
          updatedAt: now - DAY,
        },
        {
          sourceType: "flow",
          sourceId: "warm",
          agentId: "director",
          title: "Two week project",
          summary: "y".repeat(600),
          updatedAt: now - 14 * DAY,
        },
        {
          sourceType: "session",
          sourceId: "cold",
          agentId: "director",
          title: "Old archived discussion",
          summary: "must not be copied into cold storage",
          updatedAt: now - 60 * DAY,
        },
      ],
    });
    expect(records.map((record) => record.tier)).toEqual(["hot", "warm", "cold"]);
    expect(records[0]?.summary).toHaveLength(500);
    expect(records[1]?.summary).toHaveLength(220);
    expect(records[2]?.summary).toBeUndefined();
    expect(records.every(verifyControlDirectorMemoryRecord)).toBe(true);
  });

  it("returns Top-3 relevant owner records and ignores another agent or corrupted provenance", () => {
    const records = rebuildControlDirectorMemoryIndex({
      agentId: "director",
      now: 10_000,
      sources: Array.from({ length: 5 }, (_, index) => ({
        sourceType: "task" as const,
        sourceId: `task-${index}`,
        agentId: "director",
        title: index < 4 ? `Kalshi clean data ${index}` : "Unrelated book",
        updatedAt: 9_000 - index,
      })),
    });
    const corrupt = { ...records[0]!, title: "tampered" };
    const result = searchControlDirectorMemoryIndex({
      records: [corrupt, ...records.slice(1)],
      query: "recent Kalshi clean data",
      agentId: "director",
      topK: 3,
    });
    expect(result).toHaveLength(3);
    expect(result.every((record) => record.title.includes("Kalshi"))).toBe(true);
    expect(result).not.toContainEqual(corrupt);
  });

  it("removes deleted sources and rebuilds deterministically", () => {
    const sources = [
      {
        sourceType: "session" as const,
        sourceId: "session-1",
        agentId: "director",
        title: "Private session",
        updatedAt: 100,
      },
    ];
    const first = rebuildControlDirectorMemoryIndex({ sources, agentId: "director", now: 200 });
    const second = rebuildControlDirectorMemoryIndex({ sources, agentId: "director", now: 200 });
    expect(first).toEqual(second);
    expect(removeControlDirectorMemorySource(first, "session", "session-1")).toEqual([]);
  });

  it("reports freshness, corruption, and same-version source conflicts with repair actions", () => {
    const now = 100 * DAY;
    const sources = [
      {
        sourceType: "task" as const,
        sourceId: "today",
        agentId: "director",
        title: "Current work",
        updatedAt: now,
      },
      {
        sourceType: "task" as const,
        sourceId: "conflict",
        agentId: "director",
        title: "First truth",
        updatedAt: now - 1,
      },
      {
        sourceType: "task" as const,
        sourceId: "conflict",
        agentId: "director",
        title: "Second truth",
        updatedAt: now - 1,
      },
    ];
    const records = rebuildControlDirectorMemoryIndex({ sources, agentId: "director", now });
    const corrupt = [{ ...records[0]!, title: "tampered" }, ...records.slice(1)];
    expect(
      assessControlDirectorMemoryHealth({ records: corrupt, sources, agentId: "director", now }),
    ).toMatchObject({
      status: "corrupt",
      currentDaySourceCount: 1,
      corruptRecordCount: 1,
      sourceConflictCount: 1,
      repairActions: ["rebuild_index", "resolve_source_conflicts"],
    });
  });

  it("marks an old index stale without treating newer source versions as conflicts", () => {
    const now = 100 * DAY;
    const sources = [
      {
        sourceType: "flow" as const,
        sourceId: "same",
        agentId: "director",
        title: "Old version",
        updatedAt: now - 10 * DAY,
      },
      {
        sourceType: "flow" as const,
        sourceId: "same",
        agentId: "director",
        title: "Newer version",
        updatedAt: now - 9 * DAY,
      },
    ];
    const records = rebuildControlDirectorMemoryIndex({ sources, agentId: "director", now });
    expect(
      assessControlDirectorMemoryHealth({ records, sources, agentId: "director", now }),
    ).toMatchObject({
      status: "stale",
      currentDaySourceCount: 0,
      corruptRecordCount: 0,
      sourceConflictCount: 0,
      repairActions: ["refresh_recent_sources"],
    });
  });
});
