// Pursue Goal application service owns Chat goal discovery and control.
import type { ExecutionStateSnapshot } from "../../../../packages/gateway-protocol/src/index.js";
import {
  buildChatGoalContinuationPrompt,
  CHAT_PURSUE_GOAL_CONTROLLER_ID,
  isChatPursueGoalFlow,
  resolveCurrentChatGoal,
  type ChatGoalControlAction,
  type ChatGoalActionState,
  type ChatGoalFlowSummary,
} from "../chat/pursue-goal.ts";
import { formatConnectError } from "../connect-error.ts";
import { isGatewayMethodAdvertised } from "../gateway-methods.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "../gateway.ts";

type ChatGoalState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  hello?: GatewayHelloOk | null;
  sessionKey: string;
  chatMessage: string;
  chatGoalPanelOpen?: boolean;
  chatGoalDraft?: string;
  chatGoalFlows?: ChatGoalFlowSummary[];
  chatGoalLoading?: boolean;
  chatGoalBusy?: boolean;
  chatGoalAction?: ChatGoalActionState | null;
  chatGoalError?: string | null;
  chatGoalUpdatedAt?: number | null;
  chatExecutionState?: ExecutionStateSnapshot | null;
};

type ChatGoalFlowResponse = {
  flow?: ChatGoalFlowSummary;
};

type ChatGoalFlowsResponse = {
  flows?: ChatGoalFlowSummary[];
  nextCursor?: string;
};

export type ChatGoalRefreshResult = "authoritative" | "fallback" | "failed";

type ChatGoalControlResponse = {
  found: boolean;
  applied: boolean;
  action: ChatGoalControlAction;
  reason?: string;
  flow?: ChatGoalFlowSummary;
};

function requireConnectedChatClient(state: ChatGoalState): GatewayBrowserClient {
  if (!state.client || !state.connected) {
    throw new Error("Gateway is not connected.");
  }
  return state.client;
}

