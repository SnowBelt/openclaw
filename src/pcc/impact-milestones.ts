// Project Command Center impact milestone helpers turn ledger data into skimmable operator guidance.
import type {
  PccCompletionReceipt,
  PccEvidence,
  PccMilestone,
  PccPermissionGrant,
  PccProject,
  PccProjectSummary,
  PccStatus,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";
import { evaluatePccProjectSetup } from "./intake-quality.js";
import { getPccWorkLoopNext } from "./work-loop.js";

export type PccImpactDetailInput = {
  project: PccProject;
  milestones: readonly PccMilestone[];
  subMilestones?: readonly PccSubMilestone[];
  permissions?: readonly PccPermissionGrant[];
  evidence?: readonly PccEvidence[];
  receipts?: readonly PccCompletionReceipt[];
  summary?: PccProjectSummary;
};

export type PccReadinessBadge =
  | "Ready for local model"
  | "Needs detail"
  | "Needs permission"
  | "Needs Codex"
  | "Proof missing";

export type PccMilestoneReadiness = {
  milestoneId: string;
  title: string;
  score: number;
  badge: PccReadinessBadge;
  gaps: string[];
  nextWorker: string;
};

export type PccAttentionItem = {
  id: string;
  projectId: string;
  projectTitle: string;
  title: string;
  reason: string;
  category: "blocked" | "permission" | "codex" | "proof" | "quality" | "recovery" | "integrity";
  severity: "critical" | "high" | "medium" | "low";
};

export type PccFreshnessItem = {
  id: string;
  title: string;
  status: "fresh" | "missing" | "stale" | "not_required";
  reason: string;
};

export type PccRecoveryPlaybook = {
  id: string;
  title: string;
  reason: string;
  nextAction: string;
  requiresPermission: boolean;
};

export type PccIntegrityFinding = {
  id: string;
  title: string;
  reason: string;
  severity: "critical" | "high" | "medium" | "low";
  repair: string;
};

export type PccDependencyInsight = {
  criticalPathTitle: string;
  blockedCount: number;
  readyCount: number;
  cycleDetected: boolean;
  notes: string[];
};

export type PccTimelineItem = {
  id: string;
  title: string;
  kind: "receipt" | "evidence";
  at: string;
  summary: string;
};

export type PccImportPreview = {
  title: string;
  proposedMilestones: string[];
  missingFields: string[];
  destructive: false;
};

const TERMINAL_STATUSES = new Set<PccStatus>([
  "complete",
  "complete_with_maintenance",
  "skipped",
  "archived",
]);
const BLOCKED_STATUSES = new Set<PccStatus>([
  "blocked",
  "failed",
  "on_hold",
  "deferred",
  "needs_approval",
]);
const CODEX_RESPONSIBILITIES = new Set(["codex", "high_reasoning_codex", "remote_proof"]);

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function responsibilityFor(item: { owner?: string; metadata?: Record<string, unknown> }): string {
  const metadata = metadataRecord(item.metadata);
  return (
    metadataString(metadata, "pccResponsibility") ??
    metadataString(metadata, "recommendedLane") ??
    item.owner ??
    "local_openclaw_agent"
  );
}

function proofRequiredFor(item: {
  requiredEvidenceIds?: string[];
  receiptIds?: string[];
  metadata?: Record<string, unknown>;
}): boolean {
  const metadata = metadataRecord(item.metadata);
  return Boolean(
    item.requiredEvidenceIds?.length ||
    item.receiptIds?.length ||
    metadataString(metadata, "pccProofLevel") ||
    metadataString(metadata, "proofRequired"),
  );
}

function hasReceipt(
  item: { id: string; receiptIds?: string[] },
  receipts: readonly PccCompletionReceipt[],
): boolean {
  if (item.receiptIds?.length) {
    return true;
  }
  return receipts.some((receipt) => receipt.milestoneId === item.id);
}

function hasMissingPermission(
  item: { permissionGrantIds?: string[] },
  permissions: readonly PccPermissionGrant[],
): boolean {
  const scoped = item.permissionGrantIds?.length
    ? permissions.filter((permission) => item.permissionGrantIds?.includes(permission.id))
    : [];
  return scoped.some(
    (permission) => permission.status === "needed" || permission.status === "blocked",
  );
}

function orderedMilestones(input: PccImpactDetailInput): PccMilestone[] {
  return [...input.milestones].toSorted((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
}

function normalizedTitle(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function duplicateGroups<T>(items: readonly T[], keyFor: (item: T) => string): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item);
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

export function buildPccIntegrityFindings(input: PccImpactDetailInput): PccIntegrityFinding[] {
  const findings: PccIntegrityFinding[] = [];
  const milestoneIds = new Set(input.milestones.map((milestone) => milestone.id));
  const subMilestones = input.subMilestones ?? [];
  const projectId = input.project.id;

  for (const milestone of input.milestones) {
    if (milestone.projectId !== projectId) {
      findings.push({
        id: `milestone-project:${milestone.id}`,
        title: `Milestone outside project: ${milestone.title}`,
        reason: `Milestone belongs to ${milestone.projectId}, not ${projectId}.`,
        severity: "critical",
        repair: "Move the milestone to the correct project or remove it from this project detail.",
      });
    }
    for (const dependencyId of milestone.dependsOn ?? []) {
      if (!milestoneIds.has(dependencyId)) {
        findings.push({
          id: `milestone-dependency:${milestone.id}:${dependencyId}`,
          title: `Broken dependency: ${milestone.title}`,
          reason: `Depends on missing milestone ${dependencyId}.`,
          severity: "high",
          repair:
            "Reconnect the dependency to an existing milestone or remove the stale dependency.",
        });
      }
    }
  }

  for (const subMilestone of subMilestones) {
    if (subMilestone.projectId !== projectId) {
      findings.push({
        id: `sub-project:${subMilestone.id}`,
        title: `Sub-milestone outside project: ${subMilestone.title}`,
        reason: `Sub-milestone belongs to ${subMilestone.projectId}, not ${projectId}.`,
        severity: "critical",
        repair:
          "Move the sub-milestone to the correct project or remove it from this project detail.",
      });
    }
    if (!milestoneIds.has(subMilestone.milestoneId)) {
      findings.push({
        id: `sub-orphan:${subMilestone.id}`,
        title: `Orphaned sub-milestone: ${subMilestone.title}`,
        reason: `Parent milestone ${subMilestone.milestoneId} does not exist.`,
        severity: "critical",
        repair: "Attach the sub-milestone to an existing milestone or archive it.",
      });
    }
    for (const dependencyId of subMilestone.dependsOn ?? []) {
      if (
        !milestoneIds.has(dependencyId) &&
        !subMilestones.some((item) => item.id === dependencyId)
      ) {
        findings.push({
          id: `sub-dependency:${subMilestone.id}:${dependencyId}`,
          title: `Broken sub-milestone dependency: ${subMilestone.title}`,
          reason: `Depends on missing item ${dependencyId}.`,
          severity: "high",
          repair: "Reconnect the dependency to an existing milestone/sub-milestone or remove it.",
        });
      }
    }
  }

  for (const title of duplicateGroups(input.milestones, (milestone) =>
    normalizedTitle(milestone.title),
  )) {
    findings.push({
      id: `milestone-title:${title}`,
      title: `Duplicate milestone title: ${title}`,
      reason:
        "Two or more milestones use the same title, which makes handoffs and receipts ambiguous.",
      severity: "medium",
      repair: "Rename one milestone so each active milestone is uniquely identifiable.",
    });
  }

  for (const order of duplicateGroups(input.milestones, (milestone) =>
    String(milestone.order ?? ""),
  )) {
    findings.push({
      id: `milestone-order:${order}`,
      title: `Duplicate milestone order: ${order}`,
      reason: "Two or more milestones share the same sequence slot.",
      severity: "medium",
      repair: "Use milestone reorder controls to save a unique sequence.",
    });
  }

  for (const milestone of input.milestones) {
    const children = subMilestones.filter(
      (subMilestone) => subMilestone.milestoneId === milestone.id,
    );
    for (const title of duplicateGroups(children, (subMilestone) =>
      normalizedTitle(subMilestone.title),
    )) {
      findings.push({
        id: `sub-title:${milestone.id}:${title}`,
        title: `Duplicate sub-milestone title: ${title}`,
        reason: `Two or more sub-milestones under ${milestone.title} use the same title.`,
        severity: "medium",
        repair: "Rename one sub-milestone so each active sub-step is uniquely identifiable.",
      });
    }
    for (const order of duplicateGroups(children, (subMilestone) =>
      String(subMilestone.order ?? ""),
    )) {
      findings.push({
        id: `sub-order:${milestone.id}:${order}`,
        title: `Duplicate sub-milestone order: ${milestone.title}`,
        reason: `Two or more sub-milestones share sequence slot ${order}.`,
        severity: "medium",
        repair: "Use sub-milestone reorder controls to save a unique sequence.",
      });
    }
  }

  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return findings.toSorted((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

function activeSubMilestones(input: PccImpactDetailInput, milestoneId: string): PccSubMilestone[] {
  return (input.subMilestones ?? [])
    .filter((sub) => sub.milestoneId === milestoneId && !TERMINAL_STATUSES.has(sub.status))
    .toSorted((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
}

export function buildPccMilestoneReadiness(input: PccImpactDetailInput): PccMilestoneReadiness[] {
  const permissions = input.permissions ?? [];
  const receipts = input.receipts ?? [];
  return orderedMilestones(input).map((milestone) => {
    const gaps: string[] = [];
    let score = 100;
    const responsibility = responsibilityFor(milestone);
    const subs = activeSubMilestones(input, milestone.id);
    const terminal = TERMINAL_STATUSES.has(milestone.status);
    if (!milestone.implementationPlan?.trim() && !terminal) {
      gaps.push("Implementation plan missing");
      score -= 20;
    }
    if (!milestone.acceptanceCriteria?.length && !terminal) {
      gaps.push("Acceptance criteria missing");
      score -= 20;
    }
    if (!proofRequiredFor(milestone) && !terminal) {
      gaps.push("Proof requirement missing");
      score -= 15;
    }
    if (!subs.length && !terminal) {
      gaps.push("Sub-milestones missing");
      score -= 15;
    }
    for (const sub of subs.slice(0, 3)) {
      if (!sub.implementationPlan?.trim() || !sub.acceptanceCriteria?.length) {
        gaps.push(`Sub-milestone needs detail: ${sub.title}`);
        score -= 5;
      }
    }
    if (hasMissingPermission(milestone, permissions)) {
      gaps.push("Permission needed");
      score = Math.min(score, 65);
    }
    if (milestone.status === "complete" && !hasReceipt(milestone, receipts)) {
      gaps.push("Completion receipt missing");
      score = Math.min(score, 85);
    }
    score = Math.max(0, Math.min(100, score));
    const badge: PccReadinessBadge = hasMissingPermission(milestone, permissions)
      ? "Needs permission"
      : CODEX_RESPONSIBILITIES.has(responsibility)
        ? "Needs Codex"
        : gaps.some(
              (gap) => gap.toLowerCase().includes("proof") || gap.toLowerCase().includes("receipt"),
            )
          ? "Proof missing"
          : score >= 90
            ? "Ready for local model"
            : "Needs detail";
    return {
      milestoneId: milestone.id,
      title: milestone.title,
      score,
      badge,
      gaps: gaps.slice(0, 6),
      nextWorker: responsibility,
    };
  });
}

export function buildPccAttentionInbox(
  details: readonly PccImpactDetailInput[],
): PccAttentionItem[] {
  const items: PccAttentionItem[] = [];
  for (const detail of details) {
    const projectTitle = detail.project.title;
    for (const finding of buildPccIntegrityFindings(detail).slice(0, 3)) {
      items.push({
        id: `${detail.project.id}:integrity:${finding.id}`,
        projectId: detail.project.id,
        projectTitle,
        title: finding.title,
        reason: finding.reason,
        category: "integrity",
        severity: finding.severity === "critical" ? "critical" : "high",
      });
    }
    if (BLOCKED_STATUSES.has(detail.project.status)) {
      items.push({
        id: `${detail.project.id}:project-status`,
        projectId: detail.project.id,
        projectTitle,
        title: `${projectTitle} needs review`,
        reason: `Project status is ${detail.project.status}.`,
        category: detail.project.status === "needs_approval" ? "permission" : "blocked",
        severity:
          detail.project.status === "blocked" || detail.project.status === "failed"
            ? "critical"
            : "high",
      });
    }
    for (const permission of detail.permissions ?? []) {
      if (permission.status === "needed" || permission.status === "blocked") {
        items.push({
          id: `${detail.project.id}:permission:${permission.id}`,
          projectId: detail.project.id,
          projectTitle,
          title: `${projectTitle} needs permission`,
          reason: `${permission.type} permission is ${permission.status}.`,
          category: "permission",
          severity:
            permission.riskLevel === "critical" || permission.riskLevel === "high"
              ? "critical"
              : "high",
        });
      }
    }
    for (const milestone of orderedMilestones(detail)) {
      if (BLOCKED_STATUSES.has(milestone.status)) {
        items.push({
          id: `${detail.project.id}:milestone:${milestone.id}`,
          projectId: detail.project.id,
          projectTitle,
          title: milestone.title,
          reason: milestone.blocker || `Milestone status is ${milestone.status}.`,
          category: milestone.status === "needs_approval" ? "permission" : "blocked",
          severity:
            milestone.status === "blocked" || milestone.status === "failed" ? "critical" : "high",
        });
      }
    }
    for (const gap of detail.summary?.proofGaps ?? []) {
      items.push({
        id: `${detail.project.id}:proof:${gap}`,
        projectId: detail.project.id,
        projectTitle,
        title: `${projectTitle} proof gap`,
        reason: gap,
        category: "proof",
        severity: "medium",
      });
    }
    const setup = evaluatePccProjectSetup({
      project: detail.project,
      milestones: detail.milestones,
      subMilestones: detail.subMilestones ?? [],
    });
    if (!setup.runnable) {
      items.push({
        id: `${detail.project.id}:quality`,
        projectId: detail.project.id,
        projectTitle,
        title: `${projectTitle} setup quality`,
        reason:
          setup.missing[0] ?? setup.violations[0] ?? setup.needsReview[0] ?? "Setup needs review.",
        category: "quality",
        severity: setup.score < 60 ? "high" : "medium",
      });
    }
  }
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return items.toSorted((a, b) => severityRank[a.severity] - severityRank[b.severity]).slice(0, 8);
}

export function buildPccProofFreshness(input: PccImpactDetailInput): PccFreshnessItem[] {
  const receipts = input.receipts ?? [];
  const evidence = input.evidence ?? [];
  return orderedMilestones(input).map((milestone) => {
    if (milestone.status === "skipped" || milestone.status === "archived") {
      return {
        id: milestone.id,
        title: milestone.title,
        status: "not_required",
        reason: "Milestone is not active.",
      };
    }
    const relatedReceipts = receipts.filter((receipt) => receipt.milestoneId === milestone.id);
    const relatedEvidence = evidence.filter((item) => item.milestoneId === milestone.id);
    if (milestone.status === "complete" || milestone.status === "complete_with_maintenance") {
      if (!relatedReceipts.length && !milestone.receiptIds?.length) {
        return {
          id: milestone.id,
          title: milestone.title,
          status: "missing",
          reason: "Complete milestone has no receipt.",
        };
      }
      const newestReceipt =
        relatedReceipts
          .map((receipt) => Date.parse(receipt.completedAt))
          .filter(Number.isFinite)
          .toSorted((a, b) => b - a)[0] ?? 0;
      const updated = Date.parse(milestone.updatedAt) || 0;
      return newestReceipt && newestReceipt < updated
        ? {
            id: milestone.id,
            title: milestone.title,
            status: "stale",
            reason: "Milestone changed after latest receipt.",
          }
        : {
            id: milestone.id,
            title: milestone.title,
            status: "fresh",
            reason: "Receipt-backed completion is current.",
          };
    }
    if (milestone.requiredEvidenceIds?.length && !relatedEvidence.length) {
      return {
        id: milestone.id,
        title: milestone.title,
        status: "missing",
        reason: "Required evidence is not attached yet.",
      };
    }
    return relatedEvidence.some((item) => item.status === "passed")
      ? {
          id: milestone.id,
          title: milestone.title,
          status: "fresh",
          reason: "Passing evidence is attached.",
        }
      : {
          id: milestone.id,
          title: milestone.title,
          status: "missing",
          reason: "Proof still needs to be collected.",
        };
  });
}

export function buildPccRecoveryPlaybooks(input: PccImpactDetailInput): PccRecoveryPlaybook[] {
  const text = [
    input.project.status,
    input.project.goal ?? "",
    ...input.milestones.map(
      (milestone) => `${milestone.status} ${milestone.blocker ?? ""} ${milestone.title}`,
    ),
    ...(input.summary?.proofGaps ?? []),
  ]
    .join("\n")
    .toLowerCase();
  const playbooks: PccRecoveryPlaybook[] = [];
  const add = (
    id: string,
    title: string,
    reason: string,
    nextAction: string,
    requiresPermission = false,
  ) => {
    if (!playbooks.some((playbook) => playbook.id === id)) {
      playbooks.push({ id, title, reason, nextAction, requiresPermission });
    }
  };
  if (text.includes("permission") || text.includes("approval")) {
    add(
      "permission",
      "Permission missing",
      "Work is waiting on a scoped approval.",
      "Open the permission card, grant/deny/defer, then rerun the next safe action.",
      true,
    );
  }
  if (text.includes("remote") || text.includes("github") || text.includes("workflow")) {
    add(
      "remote-proof",
      "Remote proof blocked",
      "A remote proof lane is required or blocked.",
      "Confirm network/auth, run the exact workflow lane, then attach the run URL receipt.",
      true,
    );
  }
  if (text.includes("runtime") || text.includes("gateway") || text.includes("browser")) {
    add(
      "runtime",
      "Runtime proof needs repair",
      "Runtime, Gateway, or browser proof is stale or missing.",
      "Restart Gateway from production runtime and run authenticated browser proof.",
      true,
    );
  }
  if (text.includes("reboot")) {
    add(
      "reboot",
      "Reboot proof deferred",
      "Actual reboot persistence is intentionally separate.",
      "Keep it on hold until explicit Mac Studio reboot approval exists.",
      true,
    );
  }
  if (!playbooks.length) {
    add(
      "standard",
      "Standard recovery",
      "No special blocker pattern detected.",
      "Open the next ready sub-milestone, run its proof commands, and attach a receipt before marking complete.",
    );
  }
  return playbooks.slice(0, 5);
}

export function buildPccDependencyInsights(input: PccImpactDetailInput): PccDependencyInsight {
  const milestoneIds = new Set(input.milestones.map((milestone) => milestone.id));
  const completeIds = new Set(
    input.milestones
      .filter(
        (milestone) =>
          milestone.status === "complete" ||
          milestone.status === "complete_with_maintenance" ||
          milestone.status === "skipped",
      )
      .map((milestone) => milestone.id),
  );
  const incomplete = orderedMilestones(input).filter(
    (milestone) => !completeIds.has(milestone.id) && milestone.status !== "archived",
  );
  const ready = incomplete.filter((milestone) =>
    (milestone.dependsOn ?? []).every((id) => completeIds.has(id)),
  );
  const blockedByDeps = incomplete.filter((milestone) =>
    (milestone.dependsOn ?? []).some((id) => milestoneIds.has(id) && !completeIds.has(id)),
  );
  const next = getPccWorkLoopNext({
    project: input.project,
    milestones: input.milestones,
    subMilestones: input.subMilestones ?? [],
    permissions: input.permissions ?? [],
  });
  const notes: string[] = [];
  const nextTitle = next.subMilestone?.title ?? next.milestone?.title;
  if (nextTitle) {
    notes.push(`Next safe item: ${nextTitle}.`);
  }
  if (blockedByDeps.length) {
    notes.push(`${blockedByDeps.length} milestone(s) are waiting on dependencies.`);
  }
  if (!ready.length && incomplete.length) {
    notes.push("No dependency-ready milestone is available.");
  }
  return {
    criticalPathTitle:
      nextTitle ?? ready[0]?.title ?? incomplete[0]?.title ?? "No active critical path",
    blockedCount: blockedByDeps.length,
    readyCount: ready.length,
    cycleDetected:
      incomplete.length > 0 && ready.length === 0 && blockedByDeps.length === incomplete.length,
    notes,
  };
}

export function buildPccTimeline(input: PccImpactDetailInput): PccTimelineItem[] {
  const receipts: PccTimelineItem[] = (input.receipts ?? []).map((receipt) => ({
    id: receipt.id,
    title: "Completion receipt",
    kind: "receipt",
    at: receipt.completedAt,
    summary: receipt.summary,
  }));
  const evidence: PccTimelineItem[] = (input.evidence ?? []).map((item) => ({
    id: item.id,
    title: item.kind,
    kind: "evidence",
    at: item.createdAt,
    summary: item.summary ?? item.status,
  }));
  return [...receipts, ...evidence]
    .toSorted((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
    .slice(0, 8);
}

export function previewPccProjectImport(text: string): PccImportPreview {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => /^#{1,3}\s+/.test(line));
  const title = heading?.replace(/^#{1,3}\s+/, "").trim() || "Untitled imported project";
  const proposedMilestones = lines
    .map((line) => line.replace(/^[-*]\s+/, ""))
    .filter((line) => /^milestone\s*[:-]/i.test(line) || /^\d+\.\s+/.test(line))
    .map((line) =>
      line
        .replace(/^milestone\s*[:-]\s*/i, "")
        .replace(/^\d+\.\s+/, "")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 20);
  const missingFields: string[] = [];
  if (title === "Untitled imported project") {
    missingFields.push("Project title");
  }
  if (!/goal|objective|purpose/i.test(text)) {
    missingFields.push("Project goal");
  }
  if (!/acceptance|proof|verify|test/i.test(text)) {
    missingFields.push("Acceptance/proof criteria");
  }
  if (!proposedMilestones.length) {
    missingFields.push("Milestones");
  }
  return { title, proposedMilestones, missingFields, destructive: false };
}
