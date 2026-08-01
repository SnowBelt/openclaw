// Operations Room collector projects existing OpenClaw runtime sources into a
// bounded read model. It does not start models, invoke agents, or mutate config.
import { createHash } from "node:crypto";
import os from "node:os";
import { assertOperationsSnapshotV2Integrity } from "../../packages/gateway-protocol/src/operations-snapshot-integrity.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { ModelCatalogEntry } from "../agents/model-catalog.types.js";
import { listCoreToolSections } from "../agents/tool-catalog.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { CronServiceContract } from "../cron/service-contract.js";
import type { CronJob } from "../cron/types.js";
import type { GatewayEventLoopHealth } from "../gateway/server/event-loop-health.js";
import { listAgentsForGateway } from "../gateway/session-utils.js";
import { resolveHeartbeatSummaryForAgent } from "../infra/heartbeat-summary.js";
import { getPluginRegistryState } from "../plugins/runtime-state.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { buildWorkspaceSkillStatus } from "../skills/discovery/status.js";
import { getTaskRegistryRestoreFailure, listTaskRecords } from "../tasks/runtime-internal.js";
import type { TaskFlowRecord } from "../tasks/task-flow-registry.types.js";
import {
  getTaskFlowRegistryRestoreFailure,
  listTaskFlowRecords,
} from "../tasks/task-flow-runtime-internal.js";
import type { TaskRecord } from "../tasks/task-registry.types.js";
import {
  formatTaskStatusDetail,
  formatTaskStatusTitle,
  formatTaskStatusTitleText,
  sanitizeTaskStatusText,
} from "../tasks/task-status.js";
import { collectOperationsHostMemory } from "./host-memory-probe.js";
import {
  reconcileOperationsIncidentLedger,
  type OperationsIncidentLedgerOptions,
} from "./incident-ledger.js";
import { deriveOperationsMonitorHealth } from "./monitor-health.js";
import {
  getOperationsShadowMonitorState,
  OPERATIONS_SHADOW_INTERVAL_MS,
  type OperationsShadowMonitorState,
} from "./monitor-state.js";
import {
  collectOperationsProcessesResult,
  type OperationsProcessCollectionResult,
} from "./process-probe.js";
import { loadOperationsRemediationRecords } from "./remediation-store.js";
import {
  buildDeterministicOperationsBriefing,
  capOperationsRows,
  deriveOperationsAgentStates,
  operationsCollectionCount,
  operationsFindingSeverityForWorkflow,
  operationsStatusForFindings,
  operationsStatusForTask,
  operationsStatusForWorkflow,
  OPERATIONS_SNAPSHOT_STALE_AFTER_MS,
  scoreOperationsFindings,
} from "./status.js";
import type {
  OperationsActivityRollup,
  OperationsAgentSnapshot,
  OperationsCatalogEntry,
  OperationsCronSnapshot,
  OperationsFinding,
  OperationsFindingDisposition,
  OperationsFindingResponseState,
  OperationsHealthState,
  OperationsIncidentHistoryEntry,
  OperationsRemediationRecord,
  OperationsSnapshot,
  OperationsSourceName,
  OperationsSourceObservation,
  OperationsStatus,
  OperationsTaskSnapshot,
  OperationsWorkflowSnapshot,
  OperationsWorkSummary,
} from "./types.js";

const QUALITY_TARGET = 93 as const;
const STALE_TASK_WARNING_MS = 2 * 60 * 60 * 1_000;
const RECENT_AGENT_FAILURE_MS = 24 * 60 * 60 * 1_000;
const FINDING_LEDGER_INPUT_LIMIT = 500;
const ROW_LIMITS = {
  agents: 500,
  tasks: 200,
  workflows: 200,
  cronJobs: 500,
  skills: 200,
  plugins: 200,
  tools: 200,
  models: 200,
  findings: 200,
  rollups: 200,
} as const;

export type OperationsActiveRun = {
  runId: string;
  sessionKey?: string;
  agentId?: string;
  startedAtMs: number;
};

