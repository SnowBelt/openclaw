import type {
  PccMilestone,
  PccProject,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";
import type { PccGeneratedMilestone, PccPlanGenerationResult } from "./planning.js";

export const PCC_PLAN_REVISION_SCHEMA_VERSION = 1 as const;

export type PccPlanRevisionMilestoneChange = {
  kind: "add" | "update" | "preserve_completed";
  title: string;
  milestoneId: string | null;
  fields: string[];
  generatedIndex: number;
};

export type PccPlanRevisionPreview = {
  schemaVersion: typeof PCC_PLAN_REVISION_SCHEMA_VERSION;
  id: string;
  projectId: string;
  request: string;
  generatedAt: string;
  sourceModel: string;
  sourceEffort: string;
  beforeFingerprint: string;
  changes: PccPlanRevisionMilestoneChange[];
  addedMilestones: number;
  updatedMilestones: number;
  preservedCompletedMilestones: number;
  addedSubMilestones: number;
  affectedActiveMilestoneIds: string[];
  mustPauseActiveWork: boolean;
  staleProofMilestoneIds: string[];
  integrityErrors: string[];
  safeToApply: boolean;
  rollbackAvailable: true;
  summary: string;
};

function normalizedTitle(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function stableFingerprint(parts: readonly string[]): string {
  let hash = 2166136261;
  for (const character of parts.join("\u241f")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `pcc-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function metadataFingerprintValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function metadataFingerprintFields(metadata: unknown): string[] {
  const source =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  return [
    metadataFingerprintValue(source.pccResponsibility),
    metadataFingerprintValue(source.pccProofLevel),
    metadataFingerprintValue(source.pccExecutionOwner),
    metadataFingerprintValue(source.pccProofRequired),
  ];
}

function generatedPlanIntegrityErrors(plan: PccPlanGenerationResult): string[] {
  const errors: string[] = [];
  const titleCounts = new Map<string, number>();
  for (const milestone of plan.milestones) {
    const title = normalizedTitle(milestone.title);
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }
  for (const [title, count] of titleCounts) {
    if (count > 1) {
      errors.push(`Duplicate generated milestone title: ${title}`);
    }
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (index: number): void => {
    if (visiting.has(index)) {
      errors.push(`Generated milestone dependency cycle includes step ${index + 1}.`);
      return;
    }
    if (visited.has(index)) {
      return;
    }
    visiting.add(index);
    const milestone = plan.milestones[index];
    for (const dependency of milestone?.dependencies ?? []) {
      if (dependency < 0 || dependency >= plan.milestones.length) {
        errors.push(`Generated step ${index + 1} has an invalid dependency.`);
        continue;
      }
      if (dependency === index) {
        errors.push(`Generated step ${index + 1} depends on itself.`);
        continue;
      }
      visit(dependency);
    }
    visiting.delete(index);
    visited.add(index);
  };
  plan.milestones.forEach((_, index) => visit(index));
  return [...new Set(errors)];
}

function changedFields(params: {
  existing: PccMilestone;
  generated: PccGeneratedMilestone;
  existingDependencyTitles: readonly string[];
  generatedDependencyTitles: readonly string[];
  existingSubMilestones: readonly PccSubMilestone[];
}): string[] {
  const { existing, generated } = params;
  const fields: string[] = [];
  if ((existing.implementationPlan ?? "").trim() !== generated.implementationPlan.trim()) {
    fields.push("implementation plan");
  }
  if (
    JSON.stringify(existing.acceptanceCriteria ?? []) !==
    JSON.stringify(generated.acceptanceCriteria)
  ) {
    fields.push("acceptance criteria");
  }
  const metadata =
    existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
      ? existing.metadata
      : {};
  if (metadata.pccResponsibility !== generated.responsibility) {
    fields.push("owner");
  }
  if (metadata.pccProofLevel !== generated.proofLevel) {
    fields.push("proof requirement");
  }
  if (
    JSON.stringify(params.existingDependencyTitles.toSorted()) !==
    JSON.stringify(params.generatedDependencyTitles.toSorted())
  ) {
    fields.push("dependencies");
  }
  const existingSubMilestonesByTitle = new Map(
    params.existingSubMilestones.map((subMilestone) => [
      normalizedTitle(subMilestone.title),
      subMilestone,
    ]),
  );
  const subMilestonesChanged = generated.subMilestones.some((generatedSubMilestone) => {
    const existingSubMilestone = existingSubMilestonesByTitle.get(
      normalizedTitle(generatedSubMilestone.title),
    );
    if (!existingSubMilestone) {
      return true;
    }
    if (existingSubMilestone.status === "complete" || existingSubMilestone.status === "skipped") {
      return false;
    }
    const subMetadata =
      existingSubMilestone.metadata &&
      typeof existingSubMilestone.metadata === "object" &&
      !Array.isArray(existingSubMilestone.metadata)
        ? existingSubMilestone.metadata
        : {};
    return (
      (existingSubMilestone.implementationPlan ?? "").trim() !==
        generatedSubMilestone.implementationPlan.trim() ||
      JSON.stringify(existingSubMilestone.acceptanceCriteria ?? []) !==
        JSON.stringify(generatedSubMilestone.acceptanceCriteria) ||
      subMetadata.pccResponsibility !== generatedSubMilestone.responsibility ||
      subMetadata.pccProofLevel !== generatedSubMilestone.proofLevel
    );
  });
  if (subMilestonesChanged) {
    fields.push("sub-milestones");
  }
  return fields;
}

export function pccProjectPlanFingerprint(
  project: PccProject,
  milestones: readonly PccMilestone[],
  subMilestones: readonly PccSubMilestone[],
): string {
  const parts = [project.id, project.updatedAt, project.title, project.goal ?? "", project.status];
  for (const item of milestones.toSorted(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
  )) {
    parts.push(
      item.id,
      item.updatedAt,
      item.title,
      item.status,
      String(item.order ?? ""),
      item.implementationPlan ?? "",
      JSON.stringify(item.acceptanceCriteria ?? []),
      JSON.stringify((item.dependsOn ?? []).toSorted()),
      ...metadataFingerprintFields(item.metadata),
    );
  }
  for (const item of subMilestones.toSorted(
    (a, b) =>
      a.milestoneId.localeCompare(b.milestoneId) ||
      (a.order ?? 0) - (b.order ?? 0) ||
      a.id.localeCompare(b.id),
  )) {
    parts.push(
      item.id,
      item.updatedAt,
      item.milestoneId,
      item.title,
      item.status,
      String(item.order ?? ""),
      item.implementationPlan ?? "",
      JSON.stringify(item.acceptanceCriteria ?? []),
      ...metadataFingerprintFields(item.metadata),
    );
  }
  return stableFingerprint(parts);
}

export function buildPccPlanRevisionPreview(params: {
  project: PccProject;
  milestones: readonly PccMilestone[];
  subMilestones: readonly PccSubMilestone[];
  request: string;
  plan: PccPlanGenerationResult;
}): PccPlanRevisionPreview {
  const existingByTitle = new Map(
    params.milestones.map((milestone) => [normalizedTitle(milestone.title), milestone]),
  );
  const existingById = new Map(params.milestones.map((milestone) => [milestone.id, milestone]));
  const changes = params.plan.milestones.map((generated, generatedIndex) => {
    const existing = existingByTitle.get(normalizedTitle(generated.title));
    if (!existing) {
      return {
        kind: "add",
        title: generated.title,
        milestoneId: null,
        fields: [
          "milestone",
          "sub-milestones",
          "owner",
          "acceptance criteria",
          "proof requirement",
        ],
        generatedIndex,
      } satisfies PccPlanRevisionMilestoneChange;
    }
    const fields = changedFields({
      existing,
      generated,
      existingDependencyTitles: (existing.dependsOn ?? [])
        .map((dependencyId) => existingById.get(dependencyId)?.title)
        .filter((title): title is string => Boolean(title))
        .map(normalizedTitle),
      generatedDependencyTitles: generated.dependencies
        .map((dependencyIndex) => params.plan.milestones[dependencyIndex]?.title)
        .filter((title): title is string => Boolean(title))
        .map(normalizedTitle),
      existingSubMilestones: params.subMilestones.filter(
        (subMilestone) => subMilestone.milestoneId === existing.id,
      ),
    });
    const completed = existing.status === "complete" || existing.status === "skipped";
    return {
      kind: completed ? "preserve_completed" : "update",
      title: generated.title,
      milestoneId: existing.id,
      fields,
      generatedIndex,
    } satisfies PccPlanRevisionMilestoneChange;
  });
  const changedExisting = changes.filter(
    (change) => change.kind === "update" && change.fields.length > 0 && change.milestoneId,
  );
  const affectedActiveMilestoneIds = changedExisting
    .map((change) => change.milestoneId)
    .filter((id): id is string => Boolean(id))
    .filter((id) => {
      const milestone = params.milestones.find((item) => item.id === id);
      return milestone?.status === "in_progress";
    });
  const staleProofMilestoneIds = changedExisting
    .filter((change) =>
      change.fields.some(
        (field) =>
          field === "acceptance criteria" ||
          field === "proof requirement" ||
          field === "dependencies" ||
          field === "sub-milestones",
      ),
    )
    .map((change) => change.milestoneId)
    .filter((id): id is string => Boolean(id));
  const integrityErrors = generatedPlanIntegrityErrors(params.plan);
  const addedMilestones = changes.filter((change) => change.kind === "add").length;
  const updatedMilestones = changedExisting.length;
  const preservedCompletedMilestones = changes.filter(
    (change) => change.kind === "preserve_completed",
  ).length;
  const addedSubMilestones = changes
    .filter((change) => change.kind !== "preserve_completed")
    .reduce((total, change) => {
      const generatedSubMilestones =
        params.plan.milestones[change.generatedIndex]?.subMilestones ?? [];
      if (change.kind === "add" || !change.milestoneId) {
        return total + generatedSubMilestones.length;
      }
      const existingTitles = new Set(
        params.subMilestones
          .filter((subMilestone) => subMilestone.milestoneId === change.milestoneId)
          .map((subMilestone) => normalizedTitle(subMilestone.title)),
      );
      return (
        total +
        generatedSubMilestones.filter(
          (subMilestone) => !existingTitles.has(normalizedTitle(subMilestone.title)),
        ).length
      );
    }, 0);
  const request = params.request.trim();
  const generatedAt = params.plan.provenance.generatedAt;
  return {
    schemaVersion: PCC_PLAN_REVISION_SCHEMA_VERSION,
    id: `pcc-plan-revision-${params.project.id}-${generatedAt}`.replace(/[^a-zA-Z0-9._-]/gu, "-"),
    projectId: params.project.id,
    request,
    generatedAt,
    sourceModel: params.plan.provenance.model,
    sourceEffort: params.plan.provenance.effort,
    beforeFingerprint: pccProjectPlanFingerprint(
      params.project,
      params.milestones,
      params.subMilestones,
    ),
    changes,
    addedMilestones,
    updatedMilestones,
    preservedCompletedMilestones,
    addedSubMilestones,
    affectedActiveMilestoneIds,
    mustPauseActiveWork: affectedActiveMilestoneIds.length > 0,
    staleProofMilestoneIds,
    integrityErrors,
    safeToApply: request.length > 0 && integrityErrors.length === 0,
    rollbackAvailable: true,
    summary: `${addedMilestones} milestone${addedMilestones === 1 ? "" : "s"} added, ${updatedMilestones} updated, and ${preservedCompletedMilestones} completed milestone${preservedCompletedMilestones === 1 ? "" : "s"} protected.`,
  };
}
