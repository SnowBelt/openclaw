/**
 * Shared before_tool_call state for adjusted tool params.
 * Raw params stay available to the execution-side after-hook path, while
 * diagnostic consumers receive the separately redacted snapshot.
 */
export const adjustedParamsByToolCallId = new Map<string, unknown>();

const ADJUSTED_PARAMS_STATE = Symbol("adjusted-params-state");

type AdjustedParamsState = {
  marker: typeof ADJUSTED_PARAMS_STATE;
  raw: unknown;
  diagnostic: unknown;
  diagnosticConsumed: boolean;
};

function isAdjustedParamsState(value: unknown): value is AdjustedParamsState {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<AdjustedParamsState>).marker === ADJUSTED_PARAMS_STATE
  );
}
export const preExecutionBlockedToolCallIds = new Set<string>();
export const structuredReplaySafeToolCallIds = new Set<string>();

export function buildAdjustedParamsKey(params: { runId?: string; toolCallId: string }): string {
  if (params.runId && params.runId.trim()) {
    return `${params.runId}:${params.toolCallId}`;
  }
  return params.toolCallId;
}

/** Consume and remove hook-adjusted params for a completed tool call. */
export function consumeAdjustedParamsForToolCall(toolCallId: string, runId?: string): unknown {
  const key = buildAdjustedParamsKey({ runId, toolCallId });
  const entry = adjustedParamsByToolCallId.get(key);
  if (entry === undefined) {
    return entry;
  }
  if (isAdjustedParamsState(entry)) {
    adjustedParamsByToolCallId.delete(key);
    return entry.raw;
  }
  adjustedParamsByToolCallId.delete(key);
  return entry;
}

/** Snapshot hook-adjusted params without consuming later outcome bookkeeping. */
export function peekAdjustedParamsForToolCall(toolCallId: string, runId?: string): unknown {
  const key = buildAdjustedParamsKey({ runId, toolCallId });
  const entry = adjustedParamsByToolCallId.get(key);
  const params = isAdjustedParamsState(entry) ? entry.raw : entry;
  return params === undefined ? undefined : structuredClone(params);
}

/** Consume the redacted params snapshot used by diagnostics and replay summaries. */
export function consumeDiagnosticAdjustedParamsForToolCall(
  toolCallId: string,
  runId?: string,
): unknown {
  const key = buildAdjustedParamsKey({ runId, toolCallId });
  const entry = adjustedParamsByToolCallId.get(key);
  if (entry === undefined) {
    return entry;
  }
  if (isAdjustedParamsState(entry)) {
    if (entry.diagnosticConsumed) {
      return undefined;
    }
    entry.diagnosticConsumed = true;
    if (entry.raw === undefined) {
      adjustedParamsByToolCallId.delete(key);
    }
    try {
      return structuredClone(entry.diagnostic);
    } catch {
      return { redacted: true };
    }
  }
  adjustedParamsByToolCallId.delete(key);
  return entry;
}

/** Snapshot redacted params without consuming the raw execution-side snapshot. */
export function peekDiagnosticAdjustedParamsForToolCall(
  toolCallId: string,
  runId?: string,
): unknown {
  const key = buildAdjustedParamsKey({ runId, toolCallId });
  const entry = adjustedParamsByToolCallId.get(key);
  const params = isAdjustedParamsState(entry)
    ? entry.diagnosticConsumed
      ? undefined
      : entry.diagnostic
    : entry;
  return params === undefined ? undefined : structuredClone(params);
}

export function recordAdjustedParamsWithDiagnosticSnapshot(
  toolCallId: string | undefined,
  rawParams: unknown,
  diagnosticParams: unknown,
  runId?: string,
): void {
  if (!toolCallId) {
    return;
  }
  const adjustedParamsKey = buildAdjustedParamsKey({ runId, toolCallId });
  try {
    const raw = structuredClone(rawParams);
    const diagnostic = structuredClone(diagnosticParams);
    adjustedParamsByToolCallId.set(adjustedParamsKey, {
      marker: ADJUSTED_PARAMS_STATE,
      raw,
      diagnostic,
      diagnosticConsumed: false,
    } satisfies AdjustedParamsState);
  } catch {
    // Uncloneable params cannot be retained safely for later consumers.
  }
}

/** Consume whether policy prevented the target tool from starting. */
export function consumePreExecutionBlockedToolCall(toolCallId: string, runId?: string): boolean {
  const key = buildAdjustedParamsKey({ runId, toolCallId });
  const blocked = preExecutionBlockedToolCallIds.has(key);
  preExecutionBlockedToolCallIds.delete(key);
  return blocked;
}

export function recordStructuredReplaySafeToolCall(toolCallId: string, runId?: string): void {
  structuredReplaySafeToolCallIds.add(buildAdjustedParamsKey({ runId, toolCallId }));
}

export function consumeStructuredReplaySafeToolCall(toolCallId: string, runId?: string): boolean {
  const key = buildAdjustedParamsKey({ runId, toolCallId });
  const replaySafe = structuredReplaySafeToolCallIds.has(key);
  structuredReplaySafeToolCallIds.delete(key);
  return replaySafe;
}

/** Clear adjusted tool parameters between isolated tests. */
export function resetAdjustedParamsByToolCallIdForTests(): void {
  adjustedParamsByToolCallId.clear();
  preExecutionBlockedToolCallIds.clear();
  structuredReplaySafeToolCallIds.clear();
}
