// The Control UI prefers the explicit V2 contract. This adapter keeps a new UI
// usable with an older Gateway without interpreting legacy observations as
// current, complete, or verified healthy.
import type { OperationsSnapshotV1Result } from "../../../../packages/gateway-protocol/src/schema/types.js";
import type {
  OperationsAgentSnapshot,
  OperationsCatalogEntry,
  OperationsFinding,
  OperationsSnapshot,
  OperationsStatus,
} from "../types.ts";

const LEGACY_COMPATIBILITY_FINDING_ID = "operations:legacy-gateway";

function compactText(value: unknown, maxChars: number, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const internalBoundary = Math.min(
    ...[
      value.indexOf("OpenClaw runtime context (internal):"),
      value.indexOf("[Internal task completion event]"),
    ].filter((index) => index >= 0),
  );
  const visible = (Number.isFinite(internalBoundary) ? value.slice(0, internalBoundary) : value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!visible) {
    return fallback;
  }
  return visible.length <= maxChars ? visible : `${visible.slice(0, Math.max(0, maxChars - 1))}…`;
}

function optionalCompactText(value: unknown, maxChars: number): string | undefined {
  const compact = compactText(value, maxChars, "");
  return compact || undefined;
}

function conservativeStatus(status: OperationsStatus): OperationsStatus {
  switch (status) {
    case "failed":
    case "blocked":
      return "failed";
    case "degraded":
      return "degraded";
    case "disabled":
      return "disabled";
    default:
      return "unknown";
  }
}

function legacyAgentHealth(status: OperationsStatus): OperationsAgentSnapshot["healthState"] {
  if (status === "failed" || status === "blocked") {
    return "failed";
  }
  if (status === "degraded") {
    return "degraded";
  }
  return "unknown";
}

function legacyAgentActivity(
  status: OperationsStatus,
  duty: OperationsAgentSnapshot["duty"],
): OperationsAgentSnapshot["activityState"] {
  if (status === "working") {
    return "working";
  }
  if (status === "blocked") {
    return "waiting";
  }
  if (status === "disabled" || duty === "disabled") {
    return "off";
  }
  if (duty === "scheduled") {
    return "scheduled";
  }
  return "unknown";
}

function legacyAgentAttention(status: OperationsStatus): OperationsAgentSnapshot["attentionState"] {
  if (status === "failed" || status === "blocked") {
    return "urgent";
  }
  if (status === "degraded") {
    return "watching";
  }
  return "none";
}

function collectionCount(total: number, shown: number) {
  const boundedTotal = Math.max(total, shown);
  return { total: boundedTotal, shown, truncated: boundedTotal > shown };
}

function adaptCatalogEntry(
  entry: OperationsSnapshotV1Result["skills"][number],
): OperationsCatalogEntry {
  const source = optionalCompactText(entry.source, 256);
  const owner = optionalCompactText(entry.owner, 256);
  return {
    id: entry.id,
    name: compactText(entry.name, 120, entry.id),
    kind: entry.kind,
    status: conservativeStatus(entry.status),
    configured: entry.configured,
    active: entry.active,
    ...(source ? { source } : {}),
    ...(owner ? { owner } : {}),
    ...(entry.route ? { route: entry.route } : {}),
    availability: "unverified",
  };
}

function adaptLegacyFinding(
  finding: OperationsSnapshotV1Result["findings"][number],
): OperationsFinding {
  const needsUser = finding.severity === "critical";
  const title = compactText(finding.title, 120, "Legacy operations finding");
  const entityId = optionalCompactText(finding.entityId, 256);
  const recommendedAction = optionalCompactText(finding.recommendedAction, 160);
  return {
    id: finding.id,
    severity: finding.severity,
    category: finding.category,
    title,
    detail: "Reported by a legacy Gateway; detailed evidence is hidden until V2 is available.",
    ...(entityId ? { entityId } : {}),
    ...(recommendedAction ? { recommendedAction } : {}),
    ...(finding.firstObservedAt == null ? {} : { firstObservedAt: finding.firstObservedAt }),
    lastObservedAt: finding.lastObservedAt,
    disposition: needsUser ? "needs_user" : "watching",
    responseState: needsUser ? "waiting_for_user" : "monitoring",
    impact: "The issue is visible, but its response state cannot be verified from the legacy API.",
    nextAction:
      recommendedAction ??
      "Update the Gateway, refresh Operations Room, and verify the V2 evidence.",
  };
}

