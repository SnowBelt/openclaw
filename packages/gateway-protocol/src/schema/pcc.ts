// Project Command Center protocol schemas define the durable project/milestone ledger contract.
import { Type } from "typebox";
import { NonEmptyString } from "./primitives.js";

const TimestampSchema = Type.String({ minLength: 1 });
const IdListSchema = Type.Array(NonEmptyString, { maxItems: 200 });
const NonEmptyIdListSchema = Type.Array(NonEmptyString, { minItems: 1, maxItems: 200 });
const StringListSchema = Type.Array(Type.String({ maxLength: 4_000 }), { maxItems: 200 });
const MetadataSchema = Type.Record(Type.String(), Type.Unknown());

export const PccStatusSchema = Type.Union([
  Type.Literal("not_started"),
  Type.Literal("active"),
  Type.Literal("in_progress"),
  Type.Literal("blocked"),
  Type.Literal("needs_approval"),
  Type.Literal("deferred"),
  Type.Literal("on_hold"),
  Type.Literal("skipped"),
  Type.Literal("proof_pending"),
  Type.Literal("local_proof_complete"),
  Type.Literal("remote_proof_complete"),
  Type.Literal("runtime_proof_complete"),
  Type.Literal("persistence_proof_complete"),
  Type.Literal("complete"),
  Type.Literal("complete_with_maintenance"),
  Type.Literal("reopened"),
  Type.Literal("archived"),
  Type.Literal("failed"),
]);

export const PccProofLevelSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("planned"),
  Type.Literal("local"),
  Type.Literal("remote"),
  Type.Literal("runtime"),
  Type.Literal("persistence"),
  Type.Literal("production"),
]);

export const PccPermissionStatusSchema = Type.Union([
  Type.Literal("needed"),
  Type.Literal("granted"),
  Type.Literal("used"),
  Type.Literal("expired"),
  Type.Literal("revoked"),
  Type.Literal("denied"),
  Type.Literal("blocked"),
]);

export const PccPermissionTypeSchema = Type.Union([
  Type.Literal("local_proof"),
  Type.Literal("codex_usage"),
  Type.Literal("high_reasoning_model"),
  Type.Literal("remote_proof"),
  Type.Literal("push_backup"),
  Type.Literal("runtime_restart"),
  Type.Literal("runtime_install"),
  Type.Literal("reboot"),
  Type.Literal("publish"),
  Type.Literal("trading_live_money"),
  Type.Literal("destructive_action"),
  Type.Literal("external_write"),
]);

export const PccRiskLevelSchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("critical"),
]);

export const PccEvidenceKindSchema = Type.Union([
  Type.Literal("local_test"),
  Type.Literal("typecheck"),
  Type.Literal("changed_gate"),
  Type.Literal("remote_ci"),
  Type.Literal("runtime_status"),
  Type.Literal("browser_proof"),
  Type.Literal("screenshot"),
  Type.Literal("git_commit"),
  Type.Literal("backup"),
  Type.Literal("receipt"),
  Type.Literal("external_source"),
  Type.Literal("manual_review"),
  Type.Literal("other"),
]);

export const PccEvidenceStatusSchema = Type.Union([
  Type.Literal("unknown"),
  Type.Literal("passed"),
  Type.Literal("failed"),
  Type.Literal("blocked"),
  Type.Literal("not_applicable"),
]);

export const PccPhaseSchema = Type.Object(
  {
    id: NonEmptyString,
    title: NonEmptyString,
    status: Type.Optional(PccStatusSchema),
    weight: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    percentComplete: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    order: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const PccProjectSchema = Type.Object(
  {
    id: NonEmptyString,
    title: NonEmptyString,
    goal: Type.Optional(Type.String({ maxLength: 20_000 })),
    status: PccStatusSchema,
    owner: Type.Optional(Type.String({ maxLength: 512 })),
    priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })),
    phases: Type.Optional(Type.Array(PccPhaseSchema, { maxItems: 50 })),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    metadata: Type.Optional(MetadataSchema),
  },
  { additionalProperties: false },
);

