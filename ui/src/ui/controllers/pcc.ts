import type {
  PccAttachmentsListResult,
  PccPlansStartResult,
  PccPlansGetResult,
  PccProjectSummary,
  PccProjectsGetResult,
  PccProjectsListResult,
  PccProjectsUpsertResult,
} from "../../../../packages/gateway-protocol/src/index.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  EMPTY_PCC_STATE,
  getPccPlanDescription,
  getPccPlanningRunId,
  isPccRunActive,
  type PccGoalAction,
  type PccUiState,
} from "../pcc/application/model.ts";

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
  params.state.subMilestones = result.subMilestones ?? [];
  params.state.permissions = result.permissions;
  params.state.evidence = result.evidence;
  params.state.receipts = result.receipts;
  params.state.summary = result.summary;
  params.state.planDescription = getPccPlanDescription(result.project);
  params.state.planningRun = null;
  const runId = getPccPlanningRunId(result.project);
  if (runId) {
    try {
      const run = await params.client.request<PccPlansGetResult>("pcc.plans.get", { runId });
      params.state.planningRun = run.run;
    } catch {
      // Older gateways may not expose the durable run reader. The project metadata remains truthful.
    }
  }
  params.state.attachments = [];
  params.state.attachmentsError = null;
  try {
    const attachments = await params.client.request<PccAttachmentsListResult>(
      "pcc.attachments.list",
      {
        projectId: params.projectId,
      },
    );
    params.state.attachments = attachments.attachments ?? [];
  } catch (error) {
    params.state.attachmentsError = error instanceof Error ? error.message : String(error);
  }
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
      state.subMilestones = [];
      state.permissions = [];
      state.evidence = [];
      state.receipts = [];
      state.attachments = [];
      state.attachmentsError = null;
      state.summary = null;
      state.planningRun = null;
      state.planDescription = "";
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
    state.planDescription = params.description.trim();
    if (state.project) {
      await persistWorkLoop({
        client: params.client,
        state,
        stateName: "working",
        runId: result.run.id,
        lastPlanDescription: state.planDescription,
      });
    }
    state.message = `Planning ${result.run.status}. Track run ${result.run.id}.`;
  } catch (error) {
    setError(state, error);
  } finally {
    state.saving = false;
    notify(params.requestUpdate);
  }
}

async function persistWorkLoop(params: {
  client: GatewayBrowserClient;
  state: PccUiState;
  stateName: "idle" | "working" | "paused";
  runId?: string;
  lastPlanDescription?: string;
}): Promise<void> {
  const project = params.state.project;
  if (!project) {
    return;
  }
  const previous =
    project.metadata && typeof project.metadata.pccWorkLoop === "object"
      ? project.metadata.pccWorkLoop
      : {};
  const metadata = {
    ...(project.metadata ?? {}),
    pccWorkLoop: {
      ...previous,
      enabled: params.stateName !== "idle",
      state: params.stateName,
      stopBeforeCodex: true,
      stopBeforeRemoteProof: true,
      stopBeforeDestructiveAction: true,
      continueAroundBlockers: true,
      ...(params.runId ? { runId: params.runId } : {}),
      ...(params.lastPlanDescription ? { lastPlanDescription: params.lastPlanDescription } : {}),
      updatedAt: new Date().toISOString(),
    },
  };
  const result = await params.client.request<PccProjectsUpsertResult>("pcc.projects.upsert", {
    project: {
      id: project.id,
      title: project.title,
      goal: project.goal,
      status:
        params.stateName === "paused"
          ? "on_hold"
          : params.stateName === "working"
            ? "active"
            : "active",
      owner: project.owner,
      priority: project.priority,
      phases: project.phases,
      metadata,
    },
  });
  params.state.project = result.project;
  params.state.summary = result.summary;
}

export async function runPccGoalAction(params: {
  host: PccControllerHost;
  client: GatewayBrowserClient | null;
  action: PccGoalAction;
  requestUpdate?: () => void;
}): Promise<void> {
  const state = getPccState(params.host);
  if (!params.client || !state.project) {
    state.error = !params.client
      ? "Connect to the Gateway before controlling the work loop."
      : "Select a project before controlling the work loop.";
    notify(params.requestUpdate);
    return;
  }
  const client = params.client;
  state.saving = true;
  state.error = null;
  state.message = null;
  notify(params.requestUpdate);
  try {
    if (params.action === "pause" || params.action === "stop") {
      const runId = state.planningRun?.id ?? getPccPlanningRunId(state.project);
      if (runId && isPccRunActive(state.planningRun)) {
        const result = await client.request<PccPlansGetResult>("pcc.plans.cancel", { runId });
        state.planningRun = result.run;
      }
      await persistWorkLoop({
        client,
        state,
        stateName: params.action === "pause" ? "paused" : "idle",
      });
      state.message =
        params.action === "pause" ? "Work paused at a safe checkpoint." : "Work loop stopped.";
    } else {
      const description =
        state.planDescription.trim() ||
        getPccPlanDescription(state.project) ||
        `Continue ${state.project.title}`;
      await persistWorkLoop({
        client,
        state,
        stateName: "working",
        lastPlanDescription: description,
      });
      if (!isPccRunActive(state.planningRun)) {
        const result = await client.request<PccPlansStartResult>("pcc.plans.start", {
          surface: "project_replan",
          description,
          existingTitle: state.project.title,
          ...(state.project.goal ? { existingGoal: state.project.goal } : {}),
          preferredTemplateId: "software-product",
          depth: "medium",
        });
        state.planningRun = result.run;
        await persistWorkLoop({
          client,
          state,
          stateName: "working",
          runId: result.run.id,
          lastPlanDescription: description,
        });
      }
      state.message = params.action === "resume" ? "Work resumed." : "Work is now running.";
    }
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