/** Converts an exact V1 response to the V2 UI model without manufacturing health. */
export function adaptOperationsSnapshotV1(legacy: OperationsSnapshotV1Result): OperationsSnapshot {
  const generatedAt = legacy.generatedAt;
  const compatibilityFinding: OperationsFinding = {
    id: LEGACY_COMPATIBILITY_FINDING_ID,
    severity: "warning",
    category: "update",
    title: "Gateway update needed for complete Operations data",
    detail: "This compatibility view intentionally treats legacy observations as unverified.",
    lastObservedAt: generatedAt,
    disposition: "watching",
    responseState: "monitoring",
    impact: "Live work remains visible, but freshness, completeness, and health cannot be proven.",
    nextAction: "Update the Gateway, then refresh Operations Room.",
  };
  const legacyFindings = legacy.findings.slice(0, 199).map(adaptLegacyFinding);
  const findings = [...legacyFindings, compatibilityFinding];
  const tasks = legacy.tasks.map((task) => {
    const agentId = optionalCompactText(task.agentId, 256);
    const parentFlowId = optionalCompactText(task.parentFlowId, 256);
    return {
      id: task.id,
      title: "Legacy background task",
      runtime: task.runtime,
      ...(agentId ? { agentId } : {}),
      ...(parentFlowId ? { parentFlowId } : {}),
      status: task.status === "working" ? "working" : conservativeStatus(task.status),
      sourceStatus: compactText(task.sourceStatus, 80, "unknown"),
      updatedAt: task.updatedAt,
    };
  });
  const activeTasksByAgent = new Map(
    tasks
      .filter((task) => task.status === "working" && task.agentId)
      .map((task) => [task.agentId!, task] as const),
  );
  const agents = legacy.agents.map((agent): OperationsAgentSnapshot => {
    const name = optionalCompactText(agent.name, 120);
    const model = optionalCompactText(agent.model, 256);
    const heartbeatModel = optionalCompactText(agent.heartbeat.model, 256);
    const activeTask = activeTasksByAgent.get(agent.id);
    const currentWork =
      agent.status === "working"
        ? {
            taskId: activeTask?.id ?? `legacy:${agent.id}`,
            title: "Background work",
            updatedAt: activeTask?.updatedAt ?? agent.latestActivityAt ?? generatedAt,
            outcome: "active" as const,
          }
        : undefined;
    return {
      id: agent.id,
      ...(name ? { name } : {}),
      workspace: compactText(agent.workspace, 2_000, ""),
      duty: agent.duty,
      dutySource: agent.heartbeat.enabled ? "heartbeat" : "configuration",
      status: conservativeStatus(agent.status),
      activityState: legacyAgentActivity(agent.status, agent.duty),
      healthState: legacyAgentHealth(agent.status),
      attentionState: legacyAgentAttention(agent.status),
      ...(model ? { model } : {}),
      fallbackModels: agent.fallbackModels.map((value) => compactText(value, 256, "unknown")),
      activeTaskCount: agent.activeTaskCount,
      blockedTaskCount: agent.blockedTaskCount,
      ...(agent.latestActivityAt == null ? {} : { latestActivityAt: agent.latestActivityAt }),
      ...(currentWork ? { currentWork } : {}),
      heartbeat: {
        enabled: agent.heartbeat.enabled,
        every: compactText(agent.heartbeat.every, 120, "off"),
        everyMs: agent.heartbeat.everyMs,
        target: compactText(agent.heartbeat.target, 256, "none"),
        ...(heartbeatModel ? { model: heartbeatModel } : {}),
      },
      memoryBytes: agent.memoryBytes,
      memoryAttribution: agent.memoryAttribution,
    };
  });
  const workflows = legacy.workflows.map((workflow, index) => {
    const controllerId = optionalCompactText(workflow.controllerId, 256);
    return {
      id: workflow.id,
      title: `Legacy workflow ${index + 1}`,
      ownerKey: compactText(workflow.ownerKey, 256, workflow.id),
      ...(controllerId ? { controllerId } : {}),
      status: workflow.status === "working" ? "working" : conservativeStatus(workflow.status),
      sourceStatus: compactText(workflow.sourceStatus, 80, "unknown"),
      hasWaitState: workflow.status === "blocked",
      activeTaskCount: workflow.activeTaskCount,
      failedTaskCount: workflow.failedTaskCount,
      updatedAt: workflow.updatedAt,
    };
  });
  const cronJobs = legacy.cronJobs.map((job) => {
    const agentId = optionalCompactText(job.agentId, 256);
    const lastRunStatus = optionalCompactText(job.lastRunStatus, 80);
    return {
      id: job.id,
      name: compactText(job.name, 120, job.id),
      ...(agentId ? { agentId } : {}),
      duty: job.duty,
      status: job.running ? ("working" as const) : conservativeStatus(job.status),
      enabled: job.enabled,
      running: job.running,
      ...(job.nextRunAt == null ? {} : { nextRunAt: job.nextRunAt }),
      ...(job.lastRunAt == null ? {} : { lastRunAt: job.lastRunAt }),
      ...(lastRunStatus ? { lastRunStatus } : {}),
      consecutiveErrors: job.consecutiveErrors,
    };
  });
  const activityRollups = tasks
    .filter((task) => task.status === "working")
    .slice(0, 200)
    .map((task) => ({
      key: `legacy:${task.runtime}:${task.id}`,
      runtime: task.runtime,
      sourceId: task.id,
      taskId: task.id,
      title: "Background work",
      count: 1,
      latestAt: task.updatedAt,
      status: "working" as const,
      ...(task.agentId ? { agentId: task.agentId } : {}),
    }));
  const incidentHistory = findings.map((finding) => ({
    id: finding.id,
    title: finding.title,
    category: finding.category,
    severity: finding.severity,
    disposition: finding.disposition,
    responseState: finding.responseState,
    firstObservedAt: finding.firstObservedAt ?? finding.lastObservedAt,
    lastObservedAt: finding.lastObservedAt,
    transitions: [{ at: finding.firstObservedAt ?? finding.lastObservedAt, to: finding.severity }],
  }));
  const fallbackSources = [
    "agents",
    "tasks",
    "workflows",
    "schedules",
    "capabilities",
    "models",
    "processes",
    ...(legacy.host.eventLoopLagMs == null ? [] : (["event_loop"] as const)),
  ] as OperationsSnapshot["completeness"]["fallbackSources"];
  const unavailableSources = [
    ...(legacy.host.eventLoopLagMs == null ? (["event_loop"] as const) : []),
    "monitor",
    "incident_ledger",
  ] as OperationsSnapshot["completeness"]["unavailableSources"];
  const sourceObservation = { status: "fallback" as const, observedAt: generatedAt };
  const eventLoopObservation =
    legacy.host.eventLoopLagMs == null ? ({ status: "unavailable" } as const) : sourceObservation;
  const skills = legacy.skills.map(adaptCatalogEntry);
  const plugins = legacy.plugins.map(adaptCatalogEntry);
  const tools = legacy.tools.map(adaptCatalogEntry);
  const models = legacy.models.map(adaptCatalogEntry);
  const processes = legacy.processes.map((process) => ({
    pid: process.pid,
    parentPid: process.parentPid,
    command: compactText(process.command, 120, "process"),
    rssBytes: process.rssBytes,
    cpuPercent: process.cpuPercent,
    kind: process.kind,
  }));
  const legacyFindingTotal = Math.max(legacy.summary.findings, legacy.findings.length);
  const needsUserFindings = Math.min(legacy.summary.criticalFindings, legacyFindingTotal);
  const watchingFindings = legacyFindingTotal - needsUserFindings + 1;

  return {
    schema: "openclaw.operations-room.v2",
    generatedAt,
    snapshotId: `legacy:${generatedAt}`,
    freshness: {
      status: "unknown",
      observedAt: generatedAt,
      staleAfterMs: 1,
      sources: {
        agents: sourceObservation,
        tasks: sourceObservation,
        workflows: sourceObservation,
        schedules: sourceObservation,
        capabilities: sourceObservation,
        models: sourceObservation,
        processes: sourceObservation,
        event_loop: eventLoopObservation,
        monitor: { status: "unavailable" },
        incident_ledger: { status: "unavailable" },
      },
    },
    completeness: { status: "partial", unavailableSources, fallbackSources },
    briefing: {
      tone: "unknown",
      text: "Showing a compatibility view from an older Gateway. Update it for verified live status.",
    },
    qualityTarget: 93,
    qualityScore: Math.min(legacy.qualityScore, 92),
    overallStatus:
      legacy.overallStatus === "failed" || legacy.overallStatus === "blocked"
        ? "failed"
        : legacy.overallStatus === "degraded"
          ? "degraded"
          : "unknown",
    summary: {
      ...legacy.summary,
      findings: legacyFindingTotal + 1,
      actionableFindings: legacyFindingTotal + 1,
      historicalFindings: 0,
      needsUserFindings,
      handlingFindings: 0,
      watchingFindings,
    },
    collections: {
      agents: collectionCount(legacy.summary.agents, agents.length),
      tasks: collectionCount(legacy.summary.tasks, tasks.length),
      workflows: collectionCount(legacy.summary.workflows, workflows.length),
      cronJobs: collectionCount(legacy.summary.cronJobs, cronJobs.length),
      skills: collectionCount(legacy.summary.skills, skills.length),
      plugins: collectionCount(legacy.summary.plugins, plugins.length),
      tools: collectionCount(legacy.summary.tools, tools.length),
      models: collectionCount(legacy.summary.models, models.length),
      processes: collectionCount(processes.length, processes.length),
      findings: collectionCount(legacyFindingTotal + 1, findings.length),
      activityRollups: collectionCount(legacy.summary.activeTasks, activityRollups.length),
      incidentHistory: collectionCount(legacyFindingTotal + 1, incidentHistory.length),
    },
    host: {
      ...legacy.host,
      hostname: compactText(legacy.host.hostname, 256, "unknown"),
      platform: compactText(legacy.host.platform, 64, "unknown"),
      arch: compactText(legacy.host.arch, 64, "unknown"),
      status: conservativeStatus(legacy.host.status),
    },
    agents,
    tasks,
    workflows,
    cronJobs,
    skills,
    plugins,
    tools,
    models,
    processes,
    findings,
    activityRollups,
    incidentHistory,
    incidentLedger: { overflowCount: 0 },
    reconciler: {
      ...legacy.reconciler,
      lastAttemptAt: null,
      lastSweepAt: null,
      nextSweepAt: null,
      attemptCount: 0,
      sweepCount: 0,
      note: "Legacy reconciler state; update the Gateway for verified monitor health.",
    },
    controls: { ...legacy.controls },
  };
}
