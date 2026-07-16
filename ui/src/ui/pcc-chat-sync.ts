// Project Command Center chat sync turns chat plans into reviewable PCC diffs.
import { parseProposedPlanSegments } from "./chat/proposed-plan.ts";
import type { PccChatSyncProposal, PccProjectDetail } from "./pcc/application/state.ts";
import type { PccMilestone, PccStatus } from "./types.ts";

export type { PccChatSyncProposal, PccChatSyncProposalKind } from "./pcc/application/state.ts";

const STATUS_PATTERNS: Array<[RegExp, PccStatus]> = [
  [/\b(local[- ]proof complete|local_proof_complete)\b/iu, "local_proof_complete"],
  [/\b(remote[- ]proof complete|remote_proof_complete)\b/iu, "remote_proof_complete"],
  [/\b(runtime[- ]proof complete|runtime_proof_complete)\b/iu, "runtime_proof_complete"],
  [
    /\b(persistence[- ]proof complete|persistence_proof_complete)\b/iu,
    "persistence_proof_complete",
  ],
  [/\b(needs approval|needs_approval)\b/iu, "needs_approval"],
  [/\b(on hold|on_hold)\b/iu, "on_hold"],
  [/\bdeferred\b/iu, "deferred"],
  [/\bblocked\b/iu, "blocked"],
  [/\bproof pending\b/iu, "proof_pending"],
  [/\bin progress\b/iu, "in_progress"],
  [/\bcomplete\b/iu, "complete"],
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function firstHeading(markdown: string): string | null {
  const heading = markdown
    .split(/\n/u)
    .map((line) => line.trim())
    .find((line) => /^#{1,3}\s+\S/u.test(line));
  return heading?.replace(/^#{1,3}\s+/u, "").trim() ?? null;
}

function extractPlanMarkdown(text: string): string {
  const segments = parseProposedPlanSegments(text);
  const plan = segments.find((segment) => segment.kind === "proposed_plan");
  if (plan?.kind === "proposed_plan" && plan.markdown.trim()) {
    return plan.markdown.trim();
  }
  const implementIndex = text.indexOf("PLEASE IMPLEMENT THIS PLAN:");
  if (implementIndex !== -1) {
    return text.slice(implementIndex + "PLEASE IMPLEMENT THIS PLAN:".length).trim();
  }
  return text.trim();
}

function existingMilestone(detail: PccProjectDetail, title: string): PccMilestone | null {
  const target = normalize(title);
  return detail.milestones.find((milestone) => normalize(milestone.title) === target) ?? null;
}

function statusFromLine(line: string): PccStatus | null {
  return STATUS_PATTERNS.find(([pattern]) => pattern.test(line))?.[1] ?? null;
}

function milestoneTitleFromStatusLine(line: string): string | null {
  const clean = line
    .replace(/^[-*]\s*/u, "")
    .replace(/\*\*/gu, "")
    .trim();
  const separators = [" — ", " - ", ": "];
  for (const separator of separators) {
    const index = clean.indexOf(separator);
    if (index > 0) {
      return clean.slice(0, index).trim();
    }
  }
  return null;
}

function inferResponsibility(text: string): string {
  if (/\bhigh[- ]reasoning codex\b/iu.test(text)) {
    return "high_reasoning_codex";
  }
  if (/\bcodex\b/iu.test(text)) {
    return "codex";
  }
  if (/\bremote proof\b|\bworkflow sanity\b|\bgithub actions\b/iu.test(text)) {
    return "remote_proof";
  }
  if (/\blocal model\b/iu.test(text)) {
    return "local_model";
  }
  if (/\buser\b/iu.test(text)) {
    return "user";
  }
  return "local_openclaw_agent";
}

function inferCostRisk(responsibility: string): string {
  if (responsibility === "high_reasoning_codex") {
    return "high";
  }
  if (responsibility === "codex" || responsibility === "remote_proof") {
    return "medium";
  }
  return "low";
}

function splitAcceptanceCriteria(plan: string): string[] {
  const lines = plan.split(/\n/u);
  const acceptanceStart = lines.findIndex((line) =>
    /acceptance criteria|completion rules/iu.test(line),
  );
  if (acceptanceStart === -1) {
    return ["Local proof passes", "Remote proof passes before claiming 100%"];
  }
  return lines
    .slice(acceptanceStart + 1)
    .map((line) => line.replace(/^[-*]\s*/u, "").trim())
    .filter((line) => line.length > 0 && !/^#{1,6}\s/u.test(line))
    .slice(0, 10);
}

function addStatusProposals(detail: PccProjectDetail, text: string): PccChatSyncProposal[] {
  const proposals: PccChatSyncProposal[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\n/u)) {
    const status = statusFromLine(line);
    const title = milestoneTitleFromStatusLine(line);
    if (!status || !title) {
      continue;
    }
    const milestone = existingMilestone(detail, title);
    if (!milestone || milestone.status === status) {
      continue;
    }
    const key = `${milestone.id}:${status}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    proposals.push({
      id: `chat-status-${proposals.length + 1}`,
      kind: "update_milestone",
      title: `Update ${milestone.title} to ${status.replace(/_/gu, " ")}`,
      summary: line.trim(),
      risky: status === "complete" || status === "skipped" || status === "archived",
      milestoneId: milestone.id,
      milestonePatch: {
        projectId: milestone.projectId,
        title: milestone.title,
        status,
      },
    });
  }
  return proposals;
}

function addReceiptProposal(detail: PccProjectDetail, text: string): PccChatSyncProposal | null {
  if (!/\breceipt\b|\bdo not redo\b|\bproof passed\b/iu.test(text)) {
    return null;
  }
  const milestone = detail.milestones.find((candidate) =>
    detail.evidence.some(
      (evidence) => evidence.milestoneId === candidate.id && evidence.status === "passed",
    ),
  );
  if (!milestone || detail.receipts.some((receipt) => receipt.milestoneId === milestone.id)) {
    return null;
  }
  return {
    id: "chat-receipt-1",
    kind: "add_receipt",
    title: `Add receipt for ${milestone.title}`,
    summary: "Chat mentions passed proof or a do-not-redo receipt.",
    risky: true,
    milestoneId: milestone.id,
  };
}

function permissionProposal(detail: PccProjectDetail, text: string): PccChatSyncProposal | null {
  if (!/\bpermission\b|\bapprove\b|\bpush\b|\bworkflow sanity\b|\bremote proof\b/iu.test(text)) {
    return null;
  }
  const nextMilestone =
    detail.milestones.find(
      (milestone) => !["complete", "skipped", "archived"].includes(milestone.status),
    ) ?? detail.milestones[0];
  return {
    id: "chat-permission-1",
    kind: "request_permission",
    title: "Request remote proof permission",
    summary: "Chat text requests or depends on push/remote proof permission.",
    risky: true,
    milestoneId: nextMilestone?.id,
    permission: {
      projectId: detail.project.id,
      ...(nextMilestone ? { milestoneId: nextMilestone.id } : {}),
      type: "remote_proof",
      status: "needed",
      riskLevel: "medium",
      allowedActions: ["push branch", "run Workflow Sanity", "inspect run logs"],
      forbiddenActions: ["merge upstream", "publish release", "runtime install"],
      target: "SnowBelt/openclaw",
    },
  };
}

function planProposal(detail: PccProjectDetail, text: string): PccChatSyncProposal | null {
  const plan = extractPlanMarkdown(text);
  if (plan.length < 20) {
    return null;
  }
  const title = firstHeading(plan) ?? "Chat-synced milestone";
  const existing = existingMilestone(detail, title);
  const responsibility = inferResponsibility(plan);
  const costRisk = inferCostRisk(responsibility);
  return {
    id: "chat-plan-1",
    kind: existing ? "update_milestone" : "add_milestone",
    title: existing ? `Update milestone: ${existing.title}` : `Add milestone: ${title}`,
    summary: "Structured chat plan detected.",
    risky: false,
    ...(existing ? { milestoneId: existing.id } : {}),
    milestonePatch: {
      ...(existing ? { id: existing.id } : {}),
      projectId: detail.project.id,
      title: existing?.title ?? title,
      status: existing?.status ?? "not_started",
      implementationPlan: plan,
      acceptanceCriteria: splitAcceptanceCriteria(plan),
      metadata: {
        ...(existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
        pccResponsibility: responsibility,
        pccCostRisk: costRisk,
      },
    },
  };
}

export function buildPccChatSyncProposals(
  detail: PccProjectDetail | null,
  text: string,
): PccChatSyncProposal[] {
  if (!detail || !text.trim()) {
    return [];
  }
  const proposals: PccChatSyncProposal[] = [];
  const plan = planProposal(detail, text);
  if (plan) {
    proposals.push(plan);
  }
  proposals.push(...addStatusProposals(detail, text));
  const permission = permissionProposal(detail, text);
  if (permission) {
    proposals.push(permission);
  }
  const receipt = addReceiptProposal(detail, text);
  if (receipt) {
    proposals.push(receipt);
  }
  return proposals;
}
