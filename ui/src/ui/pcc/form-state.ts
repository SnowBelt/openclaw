import { DEFAULT_PCC_EXECUTION_PROFILE } from "../../../../src/pcc/execution-profile.js";
import type {
  PccDecisionFormState,
  PccMilestoneFormState,
  PccProjectFormState,
} from "./contracts.ts";

export const EMPTY_PCC_PROJECT_FORM: PccProjectFormState = {
  id: null,
  title: "",
  goal: "",
  projectDescription: "",
  status: "active",
  priority: "3",
  dueDate: "",
  outcomeMetrics: "",
  workflowTemplateId: "software-product",
  planningMode: "local_project_manager",
  plannerMode: "best_available",
  aiUsePolicy: "local_only",
  plannerModelId: "",
  plannerPermissionScope: "project",
  plannerPermissionBudget: "",
  planPreviewAccepted: false,
  codexPlanningAllowed: false,
  remoteProofAllowed: false,
  runtimeActionsAllowed: false,
  executionProfile: { ...DEFAULT_PCC_EXECUTION_PROFILE },
  intakeAnswers: {},
  intakeApproved: false,
};

export const EMPTY_PCC_DECISION_FORM: PccDecisionFormState = {
  title: "",
  summary: "",
  rationale: "",
  impact: "",
  milestoneId: "",
  subMilestoneId: "",
  evidenceIds: "",
  decidedBy: "",
};

export const EMPTY_PCC_MILESTONE_FORM: PccMilestoneFormState = {
  id: null,
  projectId: null,
  title: "",
  status: "not_started",
  phaseId: "",
  order: "",
  percentComplete: "",
  blocker: "",
  implementationPlan: "",
  acceptanceCriteria: "",
  responsibility: "local_openclaw_agent",
  costRisk: "low",
  stopHere: false,
};
