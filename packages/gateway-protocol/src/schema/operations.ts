// Operations Room protocol schemas expose bounded operational truth and guarded
// control previews without transporting secrets or process arguments.
import { Type } from "typebox";
import { NonEmptyString } from "./primitives.js";

export const OperationsStatusSchema = Type.Union([
  Type.Literal("healthy"),
  Type.Literal("working"),
  Type.Literal("idle"),
  Type.Literal("degraded"),
  Type.Literal("blocked"),
  Type.Literal("failed"),
  Type.Literal("disabled"),
  Type.Literal("unknown"),
]);

const OperationsDutySchema = Type.Union([
  Type.Literal("always_on"),
  Type.Literal("scheduled"),
  Type.Literal("on_demand"),
  Type.Literal("disabled"),
]);

const OperationsActivityStateSchema = Type.Union([
  Type.Literal("working"),
  Type.Literal("waiting"),
  Type.Literal("scheduled"),
  Type.Literal("ready"),
  Type.Literal("off"),
  Type.Literal("unknown"),
]);

const OperationsHealthStateSchema = Type.Union([
  Type.Literal("healthy"),
  Type.Literal("degraded"),
  Type.Literal("failed"),
  Type.Literal("unknown"),
]);

const OperationsAttentionStateSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("needs_user"),
  Type.Literal("handling"),
  Type.Literal("watching"),
  Type.Literal("urgent"),
]);

const OperationsFindingDispositionSchema = Type.Union([
  Type.Literal("needs_user"),
  Type.Literal("handling"),
  Type.Literal("watching"),
  Type.Literal("historical"),
]);

const OperationsFindingResponseStateSchema = Type.Union([
  Type.Literal("unassigned"),
  Type.Literal("in_progress"),
  Type.Literal("monitoring"),
  Type.Literal("waiting_for_user"),
  Type.Literal("resolved"),
]);

const OperationsSourceNameSchema = Type.Union([
  Type.Literal("agents"),
  Type.Literal("tasks"),
  Type.Literal("workflows"),
  Type.Literal("schedules"),
  Type.Literal("capabilities"),
  Type.Literal("models"),
  Type.Literal("processes"),
  Type.Literal("event_loop"),
  Type.Literal("monitor"),
  Type.Literal("incident_ledger"),
]);

const OperationsSourceObservationSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("available"),
      Type.Literal("fallback"),
      Type.Literal("omitted"),
      Type.Literal("unavailable"),
      Type.Literal("stale"),
    ]),
    observedAt: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const OperationsCollectionCountSchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    shown: Type.Integer({ minimum: 0 }),
    truncated: Type.Boolean(),
    rejected: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const OperationsFindingCategoryV1Schema = Type.Union([
  Type.Literal("agent"),
  Type.Literal("workflow"),
  Type.Literal("cron"),
  Type.Literal("skill"),
  Type.Literal("plugin"),
  Type.Literal("tool"),
  Type.Literal("model"),
  Type.Literal("process"),
  Type.Literal("resource"),
  Type.Literal("update"),
]);

const OperationsFindingCategoryV2Schema = Type.Union([
  OperationsFindingCategoryV1Schema,
  Type.Literal("monitor"),
]);

export const OperationsActionKindSchema = Type.Union([
  Type.Literal("cron.run"),
  Type.Literal("cron.enable"),
  Type.Literal("cron.disable"),
  Type.Literal("remediation.investigate"),
  Type.Literal("remediation.apply"),
  Type.Literal("task.cancel"),
  Type.Literal("flow.cancel"),
]);

