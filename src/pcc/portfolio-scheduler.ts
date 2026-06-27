// PCC portfolio scheduler chooses safe cross-project work without starting it.
import type {
  PccMilestone,
  PccProject,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";
import {
  getPccWorkLoopNext,
  getPccWorkLoopSettings,
  type PccWorkLoopNext,
  type PccWorkLoopProject,
} from "./work-loop.js";

export type PccPortfolioResourceSnapshot = {
  availableLocalModelSlots: number;
  availableCodexSlots: number;
  availableRemoteProofSlots: number;
  availableVramGb: number;
  availableRamGb: number;
  maxParallelProjects: number;
};

export type PccPortfolioProjectInput = PccWorkLoopProject;

export type PccPortfolioScheduledItem = {
  projectId: string;
  projectTitle: string;
  milestoneId: string | null;
  subMilestoneId: string | null;
  title: string;
  lane: string;
  reason: string;
  estimatedVramGb: number;
  estimatedRamGb: number;
  workspaceLock: string | null;
};

export type PccPortfolioBlockedItem = {
  projectId: string;
  projectTitle: string;
  title: string;
  reason: string;
  kind: string;
};

export type PccPortfolioSchedule = {
  ready: PccPortfolioScheduledItem[];
  blocked: PccPortfolioBlockedItem[];
  resourceLimited: PccPortfolioBlockedItem[];
};

const TERMINAL_PROJECT_STATUSES = new Set(["complete", "complete_with_maintenance", "archived"]);
const DEFAULT_RESOURCES: PccPortfolioResourceSnapshot = {
  availableLocalModelSlots: 2,
  availableCodexSlots: 0,
  availableRemoteProofSlots: 0,
  availableVramGb: 32,
  availableRamGb: 64,
  maxParallelProjects: 2,
};

function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function metadataString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function workItem(next: PccWorkLoopNext): PccMilestone | PccSubMilestone | null {
  return next.subMilestone ?? next.milestone;
}

function laneFor(item: PccMilestone | PccSubMilestone | null): string {
  return metadataString(metadata(item?.metadata).pccResponsibility) ?? "local_openclaw_agent";
}

function workspaceLockFor(item: PccMilestone | PccSubMilestone | null): string | null {
  return metadataString(metadata(item?.metadata).workspaceLock);
}

function vramFor(item: PccMilestone | PccSubMilestone | null): number {
  return metadataNumber(
    metadata(item?.metadata).estimatedVramGb,
    laneFor(item) === "local_model" ? 16 : 0,
  );
}

function ramFor(item: PccMilestone | PccSubMilestone | null): number {
  return metadataNumber(metadata(item?.metadata).estimatedRamGb, 4);
}

function priority(project: PccProject): number {
  return typeof project.priority === "number" ? project.priority : 3;
}

function updatedAt(project: PccProject): number {
  const parsed = Date.parse(project.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeResources(
  resources?: Partial<PccPortfolioResourceSnapshot>,
): PccPortfolioResourceSnapshot {
  return { ...DEFAULT_RESOURCES, ...resources };
}

function slotAvailable(resources: PccPortfolioResourceSnapshot, lane: string): boolean {
  if (lane === "codex" || lane === "high_reasoning_codex") {
    return resources.availableCodexSlots > 0;
  }
  if (lane === "remote_proof") {
    return resources.availableRemoteProofSlots > 0;
  }
  return resources.availableLocalModelSlots > 0;
}

function consumeSlot(resources: PccPortfolioResourceSnapshot, lane: string): void {
  if (lane === "codex" || lane === "high_reasoning_codex") {
    resources.availableCodexSlots -= 1;
  } else if (lane === "remote_proof") {
    resources.availableRemoteProofSlots -= 1;
  } else {
    resources.availableLocalModelSlots -= 1;
  }
}

export function buildPccPortfolioSchedule(
  projects: readonly PccPortfolioProjectInput[],
  resourcesInput?: Partial<PccPortfolioResourceSnapshot>,
): PccPortfolioSchedule {
  const resources = normalizeResources(resourcesInput);
  const locks = new Set<string>();
  const ready: PccPortfolioScheduledItem[] = [];
  const blocked: PccPortfolioBlockedItem[] = [];
  const resourceLimited: PccPortfolioBlockedItem[] = [];

  const candidates = projects
    .filter((entry) => !TERMINAL_PROJECT_STATUSES.has(entry.project.status))
    .toSorted(
      (a, b) =>
        priority(a.project) - priority(b.project) || updatedAt(a.project) - updatedAt(b.project),
    );

  for (const entry of candidates) {
    if (ready.length >= resources.maxParallelProjects) {
      resourceLimited.push({
        projectId: entry.project.id,
        projectTitle: entry.project.title,
        title: entry.project.title,
        reason: "Max parallel projects reached.",
        kind: "max_parallel_projects",
      });
      continue;
    }
    const settings = getPccWorkLoopSettings(entry.project);
    if (!settings.enabled && settings.parallelWorkMode === "off") {
      blocked.push({
        projectId: entry.project.id,
        projectTitle: entry.project.title,
        title: entry.project.title,
        reason: "Project work loop is off.",
        kind: "work_loop_off",
      });
      continue;
    }
    const next = getPccWorkLoopNext(entry);
    const item = workItem(next);
    if (next.blocker || !item) {
      blocked.push({
        projectId: entry.project.id,
        projectTitle: entry.project.title,
        title: item?.title ?? entry.project.title,
        reason: next.blocker?.message ?? "No safe work item.",
        kind: next.blocker?.kind ?? "no_work_item",
      });
      continue;
    }
    const lane = laneFor(item);
    const lock = workspaceLockFor(item);
    const estimatedVramGb = vramFor(item);
    const estimatedRamGb = ramFor(item);
    if (lock && locks.has(lock)) {
      resourceLimited.push({
        projectId: entry.project.id,
        projectTitle: entry.project.title,
        title: item.title,
        reason: `Workspace lock is already active: ${lock}`,
        kind: "workspace_locked",
      });
      continue;
    }
    if (!slotAvailable(resources, lane)) {
      resourceLimited.push({
        projectId: entry.project.id,
        projectTitle: entry.project.title,
        title: item.title,
        reason: `${lane.replace(/_/g, " ")} slot is unavailable.`,
        kind: "lane_capacity",
      });
      continue;
    }
    if (estimatedVramGb > resources.availableVramGb || estimatedRamGb > resources.availableRamGb) {
      resourceLimited.push({
        projectId: entry.project.id,
        projectTitle: entry.project.title,
        title: item.title,
        reason: "Estimated RAM/VRAM budget is unavailable.",
        kind: "resource_budget",
      });
      continue;
    }
    consumeSlot(resources, lane);
    resources.availableVramGb -= estimatedVramGb;
    resources.availableRamGb -= estimatedRamGb;
    if (lock) {
      locks.add(lock);
    }
    ready.push({
      projectId: entry.project.id,
      projectTitle: entry.project.title,
      milestoneId: next.milestone?.id ?? null,
      subMilestoneId: next.subMilestone?.id ?? null,
      title: item.title,
      lane,
      reason: "Ready and within current portfolio resource limits.",
      estimatedVramGb,
      estimatedRamGb,
      workspaceLock: lock,
    });
  }

  return { ready, blocked, resourceLimited };
}
