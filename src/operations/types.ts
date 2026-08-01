// Operations Room read models keep configured intent, observed runtime truth,
// and remediation policy separate so the dashboard never guesses that a
// configured capability is currently running.

export type OperationsSeverity = "info" | "warning" | "critical";
export type OperationsActivityState =
  | "working"
  | "waiting"
  | "scheduled"
  | "ready"
  | "off"
  | "unknown";
export type OperationsHealthState = "healthy" | "degraded" | "failed" | "unknown";
export type OperationsAttentionState = "none" | "needs_user" | "handling" | "watching" | "urgent";
export type OperationsFindingDisposition = "needs_user" | "handling" | "watching" | "historical";
export type OperationsFindingResponseState =
  | "unassigned"
  | "in_progress"
  | "monitoring"
  | "waiting_for_user"
  | "resolved";
export type OperationsRemediationRisk = "low" | "medium" | "high";
export type OperationsRemediationStatus =
  | "eligible"
  | "investigating"
  | "reviewing"
  | "confirmation_required"
  | "applying"
  | "verifying"
  | "completed"
  | "rolled_back"
  | "failed"
  | "approval_required";
export type OperationsRemediationRecord = {
  id: string;
  findingId: string;
  findingTitle: string;
  findingCategory: OperationsFinding["category"];
  findingEntityId?: string;
  impact: string;
  recipeId: string;
  risk: OperationsRemediationRisk;
  status: OperationsRemediationStatus;
  ownerId: string;
  recommendedFix?: string;
  recommendationReason?: string;
  confidence?: number;
  exactRepair: string;
  expectedChange?: string;
  verificationPlan?: string;
  progress: string;
  result?: string;
  evidence: string[];
  rollback: string;
  progressLocation?: string;
  undoAvailable: boolean;
  undoAction?: OperationsActionKind;
  undoTargetId?: string;
  automatic: boolean;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  rolledBackAt?: number;
  judge?: {
    model: "openclaw-judge-qwen35-27b-q8:latest";
    approved: boolean;
    reason: string;
  };
  investigation?: {
    model: "qwen3.6:27b-q8_0";
    confidence: number;
    recommendation: string;
  };
};
export type OperationsSourceName =
  | "agents"
  | "tasks"
  | "workflows"
  | "schedules"
  | "capabilities"
  | "models"
  | "processes"
  | "event_loop"
  | "monitor"
  | "incident_ledger";
export type OperationsSourceObservation = {
  status: "available" | "fallback" | "omitted" | "unavailable" | "stale";
  observedAt?: number;
};
export type OperationsStatus =
  | "healthy"
  | "working"
  | "idle"
  | "degraded"
  | "blocked"
  | "failed"
  | "disabled"
  | "unknown";
export type OperationsDuty = "always_on" | "scheduled" | "on_demand" | "disabled";

export type OperationsFinding = {
  id: string;
  severity: OperationsSeverity;
  category:
    | "agent"
    | "workflow"
    | "cron"
    | "skill"
    | "plugin"
    | "tool"
    | "model"
    | "process"
    | "monitor"
    | "resource"
    | "update";
  title: string;
  detail: string;
  entityId?: string;
  recommendedAction?: string;
  firstObservedAt?: number;
  lastObservedAt: number;
  resolvedAt?: number;
  evidenceState?: "last_known";
  disposition: OperationsFindingDisposition;
  responseState: OperationsFindingResponseState;
  impact: string;
  ownerId?: string;
  nextAction?: string;
  remediationTaskId?: string;
  lastProgressAt?: number;
  nextCheckAt?: number;
  remediation?: OperationsRemediationRecord;
};

