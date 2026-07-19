// Operations Room collector projects existing OpenClaw runtime sources into a
// bounded read model. It does not start models, invoke agents, or mutate config.
import os from "node:os";
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
import { listTaskRecords } from "../tasks/runtime-internal.js";
import { listTaskFlowRecords } from "../tasks/task-flow-runtime-internal.js";
import type { TaskRecord } from "../tasks/task-registry.types.js";
import { collectOperationsHostMemory } from "./host-memory-probe.js";
import { getOperationsShadowMonitorState, OPERATIONS_SHADOW_INTERVAL_MS } from "./monitor.js";
import { collectOperationsProcesses } from "./process-probe.js";
import {
  capOperationsRows,
  operationsStatusForFindings,
  operationsStatusForTask,
  scoreOperationsFindings,
  stampOperationsFindingHistory,
} from "./status.js";
import type {
  OperationsAgentSnapshot,
  OperationsCatalogEntry,
  OperationsCronSnapshot,
  OperationsFinding,
  OperationsSnapshot,
  OperationsStatus,
  OperationsTaskSnapshot,
  OperationsWorkflowSnapshot,
} from "./types.js";

const QUALITY_TARGET = 93 as const;
const STALE_TASK_WARNING_MS = 2 * 60 * 60 * 1_000;
const RECENT_AGENT_FAILURE_MS = 24 * 60 * 60 * 1_000;

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

function flowStatus(status: string): OperationsStatus {
  switch (status) {
    case "running":
    case "queued":
      return "working";
    case "waiting":
      return "idle";
    case "blocked":
      return "blocked";
    case "failed":
    case "lost":
      return "failed";
    case "cancelled":
      return "disabled";
    case "succeeded":
      return "healthy";
    default:
      return "unknown";
  }
}

