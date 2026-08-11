// Canonical approval contract shared by Control Director execution surfaces.
import type { PccPermissionGrant } from "../../packages/gateway-protocol/src/schema/types.js";

export const EXECUTION_APPROVAL_SCHEMA_VERSION = 1 as const;
export const EXECUTION_APPROVAL_AUDIT_LIMIT = 200;

export type ExecutionApprovalAction =
  | "read"
  | "plan"
  | "delegate"
  | "mutate_workspace"
  | "execute_command"
  | "use_codex"
  | "external_network"
  | "deploy_runtime"
  | "publish"
  | "release"
  | "destructive_action"
  | "live_money";

export type ExecutionApprovalResourceKind =
  | "session"
  | "project"
  | "milestone"
  | "workspace"
  | "model"
  | "runtime"
  | "external";

export type ExecutionApprovalRisk = "low" | "medium" | "high" | "critical";
export type ExecutionApprovalStatus = "pending" | "active" | "denied" | "revoked";
export type ExecutionApprovalAuditEvent =
  | "created"
  | "evaluated"
  | "consumed"
  | "denied"
  | "revoked";

export type ExecutionApprovalAuditEntry = {
  at: number;
  actorId: string;
  event: ExecutionApprovalAuditEvent;
  reason?: string;
  useCount?: number;
  tokenCount?: number;
  costMilliUsd?: number;
};

export type ExecutionApprovalEnvelope = {
  schemaVersion: typeof EXECUTION_APPROVAL_SCHEMA_VERSION;
  approvalId: string;
  subjectActorId: string;
  grantedBy: string;
  action: ExecutionApprovalAction;
  resource: { kind: ExecutionApprovalResourceKind; id: string };
  risk: ExecutionApprovalRisk;
  status: ExecutionApprovalStatus;
  budget: {
    maxUses: number;
    usedCount: number;
    maxTokens?: number;
    usedTokens: number;
    maxCostMilliUsd?: number;
    usedCostMilliUsd: number;
  };
  issuedAt: number;
  expiresAt?: number;
  revokedAt?: number;
  constraints: string[];
  audit: ExecutionApprovalAuditEntry[];
};

export type ExecutionApprovalRequest = {
  actorId: string;
  action: ExecutionApprovalAction;
  resource: { kind: ExecutionApprovalResourceKind; id: string };
  useCount?: number;
  tokenCount?: number;
  costMilliUsd?: number;
  now?: number;
};

export type ExecutionApprovalDecision =
  | { allowed: true; code: "approved" }
  | {
      allowed: false;
      code:
        | "pending"
        | "denied"
        | "revoked"
        | "expired"
        | "actor_mismatch"
        | "action_mismatch"
        | "resource_mismatch"
        | "use_budget_exhausted"
        | "token_budget_exhausted"
        | "cost_budget_exhausted";
      reason: string;
    };

