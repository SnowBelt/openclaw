import { describe, expect, it } from "vitest";
import type {
  PccEvidence,
  PccMilestone,
  PccProject,
} from "../../packages/gateway-protocol/src/schema/types.js";
import { PCC_OPERATIONAL_QUALITY_DIMENSIONS } from "./capability-contract.js";
import { evaluatePccCapabilityEvidence } from "./capability-evidence.js";

const project: PccProject = {
  id: "project-1",
  title: "Operational excellence",
  status: "active",
  metadata: {
    pccWorkflowTemplateId: "software-product",
    pccCapabilityContract: { schema: "openclaw.pcc.capability-contract.v1" },
  },
  createdAt: "2026-07-13T00:00:00Z",
  updatedAt: "2026-07-13T00:00:00Z",
};

const milestone: PccMilestone = {
  id: "milestone-1",
  projectId: project.id,
  title: "Production proof",
  phaseId: "production-proof",
  status: "proof_pending",
  metadata: {
    pccCapabilityRequirementIds: ["truth-gated-completion", "upgrade-preservation"],
  },
  createdAt: "2026-07-13T00:00:00Z",
  updatedAt: "2026-07-13T00:00:00Z",
};

function qualityScores(value: number) {
  return Object.fromEntries(
    PCC_OPERATIONAL_QUALITY_DIMENSIONS.map((dimension) => [dimension, value]),
  );
}

function evidence(metadata: Record<string, unknown>): PccEvidence {
  return {
    id: "evidence-1",
    projectId: project.id,
    milestoneId: milestone.id,
    kind: "local_test",
    status: "passed",
    createdAt: "2026-07-13T01:00:00Z",
    metadata,
  };
}

describe("PCC capability evidence", () => {
  it("passes when capability use, first-pass telemetry, and independent 93-point quality proof align", () => {
    const evaluation = evaluatePccCapabilityEvidence({
      project,
      milestone,
      evidence: [
        evidence({
          pccCapabilityUse: [
            { id: "Truth-Gated-Completion", status: "used" },
            { id: "upgrade-preservation", status: "used" },
          ],
          pccFirstPass: {
            attemptCount: 1,
            defectCount: 0,
            latencyMs: 1200,
            costClass: "local",
            openAiApiUsed: false,
          },
          pccQualityAssessment: {
            assessor: "independent-local-qa",
            independent: true,
            criticalRegression: false,
            scores: qualityScores(93),
          },
        }),
      ],
    });

    expect(evaluation.passing).toBe(true);
    expect(evaluation.gaps).toEqual([]);
    expect(evaluation.firstPass).toMatchObject({ attemptCount: 1, defectCount: 0 });
    expect(evaluation.qualityAssessment?.scores.recoverability).toBe(93);
  });

  it("fails when required process use or first-pass telemetry is missing", () => {
    const evaluation = evaluatePccCapabilityEvidence({
      project,
      milestone,
      evidence: [
        evidence({ pccCapabilityUse: [{ id: "truth-gated-completion", status: "used" }] }),
      ],
    });

    expect(evaluation.passing).toBe(false);
    expect(evaluation.gaps).toEqual(
      expect.arrayContaining([
        "Required capability-use evidence is missing: upgrade-preservation.",
        "First-pass telemetry is missing or invalid.",
        "Independent operational quality assessment is missing or invalid.",
      ]),
    );
  });

  it("fails when one quality dimension is below 93 or a critical regression exists", () => {
    const scores = qualityScores(95);
    scores.reliability = 92;
    const evaluation = evaluatePccCapabilityEvidence({
      project,
      milestone,
      evidence: [
        evidence({
          pccCapabilityUse: [
            { id: "truth-gated-completion", status: "used" },
            { id: "upgrade-preservation", status: "used" },
          ],
          pccFirstPass: {
            attemptCount: 2,
            defectCount: 1,
            latencyMs: 2000,
            costClass: "local",
            openAiApiUsed: false,
          },
          pccQualityAssessment: {
            assessor: "independent-local-qa",
            independent: true,
            criticalRegression: true,
            scores,
          },
        }),
      ],
    });

    expect(evaluation.gaps).toEqual(
      expect.arrayContaining([
        "Operational quality assessment reports a critical regression.",
        "Operational quality is below 93/100: reliability.",
      ]),
    );
  });

  it("rejects paid OpenAI API telemetry without permission and budget evidence", () => {
    const evaluation = evaluatePccCapabilityEvidence({
      project,
      milestone: { ...milestone, phaseId: "mvp" },
      evidence: [
        evidence({
          pccCapabilityUse: [
            { id: "truth-gated-completion", status: "used" },
            { id: "upgrade-preservation", status: "used" },
          ],
          pccFirstPass: {
            attemptCount: 1,
            defectCount: 0,
            latencyMs: 100,
            costClass: "metered",
            openAiApiUsed: true,
          },
        }),
      ],
    });

    expect(evaluation.gaps).toContain(
      "OpenAI API use is missing an explicit permission, budget reservation, and required-use reason.",
    );
  });

  it("accepts required paid OpenAI API use with explicit permission and budget evidence", () => {
    const evaluation = evaluatePccCapabilityEvidence({
      project,
      milestone: { ...milestone, phaseId: "mvp" },
      evidence: [
        evidence({
          pccCapabilityUse: [
            { id: "truth-gated-completion", status: "used" },
            { id: "upgrade-preservation", status: "used" },
          ],
          pccFirstPass: {
            attemptCount: 1,
            defectCount: 0,
            latencyMs: 100,
            costClass: "metered",
            openAiApiUsed: true,
            paidUseAuthorization: {
              permissionId: "permission-paid-model-1",
              budgetId: "budget-reservation-1",
              reason: "The certified local model could not satisfy the required input contract.",
            },
          },
        }),
      ],
    });

    expect(evaluation.passing).toBe(true);
    expect(evaluation.gaps).toEqual([]);
    expect(evaluation.firstPass?.paidUseAuthorization?.permissionId).toBe(
      "permission-paid-model-1",
    );
  });

  it("requires an approved reason when a required capability uses a fallback", () => {
    const evaluation = evaluatePccCapabilityEvidence({
      project,
      milestone: { ...milestone, phaseId: "mvp" },
      evidence: [
        evidence({
          pccCapabilityUse: [
            { id: "truth-gated-completion", status: "fallback" },
            { id: "upgrade-preservation", status: "used" },
          ],
          pccFirstPass: {
            attemptCount: 1,
            defectCount: 0,
            latencyMs: 100,
            costClass: "local",
            openAiApiUsed: false,
          },
        }),
      ],
    });

    expect(evaluation.gaps).toContain(
      "Fallback truth-gated-completion is missing its reason or approver.",
    );
  });
});
