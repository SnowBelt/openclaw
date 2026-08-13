import type {
  PccAttachmentsListResult,
  PccEvidenceAddResult,
  PccPlansStartResult,
  PccPlansGetResult,
  PccProjectSummary,
  PccProjectsGetResult,
  PccProjectsListResult,
  PccProjectsUpsertResult,
  PccReceiptsAddResult,
} from "../../../../packages/gateway-protocol/src/index.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  EMPTY_PCC_STATE,
  EMPTY_PCC_OWNER_ACCEPTANCE,
  getPccPlanDescription,
  getPccPlanningRunId,
  isPccRunActive,
  type PccOwnerAcceptance,
  type PccGoalAction,
  type PccUiState,
} from "../pcc/application/model.ts";

export type PccControllerHost = object;

const pccStates = new WeakMap<object, PccUiState>();
const ownerAcceptanceTimers = new WeakMap<object, ReturnType<typeof setInterval>>();

const OWNER_ACCEPTANCE_DURATION_MS = 60_000;
const OWNER_ACCEPTANCE_METADATA_KEY = "pccOwnerAcceptance";

function ownerAcceptanceMetadata(project: PccUiState["project"]): Record<string, unknown> | null {
  const metadata = project?.metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[OWNER_ACCEPTANCE_METADATA_KEY];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function ownerAcceptanceFromProject(project: PccUiState["project"]): PccOwnerAcceptance {
  const raw = ownerAcceptanceMetadata(project);
  const state =
    raw?.state === "running" || raw?.state === "complete" || raw?.state === "failed"
      ? raw.state
      : "idle";
  const startedAt = typeof raw?.startedAt === "number" ? raw.startedAt : null;
  const elapsedMs = typeof raw?.elapsedMs === "number" && raw.elapsedMs >= 0 ? raw.elapsedMs : 0;
  const participantHash =
    typeof raw?.participantHash === "string" && raw.participantHash.length > 0
      ? raw.participantHash
      : null;
  const attempt = typeof raw?.attempt === "number" && raw.attempt >= 0 ? raw.attempt : 0;
  const error = typeof raw?.error === "string" ? raw.error : null;
  const receiptId = typeof raw?.receiptId === "string" ? raw.receiptId : null;
  return { state, startedAt, elapsedMs, participantHash, attempt, error, receiptId };
}

function ownerAcceptanceProjectMetadata(
  project: NonNullable<PccUiState["project"]>,
  acceptance: PccOwnerAcceptance,
): Record<string, unknown> {
  return {
    ...project.metadata,
    [OWNER_ACCEPTANCE_METADATA_KEY]: {
      state: acceptance.state,
      startedAt: acceptance.startedAt,
      elapsedMs: acceptance.elapsedMs,
      participantHash: acceptance.participantHash,
      attempt: acceptance.attempt,
      ...(acceptance.error ? { error: acceptance.error } : {}),
      ...(acceptance.receiptId ? { receiptId: acceptance.receiptId } : {}),
      updatedAt: new Date().toISOString(),
    },
  };
}

async function anonymousParticipantHash(): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle || typeof cryptoApi.randomUUID !== "function") {
    throw new Error("Secure anonymous participant hashing is unavailable.");
  }
  const seed = `pcc-owner:${cryptoApi.randomUUID()}`;
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function pendingOwnerMilestone(state: PccUiState) {
  return state.milestones.find(
    (milestone) =>
      milestone.status === "needs_approval" &&
      /owner|acceptance|human|usability/i.test(`${milestone.title} ${milestone.blocker ?? ""}`),
  );
}

function stopOwnerAcceptanceTimer(host: object): void {
  const timer = ownerAcceptanceTimers.get(host);
  if (timer !== undefined) {
    clearInterval(timer);
    ownerAcceptanceTimers.delete(host);
  }
}

function ensureOwnerAcceptanceTimer(params: { host: object; requestUpdate?: () => void }): void {
  if (ownerAcceptanceTimers.has(params.host)) {
    return;
  }
  const timer = setInterval(() => {
    const current = getPccState(params.host).ownerAcceptance;
    if (current.state !== "running" || current.startedAt === null) {
      stopOwnerAcceptanceTimer(params.host);
      return;
    }
    current.elapsedMs = Math.max(0, Date.now() - current.startedAt);
    notify(params.requestUpdate);
  }, 250);
  ownerAcceptanceTimers.set(params.host, timer);
}

