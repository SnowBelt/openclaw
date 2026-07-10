import type {
  PccMilestone,
  PccProject,
  PccProjectSummary,
  PccStatus,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";

type PccWorkItem = PccMilestone | PccSubMilestone;
export type PccWorkScope = "pcc_product" | "project_work";

const TERMINAL_WORK_STATUSES = new Set<PccStatus>([
  "complete",
  "complete_with_maintenance",
  "skipped",
  "archived",
]);

const STATUSES_NOT_REQUIRING_UPDATE = new Set<PccStatus>([
  ...TERMINAL_WORK_STATUSES,
  "on_hold",
  "deferred",
]);

export function pccProjectIsStale(
  status: PccStatus,
  updatedAt: string | undefined,
  nowMs = Date.now(),
  maxAgeDays = 14,
): boolean {
  if (STATUSES_NOT_REQUIRING_UPDATE.has(status)) {
    return false;
  }
  const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  return Number.isFinite(updatedMs) && nowMs - updatedMs > maxAgeDays * 24 * 60 * 60 * 1_000;
}

export function pccMetadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedScopeString(value: unknown): string {
  return trimmedString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function normalizePccWorkScope(value: unknown): PccWorkScope | "" {
  const raw = normalizedScopeString(value);
  if (!raw) {
    return "";
  }
  if (raw === "pcc_product" || raw === "pcc" || raw.includes("pcc_product")) {
    return "pcc_product";
  }
  if (
    raw === "project_work" ||
    raw === "active_project_work" ||
    raw.includes("project_specific") ||
    raw.includes("excluded_from_pcc_product") ||
    raw.includes("active_project_work")
  ) {
    return "project_work";
  }
  return "";
}

export function pccWorkScopeForProject(
  project: { id: string; metadata?: unknown; title?: string } & Partial<
    Pick<
      PccProjectSummary,
      "excludedFromPccProductCompletion" | "pccCurrentScope" | "pccProductScope" | "pccWorkScope"
    >
  >,
): PccWorkScope {
  const metadata = pccMetadataObject(project.metadata);
  if (
    project.id === "project-command-center" ||
    trimmedString(project.title) === "Project Command Center"
  ) {
    return "pcc_product";
  }
  const direct =
    normalizePccWorkScope(project.pccWorkScope) || normalizePccWorkScope(metadata.pccWorkScope);
  if (direct) {
    return direct;
  }
  if (
    project.excludedFromPccProductCompletion === true ||
    metadata.excludedFromPccProductCompletion === true
  ) {
    return "project_work";
  }
  const legacyScope =
    normalizePccWorkScope(project.pccCurrentScope) ||
    normalizePccWorkScope(project.pccProductScope) ||
    normalizePccWorkScope(metadata.pccCurrentScope) ||
    normalizePccWorkScope(metadata.pccProductScope);
  return legacyScope || "project_work";
}

export function pccWorkScopeLabel(scope: PccWorkScope): string {
  return scope === "pcc_product" ? "PCC Product" : "Project Work";
}

export function canonicalizePccProjectForWrite<TProject extends PccProject>(
  project: TProject,
  now: string,
): TProject {
  const metadata = { ...pccMetadataObject(project.metadata) };
  const scope = pccWorkScopeForProject(project);
  if (metadata.pccWorkScope === scope) {
    return project;
  }
  return {
    ...project,
    metadata: {
      ...metadata,
      pccWorkScope: scope,
      pccScopeCanonicalizedAt: now,
    },
  };
}

function hasCriteria(value: unknown): value is string[] {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim());
}

export function normalizePccResponsibility(value: unknown): string {
  const raw = trimmedString(value).toLowerCase();
  if (!raw) {
    return "";
  }
  if (raw.includes("local") && raw.includes("model")) {
    return "local_model";
  }
  if (raw.includes("codex") && (raw.includes("high") || raw.includes("reasoning"))) {
    return "high_reasoning_codex";
  }
  if (raw.includes("codex")) {
    return "codex";
  }
  if (raw.includes("remote")) {
    return "remote_proof";
  }
  if (raw.includes("user")) {
    return "user";
  }
  return "local_openclaw_agent";
}

export function normalizePccProofLevel(value: unknown): string {
  const raw = trimmedString(value).toLowerCase();
  if (!raw) {
    return "";
  }
  if (raw === "none" || raw.includes("not required")) {
    return "none";
  }
  if (raw.includes("planned")) {
    return "planned";
  }
  if (raw.includes("browser")) {
    return "browser_proof";
  }
  if (raw.includes("screenshot")) {
    return "screenshot";
  }
  if (raw.includes("git") || raw.includes("commit")) {
    return "git_commit";
  }
  if (raw.includes("backup")) {
    return "backup";
  }
  if (raw.includes("receipt")) {
    return "receipt";
  }
  if (raw.includes("source")) {
    return "external_source";
  }
  if (raw.includes("manual") || raw.includes("approval") || raw.includes("review")) {
    return "manual_review";
  }
  if (raw.includes("runtime") || raw.includes("proof") || raw.includes("test")) {
    return "local";
  }
  return "local";
}

export function pccResponsibilityForItem(item: PccWorkItem): string {
  const metadata = pccMetadataObject(item.metadata);
  return (
    normalizePccResponsibility(metadata.pccResponsibility) ||
    normalizePccResponsibility(metadata.recommendedWorker) ||
    normalizePccResponsibility(metadata.pccRecommendedWorker) ||
    normalizePccResponsibility(metadata.recommendedLane) ||
    normalizePccResponsibility(item.owner) ||
    ""
  );
}

export function pccProofLevelForItem(item: PccWorkItem): string {
  const metadata = pccMetadataObject(item.metadata);
  return (
    normalizePccProofLevel(metadata.pccProofLevel) ||
    normalizePccProofLevel(metadata.proofRequired) ||
    normalizePccProofLevel(metadata.requiredProof) ||
    ""
  );
}

function defaultImplementationPlan(item: PccWorkItem): string {
  return [
    `Complete: ${item.title}.`,
    "Follow the project workflow and listed sub-milestones in order.",
    "Stop and record an exact blocker if a required permission, tool, source, or proof surface is missing.",
  ].join("\n");
}

function defaultAcceptanceCriteria(item: PccWorkItem): string[] {
  return [
    `${item.title} has an observable result or exact blocker.`,
    "Required proof is attached before completion.",
  ];
}

export function canonicalizePccWorkItemForWrite<TItem extends PccWorkItem>(
  item: TItem,
  now: string,
): TItem {
  if (TERMINAL_WORK_STATUSES.has(item.status)) {
    return item;
  }
  const metadata = { ...pccMetadataObject(item.metadata) };
  const responsibility = pccResponsibilityForItem(item) || "local_openclaw_agent";
  const proofLevel = pccProofLevelForItem(item) || "local";
  let changed = false;

  if (metadata.pccResponsibility !== responsibility) {
    metadata.pccResponsibility = responsibility;
    changed = true;
  }
  if (metadata.pccProofLevel !== proofLevel) {
    metadata.pccProofLevel = proofLevel;
    changed = true;
  }

  const next: TItem = {
    ...item,
    ...(trimmedString(item.implementationPlan)
      ? {}
      : { implementationPlan: defaultImplementationPlan(item) }),
    ...(hasCriteria(item.acceptanceCriteria)
      ? {}
      : { acceptanceCriteria: defaultAcceptanceCriteria(item) }),
    metadata: changed
      ? {
          ...metadata,
          pccCanonicalizedAt: now,
        }
      : metadata,
  };
  return next;
}

export type PccCanonicalRepairResult<TItem extends PccWorkItem> = {
  items: TItem[];
  repairedIds: string[];
};

export function repairPccCanonicalWorkItems<TItem extends PccWorkItem>(
  items: readonly TItem[],
  now: string,
): PccCanonicalRepairResult<TItem> {
  const repairedIds: string[] = [];
  const nextItems = items.map((item) => {
    const next = canonicalizePccWorkItemForWrite(item, now);
    if (JSON.stringify(next) !== JSON.stringify(item)) {
      repairedIds.push(item.id);
    }
    return next;
  });
  return { items: nextItems, repairedIds };
}
