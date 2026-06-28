import { buildPccWorkflowDraft, PCC_WORKFLOW_TEMPLATES } from "../../src/pcc/project-workflows.js";

const draft = buildPccWorkflowDraft({
  title: "SNES Game Creator",
  goal: "Create patch-only SNES games",
  templateId: "snes-studio",
  priority: 1,
  planningMode: "codex_full_plan",
  codexPlanningAllowed: false,
});

if (PCC_WORKFLOW_TEMPLATES.length < 7) {
  throw new Error("missing workflow templates");
}
if (draft.project.metadata?.pccWorkflowTemplateId !== "snes-studio") {
  throw new Error("template metadata missing");
}
if (draft.milestones.length !== 7) {
  throw new Error("SNES template milestone count changed");
}
if (!draft.milestones.some((milestone) => milestone.metadata?.pccStopHere === true)) {
  throw new Error("stop-here milestone missing");
}
if ((draft.subMilestonesByMilestoneTitle["Build playable MVP loop"] ?? []).length < 3) {
  throw new Error("MVP sub-milestones missing");
}
if (draft.project.metadata?.pccIntakeStatus !== "codex_permission_needed") {
  throw new Error("Codex permission gate missing");
}

console.log(
  JSON.stringify({
    ok: true,
    templates: PCC_WORKFLOW_TEMPLATES.length,
    milestones: draft.milestones.length,
  }),
);
