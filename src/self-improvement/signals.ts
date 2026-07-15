import crypto from "node:crypto";
import type {
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
  DiagnosticImprovementSignalEvent,
  DiagnosticImprovementSignalKind,
  DiagnosticImprovementSignalSeverity,
} from "../infra/diagnostic-events.js";
import { createAsyncLock } from "../infra/json-files.js";
import { redactSensitiveFieldValue } from "../logging/redact.js";
import { listSelfImprovementLedgerRows, upsertSelfImprovementLedgerRows } from "./ledger.js";
import { enqueueSelfImprovementOutbox } from "./outbox.js";
import { sanitizeRecommendationText, sanitizeRecommendationTexts } from "./text.js";

const MAX_SIGNAL_TEXT = 640;
const MAX_EVIDENCE_REFS = 20;
const SIGNAL_NOISE_BUDGET_WINDOW_MS = 60 * 60_000;
const SIGNAL_NOISE_BUDGET_DISTINCT_LIMIT = 20;
const withSignalMutation = createAsyncLock();

export type SelfImprovementSignalSource = {
  component: string;
  subsystem?: string;
  version?: string;
  owner?: string;
};

export type SelfImprovementDesiredState = {
  owner: string;
  expectedOutcome: string;
  sloMs?: number;
  rollback?: string;
  retentionDays?: number;
};

export type SelfImprovementCapabilityRoutingEvidence = {
  considered: string[];
  selected: string[];
  missed: string[];
  fallback: string[];
};

export type SelfImprovementSignalInput = {
  version: 1;
  idempotencyKey: string;
  source: SelfImprovementSignalSource;
  kind: DiagnosticImprovementSignalKind;
  severity: DiagnosticImprovementSignalSeverity;
  summary: string;
  occurredAt?: number;
  runId?: string;
  taskId?: string;
  traceId?: string;
  errorCode?: string;
  expected?: string;
  observed?: string;
  evidenceRefs?: readonly string[];
  privacy: "internal" | "sensitive";
  desiredState?: SelfImprovementDesiredState;
  capabilityRouting?: Partial<SelfImprovementCapabilityRoutingEvidence>;
  trusted?: boolean;
};

export type SelfImprovementSignal = {
  id: string;
  version: 1;
  idempotencyKey: string;
  source: SelfImprovementSignalSource;
  kind: DiagnosticImprovementSignalKind;
  severity: DiagnosticImprovementSignalSeverity;
  summary: string;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrences: number;
  runId?: string;
  taskId?: string;
  traceId?: string;
  errorCode?: string;
  expected?: string;
  observed?: string;
  evidenceRefs: string[];
  privacy: "internal" | "sensitive";
  desiredState?: SelfImprovementDesiredState;
  capabilityRouting?: SelfImprovementCapabilityRoutingEvidence;
  trusted: boolean;
};

export type SelfImprovementSignalRecordResult = {
  signal: SelfImprovementSignal;
  created: boolean;
  duplicate: boolean;
  budgeted: boolean;
};

function signalText(value: unknown, field: string, maxLength = MAX_SIGNAL_TEXT): string {
  if (typeof value !== "string") {
    return "";
  }
  return sanitizeRecommendationText(redactSensitiveFieldValue(field, value), maxLength);
}

function optionalSignalText(
  value: unknown,
  field: string,
  maxLength = MAX_SIGNAL_TEXT,
): string | undefined {
  return signalText(value, field, maxLength) || undefined;
}

function signalId(source: SelfImprovementSignalSource, idempotencyKey: string): string {
  const fingerprint = crypto
    .createHash("sha256")
    .update(`v1\n${source.component}\n${source.subsystem ?? ""}\n${idempotencyKey}`)
    .digest("hex");
  return `sis_${fingerprint.slice(0, 20)}`;
}