export const PccMilestoneSchema = Type.Object(
  {
    id: NonEmptyString,
    projectId: NonEmptyString,
    title: NonEmptyString,
    status: PccStatusSchema,
    phaseId: Type.Optional(NonEmptyString),
    owner: Type.Optional(Type.String({ maxLength: 512 })),
    order: Type.Optional(Type.Integer({ minimum: 0 })),
    percentComplete: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    dependsOn: Type.Optional(IdListSchema),
    requiredEvidenceIds: Type.Optional(IdListSchema),
    receiptIds: Type.Optional(IdListSchema),
    permissionGrantIds: Type.Optional(IdListSchema),
    blocker: Type.Optional(Type.String({ maxLength: 10_000 })),
    implementationPlan: Type.Optional(Type.String({ maxLength: 200_000 })),
    acceptanceCriteria: Type.Optional(StringListSchema),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    metadata: Type.Optional(MetadataSchema),
  },
  { additionalProperties: false },
);

export const PccSubMilestoneSchema = Type.Object(
  {
    id: NonEmptyString,
    projectId: NonEmptyString,
    milestoneId: NonEmptyString,
    title: NonEmptyString,
    status: PccStatusSchema,
    order: Type.Optional(Type.Integer({ minimum: 0 })),
    owner: Type.Optional(Type.String({ maxLength: 512 })),
    percentComplete: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    dependsOn: Type.Optional(IdListSchema),
    requiredEvidenceIds: Type.Optional(IdListSchema),
    receiptIds: Type.Optional(IdListSchema),
    permissionGrantIds: Type.Optional(IdListSchema),
    blocker: Type.Optional(Type.String({ maxLength: 10_000 })),
    implementationPlan: Type.Optional(Type.String({ maxLength: 200_000 })),
    acceptanceCriteria: Type.Optional(StringListSchema),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    metadata: Type.Optional(MetadataSchema),
  },
  { additionalProperties: false },
);

export const PccPermissionAuditEntrySchema = Type.Object(
  {
    at: TimestampSchema,
    status: PccPermissionStatusSchema,
    note: Type.Optional(Type.String({ maxLength: 4_000 })),
  },
  { additionalProperties: false },
);

