// Operations Room compatibility keeps the original V1 wire shape stable while
// the authoritative collector evolves behind the explicitly versioned V2 RPC.
import type { OperationsSnapshotV1Result } from "../../packages/gateway-protocol/src/schema/types.js";
import { sanitizeTaskStatusText } from "../tasks/task-status.js";
import type { OperationsCatalogEntry, OperationsSnapshot } from "./types.js";

function stripInternalContextBoundary(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const boundaries = [
    value.indexOf("OpenClaw runtime context (internal):"),
    value.indexOf("[Internal task completion event]"),
  ].filter((index) => index >= 0);
  return boundaries.length > 0 ? value.slice(0, Math.min(...boundaries)) : value;
}

function displayText(value: unknown, maxChars: number, fallback: string): string {
  return sanitizeTaskStatusText(stripInternalContextBoundary(value), { maxChars }) || fallback;
}

function optionalDisplayText(
  value: unknown,
  maxChars: number,
  errorContext = false,
): string | undefined {
  return (
    sanitizeTaskStatusText(stripInternalContextBoundary(value), { errorContext, maxChars }) ||
    undefined
  );
}

function projectCatalogEntry(
  entry: OperationsCatalogEntry,
): OperationsSnapshotV1Result["skills"][number] {
  const source = optionalDisplayText(entry.source, 256);
  const owner = optionalDisplayText(entry.owner, 256);
  const reason = optionalDisplayText(entry.reason, 120, true);
  return {
    id: entry.id,
    name: displayText(entry.name, 120, entry.id),
    kind: entry.kind,
    status: entry.status,
    configured: entry.configured,
    active: entry.active,
    ...(source ? { source } : {}),
    ...(owner ? { owner } : {}),
    ...(reason ? { reason } : {}),
    ...(entry.route ? { route: entry.route } : {}),
  };
}

/**
 * Projects an authoritative V2 snapshot onto the exact original V1 contract.
 *
 * The projection is deterministic and reconstructs every nested object so V2
 * metadata cannot leak into a legacy response. Human-readable fields are
 * sanitized and bounded again at the protocol boundary.
 */