function cronStatus(job: CronJob): OperationsStatus {
  if (!job.enabled) {
    return "disabled";
  }
  if (job.state.runningAtMs) {
    return "working";
  }
  const lastStatus = job.state.lastRunStatus ?? job.state.lastStatus;
  if (lastStatus === "error") {
    return job.state.consecutiveErrors && job.state.consecutiveErrors >= 3 ? "failed" : "degraded";
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
  params: Omit<OperationsFinding, "firstObservedAt" | "lastObservedAt">,
  now: number,
) {
  return { ...params, firstObservedAt: now, lastObservedAt: now } satisfies OperationsFinding;
}

function buildAgentRows(params: {
  cfg: OpenClawConfig;
  modelCatalog: ModelCatalogEntry[];
  tasks: TaskRecord[];
  now: number;
}): OperationsAgentSnapshot[] {
  const agents = listAgentsForGateway(params.cfg, params.modelCatalog).agents;
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

  const rows: OperationsAgentSnapshot[] = [];
  for (const agent of agents) {
    const agentTasks = (tasksByAgent.get(agent.id) ?? []).toSorted(
      (left, right) => taskUpdatedAt(right) - taskUpdatedAt(left),
    );
    let activeTaskCount = 0;
    let blockedTaskCount = 0;
    for (const task of agentTasks) {
      if (task.status === "queued" || task.status === "running") {
        activeTaskCount += 1;
      }
      if (
        (task.status === "failed" || task.status === "timed_out" || task.status === "lost") &&
        params.now - taskUpdatedAt(task) <= RECENT_AGENT_FAILURE_MS
      ) {
        blockedTaskCount += 1;
      }
    }
    const heartbeat = resolveHeartbeatSummaryForAgent(params.cfg, agent.id);
    const latestTask = agentTasks[0];
    const latestTaskIsBlocked =
      latestTask !== undefined &&
      (latestTask.status === "failed" ||
        latestTask.status === "timed_out" ||
        latestTask.status === "lost") &&
      params.now - taskUpdatedAt(latestTask) <= RECENT_AGENT_FAILURE_MS;
    const row: OperationsAgentSnapshot = {
      id: agent.id,
      workspace: agent.workspace ?? resolveAgentWorkspaceDir(params.cfg, agent.id),
      duty: heartbeat.enabled ? "always_on" : "on_demand",
      status: activeTaskCount > 0 ? "working" : latestTaskIsBlocked ? "degraded" : "idle",
      fallbackModels: agent.model?.fallbacks ?? [],
      activeTaskCount,
      blockedTaskCount,
      heartbeat: {
        enabled: heartbeat.enabled,
        every: heartbeat.every,
        everyMs: heartbeat.everyMs,
        target: heartbeat.target,
      },
      // OpenClaw agents share the Gateway process. Per-agent RSS is not
      // measurable without allocator-level accounting, so expose unknown.
      memoryBytes: null,
      memoryAttribution: "unavailable",
    };
    const agentName = agent.name ?? agent.identity?.name;
    if (agentName) {
      row.name = agentName;
    }
    if (agent.model?.primary) {
      row.model = agent.model.primary;
    }
    if (latestTask) {
      row.latestTask = latestTask.label ?? latestTask.task;
      row.latestActivityAt = taskUpdatedAt(latestTask);
    }
    if (heartbeat.model) {
      row.heartbeat.model = heartbeat.model;
    }
    rows.push(row);
  }
  return rows;
}

function buildWorkflowRows(tasks: TaskRecord[]): OperationsWorkflowSnapshot[] {
  const taskCountsByFlow = new Map<string, { active: number; failed: number }>();
  for (const task of tasks) {
    if (!task.parentFlowId) {
      continue;
    }
    const counts = taskCountsByFlow.get(task.parentFlowId) ?? { active: 0, failed: 0 };
    if (task.status === "running" || task.status === "queued") {
      counts.active += 1;
    }
    if (task.status === "failed" || task.status === "timed_out" || task.status === "lost") {
      counts.failed += 1;
    }
    taskCountsByFlow.set(task.parentFlowId, counts);
  }

  const rows: OperationsWorkflowSnapshot[] = [];
  for (const flow of listTaskFlowRecords()) {
    const counts = taskCountsByFlow.get(flow.flowId) ?? { active: 0, failed: 0 };
    const row: OperationsWorkflowSnapshot = {
      id: flow.flowId,
      title: flow.goal,
      ownerKey: flow.ownerKey,
      status: flowStatus(flow.status),
      sourceStatus: flow.status,
      activeTaskCount: counts.active,
      failedTaskCount: counts.failed,
      updatedAt: flow.updatedAt,
    };
    if (flow.controllerId) {
      row.controllerId = flow.controllerId;
    }
    if (flow.currentStep) {
      row.currentStep = flow.currentStep;
    }
    if (flow.blockedSummary) {
      row.blocker = flow.blockedSummary;
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
      title: task.label ?? task.task,
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
    if (task.progressSummary || task.terminalSummary) {
      row.progress = task.progressSummary ?? task.terminalSummary;
    }
    if (task.error) {
      row.error = task.error;
    }
    rows.push(row);
  }
  return rows.toSorted((left, right) => {
    const activeRank = (row: OperationsTaskSnapshot) => (row.status === "working" ? 1 : 0);
    return activeRank(right) - activeRank(left) || right.updatedAt - left.updatedAt;
  });
}

function buildCronRows(jobs: readonly CronJob[]): OperationsCronSnapshot[] {
  const rows: OperationsCronSnapshot[] = [];
  for (const job of jobs) {
    const row: OperationsCronSnapshot = {
      id: job.id,
      name: job.displayName ?? job.name,
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
    if (job.state.lastError) {
      row.lastError = job.state.lastError;
    }
    rows.push(row);
  }
  return rows.toSorted(
    (left, right) =>
      Number(right.running) - Number(left.running) || left.name.localeCompare(right.name),
  );
}

function buildCatalogs(params: {
  cfg: OpenClawConfig;
  modelCatalog: ModelCatalogEntry[];
}): Pick<OperationsSnapshot, "skills" | "plugins" | "tools" | "models"> {
  const defaultAgentId = resolveDefaultAgentId(params.cfg);
  const workspace = resolveAgentWorkspaceDir(params.cfg, defaultAgentId);
  const skillReport = buildWorkspaceSkillStatus(workspace, {
    config: params.cfg,
    agentId: defaultAgentId,
  });
  const skills: OperationsCatalogEntry[] = [];
  for (const skill of skillReport.skills) {
    const row: OperationsCatalogEntry = {
      id: skill.skillKey,
      name: skill.name,
      kind: "skill",
      status: skill.disabled
        ? "disabled"
        : skill.eligible
          ? "healthy"
          : skill.platformIncompatible
            ? "disabled"
            : "blocked",
      configured: true,
      active: skill.eligible && !skill.disabled,
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
      source: plugin.source,
    };
    if (plugin.error) {
      row.reason = plugin.error;
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
          status: "healthy",
          configured: true,
          active: true,
          source: `core:${section.id}`,
        }) satisfies OperationsCatalogEntry,
    ),
  );
  const pluginTools = (registry?.tools ?? []).flatMap((registration) =>
    (registration.names.length > 0 ? registration.names : (registration.declaredNames ?? [])).map(
      (name) =>
        ({
          id: `${registration.pluginId}:${name}`,
          name,
          kind: "tool",
          status: registration.names.includes(name) ? "healthy" : "unknown",
          configured: true,
          active: registration.names.includes(name),
          source: `plugin:${registration.pluginId}`,
          owner: registration.pluginId,
        }) satisfies OperationsCatalogEntry,
    ),
  );

  const models: OperationsCatalogEntry[] = [];
  for (const model of params.modelCatalog) {
    const row: OperationsCatalogEntry = {
      id: `${model.provider}/${model.id}`,
      name: model.name || model.id,
      kind: "model",
      status: model.certification === "certified" ? "healthy" : "unknown",
      configured: true,
      active: null,
      source: model.provider,
      route: model.route ?? "unknown",
    };
    if (model.certification) {
      row.reason = `Certification: ${model.certification}`;
    }
    models.push(row);
  }

  return {
    skills: capOperationsRows(skills.toSorted((a, b) => a.name.localeCompare(b.name))),
    plugins: capOperationsRows(plugins.toSorted((a, b) => a.name.localeCompare(b.name))),
    tools: capOperationsRows(
      [...coreTools, ...pluginTools].toSorted((a, b) => a.name.localeCompare(b.name)),
    ),
    models: capOperationsRows(models.toSorted((a, b) => a.name.localeCompare(b.name))),
  };
}

function buildFindings(params: {
  now: number;
  hostMemoryUsedPercent: number;
  eventLoop?: GatewayEventLoopHealth;
  tasks: TaskRecord[];
  workflows: OperationsWorkflowSnapshot[];
  cronJobs: OperationsCronSnapshot[];
  catalogs: Pick<OperationsSnapshot, "skills" | "plugins">;
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
          detail: `${params.hostMemoryUsedPercent.toFixed(1)}% of host memory is in use.`,
          recommendedAction: "Pause new local model work and inspect the largest processes.",
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
          detail: `${params.hostMemoryUsedPercent.toFixed(1)}% of host memory is in use.`,
          recommendedAction: "Avoid starting another large local model until memory recovers.",
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
          title: "Gateway event loop is degraded",
          detail: `P99 delay ${params.eventLoop.delayP99Ms} ms; reasons: ${params.eventLoop.reasons.join(", ")}.`,
          recommendedAction: "Inspect CPU pressure and long-running synchronous work.",
        },
        params.now,
      ),
    );
  }
  for (const task of params.tasks) {
    const lastAt = taskUpdatedAt(task);
    if (task.status === "running" && params.now - lastAt >= STALE_TASK_WARNING_MS) {
      findings.push(
        finding(
          {
            id: `task:${task.taskId}:stale`,
            severity: "warning",
            category: "workflow",
            entityId: task.taskId,
            title: "Task may be stalled",
            detail: `${task.label ?? task.task} has no recorded progress for at least two hours.`,
            recommendedAction: "Inspect the task before cancelling it.",
          },
          params.now,
        ),
      );
    }
  }
  for (const flow of params.workflows.filter(
    (entry) => entry.status === "blocked" || entry.status === "failed",
  )) {
    findings.push(
      finding(
        {
          id: `workflow:${flow.id}:${flow.sourceStatus}`,
          severity: flow.status === "failed" ? "critical" : "warning",
          category: "workflow",
          entityId: flow.id,
          title: flow.status === "failed" ? "Workflow failed" : "Workflow is blocked",
          detail: flow.blocker ?? flow.title,
          recommendedAction: "Open the workflow inspector and resolve its recorded blocker.",
        },
        params.now,
      ),
    );
  }
  for (const job of params.cronJobs.filter(
    (entry) => entry.status === "degraded" || entry.status === "failed",
  )) {
    findings.push(
      finding(
        {
          id: `cron:${job.id}:failure`,
          severity: job.status === "failed" ? "critical" : "warning",
          category: "cron",
          entityId: job.id,
          title: `Scheduled workflow ${job.name} is failing`,
          detail: job.lastError ?? `${job.consecutiveErrors} consecutive errors.`,
          recommendedAction:
            "Inspect the last run, then use guarded Run now after fixing the cause.",
        },
        params.now,
      ),
    );
  }
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
          recommendedAction: "Inspect plugin compatibility and configuration before restarting.",
        },
        params.now,
      ),
    );
  }
  const blockedSkills = params.catalogs.skills.filter((entry) => entry.status === "blocked");
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
          recommendedAction: "Open Skills to install only the requirements needed for active work.",
        },
        params.now,
      ),
    );
  }
  return capOperationsRows(
    findings.toSorted((left, right) => {
      const rank = { critical: 2, warning: 1, info: 0 } as const;
      return rank[right.severity] - rank[left.severity] || left.title.localeCompare(right.title);
    }),
  );
}

