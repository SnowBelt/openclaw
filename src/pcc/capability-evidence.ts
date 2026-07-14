// Capability evidence keeps contracted process use and operational quality proof receipt-bound.
import type {
  PccEvidence,
  PccMilestone,
  PccProject,
} from "../../packages/gateway-protocol/src/schema/types.js";
import {
  PCC_CAPABILITY_CONTRACT_SCHEMA,
  PCC_OPERATIONAL_QUALITY_DIMENSIONS,
  PCC_OPERATIONAL_QUALITY_THRESHOLD,
  type PccOperationalQualityDimension,
  resolvePccProjectCapabilities,
} from "./capability-contract.js";
import { pccMetadataObject } from "./metadata.js";

export type PccCapabilityUseStatus = "used" | "fallback";

export type PccCapabilityUseEvidence = {
  id: string;
  status: PccCapabilityUseStatus;
  note?: string;
  approvedBy?: string;
};

export type PccFirstPassTelemetry = {
  attemptCount: number;
  defectCount: number;
  latencyMs: number;
  costClass: "none" | "local" | "metered" | "high";
  openAiApiUsed: boolean;
  paidUseAuthorization: PccPaidUseAuthorization | null;
};

export type PccPaidUseAuthorization = {
  permissionId: string;
  budgetId: string;
  reason: string;
};

export type PccOperationalQualityAssessment = {
  assessor: string;
  independent: boolean;
  criticalRegression: boolean;
  scores: Readonly<Record<PccOperationalQualityDimension, number>>;
};

export type PccCapabilityEvidenceEvaluation = {
  contracted: boolean;
  passing: boolean;
  requiredCapabilityIds: string[];
  usedCapabilityIds: string[];
  missingCapabilityIds: string[];
  fallbackCapabilityIds: string[];
  firstPass: PccFirstPassTelemetry | null;
  qualityAssessment: PccOperationalQualityAssessment | null;
  gaps: string[];
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const normalized = typeof entry === "string" ? entry.trim() : "";
        return normalized ? [normalized] : [];
      })
    : [];
}

function boundedInteger(value: unknown, minimum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum ? value : null;
}

function capabilityUseFromEvidence(evidence: readonly PccEvidence[]): PccCapabilityUseEvidence[] {
  return evidence.flatMap((entry) => {
    const raw = pccMetadataObject(entry.metadata).pccCapabilityUse;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.flatMap((value): PccCapabilityUseEvidence[] => {
      const record = pccMetadataObject(value);
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const status =
        record.status === "used" || record.status === "fallback" ? record.status : null;
      if (!id || !status) {
        return [];
      }
      return [
        {
          id,
          status,
          ...(typeof record.note === "string" && record.note.trim()
            ? { note: record.note.trim() }
            : {}),
          ...(typeof record.approvedBy === "string" && record.approvedBy.trim()
            ? { approvedBy: record.approvedBy.trim() }
            : {}),
        },
      ];
    });
  });
}

export function pccFirstPassTelemetryForEvidence(
  evidence: PccEvidence,
): PccFirstPassTelemetry | null {
  const raw = pccMetadataObject(pccMetadataObject(evidence.metadata).pccFirstPass);
  const attemptCount = boundedInteger(raw.attemptCount, 1);
  const defectCount = boundedInteger(raw.defectCount, 0);
  const latencyMs = boundedInteger(raw.latencyMs, 0);
  const costClass = ["none", "local", "metered", "high"].includes(String(raw.costClass))
    ? (raw.costClass as PccFirstPassTelemetry["costClass"])
    : null;
  const paidUseRaw = pccMetadataObject(raw.paidUseAuthorization);
  const permissionId =
    typeof paidUseRaw.permissionId === "string" ? paidUseRaw.permissionId.trim() : "";
  const budgetId = typeof paidUseRaw.budgetId === "string" ? paidUseRaw.budgetId.trim() : "";
  const reason = typeof paidUseRaw.reason === "string" ? paidUseRaw.reason.trim() : "";
  const paidUseAuthorization =
    permissionId && budgetId && reason ? { permissionId, budgetId, reason } : null;
  if (
    attemptCount !== null &&
    defectCount !== null &&
    latencyMs !== null &&
    costClass &&
    typeof raw.openAiApiUsed === "boolean"
  ) {
    return {
      attemptCount,
      defectCount,
      latencyMs,
      costClass,
      openAiApiUsed: raw.openAiApiUsed,
      paidUseAuthorization,
    };
  }
  return null;
}

export function pccOperationalQualityAssessmentForEvidence(
  evidence: PccEvidence,
): PccOperationalQualityAssessment | null {
  const raw = pccMetadataObject(pccMetadataObject(evidence.metadata).pccQualityAssessment);
  const assessor = typeof raw.assessor === "string" ? raw.assessor.trim() : "";
  const scores = pccMetadataObject(raw.scores);
  if (
    !assessor ||
    typeof raw.independent !== "boolean" ||
    typeof raw.criticalRegression !== "boolean" ||
    !PCC_OPERATIONAL_QUALITY_DIMENSIONS.every((dimension) => {
      const score = scores[dimension];
      return typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100;
    })
  ) {
    return null;
  }
  return {
    assessor,
    independent: raw.independent,
    criticalRegression: raw.criticalRegression,
    scores: Object.fromEntries(
      PCC_OPERATIONAL_QUALITY_DIMENSIONS.map((dimension) => [dimension, Number(scores[dimension])]),
    ) as Record<PccOperationalQualityDimension, number>,
  };
}