export function getPccState(host: PccControllerHost): PccUiState {
  const existing = pccStates.get(host);
  if (existing) {
    return existing;
  }
  const state: PccUiState = {
    ...EMPTY_PCC_STATE,
    projects: [],
    milestones: [],
    ownerAcceptance: { ...EMPTY_PCC_OWNER_ACCEPTANCE },
  };
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
  host: PccControllerHost;
  client: GatewayBrowserClient;
  state: PccUiState;
  projectId: string;
  requestUpdate?: () => void;
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
  params.state.ownerAcceptance = ownerAcceptanceFromProject(result.project);
  if (params.state.ownerAcceptance.state === "running") {
    ensureOwnerAcceptanceTimer({ host: params.host, requestUpdate: params.requestUpdate });
  } else {
    stopOwnerAcceptanceTimer(params.host);
  }
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
      await loadProject({
        host: params.host,
        client: params.client,
        state,
        projectId: preferred,
        requestUpdate: params.requestUpdate,
      });
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
    await loadProject({
      host: params.host,
      client: params.client,
      state,
      projectId: params.projectId,
      requestUpdate: params.requestUpdate,
    });
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

async function persistOwnerAcceptanceMetadata(params: {
  client: GatewayBrowserClient;
  state: PccUiState;
  acceptance: PccOwnerAcceptance;
}): Promise<void> {
  const project = params.state.project;
  if (!project) {
    throw new Error("Select a project before starting owner acceptance.");
  }
  const result = await params.client.request<PccProjectsUpsertResult>("pcc.projects.upsert", {
    project: {
      id: project.id,
      title: project.title,
      goal: project.goal,
      status: project.status,
      owner: project.owner,
      priority: project.priority,
      phases: project.phases,
      metadata: ownerAcceptanceProjectMetadata(project, params.acceptance),
    },
  });
  params.state.project = result.project;
  params.state.summary = result.summary;
  params.state.ownerAcceptance = params.acceptance;
}

export async function startPccOwnerAcceptance(params: {
  host: PccControllerHost;
  client: GatewayBrowserClient | null;
  requestUpdate?: () => void;
}): Promise<void> {
  const state = getPccState(params.host);
  if (!params.client || !state.project) {
    state.ownerAcceptance = {
      ...state.ownerAcceptance,
      state: "failed",
      error: !params.client
        ? "Connect to the Gateway before starting owner acceptance."
        : "Select a project before starting owner acceptance.",
    };
    notify(params.requestUpdate);
    return;
  }
  if (!pendingOwnerMilestone(state)) {
    state.ownerAcceptance = {
      ...state.ownerAcceptance,
      state: "failed",
      error: "No pending owner-acceptance milestone is available.",
    };
    notify(params.requestUpdate);
    return;
  }
  if (state.ownerAcceptance.state === "running") {
    return;
  }
  state.saving = true;
  state.error = null;
  state.message = null;
  notify(params.requestUpdate);
  try {
    const acceptance: PccOwnerAcceptance = {
      state: "running",
      startedAt: Date.now(),
      elapsedMs: 0,
      participantHash: await anonymousParticipantHash(),
      attempt: state.ownerAcceptance.attempt + 1,
      error: null,
      receiptId: null,
    };
    stopOwnerAcceptanceTimer(params.host);
    await persistOwnerAcceptanceMetadata({ client: params.client, state, acceptance });
    ensureOwnerAcceptanceTimer({ host: params.host, requestUpdate: params.requestUpdate });
  } catch (error) {
    state.ownerAcceptance = {
      ...state.ownerAcceptance,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    state.saving = false;
    notify(params.requestUpdate);
  }
}

export async function cancelPccOwnerAcceptance(params: {
  host: PccControllerHost;
  client: GatewayBrowserClient | null;
  requestUpdate?: () => void;
}): Promise<void> {
  const state = getPccState(params.host);
  if (state.ownerAcceptance.state !== "running") {
    return;
  }
  stopOwnerAcceptanceTimer(params.host);
  const previous = state.ownerAcceptance;
  const acceptance: PccOwnerAcceptance = {
    ...previous,
    state: "failed",
    elapsedMs: previous.startedAt === null ? previous.elapsedMs : Date.now() - previous.startedAt,
    error: "Owner acceptance was cancelled before completion.",
  };
  state.ownerAcceptance = acceptance;
  state.saving = true;
  notify(params.requestUpdate);
  try {
    if (params.client && state.project) {
      await persistOwnerAcceptanceMetadata({ client: params.client, state, acceptance });
      const milestone = pendingOwnerMilestone(state);
      if (milestone) {
        await params.client.request<PccEvidenceAddResult>("pcc.evidence.add", {
          evidence: {
            projectId: state.project.id,
            milestoneId: milestone.id,
            kind: "manual_review",
            status: "failed",
            summary: acceptance.error,
            source: "paired local Chrome",
            metadata: {
              pccOwnerAcceptance: {
                protocolVersion: 1,
                participantHash: acceptance.participantHash,
                attempt: acceptance.attempt,
                startedAt: acceptance.startedAt,
                elapsedMs: acceptance.elapsedMs,
                outcome: "cancelled",
              },
            },
          },
        });
      }
    }
  } catch (error) {
    state.ownerAcceptance.error = `Attempt preserved locally; recording failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  } finally {
    state.saving = false;
    notify(params.requestUpdate);
  }
}

export async function finishPccOwnerAcceptance(params: {
  host: PccControllerHost;
  client: GatewayBrowserClient | null;
  requestUpdate?: () => void;
}): Promise<void> {
  const state = getPccState(params.host);
  const acceptance = state.ownerAcceptance;
  if (!params.client || !state.project) {
    state.ownerAcceptance = {
      ...acceptance,
      state: "failed",
      error: !params.client
        ? "Connect to the Gateway before finishing owner acceptance."
        : "Select a project before finishing owner acceptance.",
    };
    notify(params.requestUpdate);
    return;
  }
  const milestone = pendingOwnerMilestone(state);
  if (!milestone || acceptance.state !== "running" || !acceptance.participantHash) {
    state.ownerAcceptance = {
      ...acceptance,
      state: "failed",
      error: "Start the owner-acceptance timer before finishing it.",
    };
    notify(params.requestUpdate);
    return;
  }
  const elapsedMs =
    acceptance.startedAt === null ? acceptance.elapsedMs : Date.now() - acceptance.startedAt;
  if (elapsedMs < OWNER_ACCEPTANCE_DURATION_MS) {
    state.ownerAcceptance = {
      ...acceptance,
      elapsedMs,
      error: "Complete the full 60-second protocol before recording acceptance.",
    };
    notify(params.requestUpdate);
    return;
  }
  stopOwnerAcceptanceTimer(params.host);
  state.ownerAcceptance = { ...acceptance, state: "submitting", elapsedMs, error: null };
  state.saving = true;
  state.error = null;
  notify(params.requestUpdate);
  try {
    const finishedAt = new Date().toISOString();
    const evidenceResult = await params.client.request<PccEvidenceAddResult>("pcc.evidence.add", {
      evidence: {
        projectId: state.project.id,
        milestoneId: milestone.id,
        kind: "manual_review",
        status: "passed",
        summary: "Anonymous owner completed the zero-hint 60-second PCC protocol.",
        source: "paired local Chrome",
        metadata: {
          pccOwnerAcceptance: {
            protocolVersion: 1,
            participantHash: acceptance.participantHash,
            attempt: acceptance.attempt,
            startedAt: acceptance.startedAt,
            finishedAt,
            elapsedMs,
            hints: 0,
            outcome: "passed",
          },
        },
      },
    });
    const receiptResult = await params.client.request<PccReceiptsAddResult>("pcc.receipts.add", {
      receipt: {
        projectId: state.project.id,
        milestoneId: milestone.id,
        summary: "Anonymous owner acceptance passed after a zero-hint 60-second protocol.",
        proofEvidenceIds: [evidenceResult.evidence.id],
        proofLevel: "local",
        completedBy: "anonymous-owner",
        doNotRedo: ["Repeat the owner acceptance protocol for this exact receipt."],
        artifactRefs: [`pcc-owner-acceptance://${acceptance.participantHash}`],
      },
    });
    state.ownerAcceptance = {
      ...acceptance,
      state: "complete",
      elapsedMs,
      error: null,
      receiptId: receiptResult.receipt.id,
    };
    await persistOwnerAcceptanceMetadata({
      client: params.client,
      state,
      acceptance: state.ownerAcceptance,
    });
    state.message =
      "Owner acceptance recorded. The completion receipt is now attached to this project.";
    await loadProject({
      host: params.host,
      client: params.client,
      state,
      projectId: state.project.id,
      requestUpdate: params.requestUpdate,
    });
    state.ownerAcceptance = {
      ...ownerAcceptanceFromProject(state.project),
      state: "complete",
      elapsedMs,
      receiptId: receiptResult.receipt.id,
    };
  } catch (error) {
    state.ownerAcceptance = {
      ...acceptance,
      state: "failed",
      elapsedMs,
      error: error instanceof Error ? error.message : String(error),
    };
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
    ...project.metadata,
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