export async function collectOperationsSnapshot(params: {
  cfg: OpenClawConfig;
  cron: CronServiceContract;
  modelCatalog?: ModelCatalogEntry[];
  eventLoop?: GatewayEventLoopHealth;
  now?: number;
  includeProcesses?: boolean;
}): Promise<OperationsSnapshot> {
  const now = params.now ?? Date.now();
  const modelCatalog = params.modelCatalog ?? [];
  const [cronJobsRaw, processes, hostMemory] = await Promise.all([
    params.cron.list({ includeDisabled: true }),
    params.includeProcesses === false ? Promise.resolve([]) : collectOperationsProcesses(),
    collectOperationsHostMemory(),
  ]);
  const tasks = listTaskRecords();
  const agents = buildAgentRows({ cfg: params.cfg, modelCatalog, tasks, now });
  const taskRows = capOperationsRows(buildTaskRows(tasks));
  const workflows = capOperationsRows(buildWorkflowRows(tasks));
  const cronJobs = capOperationsRows(buildCronRows(cronJobsRaw));
  const catalogs = buildCatalogs({ cfg: params.cfg, modelCatalog });
  const processMemory = process.memoryUsage();
  const findings = stampOperationsFindingHistory(
    buildFindings({
      now,
      hostMemoryUsedPercent: hostMemory.memoryUsedPercent,
      eventLoop: params.eventLoop,
      tasks,
      workflows,
      cronJobs,
      catalogs,
    }),
    now,
  );
  const overallStatus = operationsStatusForFindings(findings);
  const qualityScore = scoreOperationsFindings(findings);
  const monitor = getOperationsShadowMonitorState();

  return {
    schema: "openclaw.operations-room.v1",
    generatedAt: now,
    qualityTarget: QUALITY_TARGET,
    qualityScore,
    overallStatus,
    summary: {
      agents: agents.length,
      workingAgents: agents.filter((agent) => agent.status === "working").length,
      attentionAgents: agents.filter(
        (agent) =>
          agent.status === "degraded" || agent.status === "blocked" || agent.status === "failed",
      ).length,
      tasks: taskRows.length,
      activeTasks: taskRows.filter((task) => task.status === "working").length,
      failedTasks: taskRows.filter((task) => task.status === "failed" || task.status === "blocked")
        .length,
      workflows: workflows.length,
      activeWorkflows: workflows.filter((flow) => flow.status === "working").length,
      cronJobs: cronJobs.length,
      failingCronJobs: cronJobs.filter(
        (job) => job.status === "degraded" || job.status === "failed",
      ).length,
      plugins: catalogs.plugins.length,
      skills: catalogs.skills.length,
      tools: catalogs.tools.length,
      models: catalogs.models.length,
      findings: findings.length,
      criticalFindings: findings.filter((entry) => entry.severity === "critical").length,
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
      processRssBytes: processMemory.rss,
      processHeapUsedBytes: processMemory.heapUsed,
      processHeapTotalBytes: processMemory.heapTotal,
      ...(params.eventLoop ? { eventLoopLagMs: params.eventLoop.delayP99Ms } : {}),
      status:
        hostMemory.memoryUsedPercent >= 80 || params.eventLoop?.degraded ? "degraded" : "healthy",
    },
    agents,
    tasks: taskRows,
    workflows,
    cronJobs,
    ...catalogs,
    processes,
    findings,
    reconciler: {
      mode: "shadow",
      autoRemediationEnabled: false,
      intervalMs: monitor.intervalMs || OPERATIONS_SHADOW_INTERVAL_MS,
      lastSweepAt: monitor.lastSweepAt ?? now,
      nextSweepAt: monitor.nextSweepAt ?? now + OPERATIONS_SHADOW_INTERVAL_MS,
      recommendedActionCount: findings.filter((entry) => entry.recommendedAction).length,
      ruleCount: 9,
      note: monitor.running
        ? "Deterministic shadow monitor active. No model calls and no automatic mutations."
        : "Deterministic request-time reconciliation. Background monitor is not active in this runtime.",
    },
    controls: {
      mode: "guarded",
      previewRequired: true,
      supportedActions: ["cron.run", "cron.enable", "cron.disable", "task.cancel", "flow.cancel"],
      note: "Every change requires operator.write plus a single-use confirmation preview.",
    },
  };
}