export const PccPermissionGrantSchema = Type.Object(
  {
    id: NonEmptyString,
    projectId: NonEmptyString,
    milestoneId: Type.Optional(NonEmptyString),
    type: PccPermissionTypeSchema,
    status: PccPermissionStatusSchema,
    riskLevel: PccRiskLevelSchema,
    allowedActions: Type.Array(NonEmptyString, { maxItems: 100 }),
    forbiddenActions: Type.Optional(Type.Array(NonEmptyString, { maxItems: 100 })),
    target: Type.Optional(Type.String({ maxLength: 4_000 })),
    maxUses: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
    usedCount: Type.Integer({ minimum: 0 }),
    expiresAt: Type.Optional(TimestampSchema),
    tokenBudget: Type.Optional(Type.Integer({ minimum: 1 })),
    costBudget: Type.Optional(Type.Number({ minimum: 0 })),
    grantedBy: Type.Optional(Type.String({ maxLength: 512 })),
    grantedAt: Type.Optional(TimestampSchema),
    auditLog: Type.Array(PccPermissionAuditEntrySchema, { maxItems: 200 }),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const PccEvidenceSchema = Type.Object(
  {
    id: NonEmptyString,
    projectId: NonEmptyString,
    milestoneId: Type.Optional(NonEmptyString),
    kind: PccEvidenceKindSchema,
    status: PccEvidenceStatusSchema,
    summary: Type.Optional(Type.String({ maxLength: 20_000 })),
    source: Type.Optional(Type.String({ maxLength: 4_000 })),
    url: Type.Optional(Type.String({ maxLength: 8_000 })),
    path: Type.Optional(Type.String({ maxLength: 8_000 })),
    sha: Type.Optional(Type.String({ maxLength: 256 })),
    command: Type.Optional(Type.String({ maxLength: 20_000 })),
    exitCode: Type.Optional(Type.Integer({ minimum: -1 })),
    createdAt: TimestampSchema,
    metadata: Type.Optional(MetadataSchema),
  },
  { additionalProperties: false },
);

export const PccCompletionReceiptSchema = Type.Object(
  {
    id: NonEmptyString,
    projectId: NonEmptyString,
    milestoneId: NonEmptyString,
    summary: NonEmptyString,
    proofEvidenceIds: NonEmptyIdListSchema,
    artifactRefs: Type.Optional(StringListSchema),
    doNotRedo: Type.Optional(StringListSchema),
    followUpGaps: Type.Optional(StringListSchema),
    proofLevel: PccProofLevelSchema,
    completedBy: Type.Optional(Type.String({ maxLength: 512 })),
    completedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const PccDecisionSchema = Type.Object(
  {
    id: NonEmptyString,
    projectId: NonEmptyString,
    milestoneId: Type.Optional(NonEmptyString),
    subMilestoneId: Type.Optional(NonEmptyString),
    title: NonEmptyString,
    summary: NonEmptyString,
    rationale: Type.Optional(Type.String({ maxLength: 20_000 })),
    alternatives: Type.Optional(StringListSchema),
    impact: Type.Optional(Type.String({ maxLength: 20_000 })),
    decidedBy: Type.Optional(Type.String({ maxLength: 512 })),
    decidedAt: TimestampSchema,
    evidenceIds: Type.Optional(IdListSchema),
    metadata: Type.Optional(MetadataSchema),
  },
  { additionalProperties: false },
);

export const PccLastKnownGoodSchema = Type.Object(
  {
    id: NonEmptyString,
    projectId: NonEmptyString,
    subsystem: NonEmptyString,
    summary: NonEmptyString,
    evidenceIds: Type.Optional(IdListSchema),
    sha: Type.Optional(Type.String({ maxLength: 256 })),
    runtimePath: Type.Optional(Type.String({ maxLength: 8_000 })),
    screenshotPath: Type.Optional(Type.String({ maxLength: 8_000 })),
    verifiedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const PccProjectSummarySchema = Type.Object(
  {
    id: NonEmptyString,
    title: NonEmptyString,
    status: PccStatusSchema,
    percentComplete: Type.Number({ minimum: 0, maximum: 100 }),
    milestoneCounts: Type.Object(
      {
        total: Type.Integer({ minimum: 0 }),
        complete: Type.Integer({ minimum: 0 }),
        blocked: Type.Integer({ minimum: 0 }),
        needsApproval: Type.Integer({ minimum: 0 }),
        deferred: Type.Integer({ minimum: 0 }),
        skipped: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    nextActions: Type.Array(Type.String({ maxLength: 4_000 }), { maxItems: 10 }),
    proofGaps: Type.Array(Type.String({ maxLength: 4_000 }), { maxItems: 20 }),
    health: Type.Optional(Type.String({ maxLength: 512 })),
    dueDate: Type.Optional(TimestampSchema),
    excludedFromPccProductCompletion: Type.Optional(Type.Boolean()),
    pccWorkScope: Type.Optional(
      Type.Union([Type.Literal("pcc_product"), Type.Literal("project_work")]),
    ),
    pccCurrentScope: Type.Optional(Type.String({ maxLength: 512 })),
    pccProductScope: Type.Optional(Type.String({ maxLength: 512 })),
    workflowTemplateId: Type.Optional(Type.String({ maxLength: 512 })),
    recentActivity: Type.Optional(Type.String({ maxLength: 4_000 })),
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const PccPortfolioSummarySchema = Type.Object(
  {
    projectsTotal: Type.Integer({ minimum: 0 }),
    active: Type.Integer({ minimum: 0 }),
    blocked: Type.Integer({ minimum: 0 }),
    needsApproval: Type.Integer({ minimum: 0 }),
    needsAttention: Type.Optional(Type.Integer({ minimum: 0 })),
    proofGaps: Type.Optional(Type.Integer({ minimum: 0 })),
    overdue: Type.Optional(Type.Integer({ minimum: 0 })),
    stale: Type.Optional(Type.Integer({ minimum: 0 })),
    complete: Type.Integer({ minimum: 0 }),
    archived: Type.Integer({ minimum: 0 }),
    averagePercentComplete: Type.Number({ minimum: 0, maximum: 100 }),
    nextActions: Type.Array(Type.String({ maxLength: 4_000 }), { maxItems: 20 }),
  },
  { additionalProperties: false },
);

export const PccProjectsListParamsSchema = Type.Object(
  {
    includeArchived: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const PccProjectsListResultSchema = Type.Object(
  {
    projects: Type.Array(PccProjectSummarySchema, { maxItems: 1_000 }),
  },
  { additionalProperties: false },
);

export const PccProjectsGetParamsSchema = Type.Object(
  {
    projectId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const PccProjectsGetResultSchema = Type.Object(
  {
    project: PccProjectSchema,
    milestones: Type.Array(PccMilestoneSchema),
    subMilestones: Type.Optional(Type.Array(PccSubMilestoneSchema)),
    permissions: Type.Array(PccPermissionGrantSchema),
    evidence: Type.Array(PccEvidenceSchema),
    receipts: Type.Array(PccCompletionReceiptSchema),
    decisions: Type.Array(PccDecisionSchema),
    lastKnownGood: Type.Array(PccLastKnownGoodSchema),
    summary: PccProjectSummarySchema,
  },
  { additionalProperties: false },
);

export const PccProjectsUpsertParamsSchema = Type.Object(
  {
    project: Type.Object(
      {
        id: Type.Optional(NonEmptyString),
        title: NonEmptyString,
        goal: Type.Optional(Type.String({ maxLength: 20_000 })),
        status: Type.Optional(PccStatusSchema),
        owner: Type.Optional(Type.String({ maxLength: 512 })),
        priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })),
        phases: Type.Optional(Type.Array(PccPhaseSchema, { maxItems: 50 })),
        metadata: Type.Optional(MetadataSchema),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PccProjectsUpsertResultSchema = Type.Object(
  {
    project: PccProjectSchema,
    summary: PccProjectSummarySchema,
  },
  { additionalProperties: false },
);

export const PccMilestonesUpsertParamsSchema = Type.Object(
  {
    milestone: Type.Object(
      {
        id: Type.Optional(NonEmptyString),
        projectId: NonEmptyString,
        title: NonEmptyString,
        status: Type.Optional(PccStatusSchema),
        phaseId: Type.Optional(NonEmptyString),
        owner: Type.Optional(Type.String({ maxLength: 512 })),
        order: Type.Optional(Type.Integer({ minimum: 0 })),
        percentComplete: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
        dependsOn: Type.Optional(IdListSchema),
        requiredEvidenceIds: Type.Optional(IdListSchema),
        receiptIds: Type.Optional(IdListSchema),
        permissionGrantIds: Type.Optional(IdListSchema),
        blocker: Type.Optional(Type.String({ maxLength: 10_000 })),
        implementationPlan: Type.Optional(Type.String({ maxLength: 200_000 })),
        acceptanceCriteria: Type.Optional(StringListSchema),
        metadata: Type.Optional(MetadataSchema),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PccMilestonesUpsertResultSchema = Type.Object(
  {
    milestone: PccMilestoneSchema,
    summary: PccProjectSummarySchema,
  },
  { additionalProperties: false },
);

export const PccSubMilestonesListParamsSchema = Type.Object(
  {
    projectId: NonEmptyString,
    milestoneId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const PccSubMilestonesListResultSchema = Type.Object(
  {
    subMilestones: Type.Array(PccSubMilestoneSchema, { maxItems: 5_000 }),
  },
  { additionalProperties: false },
);

export const PccSubMilestonesUpsertParamsSchema = Type.Object(
  {
    subMilestone: Type.Object(
      {
        id: Type.Optional(NonEmptyString),
        projectId: NonEmptyString,
        milestoneId: NonEmptyString,
        title: NonEmptyString,
        status: Type.Optional(PccStatusSchema),
        order: Type.Optional(Type.Integer({ minimum: 0 })),
        owner: Type.Optional(Type.String({ maxLength: 512 })),
        percentComplete: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
        dependsOn: Type.Optional(IdListSchema),
        requiredEvidenceIds: Type.Optional(IdListSchema),
        receiptIds: Type.Optional(IdListSchema),
        permissionGrantIds: Type.Optional(IdListSchema),
        blocker: Type.Optional(Type.String({ maxLength: 10_000 })),
        implementationPlan: Type.Optional(Type.String({ maxLength: 200_000 })),
        acceptanceCriteria: Type.Optional(StringListSchema),
        metadata: Type.Optional(MetadataSchema),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PccSubMilestonesUpsertResultSchema = Type.Object(
  {
    subMilestone: PccSubMilestoneSchema,
    milestone: PccMilestoneSchema,
    summary: PccProjectSummarySchema,
  },
  { additionalProperties: false },
);

export const PccPermissionsUpsertParamsSchema = Type.Object(
  {
    permission: Type.Object(
      {
        id: Type.Optional(NonEmptyString),
        projectId: NonEmptyString,
        milestoneId: Type.Optional(NonEmptyString),
        type: PccPermissionTypeSchema,
        status: Type.Optional(PccPermissionStatusSchema),
        riskLevel: Type.Optional(PccRiskLevelSchema),
        allowedActions: Type.Optional(Type.Array(NonEmptyString, { maxItems: 100 })),
        forbiddenActions: Type.Optional(Type.Array(NonEmptyString, { maxItems: 100 })),
        target: Type.Optional(Type.String({ maxLength: 4_000 })),
        maxUses: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
        expiresAt: Type.Optional(TimestampSchema),
        tokenBudget: Type.Optional(Type.Integer({ minimum: 1 })),
        costBudget: Type.Optional(Type.Number({ minimum: 0 })),
        grantedBy: Type.Optional(Type.String({ maxLength: 512 })),
        note: Type.Optional(Type.String({ maxLength: 4_000 })),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PccPermissionsUpsertResultSchema = Type.Object(
  {
    permission: PccPermissionGrantSchema,
    summary: PccProjectSummarySchema,
  },
  { additionalProperties: false },
);

export const PccEvidenceAddParamsSchema = Type.Object(
  {
    evidence: Type.Object(
      {
        projectId: NonEmptyString,
        milestoneId: Type.Optional(NonEmptyString),
        kind: PccEvidenceKindSchema,
        status: Type.Optional(PccEvidenceStatusSchema),
        summary: Type.Optional(Type.String({ maxLength: 20_000 })),
        source: Type.Optional(Type.String({ maxLength: 4_000 })),
        url: Type.Optional(Type.String({ maxLength: 8_000 })),
        path: Type.Optional(Type.String({ maxLength: 8_000 })),
        sha: Type.Optional(Type.String({ maxLength: 256 })),
        command: Type.Optional(Type.String({ maxLength: 20_000 })),
        exitCode: Type.Optional(Type.Integer({ minimum: -1 })),
        metadata: Type.Optional(MetadataSchema),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PccEvidenceAddResultSchema = Type.Object(
  {
    evidence: PccEvidenceSchema,
    summary: PccProjectSummarySchema,
  },
  { additionalProperties: false },
);

export const PccReceiptsAddParamsSchema = Type.Object(
  {
    receipt: Type.Object(
      {
        projectId: NonEmptyString,
        milestoneId: NonEmptyString,
        summary: NonEmptyString,
        proofEvidenceIds: NonEmptyIdListSchema,
        artifactRefs: Type.Optional(StringListSchema),
        doNotRedo: Type.Optional(StringListSchema),
        followUpGaps: Type.Optional(StringListSchema),
        proofLevel: Type.Optional(PccProofLevelSchema),
        completedBy: Type.Optional(Type.String({ maxLength: 512 })),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PccReceiptsAddResultSchema = Type.Object(
  {
    receipt: PccCompletionReceiptSchema,
    milestone: PccMilestoneSchema,
    lastKnownGood: PccLastKnownGoodSchema,
    summary: PccProjectSummarySchema,
  },
  { additionalProperties: false },
);

export const PccDecisionsAddParamsSchema = Type.Object(
  {
    decision: Type.Object(
      {
        projectId: NonEmptyString,
        milestoneId: Type.Optional(NonEmptyString),
        subMilestoneId: Type.Optional(NonEmptyString),
        title: NonEmptyString,
        summary: NonEmptyString,
        rationale: Type.Optional(Type.String({ maxLength: 20_000 })),
        alternatives: Type.Optional(StringListSchema),
        impact: Type.Optional(Type.String({ maxLength: 20_000 })),
        decidedBy: Type.Optional(Type.String({ maxLength: 512 })),
        evidenceIds: Type.Optional(IdListSchema),
        metadata: Type.Optional(MetadataSchema),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PccDecisionsAddResultSchema = Type.Object(
  {
    decision: PccDecisionSchema,
    summary: PccProjectSummarySchema,
  },
  { additionalProperties: false },
);

export const PccLastKnownGoodUpsertParamsSchema = Type.Object(
  {
    entry: Type.Object(
      {
        id: Type.Optional(NonEmptyString),
        projectId: NonEmptyString,
        subsystem: NonEmptyString,
        summary: NonEmptyString,
        evidenceIds: Type.Optional(IdListSchema),
        sha: Type.Optional(Type.String({ maxLength: 256 })),
        runtimePath: Type.Optional(Type.String({ maxLength: 8_000 })),
        screenshotPath: Type.Optional(Type.String({ maxLength: 8_000 })),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PccLastKnownGoodUpsertResultSchema = Type.Object(
  {
    lastKnownGood: PccLastKnownGoodSchema,
    summary: PccProjectSummarySchema,
  },
  { additionalProperties: false },
);

export const PccSummaryGetParamsSchema = Type.Object(
  {
    projectId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const PccSummaryGetResultSchema = Type.Object(
  {
    project: Type.Optional(PccProjectSummarySchema),
    portfolio: PccPortfolioSummarySchema,
    executionCapacity: Type.Optional(
      Type.Object(
        {
          logicalCpuCount: Type.Integer({ minimum: 1 }),
          performanceCpuCount: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
          totalRamGb: Type.Number({ minimum: 0 }),
          freeRamGb: Type.Number({ minimum: 0 }),
          load1: Type.Number({ minimum: 0 }),
          load5: Type.Number({ minimum: 0 }),
          load15: Type.Number({ minimum: 0 }),
          memoryPressure: Type.Union([
            Type.Literal("low"),
            Type.Literal("medium"),
            Type.Literal("high"),
          ]),
          activeOpenClawTaskCount: Type.Integer({ minimum: 0 }),
          configuredSubagentLimit: Type.Integer({ minimum: 0 }),
          observedLocalModelProcessCount: Type.Integer({ minimum: 0 }),
          safeLocalAgentSlots: Type.Integer({ minimum: 0, maximum: 12 }),
          timestamp: TimestampSchema,
          warnings: StringListSchema,
        },
        { additionalProperties: false },
      ),
    ),
    runtimeIdentity: Type.Optional(
      Type.Object(
        {
          runtimeSha: Type.Union([Type.String(), Type.Null()]),
          runtimeEntrypoint: Type.Union([Type.String(), Type.Null()]),
          expectedRuntimeRoot: Type.Union([Type.String(), Type.Null()]),
          expectedRuntimeEntrypoint: Type.Union([Type.String(), Type.Null()]),
          manifestPath: Type.Union([Type.String(), Type.Null()]),
          manifestSha256: Type.Union([Type.String(), Type.Null()]),
          buildId: Type.Union([Type.String(), Type.Null()]),
          identitySource: Type.Union([
            Type.Literal("release_pointer"),
            Type.Literal("environment"),
            Type.Literal("runtime_root"),
            Type.Literal("unavailable"),
          ]),
          verified: Type.Boolean(),
          driftReason: Type.Union([Type.String(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
    updateSafety: Type.Optional(
      Type.Object(
        {
          status: Type.Union([
            Type.Literal("protected"),
            Type.Literal("attention"),
            Type.Literal("unmanaged"),
          ]),
          standardUpdateBlocked: Type.Boolean(),
          sourceDurable: Type.Boolean(),
          brokerConfigured: Type.Boolean(),
          approvalPending: Type.Boolean(),
          sourceSha: Type.Union([Type.String(), Type.Null()]),
          sourceBranch: Type.Union([Type.String(), Type.Null()]),
          activeRelease: Type.Union([Type.String(), Type.Null()]),
          lastReceipt: Type.Union([
            Type.Object(
              {
                at: Type.Union([Type.String(), Type.Null()]),
                result: Type.String(),
                stage: Type.Union([Type.String(), Type.Null()]),
              },
              { additionalProperties: false },
            ),
            Type.Null(),
          ]),
          issues: StringListSchema,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
