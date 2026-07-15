// PCC capability contracts make workflow, skill, proof, and quality requirements deterministic.
import type { PccProject } from "../../packages/gateway-protocol/src/schema/types.js";
import {
  BASE_REQUIREMENTS,
  PHASE_REQUIREMENT_IDS,
  TEMPLATE_REQUIREMENTS,
} from "./capability-contract-registry.js";
import { pccMetadataObject } from "./metadata.js";
import type { PccWorkflowTemplateId } from "./project-workflows.js";

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

type SkillStatusLike = {
  skillKey: string;
  name?: string;
  eligible?: boolean;
  modelVisible?: boolean;
  disabled?: boolean;
  blockedByAllowlist?: boolean;
  blockedByAgentFilter?: boolean;
  platformIncompatible?: boolean;
};

type AgentStatusLike = {
  id: string;
  name?: string;
};

type ModelCatalogLike = {
  provider: string;
  id: string;
  name?: string;
  available?: boolean;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const normalized = typeof entry === "string" ? entry.trim() : "";
        return normalized ? [normalized] : [];
      })
    : [];
}

function explicitRequirement(
  id: string,
  kind: Extract<PccCapabilityKind, "skill" | "tool" | "agent" | "model" | "process">,
  required: boolean,
): PccCapabilityRequirement {
  const label = kind === "skill" ? "skill" : kind;
  return {
    id,
    kind,
    title: id,
    purpose: `${required ? "Use" : "Prefer"} the project-declared ${label} for this work.`,
    required,
    evidence: `Record whether ${id} was selected, unavailable, or replaced by an approved fallback.`,
    ...(required
      ? { fallback: `Stop and record an exact blocker unless an equivalent ${label} is approved.` }
      : {}),
  };
}

function explicitRequirements(metadata: unknown): PccCapabilityRequirement[] {
  const source = pccMetadataObject(metadata);
  const groups: Array<
    [string, Extract<PccCapabilityKind, "skill" | "tool" | "agent" | "model" | "process">, boolean]
  > = [
    ["pccRequiredSkills", "skill", true],
    ["pccPreferredSkills", "skill", false],
    ["pccRequiredTools", "tool", true],
    ["pccPreferredTools", "tool", false],
    ["pccRequiredAgents", "agent", true],
    ["pccPreferredAgents", "agent", false],
    ["pccRequiredModels", "model", true],
    ["pccPreferredModels", "model", false],
    ["pccRequiredProcesses", "process", true],
  ];
  return groups.flatMap(([key, kind, required]) =>
    stringArray(source[key]).map((id) => explicitRequirement(id, kind, required)),
  );
}

function uniqueRequirements(
  requirements: readonly PccCapabilityRequirement[],
): PccCapabilityRequirement[] {
  const byId = new Map<string, PccCapabilityRequirement>();
  for (const requirement of requirements) {
    const key = requirement.id.toLowerCase();
    const existing = byId.get(key);
    if (!existing || (!existing.required && requirement.required)) {
      byId.set(key, requirement);
    }
  }
  return [...byId.values()];
}

export function buildPccCapabilityContract(
  workflowTemplateId: PccWorkflowTemplateId,
  metadata?: unknown,
): PccCapabilityContract {
  return {
    schema: PCC_CAPABILITY_CONTRACT_SCHEMA,
    workflowTemplateId,
    qualityThreshold: PCC_OPERATIONAL_QUALITY_THRESHOLD,
    qualityDimensions: PCC_OPERATIONAL_QUALITY_DIMENSIONS,
    requirements: uniqueRequirements([
      ...BASE_REQUIREMENTS,
      ...TEMPLATE_REQUIREMENTS[workflowTemplateId],
      ...explicitRequirements(metadata),
    ]),
  };
}

export function pccCapabilityRequirementIdsForPhase(
  contract: PccCapabilityContract,
  phaseId: string,
): string[] {
  const phaseIds = new Set(PHASE_REQUIREMENT_IDS[phaseId] ?? []);
  const selected = contract.requirements.filter(
    (requirement) =>
      phaseIds.has(requirement.id) ||
      (phaseId === "tools-skills" &&
        ["skill", "tool", "agent", "model"].includes(requirement.kind)),
  );
  return selected.map((requirement) => requirement.id);
}

export function pccCapabilityContractMetadata(contract: PccCapabilityContract) {
  return {
    schema: contract.schema,
    workflowTemplateId: contract.workflowTemplateId,
    qualityThreshold: contract.qualityThreshold,
    qualityDimensions: [...contract.qualityDimensions],
    requirementIds: contract.requirements.map((requirement) => requirement.id),
    requiredRequirementIds: contract.requirements
      .filter((requirement) => requirement.required)
      .map((requirement) => requirement.id),
  };
}

export function pccCapabilityInventoryFromSkillStatus(
  skills: readonly SkillStatusLike[],
): PccCapabilityInventoryEntry[] {
  return skills.flatMap((skill) => {
    const id = skill.skillKey.trim();
    if (!id) {
      return [];
    }
    const ready = skill.eligible === true && skill.modelVisible !== false;
    const blocked =
      skill.disabled === true ||
      skill.blockedByAllowlist === true ||
      skill.blockedByAgentFilter === true ||
      skill.platformIncompatible === true;
    return [
      {
        id,
        kind: "skill" as const,
        status: ready ? ("ready" as const) : blocked ? ("blocked" as const) : ("missing" as const),
        ...(skill.name ? { title: skill.name } : {}),
        ...(!ready
          ? {
              reason: blocked
                ? "The skill is installed but blocked, disabled, filtered, or platform-incompatible."
                : "The skill is not currently eligible for model use.",
            }
          : {}),
      },
    ];
  });
}

