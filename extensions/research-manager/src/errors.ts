export type ResearchBlockedCode =
  | "capability_unavailable"
  | "model_busy"
  | "model_unqualified"
  | "retrieval_unavailable"
  | "deadline_exceeded"
  | "certification_failed";

export class ResearchBlockedError extends Error {
  readonly code: ResearchBlockedCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ResearchBlockedCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ResearchBlockedError";
    this.code = code;
    this.details = details;
  }
}

export function formatResearchError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function classifyModelError(
  error: unknown,
): "busy" | "timeout" | "unavailable" | "auth" | "invalid-output" | "other" {
  const message = formatResearchError(error).toLowerCase();
  if (/timed?\s*out|timeout|deadline|abort/.test(message)) {
    return "timeout";
  }
  if (/busy|queue full|overload|rate.?limit|429|resource exhausted|capacity/.test(message)) {
    return "busy";
  }
  if (
    /not found|unknown model|model.*missing|unavailable|connection refused|econnrefused|503/.test(
      message,
    )
  ) {
    return "unavailable";
  }
  if (/auth|unauthorized|forbidden|credential|api.?key|401|403/.test(message)) {
    return "auth";
  }
  if (/invalid json|schema|empty output|did not match/.test(message)) {
    return "invalid-output";
  }
  return "other";
}
