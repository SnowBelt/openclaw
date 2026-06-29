import {
  evaluatePccProjectSetup,
  pccMissingRequiredIntakeAnswers,
  recommendPccWorkflow,
  withPccPhase2Metadata,
} from "../../src/pcc/intake-quality.js";
import { buildPccWorkflowDraft } from "../../src/pcc/project-workflows.js";
import { getPccWorkLoopNext } from "../../src/pcc/work-loop.js";

const answers = {
  goal: "Build a simple task automation planner that loads user plans and shows the next safe action.",
  firstDeliverable: "A working generic project loaded into PCC with milestones and sub-milestones.",
  doneProof: "Local smoke proof, remote proof, runtime browser proof, and a receipt.",
  constraints:
    "Do not start Codex, remote proof, destructive actions, or project-specific workflows without permission.",
  owner: "local_openclaw_agent",
  blockers: "Missing approval, missing acceptance criteria, or missing proof should block work.",
};

const missing = pccMissingRequiredIntakeAnswers({ ...answers, goal: "" });
if (!missing.includes("goal")) {
  throw new Error("generic intake did not block blank required answers");
}

const recommendation = recommendPccWorkflow({
  title: "Task Automation Planner",
  goal: answers.goal,
  intakeAnswers: answers,
});
if (recommendation.templateId !== "software-product") {
  throw new Error(
    `generic project should default to software-product, got ${recommendation.templateId}`,
  );
}

const snesRecommendation = recommendPccWorkflow({
  title: "Patch-only SNES sprite demo",
  goal: "Create a ROM patch workflow with emulator proof.",
  intakeAnswers: answers,
});
if (snesRecommendation.templateId !== "snes-studio") {
  throw new Error("SNES terms no longer route to the SNES Studio workflow");
}

const draft = buildPccWorkflowDraft({
  title: "Task Automation Planner",
  goal: answers.goal,
  templateId: recommendation.templateId,
  planningMode: "template_only",
});
if (draft.project.metadata?.pccWorkflowTemplateId !== "software-product") {
  throw new Error("generic project did not use the software-product template");
}
if (draft.milestones.length < 5) {
  throw new Error("generic project did not receive a complete milestone plan");
}

const now = "2026-06-29T00:00:00Z";
const project = {
  id: "project-generic-proof",
  title: draft.project.title,
  goal: draft.project.goal,
  status: draft.project.status,
  priority: draft.project.priority,
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

for (const milestone of milestones) {
  const children = subMilestones.filter(
    (subMilestone) => subMilestone.milestoneId === milestone.id,
  );
  if (children.length === 0) {
    throw new Error(`milestone lacks sub-milestones: ${milestone.title}`);
  }
  if (
    !milestone.acceptanceCriteria ||
    !milestone.metadata?.pccResponsibility ||
    !milestone.metadata?.pccProofLevel
  ) {
    throw new Error(`milestone lacks low-reasoning execution metadata: ${milestone.title}`);
  }
}

const unapproved = evaluatePccProjectSetup({
  project: {
    ...project,
    metadata: { ...project.metadata, pccIntake: { answers, approved: false } },
  },
  milestones,
  subMilestones,
});
if (unapproved.runnable || unapproved.status === "passing") {
  throw new Error("unapproved generic intake was runnable");
}

const passing = evaluatePccProjectSetup({ project, milestones, subMilestones });
if (!passing.runnable || passing.status !== "passing" || passing.score < 100) {
  throw new Error(`generic setup gate did not pass: ${JSON.stringify(passing)}`);
}

const gatedNext = getPccWorkLoopNext({
  project: withPccPhase2Metadata(
    project,
    { ...passing, status: "missing", badge: "Missing", runnable: false, score: 70 },
    now,
  ),
  milestones,
  subMilestones,
});
if (gatedNext.blocker?.kind !== "setup_not_ready") {
  throw new Error("generic Work This Project did not stop before the setup quality gate passed");
}

const readyNext = getPccWorkLoopNext({
  project: withPccPhase2Metadata(project, passing, now),
  milestones,
  subMilestones,
});
if (readyNext.state !== "working" || !readyNext.taskPrompt?.includes("Sub-milestone")) {
  throw new Error("generic Work This Project did not produce a low-reasoning task prompt");
}

const acceptanceCriteria =
  readyNext.subMilestone?.acceptanceCriteria ?? readyNext.milestone?.acceptanceCriteria ?? [];
const proofLevel = readyNext.milestone?.metadata?.pccProofLevel;
const proofLevelText = typeof proofLevel === "string" ? proofLevel : "missing";
const handoffPacket = [
  `Project: ${project.title}`,
  `Goal: ${project.goal ?? "missing"}`,
  `Next milestone: ${readyNext.milestone?.title ?? "none"}`,
  `Next sub-milestone: ${readyNext.subMilestone?.title ?? "none"}`,
  `Implementation: ${readyNext.subMilestone?.implementationPlan ?? readyNext.milestone?.implementationPlan ?? "missing"}`,
  `Acceptance: ${acceptanceCriteria.join("; ") || "missing"}`,
  `Proof: ${proofLevelText}`,
].join("\n");
for (const required of [
  "Project:",
  "Goal:",
  "Next milestone:",
  "Next sub-milestone:",
  "Implementation:",
  "Acceptance:",
  "Proof:",
]) {
  if (!handoffPacket.includes(required)) {
    throw new Error(`handoff packet missing ${required}`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      genericRecommendation: recommendation.templateId,
      snesRecommendation: snesRecommendation.templateId,
      milestoneCount: milestones.length,
      subMilestoneCount: subMilestones.length,
      setupScore: passing.score,
      next: readyNext.subMilestone?.title ?? readyNext.milestone?.title,
    },
    null,
    2,
  ),
);
