import type {
  PccPlansStartResult,
  PccProjectSummary,
  PccProjectsGetResult,
  PccProjectsListResult,
  PccProjectsUpsertResult,
} from "../../../../packages/gateway-protocol/src/index.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import { EMPTY_PCC_STATE, type PccUiState } from "../pcc/application/model.ts";

export type PccControllerHost = object;

const pccStates = new WeakMap<object, PccUiState>();

export function getPccState(host: PccControllerHost): PccUiState {
  const existing = pccStates.get(host);
  if (existing) {
    return existing;
  }
  const state: PccUiState = { ...EMPTY_PCC_STATE, projects: [], milestones: [] };
  pccStates.set(host, state);
  return state;
}

function notify(requestUpdate?: () => void): void {
  requestUpdate?.();
}

function setError(state: PccUiState, error: unknown): void {
  state.error = error instanceof Error ? error.message : String(error);
}

async function loadProject(params: {
  client: GatewayBrowserClient;
  state: PccUiState;
  projectId: string;
}): Promise<void> {
  const result = await params.client.request<PccProjectsGetResult>("pcc.projects.get", {
    projectId: params.projectId,
  });
  params.state.selectedProjectId = params.projectId;
  params.state.project = result.project;
  params.state.milestones = result.milestones;
  params.state.summary = result.summary;
}

export async function loadPcc(params: {
  host: PccControllerHost;
  client: GatewayBrowserClient | null;
  force?: boolean;
  requestUpdate?: () => void;
}): Promise<void> {
  const state = getPccState(params.host);
  if (!params.client) {
    state.error = "Connect to the Gateway to view Project Command Center.";
    notify(params.requestUpdate);
    return;
  }
  if (state.loading && !params.force) {
    return;
  }
  state.loading = true;
  state.error = null;
  state.message = null;
  notify(params.requestUpdate);
  try {
    const result = await params.client.request<PccProjectsListResult>("pcc.projects.list", {});
    state.projects = result.projects;
    const preferred = state.selectedProjectId ?? result.projects[0]?.id ?? null;
    state.selectedProjectId = preferred;
    if (preferred) {
      await loadProject({ client: params.client, state, projectId: preferred });
    } else {
      state.project = null;
      state.milestones = [];
      state.summary = null;
    }
  } catch (error) {
    setError(state, error);
  } finally {
    state.loading = false;
    notify(params.requestUpdate);
  }
}

export async function selectPccProject(params: {
  host: PccControllerHost;
  client: GatewayBrowserClient | null;
  projectId: string;
  requestUpdate?: () => void;
}): Promise<void> {
  const state = getPccState(params.host);
  if (!params.client) {
    state.error = "Connect to the Gateway before selecting a project.";
    notify(params.requestUpdate);
    return;
  }
  state.loading = true;
  state.error = null;
  notify(params.requestUpdate);
  try {
    await loadProject({ client: params.client, state, projectId: params.projectId });
  } catch (error) {
    setError(state, error);
  } finally {
    state.loading = false;
    notify(params.requestUpdate);
  }
}

export async function createPccProject(params: {
  host: PccControllerHost;
  client: GatewayBrowserClient | null;
  title: string;
  goal: string;
  requestUpdate?: () => void;
}): Promise<void> {
  const state = getPccState(params.host);
  if (!params.client) {
    state.error = "Connect to the Gateway before creating a project.";
    notify(params.requestUpdate);
    return;
  }
  state.saving = true;
  state.error = null;
  state.message = null;
  notify(params.requestUpdate);
  try {
    const result = await params.client.request<PccProjectsUpsertResult>("pcc.projects.upsert", {
      project: { title: params.title.trim(), goal: params.goal.trim(), status: "active" },
    });
    state.message = `Created ${result.project.title}.`;
    await loadPcc({ ...params, force: true });
    state.selectedProjectId = result.project.id;
    await selectPccProject({ ...params, projectId: result.project.id });
  } catch (error) {
    setError(state, error);
  } finally {
    state.saving = false;
    notify(params.requestUpdate);
  }
}

export async function startPccPlan(params: {
  host: PccControllerHost;
  client: GatewayBrowserClient | null;
  description: string;
  requestUpdate?: () => void;
}): Promise<void> {
  const state = getPccState(params.host);
  if (!params.client) {
    state.error = "Connect to the Gateway before starting a plan.";
    notify(params.requestUpdate);
    return;
  }
  state.saving = true;
  state.error = null;
  state.message = null;
  notify(params.requestUpdate);
  try {
    const project = state.project;
    const result = await params.client.request<PccPlansStartResult>("pcc.plans.start", {
      surface: project ? "project_replan" : "project_creation",
      description: params.description.trim(),
      ...(project?.title ? { existingTitle: project.title } : {}),
      ...(project?.goal ? { existingGoal: project.goal } : {}),
      preferredTemplateId: "software-product",
      depth: "medium",
    });
    state.planningRun = result.run;
    state.message = `Planning ${result.run.status}. Track run ${result.run.id}.`;
  } catch (error) {
    setError(state, error);
  } finally {
    state.saving = false;
    notify(params.requestUpdate);
  }
}

export function pccProjectSummary(state: PccUiState): PccProjectSummary | null {
  return (
    state.summary ??
    state.projects.find((project) => project.id === state.selectedProjectId) ??
    null
  );
}
