import {
  evaluatePccProjectSetup,
  pccMissingRequiredIntakeAnswers,
  recommendPccWorkflow,
  withPccPhase2Metadata,
} from "../../src/pcc/intake-quality.js";
import { buildPccWorkflowDraft } from "../../src/pcc/project-workflows.js";
import { getPccWorkLoopNext } from "../../src/pcc/work-loop.js";

const answers = {
  goal: "Create a patch-only SNES game creator.",
  firstDeliverable: "A readable playable demo.",
  doneProof: "Emulator proof, screenshots, and completion receipts.",
  constraints: "Do not deliver ROM files or spend Codex tokens without permission.",
  owner: "local_openclaw_agent",
  blockers: "Toolchain proof may be missing.",
};

const missing = pccMissingRequiredIntakeAnswers({ ...answers, goal: "" });
if (!missing.includes("goal")) {
  throw new Error("blank intake was not blocked");
}

const recommendation = recommendPccWorkflow({
  title: "SNES Game Creator",
  goal: answers.goal,
  intakeAnswers: answers,
});
if (recommendation.templateId !== "snes-studio") {
  throw new Error(`expected SNES Studio workflow recommendation, got ${recommendation.templateId}`);
}

const draft = buildPccWorkflowDraft({
  title: "SNES Game Creator",
  goal: answers.goal,
  templateId: recommendation.templateId,
  planningMode: "template_only",
});
const now = "2026-06-28T00:00:00Z";
const project = {
  id: "project-1",
  title: draft.project.title,
  goal: draft.project.goal,
  status: draft.project.status,
  phases: draft.project.phases,
  metadata: {
    ...draft.project.metadata,
    pccIntake: { answers, approved: true, approvedAt: now },
  },
  createdAt: now,
  updatedAt: now,
};
const milestones = draft.milestones.map((milestone, index) => ({
  ...milestone,
  id: `milestone-${index}`,
  projectId: project.id,
  createdAt: now,
  updatedAt: now,
}));
const subMilestones = milestones.flatMap((milestone) =>
  (draft.subMilestonesByMilestoneTitle[milestone.title] ?? []).map((subMilestone, index) =>
    Object.assign({}, subMilestone, {
      id: `${milestone.id}-sub-${index}`,
      projectId: project.id,
      milestoneId: milestone.id,
      createdAt: now,
      updatedAt: now,
    }),
  ),
);

const beforeApproval = evaluatePccProjectSetup({
  project: {
    ...project,
    metadata: { ...project.metadata, pccIntake: { answers, approved: false } },
  },
  milestones,
  subMilestones,
});
if (beforeApproval.status !== "needs_review" || beforeApproval.runnable) {
  throw new Error("unapproved intake did not hold the quality gate");
}

const passing = evaluatePccProjectSetup({ project, milestones, subMilestones });
if (passing.status !== "passing" || !passing.runnable || passing.score < 100) {
  throw new Error(`quality gate did not pass after approval: ${JSON.stringify(passing)}`);
}

const projectWithMetadata = withPccPhase2Metadata(project, passing, now);
const gatedNext = getPccWorkLoopNext({
  project: withPccPhase2Metadata(
    {
      ...project,
      metadata: { ...project.metadata, pccIntake: { answers, approved: false } },
    },
    beforeApproval,
    now,
  ),
  milestones,
  subMilestones,
});
if (gatedNext.blocker?.kind !== "setup_not_ready") {
  throw new Error("Work This Project was not blocked before the quality gate passed");
}

const next = getPccWorkLoopNext({ project: projectWithMetadata, milestones, subMilestones });
if (next.state !== "working" || !next.taskPrompt?.includes("Sub-milestone")) {
  throw new Error("Work This Project was not available after the quality gate passed");
}

console.log(
  JSON.stringify({
    ok: true,
    recommendation: recommendation.templateId,
    score: passing.score,
    compliance: passing.badge,
    next: next.subMilestone?.title ?? next.milestone?.title,
  }),
);
