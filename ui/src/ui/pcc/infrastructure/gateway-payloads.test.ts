import { describe, expect, it } from "vitest";
import {
  milestoneUpsertPayload,
  pccOrderForUpsert,
  projectUpsertPayload,
  subMilestoneUpsertPayload,
  temporaryReorderOrder,
} from "./gateway-payloads.ts";

describe("PCC Gateway payload boundary", () => {
  it("omits immutable transport fields from project payloads", () => {
    const payload = projectUpsertPayload({
      id: "project-1",
      title: "Project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(payload).toEqual({ id: "project-1", title: "Project" });
    expect(payload).not.toHaveProperty("createdAt");
    expect(payload).not.toHaveProperty("updatedAt");
  });

  it("normalizes legacy negative orders and preserves valid orders", () => {
    expect(pccOrderForUpsert(3.9, "milestone-1")).toBe(3);
    expect(pccOrderForUpsert(-1, "milestone-1")).toBeGreaterThanOrEqual(2_000_000_000);
    expect(pccOrderForUpsert(undefined, "milestone-1")).toBeUndefined();
    expect(temporaryReorderOrder(2)).toBe(1_000_000_002);
  });

  it("emits schema-safe milestone and sub-milestone payloads", () => {
    const milestone = milestoneUpsertPayload({
      id: "milestone-1",
      projectId: "project-1",
      title: "Milestone",
      order: -5,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const subMilestone = subMilestoneUpsertPayload({
      id: "sub-1",
      projectId: "project-1",
      milestoneId: "milestone-1",
      title: "Sub-milestone",
      order: 4,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(milestone.order).toBeGreaterThanOrEqual(2_000_000_000);
    expect(milestone).not.toHaveProperty("createdAt");
    expect(subMilestone.order).toBe(4);
    expect(subMilestone).not.toHaveProperty("createdAt");
  });
});
