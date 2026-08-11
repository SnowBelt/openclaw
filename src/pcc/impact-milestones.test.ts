import { describe, expect, it } from "vitest";
import type {
  PccCompletionReceipt,
  PccEvidence,
  PccMilestone,
  PccPermissionGrant,
  PccProject,
  PccProjectSummary,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";
import {
  buildPccAttentionInbox,
  buildPccDependencyInsights,
  buildPccIntegrityFindings,
  buildPccMilestoneReadiness,
  buildPccProofFreshness,
  buildPccRecoveryPlaybooks,
  buildPccTimeline,
  previewPccProjectImport,
  type PccImpactDetailInput,
} from "./impact-milestones.js";

const now = "2026-07-01T12:00:00.000Z";

const project: PccProject = {
  id: "project-1",
  title: "Project Command Center",
  goal: "Goal: keep AI work organized with proof.",
  status: "active",
  priority: 5,
  createdAt: now,
  updatedAt: now,
  metadata: { intakeApproved: true, workflowTemplateId: "software_product" },
};

const milestones: PccMilestone[] = [
  {
    id: "m1",
    projectId: project.id,
    title: "Ready milestone",
    status: "active",
    order: 1,
    percentComplete: 20,
    implementationPlan: "Run the exact commands and attach proof.",
    acceptanceCriteria: ["Local proof passes"],
    requiredEvidenceIds: ["ev1"],
    createdAt: now,
    updatedAt: now,
    metadata: { pccResponsibility: "local_model", pccProofLevel: "local" },
  },
  {
    id: "m2",
    projectId: project.id,
    title: "Remote proof",
    status: "needs_approval",
    order: 2,
    percentComplete: 0,
    dependsOn: ["m1"],
    blocker: "Remote proof permission missing",
    permissionGrantIds: ["perm1"],
    createdAt: now,
    updatedAt: now,
    metadata: { pccResponsibility: "remote_proof", pccProofLevel: "remote" },
  },
  {
    id: "m3",
    projectId: project.id,
    title: "Completed without receipt",
    status: "complete",
    order: 3,
    percentComplete: 100,
    createdAt: now,
    updatedAt: now,
    metadata: { pccProofLevel: "local" },
  },
];

const subMilestones: PccSubMilestone[] = [
  {
    id: "s1",
    projectId: project.id,
    milestoneId: "m1",
    title: "Run proof",
    status: "active",
    order: 1,
    implementationPlan: "Run test command.",
    acceptanceCriteria: ["Command exits 0"],
    createdAt: now,
    updatedAt: now,
    metadata: { pccResponsibility: "local_model" },
  },
];

const permission: PccPermissionGrant = {
  id: "perm1",
  projectId: project.id,
  milestoneId: "m2",
  type: "remote_proof",
  status: "needed",
  riskLevel: "medium",
  allowedActions: ["run workflow"],
  usedCount: 0,
  auditLog: [],
  createdAt: now,
  updatedAt: now,
};

const evidence: PccEvidence = {
  id: "ev1",
  projectId: project.id,
  milestoneId: "m1",
  kind: "local_test",
  status: "passed",
  summary: "Targeted test passed",
  createdAt: now,
};

const receipt: PccCompletionReceipt = {
  id: "receipt-1",
  projectId: project.id,
  milestoneId: "m1",
  summary: "Ready milestone completed with proof.",
  proofEvidenceIds: ["ev1"],
  proofLevel: "local",
  completedAt: now,
};

const summary: PccProjectSummary = {
  id: project.id,
  title: project.title,
  status: project.status,
  percentComplete: 45,
  milestoneCounts: { total: 3, complete: 1, blocked: 0, needsApproval: 1, deferred: 0, skipped: 0 },
  nextActions: ["Run remote proof"],
  proofGaps: ["Remote proof missing"],
  updatedAt: now,
};

function input(): PccImpactDetailInput {
  return {
    project,
    milestones,
    subMilestones,
    permissions: [permission],
    evidence: [evidence],
    receipts: [receipt],
    summary,
  };
}

describe("PCC impact milestones", () => {
  it("scores low-reasoning readiness and permission blockers", () => {
    const readiness = buildPccMilestoneReadiness(input());
    expect(readiness.find((item) => item.milestoneId === "m1")?.badge).toBe(
      "Ready for local model",
    );
    expect(readiness.find((item) => item.milestoneId === "m2")?.badge).toBe("Needs permission");
    expect(readiness.find((item) => item.milestoneId === "m3")?.gaps).toContain(
      "Completion receipt missing",
    );
  });

  it("builds an attention inbox from permissions, proof gaps, and setup quality", () => {
    const inbox = buildPccAttentionInbox([input()]);
    expect(inbox.some((item) => item.category === "permission")).toBe(true);
    expect(inbox.some((item) => item.category === "proof")).toBe(true);
  });

  it("surfaces plan integrity findings for orphaned children and broken dependencies", () => {
    const brokenInput = {
      ...input(),
      milestones: [
        ...milestones,
        {
          ...milestones[0],
          id: "m4",
          title: "Ready milestone",
          order: 1,
          dependsOn: ["missing-milestone"],
        },
      ],
      subMilestones: [
        ...subMilestones,
        {
          ...subMilestones[0],
          id: "orphan-sub",
          milestoneId: "missing-parent",
          dependsOn: ["missing-item"],
        },
        {
          ...subMilestones[0],
          id: "duplicate-sub-title",
          title: subMilestones[0]?.title ?? "Run proof",
          order: 2,
        },
      ],
      receipts: [
        {
          ...receipt,
          milestoneId: "missing-milestone",
          proofEvidenceIds: ["ev1", "missing-proof"],
        },
      ],
    };

    const findings = buildPccIntegrityFindings(brokenInput);
    expect(findings.map((finding) => finding.title)).toEqual(
      expect.arrayContaining([
        "Receipt references missing milestone: receipt-1",
        "Receipt references missing proof evidence: missing-proof",
        "Orphaned sub-milestone: Run proof",
        "Broken dependency: Ready milestone",
        "Duplicate milestone title: ready milestone",
        "Duplicate milestone order: 1",
        "Duplicate sub-milestone title: run proof",
      ]),
    );
    expect(findings[0]?.severity).toBe("critical");
    expect(
      buildPccAttentionInbox([brokenInput]).some((item) => item.category === "integrity"),
    ).toBe(true);
  });

  it("reports proof freshness and receipt history", () => {
    expect(buildPccProofFreshness(input()).map((item) => item.status)).toContain("missing");
    expect(buildPccTimeline(input())[0]?.summary).toContain("Ready milestone completed");
  });

  it("provides recovery, dependency, and import guidance", () => {
    expect(buildPccRecoveryPlaybooks(input()).map((item) => item.id)).toContain("permission");
    expect(buildPccDependencyInsights(input()).criticalPathTitle).toBe("Run proof");
    const preview = previewPccProjectImport(
      `# New PCC Project\nGoal: finish it\n1. Intake\nMilestone: Proof\nAcceptance: tests pass`,
    );
    expect(preview.proposedMilestones).toEqual(["Intake", "Proof"]);
    expect(preview.missingFields).toEqual([]);
  });
});
