// Project Command Center protocol schemas define the durable project/milestone ledger contract.
import { Type } from "typebox";
import { NonEmptyString } from "./primitives.js";

const TimestampSchema = Type.String({ minLength: 1 });
const IdListSchema = Type.Array(NonEmptyString, { maxItems: 200 });
const NonEmptyIdListSchema = Type.Array(NonEmptyString, { minItems: 1, maxItems: 200 });
const StringListSchema = Type.Array(Type.String({ maxLength: 4_000 }), { maxItems: 200 });
const MetadataSchema = Type.Record(Type.String(), Type.Unknown());

const ReleaseGovernanceStatusSchema = Type.Object(
  {
    schema: Type.Literal("openclaw.release-governance-status.v1"),
    policyVersion: Type.Integer({ minimum: 1 }),
    proofProfile: Type.Union([
      Type.Literal("default"),
      Type.Literal("mac_studio_control_director"),
    ]),
    proofProfileVersion: Type.Integer({ minimum: 1 }),
    proofPhase: Type.Union([Type.Literal("candidate"), Type.Literal("post_deployment")]),
    candidateSha: Type.Union([Type.String(), Type.Null()]),
    activeRuntimeSha: Type.Union([Type.String(), Type.Null()]),
    riskLevel: Type.Union([
      Type.Literal("P0"),
      Type.Literal("P1"),
      Type.Literal("P2"),
      Type.Literal("P3"),
      Type.Null(),
    ]),
    protectedPaths: Type.Array(
      Type.Object(
        { path: Type.String(), pattern: Type.String(), reason: Type.String() },
        { additionalProperties: false },
      ),
    ),
    capabilityDiff: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          change: Type.Union([
            Type.Literal("unchanged"),
            Type.Literal("added"),
            Type.Literal("removed"),
            Type.Literal("modified"),
            Type.Literal("weakened"),
            Type.Literal("unknown"),
          ]),
          required: Type.Boolean(),
          reason: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
    checks: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          status: Type.Union([
            Type.Literal("passed"),
            Type.Literal("failed"),
            Type.Literal("pending"),
            Type.Literal("blocked"),
            Type.Literal("not_applicable"),
          ]),
          summary: Type.String(),
          command: Type.Optional(Type.String()),
          count: Type.Optional(Type.Integer()),
          url: Type.Optional(Type.String()),
          artifact: Type.Optional(Type.String()),
          artifactSha256: Type.Optional(Type.String()),
          proofPhase: Type.Optional(
            Type.Union([Type.Literal("candidate"), Type.Literal("post_deployment")]),
          ),
          proofProfileVersion: Type.Optional(Type.Integer({ minimum: 1 })),
          verifierSha256: Type.Optional(Type.String()),
          browserArtifactSha256: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          recordedAt: TimestampSchema,
        },
        { additionalProperties: false },
      ),
    ),
    approvalStatus: Type.Union([
      Type.Literal("automatic"),
      Type.Literal("exact"),
      Type.Literal("bounded_grant"),
      Type.Literal("none"),
    ]),
    approvalScope: Type.Union([Type.String(), Type.Null()]),
    reviews: Type.Array(
      Type.Object(
        {
          role: Type.Union([
            Type.Literal("release_governor"),
            Type.Literal("judge"),
            Type.Literal("control_director"),
            Type.Literal("telemetry_evaluation_analyst"),
            Type.Literal("program_manager"),
          ]),
          reviewerId: Type.String(),
          decision: Type.Union([
            Type.Literal("approve"),
            Type.Literal("deny"),
            Type.Literal("escalate"),
          ]),
          confidence: Type.Number({ minimum: 0, maximum: 1 }),
          summary: Type.String(),
          evidenceIds: Type.Array(Type.String()),
          reviewedAt: TimestampSchema,
        },
        { additionalProperties: false },
      ),
    ),
    rollbackTarget: Type.Union([Type.String(), Type.Null()]),
    decision: Type.Union([
      Type.Literal("authorize"),
      Type.Literal("deny"),
      Type.Literal("escalate"),
      Type.Literal("none"),
    ]),
    evidenceReceiptHash: Type.Union([Type.String(), Type.Null()]),
    evidencePath: Type.Union([Type.String(), Type.Null()]),
    exactBlocker: Type.Union([Type.String(), Type.Null()]),
    approvalWording: Type.Union([Type.String(), Type.Null()]),
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

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
    revision: Type.Optional(Type.Integer({ minimum: 1 })),
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
    revision: Type.Optional(Type.Integer({ minimum: 1 })),
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
    revision: Type.Optional(Type.Integer({ minimum: 1 })),
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
    actor: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    note: Type.Optional(Type.String({ maxLength: 4_000 })),
  },
  { additionalProperties: false },
);