export function pccCapabilityInventoryFromAgents(
  agents: readonly AgentStatusLike[],
): PccCapabilityInventoryEntry[] {
  return agents.flatMap((agent) => {
    const id = agent.id.trim();
    return id
      ? [
          {
            id,
            kind: "agent" as const,
            status: "ready" as const,
            ...(agent.name?.trim() ? { title: agent.name.trim() } : {}),
          },
        ]
      : [];
  });
}

export function pccCapabilityInventoryFromModelCatalog(
  models: readonly ModelCatalogLike[],
): PccCapabilityInventoryEntry[] {
  return models.flatMap((model) => {
    const provider = model.provider.trim();
    const id = model.id.trim();
    if (!provider || !id) {
      return [];
    }
    return [
      {
        id: `${provider}/${id}`,
        kind: "model" as const,
        status: model.available === false ? ("blocked" as const) : ("ready" as const),
        ...(model.name?.trim() ? { title: model.name.trim() } : {}),
        ...(model.available === false
          ? { reason: "The model is present in the catalog but currently unavailable." }
          : {}),
      },
    ];
  });
}

function inventoryEntryFor(
  requirement: PccCapabilityRequirement,
  inventory: readonly PccCapabilityInventoryEntry[],
): PccCapabilityInventoryEntry | undefined {
  return inventory.find(
    (entry) =>
      entry.kind === requirement.kind && entry.id.toLowerCase() === requirement.id.toLowerCase(),
  );
}

function isBuiltInRequirement(requirement: PccCapabilityRequirement): boolean {
  return (
    requirement.kind === "process" ||
    requirement.kind === "workflow" ||
    requirement.kind === "proof"
  );
}

export function resolvePccCapabilityContract(input: {
  contract: PccCapabilityContract;
  inventory?: readonly PccCapabilityInventoryEntry[];
  requirementIds?: readonly string[];
}): PccCapabilityResolution {
  const inventory = input.inventory ?? [];
  const requirementFilter = input.requirementIds ? new Set(input.requirementIds) : null;
  const requirements = input.contract.requirements.filter(
    (requirement) => !requirementFilter || requirementFilter.has(requirement.id),
  );
  const entries = requirements.map((requirement): PccCapabilityResolutionEntry => {
    const found = inventoryEntryFor(requirement, inventory);
    if (found) {
      return {
        requirement,
        status: found.status,
        reason:
          found.reason ??
          (found.status === "ready"
            ? "Available and eligible."
            : `Capability status is ${found.status}.`),
      };
    }
    if (isBuiltInRequirement(requirement)) {
      return {
        requirement,
        status: "planned",
        reason: "Required by the task plan and must be proven in the completion receipt.",
      };
    }
    return {
      requirement,
      status: "unknown",
      reason: requirement.required
        ? "No current capability inventory proves availability."
        : "Preferred capability; inspect availability before choosing an equivalent fallback.",
    };
  });
  const blocking = entries.filter(
    (entry) =>
      entry.requirement.required &&
      (entry.status === "missing" || entry.status === "blocked" || entry.status === "unknown"),
  );
  const resolvedCount = entries.filter(
    (entry) => entry.status === "ready" || entry.status === "planned",
  ).length;
  return {
    schema: PCC_CAPABILITY_CONTRACT_SCHEMA,
    workflowTemplateId: input.contract.workflowTemplateId,
    qualityThreshold: input.contract.qualityThreshold,
    qualityDimensions: input.contract.qualityDimensions,
    entries,
    ready: blocking.length === 0,
    readinessScore: entries.length === 0 ? 100 : Math.round((resolvedCount / entries.length) * 100),
    blockingRequirementIds: blocking.map((entry) => entry.requirement.id),
    selectedCapabilityIds: entries
      .filter((entry) => entry.status === "ready" || entry.status === "planned")
      .map((entry) => entry.requirement.id),
  };
}

function workflowTemplateIdFromProject(project: PccProject): PccWorkflowTemplateId {
  const value = pccMetadataObject(project.metadata).pccWorkflowTemplateId;
  const allowed: readonly PccWorkflowTemplateId[] = [
    "software-product",
    "dashboard-data",
    "creative-media",
    "research",
    "trading-finance",
    "snes-studio",
    "custom",
  ];
  return typeof value === "string" && allowed.includes(value as PccWorkflowTemplateId)
    ? (value as PccWorkflowTemplateId)
    : "software-product";
}

export function resolvePccProjectCapabilities(input: {
  project: PccProject;
  inventory?: readonly PccCapabilityInventoryEntry[];
  requirementIds?: readonly string[];
}): PccCapabilityResolution {
  return resolvePccCapabilityContract({
    contract: buildPccCapabilityContract(
      workflowTemplateIdFromProject(input.project),
      input.project.metadata,
    ),
    inventory: input.inventory,
    requirementIds: input.requirementIds,
  });
}

export function withPccCapabilityPreflight(
  project: PccProject,
  resolution: PccCapabilityResolution,
  evaluatedAt: string,
): PccProject {
  return {
    ...project,
    metadata: {
      ...pccMetadataObject(project.metadata),
      pccCapabilityPreflight: {
        schema: resolution.schema,
        workflowTemplateId: resolution.workflowTemplateId,
        qualityThreshold: resolution.qualityThreshold,
        ready: resolution.ready,
        readinessScore: resolution.readinessScore,
        blockingRequirementIds: [...resolution.blockingRequirementIds],
        selectedCapabilityIds: [...resolution.selectedCapabilityIds],
        entries: resolution.entries.map((entry) => ({
          id: entry.requirement.id,
          kind: entry.requirement.kind,
          required: entry.requirement.required,
          status: entry.status,
          reason: entry.reason,
        })),
        evaluatedAt,
      },
    },
  };
}
