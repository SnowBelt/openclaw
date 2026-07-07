import { describe, expect, it } from "vitest";
import type {
  PccCompletionReceipt,
  PccEvidence,
  PccMilestone,
  PccProject,
} from "../../packages/gateway-protocol/src/schema/types.js";
import { buildPccProductionTruth, PCC_LATEST_VERIFIED_SHA } from "./production-truth.js";

const project: PccProject = {
  id: "project-1",
  title: "Project Command Center",
  status: "active",
  createdAt: "2026-06-27T00:00:00Z",
  updatedAt: "2026-06-27T00:00:00Z",
};

function milestone(patch: Partial<PccMilestone> = {}): PccMilestone {
  return {
    id: "milestone-1",
    projectId: "project-1",
    title: "Production proof",
    status: "complete",
    implementationPlan: "Run proof.",
    acceptanceCriteria: ["Remote proof passes"],
    createdAt: "2026-06-27T00:00:00Z",
    updatedAt: "2026-06-27T00:00:00Z",
    metadata: { requiresRemoteProof: true, requiresRuntimeProof: true },
    ...patch,
  };
}

function evidence(kind: PccEvidence["kind"], milestoneId = "milestone-1"): PccEvidence {
  return {
    id: `${kind}-1`,
    projectId: "project-1",
    milestoneId,
    kind,
    status: "passed",
    summary: `${kind} passed`,
    createdAt: "2026-06-27T00:00:00Z",
  };
}

const receipt: PccCompletionReceipt = {
  id: "receipt-1",
  projectId: "project-1",
  milestoneId: "milestone-1",
  summary: "Production proof completed.",
  proofEvidenceIds: ["remote_ci-1", "browser_proof-1"],
  proofLevel: "remote",
  doNotRedo: ["Do not rerun proof unless the production SHA changes."],
  completedBy: "Project Command Center",
  completedAt: "2026-06-27T00:00:00Z",
};

describe("PCC production truth", () => {
  it("reports current when verified, runtime, remote proof, runtime proof, and receipts align", () => {
    const truth = buildPccProductionTruth({
      project,
      milestones: [milestone()],
      evidence: [evidence("remote_ci"), evidence("browser_proof")],
      receipts: [receipt],
      runtimeSha: PCC_LATEST_VERIFIED_SHA,
      remoteProofPassed: true,
      runtimeProofPassed: true,
      browserProofScreenshotPath: "/tmp/pcc-proof.png",
    });

    expect(truth.status).toBe("current");
    expect(truth.proofGaps).toEqual([]);
    expect(truth.doNotRedoNotes[0]).toContain("Do not rerun");
  });

  it("marks stale when runtime SHA differs from latest verified SHA", () => {
    const truth = buildPccProductionTruth({
      project,
      milestones: [milestone()],
      evidence: [evidence("remote_ci"), evidence("browser_proof")],
      receipts: [receipt],
      runtimeSha: "0000000000000000000000000000000000000000",
      remoteProofPassed: true,
      runtimeProofPassed: true,
    });

    expect(truth.status).toBe("stale");
    expect(truth.proofGaps.some((gap) => gap.includes("does not match verified"))).toBe(true);
  });

  it("lists missing receipts and proof gaps without inferring completion", () => {
    const truth = buildPccProductionTruth({
      project,
      milestones: [milestone()],
      evidence: [],
      receipts: [],
    });

    expect(truth.status).toBe("proof_missing");
    expect(truth.missingReceiptMilestones).toEqual(["Production proof"]);
    expect(truth.remoteProofRequired).toEqual(["Production proof"]);
    expect(truth.runtimeProofRequired).toEqual(["Production proof"]);
  });

  it("keeps current proof separate from historical missing evidence cleanup", () => {
    const truth = buildPccProductionTruth({
      project,
      milestones: [milestone()],
      evidence: [evidence("remote_ci"), evidence("browser_proof")],
      receipts: [
        {
          ...receipt,
          proofEvidenceIds: ["remote_ci-1", "missing-browser-proof"],
        },
      ],
      runtimeSha: PCC_LATEST_VERIFIED_SHA,
      remoteProofPassed: true,
      runtimeProofPassed: true,
      browserProofScreenshotPath: "/tmp/pcc-proof.png",
    });

    expect(truth.status).toBe("current");
    expect(truth.missingEvidenceReferences).toEqual([
      "Receipt receipt-1 references missing proof evidence: missing-browser-proof",
    ]);
    expect(truth.historicalEvidenceGaps).toEqual([
      "Historical evidence cleanup: Receipt receipt-1 references missing proof evidence: missing-browser-proof",
    ]);
    expect(truth.proofGaps).not.toContain(
      "Receipt receipt-1 references missing proof evidence: missing-browser-proof",
    );
  });
});
