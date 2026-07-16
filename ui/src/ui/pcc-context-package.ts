// Project Command Center context packages provide deterministic handoff text for agents.
import { pccProofLevelForItem, pccResponsibilityForItem } from "../../../src/pcc/metadata.js";
import { getPccWorkLoopNext } from "../../../src/pcc/work-loop.js";
import type { PccProjectDetail } from "./pcc/application/state.ts";
import type {
  PccCompletionReceipt,
  PccEvidence,
  PccMilestone,
  PccSubMilestone,
  PccPermissionGrant,
} from "./types.ts";

export type PccContextPackageMode = "compact" | "full";

export type PccContextPackageOptions = {
  mode?: PccContextPackageMode;
};

function formatStatus(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return "Not recorded";
  }
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function sortMilestones(milestones: readonly PccMilestone[]): PccMilestone[] {
  return milestones.toSorted(
    (a, b) =>
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      a.title.localeCompare(b.title),
  );
}

function subMilestonesForMilestone(
  detail: PccProjectDetail,
  milestone: PccMilestone,
): PccSubMilestone[] {
  return (detail.subMilestones ?? [])
    .filter((subMilestone) => subMilestone.milestoneId === milestone.id)
    .toSorted(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.title.localeCompare(b.title),
    );
}

function receiptSummaries(receipts: readonly PccCompletionReceipt[]): string[] {
  const summaries: string[] = [];
  for (const receipt of receipts) {
    summaries.push(`${receipt.summary} Proof=${formatStatus(receipt.proofLevel)}.`);
    for (const note of receipt.doNotRedo ?? []) {
      summaries.push(`Do not redo: ${note}`);
    }
    for (const gap of receipt.followUpGaps ?? []) {
      summaries.push(`Follow-up gap: ${gap}`);
    }
  }
  return summaries;
}

function evidenceForMilestone(detail: PccProjectDetail, milestone: PccMilestone): PccEvidence[] {
  return detail.evidence.filter((item) => item.milestoneId === milestone.id);
}

function permissionsForMilestone(
  detail: PccProjectDetail,
  milestone: PccMilestone,
): PccPermissionGrant[] {
  return detail.permissions.filter(
    (permission) =>
      permission.milestoneId === milestone.id ||
      milestone.permissionGrantIds?.includes(permission.id),
  );
}

function receiptsForMilestone(
  detail: PccProjectDetail,
  milestone: PccMilestone,
): PccCompletionReceipt[] {
  return detail.receipts.filter(
    (receipt) => receipt.milestoneId === milestone.id || milestone.receiptIds?.includes(receipt.id),
  );
}

function pushList(lines: string[], title: string, values: readonly string[], empty: string): void {
  lines.push(title);
  if (values.length === 0) {
    lines.push(`- ${empty}`);
    return;
  }
  for (const value of values) {
    lines.push(`- ${value}`);
  }
}

function milestoneWorker(milestone: PccMilestone): string {
  return pccResponsibilityForItem(milestone) || "local_openclaw_agent";
}

function milestoneCostRisk(milestone: PccMilestone): string {
  return metadataString(metadataObject(milestone.metadata).pccCostRisk, "low");
}

function milestoneProofGaps(detail: PccProjectDetail, milestone: PccMilestone): string[] {
  const evidence = evidenceForMilestone(detail, milestone);
  const required = milestone.requiredEvidenceIds ?? [];
  const missingRequired = required.filter((id) => !evidence.some((item) => item.id === id));
  const failedEvidence = evidence
    .filter((item) => item.status === "failed" || item.status === "blocked")
    .map(
      (item) =>
        `${formatStatus(item.kind)} ${formatStatus(item.status)}: ${item.summary ?? item.id}`,
    );
  return [
    ...missingRequired.map((id) => `Required evidence missing: ${id}`),
    ...failedEvidence,
    ...(detail.summary.proofGaps ?? []),
  ].filter(Boolean);
}