export type OperationsHostSnapshot = {
  hostname: string;
  platform: string;
  arch: string;
  uptimeMs: number | null;
  logicalCpuCount: number;
  loadAverage: [number, number, number];
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  availableMemoryBytes: number;
  usedMemoryBytes: number;
  memoryUsedPercent: number;
  memoryAvailabilitySource: "macos_memory_pressure" | "linux_mem_available" | "free_memory";
  localModelProcessCount?: number;
  localModelRssBytes?: number;
  processRssBytes: number;
  processHeapUsedBytes: number;
  processHeapTotalBytes: number;
  eventLoopLagMs?: number;
  status: OperationsStatus;
};

export type OperationsHeartbeat = {
  enabled: boolean;
  every: string;
  everyMs: number | null;
  target: string;
  model?: string;
};

export type OperationsAgentSnapshot = {
  id: string;
  name?: string;
  workspace: string;
  duty: OperationsDuty;
  dutySource: "heartbeat" | "schedule" | "configuration";
  status: OperationsStatus;
  activityState: OperationsActivityState;
  healthState: OperationsHealthState;
  attentionState: OperationsAttentionState;
  model?: string;
  fallbackModels: string[];
  activeTaskCount: number;
  blockedTaskCount: number;
  latestTask?: string;
  latestActivityAt?: number;
  currentWork?: OperationsWorkSummary;
  lastActivity?: OperationsWorkSummary;
  heartbeat: OperationsHeartbeat;
  memoryBytes: number | null;
  memoryAttribution: "unavailable" | "process";
};

export type OperationsWorkSummary = {
  taskId: string;
  title: string;
  summary?: string;
  updatedAt: number;
  outcome: "active" | "succeeded" | "blocked" | "failed" | "cancelled" | "unknown";
};

export type OperationsWorkflowSnapshot = {
  id: string;
  title: string;
  ownerKey: string;
  controllerId?: string;
  status: OperationsStatus;
  sourceStatus: string;
  currentStep?: string;
  blocker?: string;
  hasWaitState: boolean;
  activeTaskCount: number;
  failedTaskCount: number;
  updatedAt: number;
};

export type OperationsTaskSnapshot = {
  id: string;
  title: string;
  runtime: "subagent" | "acp" | "cli" | "cron";
  agentId?: string;
  parentFlowId?: string;
  status: OperationsStatus;
  sourceStatus: string;
  progress?: string;
  error?: string;
  updatedAt: number;
};

export type OperationsCronSnapshot = {
  id: string;
  name: string;
  agentId?: string;
  duty: OperationsDuty;
  status: OperationsStatus;
  enabled: boolean;
  running: boolean;
  nextRunAt?: number;
  lastRunAt?: number;
  lastRunStatus?: string;
  lastError?: string;
  consecutiveErrors: number;
};

export type OperationsCatalogEntry = {
  id: string;
  name: string;
  kind: "skill" | "plugin" | "tool" | "model";
  status: OperationsStatus;
  configured: boolean;
  active: boolean | null;
  source?: string;
  owner?: string;
  reason?: string;
  route?: "local" | "subscription" | "metered" | "unknown";
  availability: "available" | "unavailable" | "disabled" | "unverified";
};

export type OperationsCollectionCount = {
  total: number;
  shown: number;
  truncated: boolean;
  rejected?: number;
};

export type OperationsBriefing = {
  tone: "normal" | "attention" | "urgent" | "unknown";
  text: string;
};

export type OperationsActivityRollup = {
  key: string;
  runtime: OperationsTaskSnapshot["runtime"];
  sourceId: string;
  taskId?: string;
  title: string;
  count: number;
  latestAt: number;
  status: "working" | "succeeded" | "blocked" | "failed" | "cancelled" | "unknown";
  agentId?: string;
};

export type OperationsIncidentTransition = {
  at: number;
  from?: OperationsSeverity;
  to: OperationsSeverity;
};

export type OperationsIncidentHistoryEntry = {
  id: string;
  title: string;
  category: OperationsFinding["category"];
  severity: OperationsSeverity;
  disposition: OperationsFindingDisposition;
  responseState: OperationsFindingResponseState;
  firstObservedAt: number;
  lastObservedAt: number;
  resolvedAt?: number;
  transitions: OperationsIncidentTransition[];
};