export const PccPermissionGrantSchema = Type.Object(
  {
    id: NonEmptyString,
    revision: Type.Optional(Type.Integer({ minimum: 1 })),
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

const PccModelUsageSchema = Type.Object(
  {
    input: Type.Optional(Type.Integer({ minimum: 0 })),
    output: Type.Optional(Type.Integer({ minimum: 0 })),
    cacheRead: Type.Optional(Type.Integer({ minimum: 0 })),
    cacheWrite: Type.Optional(Type.Integer({ minimum: 0 })),
    totalTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const PccModelRunPurposeSchema = Type.Union([
  Type.Literal("planning"),
  Type.Literal("replan"),
  Type.Literal("problem_solving"),
  Type.Literal("implementation"),
  Type.Literal("qa"),
  Type.Literal("final_review"),
  Type.Literal("attachment_instruction_clarification"),
]);

export const PccModelRunReceiptSchema = Type.Object(
  {
    id: NonEmptyString,
    projectId: NonEmptyString,
    milestoneId: Type.Optional(NonEmptyString),
    subMilestoneId: Type.Optional(NonEmptyString),
    sourceRunId: NonEmptyString,
    executor: Type.Union([Type.Literal("local"), Type.Literal("codex")]),
    purpose: PccModelRunPurposeSchema,
    provider: NonEmptyString,
    model: NonEmptyString,
    effort: Type.Optional(NonEmptyString),
    status: Type.Union([
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
    ]),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    usage: Type.Optional(PccModelUsageSchema),
    usageSource: Type.Union([Type.Literal("provider_reported"), Type.Literal("unavailable")]),
  },
  { additionalProperties: false },
);

export const PccProjectAiUsageSummarySchema = Type.Object(
  {
    /** All terminal execution/model receipts recorded for this project. */
    attemptedRuns: Type.Integer({ minimum: 0 }),
    succeededRuns: Type.Integer({ minimum: 0 }),
    failedRuns: Type.Integer({ minimum: 0 }),
    cancelledRuns: Type.Integer({ minimum: 0 }),
    completedRuns: Type.Integer({ minimum: 0 }),
    codexRuns: Type.Integer({ minimum: 0 }),
    localRuns: Type.Integer({ minimum: 0 }),
    codexSharePercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    reportedTokens: Type.Object(
      {
        total: Type.Integer({ minimum: 0 }),
        codex: Type.Integer({ minimum: 0 }),
        local: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    missingUsageRuns: Type.Integer({ minimum: 0 }),
    tokenCoverage: Type.Union([
      Type.Literal("none"),
      Type.Literal("partial"),
      Type.Literal("complete"),
    ]),
    recordingStartedAt: Type.Optional(TimestampSchema),
    byPurpose: Type.Array(
      Type.Object(
        {
          purpose: PccModelRunPurposeSchema,
          runs: Type.Integer({ minimum: 0 }),
          codexRuns: Type.Integer({ minimum: 0 }),
          reportedTokens: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
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
    aiUsage: Type.Optional(PccProjectAiUsageSummarySchema),
    summary: PccProjectSummarySchema,
  },
  { additionalProperties: false },
);

export const PccProjectsUpsertParamsSchema = Type.Object(
  {
    planningRunId: Type.Optional(NonEmptyString),
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    project: Type.Object(
      {
        id: Type.Optional(NonEmptyString),
        revision: Type.Optional(Type.Integer({ minimum: 1 })),
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

const PccPlanningSurfaceSchema = Type.Union([
  Type.Literal("project_creation"),
  Type.Literal("project_replan"),
  Type.Literal("setup_repair"),
  Type.Literal("autopilot_prompts"),
]);

const PccPlanningDepthSchema = Type.Union([
  Type.Literal("automatic"),
  Type.Literal("medium"),
  Type.Literal("high"),
]);

const PccPlanningPolicySchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    provider: Type.Union([Type.Literal("openai"), Type.Literal("ollama")]),
    model: NonEmptyString,
    runtime: Type.Union([Type.Literal("codex"), Type.Literal("openclaw")]),
    depth: PccPlanningDepthSchema,
    grant: Type.Object(
      {
        kind: Type.Literal("persistent_planning_only"),
        enabled: Type.Boolean(),
        allowedSurfaces: Type.Array(PccPlanningSurfaceSchema, { minItems: 1, maxItems: 10 }),
        forbiddenActions: Type.Array(NonEmptyString, { minItems: 1, maxItems: 50 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PccPlanningPolicyGetParamsSchema = Type.Object({}, { additionalProperties: false });
export const PccPlanningPolicyGetResultSchema = Type.Object(
  { policy: PccPlanningPolicySchema },
  { additionalProperties: false },
);
export const PccPlanningPolicyUpsertParamsSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    depth: Type.Optional(PccPlanningDepthSchema),
    model: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);
export const PccPlanningPolicyUpsertResultSchema = Type.Object(
  { policy: PccPlanningPolicySchema },
  { additionalProperties: false },
);

export const PccPrivateTeamPolicySchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    accessMode: Type.Literal("authenticated_gateway_operators"),
    memberLimit: Type.Integer({ minimum: 1, maximum: 6 }),
    maxProjects: Type.Integer({ minimum: 1, maximum: 100 }),
    maxConcurrentPlanningRuns: Type.Integer({ minimum: 1, maximum: 2 }),
    maxAttachmentsPerProject: Type.Integer({ minimum: 1, maximum: 200 }),
    maxAttachmentBytesPerProject: Type.Integer({ minimum: 1, maximum: 1_073_741_824 }),
    backupMode: Type.Literal("transactional_sqlite_plus_last_known_good"),
    localAiPreferred: Type.Literal(true),
  },
  { additionalProperties: false },
);

const PccGeneratedSubMilestoneSchema = Type.Object(
  {
    title: NonEmptyString,
    implementationPlan: NonEmptyString,
    acceptanceCriteria: Type.Array(NonEmptyString, { minItems: 1, maxItems: 50 }),
    responsibility: NonEmptyString,
    proofLevel: NonEmptyString,
  },
  { additionalProperties: false },
);

export const PccPlansGenerateParamsSchema = Type.Object(
  {
    surface: PccPlanningSurfaceSchema,
    plannerMode: Type.Optional(Type.Union([Type.Literal("local"), Type.Literal("codex")])),
    description: Type.String({ minLength: 1, maxLength: 20_000 }),
    existingTitle: Type.Optional(Type.String({ maxLength: 1_000 })),
    existingGoal: Type.Optional(Type.String({ maxLength: 20_000 })),
    desiredOutcome: Type.Optional(Type.String({ maxLength: 20_000 })),
    constraints: Type.Optional(Type.Array(Type.String({ maxLength: 4_000 }), { maxItems: 100 })),
    preferredTemplateId: Type.Optional(
      Type.Union([
        Type.Literal("software-product"),
        Type.Literal("dashboard-data"),
        Type.Literal("creative-media"),
        Type.Literal("research"),
        Type.Literal("trading-finance"),
        Type.Literal("snes-studio"),
        Type.Literal("custom"),
      ]),
    ),
    depth: Type.Optional(PccPlanningDepthSchema),
  },
  { additionalProperties: false },
);

const PccGeneratedPlanSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    title: NonEmptyString,
    goal: NonEmptyString,
    outcomeMetrics: Type.Array(NonEmptyString, { minItems: 1, maxItems: 100 }),
    workflowTemplateId: NonEmptyString,
    milestones: Type.Array(
      Type.Object(
        {
          ...PccGeneratedSubMilestoneSchema.properties,
          phaseId: NonEmptyString,
          dependencies: Type.Array(Type.Integer({ minimum: 0 }), { maxItems: 100 }),
          subMilestones: Type.Array(PccGeneratedSubMilestoneSchema, {
            minItems: 1,
            maxItems: 100,
          }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 100 },
    ),
    risks: Type.Array(Type.String({ maxLength: 4_000 }), { maxItems: 100 }),
    assumptions: Type.Array(Type.String({ maxLength: 4_000 }), { maxItems: 100 }),
    provenance: Type.Object(
      {
        generatedAt: TimestampSchema,
        provider: Type.Union([Type.Literal("openai"), Type.Literal("ollama")]),
        model: NonEmptyString,
        runtime: Type.Union([Type.Literal("codex"), Type.Literal("openclaw")]),
        effort: Type.Union([Type.Literal("medium"), Type.Literal("high")]),
        auth: Type.Union([Type.Literal("oauth"), Type.Literal("none")]),
        source: Type.Union([
          Type.Literal("live_local"),
          Type.Literal("live_codex"),
          Type.Literal("isolated_test_fixture"),
        ]),
        planningOnly: Type.Literal(true),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PccPlansGenerateResultSchema = Type.Object(
  { plan: PccGeneratedPlanSchema },
  { additionalProperties: false },
);

const PccPlanningRunStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("lost"),
]);

const PccPlanningRunStageSchema = Type.Union([
  Type.Literal("preparing"),
  Type.Literal("planner_running"),
  Type.Literal("validating"),
  Type.Literal("ready"),
]);

export const PccPlanningRunSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id: NonEmptyString,
    requestFingerprint: NonEmptyString,
    surface: PccPlanningSurfaceSchema,
    status: PccPlanningRunStatusSchema,
    stage: PccPlanningRunStageSchema,
    queuePosition: Type.Optional(Type.Integer({ minimum: 1 })),
    model: NonEmptyString,
    effort: Type.Union([Type.Literal("medium"), Type.Literal("high")]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    startedAt: Type.Optional(TimestampSchema),
    endedAt: Type.Optional(TimestampSchema),
    error: Type.Optional(Type.String({ maxLength: 4_000 })),
    usage: Type.Optional(PccModelUsageSchema),
    plan: Type.Optional(PccGeneratedPlanSchema),
  },
  { additionalProperties: false },
);

export const PccPlansStartParamsSchema = PccPlansGenerateParamsSchema;
export const PccPlansStartResultSchema = Type.Object(
  { run: PccPlanningRunSchema },
  { additionalProperties: false },
);
export const PccPlansGetParamsSchema = Type.Object(
  { runId: NonEmptyString },
  { additionalProperties: false },
);
export const PccPlansGetResultSchema = Type.Object(
  { run: PccPlanningRunSchema },
  { additionalProperties: false },
);
export const PccPlansCancelParamsSchema = PccPlansGetParamsSchema;
export const PccPlansCancelResultSchema = PccPlansGetResultSchema;

/** Durable, Gateway-owned project execution controls. */
export const PccExecutionStartParamsSchema = Type.Object(
  {
    projectId: NonEmptyString,
    expectedRevision: Type.Integer({ minimum: 1 }),
    idempotencyKey: Type.String({ minLength: 1, maxLength: 2_048 }),
  },
  { additionalProperties: false },
);

export const PccExecutionGetParamsSchema = Type.Object(
  {
    projectId: NonEmptyString,
    planId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const PccExecutionControlParamsSchema = Type.Object(
  {
    projectId: NonEmptyString,
    planId: NonEmptyString,
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const PccExecutionReviewParamsSchema = Type.Object(
  {
    projectId: NonEmptyString,
    planId: NonEmptyString,
    proofCandidateId: NonEmptyString,
    decision: Type.Union([Type.Literal("accept"), Type.Literal("reject")]),
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    reviewer: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: false },
);

const PccExecutionPlanResultSchema = Type.Object(
  { plan: Type.Unknown() },
  { additionalProperties: false },
);

export const PccExecutionStartResultSchema = PccExecutionPlanResultSchema;
export const PccExecutionGetResultSchema = PccExecutionPlanResultSchema;
export const PccExecutionPauseResultSchema = PccExecutionPlanResultSchema;
export const PccExecutionResumeResultSchema = PccExecutionPlanResultSchema;
export const PccExecutionStopResultSchema = PccExecutionPlanResultSchema;
export const PccExecutionReviewResultSchema = PccExecutionPlanResultSchema;

const PccAttachmentRoleSchema = Type.Union([
  Type.Literal("requirement"),
  Type.Literal("reference"),
  Type.Literal("example"),
  Type.Literal("proof"),
  Type.Literal("deliverable"),
]);
const PccAttachmentScopeSchema = Type.Union([
  Type.Literal("project"),
  Type.Literal("milestone"),
  Type.Literal("sub_milestone"),
  Type.Literal("proof_only"),
]);
const PccAttachmentModelAccessSchema = Type.Union([
  Type.Literal("local_only"),
  Type.Literal("project_policy"),
  Type.Literal("no_model"),
]);

export const PccAttachmentSchema = Type.Object(
  {
    id: NonEmptyString,
    revision: Type.Optional(Type.Integer({ minimum: 1 })),
    logicalId: NonEmptyString,
    version: Type.Integer({ minimum: 1 }),
    projectId: NonEmptyString,
    milestoneId: Type.Optional(NonEmptyString),
    subMilestoneId: Type.Optional(NonEmptyString),
    originalName: NonEmptyString,
    title: NonEmptyString,
    mimeType: NonEmptyString,
    sizeBytes: Type.Integer({ minimum: 1 }),
    sha256: Type.String({ minLength: 64, maxLength: 64 }),
    role: PccAttachmentRoleSchema,
    scope: PccAttachmentScopeSchema,
    instructions: Type.String({ maxLength: 20_000 }),
    clarifiedInstructions: Type.Optional(Type.String({ maxLength: 20_000 })),
    instructionProvenance: Type.Optional(
      Type.Object(
        {
          provider: NonEmptyString,
          model: NonEmptyString,
          generatedAt: TimestampSchema,
        },
        { additionalProperties: false },
      ),
    ),
    modelAccess: PccAttachmentModelAccessSchema,
    sensitivity: Type.Union([
      Type.Literal("normal"),
      Type.Literal("sensitive"),
      Type.Literal("restricted"),
    ]),
    status: Type.Union([Type.Literal("ready"), Type.Literal("tombstoned")]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    sourceUploadKey: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  },
  { additionalProperties: false },
);

export const PccAttachmentUsageReceiptSchema = Type.Object(
  {
    id: NonEmptyString,
    attachmentId: NonEmptyString,
    projectId: NonEmptyString,
    milestoneId: Type.Optional(NonEmptyString),
    runId: Type.Optional(NonEmptyString),
    model: Type.Optional(NonEmptyString),
    purpose: NonEmptyString,
    outcome: Type.Optional(Type.String({ maxLength: 20_000 })),
    usedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const PccAttachmentsUploadBeginParamsSchema = Type.Object(
  {
    projectId: NonEmptyString,
    originalName: NonEmptyString,
    mimeType: NonEmptyString,
    sizeBytes: Type.Integer({ minimum: 1, maximum: 104_857_600 }),
    sha256: Type.Optional(Type.String({ minLength: 64, maxLength: 64 })),
    role: PccAttachmentRoleSchema,
    scope: PccAttachmentScopeSchema,
    milestoneId: Type.Optional(NonEmptyString),
    subMilestoneId: Type.Optional(NonEmptyString),
    instructions: Type.Optional(Type.String({ maxLength: 20_000 })),
    clarifiedInstructions: Type.Optional(Type.String({ maxLength: 20_000 })),
    instructionProvenance: Type.Optional(
      Type.Object(
        {
          provider: NonEmptyString,
          model: NonEmptyString,
          generatedAt: TimestampSchema,
        },
        { additionalProperties: false },
      ),
    ),
    modelAccess: Type.Optional(PccAttachmentModelAccessSchema),
    sensitivity: Type.Optional(
      Type.Union([Type.Literal("normal"), Type.Literal("sensitive"), Type.Literal("restricted")]),
    ),
    idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  },
  { additionalProperties: false },
);
export const PccAttachmentsUploadBeginResultSchema = Type.Object(
  {
    uploadId: NonEmptyString,
    offset: Type.Integer({ minimum: 0 }),
    expiresAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export const PccAttachmentsUploadChunkParamsSchema = Type.Object(
  {
    uploadId: NonEmptyString,
    offset: Type.Integer({ minimum: 0 }),
    dataBase64: Type.String({ minLength: 1, maxLength: 5_592_408 }),
  },
  { additionalProperties: false },
);
export const PccAttachmentsUploadChunkResultSchema = Type.Object(
  { uploadId: NonEmptyString, offset: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
export const PccAttachmentsUploadCommitParamsSchema = Type.Object(
  {
    uploadId: NonEmptyString,
    sha256: Type.Optional(Type.String({ minLength: 64, maxLength: 64 })),
  },
  { additionalProperties: false },
);
export const PccAttachmentsUploadCommitResultSchema = Type.Object(
  { attachment: PccAttachmentSchema },
  { additionalProperties: false },
);
export const PccAttachmentsListParamsSchema = Type.Object(
  {
    projectId: NonEmptyString,
    includeTombstoned: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const PccAttachmentsListResultSchema = Type.Object(
  { attachments: Type.Array(PccAttachmentSchema, { maxItems: 2_000 }) },
  { additionalProperties: false },
);
export const PccAttachmentsReadParamsSchema = Type.Object(
  {
    attachmentId: NonEmptyString,
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 4_194_304 })),
  },
  { additionalProperties: false },
);
export const PccAttachmentsReadResultSchema = Type.Object(
  {
    attachmentId: NonEmptyString,
    offset: Type.Integer({ minimum: 0 }),
    nextOffset: Type.Integer({ minimum: 0 }),
    totalBytes: Type.Integer({ minimum: 1 }),
    dataBase64: Type.String({ maxLength: 5_592_408 }),
    eof: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const PccAttachmentsUpdateParamsSchema = Type.Object(
  {
    attachmentId: NonEmptyString,
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    title: Type.Optional(NonEmptyString),
    role: Type.Optional(PccAttachmentRoleSchema),
    scope: Type.Optional(PccAttachmentScopeSchema),
    milestoneId: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    subMilestoneId: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    instructions: Type.Optional(Type.String({ maxLength: 20_000 })),
    clarifiedInstructions: Type.Optional(Type.String({ maxLength: 20_000 })),
    modelAccess: Type.Optional(PccAttachmentModelAccessSchema),
    sensitivity: Type.Optional(
      Type.Union([Type.Literal("normal"), Type.Literal("sensitive"), Type.Literal("restricted")]),
    ),
    tombstone: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const PccAttachmentsUpdateResultSchema = Type.Object(
  { attachment: PccAttachmentSchema },
  { additionalProperties: false },
);
export const PccAttachmentsClarifyParamsSchema = Type.Object(
  {
    projectId: NonEmptyString,
    originalName: NonEmptyString,
    role: PccAttachmentRoleSchema,
    instructions: Type.String({ minLength: 1, maxLength: 20_000 }),
  },
  { additionalProperties: false },
);
export const PccAttachmentsClarifyResultSchema = Type.Object(
  {
    runId: NonEmptyString,
    clarifiedInstructions: Type.String({ minLength: 1, maxLength: 20_000 }),
    usage: Type.Optional(PccModelUsageSchema),
    provenance: Type.Object(
      {
        provider: NonEmptyString,
        model: NonEmptyString,
        generatedAt: TimestampSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export const PccAttachmentUsageRecordParamsSchema = Type.Object(
  {
    attachmentId: NonEmptyString,
    milestoneId: Type.Optional(NonEmptyString),
    runId: Type.Optional(NonEmptyString),
    model: Type.Optional(NonEmptyString),
    purpose: NonEmptyString,
    outcome: Type.Optional(Type.String({ maxLength: 20_000 })),
  },
  { additionalProperties: false },
);
export const PccAttachmentUsageRecordResultSchema = Type.Object(
  { receipt: PccAttachmentUsageReceiptSchema },
  { additionalProperties: false },
);
export const PccAttachmentUsageListParamsSchema = Type.Object(
  {
    projectId: NonEmptyString,
    attachmentId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);
export const PccAttachmentUsageListResultSchema = Type.Object(
  { receipts: Type.Array(PccAttachmentUsageReceiptSchema, { maxItems: 10_000 }) },
  { additionalProperties: false },
);

export const PccMilestonesUpsertParamsSchema = Type.Object(
  {
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    milestone: Type.Object(
      {
        id: Type.Optional(NonEmptyString),
        revision: Type.Optional(Type.Integer({ minimum: 1 })),
        replaceExisting: Type.Optional(Type.Boolean()),
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
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    subMilestone: Type.Object(
      {
        id: Type.Optional(NonEmptyString),
        revision: Type.Optional(Type.Integer({ minimum: 1 })),
        replaceExisting: Type.Optional(Type.Boolean()),
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
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    permission: Type.Object(
      {
        id: Type.Optional(NonEmptyString),
        revision: Type.Optional(Type.Integer({ minimum: 1 })),
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
    planningPolicy: Type.Optional(PccPlanningPolicySchema),
    privateTeamPolicy: Type.Optional(PccPrivateTeamPolicySchema),
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
          thermalPressure: Type.Union([
            Type.Literal("nominal"),
            Type.Literal("fair"),
            Type.Literal("serious"),
            Type.Literal("critical"),
            Type.Literal("unknown"),
          ]),
          activeOpenClawTaskCount: Type.Integer({ minimum: 0 }),
          configuredSubagentLimit: Type.Integer({ minimum: 0 }),
          observedLocalModelProcessCount: Type.Integer({ minimum: 0 }),
          safeLocalAgentSlots: Type.Integer({ minimum: 0 }),
          timestamp: TimestampSchema,
          warnings: StringListSchema,
          controlDirectorAdmission: Type.Optional(
            Type.Object(
              {
                decision: Type.Union([
                  Type.Literal("admit"),
                  Type.Literal("unload_idle_then_admit"),
                  Type.Literal("queue"),
                ]),
                reason: NonEmptyString,
                selectedModel: NonEmptyString,
                residency: Type.Optional(
                  Type.Union([Type.Literal("already_resident"), Type.Literal("load")]),
                ),
                unloadModels: Type.Optional(Type.Array(NonEmptyString, { maxItems: 20 })),
                retryWhen: Type.Optional(
                  Type.Union([
                    Type.Literal("capacity"),
                    Type.Literal("memory"),
                    Type.Literal("thermal"),
                    Type.Literal("active_model"),
                  ]),
                ),
              },
              { additionalProperties: false },
            ),
          ),
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
    releaseGovernance: Type.Optional(Type.Union([ReleaseGovernanceStatusSchema, Type.Null()])),
  },
  { additionalProperties: false },
);

const PccWorkStateSchema = Type.Union([
  Type.Literal("needs_you"),
  Type.Literal("working"),
  Type.Literal("ready"),
  Type.Literal("paused"),
  Type.Literal("blocked"),
  Type.Literal("failed"),
  Type.Literal("complete"),
]);

export const PccOverviewProjectSchema = Type.Object(
  {
    ...PccProjectSummarySchema.properties,
    workState: PccWorkStateSchema,
    currentMilestone: Type.Optional(Type.String({ maxLength: 4_000 })),
    nextAction: Type.Optional(Type.String({ maxLength: 4_000 })),
    blocker: Type.Optional(Type.String({ maxLength: 4_000 })),
    activeAgentCount: Type.Integer({ minimum: 0, maximum: 100 }),
  },
  { additionalProperties: false },
);

export const PccOverviewAttentionItemSchema = Type.Object(
  {
    id: NonEmptyString,
    projectId: NonEmptyString,
    kind: Type.Union([
      Type.Literal("permission"),
      Type.Literal("decision"),
      Type.Literal("blocker"),
      Type.Literal("failure"),
      Type.Literal("missing_file"),
      Type.Literal("proof"),
      Type.Literal("system"),
    ]),
    title: NonEmptyString,
    detail: Type.Optional(Type.String({ maxLength: 4_000 })),
    actionLabel: NonEmptyString,
    recordId: Type.Optional(NonEmptyString),
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const PccOverviewAgentAssignmentSchema = Type.Object(
  {
    id: NonEmptyString,
    projectId: NonEmptyString,
    projectTitle: NonEmptyString,
    agentName: NonEmptyString,
    task: NonEmptyString,
    status: Type.Union([
      Type.Literal("running"),
      Type.Literal("waiting"),
      Type.Literal("paused"),
      Type.Literal("blocked"),
      Type.Literal("failed"),
      Type.Literal("lost"),
    ]),
    startedAt: Type.Optional(TimestampSchema),
    lastActivityAt: TimestampSchema,
  },
  { additionalProperties: false },
);

export const PccOverviewActivitySchema = Type.Object(
  {
    id: NonEmptyString,
    projectId: NonEmptyString,
    projectTitle: NonEmptyString,
    actor: NonEmptyString,
    action: NonEmptyString,
    progress: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    at: TimestampSchema,
  },
  { additionalProperties: false },
);

export const PccOverviewGetParamsSchema = Type.Object({}, { additionalProperties: false });
export const PccOverviewGetResultSchema = Type.Object(
  {
    ledgerRevision: Type.Integer({ minimum: 0 }),
    generatedAt: TimestampSchema,
    projects: Type.Array(PccOverviewProjectSchema, { maxItems: 1_000 }),
    attention: Type.Array(PccOverviewAttentionItemSchema, { maxItems: 1_000 }),
    activeAgents: Type.Array(PccOverviewAgentAssignmentSchema, { maxItems: 1_000 }),
    recentActivity: Type.Array(PccOverviewActivitySchema, { maxItems: 100 }),
    portfolio: PccPortfolioSummarySchema,
    system: Type.Object(
      {
        status: Type.Union([
          Type.Literal("healthy"),
          Type.Literal("attention"),
          Type.Literal("unavailable"),
        ]),
        label: NonEmptyString,
        detail: Type.Optional(Type.String({ maxLength: 4_000 })),
        projectId: Type.Literal("project-command-center"),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const PccChangedEventSchema = Type.Object(
  {
    ledgerRevision: Type.Integer({ minimum: 0 }),
    changedAt: TimestampSchema,
    mutation: NonEmptyString,
    actor: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    projectId: Type.Optional(NonEmptyString),
    recordId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const PccPresenceEntrySchema = Type.Object(
  {
    displayName: NonEmptyString,
    status: Type.Union([Type.Literal("online"), Type.Literal("away")]),
    surface: Type.Union([
      Type.Literal("overview"),
      Type.Literal("projects"),
      Type.Literal("activity"),
      Type.Literal("system"),
      Type.Literal("project"),
    ]),
    projectId: Type.Optional(NonEmptyString),
    editing: Type.Optional(Type.Boolean()),
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export const PccPresenceUpdateParamsSchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 80 }),
    status: Type.Union([Type.Literal("online"), Type.Literal("away")]),
    surface: PccPresenceEntrySchema.properties.surface,
    projectId: Type.Optional(NonEmptyString),
    editing: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const PccPresenceUpdateResultSchema = Type.Object(
  { presence: Type.Array(PccPresenceEntrySchema, { maxItems: 6 }) },
  { additionalProperties: false },
);
export const PccPresenceListParamsSchema = PccOverviewGetParamsSchema;
export const PccPresenceListResultSchema = PccPresenceUpdateResultSchema;

export const PccProjectPlanCommitParamsSchema = Type.Object(
  {
    planningRunId: Type.Optional(NonEmptyString),
    project: PccProjectsUpsertParamsSchema.properties.project,
    plan: PccGeneratedPlanSchema,
  },
  { additionalProperties: false },
);
export const PccProjectPlanCommitResultSchema = Type.Object(
  {
    project: PccProjectSchema,
    milestones: Type.Array(PccMilestoneSchema, { maxItems: 100 }),
    subMilestones: Type.Array(PccSubMilestoneSchema, { maxItems: 5_000 }),
    summary: PccProjectSummarySchema,
  },
  { additionalProperties: false },
);