function boundedTimestamp(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function boundedPositiveInteger(value: number | undefined, maximum: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(maximum, Math.floor(value))
    : undefined;
}

function capabilityList(value: readonly string[] | undefined): string[] {
  return sanitizeRecommendationTexts(value?.slice(0, 50) ?? [], 120);
}

function normalizeDesiredState(
  value: SelfImprovementDesiredState | undefined,
): SelfImprovementDesiredState | undefined {
  if (!value) {
    return undefined;
  }
  const owner = signalText(value.owner, "desiredState.owner", 120);
  const expectedOutcome = signalText(
    value.expectedOutcome,
    "desiredState.expectedOutcome",
    MAX_SIGNAL_TEXT,
  );
  if (!owner || !expectedOutcome) {
    return undefined;
  }
  const sloMs = boundedPositiveInteger(value.sloMs, 365 * 24 * 60 * 60_000);
  const retentionDays = boundedPositiveInteger(value.retentionDays, 3_650);
  return {
    owner,
    expectedOutcome,
    ...(sloMs ? { sloMs } : {}),
    ...(optionalSignalText(value.rollback, "desiredState.rollback")
      ? { rollback: optionalSignalText(value.rollback, "desiredState.rollback") }
      : {}),
    ...(retentionDays ? { retentionDays } : {}),
  };
}

function normalizeCapabilityRouting(
  value: Partial<SelfImprovementCapabilityRoutingEvidence> | undefined,
): SelfImprovementCapabilityRoutingEvidence | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = {
    considered: capabilityList(value.considered),
    selected: capabilityList(value.selected),
    missed: capabilityList(value.missed),
    fallback: capabilityList(value.fallback),
  };
  return Object.values(normalized).some((entries) => entries.length > 0) ? normalized : undefined;
}

function effectiveSeverity(
  severity: DiagnosticImprovementSignalSeverity,
  trusted: boolean,
): DiagnosticImprovementSignalSeverity {
  if (!trusted && (severity === "critical" || severity === "high")) {
    return "medium";
  }
  return severity;
}

function normalizeSignalInput(params: {
  input: SelfImprovementSignalInput;
  now: number;
  existing?: SelfImprovementSignal;
}): SelfImprovementSignal {
  const component = signalText(params.input.source.component, "source.component", 120);
  const idempotencyKey = signalText(params.input.idempotencyKey, "idempotencyKey", 240);
  const summary = signalText(params.input.summary, "summary");
  if (!component || !idempotencyKey || !summary) {
    throw new Error("Self-improvement signals require component, idempotencyKey, and summary.");
  }
  const trusted = params.input.trusted === true;
  const occurredAt = boundedTimestamp(params.input.occurredAt, params.now);
  const source: SelfImprovementSignalSource = {
    component,
    ...(optionalSignalText(params.input.source.subsystem, "source.subsystem", 120)
      ? { subsystem: optionalSignalText(params.input.source.subsystem, "source.subsystem", 120) }
      : {}),
    ...(optionalSignalText(params.input.source.version, "source.version", 80)
      ? { version: optionalSignalText(params.input.source.version, "source.version", 80) }
      : {}),
    ...(optionalSignalText(params.input.source.owner, "source.owner", 120)
      ? { owner: optionalSignalText(params.input.source.owner, "source.owner", 120) }
      : {}),
  };
  const evidenceRefs = sanitizeRecommendationTexts(
    params.input.evidenceRefs?.slice(0, MAX_EVIDENCE_REFS) ?? [],
    240,
  );
  const previous = params.existing;
  return {
    id: signalId(source, idempotencyKey),
    version: 1,
    idempotencyKey,
    source,
    kind: params.input.kind,
    severity: effectiveSeverity(params.input.severity, trusted),
    summary,
    firstSeenAt: previous?.firstSeenAt ?? occurredAt,
    lastSeenAt: Math.max(previous?.lastSeenAt ?? 0, occurredAt),
    occurrences: Math.max(1, (previous?.occurrences ?? 0) + 1),
    ...(optionalSignalText(params.input.runId, "runId", 180)
      ? { runId: optionalSignalText(params.input.runId, "runId", 180) }
      : {}),
    ...(optionalSignalText(params.input.taskId, "taskId", 180)
      ? { taskId: optionalSignalText(params.input.taskId, "taskId", 180) }
      : {}),
    ...(optionalSignalText(params.input.traceId, "traceId", 180)
      ? { traceId: optionalSignalText(params.input.traceId, "traceId", 180) }
      : {}),
    ...(optionalSignalText(params.input.errorCode, "errorCode", 120)
      ? { errorCode: optionalSignalText(params.input.errorCode, "errorCode", 120) }
      : {}),
    ...(optionalSignalText(params.input.expected, "expected")
      ? { expected: optionalSignalText(params.input.expected, "expected") }
      : {}),
    ...(optionalSignalText(params.input.observed, "observed")
      ? { observed: optionalSignalText(params.input.observed, "observed") }
      : {}),
    evidenceRefs: [...new Set([...(previous?.evidenceRefs ?? []), ...evidenceRefs])].slice(
      -MAX_EVIDENCE_REFS,
    ),
    privacy: params.input.privacy,
    ...(normalizeDesiredState(params.input.desiredState)
      ? { desiredState: normalizeDesiredState(params.input.desiredState) }
      : {}),
    ...(normalizeCapabilityRouting(params.input.capabilityRouting)
      ? { capabilityRouting: normalizeCapabilityRouting(params.input.capabilityRouting) }
      : {}),
    trusted,
  };
}

