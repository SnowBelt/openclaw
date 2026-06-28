// PCC Phase 2 intake and workflow quality gates keep projects runnable before automation starts.
import type {
  PccMilestone,
  PccProject,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";
import {
  getPccWorkflowTemplate,
  PCC_WORKFLOW_TEMPLATES,
  type PccWorkflowTemplateId,
} from "./project-workflows.js";

export type PccWorkflowContractStatus = "passing" | "missing" | "violated" | "needs_review";

export type PccIntakeQuestion = {
  id: string;
  label: string;
  prompt: string;
};

export type PccWorkflowRecommendation = {
  templateId: PccWorkflowTemplateId;
  title: string;
  reason: string;
};

export type PccProjectSetupEvaluation = {
  score: number;
  runnable: boolean;
  status: PccWorkflowContractStatus;
  badge: "Passing" | "Missing" | "Violated" | "Needs Review";
  missing: string[];
  violations: string[];
  needsReview: string[];
  recommendedWorkflow: PccWorkflowRecommendation;
  selectedWorkflowTemplateId: string;
};

const TERMINAL_STATUSES = new Set(["complete", "complete_with_maintenance", "skipped", "archived"]);

export const PCC_REQUIRED_INTAKE_QUESTIONS: readonly PccIntakeQuestion[] = [
  {
    id: "goal",
    label: "Goal",
    prompt: "What should this project accomplish in one clear sentence?",
  },
  {
    id: "firstDeliverable",
    label: "First useful result",
    prompt: "What should the first useful deliverable include?",
  },
  {
    id: "doneProof",
    label: "Done proof",
    prompt: "What proof is required before OpenClaw can say a milestone is complete?",
  },
  {
    id: "constraints",
    label: "Rules and limits",
    prompt: "What is off limits, risky, expensive, or approval-gated?",
  },
  {
    id: "owner",
    label: "Owner",
    prompt: "Who should do the work first: user, local agent, local model, Codex, or remote proof?",
  },
  {
    id: "blockers",
    label: "Known blockers",
    prompt: "What missing answers, tools, permissions, sources, or accounts could block the work?",
  },
];

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function metadataBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function answerRecord(value: unknown): Record<string, string> {
  const raw = metadataObject(value);
  return Object.fromEntries(
    PCC_REQUIRED_INTAKE_QUESTIONS.map((question) => [
      question.id,
      metadataString(raw[question.id]).trim(),
    ]),
  );
}

export function pccIntakeAnswersFromMetadata(metadata: unknown): Record<string, string> {
  return answerRecord(metadataObject(metadataObject(metadata).pccIntake).answers);
}

export function pccMissingRequiredIntakeAnswers(answers: Record<string, string>): string[] {
  return PCC_REQUIRED_INTAKE_QUESTIONS.filter((question) => !answers[question.id]?.trim()).map(
    (question) => question.id,
  );
}

export function pccIntakeApproved(metadata: unknown): boolean {
  const intake = metadataObject(metadataObject(metadata).pccIntake);
  return metadataBoolean(intake.approved) || Boolean(metadataString(intake.approvedAt));
}

function includesAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function recommendPccWorkflow(input: {
  title?: string;
  goal?: string;
  intakeAnswers?: Record<string, string>;
}): PccWorkflowRecommendation {
  const intakeText = Object.values(input.intakeAnswers ?? {}).join(" ");
  const text = `${input.title ?? ""} ${input.goal ?? ""} ${intakeText}`.toLowerCase();
  let templateId: PccWorkflowTemplateId = "software-product";
  let reason = "Defaulted to Software/Product because no stronger workflow signal was found.";

  if (includesAny(text, ["snes", "rom", "sprite", "emulator", "patch-only", "patch only"])) {
    templateId = "snes-studio";
    reason = "SNES, emulator, sprite, ROM, or patch language matched the SNES Studio workflow.";
  } else if (includesAny(text, ["kalshi", "trading", "trade", "market", "finance", "portfolio"])) {
    templateId = "trading-finance";
    reason = "Trading or finance language matched the guarded Trading/Finance workflow.";
  } else if (includesAny(text, ["dashboard", "metric", "analytics", "data", "report", "kpi"])) {
    templateId = "dashboard-data";
    reason = "Dashboard, data, report, or metric language matched the Dashboard/Data workflow.";
  } else if (includesAny(text, ["research", "source", "history", "evidence", "citation"])) {
    templateId = "research";
    reason =
      "Research, source, history, evidence, or citation language matched the Research workflow.";
  } else if (
    includesAny(text, ["book", "music", "video", "thumbnail", "creative", "game", "art", "story"])
  ) {
    templateId = "creative-media";
    reason = "Creative, media, game, art, or story language matched the Creative/Media workflow.";
  }

  const template = getPccWorkflowTemplate(templateId);
  return { templateId, title: template.title, reason };
}

function milestoneIsActive(milestone: PccMilestone): boolean {
  return !TERMINAL_STATUSES.has(milestone.status);
}

function itemHasCriteria(item: PccMilestone | PccSubMilestone): boolean {
  return item.acceptanceCriteria?.some((entry) => entry.trim()) ?? false;
}

function itemMetadataString(item: PccMilestone | PccSubMilestone, key: string): string {
  return metadataString(metadataObject(item.metadata)[key]);
}

export function evaluatePccProjectSetup(input: {
  project: PccProject;
  milestones?: readonly PccMilestone[];
  subMilestones?: readonly PccSubMilestone[];
}): PccProjectSetupEvaluation {
  const projectMetadata = metadataObject(input.project.metadata);
  const answers = pccIntakeAnswersFromMetadata(projectMetadata);
  const missing: string[] = [];
  const violations: string[] = [];
  const needsReview: string[] = [];
  const activeMilestones = (input.milestones ?? []).filter(milestoneIsActive);
  const subMilestones = input.subMilestones ?? [];
  const missingIntake = pccMissingRequiredIntakeAnswers(answers);
  const selectedWorkflowTemplateId = metadataString(
    projectMetadata.pccWorkflowTemplateId,
    metadataString(metadataObject(projectMetadata.pccWorkflow).templateId, "software-product"),
  );
  const recommendedWorkflow = recommendPccWorkflow({
    title: input.project.title,
    goal: input.project.goal,
    intakeAnswers: answers,
  });

  if (!input.project.title.trim()) {
    missing.push("Project title is missing.");
  }
  if (!input.project.goal?.trim()) {
    missing.push("Project goal is missing.");
  }
  for (const questionId of missingIntake) {
    const question = PCC_REQUIRED_INTAKE_QUESTIONS.find((item) => item.id === questionId);
    missing.push(`Required intake answer missing: ${question?.label ?? questionId}.`);
  }
  if (!pccIntakeApproved(projectMetadata)) {
    needsReview.push("Project intake has not been approved.");
  }
  if (!selectedWorkflowTemplateId.trim()) {
    missing.push("Workflow template is missing.");
  }
  if (!PCC_WORKFLOW_TEMPLATES.some((template) => template.id === selectedWorkflowTemplateId)) {
    violations.push(`Unknown workflow template: ${selectedWorkflowTemplateId}.`);
  }
  if (activeMilestones.length === 0) {
    missing.push("No active milestones exist.");
  }

  for (const milestone of activeMilestones) {
    const children = subMilestones.filter(
      (subMilestone) => subMilestone.milestoneId === milestone.id,
    );
    if (children.length === 0) {
      missing.push(`Milestone "${milestone.title}" has no sub-milestones.`);
    }
    if (!milestone.implementationPlan?.trim()) {
      missing.push(`Milestone "${milestone.title}" is missing an implementation plan.`);
    }
    if (!itemHasCriteria(milestone)) {
      missing.push(`Milestone "${milestone.title}" is missing acceptance criteria.`);
    }
    if (!itemMetadataString(milestone, "pccResponsibility")) {
      missing.push(`Milestone "${milestone.title}" is missing an owner/responsibility.`);
    }
    if (
      !itemMetadataString(milestone, "pccProofLevel") &&
      !itemMetadataString(milestone, "proofRequired")
    ) {
      missing.push(`Milestone "${milestone.title}" is missing proof requirements.`);
    }
    for (const subMilestone of children.filter((item) => !TERMINAL_STATUSES.has(item.status))) {
      if (!subMilestone.implementationPlan?.trim()) {
        missing.push(`Sub-milestone "${subMilestone.title}" is missing an implementation plan.`);
      }
      if (!itemHasCriteria(subMilestone)) {
        missing.push(`Sub-milestone "${subMilestone.title}" is missing acceptance criteria.`);
      }
    }
  }

  let score = 100;
  if (!input.project.title.trim()) {
    score -= 10;
  }
  if (!input.project.goal?.trim()) {
    score -= 10;
  }
  score -= Math.min(30, missingIntake.length * 5);
  if (!pccIntakeApproved(projectMetadata)) {
    score -= 15;
  }
  if (!selectedWorkflowTemplateId.trim()) {
    score -= 10;
  }
  if (activeMilestones.length === 0) {
    score -= 15;
  }
  const structuralMissing = missing.filter(
    (entry) => entry.includes("Milestone") || entry.includes("Sub-milestone"),
  );
  score -= Math.min(35, structuralMissing.length * 5);
  if (violations.length > 0) {
    score -= 20;
  }
  score = Math.max(0, Math.min(100, score));

  const status: PccWorkflowContractStatus =
    violations.length > 0
      ? "violated"
      : missing.length > 0
        ? "missing"
        : needsReview.length > 0
          ? "needs_review"
          : "passing";
  const badge =
    status === "passing"
      ? "Passing"
      : status === "violated"
        ? "Violated"
        : status === "missing"
          ? "Missing"
          : "Needs Review";
  return {
    score,
    runnable: status === "passing" && score >= 80,
    status,
    badge,
    missing,
    violations,
    needsReview,
    recommendedWorkflow,
    selectedWorkflowTemplateId,
  };
}

export function withPccPhase2Metadata(
  project: PccProject,
  evaluation: PccProjectSetupEvaluation,
  now: string,
): PccProject {
  const metadata = metadataObject(project.metadata);
  const intake = metadataObject(metadata.pccIntake);
  return {
    ...project,
    metadata: {
      ...metadata,
      pccWorkflow: {
        ...metadataObject(metadata.pccWorkflow),
        templateId: evaluation.selectedWorkflowTemplateId,
        recommendation: evaluation.recommendedWorkflow,
        evaluatedAt: now,
      },
      pccQualityGate: {
        status: evaluation.status,
        missing: evaluation.missing,
        violations: evaluation.violations,
        needsReview: evaluation.needsReview,
        evaluatedAt: now,
      },
      pccSetupScore: {
        score: evaluation.score,
        runnable: evaluation.runnable,
        evaluatedAt: now,
      },
      pccCompliance: {
        badge: evaluation.badge,
        status: evaluation.status,
        evaluatedAt: now,
      },
      pccIntake: {
        ...intake,
        missingQuestionIds: pccMissingRequiredIntakeAnswers(
          answerRecord(metadataObject(intake.answers)),
        ),
        status: pccIntakeApproved(metadata) ? "approved" : "needs_review",
      },
    },
  };
}