const ACTIONS = new Set<ExecutionApprovalAction>([
  "read",
  "plan",
  "delegate",
  "mutate_workspace",
  "execute_command",
  "use_codex",
  "external_network",
  "deploy_runtime",
  "publish",
  "release",
  "destructive_action",
  "live_money",
]);
const RESOURCE_KINDS = new Set<ExecutionApprovalResourceKind>([
  "session",
  "project",
  "milestone",
  "workspace",
  "model",
  "runtime",
  "external",
]);
const RISKS = new Set<ExecutionApprovalRisk>(["low", "medium", "high", "critical"]);
const STATUSES = new Set<ExecutionApprovalStatus>(["pending", "active", "denied", "revoked"]);
const AUDIT_EVENTS = new Set<ExecutionApprovalAuditEvent>([
  "created",
  "evaluated",
  "consumed",
  "denied",
  "revoked",
]);

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be non-empty.`);
  }
  return normalized;
}

function wholeNonNegative(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
  return resolved;
}

function boundedConstraints(values: readonly string[] | undefined): string[] {
  return [
    ...new Set((values ?? []).map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean)),
  ]
    .slice(0, 50)
    .map((value) => value.slice(0, 500));
}

function appendAudit(
  envelope: ExecutionApprovalEnvelope,
  entry: ExecutionApprovalAuditEntry,
): ExecutionApprovalAuditEntry[] {
  return [...envelope.audit, entry].slice(-EXECUTION_APPROVAL_AUDIT_LIMIT);
}

export function createExecutionApprovalEnvelope(input: {
  approvalId?: string;
  subjectActorId: string;
  grantedBy: string;
  action: ExecutionApprovalAction;
  resource: { kind: ExecutionApprovalResourceKind; id: string };
  risk: ExecutionApprovalRisk;
  status?: ExecutionApprovalStatus;
  maxUses?: number;
  usedCount?: number;
  maxTokens?: number;
  usedTokens?: number;
  maxCostMilliUsd?: number;
  usedCostMilliUsd?: number;
  issuedAt?: number;
  expiresAt?: number;
  revokedAt?: number;
  constraints?: readonly string[];
}): ExecutionApprovalEnvelope {
  const issuedAt = wholeNonNegative(input.issuedAt, Date.now(), "issuedAt");
  const status = input.status ?? "active";
  const envelope: ExecutionApprovalEnvelope = {
    schemaVersion: EXECUTION_APPROVAL_SCHEMA_VERSION,
    approvalId: nonEmpty(
      input.approvalId ?? `approval:${globalThis.crypto.randomUUID()}`,
      "approvalId",
    ),
    subjectActorId: nonEmpty(input.subjectActorId, "subjectActorId"),
    grantedBy: nonEmpty(input.grantedBy, "grantedBy"),
    action: input.action,
    resource: {
      kind: input.resource.kind,
      id: nonEmpty(input.resource.id, "resource.id"),
    },
    risk: input.risk,
    status,
    budget: {
      maxUses: wholeNonNegative(input.maxUses, 1, "maxUses"),
      usedCount: wholeNonNegative(input.usedCount, 0, "usedCount"),
      ...(input.maxTokens !== undefined
        ? { maxTokens: wholeNonNegative(input.maxTokens, 0, "maxTokens") }
        : {}),
      usedTokens: wholeNonNegative(input.usedTokens, 0, "usedTokens"),
      ...(input.maxCostMilliUsd !== undefined
        ? {
            maxCostMilliUsd: wholeNonNegative(input.maxCostMilliUsd, 0, "maxCostMilliUsd"),
          }
        : {}),
      usedCostMilliUsd: wholeNonNegative(input.usedCostMilliUsd, 0, "usedCostMilliUsd"),
    },
    issuedAt,
    ...(input.expiresAt !== undefined
      ? { expiresAt: wholeNonNegative(input.expiresAt, 0, "expiresAt") }
      : {}),
    ...(input.revokedAt !== undefined
      ? { revokedAt: wholeNonNegative(input.revokedAt, 0, "revokedAt") }
      : {}),
    constraints: boundedConstraints(input.constraints),
    audit: [
      {
        at: issuedAt,
        actorId: nonEmpty(input.grantedBy, "grantedBy"),
        event: status === "denied" ? "denied" : status === "revoked" ? "revoked" : "created",
      },
    ],
  };
  if (!ACTIONS.has(envelope.action) || !RESOURCE_KINDS.has(envelope.resource.kind)) {
    throw new Error("Approval action and resource kind must use canonical closed values.");
  }
  if (!RISKS.has(envelope.risk) || !STATUSES.has(envelope.status)) {
    throw new Error("Approval risk and status must use canonical closed values.");
  }
  if (envelope.budget.maxUses < 1 || envelope.budget.usedCount > envelope.budget.maxUses) {
    throw new Error("Approval use budget is invalid.");
  }
  if (envelope.expiresAt !== undefined && envelope.expiresAt <= envelope.issuedAt) {
    throw new Error("Approval expiry must be later than issuance.");
  }
  return envelope;
}

export function parseExecutionApprovalEnvelope(value: unknown): ExecutionApprovalEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const resource = record.resource as Record<string, unknown> | undefined;
  const budget = record.budget as Record<string, unknown> | undefined;
  const audit = Array.isArray(record.audit) ? record.audit : null;
  if (
    record.schemaVersion !== 1 ||
    typeof record.approvalId !== "string" ||
    typeof record.subjectActorId !== "string" ||
    typeof record.grantedBy !== "string" ||
    !ACTIONS.has(record.action as ExecutionApprovalAction) ||
    !resource ||
    !RESOURCE_KINDS.has(resource.kind as ExecutionApprovalResourceKind) ||
    typeof resource.id !== "string" ||
    !RISKS.has(record.risk as ExecutionApprovalRisk) ||
    !STATUSES.has(record.status as ExecutionApprovalStatus) ||
    !budget ||
    !Array.isArray(record.constraints) ||
    !record.constraints.every((entry) => typeof entry === "string") ||
    !audit ||
    !audit.every((entry) => {
      const item = entry as Record<string, unknown>;
      return (
        typeof item.at === "number" &&
        Number.isSafeInteger(item.at) &&
        typeof item.actorId === "string" &&
        AUDIT_EVENTS.has(item.event as ExecutionApprovalAuditEvent)
      );
    })
  ) {
    return null;
  }
  try {
    const parsed = createExecutionApprovalEnvelope({
      approvalId: record.approvalId,
      subjectActorId: record.subjectActorId,
      grantedBy: record.grantedBy,
      action: record.action as ExecutionApprovalAction,
      resource: {
        kind: resource.kind as ExecutionApprovalResourceKind,
        id: resource.id,
      },
      risk: record.risk as ExecutionApprovalRisk,
      status: record.status as ExecutionApprovalStatus,
      maxUses: budget.maxUses as number,
      usedCount: budget.usedCount as number,
      ...(budget.maxTokens !== undefined ? { maxTokens: budget.maxTokens as number } : {}),
      usedTokens: budget.usedTokens as number,
      ...(budget.maxCostMilliUsd !== undefined
        ? { maxCostMilliUsd: budget.maxCostMilliUsd as number }
        : {}),
      usedCostMilliUsd: budget.usedCostMilliUsd as number,
      issuedAt: record.issuedAt as number,
      ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt as number } : {}),
      ...(record.revokedAt !== undefined ? { revokedAt: record.revokedAt as number } : {}),
      constraints: record.constraints,
    });
    return { ...parsed, audit: structuredClone(audit) as ExecutionApprovalAuditEntry[] };
  } catch {
    return null;
  }
}

export function evaluateExecutionApprovalEnvelope(
  envelope: ExecutionApprovalEnvelope,
  request: ExecutionApprovalRequest,
): ExecutionApprovalDecision {
  const now = request.now ?? Date.now();
  if (envelope.status !== "active") {
    const code = envelope.status;
    return { allowed: false, code, reason: `Approval is ${envelope.status}.` };
  }
  if (envelope.revokedAt !== undefined) {
    return { allowed: false, code: "revoked", reason: "Approval has been revoked." };
  }
  if (envelope.expiresAt !== undefined && envelope.expiresAt <= now) {
    return { allowed: false, code: "expired", reason: "Approval has expired." };
  }
  if (envelope.subjectActorId !== request.actorId) {
    return { allowed: false, code: "actor_mismatch", reason: "Approval belongs to another actor." };
  }
  if (envelope.action !== request.action) {
    return { allowed: false, code: "action_mismatch", reason: "Approval covers another action." };
  }
  if (
    envelope.resource.kind !== request.resource.kind ||
    (envelope.resource.id !== "*" && envelope.resource.id !== request.resource.id)
  ) {
    return {
      allowed: false,
      code: "resource_mismatch",
      reason: "Approval covers another resource.",
    };
  }
  const useCount = wholeNonNegative(request.useCount, 1, "request.useCount");
  const tokenCount = wholeNonNegative(request.tokenCount, 0, "request.tokenCount");
  const costMilliUsd = wholeNonNegative(request.costMilliUsd, 0, "request.costMilliUsd");
  if (envelope.budget.usedCount + useCount > envelope.budget.maxUses) {
    return {
      allowed: false,
      code: "use_budget_exhausted",
      reason: "Approval use budget is exhausted.",
    };
  }
  if (
    envelope.budget.maxTokens !== undefined &&
    envelope.budget.usedTokens + tokenCount > envelope.budget.maxTokens
  ) {
    return {
      allowed: false,
      code: "token_budget_exhausted",
      reason: "Approval token budget is exhausted.",
    };
  }
  if (
    envelope.budget.maxCostMilliUsd !== undefined &&
    envelope.budget.usedCostMilliUsd + costMilliUsd > envelope.budget.maxCostMilliUsd
  ) {
    return {
      allowed: false,
      code: "cost_budget_exhausted",
      reason: "Approval cost budget is exhausted.",
    };
  }
  return { allowed: true, code: "approved" };
}

export function consumeExecutionApprovalEnvelope(params: {
  envelope: ExecutionApprovalEnvelope;
  request: ExecutionApprovalRequest;
}): { decision: ExecutionApprovalDecision; envelope: ExecutionApprovalEnvelope } {
  const decision = evaluateExecutionApprovalEnvelope(params.envelope, params.request);
  const at = params.request.now ?? Date.now();
  const useCount = params.request.useCount ?? 1;
  const tokenCount = params.request.tokenCount ?? 0;
  const costMilliUsd = params.request.costMilliUsd ?? 0;
  if (!decision.allowed) {
    return {
      decision,
      envelope: {
        ...params.envelope,
        audit: appendAudit(params.envelope, {
          at,
          actorId: params.request.actorId,
          event: "denied",
          reason: decision.reason,
        }),
      },
    };
  }
  return {
    decision,
    envelope: {
      ...params.envelope,
      budget: {
        ...params.envelope.budget,
        usedCount: params.envelope.budget.usedCount + useCount,
        usedTokens: params.envelope.budget.usedTokens + tokenCount,
        usedCostMilliUsd: params.envelope.budget.usedCostMilliUsd + costMilliUsd,
      },
      audit: appendAudit(params.envelope, {
        at,
        actorId: params.request.actorId,
        event: "consumed",
        useCount,
        tokenCount,
        costMilliUsd,
      }),
    },
  };
}

export function revokeExecutionApprovalEnvelope(params: {
  envelope: ExecutionApprovalEnvelope;
  revokedBy: string;
  reason: string;
  now?: number;
}): ExecutionApprovalEnvelope {
  const at = params.now ?? Date.now();
  return {
    ...params.envelope,
    status: "revoked",
    revokedAt: at,
    audit: appendAudit(params.envelope, {
      at,
      actorId: nonEmpty(params.revokedBy, "revokedBy"),
      event: "revoked",
      reason: nonEmpty(params.reason, "reason").slice(0, 500),
    }),
  };
}

export function executionActionRequiresApproval(params: {
  action: ExecutionApprovalAction;
  risk: ExecutionApprovalRisk;
}): boolean {
  return (
    params.risk === "high" ||
    params.risk === "critical" ||
    params.action === "use_codex" ||
    params.action === "deploy_runtime" ||
    params.action === "publish" ||
    params.action === "release" ||
    params.action === "destructive_action" ||
    params.action === "live_money"
  );
}

function actionForPccPermission(type: PccPermissionGrant["type"]): ExecutionApprovalAction {
  switch (type) {
    case "codex_usage":
    case "high_reasoning_model":
      return "use_codex";
    case "runtime_restart":
    case "runtime_install":
    case "reboot":
      return "deploy_runtime";
    case "publish":
      return "publish";
    case "trading_live_money":
      return "live_money";
    case "destructive_action":
      return "destructive_action";
    case "remote_proof":
    case "push_backup":
    case "external_write":
      return "external_network";
    case "local_proof":
      return "execute_command";
  }
  throw new Error("Unsupported PCC permission type.");
}

/** Lossless-enough bridge from PCC's existing permission ledger into the canonical contract. */
export function executionApprovalFromPccPermission(params: {
  permission: PccPermissionGrant;
  subjectActorId: string;
}): ExecutionApprovalEnvelope {
  const permission = params.permission;
  const issuedAt = Date.parse(permission.grantedAt ?? permission.createdAt);
  const updatedAt = Date.parse(permission.updatedAt);
  const status: ExecutionApprovalStatus =
    permission.status === "granted" || permission.status === "used"
      ? "active"
      : permission.status === "revoked"
        ? "revoked"
        : permission.status === "denied" || permission.status === "blocked"
          ? "denied"
          : "pending";
  const envelope = createExecutionApprovalEnvelope({
    approvalId: permission.id,
    subjectActorId: params.subjectActorId,
    grantedBy: permission.grantedBy ?? "pcc-operator",
    action: actionForPccPermission(permission.type),
    resource: {
      kind: permission.milestoneId ? "milestone" : "project",
      id: permission.milestoneId ?? permission.projectId,
    },
    risk: permission.riskLevel,
    status,
    maxUses: permission.maxUses ?? 1,
    usedCount: Math.min(
      permission.usedCount,
      permission.maxUses ?? Math.max(1, permission.usedCount),
    ),
    ...(permission.tokenBudget !== undefined ? { maxTokens: permission.tokenBudget } : {}),
    ...(permission.costBudget !== undefined
      ? { maxCostMilliUsd: Math.round(permission.costBudget * 1_000) }
      : {}),
    issuedAt: Number.isFinite(issuedAt) ? issuedAt : 0,
    ...(permission.expiresAt ? { expiresAt: Date.parse(permission.expiresAt) } : {}),
    ...(status === "revoked"
      ? { revokedAt: Number.isFinite(updatedAt) ? updatedAt : issuedAt }
      : {}),
    constraints: [
      ...permission.allowedActions.map((action) => `allowed:${action}`),
      ...(permission.forbiddenActions ?? []).map((action) => `forbidden:${action}`),
      ...(permission.target ? [`target:${permission.target}`] : []),
    ],
  });
  return {
    ...envelope,
    audit: permission.auditLog.slice(-EXECUTION_APPROVAL_AUDIT_LIMIT).map((entry) => {
      const auditEntry: ExecutionApprovalAuditEntry = {
        at: Date.parse(entry.at),
        actorId: permission.grantedBy ?? "pcc-operator",
        event:
          entry.status === "revoked"
            ? "revoked"
            : entry.status === "denied" || entry.status === "blocked"
              ? "denied"
              : entry.status === "used"
                ? "consumed"
                : "evaluated",
      };
      if (entry.note) {
        auditEntry.reason = entry.note;
      }
      return auditEntry;
    }),
  };
}
