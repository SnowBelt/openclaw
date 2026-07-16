export type GatewayErrorShape = {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
};

/**
 * Lightweight plugin-SDK mirror of the canonical gateway error codes.
 * Keep this surface isolated so plugins do not inherit the full protocol schema graph.
 */
export const ErrorCodes = {
  NOT_LINKED: "NOT_LINKED",
  NOT_PAIRED: "NOT_PAIRED",
  AGENT_TIMEOUT: "AGENT_TIMEOUT",
  INVALID_REQUEST: "INVALID_REQUEST",
  APPROVAL_NOT_FOUND: "APPROVAL_NOT_FOUND",
  UNAVAILABLE: "UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export function errorShape(
  code: ErrorCode,
  message: string,
  opts?: { details?: unknown; retryable?: boolean; retryAfterMs?: number },
): GatewayErrorShape {
  return { code, message, ...opts };
}
