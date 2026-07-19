// Typed Control Director user-journey evidence for SIG; no production mutation occurs here.
import {
  emitTrustedDiagnosticEvent,
  type DiagnosticEventInput,
} from "../infra/diagnostic-events.js";

export const CONTROL_DIRECTOR_JOURNEY_SIGNAL_VERSION = 1 as const;

export type ControlDirectorJourneySignalCode =
  | "silence_after_ack"
  | "activity_gap"
  | "stalled_goal"
  | "memory_miss"
  | "layout_obstruction"
  | "title_failure"
  | "queue_race"
  | "delivery_miss"
  | "completion_without_proof"
  | "runtime_lineage_mismatch";

const CONTROL_DIRECTOR_JOURNEY_SIGNAL_CODES = new Set<ControlDirectorJourneySignalCode>([
  "silence_after_ack",
  "activity_gap",
  "stalled_goal",
  "memory_miss",
  "layout_obstruction",
  "title_failure",
  "queue_race",
  "delivery_miss",
  "completion_without_proof",
  "runtime_lineage_mismatch",
]);

export function isControlDirectorJourneySignalCode(
  value: unknown,
): value is ControlDirectorJourneySignalCode {
  return (
    typeof value === "string" &&
    CONTROL_DIRECTOR_JOURNEY_SIGNAL_CODES.has(value as ControlDirectorJourneySignalCode)
  );
}

export type ControlDirectorJourneySignalInput = {
  code: ControlDirectorJourneySignalCode;
  idempotencyKey: string;
  summary: string;
  observed: string;
  expected?: string;
  runId?: string;
  taskId?: string;
  evidenceRefs?: readonly string[];
  occurredAt?: number;
  owner?: string;
  sloMs?: number;
  privacy?: "internal" | "sensitive";
};

const DEFAULTS: Record<
  ControlDirectorJourneySignalCode,
  {
    severity: "low" | "medium" | "high" | "critical";
    kind: "failure" | "blocked" | "degraded" | "regression" | "verification_gap";
    owner: string;
    expected: string;
    sloMs: number;
  }
> = {
  silence_after_ack: {
    severity: "critical",
    kind: "failure",
    owner: "chat-orchestrator",
    expected: "Every acknowledged turn produces visible activity or a usable final response.",
    sloMs: 2_000,
  },
  activity_gap: {
    severity: "high",
    kind: "degraded",
    owner: "chat-orchestrator",
    expected: "Active work emits a condensed visible heartbeat at least every 15 seconds.",
    sloMs: 15_000,
  },
  stalled_goal: {
    severity: "critical",
    kind: "blocked",
    owner: "task-orchestrator",
    expected: "A running goal owns a current lease, heartbeat, and next action.",
    sloMs: 45_000,
  },
  memory_miss: {
    severity: "medium",
    kind: "degraded",
    owner: "memory-knowledge",
    expected:
      "Explicit recent-work references return useful Top-3 recall or an honest no-hit result.",
    sloMs: 3_500,
  },
  layout_obstruction: {
    severity: "critical",
    kind: "regression",
    owner: "control-ui",
    expected: "Transcript and composer remain visible and unobstructed at supported viewports.",
    sloMs: 0,
  },
  title_failure: {
    severity: "low",
    kind: "degraded",
    owner: "session-metadata",
    expected: "A meaningful deterministic title is available without delaying the first reply.",
    sloMs: 500,
  },
  queue_race: {
    severity: "high",
    kind: "failure",
    owner: "chat-orchestrator",
    expected: "Revisioned queue and steer mutations resolve without duplicate or lost input.",
    sloMs: 1_000,
  },
  delivery_miss: {
    severity: "critical",
    kind: "failure",
    owner: "delivery-runtime",
    expected: "Terminal outcomes are queued idempotently and surfaced to the requester.",
    sloMs: 15_000,
  },
  completion_without_proof: {
    severity: "critical",
    kind: "verification_gap",
    owner: "independent-judge",
    expected: "Completion requires exact evidence plus a valid signed claim-bound Judge receipt.",
    sloMs: 0,
  },
  runtime_lineage_mismatch: {
    severity: "critical",
    kind: "verification_gap",
    owner: "runtime-operations",
    expected:
      "Source, build, managed process, config, and Dashboard report one immutable SHA lineage.",
    sloMs: 0,
  },
};

export function buildControlDirectorJourneyDiagnostic(
  input: ControlDirectorJourneySignalInput,
): DiagnosticEventInput {
  const defaults = DEFAULTS[input.code];
  return {
    type: "improvement.signal",
    version: CONTROL_DIRECTOR_JOURNEY_SIGNAL_VERSION,
    idempotencyKey: `control-director:${input.code}:${input.idempotencyKey}`,
    source: {
      component: "control-director",
      subsystem: `journey:${input.code}`,
      version: String(CONTROL_DIRECTOR_JOURNEY_SIGNAL_VERSION),
      owner: input.owner ?? defaults.owner,
    },
    kind: defaults.kind,
    severity: defaults.severity,
    summary: input.summary,
    ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    errorCode: input.code,
    expected: input.expected ?? defaults.expected,
    observed: input.observed,
    ...(input.evidenceRefs?.length ? { evidenceRefs: [...input.evidenceRefs].slice(0, 20) } : {}),
    privacy: input.privacy ?? "internal",
    desiredState: {
      owner: input.owner ?? defaults.owner,
      expectedOutcome: input.expected ?? defaults.expected,
      sloMs: input.sloMs ?? defaults.sloMs,
      rollback: "Revert the smallest responsible Control Director change if the signal recurs.",
      retentionDays: 90,
    },
  };
}

export function emitControlDirectorJourneySignal(input: ControlDirectorJourneySignalInput): void {
  emitTrustedDiagnosticEvent(buildControlDirectorJourneyDiagnostic(input));
}
