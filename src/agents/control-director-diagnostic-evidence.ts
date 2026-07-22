import { createHash } from "node:crypto";

export const CONTROL_DIRECTOR_DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const CONTROL_DIRECTOR_DIAGNOSTIC_EVIDENCE_MAX_AGE_MS = 5 * 60_000;

export type ControlDirectorDiagnosticClaimKind = "completion" | "blocker" | "worker" | "task_root";

export type ControlDirectorDiagnosticClaim = {
  schemaVersion: typeof CONTROL_DIRECTOR_DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION;
  kind: ControlDirectorDiagnosticClaimKind;
  subjectId: string;
  expectedBinding?: string;
};

export type ControlDirectorDiagnosticEvidence = {
  schemaVersion: typeof CONTROL_DIRECTOR_DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION;
  kind: ControlDirectorDiagnosticClaimKind;
  subjectId: string;
  source: "judge_receipt" | "pursue_goal_state" | "spawn_receipt" | "task_registry";
  sourceId: string;
  observedAt: number;
  expiresAt?: number;
  binding?: string;
  status: "supported" | "unsupported" | "unavailable";
};

export type ControlDirectorDiagnosticEvidenceRejection =
  | "unsupported"
  | "stale"
  | "mismatched"
  | "unavailable";

export type ControlDirectorDiagnosticEvidenceVerdict =
  | {
      status: "supported";
      claimHash: string;
      evidenceId: string;
    }
  | {
      status: "rejected";
      claimHash: string;
      reason: ControlDirectorDiagnosticEvidenceRejection;
      detail: string;
    };

function normalized(value: string | undefined): string {
  return value?.replace(/\s+/gu, " ").trim() ?? "";
}

export function buildControlDirectorDiagnosticClaimHash(
  claim: ControlDirectorDiagnosticClaim,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: claim.schemaVersion,
        kind: claim.kind,
        subjectId: normalized(claim.subjectId),
        expectedBinding: normalized(claim.expectedBinding),
      }),
    )
    .digest("hex");
}

function evidenceId(evidence: ControlDirectorDiagnosticEvidence): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: evidence.schemaVersion,
        kind: evidence.kind,
        subjectId: normalized(evidence.subjectId),
        source: evidence.source,
        sourceId: normalized(evidence.sourceId),
        observedAt: evidence.observedAt,
        expiresAt: evidence.expiresAt ?? null,
        binding: normalized(evidence.binding),
        status: evidence.status,
      }),
    )
    .digest("hex");
}

/**
 * Fail-closed verifier for user-visible orchestration diagnostics. Claims and
 * evidence are structured independently; transcript wording is never accepted
 * as proof.
 */
export function verifyControlDirectorDiagnosticEvidence(params: {
  claim: ControlDirectorDiagnosticClaim;
  evidence?: ControlDirectorDiagnosticEvidence;
  now?: number;
  maxAgeMs?: number;
}): ControlDirectorDiagnosticEvidenceVerdict {
  const claimHash = buildControlDirectorDiagnosticClaimHash(params.claim);
  const evidence = params.evidence;
  if (!evidence || evidence.status === "unavailable") {
    return {
      status: "rejected",
      claimHash,
      reason: "unavailable",
      detail: "Typed diagnostic evidence is unavailable.",
    };
  }
  if (evidence.status !== "supported") {
    return {
      status: "rejected",
      claimHash,
      reason: "unsupported",
      detail: "Typed diagnostic evidence does not support the claim.",
    };
  }
  if (
    evidence.schemaVersion !== params.claim.schemaVersion ||
    evidence.kind !== params.claim.kind ||
    normalized(evidence.subjectId) !== normalized(params.claim.subjectId) ||
    (normalized(params.claim.expectedBinding) &&
      normalized(evidence.binding) !== normalized(params.claim.expectedBinding))
  ) {
    return {
      status: "rejected",
      claimHash,
      reason: "mismatched",
      detail: "Typed diagnostic evidence is bound to a different claim subject or revision.",
    };
  }
  const now = params.now ?? Date.now();
  const maxAgeMs = params.maxAgeMs ?? CONTROL_DIRECTOR_DIAGNOSTIC_EVIDENCE_MAX_AGE_MS;
  if (
    !Number.isFinite(evidence.observedAt) ||
    evidence.observedAt < 0 ||
    evidence.observedAt > now ||
    now - evidence.observedAt > maxAgeMs ||
    (evidence.expiresAt !== undefined &&
      (!Number.isFinite(evidence.expiresAt) || evidence.expiresAt < now))
  ) {
    return {
      status: "rejected",
      claimHash,
      reason: "stale",
      detail: "Typed diagnostic evidence is stale or has an invalid observation window.",
    };
  }
  if (!normalized(evidence.sourceId)) {
    return {
      status: "rejected",
      claimHash,
      reason: "unavailable",
      detail: "Typed diagnostic evidence has no durable source identifier.",
    };
  }
  return { status: "supported", claimHash, evidenceId: evidenceId(evidence) };
}
