/** Versioned reliability policy for scheduled programs. */
export type ScheduledProgramCatchUpPolicy = "skip" | "run_latest" | "replay" | "resume" | "manual";

export type ScheduledProgramCriticality = "critical" | "high" | "medium" | "low";

export type ScheduledProgramSideEffectClass =
  | "none"
  | "read_only"
  | "owned_state"
  | "external_reversible"
  | "external_irreversible";

export type ScheduledProgramApprovalClass =
  | "automatic"
  | "operator"
  | "security"
  | "financial"
  | "release";

export type ScheduledProgramResourceClaim = {
  resource: string;
  mode: "shared" | "exclusive";
};

export type ScheduledProgramReliabilityContractV1 = {
  version: 1;
  programId: string;
  ownerAgentId: string;
  criticality: ScheduledProgramCriticality;
  maxLatenessMs: number;
  catchUpPolicy: ScheduledProgramCatchUpPolicy;
  idempotencyScope: "run" | "schedule_window" | "program";
  resourceClaims: ScheduledProgramResourceClaim[];
  sideEffectClass: ScheduledProgramSideEffectClass;
  approvalClass: ScheduledProgramApprovalClass;
  preflight: Array<"model_ready" | "credentials_ready" | "resources_ready" | "route_ready">;
  completionProof: Array<
    "task_terminal" | "authoritative_readback" | "artifact_digest" | "delivery_receipt"
  >;
};

export type ScheduledProgramPreflightCheck =
  ScheduledProgramReliabilityContractV1["preflight"][number];
export type ScheduledProgramCompletionProof =
  ScheduledProgramReliabilityContractV1["completionProof"][number];

/** Derives the durable duplicate-suppression identity declared by the contract. */
export function scheduledProgramIdempotencyKey(params: {
  contract: Pick<ScheduledProgramReliabilityContractV1, "programId" | "idempotencyScope">;
  flowId: string;
  scheduledFor: number;
}): string {
  switch (params.contract.idempotencyScope) {
    case "program":
      return params.contract.programId;
    case "schedule_window":
      return `${params.contract.programId}:window:${params.scheduledFor}`;
    case "run":
      return `${params.contract.programId}:run:${params.flowId}:${params.scheduledFor}`;
    default:
      throw new Error("unsupported scheduled program idempotency scope");
  }
}

const CRITICALITIES = new Set<ScheduledProgramCriticality>(["critical", "high", "medium", "low"]);
const CATCH_UP_POLICIES = new Set<ScheduledProgramCatchUpPolicy>([
  "skip",
  "run_latest",
  "replay",
  "resume",
  "manual",
]);
const IDEMPOTENCY_SCOPES = new Set<ScheduledProgramReliabilityContractV1["idempotencyScope"]>([
  "run",
  "schedule_window",
  "program",
]);
const SIDE_EFFECT_CLASSES = new Set<ScheduledProgramSideEffectClass>([
  "none",
  "read_only",
  "owned_state",
  "external_reversible",
  "external_irreversible",
]);
const AUTOMATIC_SIDE_EFFECT_CLASSES = new Set<ScheduledProgramSideEffectClass>([
  "none",
  "read_only",
  "owned_state",
  "external_reversible",
]);
const APPROVAL_CLASSES = new Set<ScheduledProgramApprovalClass>([
  "automatic",
  "operator",
  "security",
  "financial",
  "release",
]);
const PREFLIGHT_CHECKS = new Set<ScheduledProgramReliabilityContractV1["preflight"][number]>([
  "model_ready",
  "credentials_ready",
  "resources_ready",
  "route_ready",
]);
const COMPLETION_PROOFS = new Set<ScheduledProgramReliabilityContractV1["completionProof"][number]>(
  ["task_terminal", "authoritative_readback", "artifact_digest", "delivery_receipt"],
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 160 ? normalized : undefined;
}

function parseClosedArray<T extends string>(value: unknown, allowed: ReadonlySet<T>): T[] | null {
  if (!Array.isArray(value) || value.length > 16) {
    return null;
  }
  const parsed: T[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !allowed.has(entry as T)) {
      return null;
    }
    parsed.push(entry as T);
  }
  return [...new Set(parsed)];
}

