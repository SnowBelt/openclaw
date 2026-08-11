// Gateway Protocol schema module defines protocol validation shapes.
import { Type } from "typebox";
import { NonEmptyString } from "./primitives.js";

/**
 * Task ledger protocol schemas.
 *
 * Tasks represent long-running SDK/agent operations exposed through the gateway;
 * these schemas keep list/get/cancel payloads bounded and status values closed.
 */
/** Closed task lifecycle statuses visible in the gateway task ledger. */
export const TaskLedgerStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("timed_out"),
]);

const TimestampSchema = Type.Union([Type.String(), Type.Integer({ minimum: 0 })]);

export const TaskFlowStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("paused"),
  Type.Literal("waiting"),
  Type.Literal("blocked"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("lost"),
]);

export const TaskNotifyPolicySchema = Type.Union([
  Type.Literal("done_only"),
  Type.Literal("state_changes"),
  Type.Literal("silent"),
]);

/** Operator-selected admission behavior for a pending Control UI turn. */
export const ChatTurnModeSchema = Type.Union([Type.Literal("queue"), Type.Literal("steer")]);

/** Durable server-owned lifecycle for a Control UI turn before and after admission. */
export const ChatTurnPhaseSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("dispatching"),
  Type.Literal("admitted"),
  Type.Literal("delivered"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);

