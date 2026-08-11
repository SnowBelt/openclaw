import { readStringValue } from "@openclaw/normalization-core/string-coerce";
import { AGENT_RUN_RESTART_ABORT_STOP_REASON } from "../../agents/run-termination.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { formatErrorMessage } from "../../infra/errors.js";

export type AgentLifecycleTerminalBackstop = {
  emit: (
    phase: "end" | "error",
    resultOrError: unknown,
    extraData?: Record<string, unknown>,
  ) => void;
  getDeferredError: () => string | undefined;
  note: (evt: { stream: string; data: Record<string, unknown> }) => void;
};

const DEFERRED_TERMINAL_METADATA_KEYS = [
  "stopReason",
  "yielded",
  "timeoutPhase",
  "providerStarted",
  "aborted",
  "livenessState",
  "replayInvalid",
] as const;

export function resolveAgentLifecycleTerminalMetadata(meta: unknown): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (!meta || typeof meta !== "object") {
    return metadata;
  }
  const record = meta as Record<string, unknown>;
  for (const key of DEFERRED_TERMINAL_METADATA_KEYS) {
    if (Object.hasOwn(record, key)) {
      metadata[key] = record[key];
    }
  }
  return metadata;
}

function resolveAgentLifecycleTerminalUsage(meta: unknown): Record<string, number> | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  const agentMeta = (meta as Record<string, unknown>).agentMeta;
  if (!agentMeta || typeof agentMeta !== "object") {
    return undefined;
  }
  const record = agentMeta as Record<string, unknown>;
  const rawUsage =
    record.usage && typeof record.usage === "object"
      ? record.usage
      : record.lastCallUsage && typeof record.lastCallUsage === "object"
        ? record.lastCallUsage
        : undefined;
  if (!rawUsage || typeof rawUsage !== "object") {
    return undefined;
  }
  const usage = rawUsage as Record<string, unknown>;
  const readNonNegativeInteger = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
  const normalized = {
    ...(readNonNegativeInteger(usage.input) !== undefined
      ? { input: readNonNegativeInteger(usage.input) }
      : {}),
    ...(readNonNegativeInteger(usage.output) !== undefined
      ? { output: readNonNegativeInteger(usage.output) }
      : {}),
    ...(readNonNegativeInteger(usage.cacheRead) !== undefined
      ? { cacheRead: readNonNegativeInteger(usage.cacheRead) }
      : {}),
    ...(readNonNegativeInteger(usage.cacheWrite) !== undefined
      ? { cacheWrite: readNonNegativeInteger(usage.cacheWrite) }
      : {}),
    ...(readNonNegativeInteger(usage.totalTokens ?? usage.total) !== undefined
      ? { totalTokens: readNonNegativeInteger(usage.totalTokens ?? usage.total) }
      : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function createAgentLifecycleTerminalBackstop(params: {
  runId: string;
  sessionKey?: string;
  startedAt?: number;
  getLifecycleGeneration: () => string;
  resolveTerminationFields: (error?: unknown) => {
    aborted?: true;
    stopReason?: string;
    timeoutPhase?: string;
  };
}): AgentLifecycleTerminalBackstop {
  let terminalEmitted = false;
  let startedAt = params.startedAt;
  let deferredError: string | undefined;
  const deferredTerminalMetadata: Record<string, unknown> = {};

  const note = (evt: { stream: string; data: Record<string, unknown> }) => {
    if (evt.stream !== "lifecycle") {
      return;
    }
    const phase = readStringValue(evt.data.phase);
    if (phase === "start" && typeof evt.data.startedAt === "number") {
      startedAt = evt.data.startedAt;
    }
    if (phase === "finishing") {
      deferredError = readStringValue(evt.data.error) ?? deferredError;
      Object.assign(deferredTerminalMetadata, resolveAgentLifecycleTerminalMetadata(evt.data));
    }
    if (phase === "end" || phase === "error") {
      terminalEmitted = true;
    }
  };

  const emit: AgentLifecycleTerminalBackstop["emit"] = (phase, resultOrError, extraData) => {
    if (terminalEmitted) {
      return;
    }
    terminalEmitted = true;
    const terminationFields = params.resolveTerminationFields(
      phase === "error" ? resultOrError : undefined,
    );
    const restartAbort = terminationFields.stopReason === AGENT_RUN_RESTART_ABORT_STOP_REASON;
    const data: Record<string, unknown> = {
      ...deferredTerminalMetadata,
      phase: restartAbort ? "end" : phase,
      endedAt: Date.now(),
      ...(startedAt !== undefined ? { startedAt } : {}),
    };
    if (restartAbort) {
      data.aborted = true;
      data.stopReason = AGENT_RUN_RESTART_ABORT_STOP_REASON;
    } else if (phase === "error") {
      data.error = formatErrorMessage(resultOrError);
      Object.assign(data, terminationFields);
    } else {
      const meta =
        resultOrError && typeof resultOrError === "object" && "meta" in resultOrError
          ? (resultOrError as { meta?: Record<string, unknown> }).meta
          : undefined;
      Object.assign(data, resolveAgentLifecycleTerminalMetadata(meta));
      const usage = resolveAgentLifecycleTerminalUsage(meta);
      if (usage) {
        data.usage = usage;
      }
      if (terminationFields.aborted === true) {
        data.aborted = true;
      }
      if (terminationFields.stopReason && !readStringValue(data.stopReason)) {
        data.stopReason = terminationFields.stopReason;
      }
    }
    if (extraData) {
      Object.assign(data, extraData);
    }
    emitAgentEvent({
      runId: params.runId,
      lifecycleGeneration: params.getLifecycleGeneration(),
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      stream: "lifecycle",
      data,
    });
  };

  return {
    emit,
    getDeferredError: () => deferredError,
    note,
  };
}
