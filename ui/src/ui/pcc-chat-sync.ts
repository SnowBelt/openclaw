// Project Command Center chat sync turns chat plans into reviewable PCC diffs.
import { parseProposedPlanSegments } from "./chat/proposed-plan.ts";
import type { PccChatSyncProposal, PccProjectDetail } from "./pcc/application/state.ts";
import type { PccMilestone } from "./types.ts";

export type { PccChatSyncProposal, PccChatSyncProposalKind } from "./pcc/application/state.ts";

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

function hasExplicitPlanEnvelope(text: string): boolean {
  return (
    parseProposedPlanSegments(text).some((segment) => segment.kind === "proposed_plan") ||
    text.includes("PLEASE IMPLEMENT THIS PLAN:")
  );
}

function existingMilestone(detail: PccProjectDetail, title: string): PccMilestone | null {
  const target = normalize(title);
  return detail.milestones.find((milestone) => normalize(milestone.title) === target) ?? null;
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

function planProposal(detail: PccProjectDetail, text: string): PccChatSyncProposal | null {
  if (!hasExplicitPlanEnvelope(text)) {
    return null;
  }
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
  return proposals;
}