function renderMilestoneBlock(
  detail: PccProjectDetail,
  milestone: PccMilestone,
  options: { includeTaskPrompt: boolean },
): string[] {
  const permissions = permissionsForMilestone(detail, milestone);
  const receipts = receiptsForMilestone(detail, milestone);
  const evidence = evidenceForMilestone(detail, milestone);
  const proofGaps = milestoneProofGaps(detail, milestone);
  const lines = [
    `## Milestone: ${milestone.title}`,
    `Status: ${formatStatus(milestone.status)}`,
    `Phase: ${milestone.phaseId || "Not assigned"}`,
    `Worker: ${milestoneWorker(milestone)}`,
    `Token/cost risk: ${milestoneCostRisk(milestone)}`,
    `Completion: ${milestone.percentComplete ?? 0}%`,
    "",
    "Implementation plan:",
    milestone.implementationPlan?.trim() || "Missing implementation plan.",
    "",
  ];
  pushList(
    lines,
    "Acceptance criteria:",
    milestone.acceptanceCriteria ?? [],
    "No acceptance criteria recorded.",
  );
  const subMilestones = subMilestonesForMilestone(detail, milestone);
  if (subMilestones.length > 0) {
    lines.push("", "Sub-milestones:");
    for (const subMilestone of subMilestones) {
      lines.push(
        `- ${subMilestone.title} — ${formatStatus(subMilestone.status)}; worker=${pccResponsibilityForItem(subMilestone) || "local_openclaw_agent"}; proof=${pccProofLevelForItem(subMilestone) || metadataString(metadataObject(subMilestone.metadata).proofRequired, "not recorded")}`,
      );
      if (options.includeTaskPrompt) {
        lines.push(`  Plan: ${subMilestone.implementationPlan || "Missing implementation plan."}`);
        for (const criterion of subMilestone.acceptanceCriteria ?? []) {
          lines.push(`  Acceptance: ${criterion}`);
        }
      }
    }
  }
  lines.push("");
  pushList(
    lines,
    "Blockers:",
    milestone.blocker ? [milestone.blocker] : [],
    "No blocker recorded.",
  );
  lines.push("");
  pushList(
    lines,
    "Permissions:",
    permissions.map(
      (permission) =>
        `${formatStatus(permission.type)} ${formatStatus(permission.status)}; allowed=${permission.allowedActions.join(", ") || "none"}; target=${permission.target || "not specified"}`,
    ),
    "No permission needed or recorded.",
  );
  lines.push("");
  pushList(
    lines,
    "Proof required / gaps:",
    proofGaps,
    evidence.length > 0
      ? "No open proof gap from recorded evidence."
      : "No proof evidence recorded yet.",
  );
  lines.push("");
  pushList(
    lines,
    "Completion receipts / do-not-redo:",
    receiptSummaries(receipts),
    "No completion receipt recorded.",
  );
  if (options.includeTaskPrompt) {
    const next = getPccWorkLoopNext({
      project: detail.project,
      milestones: detail.milestones,
      permissions: detail.permissions,
      receipts: detail.receipts,
      subMilestones: detail.subMilestones ?? [],
    });
    if (next.milestone?.id === milestone.id && next.taskPrompt) {
      lines.push("", "Task prompt preview:", next.taskPrompt);
    }
  }
  return lines;
}

export function buildPccContextPackage(
  detail: PccProjectDetail,
  options: PccContextPackageOptions = {},
): string {
  const mode = options.mode ?? "compact";
  const next = getPccWorkLoopNext({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    receipts: detail.receipts,
  });
  const sorted = sortMilestones(detail.milestones);
  const nextMilestone =
    next.milestone ?? sorted.find((milestone) => milestone.status !== "complete");
  const milestones = mode === "full" ? sorted : nextMilestone ? [nextMilestone] : [];
  const lines = [
    "# Project Command Center handoff packet",
    `Mode: ${mode}`,
    `Project: ${detail.project.title}`,
    `Goal: ${detail.project.goal || "No project goal recorded."}`,
    `Project status: ${formatStatus(detail.project.status)}`,
    `Project completion: ${detail.summary.percentComplete}%`,
    `Next milestone: ${nextMilestone?.title ?? "No eligible milestone"}`,
    `Next sub-milestone: ${next.subMilestone?.title ?? "No eligible sub-milestone"}`,
    `Runner state: ${formatStatus(next.state)}`,
    `Runner message: ${next.blocker?.message ?? "No runner blocker."}`,
    "",
  ];
  pushList(
    lines,
    "Portfolio next actions:",
    detail.summary.nextActions,
    "No next action recorded.",
  );
  lines.push("");
  pushList(
    lines,
    "Project proof gaps:",
    detail.summary.proofGaps,
    "No project proof gap recorded.",
  );
  for (const milestone of milestones) {
    lines.push(
      "",
      ...renderMilestoneBlock(detail, milestone, { includeTaskPrompt: mode === "full" }),
    );
  }
  if (mode === "full") {
    lines.push(
      "",
      "## Execution rules",
      "- Do not mark any milestone complete without receipt-backed evidence.",
      "- Stop before Codex, high-reasoning, remote proof, destructive, publish, or runtime actions unless permission is granted.",
      "- If proof fails, report the exact failed command, blocker, and missing proof.",
    );
  }
  return `${lines.join("\n").trim()}\n`;
}