export async function listSelfImprovementSignals(params?: {
  stateDir?: string;
  limit?: number;
}): Promise<SelfImprovementSignal[]> {
  const rows = await listSelfImprovementLedgerRows<SelfImprovementSignal>({
    stateDir: params?.stateDir,
    collection: "signals",
  });
  const limit = params?.limit && params.limit > 0 ? Math.floor(params.limit) : 2_000;
  return rows
    .map((row) => row.value)
    .toSorted(
      (left, right) => right.lastSeenAt - left.lastSeenAt || left.id.localeCompare(right.id),
    )
    .slice(0, limit);
}

export async function recordSelfImprovementSignal(params: {
  input: SelfImprovementSignalInput;
  stateDir?: string;
  now?: number;
}): Promise<SelfImprovementSignalRecordResult> {
  return await withSignalMutation(async () => {
    const now = params.now ?? Date.now();
    const existing = await listSelfImprovementSignals({ stateDir: params.stateDir });
    const tentative = normalizeSignalInput({ input: params.input, now });
    const previous = existing.find((entry) => entry.id === tentative.id);
    if (
      previous &&
      previous.lastSeenAt === tentative.lastSeenAt &&
      previous.runId === tentative.runId &&
      previous.taskId === tentative.taskId &&
      previous.traceId === tentative.traceId
    ) {
      return { signal: previous, created: false, duplicate: true, budgeted: false };
    }
    const budgetWindowStart =
      Math.floor(tentative.lastSeenAt / SIGNAL_NOISE_BUDGET_WINDOW_MS) *
      SIGNAL_NOISE_BUDGET_WINDOW_MS;
    const bypassNoiseBudget =
      tentative.trusted && (tentative.severity === "critical" || tentative.severity === "high");
    const distinctInWindow = existing.filter(
      (entry) =>
        entry.source.component === tentative.source.component &&
        entry.firstSeenAt >= budgetWindowStart &&
        !entry.idempotencyKey.startsWith("noise-budget:"),
    ).length;
    const budgeted =
      !previous && !bypassNoiseBudget && distinctInWindow >= SIGNAL_NOISE_BUDGET_DISTINCT_LIMIT;
    const input = budgeted
      ? {
          ...params.input,
          idempotencyKey: `noise-budget:${budgetWindowStart}`,
          kind: "inefficiency" as const,
          severity: "low" as const,
          summary: `Distinct signal budget exceeded for ${tentative.source.component}; additional events were coalesced.`,
          observed: `Coalesced ${tentative.kind}:${tentative.errorCode ?? tentative.idempotencyKey}.`,
          desiredState: undefined,
          capabilityRouting: undefined,
        }
      : params.input;
    const budgetTentative = normalizeSignalInput({ input, now });
    const budgetPrevious = budgeted
      ? existing.find((entry) => entry.id === budgetTentative.id)
      : previous;
    const signal = normalizeSignalInput({
      input,
      now,
      ...(budgetPrevious ? { existing: budgetPrevious } : {}),
    });
    await upsertSelfImprovementLedgerRows({
      stateDir: params.stateDir,
      collection: "signals",
      rows: [signal],
      id: (entry) => entry.id,
      createdAt: (entry) => entry.firstSeenAt,
      updatedAt: (entry) => entry.lastSeenAt,
    });
    await enqueueSelfImprovementOutbox({
      stateDir: params.stateDir,
      kind: "signal_analysis",
      entityId: signal.id,
      now,
    });
    return { signal, created: !budgetPrevious, duplicate: false, budgeted };
  });
}

