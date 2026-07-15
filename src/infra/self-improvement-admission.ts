export type SelfImprovementAdmissionState =
  | "shadow"
  | "dry_run"
  | "canary"
  | "active"
  | "rolled_back";

export type SelfImprovementAdmissionContract = {
  version: 1;
  componentId: string;
  owner: string;
  expectedOutcome: string;
  slo: {
    metric: string;
    target: string;
    windowMs: number;
  };
  proofRequirements: string[];
  rollback: string;
  retentionDays: number;
  privacy: "internal" | "sensitive";
  capabilities: string[];
  autonomyTier: "observe" | "recommend";
};

export type SelfImprovementAdmissionValidation = {
  valid: boolean;
  errors: string[];
};

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function uniqueNonEmpty(values: readonly string[]): boolean {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length === values.length && new Set(normalized).size === normalized.length;
}

export function validateSelfImprovementAdmissionContract(
  contract: SelfImprovementAdmissionContract,
): SelfImprovementAdmissionValidation {
  const errors = [
    contract.version !== 1 ? "Admission contract version must be 1." : "",
    !hasText(contract.componentId) ? "Component id is required." : "",
    !hasText(contract.owner) ? "Owner is required." : "",
    !hasText(contract.expectedOutcome) ? "Expected outcome is required." : "",
    !hasText(contract.slo.metric) ? "SLO metric is required." : "",
    !hasText(contract.slo.target) ? "SLO target is required." : "",
    !Number.isSafeInteger(contract.slo.windowMs) || contract.slo.windowMs <= 0
      ? "SLO window must be a positive integer."
      : "",
    contract.proofRequirements.length === 0 || !uniqueNonEmpty(contract.proofRequirements)
      ? "At least one unique proof requirement is required."
      : "",
    !hasText(contract.rollback) ? "Rollback procedure is required." : "",
    !Number.isSafeInteger(contract.retentionDays) ||
    contract.retentionDays < 1 ||
    contract.retentionDays > 3_650
      ? "Retention days must be between 1 and 3650."
      : "",
    !uniqueNonEmpty(contract.capabilities)
      ? "Capabilities must be non-empty and unique when provided."
      : "",
    contract.autonomyTier !== "observe" && contract.autonomyTier !== "recommend"
      ? "Integrated components may use only observe or recommend autonomy."
      : "",
  ].filter(Boolean);
  return { valid: errors.length === 0, errors };
}

const TRANSITIONS: Record<SelfImprovementAdmissionState, readonly SelfImprovementAdmissionState[]> =
  {
    shadow: ["dry_run"],
    dry_run: ["canary", "rolled_back"],
    canary: ["dry_run", "active", "rolled_back"],
    active: ["rolled_back"],
    rolled_back: ["shadow"],
  };

export function evaluateSelfImprovementAdmissionTransition(params: {
  contract: SelfImprovementAdmissionContract;
  from: SelfImprovementAdmissionState;
  to: SelfImprovementAdmissionState;
  proofPassed?: boolean;
  rollbackVerified?: boolean;
}): { allowed: boolean; reason: string } {
  const validation = validateSelfImprovementAdmissionContract(params.contract);
  if (!validation.valid) {
    return { allowed: false, reason: validation.errors.join(" ") };
  }
  if (!TRANSITIONS[params.from].includes(params.to)) {
    return { allowed: false, reason: `Transition ${params.from} -> ${params.to} is not allowed.` };
  }
  if ((params.to === "canary" || params.to === "active") && params.proofPassed !== true) {
    return { allowed: false, reason: `${params.to} admission requires passing proof.` };
  }
  if (params.to === "active" && params.rollbackVerified !== true) {
    return { allowed: false, reason: "Active admission requires verified rollback." };
  }
  if (params.to === "rolled_back" && params.rollbackVerified !== true) {
    return { allowed: false, reason: "Rollback transition requires a verified rollback path." };
  }
  return { allowed: true, reason: `Transition ${params.from} -> ${params.to} is proof-gated.` };
}
