import { isValidAgentId, normalizeAgentId } from "../routing/session-key.js";

type SessionStewardBoundaryKind = "agent" | "global" | "unscoped" | "unknown" | "malformed";

export type SessionStewardAgentRelation = "same_agent" | "cross_agent" | "unbound";

export type SessionStewardBoundaryDecision = {
  kind: SessionStewardBoundaryKind;
  ownerAgentId: string;
  requestedAgentId: string;
  agentRelation: SessionStewardAgentRelation;
  affectedSession: string;
};

type ResolveSessionStewardBoundaryParams = {
  sessionKey?: string | null;
  requestedAgentId?: string | null;
  configuredAgentIds?: readonly string[];
};

const UNKNOWN = "UNKNOWN";

function normalizeBoundarySegment(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeBoundaryAgentId(
  value: string | null | undefined,
  configuredAgentIds: readonly string[] | undefined,
): string {
  const normalized = normalizeBoundarySegment(value);
  if (!normalized || isValidAgentId(normalized)) {
    return normalized;
  }
  const configured = configuredAgentIds?.find(
    (agentId) => normalizeBoundarySegment(agentId) === normalized,
  );
  return configured ? normalizeAgentId(configured) : "";
}

function unknownDecision(requestedAgentId: string): SessionStewardBoundaryDecision {
  return {
    kind: "unknown",
    ownerAgentId: UNKNOWN,
    requestedAgentId,
    agentRelation: "unbound",
    affectedSession: UNKNOWN,
  };
}

function malformedDecision(requestedAgentId: string): SessionStewardBoundaryDecision {
  return {
    kind: "malformed",
    ownerAgentId: UNKNOWN,
    requestedAgentId,
    agentRelation: "unbound",
    affectedSession: UNKNOWN,
  };
}

function resolveAgentRelation(
  ownerAgentId: string,
  requestedAgentId: string,
): SessionStewardAgentRelation {
  if (!ownerAgentId || !requestedAgentId || requestedAgentId === UNKNOWN) {
    return "unbound";
  }
  return ownerAgentId === requestedAgentId ? "same_agent" : "cross_agent";
}

// Session Steward policy returns only normalized owners and redacted selectors.
// Raw session tails remain outside this decision object to keep boundary logs safe.
export function resolveSessionStewardBoundary(
  params: ResolveSessionStewardBoundaryParams,
): SessionStewardBoundaryDecision {
  const rawRequestedAgentId = normalizeBoundarySegment(params.requestedAgentId);
  const normalizedRequestedAgentId = normalizeBoundaryAgentId(
    params.requestedAgentId,
    params.configuredAgentIds,
  );
  if (rawRequestedAgentId && !normalizedRequestedAgentId) {
    return malformedDecision(UNKNOWN);
  }
  const requestedAgentId = normalizedRequestedAgentId || UNKNOWN;
  const normalizedSessionKey = normalizeBoundarySegment(params.sessionKey);
  if (!normalizedSessionKey) {
    return unknownDecision(requestedAgentId);
  }
  if (normalizedSessionKey === "global") {
    return {
      kind: "global",
      ownerAgentId: UNKNOWN,
      requestedAgentId,
      agentRelation: "unbound",
      affectedSession: "GLOBAL",
    };
  }

  const parts = normalizedSessionKey.split(":");
  if (parts[0] !== "agent") {
    return {
      kind: "unscoped",
      ownerAgentId: UNKNOWN,
      requestedAgentId,
      agentRelation: "unbound",
      affectedSession: "UNSCOPED",
    };
  }

  const rawOwnerAgentId = parts[1]?.trim() ?? "";
  const ownerAgentId = normalizeBoundaryAgentId(rawOwnerAgentId, params.configuredAgentIds);
  const hasMalformedEmptyTail =
    parts.length > 2 && !parts.slice(2).some((part) => part.trim().length > 0);
  if (!rawOwnerAgentId || !ownerAgentId || hasMalformedEmptyTail) {
    return malformedDecision(requestedAgentId);
  }

  return {
    kind: "agent",
    ownerAgentId,
    requestedAgentId,
    agentRelation: resolveAgentRelation(ownerAgentId, requestedAgentId),
    affectedSession: `agent:${ownerAgentId}:REDACTED`,
  };
}