function firstPassFromEvidence(evidence: readonly PccEvidence[]): PccFirstPassTelemetry | null {
  for (const entry of evidence.toSorted((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )) {
    const telemetry = pccFirstPassTelemetryForEvidence(entry);
    if (telemetry) {
      return telemetry;
    }
  }
  return null;
}

function qualityAssessmentFromEvidence(
  evidence: readonly PccEvidence[],
): PccOperationalQualityAssessment | null {
  for (const entry of evidence.toSorted((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )) {
    const assessment = pccOperationalQualityAssessmentForEvidence(entry);
    if (assessment) {
      return assessment;
    }
  }
  return null;
}

function projectIsContracted(project: PccProject): boolean {
  return (
    pccMetadataObject(pccMetadataObject(project.metadata).pccCapabilityContract).schema ===
    PCC_CAPABILITY_CONTRACT_SCHEMA
  );
}

function isProductionProofMilestone(milestone: PccMilestone): boolean {
  return milestone.phaseId === "production-proof";
}

export function evaluatePccCapabilityEvidence(input: {
  project: PccProject;
  milestone: PccMilestone;
  evidence: readonly PccEvidence[];
}): PccCapabilityEvidenceEvaluation {
  if (!projectIsContracted(input.project)) {
    return {
      contracted: false,
      passing: true,
      requiredCapabilityIds: [],
      usedCapabilityIds: [],
      missingCapabilityIds: [],
      fallbackCapabilityIds: [],
      firstPass: null,
      qualityAssessment: null,
      gaps: [],
    };
  }
  const passedEvidence = input.evidence.filter((entry) => entry.status === "passed");
  const milestoneRequirementIds = stringArray(
    pccMetadataObject(input.milestone.metadata).pccCapabilityRequirementIds,
  );
  const capabilityResolution = resolvePccProjectCapabilities({
    project: input.project,
    ...(milestoneRequirementIds.length > 0 ? { requirementIds: milestoneRequirementIds } : {}),
  });
  const requiredCapabilityIds = capabilityResolution.entries
    .filter((entry) => entry.requirement.required)
    .map((entry) => entry.requirement.id);
  const capabilityUse = capabilityUseFromEvidence(passedEvidence);
  const usedCapabilityIds = [...new Set(capabilityUse.map((entry) => entry.id))];
  const requiredCapabilityKeys = new Set(requiredCapabilityIds.map((id) => id.toLowerCase()));
  const usedCapabilityKeys = new Set(usedCapabilityIds.map((id) => id.toLowerCase()));
  const missingCapabilityIds = requiredCapabilityIds.filter(
    (id) => !usedCapabilityKeys.has(id.toLowerCase()),
  );
  const invalidFallbacks = capabilityUse.filter(
    (entry) =>
      entry.status === "fallback" &&
      requiredCapabilityKeys.has(entry.id.toLowerCase()) &&
      (!entry.note || !entry.approvedBy),
  );
  const fallbackCapabilityIds = capabilityUse
    .filter((entry) => entry.status === "fallback")
    .map((entry) => entry.id);
  const firstPass = firstPassFromEvidence(passedEvidence);
  const qualityAssessment = qualityAssessmentFromEvidence(passedEvidence);
  const gaps: string[] = [];
  if (passedEvidence.length === 0) {
    gaps.push("No passed evidence is linked to the contracted milestone.");
  }
  if (missingCapabilityIds.length > 0) {
    gaps.push(`Required capability-use evidence is missing: ${missingCapabilityIds.join(", ")}.`);
  }
  for (const fallback of invalidFallbacks) {
    gaps.push(`Fallback ${fallback.id} is missing its reason or approver.`);
  }
  if (!firstPass) {
    gaps.push("First-pass telemetry is missing or invalid.");
  } else if (firstPass.openAiApiUsed && !["metered", "high"].includes(firstPass.costClass)) {
    gaps.push("OpenAI API use must be recorded with a metered or high cost class.");
  } else if (firstPass.openAiApiUsed && !firstPass.paidUseAuthorization) {
    gaps.push(
      "OpenAI API use is missing an explicit permission, budget reservation, and required-use reason.",
    );
  }
  if (isProductionProofMilestone(input.milestone)) {
    if (!qualityAssessment) {
      gaps.push("Independent operational quality assessment is missing or invalid.");
    } else {
      if (!qualityAssessment.independent) {
        gaps.push("Operational quality assessment is not independent.");
      }
      if (qualityAssessment.criticalRegression) {
        gaps.push("Operational quality assessment reports a critical regression.");
      }
      const belowThreshold = PCC_OPERATIONAL_QUALITY_DIMENSIONS.filter(
        (dimension) => qualityAssessment.scores[dimension] < PCC_OPERATIONAL_QUALITY_THRESHOLD,
      );
      if (belowThreshold.length > 0) {
        gaps.push(
          `Operational quality is below ${PCC_OPERATIONAL_QUALITY_THRESHOLD}/100: ${belowThreshold.join(", ")}.`,
        );
      }
    }
  }
  return {
    contracted: true,
    passing: gaps.length === 0,
    requiredCapabilityIds,
    usedCapabilityIds,
    missingCapabilityIds,
    fallbackCapabilityIds,
    firstPass,
    qualityAssessment,
    gaps,
  };
}