function directSignalInput(
  event: DiagnosticImprovementSignalEvent,
  metadata: DiagnosticEventMetadata,
): SelfImprovementSignalInput {
  return {
    version: 1,
    idempotencyKey: event.idempotencyKey,
    source: event.source,
    kind: event.kind,
    severity: event.severity,
    summary: event.summary,
    occurredAt: event.occurredAt ?? event.ts,
    ...(event.runId ? { runId: event.runId } : {}),
    ...(event.taskId ? { taskId: event.taskId } : {}),
    ...(event.trace?.traceId ? { traceId: event.trace.traceId } : {}),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    ...(event.expected ? { expected: event.expected } : {}),
    ...(event.observed ? { observed: event.observed } : {}),
    ...(event.evidenceRefs ? { evidenceRefs: event.evidenceRefs } : {}),
    privacy: event.privacy,
    ...(event.desiredState ? { desiredState: event.desiredState } : {}),
    ...(event.capabilityRouting ? { capabilityRouting: event.capabilityRouting } : {}),
    trusted: metadata.trusted,
  };
}

/** Adapt only actionable failure diagnostics; healthy lifecycle events intentionally return null. */
export function adaptDiagnosticEventToSelfImprovementSignal(
  event: DiagnosticEventPayload,
  metadata: DiagnosticEventMetadata,
): SelfImprovementSignalInput | null {
  if (event.type === "improvement.signal") {
    return directSignalInput(event, metadata);
  }
  if (!metadata.trusted) {
    return null;
  }
  const traceId = event.trace?.traceId;
  switch (event.type) {
    case "model.failover":
      return {
        version: 1,
        idempotencyKey: [
          "model.failover",
          event.lane,
          event.fromProvider,
          event.fromModel,
          event.toProvider,
          event.toModel,
          event.reason,
        ]
          .filter(Boolean)
          .join(":"),
        source: { component: "model-routing", subsystem: event.lane },
        kind: "degraded",
        severity: event.suspended ? "high" : "medium",
        summary: `Model failover: ${event.reason}`,
        occurredAt: event.ts,
        ...(event.sessionId ? { runId: event.sessionId } : {}),
        ...(traceId ? { traceId } : {}),
        observed: `${event.fromProvider ?? "unknown"}/${event.fromModel ?? "unknown"} -> ${event.toProvider ?? "unknown"}/${event.toModel ?? "unknown"}`,
        privacy: "internal",
        trusted: true,
      };
    case "tool.execution.error":
      return {
        version: 1,
        idempotencyKey: `tool:${event.toolName}:${event.errorCategory}:${event.errorCode ?? event.terminalReason ?? "error"}`,
        source: {
          component: event.toolOwner ?? event.toolName,
          subsystem: event.toolSource ?? "tool",
        },
        kind: "failure",
        severity: event.terminalReason === "timed_out" ? "high" : "medium",
        summary: `Tool execution failed: ${event.toolName} (${event.errorCategory}).`,
        occurredAt: event.sourceTimestampMs ?? event.ts,
        ...(event.runId ? { runId: event.runId } : {}),
        ...(traceId ? { traceId } : {}),
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        privacy: "internal",
        trusted: true,
      };
    case "model.call.error":
      return {
        version: 1,
        idempotencyKey: `model:${event.provider}:${event.model}:${event.errorCategory}:${event.failureKind ?? "error"}`,
        source: { component: "model-runtime", subsystem: event.provider },
        kind: "failure",
        severity: event.failureKind === "timeout" ? "high" : "medium",
        summary: `Model call failed for ${event.provider}/${event.model} (${event.errorCategory}).`,
        occurredAt: event.ts,
        runId: event.runId,
        ...(traceId ? { traceId } : {}),
        errorCode: event.failureKind ?? event.errorCategory,
        privacy: "internal",
        trusted: true,
      };
    case "session.stalled":
    case "session.stuck":
      return {
        version: 1,
        idempotencyKey: `session:${event.type}:${event.classification}:${event.activeWorkKind ?? "unknown"}`,
        source: { component: "session-runtime", subsystem: event.activeWorkKind },
        kind: "blocked",
        severity: "high",
        summary: `Session requires attention: ${event.classification}.`,
        occurredAt: event.ts,
        ...(event.sessionId ? { runId: event.sessionId } : {}),
        ...(traceId ? { traceId } : {}),
        observed: `Age ${event.ageMs}ms; last progress ${event.lastProgressAgeMs ?? "unknown"}ms ago.`,
        privacy: "internal",
        trusted: true,
      };
    case "diagnostic.memory.pressure":
      return {
        version: 1,
        idempotencyKey: `memory:${event.level}:${event.reason}`,
        source: { component: "gateway-runtime", subsystem: "memory" },
        kind: "degraded",
        severity: event.level === "critical" ? "critical" : "high",
        summary: `Runtime memory pressure: ${event.reason}.`,
        occurredAt: event.ts,
        ...(traceId ? { traceId } : {}),
        observed: `RSS ${event.memory.rssBytes}; heap ${event.memory.heapUsedBytes}.`,
        privacy: "internal",
        trusted: true,
      };
    case "payload.large":
      if (event.action !== "rejected") {
        return null;
      }
      return {
        version: 1,
        idempotencyKey: `payload:${event.surface}:${event.pluginId ?? "core"}:${event.action}`,
        source: { component: event.pluginId ?? "gateway-runtime", subsystem: event.surface },
        kind: "failure",
        severity: "medium",
        summary: `Oversized payload was rejected on ${event.surface}.`,
        occurredAt: event.ts,
        ...(traceId ? { traceId } : {}),
        observed: `Bytes ${event.bytes ?? "unknown"}; limit ${event.limitBytes ?? "unknown"}.`,
        privacy: "internal",
        trusted: true,
      };
    case "telemetry.exporter":
      if (event.status === "started") {
        return null;
      }
      return {
        version: 1,
        idempotencyKey: `telemetry:${event.exporter}:${event.signal}:${event.status}:${event.reason ?? "unknown"}`,
        source: { component: event.exporter, subsystem: `telemetry-${event.signal}` },
        kind: "verification_gap",
        severity: "medium",
        summary: `Telemetry exporter ${event.status}: ${event.reason ?? "unknown"}.`,
        occurredAt: event.ts,
        ...(traceId ? { traceId } : {}),
        ...(event.errorCategory ? { errorCode: event.errorCategory } : {}),
        privacy: "internal",
        trusted: true,
      };
    case "diagnostic.async_queue.dropped":
      return {
        version: 1,
        idempotencyKey: "diagnostics:async-queue-dropped",
        source: { component: "diagnostic-runtime", subsystem: "async-queue" },
        kind: "verification_gap",
        severity: event.droppedPriorityEvents ? "high" : "medium",
        summary: "Diagnostic events were dropped before processing.",
        occurredAt: event.ts,
        ...(traceId ? { traceId } : {}),
        observed: `${event.droppedEvents} events dropped at queue length ${event.queueLength}.`,
        privacy: "internal",
        trusted: true,
      };
    default:
      return null;
  }
}
