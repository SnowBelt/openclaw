const VALID_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/iu;

/** Redact Browser session routing metadata before it reaches diagnostics. */
export function redactBrowserDiagnosticSessionKey(
  sessionKey: string | undefined,
): string | undefined {
  const normalized = sessionKey?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "global") {
    return "GLOBAL";
  }
  const parts = normalized.split(":");
  if (parts[0] !== "agent") {
    return "UNSCOPED";
  }
  const ownerAgentId = parts[1]?.trim();
  if (!ownerAgentId || !VALID_AGENT_ID_RE.test(ownerAgentId)) {
    return "UNKNOWN";
  }
  if (parts.slice(2).some((part) => part.trim().length === 0)) {
    return "UNKNOWN";
  }
  return `agent:${ownerAgentId}:REDACTED`;
}