export const ChatTurnSummarySchema = Type.Object(
  {
    id: NonEmptyString,
    sessionKey: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    revision: Type.Integer({ minimum: 0 }),
    mode: ChatTurnModeSchema,
    phase: ChatTurnPhaseSchema,
    message: Type.String(),
    attachmentCount: Type.Integer({ minimum: 0 }),
    admissionOpen: Type.Boolean(),
    runId: Type.Optional(NonEmptyString),
    missionId: Type.Optional(NonEmptyString),
    responseMode: Type.Optional(
      Type.Union([
        Type.Literal("conversation"),
        Type.Literal("answer"),
        Type.Literal("plan"),
        Type.Literal("execute"),
        Type.Literal("status"),
        Type.Literal("steer"),
        Type.Literal("queue"),
        Type.Literal("goal"),
      ]),
    ),
    requestHash: Type.Optional(NonEmptyString),
    activitySummary: Type.Optional(Type.String({ maxLength: 500 })),
    lastActivityAt: Type.Integer({ minimum: 0 }),
    lastError: Type.Optional(Type.String()),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
    endedAt: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const ExecutionEventSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    eventId: NonEmptyString,
    sequence: Type.Integer({ minimum: 0 }),
    at: Type.Integer({ minimum: 0 }),
    flowId: NonEmptyString,
    category: Type.Union([
      Type.Literal("run"),
      Type.Literal("task"),
      Type.Literal("goal"),
      Type.Literal("activity"),
      Type.Literal("evidence"),
      Type.Literal("approval"),
      Type.Literal("judge"),
      Type.Literal("notification"),
    ]),
    name: NonEmptyString,
    actorId: NonEmptyString,
    summary: NonEmptyString,
    correlation: Type.Optional(
      Type.Object(
        {
          missionId: Type.Optional(NonEmptyString),
          runId: Type.Optional(NonEmptyString),
          taskId: Type.Optional(NonEmptyString),
          sessionKey: Type.Optional(NonEmptyString),
          idempotencyKey: Type.Optional(NonEmptyString),
        },
        { additionalProperties: false },
      ),
    ),
    payload: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const PursueGoalLeaseSchema = Type.Object(
  {
    ownerId: NonEmptyString,
    leaseId: NonEmptyString,
    acquiredAt: Type.Integer({ minimum: 0 }),
    heartbeatAt: Type.Integer({ minimum: 0 }),
    expiresAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const PursueGoalJudgeReceiptSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    receiptId: NonEmptyString,
    missionId: NonEmptyString,
    claimHash: NonEmptyString,
    verdict: Type.Union([
      Type.Literal("APPROVE"),
      Type.Literal("REJECT"),
      Type.Literal("REQUEST_MORE_EVIDENCE"),
      Type.Literal("ESCALATE_TO_HUMAN"),
    ]),
    scope: NonEmptyString,
    evidenceSummary: NonEmptyString,
    conditions: NonEmptyString,
    judgeRunId: NonEmptyString,
    judgeAgentId: NonEmptyString,
    model: Type.Optional(NonEmptyString),
    issuedAt: Type.Integer({ minimum: 0 }),
    signature: Type.Optional(NonEmptyString),
    publicKeyId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

/** Public task summary returned by task list/get/cancel responses. */
export const TaskSummarySchema = Type.Object(
  {
    id: NonEmptyString,
    kind: Type.Optional(Type.String()),
    runtime: Type.Optional(Type.String()),
    status: TaskLedgerStatusSchema,
    title: Type.Optional(Type.String()),
    agentId: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    childSessionKey: Type.Optional(Type.String()),
    ownerKey: Type.Optional(Type.String()),
    runId: Type.Optional(Type.String()),
    taskId: Type.Optional(Type.String()),
    flowId: Type.Optional(Type.String()),
    parentTaskId: Type.Optional(Type.String()),
    sourceId: Type.Optional(Type.String()),
    createdAt: Type.Optional(TimestampSchema),
    updatedAt: Type.Optional(TimestampSchema),
    startedAt: Type.Optional(TimestampSchema),
    endedAt: Type.Optional(TimestampSchema),
    progressSummary: Type.Optional(Type.String()),
    terminalSummary: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const TaskFlowSummarySchema = Type.Object(
  {
    id: NonEmptyString,
    flowId: NonEmptyString,
    ownerKey: NonEmptyString,
    revision: Type.Integer({ minimum: 0 }),
    controllerId: Type.Optional(NonEmptyString),
    requesterOrigin: Type.Optional(Type.Unknown()),
    status: TaskFlowStatusSchema,
    notifyPolicy: TaskNotifyPolicySchema,
    goal: Type.String(),
    currentStep: Type.Optional(Type.String()),
    blockedTaskId: Type.Optional(Type.String()),
    blockedSummary: Type.Optional(Type.String()),
    phase: Type.Optional(NonEmptyString),
    missionId: Type.Optional(NonEmptyString),
    goalVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    workerAgentId: Type.Optional(NonEmptyString),
    workerSessionKey: Type.Optional(NonEmptyString),
    turnCount: Type.Optional(Type.Integer({ minimum: 0 })),
    activationCount: Type.Optional(Type.Integer({ minimum: 0 })),
    consecutiveFailures: Type.Optional(Type.Integer({ minimum: 0 })),
    nextAction: Type.Optional(Type.String()),
    lastResult: Type.Optional(Type.String()),
    lastError: Type.Optional(Type.String()),
    retryAt: Type.Optional(TimestampSchema),
    lease: Type.Optional(PursueGoalLeaseSchema),
    judgeReceipt: Type.Optional(PursueGoalJudgeReceiptSchema),
    events: Type.Optional(Type.Array(ExecutionEventSchema, { maxItems: 50 })),
    cancelRequestedAt: Type.Optional(TimestampSchema),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    endedAt: Type.Optional(TimestampSchema),
  },
  { additionalProperties: false },
);

// Keep the detail schema as one closed object. An allOf/intersection of two
// independently closed objects rejects each side's properties and cannot be
// emitted as a concrete struct by the bundled Swift protocol generator.
export const TaskFlowDetailSchema = Type.Object(
  {
    ...TaskFlowSummarySchema.properties,
    tasks: Type.Array(TaskSummarySchema),
    taskSummary: Type.Object(
      {
        total: Type.Integer({ minimum: 0 }),
        active: Type.Integer({ minimum: 0 }),
        terminal: Type.Integer({ minimum: 0 }),
        failures: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ExecutionStateHealthSchema = Type.Object(
  {
    activeCount: Type.Integer({ minimum: 0 }),
    staleGoalCount: Type.Integer({ minimum: 0 }),
    orphanedTurnCount: Type.Integer({ minimum: 0 }),
    pendingDeliveryCount: Type.Integer({ minimum: 0 }),
    lostWorkerCount: Type.Integer({ minimum: 0 }),
    healthy: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const ControlDirectorMemoryHealthSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    status: Type.Union([
      Type.Literal("healthy"),
      Type.Literal("empty"),
      Type.Literal("stale"),
      Type.Literal("corrupt"),
      Type.Literal("conflicted"),
    ]),
    newestSourceAt: Type.Optional(Type.Integer({ minimum: 0 })),
    newestRecordAt: Type.Optional(Type.Integer({ minimum: 0 })),
    newestAgeMs: Type.Optional(Type.Integer({ minimum: 0 })),
    currentDaySourceCount: Type.Integer({ minimum: 0 }),
    corruptRecordCount: Type.Integer({ minimum: 0 }),
    sourceConflictCount: Type.Integer({ minimum: 0 }),
    repairActions: Type.Array(
      Type.Union([
        Type.Literal("refresh_recent_sources"),
        Type.Literal("rebuild_index"),
        Type.Literal("resolve_source_conflicts"),
      ]),
      { maxItems: 3 },
    ),
  },
  { additionalProperties: false },
);

export const ControlDirectorRuntimeCanarySchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    capturedAt: Type.Integer({ minimum: 0 }),
    sourceSha: Type.String({ pattern: "^[a-f0-9]{40}$" }),
    runtimeVersion: NonEmptyString,
    configHash: NonEmptyString,
    agentId: NonEmptyString,
    role: Type.Literal("control_director"),
    selectedModel: NonEmptyString,
    modelRegistryHash: NonEmptyString,
    promptHash: NonEmptyString,
    toolsHash: NonEmptyString,
    skillsHash: NonEmptyString,
    memoryBuildId: NonEmptyString,
    uiBuildId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ControlDirectorRuntimeLineageSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    status: Type.Union([Type.Literal("ready"), Type.Literal("blocked")]),
    checkedAt: Type.Integer({ minimum: 0 }),
    agentId: NonEmptyString,
    role: Type.Literal("control_director"),
    selectedModel: Type.Optional(NonEmptyString),
    sourceSha: Type.Optional(Type.String({ pattern: "^[a-f0-9]{40}$" })),
    runtimeVersion: NonEmptyString,
    releaseId: Type.Optional(NonEmptyString),
    artifactHash: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
    canary: Type.Optional(ControlDirectorRuntimeCanarySchema),
    blockers: Type.Array(Type.String(), { maxItems: 20 }),
  },
  { additionalProperties: false },
);

export const ExecutionStateSnapshotSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    snapshotRevision: NonEmptyString,
    generatedAt: Type.Integer({ minimum: 0 }),
    sessionKey: NonEmptyString,
    tasks: Type.Array(TaskSummarySchema, { maxItems: 500 }),
    flows: Type.Array(TaskFlowDetailSchema, { maxItems: 500 }),
    turns: Type.Array(ChatTurnSummarySchema, { maxItems: 200 }),
    health: ExecutionStateHealthSchema,
    memoryHealth: Type.Optional(ControlDirectorMemoryHealthSchema),
    runtimeLineage: Type.Optional(ControlDirectorRuntimeLineageSchema),
  },
  { additionalProperties: false },
);

/** Task list filters with bounded pagination. */
export const TasksListParamsSchema = Type.Object(
  {
    status: Type.Optional(Type.Union([TaskLedgerStatusSchema, Type.Array(TaskLedgerStatusSchema)])),
    agentId: Type.Optional(NonEmptyString),
    sessionKey: Type.Optional(NonEmptyString),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    cursor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Task list page response. */
export const TasksListResultSchema = Type.Object(
  {
    tasks: Type.Array(TaskSummarySchema),
    nextCursor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Lookup request for one task id. */
export const TasksGetParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

/** Lookup result for one task summary. */
export const TasksGetResultSchema = Type.Object(
  {
    task: TaskSummarySchema,
  },
  { additionalProperties: false },
);

/** Cancel request for one task id with optional operator reason. */
export const TasksCancelParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Cancel result, including the task snapshot when it was found. */
export const TasksCancelResultSchema = Type.Object(
  {
    found: Type.Boolean(),
    cancelled: Type.Boolean(),
    reason: Type.Optional(Type.String()),
    task: Type.Optional(TaskSummarySchema),
  },
  { additionalProperties: false },
);