const OperationsFindingV1Schema = Type.Object(
  {
    id: NonEmptyString,
    severity: Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("critical")]),
    category: OperationsFindingCategoryV1Schema,
    title: NonEmptyString,
    detail: Type.String({ maxLength: 20_000 }),
    entityId: Type.Optional(Type.String()),
    recommendedAction: Type.Optional(Type.String({ maxLength: 4_000 })),
    firstObservedAt: Type.Optional(Type.Number({ minimum: 0 })),
    lastObservedAt: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const OperationsRemediationRecordSchema = Type.Object(
  {
    id: NonEmptyString,
    findingId: NonEmptyString,
    findingTitle: Type.String({ minLength: 1, maxLength: 1_000 }),
    findingCategory: OperationsFindingCategoryV2Schema,
    findingEntityId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    impact: Type.String({ minLength: 1, maxLength: 1_000 }),
    recipeId: NonEmptyString,
    risk: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
    status: Type.Union([
      Type.Literal("eligible"),
      Type.Literal("investigating"),
      Type.Literal("reviewing"),
      Type.Literal("confirmation_required"),
      Type.Literal("applying"),
      Type.Literal("verifying"),
      Type.Literal("completed"),
      Type.Literal("rolled_back"),
      Type.Literal("failed"),
      Type.Literal("approval_required"),
    ]),
    ownerId: Type.String({ minLength: 1, maxLength: 256 }),
    recommendedFix: Type.Optional(Type.String({ minLength: 1, maxLength: 4_000 })),
    recommendationReason: Type.Optional(Type.String({ minLength: 1, maxLength: 4_000 })),
    confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    exactRepair: Type.String({ minLength: 1, maxLength: 4_000 }),
    expectedChange: Type.Optional(Type.String({ minLength: 1, maxLength: 4_000 })),
    verificationPlan: Type.Optional(Type.String({ minLength: 1, maxLength: 4_000 })),
    progress: Type.String({ minLength: 1, maxLength: 4_000 }),
    result: Type.Optional(Type.String({ minLength: 1, maxLength: 4_000 })),
    evidence: Type.Array(Type.String({ minLength: 1, maxLength: 4_000 }), { maxItems: 20 }),
    rollback: Type.String({ minLength: 1, maxLength: 4_000 }),
    progressLocation: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
    undoAvailable: Type.Boolean(),
    undoAction: Type.Optional(
      Type.Union([Type.Literal("cron.enable"), Type.Literal("cron.disable")]),
    ),
    undoTargetId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    automatic: Type.Boolean(),
    startedAt: Type.Number({ minimum: 0 }),
    updatedAt: Type.Number({ minimum: 0 }),
    completedAt: Type.Optional(Type.Number({ minimum: 0 })),
    rolledBackAt: Type.Optional(Type.Number({ minimum: 0 })),
    judge: Type.Optional(
      Type.Object(
        {
          model: Type.Literal("openclaw-judge-qwen35-27b-q8:latest"),
          approved: Type.Boolean(),
          reason: Type.String({ minLength: 1, maxLength: 2_000 }),
        },
        { additionalProperties: false },
      ),
    ),
    investigation: Type.Optional(
      Type.Object(
        {
          model: Type.Literal("qwen3.6:27b-q8_0"),
          confidence: Type.Number({ minimum: 0, maximum: 1 }),
          recommendation: Type.String({ minLength: 1, maxLength: 2_000 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const OperationsFindingV2Schema = Type.Object(
  {
    id: NonEmptyString,
    severity: Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("critical")]),
    category: OperationsFindingCategoryV2Schema,
    title: NonEmptyString,
    detail: Type.String({ maxLength: 20_000 }),
    entityId: Type.Optional(Type.String()),
    recommendedAction: Type.Optional(Type.String({ maxLength: 4_000 })),
    firstObservedAt: Type.Optional(Type.Number({ minimum: 0 })),
    lastObservedAt: Type.Number({ minimum: 0 }),
    resolvedAt: Type.Optional(Type.Number({ minimum: 0 })),
    evidenceState: Type.Optional(Type.Literal("last_known")),
    disposition: OperationsFindingDispositionSchema,
    responseState: OperationsFindingResponseStateSchema,
    impact: Type.String({ maxLength: 1_000 }),
    ownerId: Type.Optional(Type.String({ maxLength: 256 })),
    nextAction: Type.Optional(Type.String({ maxLength: 4_000 })),
    remediationTaskId: Type.Optional(Type.String({ maxLength: 256 })),
    lastProgressAt: Type.Optional(Type.Number({ minimum: 0 })),
    nextCheckAt: Type.Optional(Type.Number({ minimum: 0 })),
    remediation: Type.Optional(OperationsRemediationRecordSchema),
  },
  { additionalProperties: false },
);

const OperationsCatalogEntryV1Schema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    kind: Type.Union([
      Type.Literal("skill"),
      Type.Literal("plugin"),
      Type.Literal("tool"),
      Type.Literal("model"),
    ]),
    status: OperationsStatusSchema,
    configured: Type.Boolean(),
    active: Type.Union([Type.Boolean(), Type.Null()]),
    source: Type.Optional(Type.String()),
    owner: Type.Optional(Type.String()),
    reason: Type.Optional(Type.String({ maxLength: 10_000 })),
    route: Type.Optional(
      Type.Union([
        Type.Literal("local"),
        Type.Literal("subscription"),
        Type.Literal("metered"),
        Type.Literal("unknown"),
      ]),
    ),
  },
  { additionalProperties: false },
);

const OperationsCatalogEntryV2Schema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    kind: Type.Union([
      Type.Literal("skill"),
      Type.Literal("plugin"),
      Type.Literal("tool"),
      Type.Literal("model"),
    ]),
    status: OperationsStatusSchema,
    configured: Type.Boolean(),
    active: Type.Union([Type.Boolean(), Type.Null()]),
    source: Type.Optional(Type.String()),
    owner: Type.Optional(Type.String()),
    reason: Type.Optional(Type.String({ maxLength: 10_000 })),
    route: Type.Optional(
      Type.Union([
        Type.Literal("local"),
        Type.Literal("subscription"),
        Type.Literal("metered"),
        Type.Literal("unknown"),
      ]),
    ),
    availability: Type.Union([
      Type.Literal("available"),
      Type.Literal("unavailable"),
      Type.Literal("disabled"),
      Type.Literal("unverified"),
    ]),
  },
  { additionalProperties: false },
);

export const OperationsSnapshotV1ParamsSchema = Type.Object(
  { includeProcesses: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

export const OperationsSnapshotV2ParamsSchema = Type.Object(
  { includeProcesses: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

/** Legacy aliases remain bound to the original `operations.snapshot` contract. */
export const OperationsSnapshotParamsSchema = OperationsSnapshotV1ParamsSchema;

export const OperationsSnapshotV1ResultSchema = Type.Object(
  {
    schema: Type.Literal("openclaw.operations-room.v1"),
    generatedAt: Type.Number({ minimum: 0 }),
    qualityTarget: Type.Literal(93),
    qualityScore: Type.Number({ minimum: 0, maximum: 100 }),
    overallStatus: OperationsStatusSchema,
    summary: Type.Object(
      {
        agents: Type.Integer({ minimum: 0 }),
        workingAgents: Type.Integer({ minimum: 0 }),
        attentionAgents: Type.Integer({ minimum: 0 }),
        tasks: Type.Integer({ minimum: 0 }),
        activeTasks: Type.Integer({ minimum: 0 }),
        failedTasks: Type.Integer({ minimum: 0 }),
        workflows: Type.Integer({ minimum: 0 }),
        activeWorkflows: Type.Integer({ minimum: 0 }),
        cronJobs: Type.Integer({ minimum: 0 }),
        failingCronJobs: Type.Integer({ minimum: 0 }),
        plugins: Type.Integer({ minimum: 0 }),
        skills: Type.Integer({ minimum: 0 }),
        tools: Type.Integer({ minimum: 0 }),
        models: Type.Integer({ minimum: 0 }),
        findings: Type.Integer({ minimum: 0 }),
        criticalFindings: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    host: Type.Object(
      {
        hostname: NonEmptyString,
        platform: NonEmptyString,
        arch: NonEmptyString,
        uptimeMs: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
        logicalCpuCount: Type.Integer({ minimum: 0 }),
        loadAverage: Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
        totalMemoryBytes: Type.Number({ minimum: 0 }),
        freeMemoryBytes: Type.Number({ minimum: 0 }),
        availableMemoryBytes: Type.Number({ minimum: 0 }),
        usedMemoryBytes: Type.Number({ minimum: 0 }),
        memoryUsedPercent: Type.Number({ minimum: 0, maximum: 100 }),
        memoryAvailabilitySource: Type.Union([
          Type.Literal("macos_memory_pressure"),
          Type.Literal("linux_mem_available"),
          Type.Literal("free_memory"),
        ]),
        localModelProcessCount: Type.Optional(Type.Integer({ minimum: 0 })),
        localModelRssBytes: Type.Optional(Type.Number({ minimum: 0 })),
        processRssBytes: Type.Number({ minimum: 0 }),
        processHeapUsedBytes: Type.Number({ minimum: 0 }),
        processHeapTotalBytes: Type.Number({ minimum: 0 }),
        eventLoopLagMs: Type.Optional(Type.Number({ minimum: 0 })),
        status: OperationsStatusSchema,
      },
      { additionalProperties: false },
    ),
    agents: Type.Array(
      Type.Object(
        {
          id: NonEmptyString,
          name: Type.Optional(Type.String()),
          workspace: Type.String(),
          duty: OperationsDutySchema,
          status: OperationsStatusSchema,
          model: Type.Optional(Type.String()),
          fallbackModels: Type.Array(Type.String(), { maxItems: 50 }),
          activeTaskCount: Type.Integer({ minimum: 0 }),
          blockedTaskCount: Type.Integer({ minimum: 0 }),
          latestTask: Type.Optional(Type.String({ maxLength: 20_000 })),
          latestActivityAt: Type.Optional(Type.Number({ minimum: 0 })),
          heartbeat: Type.Object(
            {
              enabled: Type.Boolean(),
              every: Type.String(),
              everyMs: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
              target: Type.String(),
              model: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
          ),
          memoryBytes: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
          memoryAttribution: Type.Union([Type.Literal("unavailable"), Type.Literal("process")]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
    tasks: Type.Array(
      Type.Object(
        {
          id: NonEmptyString,
          title: NonEmptyString,
          runtime: Type.Union([
            Type.Literal("subagent"),
            Type.Literal("acp"),
            Type.Literal("cli"),
            Type.Literal("cron"),
          ]),
          agentId: Type.Optional(Type.String()),
          parentFlowId: Type.Optional(Type.String()),
          status: OperationsStatusSchema,
          sourceStatus: NonEmptyString,
          progress: Type.Optional(Type.String({ maxLength: 20_000 })),
          error: Type.Optional(Type.String({ maxLength: 20_000 })),
          updatedAt: Type.Number({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    workflows: Type.Array(
      Type.Object(
        {
          id: NonEmptyString,
          title: NonEmptyString,
          ownerKey: NonEmptyString,
          controllerId: Type.Optional(Type.String()),
          status: OperationsStatusSchema,
          sourceStatus: NonEmptyString,
          currentStep: Type.Optional(Type.String()),
          blocker: Type.Optional(Type.String({ maxLength: 20_000 })),
          activeTaskCount: Type.Integer({ minimum: 0 }),
          failedTaskCount: Type.Integer({ minimum: 0 }),
          updatedAt: Type.Number({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    cronJobs: Type.Array(
      Type.Object(
        {
          id: NonEmptyString,
          name: NonEmptyString,
          agentId: Type.Optional(Type.String()),
          duty: OperationsDutySchema,
          status: OperationsStatusSchema,
          enabled: Type.Boolean(),
          running: Type.Boolean(),
          nextRunAt: Type.Optional(Type.Number({ minimum: 0 })),
          lastRunAt: Type.Optional(Type.Number({ minimum: 0 })),
          lastRunStatus: Type.Optional(Type.String()),
          lastError: Type.Optional(Type.String({ maxLength: 20_000 })),
          consecutiveErrors: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
    skills: Type.Array(OperationsCatalogEntryV1Schema, { maxItems: 200 }),
    plugins: Type.Array(OperationsCatalogEntryV1Schema, { maxItems: 200 }),
    tools: Type.Array(OperationsCatalogEntryV1Schema, { maxItems: 200 }),
    models: Type.Array(OperationsCatalogEntryV1Schema, { maxItems: 200 }),
    processes: Type.Array(
      Type.Object(
        {
          pid: Type.Integer({ minimum: 0 }),
          parentPid: Type.Integer({ minimum: 0 }),
          command: NonEmptyString,
          rssBytes: Type.Number({ minimum: 0 }),
          cpuPercent: Type.Number({ minimum: 0 }),
          kind: Type.Union([
            Type.Literal("gateway"),
            Type.Literal("local_model"),
            Type.Literal("browser"),
            Type.Literal("other"),
          ]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 30 },
    ),
    findings: Type.Array(OperationsFindingV1Schema, { maxItems: 200 }),
    reconciler: Type.Object(
      {
        mode: Type.Union([Type.Literal("shadow"), Type.Literal("supervised")]),
        autoRemediationEnabled: Type.Literal(false),
        intervalMs: Type.Number({ minimum: 1 }),
        lastSweepAt: Type.Number({ minimum: 0 }),
        nextSweepAt: Type.Number({ minimum: 0 }),
        recommendedActionCount: Type.Integer({ minimum: 0 }),
        ruleCount: Type.Integer({ minimum: 0 }),
        note: Type.String(),
      },
      { additionalProperties: false },
    ),
    controls: Type.Object(
      {
        mode: Type.Literal("guarded"),
        previewRequired: Type.Literal(true),
        supportedActions: Type.Array(OperationsActionKindSchema, { maxItems: 20 }),
        note: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const OperationsSnapshotV2ResultSchema = Type.Object(
  {
    schema: Type.Literal("openclaw.operations-room.v2"),
    generatedAt: Type.Number({ minimum: 0 }),
    snapshotId: NonEmptyString,
    freshness: Type.Object(
      {
        status: Type.Union([Type.Literal("fresh"), Type.Literal("stale"), Type.Literal("unknown")]),
        observedAt: Type.Number({ minimum: 0 }),
        staleAfterMs: Type.Number({ minimum: 1 }),
        sources: Type.Object(
          {
            agents: OperationsSourceObservationSchema,
            tasks: OperationsSourceObservationSchema,
            workflows: OperationsSourceObservationSchema,
            schedules: OperationsSourceObservationSchema,
            capabilities: OperationsSourceObservationSchema,
            models: OperationsSourceObservationSchema,
            processes: OperationsSourceObservationSchema,
            event_loop: OperationsSourceObservationSchema,
            monitor: OperationsSourceObservationSchema,
            incident_ledger: OperationsSourceObservationSchema,
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    completeness: Type.Object(
      {
        status: Type.Union([Type.Literal("complete"), Type.Literal("partial")]),
        unavailableSources: Type.Array(OperationsSourceNameSchema, { maxItems: 20 }),
        fallbackSources: Type.Array(OperationsSourceNameSchema, { maxItems: 20 }),
      },
      { additionalProperties: false },
    ),
    briefing: Type.Object(
      {
        tone: Type.Union([
          Type.Literal("normal"),
          Type.Literal("attention"),
          Type.Literal("urgent"),
          Type.Literal("unknown"),
        ]),
        text: Type.String({ maxLength: 1_000 }),
      },
      { additionalProperties: false },
    ),
    qualityTarget: Type.Literal(93),
    qualityScore: Type.Number({ minimum: 0, maximum: 100 }),
    overallStatus: OperationsStatusSchema,
    summary: Type.Object(
      {
        agents: Type.Integer({ minimum: 0 }),
        workingAgents: Type.Integer({ minimum: 0 }),
        attentionAgents: Type.Integer({ minimum: 0 }),
        tasks: Type.Integer({ minimum: 0 }),
        activeTasks: Type.Integer({ minimum: 0 }),
        failedTasks: Type.Integer({ minimum: 0 }),
        workflows: Type.Integer({ minimum: 0 }),
        activeWorkflows: Type.Integer({ minimum: 0 }),
        cronJobs: Type.Integer({ minimum: 0 }),
        failingCronJobs: Type.Integer({ minimum: 0 }),
        plugins: Type.Integer({ minimum: 0 }),
        skills: Type.Integer({ minimum: 0 }),
        tools: Type.Integer({ minimum: 0 }),
        models: Type.Integer({ minimum: 0 }),
        findings: Type.Integer({ minimum: 0 }),
        actionableFindings: Type.Integer({ minimum: 0 }),
        historicalFindings: Type.Integer({ minimum: 0 }),
        needsUserFindings: Type.Integer({ minimum: 0 }),
        handlingFindings: Type.Integer({ minimum: 0 }),
        watchingFindings: Type.Integer({ minimum: 0 }),
        criticalFindings: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    collections: Type.Object(
      {
        agents: OperationsCollectionCountSchema,
        tasks: OperationsCollectionCountSchema,
        workflows: OperationsCollectionCountSchema,
        cronJobs: OperationsCollectionCountSchema,
        skills: OperationsCollectionCountSchema,
        plugins: OperationsCollectionCountSchema,
        tools: OperationsCollectionCountSchema,
        models: OperationsCollectionCountSchema,
        processes: OperationsCollectionCountSchema,
        findings: OperationsCollectionCountSchema,
        activityRollups: OperationsCollectionCountSchema,
        incidentHistory: OperationsCollectionCountSchema,
      },
      { additionalProperties: false },
    ),
    host: Type.Object(
      {
        hostname: NonEmptyString,
        platform: NonEmptyString,
        arch: NonEmptyString,
        uptimeMs: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
        logicalCpuCount: Type.Integer({ minimum: 0 }),
        loadAverage: Type.Tuple([Type.Number(), Type.Number(), Type.Number()]),
        totalMemoryBytes: Type.Number({ minimum: 0 }),
        freeMemoryBytes: Type.Number({ minimum: 0 }),
        availableMemoryBytes: Type.Number({ minimum: 0 }),
        usedMemoryBytes: Type.Number({ minimum: 0 }),
        memoryUsedPercent: Type.Number({ minimum: 0, maximum: 100 }),
        memoryAvailabilitySource: Type.Union([
          Type.Literal("macos_memory_pressure"),
          Type.Literal("linux_mem_available"),
          Type.Literal("free_memory"),
        ]),
        localModelProcessCount: Type.Optional(Type.Integer({ minimum: 0 })),
        localModelRssBytes: Type.Optional(Type.Number({ minimum: 0 })),
        processRssBytes: Type.Number({ minimum: 0 }),
        processHeapUsedBytes: Type.Number({ minimum: 0 }),
        processHeapTotalBytes: Type.Number({ minimum: 0 }),
        eventLoopLagMs: Type.Optional(Type.Number({ minimum: 0 })),
        status: OperationsStatusSchema,
      },
      { additionalProperties: false },
    ),
    agents: Type.Array(
      Type.Object(
        {
          id: NonEmptyString,
          name: Type.Optional(Type.String()),
          workspace: Type.String(),
          duty: OperationsDutySchema,
          dutySource: Type.Union([
            Type.Literal("heartbeat"),
            Type.Literal("schedule"),
            Type.Literal("configuration"),
          ]),
          status: OperationsStatusSchema,
          activityState: OperationsActivityStateSchema,
          healthState: OperationsHealthStateSchema,
          attentionState: OperationsAttentionStateSchema,
          model: Type.Optional(Type.String()),
          fallbackModels: Type.Array(Type.String(), { maxItems: 50 }),
          activeTaskCount: Type.Integer({ minimum: 0 }),
          blockedTaskCount: Type.Integer({ minimum: 0 }),
          latestTask: Type.Optional(Type.String({ maxLength: 20_000 })),
          latestActivityAt: Type.Optional(Type.Number({ minimum: 0 })),
          currentWork: Type.Optional(
            Type.Object(
              {
                taskId: NonEmptyString,
                title: Type.String({ maxLength: 80 }),
                summary: Type.Optional(Type.String({ maxLength: 120 })),
                updatedAt: Type.Number({ minimum: 0 }),
                outcome: Type.Literal("active"),
              },
              { additionalProperties: false },
            ),
          ),
          lastActivity: Type.Optional(
            Type.Object(
              {
                taskId: NonEmptyString,
                title: Type.String({ maxLength: 80 }),
                summary: Type.Optional(Type.String({ maxLength: 120 })),
                updatedAt: Type.Number({ minimum: 0 }),
                outcome: Type.Union([
                  Type.Literal("succeeded"),
                  Type.Literal("blocked"),
                  Type.Literal("failed"),
                  Type.Literal("cancelled"),
                  Type.Literal("unknown"),
                ]),
              },
              { additionalProperties: false },
            ),
          ),
          heartbeat: Type.Object(
            {
              enabled: Type.Boolean(),
              every: Type.String(),
              everyMs: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
              target: Type.String(),
              model: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
          ),
          memoryBytes: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
          memoryAttribution: Type.Union([Type.Literal("unavailable"), Type.Literal("process")]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
    tasks: Type.Array(
      Type.Object(
        {
          id: NonEmptyString,
          title: NonEmptyString,
          runtime: Type.Union([
            Type.Literal("subagent"),
            Type.Literal("acp"),
            Type.Literal("cli"),
            Type.Literal("cron"),
          ]),
          agentId: Type.Optional(Type.String()),
          parentFlowId: Type.Optional(Type.String()),
          status: OperationsStatusSchema,
          sourceStatus: NonEmptyString,
          progress: Type.Optional(Type.String({ maxLength: 20_000 })),
          error: Type.Optional(Type.String({ maxLength: 20_000 })),
          updatedAt: Type.Number({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    workflows: Type.Array(
      Type.Object(
        {
          id: NonEmptyString,
          title: NonEmptyString,
          ownerKey: NonEmptyString,
          controllerId: Type.Optional(Type.String()),
          status: OperationsStatusSchema,
          sourceStatus: NonEmptyString,
          currentStep: Type.Optional(Type.String()),
          blocker: Type.Optional(Type.String({ maxLength: 20_000 })),
          hasWaitState: Type.Boolean(),
          activeTaskCount: Type.Integer({ minimum: 0 }),
          failedTaskCount: Type.Integer({ minimum: 0 }),
          updatedAt: Type.Number({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    cronJobs: Type.Array(
      Type.Object(
        {
          id: NonEmptyString,
          name: NonEmptyString,
          agentId: Type.Optional(Type.String()),
          duty: OperationsDutySchema,
          status: OperationsStatusSchema,
          enabled: Type.Boolean(),
          running: Type.Boolean(),
          nextRunAt: Type.Optional(Type.Number({ minimum: 0 })),
          lastRunAt: Type.Optional(Type.Number({ minimum: 0 })),
          lastRunStatus: Type.Optional(Type.String()),
          lastError: Type.Optional(Type.String({ maxLength: 20_000 })),
          consecutiveErrors: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
    skills: Type.Array(OperationsCatalogEntryV2Schema, { maxItems: 200 }),
    plugins: Type.Array(OperationsCatalogEntryV2Schema, { maxItems: 200 }),
    tools: Type.Array(OperationsCatalogEntryV2Schema, { maxItems: 200 }),
    models: Type.Array(OperationsCatalogEntryV2Schema, { maxItems: 200 }),
    processes: Type.Array(
      Type.Object(
        {
          pid: Type.Integer({ minimum: 0 }),
          parentPid: Type.Integer({ minimum: 0 }),
          command: NonEmptyString,
          rssBytes: Type.Number({ minimum: 0 }),
          cpuPercent: Type.Number({ minimum: 0 }),
          kind: Type.Union([
            Type.Literal("gateway"),
            Type.Literal("local_model"),
            Type.Literal("browser"),
            Type.Literal("other"),
          ]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 30 },
    ),
    findings: Type.Array(OperationsFindingV2Schema, { maxItems: 200 }),
    activityRollups: Type.Array(
      Type.Object(
        {
          key: NonEmptyString,
          runtime: Type.Union([
            Type.Literal("subagent"),
            Type.Literal("acp"),
            Type.Literal("cli"),
            Type.Literal("cron"),
          ]),
          sourceId: NonEmptyString,
          taskId: Type.Optional(NonEmptyString),
          title: Type.String({ maxLength: 80 }),
          count: Type.Integer({ minimum: 1 }),
          latestAt: Type.Number({ minimum: 0 }),
          status: Type.Union([
            Type.Literal("working"),
            Type.Literal("succeeded"),
            Type.Literal("blocked"),
            Type.Literal("failed"),
            Type.Literal("cancelled"),
            Type.Literal("unknown"),
          ]),
          agentId: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    incidentHistory: Type.Array(
      Type.Object(
        {
          id: NonEmptyString,
          title: Type.String({ maxLength: 1_000 }),
          category: OperationsFindingCategoryV2Schema,
          severity: Type.Union([
            Type.Literal("info"),
            Type.Literal("warning"),
            Type.Literal("critical"),
          ]),
          disposition: OperationsFindingDispositionSchema,
          responseState: OperationsFindingResponseStateSchema,
          firstObservedAt: Type.Number({ minimum: 0 }),
          lastObservedAt: Type.Number({ minimum: 0 }),
          resolvedAt: Type.Optional(Type.Number({ minimum: 0 })),
          transitions: Type.Array(
            Type.Object(
              {
                at: Type.Number({ minimum: 0 }),
                from: Type.Optional(
                  Type.Union([
                    Type.Literal("info"),
                    Type.Literal("warning"),
                    Type.Literal("critical"),
                  ]),
                ),
                to: Type.Union([
                  Type.Literal("info"),
                  Type.Literal("warning"),
                  Type.Literal("critical"),
                ]),
              },
              { additionalProperties: false },
            ),
            { maxItems: 20 },
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 200 },
    ),
    remediationHistory: Type.Optional(
      Type.Array(OperationsRemediationRecordSchema, { maxItems: 100 }),
    ),
    incidentLedger: Type.Object(
      {
        overflowCount: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    reconciler: Type.Object(
      {
        mode: Type.Union([Type.Literal("shadow"), Type.Literal("supervised")]),
        autoRemediationEnabled: Type.Boolean(),
        intervalMs: Type.Number({ minimum: 1 }),
        lastAttemptAt: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
        lastSweepAt: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
        nextSweepAt: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
        attemptCount: Type.Integer({ minimum: 0 }),
        sweepCount: Type.Integer({ minimum: 0 }),
        recommendedActionCount: Type.Integer({ minimum: 0 }),
        ruleCount: Type.Integer({ minimum: 0 }),
        note: Type.String(),
        lastError: Type.Optional(Type.String({ maxLength: 1_000 })),
      },
      { additionalProperties: false },
    ),
    controls: Type.Object(
      {
        mode: Type.Literal("guarded"),
        previewRequired: Type.Literal(true),
        supportedActions: Type.Array(OperationsActionKindSchema, { maxItems: 20 }),
        note: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

/** Legacy result alias remains the exact `operations.snapshot` V1 shape. */
export const OperationsSnapshotResultSchema = OperationsSnapshotV1ResultSchema;

export const OperationsActionPreviewParamsSchema = Type.Object(
  { action: OperationsActionKindSchema, targetId: NonEmptyString },
  { additionalProperties: false },
);

export const OperationsActionPreviewResultSchema = Type.Object(
  {
    token: NonEmptyString,
    action: OperationsActionKindSchema,
    targetId: NonEmptyString,
    summary: NonEmptyString,
    risk: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
    expiresAt: Type.Number({ minimum: 0 }),
    requiresConfirmation: Type.Literal(true),
  },
  { additionalProperties: false },
);

export const OperationsActionApplyParamsSchema = Type.Object(
  { token: NonEmptyString, action: OperationsActionKindSchema, targetId: NonEmptyString },
  { additionalProperties: false },
);

export const OperationsActionApplyResultSchema = Type.Object(
  {
    action: OperationsActionKindSchema,
    targetId: NonEmptyString,
    status: Type.Union([Type.Literal("applied"), Type.Literal("rejected"), Type.Literal("failed")]),
    summary: NonEmptyString,
    appliedAt: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