/** Strictly parses an operator-authored reliability contract. Invalid input fails closed. */
export function parseScheduledProgramReliabilityContract(
  value: unknown,
): ScheduledProgramReliabilityContractV1 | undefined {
  if (!isRecord(value) || value.version !== 1) {
    return undefined;
  }
  const programId = boundedId(value.programId);
  const ownerAgentId = boundedId(value.ownerAgentId);
  const maxLatenessMs = value.maxLatenessMs;
  if (
    !programId ||
    !ownerAgentId ||
    typeof value.criticality !== "string" ||
    !CRITICALITIES.has(value.criticality as ScheduledProgramCriticality) ||
    typeof maxLatenessMs !== "number" ||
    !Number.isSafeInteger(maxLatenessMs) ||
    maxLatenessMs < 0 ||
    typeof value.catchUpPolicy !== "string" ||
    !CATCH_UP_POLICIES.has(value.catchUpPolicy as ScheduledProgramCatchUpPolicy) ||
    typeof value.idempotencyScope !== "string" ||
    !IDEMPOTENCY_SCOPES.has(
      value.idempotencyScope as ScheduledProgramReliabilityContractV1["idempotencyScope"],
    ) ||
    typeof value.sideEffectClass !== "string" ||
    !SIDE_EFFECT_CLASSES.has(value.sideEffectClass as ScheduledProgramSideEffectClass) ||
    typeof value.approvalClass !== "string" ||
    !APPROVAL_CLASSES.has(value.approvalClass as ScheduledProgramApprovalClass)
  ) {
    return undefined;
  }
  if (!Array.isArray(value.resourceClaims) || value.resourceClaims.length > 16) {
    return undefined;
  }
  const resourceClaims: ScheduledProgramResourceClaim[] = [];
  for (const rawClaim of value.resourceClaims) {
    if (!isRecord(rawClaim)) {
      return undefined;
    }
    const resource = boundedId(rawClaim.resource);
    if (!resource || (rawClaim.mode !== "shared" && rawClaim.mode !== "exclusive")) {
      return undefined;
    }
    resourceClaims.push({ resource, mode: rawClaim.mode });
  }
  const preflight = parseClosedArray(value.preflight, PREFLIGHT_CHECKS);
  const completionProof = parseClosedArray(value.completionProof, COMPLETION_PROOFS);
  if (
    !preflight ||
    !completionProof ||
    completionProof.length === 0 ||
    (value.approvalClass === "automatic" &&
      !AUTOMATIC_SIDE_EFFECT_CLASSES.has(value.sideEffectClass as ScheduledProgramSideEffectClass))
  ) {
    return undefined;
  }
  return {
    version: 1,
    programId,
    ownerAgentId,
    criticality: value.criticality as ScheduledProgramCriticality,
    maxLatenessMs,
    catchUpPolicy: value.catchUpPolicy as ScheduledProgramCatchUpPolicy,
    idempotencyScope:
      value.idempotencyScope as ScheduledProgramReliabilityContractV1["idempotencyScope"],
    resourceClaims,
    sideEffectClass: value.sideEffectClass as ScheduledProgramSideEffectClass,
    approvalClass: value.approvalClass as ScheduledProgramApprovalClass,
    preflight,
    completionProof,
  };
}

/** Legacy schedules remain visible but are never silently granted automation authority. */
export function createLegacyScheduledProgramReliabilityContract(params: {
  jobId: string;
  ownerAgentId?: string;
}): ScheduledProgramReliabilityContractV1 {
  return {
    version: 1,
    programId: `cron:${params.jobId}`,
    ownerAgentId: params.ownerAgentId?.trim() || "unassigned",
    criticality: "medium",
    maxLatenessMs: 0,
    catchUpPolicy: "manual",
    idempotencyScope: "run",
    resourceClaims: [],
    sideEffectClass: "external_irreversible",
    approvalClass: "operator",
    preflight: [],
    completionProof: ["task_terminal"],
  };
}
