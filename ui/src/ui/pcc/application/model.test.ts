import { describe, expect, it } from "vitest";
import {
  derivePccProgress,
  isPccRunActive,
  pccGoalPrimaryAction,
  selectedProject,
} from "./model.ts";

describe("PCC application model", () => {
  it("prefers the server summary while deriving a fallback from milestones", () => {
    expect(
      derivePccProgress({
        summary: null,
        milestones: [
          {
            id: "m1",
            projectId: "p",
            title: "Done",
            status: "complete",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
          {
            id: "m2",
            projectId: "p",
            title: "Blocked",
            status: "blocked",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    ).toMatchObject({ percent: 50, complete: 1, total: 2, blocked: 1 });
    expect(
      derivePccProgress({
        summary: {
          percentComplete: 25,
          milestoneCounts: {
            total: 4,
            complete: 1,
            blocked: 0,
            needsApproval: 0,
            deferred: 0,
            skipped: 0,
          },
        } as never,
        milestones: [],
      }).percent,
    ).toBe(25);
  });

  it("selects the requested project and falls back safely", () => {
    const projects = [{ id: "p1" }, { id: "p2" }] as never[];
    expect(selectedProject(projects, "p2")?.id).toBe("p2");
    expect(selectedProject(projects, "missing")?.id).toBe("p1");
  });

  it("identifies queued and running planning runs", () => {
    expect(isPccRunActive({ status: "queued" } as never)).toBe(true);
    expect(isPccRunActive({ status: "running" } as never)).toBe(true);
    expect(isPccRunActive({ status: "succeeded" } as never)).toBe(false);
  });

  it("chooses durable lifecycle actions from persisted project state", () => {
    const project = {
      id: "p",
      title: "MVP",
      status: "active",
      metadata: { pccWorkLoop: { state: "paused" } },
    };
    expect(pccGoalPrimaryAction(project as never, null)).toBe("resume");
    expect(pccGoalPrimaryAction(project as never, { status: "running" } as never)).toBe("pause");
    expect(
      pccGoalPrimaryAction(
        { ...project, metadata: { pccWorkLoop: { state: "complete" } } } as never,
        null,
      ),
    ).toBeNull();
  });
});
