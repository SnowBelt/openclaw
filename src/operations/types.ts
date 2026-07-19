// Operations Room read models keep configured intent, observed runtime truth,
// and remediation policy separate so the dashboard never guesses that a
// configured capability is currently running.

export type OperationsSeverity = "info" | "warning" | "critical";
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
    | "resource"
    | "update";
  title: string;
  detail: string;
  entityId?: string;
  recommendedAction?: string;
  firstObservedAt?: number;
  lastObservedAt: number;
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
  status: OperationsStatus;
  model?: string;
  fallbackModels: string[];
  activeTaskCount: number;
  blockedTaskCount: number;
  latestTask?: string;
  latestActivityAt?: number;
  heartbeat: OperationsHeartbeat;
  memoryBytes: number | null;
  memoryAttribution: "unavailable" | "process";
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
  autoRemediationEnabled: false;
  intervalMs: number;
  lastSweepAt: number;
  nextSweepAt: number;
  recommendedActionCount: number;
  ruleCount: number;
  note: string;
};

export type OperationsActionKind =
  | "cron.run"
  | "cron.enable"
  | "cron.disable"
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
  schema: "openclaw.operations-room.v1";
  generatedAt: number;
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
    criticalFindings: number;
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
  reconciler: OperationsReconcilerSnapshot;
  controls: {
    mode: "guarded";
    previewRequired: true;
    supportedActions: OperationsActionKind[];
    note: string;
  };
};