function compareFindingPriority(left: OperationsFinding, right: OperationsFinding): number {
  const severityRank = { critical: 0, warning: 1, info: 2 } as const;
  const dispositionRank = { needs_user: 0, handling: 1, watching: 2, historical: 3 } as const;
  return (
    severityRank[left.severity] - severityRank[right.severity] ||
    dispositionRank[left.disposition] - dispositionRank[right.disposition] ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function compareAgentPriority(
  left: OperationsAgentSnapshot,
  right: OperationsAgentSnapshot,
): number {
  const attentionRank = { urgent: 0, needs_user: 1, handling: 2, watching: 3, none: 4 } as const;
  const healthRank = { failed: 0, degraded: 1, unknown: 2, healthy: 3 } as const;
  const activityRank = {
    working: 0,
    waiting: 1,
    scheduled: 2,
    ready: 3,
    unknown: 4,
    off: 5,
  } as const;
  return (
    attentionRank[left.attentionState] - attentionRank[right.attentionState] ||
    healthRank[left.healthState] - healthRank[right.healthState] ||
    activityRank[left.activityState] - activityRank[right.activityState] ||
    (right.latestActivityAt ?? 0) - (left.latestActivityAt ?? 0) ||
    (left.name ?? left.id).localeCompare(right.name ?? right.id, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
}

type CatalogRows = Pick<OperationsSnapshot, "skills" | "plugins" | "tools" | "models">;
type CapabilityRows = Omit<CatalogRows, "models"> & { pluginRegistryAvailable: boolean };

function readHostUptimeMs(): number | null {
  try {
    return Math.round(os.uptime() * 1_000);
  } catch {
    return null;
  }
}

function taskAgentId(task: TaskRecord): string | undefined {
  return (
    task.agentId ??
    parseAgentSessionKey(task.childSessionKey)?.agentId ??
    parseAgentSessionKey(task.requesterSessionKey)?.agentId ??
    parseAgentSessionKey(task.ownerKey)?.agentId
  );
}

function taskUpdatedAt(task: TaskRecord): number {
  return task.lastEventAt ?? task.endedAt ?? task.startedAt ?? task.createdAt;
}

function isRunningTask(task: TaskRecord): boolean {
  return task.status === "running";
}

function isQueuedTask(task: TaskRecord): boolean {
  return task.status === "queued";
}

function isRecentTaskFailure(task: TaskRecord, now: number): boolean {
  return (
    (task.status === "failed" || task.status === "timed_out" || task.status === "lost") &&
    now - taskUpdatedAt(task) <= RECENT_AGENT_FAILURE_MS
  );
}

function isBlockedTask(task: TaskRecord, now: number): boolean {
  return (
    !isRunningTask(task) &&
    !isQueuedTask(task) &&
    task.terminalOutcome === "blocked" &&
    now - taskUpdatedAt(task) <= RECENT_AGENT_FAILURE_MS
  );
}

function taskOutcome(task: TaskRecord): OperationsWorkSummary["outcome"] {
  if (task.status === "running") {
    return "active";
  }
  if (task.terminalOutcome === "blocked") {
    return "blocked";
  }
  switch (task.status) {
    case "succeeded":
      return "succeeded";
    case "failed":
    case "timed_out":
    case "lost":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function taskSummary(task: TaskRecord): OperationsWorkSummary {
  const summary = formatTaskStatusDetail(task);
  return {
    taskId: task.taskId,
    title: formatTaskStatusTitle(task),
    ...(summary ? { summary } : {}),
    updatedAt: taskUpdatedAt(task),
    outcome: taskOutcome(task),
  };
}

function legacyAgentStatus(params: {
  activityState: OperationsAgentSnapshot["activityState"];
  healthState: OperationsHealthState;
}): OperationsStatus {
  if (params.healthState === "failed") {
    return "failed";
  }
  if (params.healthState === "degraded") {
    return "degraded";
  }
  switch (params.activityState) {
    case "working":
      return "working";
    case "off":
      return "disabled";
    case "unknown":
      return "unknown";
    default:
      return "idle";
  }
}

function cronStatus(job: CronJob): OperationsStatus {
  if (!job.enabled) {
    return "disabled";
  }
  const lastStatus = job.state.lastRunStatus ?? job.state.lastStatus;
  if (lastStatus === "error") {
    return job.state.consecutiveErrors && job.state.consecutiveErrors >= 3 ? "failed" : "degraded";
  }
  if (job.state.runningAtMs) {
    return "working";
  }
  return "healthy";
}

function hasMissingRequirements(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.values(value).some((entry) => Array.isArray(entry) && entry.length > 0);
}

function finding(
  params: Omit<OperationsFinding, "firstObservedAt" | "lastObservedAt"> & {
    disposition: OperationsFindingDisposition;
    responseState: OperationsFindingResponseState;
  },
  now: number,
): OperationsFinding {
  return { ...params, firstObservedAt: now, lastObservedAt: now };
}

function sanitizeDisplayText(value: unknown, maxChars: number, fallback: string): string {
  return sanitizeTaskStatusText(value, { maxChars }) || fallback;
}

export function buildCronRows(jobs: readonly CronJob[]): OperationsCronSnapshot[] {
  const rows: OperationsCronSnapshot[] = [];
  for (const job of jobs) {
    const row: OperationsCronSnapshot = {
      id: job.id,
      name: formatTaskStatusTitleText(job.displayName ?? job.name, "Scheduled work"),
      duty: job.enabled ? "scheduled" : "disabled",
      status: cronStatus(job),
      enabled: job.enabled,
      running: Boolean(job.state.runningAtMs),
      consecutiveErrors: job.state.consecutiveErrors ?? 0,
    };
    if (job.agentId) {
      row.agentId = job.agentId;
    }
    if (job.state.nextRunAtMs) {
      row.nextRunAt = job.state.nextRunAtMs;
    }
    if (job.state.lastRunAtMs) {
      row.lastRunAt = job.state.lastRunAtMs;
    }
    const lastRunStatus = job.state.lastRunStatus ?? job.state.lastStatus;
    if (lastRunStatus) {
      row.lastRunStatus = lastRunStatus;
    }
    const lastError = sanitizeTaskStatusText(job.state.lastError, {
      errorContext: true,
      maxChars: 120,
    });
    if (lastError) {
      row.lastError = lastError;
    }
    rows.push(row);
  }
  return rows.toSorted(
    (left, right) =>
      Number(right.status === "failed") - Number(left.status === "failed") ||
      Number(right.status === "degraded") - Number(left.status === "degraded") ||
      Number(right.running) - Number(left.running) ||
      left.name.localeCompare(right.name),
  );
}

function buildAgentRows(params: {
  cfg: OpenClawConfig;
  modelCatalog: ModelCatalogEntry[];
  tasks: TaskRecord[];
  activeRuns: OperationsActiveRun[];
  cronJobs: OperationsCronSnapshot[];
  now: number;
  taskSourceAvailable: boolean;
}): OperationsAgentSnapshot[] {
  const agents = listAgentsForGateway(params.cfg, params.modelCatalog).agents;
  const defaultAgentId = resolveDefaultAgentId(params.cfg);
  const tasksByAgent = new Map<string, TaskRecord[]>();
  for (const task of params.tasks) {
    const agentId = taskAgentId(task);
    if (!agentId) {
      continue;
    }
    const agentTasks = tasksByAgent.get(agentId);
    if (agentTasks) {
      agentTasks.push(task);
    } else {
      tasksByAgent.set(agentId, [task]);
    }
  }
  const runningTaskRunIds = new Set(
    params.tasks
      .filter(isRunningTask)
      .map((task) => task.runId)
      .filter((runId): runId is string => Boolean(runId)),
  );
  const activeRunsByAgent = new Map<string, OperationsActiveRun[]>();
  for (const run of params.activeRuns) {
    if (runningTaskRunIds.has(run.runId)) {
      continue;
    }
    const agentId =
      run.agentId ?? (run.sessionKey ? parseAgentSessionKey(run.sessionKey)?.agentId : undefined);
    const resolvedAgentId = agentId ?? defaultAgentId;
    const agentRuns = activeRunsByAgent.get(resolvedAgentId);
    if (agentRuns) {
      agentRuns.push(run);
    } else {
      activeRunsByAgent.set(resolvedAgentId, [run]);
    }
  }
  const cronByAgent = new Map<string, OperationsCronSnapshot[]>();
  for (const job of params.cronJobs) {
    if (!job.agentId) {
      continue;
    }
    const jobs = cronByAgent.get(job.agentId);
    if (jobs) {
      jobs.push(job);
    } else {
      cronByAgent.set(job.agentId, [job]);
    }
  }

  const rows: OperationsAgentSnapshot[] = [];
  for (const agent of agents) {
    const agentTasks = (tasksByAgent.get(agent.id) ?? []).toSorted(
      (left, right) => taskUpdatedAt(right) - taskUpdatedAt(left),
    );
    const runningTasks = agentTasks.filter(isRunningTask);
    const activeRuns = (activeRunsByAgent.get(agent.id) ?? []).toSorted(
      (left, right) =>
        right.startedAtMs - left.startedAtMs || left.runId.localeCompare(right.runId),
    );
    const queuedTasks = agentTasks.filter(isQueuedTask);
    const blockedTasks = agentTasks.filter((task) => isBlockedTask(task, params.now));
    const recentFailures = agentTasks.filter(
      (task) => isRecentTaskFailure(task, params.now) && !isBlockedTask(task, params.now),
    );
    const heartbeat = resolveHeartbeatSummaryForAgent(params.cfg, agent.id);
    const agentCronJobs = cronByAgent.get(agent.id) ?? [];
    const hasEnabledSchedule = agentCronJobs.some((job) => job.enabled);
    const duty = heartbeat.enabled ? "always_on" : hasEnabledSchedule ? "scheduled" : "on_demand";
    const dutySource = heartbeat.enabled
      ? "heartbeat"
      : hasEnabledSchedule
        ? "schedule"
        : "configuration";
    const states = deriveOperationsAgentStates({
      duty,
      runningTaskCount: runningTasks.length + activeRuns.length,
      queuedTaskCount: queuedTasks.length,
      blockedTaskCount: blockedTasks.length,
      recentFailureCount: recentFailures.length,
      sourceAvailable: params.taskSourceAvailable,
    });
    const assignedCronFailed = agentCronJobs.some((job) => job.status === "failed");
    const assignedCronDegraded = agentCronJobs.some((job) => job.status === "degraded");
    const assignedCronRetrying = agentCronJobs.some(
      (job) => job.running && (job.status === "failed" || job.status === "degraded"),
    );
    if (assignedCronFailed) {
      states.healthState = "failed";
      states.attentionState = assignedCronRetrying ? "handling" : "urgent";
    } else if (assignedCronDegraded && states.attentionState === "none") {
      states.healthState = "degraded";
      states.attentionState = assignedCronRetrying ? "handling" : "watching";
    }

    const row: OperationsAgentSnapshot = {
      id: agent.id,
      workspace: agent.workspace ?? resolveAgentWorkspaceDir(params.cfg, agent.id),
      duty,
      dutySource,
      status: legacyAgentStatus(states),
      activityState: states.activityState,
      healthState: states.healthState,
      attentionState: states.attentionState,
      fallbackModels: agent.model?.fallbacks ?? [],
      activeTaskCount: runningTasks.length + queuedTasks.length,
      blockedTaskCount: blockedTasks.length,
      heartbeat: {
        enabled: heartbeat.enabled,
        every: heartbeat.every,
        everyMs: heartbeat.everyMs,
        target: heartbeat.target,
      },
      memoryBytes: null,
      memoryAttribution: "unavailable",
    };
    const agentName = sanitizeTaskStatusText(agent.name ?? agent.identity?.name, { maxChars: 80 });
    if (agentName) {
      row.name = agentName;
    }
    if (agent.model?.primary) {
      row.model = agent.model.primary;
    }
    const latestTask = agentTasks[0];
    if (latestTask) {
      row.latestTask = formatTaskStatusTitle(latestTask);
      row.latestActivityAt = taskUpdatedAt(latestTask);
    }
    const currentTask = runningTasks[0];
    if (currentTask) {
      row.currentWork = taskSummary(currentTask);
    } else if (activeRuns[0]) {
      row.currentWork = {
        taskId: `run:${activeRuns[0].runId}`,
        title: "Active conversation",
        summary: "The agent is responding in an active OpenClaw session.",
        updatedAt: activeRuns[0].startedAtMs,
        outcome: "active",
      };
    }
    const lastTask = agentTasks.find((task) => !isRunningTask(task) && !isQueuedTask(task));
    if (lastTask) {
      row.lastActivity = taskSummary(lastTask);
    }
    if (heartbeat.model) {
      row.heartbeat.model = heartbeat.model;
    }
    rows.push(row);
  }
  return rows;
}

export function buildOperationsWorkflowRows(
  tasks: TaskRecord[],
  flows: TaskFlowRecord[],
  now: number,
): OperationsWorkflowSnapshot[] {
  const taskCountsByFlow = new Map<string, { active: number; running: number; failed: number }>();
  for (const task of tasks) {
    if (!task.parentFlowId) {
      continue;
    }
    const counts = taskCountsByFlow.get(task.parentFlowId) ?? {
      active: 0,
      running: 0,
      failed: 0,
    };
    if (task.status === "running" || task.status === "queued") {
      counts.active += 1;
    }
    if (task.status === "running") {
      counts.running += 1;
    }
    if (task.status === "failed" || task.status === "timed_out" || task.status === "lost") {
      counts.failed += 1;
    }
    taskCountsByFlow.set(task.parentFlowId, counts);
  }

  const rows: OperationsWorkflowSnapshot[] = [];
  for (const flow of flows) {
    const counts = taskCountsByFlow.get(flow.flowId) ?? { active: 0, running: 0, failed: 0 };
    const hasWaitState = flow.status === "waiting" || flow.waitJson != null;
    const hasObservedActiveOwner = counts.running > 0 || hasWaitState;
    const derivedStatus = operationsStatusForWorkflow(flow.status, flow.updatedAt, now);
    const row: OperationsWorkflowSnapshot = {
      id: flow.flowId,
      title: formatTaskStatusTitleText(flow.goal, "Managed workflow"),
      ownerKey: flow.ownerKey,
      status: flow.status === "running" && !hasObservedActiveOwner ? "unknown" : derivedStatus,
      sourceStatus: flow.status,
      hasWaitState,
      activeTaskCount: counts.active,
      failedTaskCount: counts.failed,
      updatedAt: flow.updatedAt,
    };
    if (flow.controllerId) {
      row.controllerId = flow.controllerId;
    }
    const currentStep = sanitizeTaskStatusText(flow.currentStep, { maxChars: 120 });
    if (currentStep) {
      row.currentStep = currentStep;
    }
    const blocker = sanitizeTaskStatusText(flow.blockedSummary, {
      errorContext: true,
      maxChars: 120,
    });
    if (blocker) {
      row.blocker = blocker;
    }
    rows.push(row);
  }
  return rows.toSorted((left, right) => right.updatedAt - left.updatedAt);
}

function buildTaskRows(tasks: TaskRecord[]): OperationsTaskSnapshot[] {
  const rows: OperationsTaskSnapshot[] = [];
  for (const task of tasks) {
    const row: OperationsTaskSnapshot = {
      id: task.taskId,
      title: formatTaskStatusTitle(task),
      runtime: task.runtime,
      status: operationsStatusForTask(task.status, task.terminalOutcome),
      sourceStatus: task.status,
      updatedAt: taskUpdatedAt(task),
    };
    const agentId = taskAgentId(task);
    if (agentId) {
      row.agentId = agentId;
    }
    if (task.parentFlowId) {
      row.parentFlowId = task.parentFlowId;
    }
    const progress = formatTaskStatusDetail(task);
    if (progress) {
      row.progress = progress;
    }
    const error = sanitizeTaskStatusText(task.error, {
      errorContext: true,
      maxChars: 120,
    });
    if (error) {
      row.error = error;
    }
    rows.push(row);
  }
  return rows.toSorted((left, right) => {
    const activeRank = (row: OperationsTaskSnapshot) => (row.status === "working" ? 1 : 0);
    return activeRank(right) - activeRank(left) || right.updatedAt - left.updatedAt;
  });
}

function buildActivityRollups(tasks: TaskRecord[]): OperationsActivityRollup[] {
  const grouped = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    const sourceId = task.sourceId?.trim();
    if (!sourceId) {
      continue;
    }
    const key = `${task.runtime}:${sourceId}`;
    const entries = grouped.get(key);
    if (entries) {
      entries.push(task);
    } else {
      grouped.set(key, [task]);
    }
  }
  const rows: OperationsActivityRollup[] = [];
  for (const [key, entries] of grouped) {
    const sorted = entries.toSorted((left, right) => taskUpdatedAt(right) - taskUpdatedAt(left));
    const latest = sorted[0];
    if (!latest) {
      continue;
    }
    const outcome = taskOutcome(latest);
    rows.push({
      key: sanitizeDisplayText(key, 320, `${latest.runtime}:work`),
      runtime: latest.runtime,
      sourceId: sanitizeDisplayText(latest.sourceId, 256, "work"),
      taskId: latest.taskId,
      title: formatTaskStatusTitle(latest),
      count: entries.length,
      latestAt: taskUpdatedAt(latest),
      status: outcome === "active" ? "working" : outcome,
      ...(taskAgentId(latest) ? { agentId: taskAgentId(latest) } : {}),
    });
  }
  return rows.toSorted((left, right) => {
    const workingRank = (row: OperationsActivityRollup) => (row.status === "working" ? 1 : 0);
    return workingRank(right) - workingRank(left) || right.latestAt - left.latestAt;
  });
}

function capActivityRollups(
  rows: readonly OperationsActivityRollup[],
  max: number,
): OperationsActivityRollup[] {
  if (rows.length <= max) {
    return [...rows];
  }
  const working = rows.filter((row) => row.status === "working");
  const terminal = rows.filter((row) => row.status !== "working");
  const reserved = Math.floor(max / 2);
  const selected = [...working.slice(0, reserved), ...terminal.slice(0, reserved)];
  const selectedKeys = new Set(selected.map((row) => row.key));
  const remainder = rows.filter((row) => !selectedKeys.has(row.key));
  return [...selected, ...remainder.slice(0, max - selected.length)].toSorted((left, right) => {
    const workingRank = (row: OperationsActivityRollup) => (row.status === "working" ? 1 : 0);
    return workingRank(right) - workingRank(left) || right.latestAt - left.latestAt;
  });
}

function buildCapabilities(params: { cfg: OpenClawConfig }): CapabilityRows {
  const defaultAgentId = resolveDefaultAgentId(params.cfg);
  const workspace = resolveAgentWorkspaceDir(params.cfg, defaultAgentId);
  const skillReport = buildWorkspaceSkillStatus(workspace, {
    config: params.cfg,
    agentId: defaultAgentId,
  });
  const skills: OperationsCatalogEntry[] = [];
  for (const skill of skillReport.skills) {
    const availability = skill.disabled ? "disabled" : skill.eligible ? "available" : "unavailable";
    const row: OperationsCatalogEntry = {
      id: skill.skillKey,
      name: skill.name,
      kind: "skill",
      status: skill.disabled
        ? "disabled"
        : skill.eligible
          ? "unknown"
          : skill.platformIncompatible
            ? "disabled"
            : "blocked",
      configured: true,
      active: null,
      availability,
      source: skill.source,
    };
    if (!skill.eligible && !skill.disabled && !skill.platformIncompatible) {
      row.reason = hasMissingRequirements(skill.missing) ? "Missing requirements" : "Unavailable";
    }
    skills.push(row);
  }

  const registry = getPluginRegistryState()?.activeRegistry;
  const plugins: OperationsCatalogEntry[] = [];
  for (const plugin of registry?.plugins ?? []) {
    const availability =
      plugin.status === "loaded"
        ? "available"
        : plugin.status === "disabled"
          ? "disabled"
          : "unavailable";
    const row: OperationsCatalogEntry = {
      id: plugin.id,
      name: plugin.name,
      kind: "plugin",
      status:
        plugin.status === "loaded"
          ? "healthy"
          : plugin.status === "disabled"
            ? "disabled"
            : "failed",
      configured: plugin.enabled,
      active: plugin.status === "loaded",
      availability,
      source: plugin.source,
    };
    const reason = sanitizeTaskStatusText(plugin.error, { errorContext: true, maxChars: 120 });
    if (reason) {
      row.reason = reason;
    }
    plugins.push(row);
  }

  const coreTools = listCoreToolSections().flatMap((section) =>
    section.tools.map(
      (tool) =>
        ({
          id: tool.id,
          name: tool.label,
          kind: "tool",
          status: "unknown",
          configured: true,
          active: null,
          availability: "unverified",
          source: `core:${section.id}`,
          reason: "Catalogued by the core tool profile; runtime availability was not probed.",
        }) satisfies OperationsCatalogEntry,
    ),
  );
  const pluginTools = (registry?.tools ?? []).flatMap((registration) =>
    (registration.names.length > 0 ? registration.names : (registration.declaredNames ?? [])).map(
      (name) => {
        const registered = registration.names.includes(name);
        return {
          id: `${registration.pluginId}:${name}`,
          name,
          kind: "tool",
          status: registered ? "healthy" : "unknown",
          configured: true,
          active: registered,
          availability: registered ? "available" : "unverified",
          source: `plugin:${registration.pluginId}`,
          owner: registration.pluginId,
        } satisfies OperationsCatalogEntry;
      },
    ),
  );

  return {
    skills: skills.toSorted((a, b) => a.name.localeCompare(b.name)),
    plugins: plugins.toSorted((a, b) => a.name.localeCompare(b.name)),
    tools: [...coreTools, ...pluginTools].toSorted((a, b) => a.name.localeCompare(b.name)),
    pluginRegistryAvailable: registry != null,
  };
}

function configuredModelRefs(
  cfg: OpenClawConfig,
  agents: readonly OperationsAgentSnapshot[],
): Set<string> {
  const refs = new Set<string>();
  for (const agent of agents) {
    if (agent.model) {
      refs.add(agent.model);
    }
    for (const fallback of agent.fallbackModels) {
      refs.add(fallback);
    }
  }
  for (const [providerId, provider] of Object.entries(cfg.models?.providers ?? {})) {
    for (const model of provider.models ?? []) {
      refs.add(`${providerId}/${model.id}`);
    }
  }
  return refs;
}

function buildModels(
  modelCatalog: ModelCatalogEntry[],
  configuredRefs: ReadonlySet<string>,
): OperationsCatalogEntry[] {
  return modelCatalog
    .map((model) => {
      const certification = model.certification ?? "unlisted";
      return {
        id: `${model.provider}/${model.id}`,
        name: model.name || model.id,
        kind: "model",
        status: "unknown",
        configured: configuredRefs.has(`${model.provider}/${model.id}`),
        active: null,
        availability: "unverified",
        source: model.provider,
        route: model.route ?? "unknown",
        reason: `Catalog certification: ${certification}; runtime availability was not probed.`,
      } satisfies OperationsCatalogEntry;
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export function buildOperationsFindings(params: {
  now: number;
  hostMemoryUsedPercent: number;
  eventLoop?: GatewayEventLoopHealth;
  tasks: TaskRecord[];
  taskSourceAvailable: boolean;
  workflows: OperationsWorkflowSnapshot[];
  workflowSourceAvailable: boolean;
  cronJobs: OperationsCronSnapshot[];
  scheduleSourceAvailable: boolean;
  catalogs: Pick<CatalogRows, "skills" | "plugins">;
  skillSourceAvailable: boolean;
  pluginSourceAvailable: boolean;
}): OperationsFinding[] {
  const findings: OperationsFinding[] = [];
  if (params.hostMemoryUsedPercent >= 90) {
    findings.push(
      finding(
        {
          id: "resource:memory:critical",
          severity: "critical",
          category: "resource",
          title: "Memory pressure is critical",
          detail: `Host memory pressure is ${params.hostMemoryUsedPercent.toFixed(1)}%.`,
          disposition: "needs_user",
          responseState: "waiting_for_user",
          impact: "New local work can fail or make the Gateway unresponsive.",
          ownerId: "operator",
          recommendedAction: "Pause new local model work and inspect the largest processes.",
          nextAction: "Pause new local model work and inspect the largest processes.",
        },
        params.now,
      ),
    );
  } else if (params.hostMemoryUsedPercent >= 80) {
    findings.push(
      finding(
        {
          id: "resource:memory:warning",
          severity: "warning",
          category: "resource",
          title: "Memory pressure is elevated",
          detail: `Host memory pressure is ${params.hostMemoryUsedPercent.toFixed(1)}%.`,
          disposition: "watching",
          responseState: "monitoring",
          impact: "Starting another large local model could reduce responsiveness.",
          ownerId: "OpenClaw",
          recommendedAction: "Avoid starting another large local model until memory recovers.",
          nextAction: "Continue monitoring host memory before starting more local work.",
          nextCheckAt: params.now + 60_000,
        },
        params.now,
      ),
    );
  }
  if (params.eventLoop?.degraded) {
    findings.push(
      finding(
        {
          id: "process:gateway:event-loop",
          severity: "warning",
          category: "process",
          title: "Gateway response delay is elevated",
          detail: `P99 delay ${params.eventLoop.delayP99Ms} ms.`,
          disposition: "watching",
          responseState: "monitoring",
          impact: "Dashboard updates and agent coordination may feel delayed.",
          ownerId: "OpenClaw",
          recommendedAction: "Inspect CPU pressure and long-running synchronous work.",
          nextAction: "Recheck Gateway response delay after the current work settles.",
          nextCheckAt: params.now + 60_000,
        },
        params.now,
      ),
    );
  }
  if (params.taskSourceAvailable) {
    for (const task of params.tasks) {
      const lastAt = taskUpdatedAt(task);
      if (task.status === "running" && params.now - lastAt >= STALE_TASK_WARNING_MS) {
        const title = formatTaskStatusTitle(task);
        findings.push(
          finding(
            {
              id: `task:${task.taskId}:stale`,
              severity: "warning",
              category: "workflow",
              entityId: task.taskId,
              title: "Task may be stalled",
              detail: `${title} has no recorded progress for at least two hours.`,
              disposition: "needs_user",
              responseState: "waiting_for_user",
              impact: "Dependent work may be waiting for a task that is no longer progressing.",
              ownerId: taskAgentId(task) ?? "operator",
              lastProgressAt: lastAt,
              recommendedAction: "Inspect the task before cancelling it.",
              nextAction: "Inspect the task and decide whether it should continue.",
            },
            params.now,
          ),
        );
      }
    }
  }
  if (params.workflowSourceAvailable) {
    const staleQueuedWorkflows = params.workflows.filter(
      (entry) => entry.sourceStatus === "queued" && entry.status === "degraded",
    );
    if (staleQueuedWorkflows.length > 0) {
      findings.push(
        finding(
          {
            id: "workflow:queued:stale",
            severity: "warning",
            category: "workflow",
            title: `${staleQueuedWorkflows.length} queued workflows need review`,
            detail: "These workflows have not changed for at least 24 hours.",
            disposition: "needs_user",
            responseState: "waiting_for_user",
            impact: "Intended work may be stuck in the queue or obsolete work may remain pending.",
            ownerId: "operator",
            recommendedAction: "Review the queued workflow backlog.",
            nextAction: "Cancel only work that is no longer intended.",
          },
          params.now,
        ),
      );
    }
    for (const flow of params.workflows) {
      if (flow.sourceStatus === "running" && flow.status === "unknown" && !flow.hasWaitState) {
        findings.push(
          finding(
            {
              id: `workflow:${flow.id}:progress-unverified`,
              severity: "warning",
              category: "workflow",
              entityId: flow.id,
              title: "Running workflow progress is unverified",
              detail: `${flow.title} is marked running without a running task or wait state. A stored controller identifier does not prove live ownership.`,
              disposition: "needs_user",
              responseState: "waiting_for_user",
              impact: "The dashboard cannot truthfully confirm that this workflow is progressing.",
              ownerId: flow.controllerId ?? "operator",
              recommendedAction: "Inspect controller liveness and task links.",
              nextAction: "Restore live ownership or move the workflow to its truthful state.",
            },
            params.now,
          ),
        );
      }
    }
    for (const flow of params.workflows.filter((entry) =>
      ["blocked", "failed", "lost"].includes(entry.sourceStatus),
    )) {
      const severity = operationsFindingSeverityForWorkflow(
        flow.sourceStatus,
        flow.updatedAt,
        params.now,
      );
      if (!severity) {
        continue;
      }
      const historical = severity === "info";
      const ownerId =
        parseAgentSessionKey(flow.ownerKey)?.agentId ?? flow.controllerId ?? "operator";
      findings.push(
        finding(
          {
            id: `workflow:${flow.id}:${flow.sourceStatus}`,
            severity,
            category: "workflow",
            entityId: flow.id,
            title: historical
              ? "Historical workflow failure"
              : flow.status === "failed"
                ? "Workflow failed recently"
                : "Workflow is blocked",
            detail: flow.blocker ?? flow.title,
            disposition: historical ? "historical" : "needs_user",
            responseState: historical ? "resolved" : "waiting_for_user",
            impact: historical
              ? "This outcome is retained for context and is not a current incident."
              : "The workflow cannot reach its intended outcome without intervention.",
            ownerId,
            ...(historical
              ? {}
              : {
                  recommendedAction: "Open the workflow inspector and resolve its blocker.",
                  nextAction: "Review the recorded blocker and choose the recovery action.",
                }),
          },
          params.now,
        ),
      );
    }
  }
  if (params.scheduleSourceAvailable) {
    for (const job of params.cronJobs.filter(
      (entry) => entry.status === "degraded" || entry.status === "failed",
    )) {
      const critical = job.status === "failed";
      const handling = job.running;
      const remediationTask = params.tasks.find(
        (task) => task.runtime === "cron" && task.sourceId === job.id && task.status === "running",
      );
      findings.push(
        finding(
          {
            id: `cron:${job.id}:failure`,
            severity: critical ? "critical" : "warning",
            category: "cron",
            entityId: job.id,
            title: `Scheduled work ${job.name} is failing`,
            detail: job.lastError ?? `${job.consecutiveErrors} consecutive errors.`,
            disposition: handling ? "handling" : critical ? "needs_user" : "watching",
            responseState: handling ? "in_progress" : critical ? "waiting_for_user" : "monitoring",
            impact: "Future scheduled runs may not produce their intended result.",
            ownerId: handling ? (job.agentId ?? "OpenClaw") : (job.agentId ?? "operator"),
            ...(remediationTask ? { remediationTaskId: remediationTask.taskId } : {}),
            recommendedAction: "Inspect the last run before retrying it.",
            nextAction: handling
              ? "OpenClaw is running the next attempt; review its result before intervening."
              : critical
                ? "Fix the recorded error, then use guarded Run now."
                : "Watch the next run and intervene if the error repeats.",
            ...(handling || !critical ? { nextCheckAt: job.nextRunAt ?? params.now + 60_000 } : {}),
          },
          params.now,
        ),
      );
    }
  }
  if (params.pluginSourceAvailable) {
    for (const plugin of params.catalogs.plugins.filter((entry) => entry.status === "failed")) {
      findings.push(
        finding(
          {
            id: `plugin:${plugin.id}:failed`,
            severity: "critical",
            category: "plugin",
            entityId: plugin.id,
            title: `Plugin ${plugin.name} failed to load`,
            detail: plugin.reason ?? "The plugin registry reported an error.",
            disposition: "needs_user",
            responseState: "waiting_for_user",
            impact: "Capabilities owned by this plugin are unavailable.",
            ownerId: plugin.owner ?? "operator",
            recommendedAction: "Inspect plugin compatibility and configuration before restarting.",
            nextAction: "Repair the plugin or disable it intentionally, then verify startup.",
          },
          params.now,
        ),
      );
    }
  }
  if (params.skillSourceAvailable) {
    const blockedSkills = params.catalogs.skills.filter(
      (entry) => entry.availability === "unavailable",
    );
    if (blockedSkills.length > 0) {
      findings.push(
        finding(
          {
            id: "skill:requirements:blocked",
            severity: "warning",
            category: "skill",
            title: `${blockedSkills.length} skills need requirements`,
            detail: blockedSkills
              .slice(0, 5)
              .map((entry) => entry.name)
              .join(", "),
            disposition: "watching",
            responseState: "monitoring",
            impact: "Those optional skills cannot run until their requirements are available.",
            ownerId: "OpenClaw",
            recommendedAction: "Install only requirements needed for active work.",
            nextAction: "Continue monitoring until one of these skills is needed.",
          },
          params.now,
        ),
      );
    }
  }
  const rank = { critical: 2, warning: 1, info: 0 } as const;
  return findings.toSorted(
    (left, right) =>
      rank[right.severity] - rank[left.severity] || left.title.localeCompare(right.title),
  );
}

function sourceObservation(
  status: OperationsSourceObservation["status"],
  now: number,
): OperationsSourceObservation {
  return status === "omitted" || status === "unavailable"
    ? { status }
    : { status, observedAt: now };
}

function snapshotId(params: {
  now: number;
  agents: OperationsAgentSnapshot[];
  tasks: OperationsTaskSnapshot[];
  workflows: OperationsWorkflowSnapshot[];
  findings: OperationsFinding[];
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        at: params.now,
        agents: params.agents.map((entry) => [entry.id, entry.activityState, entry.healthState]),
        tasks: params.tasks.map((entry) => [entry.id, entry.sourceStatus, entry.updatedAt]),
        workflows: params.workflows.map((entry) => [entry.id, entry.sourceStatus, entry.updatedAt]),
        findings: params.findings.map((entry) => [entry.id, entry.severity, entry.disposition]),
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return `${params.now.toString(36)}-${digest}`;
}

export async function collectOperationsSnapshot(params: {
  cfg: OpenClawConfig;
  cron: CronServiceContract;
  modelCatalog?: ModelCatalogEntry[];
  modelCatalogAvailable?: boolean;
  eventLoop?: GatewayEventLoopHealth;
  now?: number;
  includeProcesses?: boolean;
  taskRecords?: TaskRecord[];
  flowRecords?: TaskFlowRecord[];
  activeRuns?: OperationsActiveRun[];
  processCollection?: OperationsProcessCollectionResult;
  monitorState?: OperationsShadowMonitorState;
  remediationRecords?: OperationsRemediationRecord[];
  incidentLedgerOptions?: OperationsIncidentLedgerOptions;
  pluginRegistryAvailable?: boolean;
}): Promise<OperationsSnapshot> {
  const now = params.now ?? Date.now();
  const modelCatalog = params.modelCatalog ?? [];
  const modelCatalogAvailable = params.modelCatalogAvailable !== false;

  const schedulePromise = params.cron
    .list({ includeDisabled: true })
    .then((jobs) => ({ jobs, available: true as const }))
    .catch(() => ({ jobs: [] as CronJob[], available: false as const }));
  const processPromise: Promise<OperationsProcessCollectionResult> =
    params.includeProcesses === false
      ? Promise.resolve({
          processes: [],
          total: 0,
          rejectedRows: 0,
          localModelProcessCount: 0,
          localModelRssBytes: 0,
          status: "available",
        })
      : params.processCollection
        ? Promise.resolve(params.processCollection)
        : collectOperationsProcessesResult();
  const [scheduleResult, processResult, hostMemory] = await Promise.all([
    schedulePromise,
    processPromise,
    collectOperationsHostMemory(),
  ]);

  let tasks: TaskRecord[] = [];
  let taskSourceAvailable = true;
  try {
    tasks = params.taskRecords ?? listTaskRecords();
    if (params.taskRecords === undefined && getTaskRegistryRestoreFailure()) {
      taskSourceAvailable = false;
    }
  } catch {
    taskSourceAvailable = false;
  }
  let flows: TaskFlowRecord[] = [];
  let flowSourceAvailable = true;
  try {
    flows = params.flowRecords ?? listTaskFlowRecords();
    if (params.flowRecords === undefined && getTaskFlowRegistryRestoreFailure()) {
      flowSourceAvailable = false;
    }
  } catch {
    flowSourceAvailable = false;
  }

  // A failed atomic restore may intentionally retain the previous in-memory
  // registry. Do not project those retained records as live operational proof.
  const observableTasks = taskSourceAvailable ? tasks : [];
  const observableFlows = flowSourceAvailable ? flows : [];

  const cronRows = buildCronRows(scheduleResult.jobs);
  const taskRows = buildTaskRows(observableTasks);
  const workflowRows = buildOperationsWorkflowRows(observableTasks, observableFlows, now);
  const rollupRows = buildActivityRollups(observableTasks);

  let agents: OperationsAgentSnapshot[] = [];
  let agentSourceAvailable = true;
  try {
    agents = buildAgentRows({
      cfg: params.cfg,
      modelCatalog,
      tasks: observableTasks,
      activeRuns: params.activeRuns ?? [],
      cronJobs: cronRows,
      now,
      taskSourceAvailable,
    });
  } catch {
    agentSourceAvailable = false;
  }

  let capabilities: CapabilityRows = {
    skills: [],
    plugins: [],
    tools: [],
    pluginRegistryAvailable: false,
  };
  let capabilitySourceAvailable = true;
  try {
    capabilities = buildCapabilities({ cfg: params.cfg });
    if (params.pluginRegistryAvailable !== undefined) {
      capabilities.pluginRegistryAvailable = params.pluginRegistryAvailable;
    }
  } catch {
    capabilitySourceAvailable = false;
  }
  const models = modelCatalogAvailable
    ? buildModels(modelCatalog, configuredModelRefs(params.cfg, agents))
    : [];
  const catalogs: CatalogRows = {
    skills: capabilities.skills,
    plugins: capabilities.plugins,
    tools: capabilities.tools,
    models,
  };

  const monitor = params.monitorState ?? getOperationsShadowMonitorState();
  const monitorHealth = deriveOperationsMonitorHealth(monitor, now);
  const rawFindings = [
    ...buildOperationsFindings({
      now,
      hostMemoryUsedPercent: hostMemory.memoryUsedPercent,
      eventLoop: params.eventLoop,
      tasks: observableTasks,
      taskSourceAvailable,
      workflows: workflowRows,
      workflowSourceAvailable: flowSourceAvailable,
      cronJobs: cronRows,
      scheduleSourceAvailable: scheduleResult.available,
      catalogs,
      skillSourceAvailable: capabilitySourceAvailable,
      pluginSourceAvailable: capabilitySourceAvailable && capabilities.pluginRegistryAvailable,
    }),
    ...(monitorHealth.finding ? [monitorHealth.finding] : []),
  ].toSorted(compareFindingPriority);

  let trackedFindings: OperationsFinding[] = rawFindings.map((entry) => ({
    ...entry,
    firstObservedAt: now,
    lastObservedAt: now,
  }));
  let incidentHistory: OperationsIncidentHistoryEntry[] = [];
  let incidentHistoryTotal = 0;
  let incidentOverflowCount = 0;
  let incidentLedgerAvailable = true;
  const authoritativeFindingCategories: OperationsFinding["category"][] = [];
  if (rawFindings.length <= FINDING_LEDGER_INPUT_LIMIT) {
    authoritativeFindingCategories.push("resource");
    if (agentSourceAvailable && taskSourceAvailable) {
      authoritativeFindingCategories.push("agent");
    }
    if (taskSourceAvailable && flowSourceAvailable) {
      authoritativeFindingCategories.push("workflow");
    }
    if (scheduleResult.available) {
      authoritativeFindingCategories.push("cron");
    }
    if (capabilitySourceAvailable) {
      authoritativeFindingCategories.push("skill", "tool");
    }
    if (capabilitySourceAvailable && capabilities.pluginRegistryAvailable) {
      authoritativeFindingCategories.push("plugin");
    }
    if (modelCatalogAvailable) {
      authoritativeFindingCategories.push("model");
    }
    if (params.eventLoop) {
      authoritativeFindingCategories.push("process");
    }
    if (monitorHealth.source.status === "available") {
      authoritativeFindingCategories.push("monitor");
    }
  }
  try {
    const ledger = reconcileOperationsIncidentLedger({
      findings: trackedFindings,
      now,
      authoritativeCategories: authoritativeFindingCategories,
      ...(params.incidentLedgerOptions ? { options: params.incidentLedgerOptions } : {}),
    });
    const stampedById = new Map(ledger.findings.map((entry) => [entry.id, entry]));
    const suppressedFindingIds = new Set(ledger.suppressedFindingIds);
    trackedFindings = [];
    for (const entry of rawFindings) {
      if (suppressedFindingIds.has(entry.id)) {
        continue;
      }
      const stamped = stampedById.get(entry.id);
      trackedFindings.push(
        stamped ?? {
          ...entry,
          firstObservedAt: entry.firstObservedAt ?? now,
          lastObservedAt: now,
        },
      );
    }
    const currentIds = new Set(trackedFindings.map((entry) => entry.id));
    for (const entry of ledger.carriedFindings) {
      if (!currentIds.has(entry.id)) {
        trackedFindings.push({ ...entry, evidenceState: "last_known" });
      }
    }
    incidentHistory = ledger.history;
    incidentHistoryTotal = ledger.historyTotal;
    incidentOverflowCount = ledger.overflowCount;
  } catch {
    incidentLedgerAvailable = false;
  }

  let remediationHistory: OperationsRemediationRecord[] = [];
  let remediationStoreAvailable = true;
  try {
    remediationHistory =
      params.remediationRecords === undefined
        ? loadOperationsRemediationRecords()
        : structuredClone(params.remediationRecords);
  } catch {
    remediationStoreAvailable = false;
  }
  const remediationByFinding = new Map(
    remediationHistory
      .toSorted((left, right) => right.updatedAt - left.updatedAt)
      .map((record) => [record.findingId, record]),
  );
  trackedFindings = trackedFindings.map((entry) => {
    const remediation = remediationByFinding.get(entry.id);
    if (!remediation) {
      return entry;
    }
    const active = ["eligible", "investigating", "reviewing", "applying", "verifying"].includes(
      remediation.status,
    );
    return {
      ...entry,
      remediation,
      ...(active
        ? {
            disposition: "handling" as const,
            responseState: "in_progress" as const,
            ownerId: "OpenClaw",
            lastProgressAt: remediation.updatedAt,
          }
        : {}),
    };
  });
  const trackedFindingIds = new Set(trackedFindings.map((entry) => entry.id));
  for (const remediation of remediationHistory) {
    if (
      trackedFindingIds.has(remediation.findingId) ||
      !["eligible", "investigating", "reviewing", "applying", "verifying"].includes(
        remediation.status,
      )
    ) {
      continue;
    }
    trackedFindings.push({
      id: remediation.findingId,
      severity:
        remediation.risk === "high"
          ? "critical"
          : remediation.risk === "medium"
            ? "warning"
            : "info",
      category: remediation.findingCategory,
      ...(remediation.findingEntityId ? { entityId: remediation.findingEntityId } : {}),
      title: remediation.findingTitle,
      detail: remediation.exactRepair,
      recommendedAction: remediation.exactRepair,
      firstObservedAt: remediation.startedAt,
      lastObservedAt: remediation.updatedAt,
      disposition: "handling",
      responseState: "in_progress",
      impact: remediation.impact,
      ownerId: "OpenClaw",
      nextAction: remediation.progress,
      lastProgressAt: remediation.updatedAt,
      remediation,
    });
  }

  const sourceStatuses: Record<OperationsSourceName, OperationsSourceObservation> = {
    agents: sourceObservation(
      !agentSourceAvailable ? "unavailable" : taskSourceAvailable ? "available" : "fallback",
      now,
    ),
    tasks: sourceObservation(taskSourceAvailable ? "available" : "unavailable", now),
    workflows: sourceObservation(
      !flowSourceAvailable ? "unavailable" : taskSourceAvailable ? "available" : "fallback",
      now,
    ),
    schedules: sourceObservation(scheduleResult.available ? "available" : "unavailable", now),
    capabilities: sourceObservation(
      !capabilitySourceAvailable
        ? "unavailable"
        : capabilities.pluginRegistryAvailable
          ? "available"
          : "fallback",
      now,
    ),
    models: sourceObservation(modelCatalogAvailable ? "available" : "unavailable", now),
    processes: sourceObservation(
      params.includeProcesses === false
        ? "omitted"
        : processResult.status === "available"
          ? "available"
          : processResult.status === "partial"
            ? "fallback"
            : "unavailable",
      now,
    ),
    event_loop: sourceObservation(params.eventLoop ? "available" : "unavailable", now),
    monitor: monitorHealth.source,
    incident_ledger: sourceObservation(incidentLedgerAvailable ? "available" : "unavailable", now),
  };
  const unavailableSources = (
    Object.entries(sourceStatuses) as Array<[OperationsSourceName, OperationsSourceObservation]>
  )
    .filter(
      ([, observation]) => observation.status === "unavailable" || observation.status === "stale",
    )
    .map(([source]) => source);
  const fallbackSources = (
    Object.entries(sourceStatuses) as Array<[OperationsSourceName, OperationsSourceObservation]>
  )
    .filter(([, observation]) => observation.status === "fallback")
    .map(([source]) => source);
  const partial = unavailableSources.length > 0 || fallbackSources.length > 0;

  const prioritizedAgents =
    agents.length > ROW_LIMITS.agents ? agents.toSorted(compareAgentPriority) : agents;
  const agentRows = capOperationsRows(prioritizedAgents, ROW_LIMITS.agents);
  const shownTaskRows = capOperationsRows(taskRows, ROW_LIMITS.tasks);
  const shownWorkflowRows = capOperationsRows(workflowRows, ROW_LIMITS.workflows);
  const shownCronRows = capOperationsRows(cronRows, ROW_LIMITS.cronJobs);
  const shownSkills = capOperationsRows(catalogs.skills, ROW_LIMITS.skills);
  const shownPlugins = capOperationsRows(catalogs.plugins, ROW_LIMITS.plugins);
  const shownTools = capOperationsRows(catalogs.tools, ROW_LIMITS.tools);
  const shownModels = capOperationsRows(catalogs.models, ROW_LIMITS.models);
  const shownFindings = capOperationsRows(
    trackedFindings.toSorted(compareFindingPriority),
    ROW_LIMITS.findings,
  );
  const shownRollups = capActivityRollups(rollupRows, ROW_LIMITS.rollups);
  const shownProcesses = capOperationsRows(processResult.processes, 30);

  const actionableFindings = trackedFindings.filter((entry) => entry.disposition !== "historical");
  const summary = {
    agents: agents.length,
    workingAgents: agents.filter((agent) => agent.activityState === "working").length,
    attentionAgents: agents.filter((agent) => agent.attentionState !== "none").length,
    tasks: taskRows.length,
    activeTasks: taskRows.filter((task) => task.status === "working").length,
    failedTasks: taskRows.filter(
      (task) =>
        (task.status === "failed" || task.status === "blocked") &&
        now - task.updatedAt <= RECENT_AGENT_FAILURE_MS,
    ).length,
    workflows: workflowRows.length,
    activeWorkflows: workflowRows.filter((flow) => flow.status === "working").length,
    cronJobs: cronRows.length,
    failingCronJobs: cronRows.filter((job) => job.status === "degraded" || job.status === "failed")
      .length,
    plugins: catalogs.plugins.length,
    skills: catalogs.skills.length,
    tools: catalogs.tools.length,
    models: catalogs.models.length,
    findings: trackedFindings.length,
    actionableFindings: actionableFindings.length,
    historicalFindings: trackedFindings.filter((entry) => entry.disposition === "historical")
      .length,
    needsUserFindings: trackedFindings.filter((entry) => entry.disposition === "needs_user").length,
    handlingFindings: trackedFindings.filter((entry) => entry.disposition === "handling").length,
    watchingFindings: trackedFindings.filter((entry) => entry.disposition === "watching").length,
    criticalFindings: actionableFindings.filter((entry) => entry.severity === "critical").length,
  };
  const processMemory = process.memoryUsage();
  const overallStatus = operationsStatusForFindings(trackedFindings, { partial });
  const qualityScore = partial
    ? Math.min(QUALITY_TARGET - 1, scoreOperationsFindings(trackedFindings))
    : scoreOperationsFindings(trackedFindings);

  const snapshot: OperationsSnapshot = {
    schema: "openclaw.operations-room.v2",
    generatedAt: now,
    snapshotId: snapshotId({
      now,
      agents: agentRows,
      tasks: shownTaskRows,
      workflows: shownWorkflowRows,
      findings: shownFindings,
    }),
    freshness: {
      status:
        partial && unavailableSources.length === Object.keys(sourceStatuses).length
          ? "unknown"
          : Object.values(sourceStatuses).some((source) => source.status === "stale")
            ? "stale"
            : "fresh",
      observedAt: now,
      staleAfterMs: OPERATIONS_SNAPSHOT_STALE_AFTER_MS,
      sources: sourceStatuses,
    },
    completeness: {
      status: partial ? "partial" : "complete",
      unavailableSources,
      fallbackSources,
    },
    briefing: buildDeterministicOperationsBriefing({
      partial,
      criticalFindings: summary.criticalFindings,
      needsUserFindings: summary.needsUserFindings,
      handlingFindings: summary.handlingFindings,
      watchingFindings: summary.watchingFindings,
      workingAgents: summary.workingAgents,
      activeTasks: summary.activeTasks,
      activeWorkflows: summary.activeWorkflows,
    }),
    qualityTarget: QUALITY_TARGET,
    qualityScore,
    overallStatus,
    summary,
    collections: {
      agents: operationsCollectionCount(agents.length, agentRows.length),
      tasks: operationsCollectionCount(taskRows.length, shownTaskRows.length),
      workflows: operationsCollectionCount(workflowRows.length, shownWorkflowRows.length),
      cronJobs: operationsCollectionCount(cronRows.length, shownCronRows.length),
      skills: operationsCollectionCount(catalogs.skills.length, shownSkills.length),
      plugins: operationsCollectionCount(catalogs.plugins.length, shownPlugins.length),
      tools: operationsCollectionCount(catalogs.tools.length, shownTools.length),
      models: operationsCollectionCount(catalogs.models.length, shownModels.length),
      processes: {
        ...operationsCollectionCount(processResult.total, shownProcesses.length),
        ...(processResult.rejectedRows > 0 ? { rejected: processResult.rejectedRows } : {}),
      },
      findings: operationsCollectionCount(trackedFindings.length, shownFindings.length),
      activityRollups: operationsCollectionCount(rollupRows.length, shownRollups.length),
      incidentHistory: operationsCollectionCount(incidentHistoryTotal, incidentHistory.length),
    },
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      uptimeMs: readHostUptimeMs(),
      logicalCpuCount: os.cpus().length,
      loadAverage: os.loadavg() as [number, number, number],
      totalMemoryBytes: hostMemory.totalMemoryBytes,
      freeMemoryBytes: hostMemory.freeMemoryBytes,
      availableMemoryBytes: hostMemory.availableMemoryBytes,
      usedMemoryBytes: hostMemory.usedMemoryBytes,
      memoryUsedPercent: hostMemory.memoryUsedPercent,
      memoryAvailabilitySource: hostMemory.availabilitySource,
      ...(params.includeProcesses === false
        ? {}
        : {
            localModelProcessCount: processResult.localModelProcessCount,
            localModelRssBytes: processResult.localModelRssBytes,
          }),
      processRssBytes: processMemory.rss,
      processHeapUsedBytes: processMemory.heapUsed,
      processHeapTotalBytes: processMemory.heapTotal,
      ...(params.eventLoop ? { eventLoopLagMs: params.eventLoop.delayP99Ms } : {}),
      status: !params.eventLoop
        ? "unknown"
        : hostMemory.memoryUsedPercent >= 80 || params.eventLoop.degraded
          ? "degraded"
          : "healthy",
    },
    agents: agentRows,
    tasks: shownTaskRows,
    workflows: shownWorkflowRows,
    cronJobs: shownCronRows,
    skills: shownSkills,
    plugins: shownPlugins,
    tools: shownTools,
    models: shownModels,
    processes: shownProcesses,
    findings: shownFindings,
    activityRollups: shownRollups,
    incidentHistory,
    remediationHistory: remediationHistory.slice(0, 50),
    incidentLedger: { overflowCount: incidentOverflowCount },
    reconciler: {
      mode:
        monitor.autoRemediationEnabled === true && remediationStoreAvailable
          ? "supervised"
          : "shadow",
      autoRemediationEnabled: monitor.autoRemediationEnabled === true && remediationStoreAvailable,
      intervalMs: monitor.intervalMs || OPERATIONS_SHADOW_INTERVAL_MS,
      lastAttemptAt: monitor.lastAttemptAt,
      lastSweepAt: monitor.lastSweepAt,
      nextSweepAt: monitor.nextSweepAt,
      attemptCount: monitor.attemptCount,
      sweepCount: monitor.sweepCount,
      recommendedActionCount: trackedFindings.filter((entry) => entry.recommendedAction).length,
      ruleCount: 10,
      note:
        monitor.running && monitor.autoRemediationEnabled === true && remediationStoreAvailable
          ? "Supervised remediation is active. Only approved, bounded, reversible recipes can run automatically."
          : remediationStoreAvailable
            ? "Deterministic request-time reconciliation. Automatic remediation is not active in this runtime."
            : "Automatic remediation is disabled because its evidence store could not be verified.",
      ...(monitor.lastError
        ? {
            lastError: sanitizeDisplayText(monitor.lastError, 240, "Shadow monitor sweep failed."),
          }
        : {}),
    },
    controls: {
      mode: "guarded",
      previewRequired: true,
      supportedActions: [
        "cron.run",
        "cron.enable",
        "cron.disable",
        "remediation.apply",
        "task.cancel",
        "flow.cancel",
      ],
      note: "Task and workflow cancellation require operator.write; schedule changes require operator.admin. Every change uses a single-use confirmation preview.",
    },
  };
  assertOperationsSnapshotV2Integrity(snapshot);
  return snapshot;
}
