// PCC standards validation rejects incomplete capability additions before runtime use.
import {
  PCC_CAPABILITY_CONTRACT_SCHEMA,
  PCC_OPERATIONAL_QUALITY_DIMENSIONS,
  PCC_OPERATIONAL_QUALITY_THRESHOLD,
  type PccCapabilityContract,
  type PccCapabilityKind,
  type PccOperationalQualityDimension,
} from "./capability-contract.js";

export type PccCapabilityAdditionDefinition = {
  id: string;
  kind: PccCapabilityKind | "plugin" | "dashboard_surface";
  version: string;
  owner: string;
  trigger: string;
  requiredInputs: readonly string[];
  permissionClass: "none" | "local_write" | "paid" | "remote" | "destructive" | "credentialed";
  costClass: "none" | "local" | "metered" | "high";
  localFirstRoute: string;
  fallback: string;
  tests: readonly string[];
  proofSurfaces: readonly string[];
  qualityDimensions: readonly PccOperationalQualityDimension[];
  observability: readonly string[];
  upgradeImpact: string;
  rollback: string;
  docs: readonly string[];
};

const REQUIRED_BASE_REQUIREMENTS = [
  "workflow-contract",
  "scope-and-success-criteria",
  "capability-preflight",
  "permission-gate",
  "local-first-routing",
  "targeted-proof",
  "independent-qa",
  "truth-gated-completion",
  "learning-receipt",
] as const;

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}

function missingStrings(value: readonly string[] | undefined): boolean {
  return !value || value.length === 0 || value.some((entry) => !entry.trim());
}

export function validatePccCapabilityContract(contract: PccCapabilityContract): string[] {
  const errors: string[] = [];
  if (contract.schema !== PCC_CAPABILITY_CONTRACT_SCHEMA) {
    errors.push(`Invalid capability-contract schema for ${contract.workflowTemplateId}.`);
  }
  if (contract.qualityThreshold !== PCC_OPERATIONAL_QUALITY_THRESHOLD) {
    errors.push(
      `Capability contract ${contract.workflowTemplateId} must use quality threshold ${PCC_OPERATIONAL_QUALITY_THRESHOLD}.`,
    );
  }
  const dimensions = [...contract.qualityDimensions];
  for (const dimension of PCC_OPERATIONAL_QUALITY_DIMENSIONS) {
    if (!dimensions.includes(dimension)) {
      errors.push(`Capability contract ${contract.workflowTemplateId} is missing ${dimension}.`);
    }
  }
  for (const duplicate of duplicateValues(dimensions)) {
    errors.push(`Capability contract ${contract.workflowTemplateId} repeats ${duplicate}.`);
  }
  const ids = contract.requirements.map((requirement) => requirement.id);
  for (const duplicate of duplicateValues(ids)) {
    errors.push(`Capability contract ${contract.workflowTemplateId} repeats ${duplicate}.`);
  }
  for (const required of REQUIRED_BASE_REQUIREMENTS) {
    if (!ids.includes(required)) {
      errors.push(`Capability contract ${contract.workflowTemplateId} is missing ${required}.`);
    }
  }
  for (const requirement of contract.requirements) {
    if (
      !requirement.id.trim() ||
      !requirement.title.trim() ||
      !requirement.purpose.trim() ||
      !requirement.evidence.trim()
    ) {
      errors.push(
        `Capability contract ${contract.workflowTemplateId} has an incomplete requirement: ${requirement.id || "<missing id>"}.`,
      );
    }
    if (
      requirement.required &&
      ["skill", "tool", "agent", "model"].includes(requirement.kind) &&
      !requirement.fallback?.trim()
    ) {
      errors.push(
        `Required external capability ${requirement.id} must declare an approved fallback or stop rule.`,
      );
    }
  }
  return errors;
}

export function validatePccCapabilityAddition(addition: PccCapabilityAdditionDefinition): string[] {
  const errors: string[] = [];
  const requiredStrings: Array<[string, string]> = [
    ["id", addition.id],
    ["version", addition.version],
    ["owner", addition.owner],
    ["trigger", addition.trigger],
    ["localFirstRoute", addition.localFirstRoute],
    ["fallback", addition.fallback],
    ["upgradeImpact", addition.upgradeImpact],
    ["rollback", addition.rollback],
  ];
  for (const [field, value] of requiredStrings) {
    if (!value.trim()) {
      errors.push(`${addition.id || "Capability addition"} is missing ${field}.`);
    }
  }
  const requiredLists: Array<[string, readonly string[]]> = [
    ["requiredInputs", addition.requiredInputs],
    ["tests", addition.tests],
    ["proofSurfaces", addition.proofSurfaces],
    ["qualityDimensions", addition.qualityDimensions],
    ["observability", addition.observability],
    ["docs", addition.docs],
  ];
  for (const [field, value] of requiredLists) {
    if (missingStrings(value)) {
      errors.push(`${addition.id || "Capability addition"} is missing ${field}.`);
    }
  }
  for (const dimension of addition.qualityDimensions) {
    if (!PCC_OPERATIONAL_QUALITY_DIMENSIONS.includes(dimension)) {
      errors.push(`${addition.id} has unknown quality dimension: ${dimension}.`);
    }
  }
  if (addition.costClass === "metered" || addition.costClass === "high") {
    if (!["paid", "credentialed"].includes(addition.permissionClass)) {
      errors.push(
        `${addition.id} has metered cost without a paid or credentialed permission gate.`,
      );
    }
  }
  if (addition.permissionClass === "none" && /approve|permission/iu.test(addition.fallback)) {
    errors.push(`${addition.id} declares no permission class but its fallback requires approval.`);
  }
  return errors;
}
