import {
  evaluatePccProjectSetup,
  pccMissingRequiredIntakeAnswers,
  recommendPccWorkflow,
  withPccPhase2Metadata,
} from "../../src/pcc/intake-quality.js";
import { buildPccWorkflowDraft, PCC_WORKFLOW_TEMPLATES } from "../../src/pcc/project-workflows.js";
import { getPccWorkLoopNext } from "../../src/pcc/work-loop.js";

const now = "2026-06-29T00:00:00Z";
const intakeAnswers = {
  goal: "Build a generic milestone command center for any project the user loads.",
  firstDeliverable: "A project loaded with phases, milestones, sub-milestones, and proof gates.",
  doneProof: "Local tests, remote proof, runtime browser proof, and completion receipts pass.",
  constraints:
    "Do not start Codex, remote proof, destructive actions, or reboot without permission.",
  owner: "local_openclaw_agent",
  blockers: "Missing intake, missing proof, missing permissions, or failing quality gates.",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const blankMissing = pccMissingRequiredIntakeAnswers({
  ...intakeAnswers,
  goal: "",
  doneProof: "",
});
assert(blankMissing.includes("goal"), "blank intake did not block missing goal");
assert(blankMissing.includes("doneProof"), "blank intake did not block missing proof answer");

const recommendation = recommendPccWorkflow({
  title: "Universal Project Loader",
  goal: intakeAnswers.goal,
  intakeAnswers,
});
assert(
  recommendation.templateId === "software-product",
  `generic project should recommend software-product, got ${recommendation.templateId}`,
);
assert(recommendation.reason.trim().length > 0, "workflow recommendation did not explain why");

for (const [title, expected] of [
  ["Marketing Analytics Dashboard", "dashboard-data"],
  ["Cleveland history source research", "research"],
  ["Original music video package", "creative-media"],
  ["Kalshi strategy guardrail review", "trading-finance"],
  ["Patch-only SNES emulator proof", "snes-studio"],
] as const) {
  const result = recommendPccWorkflow({ title, intakeAnswers });
  assert(
    result.templateId === expected,
    `${title} routed to ${result.templateId}, not ${expected}`,
  );
}

const draft = buildPccWorkflowDraft({
  title: "Universal Project Loader",
  goal: intakeAnswers.goal,
  templateId: recommendation.templateId,
  planningMode: "template_only",
});
assert(draft.project.metadata?.pccWorkflowTemplateId === "software-product", "template id missing");
assert((draft.project.phases?.length ?? 0) >= 6, "workflow did not create standard phases");
assert(draft.milestones.length >= 6, "workflow did not create a complete milestone plan");

const project = {
  id: "project-phase2-completion",
  title: draft.project.title,
  goal: draft.project.goal,
  status: draft.project.status,
  priority: draft.project.priority,
  phases: draft.project.phases,
  metadata: {
    ...draft.project.metadata,
    pccIntake: { answers: intakeAnswers, approved: true, approvedAt: now },
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
  const children = subMilestones.filter((child) => child.milestoneId === milestone.id);
  assert(children.length > 0, `milestone lacks sub-milestones: ${milestone.title}`);
  assert(milestone.implementationPlan?.trim(), `milestone lacks plan: ${milestone.title}`);
  assert(milestone.acceptanceCriteria?.length, `milestone lacks acceptance: ${milestone.title}`);
  assert(milestone.metadata?.pccResponsibility, `milestone lacks owner: ${milestone.title}`);
  assert(milestone.metadata?.pccProofLevel, `milestone lacks proof level: ${milestone.title}`);
  for (const child of children) {
    assert(child.implementationPlan?.includes("Execute:"), `sub-step lacks plan: ${child.title}`);
    assert(child.acceptanceCriteria?.length, `sub-step lacks acceptance: ${child.title}`);
  }
}

const unapproved = evaluatePccProjectSetup({
  project: {
    ...project,
    metadata: { ...project.metadata, pccIntake: { answers: intakeAnswers, approved: false } },
  },
  milestones,
  subMilestones,
});
assert(unapproved.status === "needs_review", `unapproved status was ${unapproved.status}`);
assert(!unapproved.runnable, "unapproved intake was runnable");

const missingStructure = evaluatePccProjectSetup({ project, milestones, subMilestones: [] });
assert(missingStructure.status === "missing", "missing sub-milestones did not fail contract");
assert(missingStructure.score < 80, "missing sub-milestones did not reduce setup score");

const violated = evaluatePccProjectSetup({
  project: { ...project, metadata: { ...project.metadata, pccWorkflowTemplateId: "not-real" } },
  milestones,
  subMilestones,
});
assert(violated.status === "violated", "unknown workflow did not violate contract");
assert(violated.badge === "Violated", "unknown workflow did not produce Violated badge");

const passing = evaluatePccProjectSetup({ project, milestones, subMilestones });
assert(passing.status === "passing", `passing project status was ${passing.status}`);
assert(passing.badge === "Passing", `passing project badge was ${passing.badge}`);
assert(passing.runnable, "passing setup was not runnable");
assert(passing.score === 100, `passing setup score was ${passing.score}`);

const gatedNext = getPccWorkLoopNext({
  project: withPccPhase2Metadata(
    project,
    { ...passing, status: "missing", badge: "Missing", runnable: false, score: 70 },
    now,
  ),
  milestones,
  subMilestones,
});
assert(gatedNext.blocker?.kind === "setup_not_ready", "work loop ignored setup quality gate");

const readyNext = getPccWorkLoopNext({
  project: withPccPhase2Metadata(project, passing, now),
  milestones,
  subMilestones,
});
assert(readyNext.state === "working", `ready work-loop state was ${readyNext.state}`);
assert(readyNext.subMilestone, "work loop did not use sub-milestone as execution unit");
assert(
  readyNext.taskPrompt?.includes("Completion rule: do not mark this work item complete"),
  "task prompt lacked proof-gated completion rule",
);

const codexDraft = buildPccWorkflowDraft({
  title: "Codex planned app",
  templateId: "software-product",
  planningMode: "codex_full_plan",
  codexPlanningAllowed: false,
});
assert(
  codexDraft.project.metadata?.pccIntakeStatus === "codex_permission_needed",
  "Codex planning did not remain permission-gated",
);
assert(codexDraft.milestones[0]?.status === "needs_approval", "Codex plan did not stop first");

assert(
  PCC_WORKFLOW_TEMPLATES.some((template) => template.id === "custom"),
  "custom workflow template missing",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      completedMilestones: [
        "Project Intake Wizard V1",
        "Workflow Resolver V1",
        "Workflow Contract V1",
        "Workflow Template Engine V1",
        "Plan Quality Gate V1",
        "Project Setup Score V1",
        "Workflow Compliance Badge V1",
      ],
      recommendation: recommendation.templateId,
      score: passing.score,
      badge: passing.badge,
      milestoneCount: milestones.length,
      subMilestoneCount: subMilestones.length,
      next: readyNext.subMilestone.title,
    },
    null,
    2,
  ),
);
