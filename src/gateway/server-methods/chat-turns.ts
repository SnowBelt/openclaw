// Gateway RPC surface for the durable, mutable Control UI turn inbox.
import crypto from "node:crypto";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChatTurnsCancelParams,
  validateChatTurnsCreateParams,
  validateChatTurnsListParams,
  validateChatTurnsRetryParams,
  validateChatTurnsSetModeParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { isConfiguredControlDirectorAgent } from "../../agents/control-director-role.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import {
  abortChatTurnSubmission,
  kickChatTurnInboxController,
} from "../chat-turn-inbox-controller.js";
import {
  createChatTurnFlow,
  isTerminalChatTurnPhase,
  listChatTurnFlows,
  mapChatTurnSummary,
  mutateChatTurnFlow,
} from "../chat-turn-inbox-state.js";
import type { GatewayRequestHandlers } from "./types.js";

function mutationResponse(result: ReturnType<typeof mutateChatTurnFlow>): {
  found: boolean;
  applied: boolean;
  reason?: string;
  turn?: NonNullable<ReturnType<typeof mapChatTurnSummary>>;
} {
  const turn = result.flow ? mapChatTurnSummary(result.flow) : null;
  return {
    found: result.applied || result.reason !== "not_found",
    applied: result.applied,
    ...(!result.applied ? { reason: result.reason } : {}),
    ...(turn ? { turn } : {}),
  };
}

export const chatTurnsHandlers: GatewayRequestHandlers = {
  "chat.turns.list": ({ params, respond }) => {
    if (!validateChatTurnsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.turns.list params: ${formatValidationErrors(validateChatTurnsListParams.errors)}`,
        ),
      );
      return;
    }
    const turns = listChatTurnFlows({
      sessionKey: params.sessionKey,
      includeTerminal: params.includeTerminal,
    })
      .slice(-200)
      .map((flow) => mapChatTurnSummary(flow))
      .filter((turn): turn is NonNullable<typeof turn> => turn !== null);
    respond(true, { turns });
  },
  "chat.turns.create": ({ params, respond, client, context }) => {
    if (!validateChatTurnsCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.turns.create params: ${formatValidationErrors(validateChatTurnsCreateParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const config = context.getRuntimeConfig();
      const selectedAgentId =
        params.agentId ??
        parseAgentSessionKey(params.sessionKey)?.agentId ??
        resolveDefaultAgentId(config);
      const flow = createChatTurnFlow({
        sessionKey: params.sessionKey,
        ...(params.agentId ? { agentId: params.agentId } : {}),
        message: params.message,
        ...(params.attachments ? { attachments: params.attachments } : {}),
        mode: params.mode,
        idempotencyKey: params.idempotencyKey,
        operatorScopes: client?.connect.scopes,
        ownerConnId: client?.connId,
        ownerDeviceId: client?.connect.device?.id,
        preserveControlDirectorMission: isConfiguredControlDirectorAgent({
          config,
          agentId: selectedAgentId,
        }),
      });
      const turn = flow ? mapChatTurnSummary(flow) : null;
      if (!flow || !turn) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "durable chat turn store is unavailable", {
            retryable: true,
          }),
        );
        return;
      }
      kickChatTurnInboxController(flow.flowId);
      respond(true, { turn });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "chat.turns.setMode": ({ params, respond }) => {
    if (!validateChatTurnsSetModeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.turns.setMode params: ${formatValidationErrors(validateChatTurnsSetModeParams.errors)}`,
        ),
      );
      return;
    }
    const result = mutateChatTurnFlow({
      turnId: params.turnId,
      sessionKey: params.sessionKey,
      expectedRevision: params.expectedRevision,
      idempotencyKey: params.idempotencyKey,
      requireAdmissionOpen: true,
      mutate: (state, now) => {
        if (state.phase !== "pending") {
          return null;
        }
        return { ...state, mode: params.mode, modeUpdatedAt: now };
      },
      patch: (state) => ({
        status: "queued",
        currentStep: state.mode === "steer" ? "Steer pending admission." : "Turn queued.",
      }),
    });
    if (result.applied) {
      kickChatTurnInboxController(params.turnId);
    }
    respond(true, mutationResponse(result));
  },
  "chat.turns.cancel": async ({ params, respond }) => {
    if (!validateChatTurnsCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.turns.cancel params: ${formatValidationErrors(validateChatTurnsCancelParams.errors)}`,
        ),
      );
      return;
    }
    const now = Date.now();
    const result = mutateChatTurnFlow({
      turnId: params.turnId,
      sessionKey: params.sessionKey,
      expectedRevision: params.expectedRevision,
      idempotencyKey: params.idempotencyKey,
      now,
      mutate: (state) =>
        isTerminalChatTurnPhase(state.phase)
          ? null
          : { ...state, phase: "cancelled", endedAt: now, lastError: undefined },
      patch: () => ({ status: "cancelled", currentStep: "Turn cancelled.", endedAt: now }),
    });
    if (result.applied && !result.duplicate) {
      await abortChatTurnSubmission(result.state);
    }
    respond(true, mutationResponse(result));
  },
  "chat.turns.retry": ({ params, respond }) => {
    if (!validateChatTurnsRetryParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.turns.retry params: ${formatValidationErrors(validateChatTurnsRetryParams.errors)}`,
        ),
      );
      return;
    }
    const result = mutateChatTurnFlow({
      turnId: params.turnId,
      sessionKey: params.sessionKey,
      expectedRevision: params.expectedRevision,
      idempotencyKey: params.idempotencyKey,
      mutate: (state, now) => {
        if (state.phase !== "failed") {
          return null;
        }
        return {
          ...state,
          phase: "pending",
          dispatchRunId: crypto.randomUUID(),
          dispatchAttempts: 0,
          modeUpdatedAt: now,
          lastError: undefined,
          endedAt: undefined,
        };
      },
      patch: (state) => ({
        status: "queued",
        currentStep: state.mode === "steer" ? "Steer retry pending." : "Turn retry queued.",
        endedAt: null,
      }),
    });
    if (result.applied) {
      kickChatTurnInboxController(params.turnId);
    }
    respond(true, mutationResponse(result));
  },
};
