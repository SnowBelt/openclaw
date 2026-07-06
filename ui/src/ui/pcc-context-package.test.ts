import { describe, expect, it } from "vitest";
import type { PccProjectDetail } from "./controllers/pcc.ts";
import { buildPccContextPackage } from "./pcc-context-package.ts";

const project = {
  id: "project-1",
  title: "Project Command Center",
  goal: "Keep every AI worker on the exact same plan.",
  status: "active" as const,
  priority: 3,
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const nextMilestone = {
  id: "milestone-1",
  projectId: "project-1",
  title: "Context Package Generation V1",
  status: "not_started" as const,
  order: 1,
  phaseId: "production-proof",
  percentComplete: 0,
  implementationPlan: "Add deterministic handoff packets.",
  acceptanceCriteria: ["Packet includes permissions", "Packet includes proof gaps"],
  requiredEvidenceIds: ["evidence-1"],
  metadata: { pccResponsibility: "local_openclaw_agent", pccCostRisk: "low" },
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const laterMilestone = {
  id: "milestone-2",
  projectId: "project-1",
  title: "Automatic Chat Sync V1",
  status: "not_started" as const,
  order: 2,
  implementationPlan: "Propose PCC diffs from chat.",
  acceptanceCriteria: ["Diff preview required"],
  metadata: { pccResponsibility: "codex", pccCostRisk: "medium" },
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const nextSubMilestone = {
  id: "submilestone-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  title: "Write packet renderer",
  status: "not_started" as const,
  order: 1,
  implementationPlan: "Render the compact packet with exact proof gaps.",
  acceptanceCriteria: ["Packet includes sub-milestone detail"],
  metadata: { pccResponsibility: "local_openclaw_agent", pccCostRisk: "low" },
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const detail: PccProjectDetail = {
  project,
  milestones: [laterMilestone, nextMilestone],
  subMilestones: [nextSubMilestone],
  permissions: [
    {
      id: "permission-1",
      projectId: "project-1",
      milestoneId: "milestone-1",
      type: "remote_proof",
      status: "needed",
      riskLevel: "medium",
      allowedActions: ["run Workflow Sanity"],
      forbiddenActions: ["merge upstream"],
      target: "SnowBelt/openclaw",
      usedCount: 0,
      auditLog: [],
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    },
  ],
  evidence: [
    {
      id: "evidence-2",
      projectId: "project-1",
      milestoneId: "milestone-1",
      kind: "local_test",
      status: "passed",
      summary: "Local context package test passed",
      command: "pnpm test ui/src/ui/pcc-context-package.test.ts",
      exitCode: 0,
      createdAt: "2026-06-26T00:00:00Z",
    },
  ],
  receipts: [
    {
      id: "receipt-1",
      projectId: "project-1",
      milestoneId: "milestone-1",
      summary: "Prior proof completed.",
      proofEvidenceIds: ["evidence-2"],
      proofLevel: "local",
      doNotRedo: ["Do not redo local proof without a regression."],
      followUpGaps: ["Remote proof blocked"],
      completedBy: "Project Command Center",
      completedAt: "2026-06-26T00:00:00Z",
    },
  ],
  summary: {
    id: "project-1",
    title: "Project Command Center",
    status: "active",
    percentComplete: 66,
    milestoneCounts: {
      total: 2,
      complete: 0,
      blocked: 0,
      needsApproval: 1,
      deferred: 0,
      skipped: 0,
    },
    nextActions: ["Build context package"],
    proofGaps: ["Remote proof"],
    updatedAt: "2026-06-26T00:00:00Z",
  },
};

describe("buildPccContextPackage", () => {
  it("builds a compact packet for the next milestone only", () => {
    const packet = buildPccContextPackage(detail, { mode: "compact" });

    expect(packet).toContain("# Project Command Center handoff packet");
    expect(packet).toContain("Project: Project Command Center");
    expect(packet).toContain("Next milestone: Context Package Generation V1");
    expect(packet).toContain("Next sub-milestone: Write packet renderer");
    expect(packet).toContain("Write packet renderer — Not Started");
    expect(packet).toContain("Worker: local_openclaw_agent");
    expect(packet).toContain("Token/cost risk: low");
    expect(packet).toContain("Packet includes permissions");
    expect(packet).toContain("Required evidence missing: evidence-1");
    expect(packet).toContain("Do not redo: Do not redo local proof without a regression.");
    expect(packet).not.toContain("## Milestone: Automatic Chat Sync V1");
  });

  it("builds a full packet with every milestone and execution rules", () => {
    const packet = buildPccContextPackage(detail, { mode: "full" });

    expect(packet).toContain("## Milestone: Context Package Generation V1");
    expect(packet).toContain("Sub-milestones:");
    expect(packet).toContain("## Milestone: Automatic Chat Sync V1");
    expect(packet).toContain("Worker: codex");
    expect(packet).toContain("Stop before Codex");
  });

  it("does not crash when imported legacy receipts are missing proofLevel", () => {
    const legacyDetail: PccProjectDetail = {
      ...detail,
      receipts: [
        {
          id: "receipt-legacy",
          projectId: "project-1",
          milestoneId: "milestone-1",
          summary: "Legacy receipt imported before proofLevel was required.",
          proofEvidenceIds: ["evidence-2"],
          completedBy: "Project Command Center",
          completedAt: "2026-06-26T00:00:00Z",
        } as PccProjectDetail["receipts"][number],
      ],
    };

    const packet = buildPccContextPackage(legacyDetail, { mode: "compact" });

    expect(packet).toContain("Legacy receipt imported before proofLevel was required.");
    expect(packet).toContain("Proof=Not recorded.");
  });
});
