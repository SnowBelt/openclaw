import { buildPccWorkflowDraft } from "../../src/pcc/project-workflows.js";

const codexDraft = buildPccWorkflowDraft({
  title: "Codex planned project",
  templateId: "software-product",
  planningMode: "codex_full_plan",
  codexPlanningAllowed: false,
});
const managerDraft = buildPccWorkflowDraft({
  title: "Project manager planned project",
  templateId: "software-product",
  planningMode: "local_project_manager",
  codexPlanningAllowed: false,
});

if (codexDraft.project.metadata?.pccIntakeStatus !== "codex_permission_needed") {
  throw new Error("Codex planning gate was not recorded");
}
if (codexDraft.milestones[0]?.status !== "needs_approval") {
  throw new Error("Codex planning gate did not hold the first milestone");
}
if (managerDraft.project.metadata?.pccIntakeStatus !== "project_manager_review") {
  throw new Error("Project Manager intake status was not recorded");
}
if (managerDraft.milestones[0]?.status === "needs_approval") {
  throw new Error("Local Project Manager intake should not spend or require Codex by default");
}

console.log(
  JSON.stringify({
    ok: true,
    codex: codexDraft.project.metadata?.pccIntakeStatus,
    projectManager: managerDraft.project.metadata?.pccIntakeStatus,
  }),
);