export type OperationsProcessSnapshot = {
  pid: number;
  parentPid: number;
  command: string;
  rssBytes: number;
  cpuPercent: number;
  kind: "gateway" | "local_model" | "browser" | "other";
};

export type OperationsReconcilerSnapshot = {
  mode: "shadow" | "supervised";
  autoRemediationEnabled: boolean;
  intervalMs: number;
  lastAttemptAt: number | null;
  lastSweepAt: number | null;
  nextSweepAt: number | null;
  attemptCount: number;
  sweepCount: number;
  recommendedActionCount: number;
  ruleCount: number;
  note: string;
  lastError?: string;
};

export type OperationsActionKind =
  | "cron.run"
  | "cron.enable"
  | "cron.disable"
  | "remediation.apply"
  | "task.cancel"
  | "flow.cancel";

export type OperationsActionPreview = {
  token: string;
  action: OperationsActionKind;
  targetId: string;
  summary: string;
  risk: "low" | "medium" | "high";
  expiresAt: number;
  requiresConfirmation: true;
};

export type OperationsActionReceipt = {
  action: OperationsActionKind;
  targetId: string;
  status: "applied" | "rejected" | "failed";
  summary: string;
  appliedAt: number;
};

export type OperationsSnapshot = {
  schema: "openclaw.operations-room.v2";
  generatedAt: number;
  snapshotId: string;
  freshness: {
    status: "fresh" | "stale" | "unknown";
    observedAt: number;
    staleAfterMs: number;
    sources: Record<OperationsSourceName, OperationsSourceObservation>;
  };
  completeness: {
    status: "complete" | "partial";
    unavailableSources: OperationsSourceName[];
    fallbackSources: OperationsSourceName[];
  };
  briefing: OperationsBriefing;
  qualityTarget: 93;
  qualityScore: number;
  overallStatus: OperationsStatus;
  summary: {
    agents: number;
    workingAgents: number;
    attentionAgents: number;
    tasks: number;
    activeTasks: number;
    failedTasks: number;
    workflows: number;
    activeWorkflows: number;
    cronJobs: number;
    failingCronJobs: number;
    plugins: number;
    skills: number;
    tools: number;
    models: number;
    findings: number;
    actionableFindings: number;
    historicalFindings: number;
    needsUserFindings: number;
    handlingFindings: number;
    watchingFindings: number;
    criticalFindings: number;
  };
  collections: {
    agents: OperationsCollectionCount;
    tasks: OperationsCollectionCount;
    workflows: OperationsCollectionCount;
    cronJobs: OperationsCollectionCount;
    skills: OperationsCollectionCount;
    plugins: OperationsCollectionCount;
    tools: OperationsCollectionCount;
    models: OperationsCollectionCount;
    processes: OperationsCollectionCount;
    findings: OperationsCollectionCount;
    activityRollups: OperationsCollectionCount;
    incidentHistory: OperationsCollectionCount;
  };
  host: OperationsHostSnapshot;
  agents: OperationsAgentSnapshot[];
  tasks: OperationsTaskSnapshot[];
  workflows: OperationsWorkflowSnapshot[];
  cronJobs: OperationsCronSnapshot[];
  skills: OperationsCatalogEntry[];
  plugins: OperationsCatalogEntry[];
  tools: OperationsCatalogEntry[];
  models: OperationsCatalogEntry[];
  processes: OperationsProcessSnapshot[];
  findings: OperationsFinding[];
  activityRollups: OperationsActivityRollup[];
  incidentHistory: OperationsIncidentHistoryEntry[];
  remediationHistory?: OperationsRemediationRecord[];
  incidentLedger: {
    overflowCount: number;
  };
  reconciler: OperationsReconcilerSnapshot;
  controls: {
    mode: "guarded";
    previewRequired: true;
    supportedActions: OperationsActionKind[];
    note: string;
  };
};
