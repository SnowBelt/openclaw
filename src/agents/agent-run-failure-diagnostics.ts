export type AgentRunFailureKind =
  | "stuck_recovery_abort"
  | "user_abort"
  | "gateway_restart"
  | "provider_error"
  | "context_overflow"
  | "unknown";

export type AgentRunFailureDiagnostic = {
  kind: AgentRunFailureKind;
  abortReason?: string;
  provider?: string;
  model?: string;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  errorPreview?: string;
  errorHash?: string;
  providerRuntimeFailureKind?: string;
};

function normalizeReasonText(reason: unknown): string | undefined {
  if (reason === undefined || reason === null) {
    return undefined;
  }
  if (typeof reason === "string") {
    return reason.trim() || undefined;
  }
  if (reason instanceof Error) {
    return reason.message.trim() || reason.name || undefined;
  }
  try {
    return JSON.stringify(reason);
  } catch {
    if (
      typeof reason === "number" ||
      typeof reason === "boolean" ||
      typeof reason === "bigint" ||
      typeof reason === "symbol"
    ) {
      return String(reason);
    }
    return undefined;
  }
}

export function summarizeAgentRunAbortReason(reason: unknown): string | undefined {
  const text = normalizeReasonText(reason);
  if (!text) {
    return undefined;
  }
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

export function classifyAgentRunFailureKind(params: {
  reason?: unknown;
  timedOut?: boolean;
  contextOverflow?: boolean;
  providerRuntimeFailureKind?: string;
}): AgentRunFailureKind | undefined {
  if (params.contextOverflow === true) {
    return "context_overflow";
  }
  const reasonText = normalizeReasonText(params.reason)?.toLowerCase();
  if (reasonText?.includes("context overflow")) {
    return "context_overflow";
  }
  if (reasonText?.includes("stuck_recovery")) {
    return "stuck_recovery_abort";
  }
  if (reasonText === "user_abort" || reasonText?.includes("user abort")) {
    return "user_abort";
  }
  if (
    reasonText === "restart" ||
    reasonText === "gateway_restart" ||
    reasonText?.includes("gateway restart")
  ) {
    return "gateway_restart";
  }
  if (params.providerRuntimeFailureKind || params.timedOut === true) {
    return "provider_error";
  }
  return undefined;
}

export function buildAgentRunFailureDiagnostic(params: {
  kind: AgentRunFailureKind;
  reason?: unknown;
  provider?: string;
  model?: string;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  errorPreview?: string;
  errorHash?: string;
  providerRuntimeFailureKind?: string;
}): AgentRunFailureDiagnostic {
  return {
    kind: params.kind,
    ...(summarizeAgentRunAbortReason(params.reason)
      ? { abortReason: summarizeAgentRunAbortReason(params.reason) }
      : {}),
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.model ? { model: params.model } : {}),
    ...(params.runId ? { runId: params.runId } : {}),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    ...(params.errorPreview ? { errorPreview: params.errorPreview } : {}),
    ...(params.errorHash ? { errorHash: params.errorHash } : {}),
    ...(params.providerRuntimeFailureKind
      ? { providerRuntimeFailureKind: params.providerRuntimeFailureKind }
      : {}),
  };
}
