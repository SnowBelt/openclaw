import type {
  PccDashboardState,
  PccDecisionFormState,
  PccMilestoneFormState,
  PccProjectEditMode,
  PccProjectFilter,
  PccViewMode,
} from "../contracts.ts";
import { EMPTY_PCC_DECISION_FORM } from "../form-state.ts";

function notify(state: PccDashboardState): void {
  state.requestUpdate?.();
}

export function cancelPccEditor(state: PccDashboardState): void {
  state.pccEditorMode = null;
  state.pccActionError = null;
  notify(state);
}

export function updatePccViewMode(state: PccDashboardState, mode: PccViewMode): void {
  state.pccViewMode = mode;
  notify(state);
}

export function updatePccProductFocusMode(
  state: PccDashboardState,
  mode: "pcc_product" | "project_work",
): void {
  state.pccProductFocusMode = mode;
  state.pccProjectFilter = undefined;
  notify(state);
}

export function updatePccReorderMode(state: PccDashboardState, enabled: boolean): void {
  state.pccReorderMode = enabled;
  notify(state);
}

export function updatePccProjectEditMode(state: PccDashboardState, mode: PccProjectEditMode): void {
  state.pccProjectEditMode = mode;
  notify(state);
}

export function updatePccProjectFilter(state: PccDashboardState, filter: PccProjectFilter): void {
  state.pccProjectFilter = filter;
  notify(state);
}

export function updatePccProjectSearchQuery(state: PccDashboardState, query: string): void {
  state.pccProjectSearchQuery = query;
  notify(state);
}

export function openPccDecisionForm(state: PccDashboardState): void {
  state.pccDecisionFormOpen = true;
  state.pccDecisionForm = {
    ...EMPTY_PCC_DECISION_FORM,
    decidedBy: "User",
  };
  state.pccActionError = null;
  notify(state);
}

export function cancelPccDecisionForm(state: PccDashboardState): void {
  state.pccDecisionFormOpen = false;
  state.pccDecisionForm = { ...EMPTY_PCC_DECISION_FORM };
  state.pccActionError = null;
  notify(state);
}

export function updatePccDecisionForm(
  state: PccDashboardState,
  patch: Partial<PccDecisionFormState>,
): void {
  state.pccDecisionForm = { ...state.pccDecisionForm, ...patch };
  notify(state);
}

export function updatePccMilestoneForm(
  state: PccDashboardState,
  patch: Partial<PccMilestoneFormState>,
): void {
  state.pccMilestoneForm = { ...state.pccMilestoneForm, ...patch };
  notify(state);
}