export function projectOperationsSnapshotV1(
  snapshot: OperationsSnapshot,
): OperationsSnapshotV1Result {
  const hostEventLoopLagMs = snapshot.host.eventLoopLagMs;
  const latestTaskByAgent = new Map<string, (typeof snapshot.tasks)[number]>();
  for (const task of snapshot.tasks) {
    if (!task.agentId) {
      continue;
    }
    const latest = latestTaskByAgent.get(task.agentId);
    if (!latest || task.updatedAt > latest.updatedAt) {
      latestTaskByAgent.set(task.agentId, task);
    }
  }
  return {
    schema: "openclaw.operations-room.v1",
    generatedAt: snapshot.generatedAt,
    qualityTarget: 93,
    qualityScore: snapshot.qualityScore,
    overallStatus: snapshot.overallStatus,
    summary: {
      agents: snapshot.agents.length,
      workingAgents: snapshot.agents.filter((agent) => agent.status === "working").length,
      attentionAgents: snapshot.agents.filter(
        (agent) =>
          agent.status === "degraded" || agent.status === "blocked" || agent.status === "failed",
      ).length,
      tasks: snapshot.tasks.length,
      activeTasks: snapshot.tasks.filter((task) => task.status === "working").length,
      failedTasks: snapshot.tasks.filter(
        (task) =>
          (task.status === "failed" || task.status === "blocked") &&
          snapshot.generatedAt - task.updatedAt <= 24 * 60 * 60 * 1_000,
      ).length,
      workflows: snapshot.workflows.length,
      activeWorkflows: snapshot.workflows.filter((workflow) => workflow.status === "working")
        .length,
      cronJobs: snapshot.cronJobs.length,
      failingCronJobs: snapshot.cronJobs.filter(
        (job) => job.status === "degraded" || job.status === "failed",
      ).length,
      plugins: snapshot.plugins.length,
      skills: snapshot.skills.length,
      tools: snapshot.tools.length,
      models: snapshot.models.length,
      findings: snapshot.findings.length,
      criticalFindings: snapshot.findings.filter((finding) => finding.severity === "critical")
        .length,
    },
    host: {
      hostname: displayText(snapshot.host.hostname, 256, "unknown"),
      platform: displayText(snapshot.host.platform, 64, "unknown"),
      arch: displayText(snapshot.host.arch, 64, "unknown"),
      uptimeMs: snapshot.host.uptimeMs,
      logicalCpuCount: snapshot.host.logicalCpuCount,
      loadAverage: [...snapshot.host.loadAverage],
      totalMemoryBytes: snapshot.host.totalMemoryBytes,
      freeMemoryBytes: snapshot.host.freeMemoryBytes,
      availableMemoryBytes: snapshot.host.availableMemoryBytes,
      usedMemoryBytes: snapshot.host.usedMemoryBytes,
      memoryUsedPercent: snapshot.host.memoryUsedPercent,
      memoryAvailabilitySource: snapshot.host.memoryAvailabilitySource,
      processRssBytes: snapshot.host.processRssBytes,
      processHeapUsedBytes: snapshot.host.processHeapUsedBytes,
      processHeapTotalBytes: snapshot.host.processHeapTotalBytes,
      ...(hostEventLoopLagMs == null ? {} : { eventLoopLagMs: hostEventLoopLagMs }),
      status: snapshot.host.status,
    },
    agents: snapshot.agents.map((agent) => {
      const name = optionalDisplayText(agent.name, 120);
      const model = optionalDisplayText(agent.model, 256);
      const latestTask = optionalDisplayText(
        latestTaskByAgent.get(agent.id)?.title ??
          agent.latestTask ??
          agent.currentWork?.title ??
          agent.lastActivity?.title,
        80,
      );
      const heartbeatModel = optionalDisplayText(agent.heartbeat.model, 256);
      return {
        id: agent.id,
        ...(name ? { name } : {}),
        workspace: displayText(agent.workspace, 2_000, ""),
        duty: agent.duty,
        status: agent.status,
        ...(model ? { model } : {}),
        fallbackModels: agent.fallbackModels.map((value) => displayText(value, 256, "unknown")),
        activeTaskCount: agent.activeTaskCount,
        blockedTaskCount: agent.blockedTaskCount,
        ...(latestTask ? { latestTask } : {}),
        ...(agent.latestActivityAt == null ? {} : { latestActivityAt: agent.latestActivityAt }),
        heartbeat: {
          enabled: agent.heartbeat.enabled,
          every: displayText(agent.heartbeat.every, 120, "off"),
          everyMs: agent.heartbeat.everyMs,
          target: displayText(agent.heartbeat.target, 256, "none"),
          ...(heartbeatModel ? { model: heartbeatModel } : {}),
        },
        memoryBytes: agent.memoryBytes,
        memoryAttribution: agent.memoryAttribution,
      };
    }),
    tasks: snapshot.tasks.map((task) => {
      const agentId = optionalDisplayText(task.agentId, 256);
      const parentFlowId = optionalDisplayText(task.parentFlowId, 256);
      const progress = optionalDisplayText(task.progress, 120);
      const error = optionalDisplayText(task.error, 120, true);
      return {
        id: task.id,
        title: displayText(task.title, 80, "Background task"),
        runtime: task.runtime,
        ...(agentId ? { agentId } : {}),
        ...(parentFlowId ? { parentFlowId } : {}),
        status: task.status,
        sourceStatus: displayText(task.sourceStatus, 80, "unknown"),
        ...(progress ? { progress } : {}),
        ...(error ? { error } : {}),
        updatedAt: task.updatedAt,
      };
    }),
    workflows: snapshot.workflows.map((workflow) => {
      const controllerId = optionalDisplayText(workflow.controllerId, 256);
      const currentStep = optionalDisplayText(workflow.currentStep, 120);
      const blocker = optionalDisplayText(workflow.blocker, 120, true);
      return {
        id: workflow.id,
        title: displayText(workflow.title, 80, "Workflow"),
        ownerKey: displayText(workflow.ownerKey, 256, workflow.id),
        ...(controllerId ? { controllerId } : {}),
        status: workflow.status,
        sourceStatus: displayText(workflow.sourceStatus, 80, "unknown"),
        ...(currentStep ? { currentStep } : {}),
        ...(blocker ? { blocker } : {}),
        activeTaskCount: workflow.activeTaskCount,
        failedTaskCount: workflow.failedTaskCount,
        updatedAt: workflow.updatedAt,
      };
    }),
    cronJobs: snapshot.cronJobs.map((job) => {
      const agentId = optionalDisplayText(job.agentId, 256);
      const lastRunStatus = optionalDisplayText(job.lastRunStatus, 80);
      const lastError = optionalDisplayText(job.lastError, 120, true);
      return {
        id: job.id,
        name: displayText(job.name, 120, job.id),
        ...(agentId ? { agentId } : {}),
        duty: job.duty,
        status: job.status,
        enabled: job.enabled,
        running: job.running,
        ...(job.nextRunAt == null ? {} : { nextRunAt: job.nextRunAt }),
        ...(job.lastRunAt == null ? {} : { lastRunAt: job.lastRunAt }),
        ...(lastRunStatus ? { lastRunStatus } : {}),
        ...(lastError ? { lastError } : {}),
        consecutiveErrors: job.consecutiveErrors,
      };
    }),
    skills: snapshot.skills.map(projectCatalogEntry),
    plugins: snapshot.plugins.map(projectCatalogEntry),
    tools: snapshot.tools.map(projectCatalogEntry),
    models: snapshot.models.map(projectCatalogEntry),
    processes: snapshot.processes.map((process) => ({
      pid: process.pid,
      parentPid: process.parentPid,
      command: displayText(process.command, 120, "process"),
      rssBytes: process.rssBytes,
      cpuPercent: process.cpuPercent,
      kind: process.kind,
    })),
    findings: snapshot.findings.map((finding) => {
      const entityId = optionalDisplayText(finding.entityId, 256);
      const recommendedAction = optionalDisplayText(finding.recommendedAction, 160);
      return {
        id: finding.id,
        severity: finding.severity,
        category: finding.category === "monitor" ? "process" : finding.category,
        title: displayText(finding.title, 120, "Operations finding"),
        detail: displayText(finding.detail, 240, "Details unavailable."),
        ...(entityId ? { entityId } : {}),
        ...(recommendedAction ? { recommendedAction } : {}),
        ...(finding.firstObservedAt == null ? {} : { firstObservedAt: finding.firstObservedAt }),
        lastObservedAt: finding.lastObservedAt,
      };
    }),
    reconciler: {
      mode: snapshot.reconciler.mode,
      autoRemediationEnabled: false,
      intervalMs: snapshot.reconciler.intervalMs,
      lastSweepAt: snapshot.reconciler.lastSweepAt ?? 0,
      nextSweepAt: snapshot.reconciler.nextSweepAt ?? 0,
      recommendedActionCount: snapshot.reconciler.recommendedActionCount,
      ruleCount: snapshot.reconciler.ruleCount,
      note: displayText(snapshot.reconciler.note, 240, "Deterministic monitor."),
    },
    controls: {
      mode: "guarded",
      previewRequired: true,
      supportedActions: [...snapshot.controls.supportedActions],
      note: displayText(snapshot.controls.note, 240, "Confirmation required."),
    },
  };
}
