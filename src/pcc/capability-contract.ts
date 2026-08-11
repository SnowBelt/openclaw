// PCC capability contracts make workflow, skill, proof, and quality requirements deterministic.
import type { PccProject } from "../../packages/gateway-protocol/src/schema/types.js";
import {
  BASE_REQUIREMENTS,
  PHASE_REQUIREMENT_IDS,
  TEMPLATE_REQUIREMENTS,
} from "./capability-contract-registry.js";
import {
  PCC_CAPABILITY_CONTRACT_SCHEMA,
  PCC_OPERATIONAL_QUALITY_DIMENSIONS,
  PCC_OPERATIONAL_QUALITY_THRESHOLD,
  type PccCapabilityContract,
  type PccCapabilityInventoryEntry,
  type PccCapabilityKind,
  type PccCapabilityRequirement,
  type PccCapabilityResolution,
  type PccCapabilityResolutionEntry,
} from "./domain/capability-contract.js";
import type { PccWorkflowTemplateId } from "./domain/workflow.js";
import { pccMetadataObject } from "./metadata.js";

export {
  PCC_CAPABILITY_CONTRACT_SCHEMA,
  PCC_OPERATIONAL_QUALITY_DIMENSIONS,
  PCC_OPERATIONAL_QUALITY_THRESHOLD,
} from "./domain/capability-contract.js";
export type {
  PccCapabilityAvailability,
  PccCapabilityContract,
  PccCapabilityInventoryEntry,
  PccCapabilityKind,
  PccCapabilityRequirement,
  PccCapabilityResolution,
  PccCapabilityResolutionEntry,
  PccCapabilityResolutionStatus,
  PccOperationalQualityDimension,
} from "./domain/capability-contract.js";

type SkillStatusLike = {
  skillKey: string;
  name?: string;
  eligible?: boolean;
  modelVisible?: boolean;
  disabled?: boolean;
  blockedByAllowlist?: boolean;
  blockedByAgentFilter?: boolean;
  platformIncompatible?: boolean;
  requirements?: {
    bins?: readonly string[];
    anyBins?: readonly string[];
  };
  missing?: {
    bins?: readonly string[];
  };
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

type ToolCatalogLike = {
  groups?: readonly {
    source?: "core" | "plugin";
    pluginId?: string;
    label?: string;
    tools?: readonly {
      id: string;
      label?: string;
      source?: "core" | "plugin";
      pluginId?: string;
    }[];
  }[];
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
  kind: Extract<
    PccCapabilityKind,
    "skill" | "tool" | "plugin" | "software" | "agent" | "model" | "process"
  >,
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
    [
      string,
      Extract<
        PccCapabilityKind,
        "skill" | "tool" | "plugin" | "software" | "agent" | "model" | "process"
      >,
      boolean,
    ]
  > = [
    ["pccRequiredSkills", "skill", true],
    ["pccPreferredSkills", "skill", false],
    ["pccRequiredTools", "tool", true],
    ["pccPreferredTools", "tool", false],
    ["pccRequiredPlugins", "plugin", true],
    ["pccPreferredPlugins", "plugin", false],
    ["pccRequiredSoftware", "software", true],
    ["pccPreferredSoftware", "software", false],
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
        ["skill", "tool", "plugin", "software", "agent", "model"].includes(requirement.kind)),
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

function addPreferredInventoryEntry(
  entries: Map<string, PccCapabilityInventoryEntry>,
  entry: PccCapabilityInventoryEntry,
): void {
  const key = `${entry.kind}:${entry.id.toLowerCase()}`;
  const existing = entries.get(key);
  if (!existing || (existing.status !== "ready" && entry.status === "ready")) {
    entries.set(key, entry);
  }
}

export function pccCapabilityInventoryFromSkillSoftware(
  skills: readonly SkillStatusLike[],
): PccCapabilityInventoryEntry[] {
  const inventory = new Map<string, PccCapabilityInventoryEntry>();
  for (const skill of skills) {
    const requiredBins = [
      ...(skill.requirements?.bins ?? []),
      ...(skill.requirements?.anyBins ?? []),
    ];
    const missingBins = new Set((skill.missing?.bins ?? []).map((bin) => bin.trim().toLowerCase()));
    for (const rawBin of requiredBins) {
      const id = rawBin.trim();
      if (!id) {
        continue;
      }
      const missing = missingBins.has(id.toLowerCase());
      addPreferredInventoryEntry(inventory, {
        id,
        kind: "software",
        status: missing ? "blocked" : "ready",
        ...(missing
          ? { reason: `Required software is missing for skill ${skill.skillKey}.` }
          : { reason: `Available through skill ${skill.skillKey}.` }),
      });
    }
  }
  return [...inventory.values()];
}

export function pccCapabilityInventoryFromToolCatalog(
  catalog: ToolCatalogLike,
): PccCapabilityInventoryEntry[] {
  const inventory = new Map<string, PccCapabilityInventoryEntry>();
  for (const group of catalog.groups ?? []) {
    const groupPluginId = group.pluginId?.trim();
    if (group.source === "plugin" && groupPluginId) {
      addPreferredInventoryEntry(inventory, {
        id: groupPluginId,
        kind: "plugin",
        status: "ready",
        ...(group.label?.trim() ? { title: group.label.trim() } : {}),
        reason: "Present in the active runtime tool catalog.",
      });
    }
    for (const tool of group.tools ?? []) {
      const id = tool.id.trim();
      if (!id) {
        continue;
      }
      addPreferredInventoryEntry(inventory, {
        id,
        kind: "tool",
        status: "ready",
        ...(tool.label?.trim() ? { title: tool.label.trim() } : {}),
        reason: "Present in the active runtime tool catalog.",
      });
      const pluginId = tool.pluginId?.trim() || groupPluginId;
      if ((tool.source === "plugin" || group.source === "plugin") && pluginId) {
        addPreferredInventoryEntry(inventory, {
          id: pluginId,
          kind: "plugin",
          status: "ready",
          ...(group.label?.trim() ? { title: group.label.trim() } : {}),
          reason: "Present in the active runtime tool catalog.",
        });
      }
    }
  }
  return [...inventory.values()];
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

function capabilityInventoryKey(kind: PccCapabilityKind, id: string): string {
  return `${kind}:${id.toLowerCase()}`;
}

function buildCapabilityInventoryIndex(
  inventory: readonly PccCapabilityInventoryEntry[],
): ReadonlyMap<string, PccCapabilityInventoryEntry> {
  const index = new Map<string, PccCapabilityInventoryEntry>();
  for (const entry of inventory) {
    const key = capabilityInventoryKey(entry.kind, entry.id);
    // Preserve the previous Array.find contract: the first duplicate wins.
    if (!index.has(key)) {
      index.set(key, entry);
    }
  }
  return index;
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
  const inventoryIndex = buildCapabilityInventoryIndex(inventory);
  const requirementFilter = input.requirementIds ? new Set(input.requirementIds) : null;
  const requirements = input.contract.requirements.filter(
    (requirement) => !requirementFilter || requirementFilter.has(requirement.id),
  );
  const entries = requirements.map((requirement): PccCapabilityResolutionEntry => {
    const found = inventoryIndex.get(capabilityInventoryKey(requirement.kind, requirement.id));
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
