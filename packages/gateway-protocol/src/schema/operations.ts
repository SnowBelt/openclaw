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

const OperationsFindingCategorySchema = Type.Union([
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

export const OperationsActionKindSchema = Type.Union([
  Type.Literal("cron.run"),
  Type.Literal("cron.enable"),
  Type.Literal("cron.disable"),
  Type.Literal("task.cancel"),
  Type.Literal("flow.cancel"),
]);

const OperationsFindingSchema = Type.Object(
  {
    id: NonEmptyString,
    severity: Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("critical")]),
    category: OperationsFindingCategorySchema,
    title: NonEmptyString,
    detail: Type.String({ maxLength: 20_000 }),
    entityId: Type.Optional(Type.String()),
    recommendedAction: Type.Optional(Type.String({ maxLength: 4_000 })),
    firstObservedAt: Type.Optional(Type.Number({ minimum: 0 })),
    lastObservedAt: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const OperationsCatalogEntrySchema = Type.Object(
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

export const OperationsSnapshotParamsSchema = Type.Object(
  { includeProcesses: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

export const OperationsSnapshotResultSchema = Type.Object(
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
    skills: Type.Array(OperationsCatalogEntrySchema, { maxItems: 200 }),
    plugins: Type.Array(OperationsCatalogEntrySchema, { maxItems: 200 }),
    tools: Type.Array(OperationsCatalogEntrySchema, { maxItems: 200 }),
    models: Type.Array(OperationsCatalogEntrySchema, { maxItems: 200 }),
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
    findings: Type.Array(OperationsFindingSchema, { maxItems: 200 }),
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
