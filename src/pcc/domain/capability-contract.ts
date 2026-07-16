import type { PccWorkflowTemplateId } from "./workflow.js";

export const PCC_CAPABILITY_CONTRACT_SCHEMA = "openclaw.pcc.capability-contract.v1";
export const PCC_OPERATIONAL_QUALITY_THRESHOLD = 93;

export const PCC_OPERATIONAL_QUALITY_DIMENSIONS = [
  "speed",
  "accuracy",
  "efficiency",
  "first_pass_quality",
  "qa_coverage",
  "overall_quality",
  "reliability",
  "durability",
  "safety",
  "cost_discipline",
  "observability",
  "recoverability",
] as const;

export type PccOperationalQualityDimension = (typeof PCC_OPERATIONAL_QUALITY_DIMENSIONS)[number];

export type PccCapabilityKind =
  | "process"
  | "workflow"
  | "skill"
  | "tool"
  | "plugin"
  | "software"
  | "agent"
  | "model"
  | "proof";

export type PccCapabilityRequirement = {
  id: string;
  kind: PccCapabilityKind;
  title: string;
  purpose: string;
  required: boolean;
  evidence: string;
  fallback?: string;
};

export type PccCapabilityContract = {
  schema: typeof PCC_CAPABILITY_CONTRACT_SCHEMA;
  workflowTemplateId: PccWorkflowTemplateId;
  qualityThreshold: number;
  qualityDimensions: readonly PccOperationalQualityDimension[];
  requirements: readonly PccCapabilityRequirement[];
};

export type PccCapabilityAvailability = "ready" | "blocked" | "missing" | "unknown";

export type PccCapabilityInventoryEntry = {
  id: string;
  kind: PccCapabilityKind;
  status: PccCapabilityAvailability;
  title?: string;
  reason?: string;
};

export type PccCapabilityResolutionStatus = "planned" | "ready" | "blocked" | "missing" | "unknown";

export type PccCapabilityResolutionEntry = {
  requirement: PccCapabilityRequirement;
  status: PccCapabilityResolutionStatus;
  reason: string;
};

export type PccCapabilityResolution = {
  schema: typeof PCC_CAPABILITY_CONTRACT_SCHEMA;
  workflowTemplateId: PccWorkflowTemplateId;
  qualityThreshold: number;
  qualityDimensions: readonly PccOperationalQualityDimension[];
  entries: readonly PccCapabilityResolutionEntry[];
  ready: boolean;
  readinessScore: number;
  blockingRequirementIds: readonly string[];
  selectedCapabilityIds: readonly string[];
};
