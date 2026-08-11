import { describe, expect, it } from "vitest";
import type {
  PccMilestone,
  PccSubMilestone,
} from "../../../packages/gateway-protocol/src/schema/types.js";
import {
  isPccBlockedStatus,
  isPccCompleteStatus,
  isPccSkippedStatus,
  isPccTerminalStatus,
  isPccWaitingStatus,
  pccMilestonePercent,
  pccSubMilestonesAreComplete,
  pccSubMilestonePercent,
} from "./completion-policy.js";

const timestamp = "2026-07-15T12:00:00.000Z";

function subMilestone(
  status: PccSubMilestone["status"],
  percentComplete?: number,
): PccSubMilestone {
  return {
    id: `sub-${status}`,
    projectId: "project-1",
    milestoneId: "milestone-1",
    title: status,
    status,
    order: 0,
    ...(percentComplete === undefined ? {} : { percentComplete }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function milestone(status: PccMilestone["status"], percentComplete?: number): PccMilestone {
  return {
    id: "milestone-1",
    projectId: "project-1",
    title: "Milestone",
    status,
    order: 0,
    ...(percentComplete === undefined ? {} : { percentComplete }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("PCC completion policy", () => {
  it("classifies statuses through one domain policy", () => {
    expect(isPccCompleteStatus("complete_with_maintenance")).toBe(true);
    expect(isPccBlockedStatus("failed")).toBe(true);
    expect(isPccWaitingStatus("needs_approval")).toBe(true);
    expect(isPccSkippedStatus("archived")).toBe(true);
    expect(isPccTerminalStatus("complete")).toBe(true);
    expect(isPccTerminalStatus("active")).toBe(false);
  });

  it("preserves partial, complete, and skipped progress semantics", () => {
    expect(pccSubMilestonePercent(subMilestone("in_progress"))).toBe(40);
    expect(pccSubMilestonePercent(subMilestone("active", 55))).toBe(55);
    expect(pccSubMilestonePercent(subMilestone("complete"))).toBe(100);
    expect(pccSubMilestonePercent(subMilestone("skipped", 80))).toBe(0);
  });

  it("requires every non-skipped sub-milestone to be complete", () => {
    expect(
      pccSubMilestonesAreComplete([
        subMilestone("complete"),
        subMilestone("complete_with_maintenance"),
        subMilestone("skipped"),
      ]),
    ).toBe(true);
    expect(
      pccSubMilestonesAreComplete([subMilestone("complete"), subMilestone("in_progress")]),
    ).toBe(false);
  });

  it("computes milestone progress without storage or gateway dependencies", () => {
    expect(
      pccMilestonePercent({
        milestone: milestone("complete"),
        subMilestones: [],
        hasCompletionReceipt: true,
      }),
    ).toBe(100);
    expect(
      pccMilestonePercent({
        milestone: milestone("complete"),
        subMilestones: [],
        hasCompletionReceipt: false,
      }),
    ).toBe(0);
    expect(
      pccMilestonePercent({
        milestone: milestone("active"),
        subMilestones: [subMilestone("complete"), subMilestone("in_progress")],
        hasCompletionReceipt: false,
      }),
    ).toBe(70);
  });
});
