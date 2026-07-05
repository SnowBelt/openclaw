import type {
  PccMilestone,
  PccStatus,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";

type PccWorkItem = PccMilestone | PccSubMilestone;

const TERMINAL_WORK_STATUSES = new Set<PccStatus>([
  "complete",
  "complete_with_maintenance",
  "skipped",
  "archived",
]);

export function pccMetadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