function normalizeOptionalText(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function currentChatSessionKey(state: ChatGoalState): string {
  const normalized = state.sessionKey.trim();
  if (!normalized) {
    throw new Error("No active chat session.");
  }
  return normalized;
}

function setChatGoalError(state: ChatGoalState, err: unknown): void {
  state.chatGoalError = formatConnectError(err);
  state.chatGoalUpdatedAt = Date.now();
}

async function listPaginatedChatGoals(
  client: GatewayBrowserClient,
  sessionKey: string,
  allowLegacyMissingControllerId: boolean,
): Promise<ChatGoalFlowSummary[]> {
  const goals: ChatGoalFlowSummary[] = [];
  const visitedCursors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const page = await client.request<ChatGoalFlowsResponse>("taskFlows.list", {
      sessionKey,
      limit: 500,
      ...(cursor ? { cursor } : {}),
    });
    for (const flow of page.flows ?? []) {
      if (isChatPursueGoalFlow(flow)) {
        goals.push(flow);
      } else if (allowLegacyMissingControllerId && flow.controllerId == null) {
        // Legacy gateways may omit controllerId. Normalize only on that unadvertised path.
        goals.push({ ...flow, controllerId: CHAT_PURSUE_GOAL_CONTROLLER_ID });
      }
    }
    const nextCursor = normalizeOptionalText(page.nextCursor);
    if (!nextCursor || visitedCursors.has(nextCursor)) {
      return goals;
    }
    visitedCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

export async function loadChatGoals(state: ChatGoalState): Promise<ChatGoalRefreshResult> {
  if (!state.client || !state.connected) {
    return "failed";
  }
  state.chatGoalLoading = true;
  try {
    let refreshResult: ChatGoalRefreshResult = "authoritative";
    const allowLegacyMissingControllerId =
      isGatewayMethodAdvertised(state, "taskFlows.list") !== true;
    if (isGatewayMethodAdvertised(state, "executionState.get") === true) {
      const [snapshotResult, goalsResult] = await Promise.allSettled([
        state.client.request<ExecutionStateSnapshot>("executionState.get", {
          sessionKey: state.sessionKey,
          includeTerminal: true,
        }),
        listPaginatedChatGoals(state.client, state.sessionKey, allowLegacyMissingControllerId),
      ]);
      if (snapshotResult.status === "fulfilled") {
        state.chatExecutionState = snapshotResult.value;
      }
      if (goalsResult.status === "fulfilled") {
        state.chatGoalFlows = goalsResult.value;
      } else if (snapshotResult.status === "fulfilled") {
        state.chatGoalFlows = (snapshotResult.value.flows ?? []).filter(isChatPursueGoalFlow);
        refreshResult = "fallback";
      } else {
        throw goalsResult.reason;
      }
    } else {
      state.chatGoalFlows = await listPaginatedChatGoals(
        state.client,
        state.sessionKey,
        allowLegacyMissingControllerId,
      );
    }
    state.chatGoalError = null;
    state.chatGoalUpdatedAt = Date.now();
    return refreshResult;
  } catch (err) {
    setChatGoalError(state, err);
    return "failed";
  } finally {
    state.chatGoalLoading = false;
  }
}

export async function createChatGoal(
  state: ChatGoalState,
  goalText?: string,
): Promise<ChatGoalFlowSummary | null> {
  const goal =
    normalizeOptionalText(goalText) ??
    normalizeOptionalText(state.chatGoalDraft) ??
    normalizeOptionalText(state.chatMessage);
  if (!goal) {
    state.chatGoalError = "Enter a goal first.";
    state.chatGoalUpdatedAt = Date.now();
    return null;
  }
  state.chatGoalBusy = true;
  state.chatGoalError = null;
  try {
    const client = requireConnectedChatClient(state);
    const response = await client.request<ChatGoalFlowResponse>("taskFlows.create", {
      sessionKey: currentChatSessionKey(state),
      goal,
      currentStep: "Goal started from Chat.",
    });
    if (!response.flow?.id) {
      throw new Error("Goal was created without an id.");
    }
    state.chatGoalDraft = "";
    state.chatGoalPanelOpen = true;
    await loadChatGoals(state);
    return response.flow;
  } catch (err) {
    setChatGoalError(state, err);
    return null;
  } finally {
    state.chatGoalBusy = false;
  }
}

async function requestChatGoalControl(params: {
  client: GatewayBrowserClient;
  flowId: string;
  sessionKey: string;
  action: ChatGoalControlAction;
  idempotencyKey: string;
  expectedRevision?: number;
  goal?: string;
}): Promise<ChatGoalControlResponse> {
  return await params.client.request<ChatGoalControlResponse>("taskFlows.control", {
    flowId: params.flowId,
    sessionKey: params.sessionKey,
    action: params.action,
    idempotencyKey: params.idempotencyKey,
    ...(params.expectedRevision !== undefined ? { expectedRevision: params.expectedRevision } : {}),
    ...(params.goal ? { goal: params.goal } : {}),
  });
}

function optimisticGoalControl(
  flow: ChatGoalFlowSummary,
  action: ChatGoalControlAction,
  goal?: string,
): ChatGoalFlowSummary {
  const now = Date.now();
  if (action === "stop") {
    return { ...flow, status: "cancelling", cancelRequestedAt: now };
  }
  if (action === "pause") {
    return { ...flow, status: "paused", currentStep: "Pausing current work…" };
  }
  if (action === "resume" || action === "retry") {
    return { ...flow, status: "queued", currentStep: "Ready to continue." };
  }
  return goal ? { ...flow, goal } : flow;
}

export async function controlChatGoal(
  state: ChatGoalState,
  flowId: string,
  action: ChatGoalControlAction,
  goal?: string,
): Promise<ChatGoalFlowSummary | null> {
  const normalized = flowId.trim();
  if (!normalized || state.chatGoalAction?.flowId === normalized) {
    return null;
  }
  const normalizedGoal = normalizeOptionalText(goal);
  if (action === "edit" && !normalizedGoal) {
    state.chatGoalError = "Enter a goal first.";
    return null;
  }
  state.chatGoalAction = { flowId: normalized, action };
  state.chatGoalError = null;
  const previousFlows = state.chatGoalFlows;
  let refreshedAfterConflict = false;
  const selected = (state.chatGoalFlows ?? []).find(
    (flow) => flow.id === normalized || flow.flowId === normalized,
  );
  state.chatGoalFlows = (state.chatGoalFlows ?? []).map((flow) =>
    flow.id === normalized || flow.flowId === normalized
      ? optimisticGoalControl(flow, action, normalizedGoal)
      : flow,
  );
  try {
    const client = requireConnectedChatClient(state);
    const idempotencyKey = crypto.randomUUID();
    let result = await requestChatGoalControl({
      client,
      flowId: normalized,
      sessionKey: currentChatSessionKey(state),
      action,
      idempotencyKey,
      ...(selected?.revision !== undefined ? { expectedRevision: selected.revision } : {}),
      ...(normalizedGoal ? { goal: normalizedGoal } : {}),
    });
    if (!result.applied && result.reason === "revision_conflict") {
      const refreshResult = await loadChatGoals(state);
      if (refreshResult === "failed") {
        throw new Error(state.chatGoalError ?? "Could not refresh the goal after a conflict.");
      }
      refreshedAfterConflict = refreshResult === "authoritative";
      const current = (state.chatGoalFlows ?? []).find(
        (flow) => flow.id === normalized || flow.flowId === normalized,
      );
      if (!current) {
        throw new Error("Goal changed and is no longer available.");
      }
      refreshedAfterConflict = true;
      result = await requestChatGoalControl({
        client,
        flowId: normalized,
        sessionKey: currentChatSessionKey(state),
        action,
        idempotencyKey,
        ...(current.revision !== undefined ? { expectedRevision: current.revision } : {}),
        ...(normalizedGoal ? { goal: normalizedGoal } : {}),
      });
    }
    if (!result.applied) {
      throw new Error(result.reason ?? `Goal ${action} was not applied.`);
    }
    if (result.flow) {
      state.chatGoalFlows = (state.chatGoalFlows ?? []).map((flow) =>
        flow.id === normalized || flow.flowId === normalized ? result.flow! : flow,
      );
    }
    await loadChatGoals(state);
    return (
      result.flow ??
      (state.chatGoalFlows ?? []).find(
        (flow) => flow.id === normalized || flow.flowId === normalized,
      ) ??
      null
    );
  } catch (err) {
    if (!refreshedAfterConflict) {
      state.chatGoalFlows = previousFlows;
    }
    setChatGoalError(state, err);
    return null;
  } finally {
    state.chatGoalAction = null;
  }
}

export async function cancelChatGoal(state: ChatGoalState, flowId: string): Promise<boolean> {
  return (await controlChatGoal(state, flowId, "stop")) !== null;
}

export async function pauseChatGoal(state: ChatGoalState, flowId: string): Promise<boolean> {
  return (await controlChatGoal(state, flowId, "pause")) !== null;
}

export async function resumeChatGoal(state: ChatGoalState, flowId: string): Promise<boolean> {
  return (await controlChatGoal(state, flowId, "resume")) !== null;
}

export async function retryChatGoal(state: ChatGoalState, flowId: string): Promise<boolean> {
  return (await controlChatGoal(state, flowId, "retry")) !== null;
}

export async function editChatGoal(
  state: ChatGoalState,
  flowId: string,
  goal: string,
): Promise<boolean> {
  const normalizedGoal = normalizeOptionalText(goal);
  if (!normalizedGoal) {
    state.chatGoalError = "Goal is required.";
    return false;
  }
  return (await controlChatGoal(state, flowId, "edit", normalizedGoal)) !== null;
}

export async function stopChatGoal(state: ChatGoalState, flowId: string): Promise<boolean> {
  return (await controlChatGoal(state, flowId, "stop")) !== null;
}

export function buildCurrentChatGoalContinuationPrompt(
  state: ChatGoalState,
  flowId: string,
): string | null {
  const flow =
    (state.chatGoalFlows ?? []).find((entry) => entry.id === flowId || entry.flowId === flowId) ??
    resolveCurrentChatGoal(state.chatGoalFlows);
  return flow ? buildChatGoalContinuationPrompt(flow) : null;
}
