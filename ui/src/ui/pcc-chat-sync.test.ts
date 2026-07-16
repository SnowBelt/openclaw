import { describe, expect, it } from "vitest";
import { buildPccChatSyncProposals } from "./pcc-chat-sync.ts";
import type { PccProjectDetail } from "./pcc/application/state.ts";

const project = {
  id: "project-1",
  title: "Project Command Center",
  goal: "Track project work",
  status: "active" as const,
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const milestone = {
  id: "milestone-1",
  projectId: "project-1",
  title: "Remote Proof Closure",
  status: "proof_pending" as const,
  order: 1,
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const detail: PccProjectDetail = {
  project,
  milestones: [milestone],
  permissions: [],
  evidence: [
    {
      id: "evidence-1",
      projectId: "project-1",
      milestoneId: "milestone-1",
      kind: "local_test",
      status: "passed",
      summary: "Local proof passed",
      createdAt: "2026-06-26T00:00:00Z",
    },
  ],
  receipts: [],
  summary: {
    id: "project-1",
    title: "Project Command Center",
    status: "active",
    percentComplete: 60,
    milestoneCounts: {
      total: 1,
      complete: 0,
      blocked: 0,
      needsApproval: 0,
      deferred: 0,
      skipped: 0,
    },
    nextActions: ["Remote proof"],
    proofGaps: ["GitHub DNS"],
    updatedAt: "2026-06-26T00:00:00Z",
  },
};

describe("buildPccChatSyncProposals", () => {
  it("turns a proposed plan into a new milestone diff", () => {
    const proposals = buildPccChatSyncProposals(
      detail,
      "<proposed_plan>\n# Chat Sync V1\n\nAcceptance criteria:\n- Local proof passes\n</proposed_plan>",
    );

    expect(proposals[0]).toMatchObject({
      kind: "add_milestone",
      title: "Add milestone: Chat Sync V1",
      risky: false,
      milestonePatch: expect.objectContaining({
        title: "Chat Sync V1",
        projectId: "project-1",
      }),
    });
  });

  it("proposes status, permission, and receipt updates without applying them", () => {
    const proposals = buildPccChatSyncProposals(
      detail,
      [
        "Remote Proof Closure — complete",
        "Permission required: push branch and run Workflow Sanity remote proof.",
        "Proof passed. Add a do-not-redo receipt.",
      ].join("\n"),
    );

    expect(proposals.some((proposal) => proposal.kind === "update_milestone")).toBe(true);
    expect(proposals.some((proposal) => proposal.kind === "request_permission")).toBe(true);
    expect(proposals.some((proposal) => proposal.kind === "add_receipt")).toBe(true);
    expect(proposals.find((proposal) => proposal.kind === "update_milestone")?.risky).toBe(true);
  });
});
