import {
  buildPccAttentionInbox,
  buildPccDependencyInsights,
  buildPccMilestoneReadiness,
  buildPccProofFreshness,
  buildPccRecoveryPlaybooks,
  previewPccProjectImport,
  type PccImpactDetailInput,
} from "../../src/pcc/impact-milestones.js";

const now = "2026-07-01T12:00:00.000Z";
const detail: PccImpactDetailInput = {
  project: {
    id: "pcc-smoke",
    title: "Project Command Center Smoke",
    goal: "Goal: verify impact milestone controls.",
    status: "active",
    createdAt: now,
    updatedAt: now,
    metadata: { intakeApproved: true, workflowTemplateId: "software_product" },
  },
  milestones: [
    {
      id: "m-ready",
      projectId: "pcc-smoke",
      title: "Ready local work",
      status: "active",
      order: 1,
      implementationPlan: "Run local proof.",
      acceptanceCriteria: ["Proof exits zero"],
      requiredEvidenceIds: ["ev-ready"],
      createdAt: now,
      updatedAt: now,
      metadata: { pccResponsibility: "local_model", pccProofLevel: "local" },
    },
    {
      id: "m-remote",
      projectId: "pcc-smoke",
      title: "Remote proof",
      status: "needs_approval",
      order: 2,
      permissionGrantIds: ["perm-remote"],
      blocker: "Remote proof permission missing",
      createdAt: now,
      updatedAt: now,
      metadata: { pccResponsibility: "remote_proof", pccProofLevel: "remote" },
    },
  ],
  subMilestones: [
    {
      id: "s-ready",
      projectId: "pcc-smoke",
      milestoneId: "m-ready",
      title: "Run local proof",
      status: "active",
      order: 1,
      implementationPlan: "Run targeted proof.",
      acceptanceCriteria: ["Command exits zero"],
      createdAt: now,
      updatedAt: now,
    },
  ],
  permissions: [
    {
      id: "perm-remote",
      projectId: "pcc-smoke",
      milestoneId: "m-remote",
      type: "remote_proof",
      status: "needed",
      riskLevel: "medium",
      allowedActions: ["run workflow"],
      usedCount: 0,
      auditLog: [],
      createdAt: now,
      updatedAt: now,
    },
  ],
  evidence: [],
  receipts: [],
  summary: {
    id: "pcc-smoke",
    title: "Project Command Center Smoke",
    status: "active",
    percentComplete: 30,
    milestoneCounts: {
      total: 2,
      complete: 0,
      blocked: 0,
      needsApproval: 1,
      deferred: 0,
      skipped: 0,
    },
    nextActions: ["Run local proof"],
    proofGaps: ["Remote proof missing"],
    updatedAt: now,
  },
};

const readiness = buildPccMilestoneReadiness(detail);
const inbox = buildPccAttentionInbox([detail]);
const freshness = buildPccProofFreshness(detail);
const recovery = buildPccRecoveryPlaybooks(detail);
const dependency = buildPccDependencyInsights(detail);
const preview = previewPccProjectImport(
  `# Imported Project\nGoal: ship it\n1. Intake\nMilestone: Runtime proof\nAcceptance: proof passes`,
);

const checks: [boolean, string][] = [
  [!readiness.some((item) => item.badge === "Ready for local model"), "missing local readiness"],
  [!inbox.some((item) => item.category === "permission"), "missing permission inbox item"],
  [!freshness.some((item) => item.status === "missing"), "missing proof freshness gap"],
  [!recovery.some((item) => item.id === "permission"), "missing permission recovery playbook"],
  [dependency.criticalPathTitle !== "Run local proof", "unexpected critical path"],
  [
    preview.proposedMilestones.length !== 2 || preview.missingFields.length !== 0,
    "import preview failed",
  ],
];
const failures = checks.flatMap(([failed, message]) => (failed ? [message] : []));

console.log(
  JSON.stringify({ readiness, inbox, freshness, recovery, dependency, preview }, null, 2),
);
if (failures.length) {
  console.error(`PCC impact milestones smoke failed: ${failures.join(", ")}`);
  process.exit(1);
}
