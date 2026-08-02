import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { readDurableJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import type { PccModelUsage, PccPlannerRunner } from "./planning-runtime.js";
import { generatePccPlanWithCodex } from "./planning-runtime.js";
import type { PccPlanGenerationRequest, PccPlanGenerationResult } from "./planning.js";
import type { PccPlanningPolicy } from "./planning.js";
import {
  DEFAULT_PCC_PRIVATE_TEAM_POLICY,
  PCC_PRIVATE_TEAM_MAX_CONCURRENT_PLANNING_RUNS,
} from "./private-team-policy.js";

export type PccPlanningRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "lost";

export type PccPlanningRunStage = "preparing" | "planner_running" | "validating" | "ready";

export type PccPlanningRun = {
  schemaVersion: 1;
  id: string;
  requestFingerprint: string;
  surface: PccPlanGenerationRequest["surface"];
  status: PccPlanningRunStatus;
  stage: PccPlanningRunStage;
  model: string;
  effort: "medium" | "high";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  usage?: PccModelUsage;
  plan?: PccPlanGenerationResult;
};

type ActiveRun = {
  controller: AbortController;
  promise: Promise<void>;
};

const activeRuns = new Map<string, ActiveRun>();
const startRunLocks = new Map<string, Promise<void>>();

async function acquireStartRunLock(key: string): Promise<() => void> {
  const previous = startRunLocks.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.then(() => current);
  startRunLocks.set(key, tail);
  await previous;
  return () => {
    releaseCurrent();
    if (startRunLocks.get(key) === tail) {
      startRunLocks.delete(key);
    }
  };
}

function runsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "pcc", "planning-runs");
}

function runPath(id: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!/^[a-f0-9-]{36}$/iu.test(id)) {
    throw new Error("invalid PCC planning run id");
  }
  return path.join(runsRoot(env), `${id}.json`);
}

function fingerprint(request: PccPlanGenerationRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

async function writeRun(run: PccPlanningRun, env: NodeJS.ProcessEnv): Promise<void> {
  await fs.mkdir(runsRoot(env), { recursive: true, mode: 0o700 });
  await writeJsonAtomic(runPath(run.id, env), run, {
    mode: 0o600,
    dirMode: 0o700,
    trailingNewline: true,
  });
}

export async function readPccPlanningRun(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PccPlanningRun | null> {
  return readDurableJsonFile<PccPlanningRun>(runPath(id, env));
}

async function findMatchingActiveRun(
  requestFingerprint: string,
  env: NodeJS.ProcessEnv,
): Promise<PccPlanningRun | null> {
  await fs.mkdir(runsRoot(env), { recursive: true, mode: 0o700 });
  const names = await fs.readdir(runsRoot(env));
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const run = await readDurableJsonFile<PccPlanningRun>(path.join(runsRoot(env), name));
    if (
      run?.requestFingerprint === requestFingerprint &&
      (run.status === "queued" || run.status === "running")
    ) {
      if (!activeRuns.has(run.id)) {
        const now = new Date().toISOString();
        const lost = {
          ...run,
          status: "lost" as const,
          error: "The Gateway restarted before this planning run finished. Retry generation.",
          updatedAt: now,
          endedAt: now,
        };
        await writeRun(lost, env);
        continue;
      }
      return run;
    }
  }
  return null;
}

async function countDurableActiveRuns(env: NodeJS.ProcessEnv): Promise<number> {
  await fs.mkdir(runsRoot(env), { recursive: true, mode: 0o700 });
  let count = 0;
  for (const name of await fs.readdir(runsRoot(env))) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const run = await readDurableJsonFile<PccPlanningRun>(path.join(runsRoot(env), name));
    if (run?.status === "queued" || run?.status === "running") {
      count += 1;
    }
  }
  return count;
}

export async function startPccPlanningRun(params: {
  cfg: OpenClawConfig;
  request: PccPlanGenerationRequest;
  policy: PccPlanningPolicy;
  runAgent?: PccPlannerRunner;
  generatePlan?: typeof generatePccPlanWithCodex;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  maxConcurrentRuns?: number;
}): Promise<PccPlanningRun> {
  const env = params.env ?? process.env;
  const requestFingerprint = fingerprint(params.request);
  const lockKey = `${runsRoot(env)}:${requestFingerprint}`;
  const releaseStartLock = await acquireStartRunLock(lockKey);
  const releaseCapacityLock = await acquireStartRunLock(`${runsRoot(env)}:capacity`);
  try {
    const existing = await findMatchingActiveRun(requestFingerprint, env);
    if (existing) {
      return existing;
    }
    const requestedMaxConcurrentRuns = params.maxConcurrentRuns;
    const maxCandidate =
      typeof requestedMaxConcurrentRuns === "number" && Number.isInteger(requestedMaxConcurrentRuns)
        ? requestedMaxConcurrentRuns
        : DEFAULT_PCC_PRIVATE_TEAM_POLICY.maxConcurrentPlanningRuns;
    const maxConcurrentRuns = Math.max(
      1,
      Math.min(maxCandidate, PCC_PRIVATE_TEAM_MAX_CONCURRENT_PLANNING_RUNS),
    );
    const activeRunCount = await countDurableActiveRuns(env);
    if (activeRunCount >= maxConcurrentRuns) {
      throw new Error(
        `PCC planning capacity is full (${maxConcurrentRuns} active runs maximum). Wait for a run to finish or cancel it, then retry.`,
      );
    }
    const clock = params.now ?? (() => new Date());
    const createdAt = clock().toISOString();
    const effort =
      params.request.depth === "high" || params.policy.depth === "high" ? "high" : "medium";
    let run: PccPlanningRun = {
      schemaVersion: 1,
      id: randomUUID(),
      requestFingerprint,
      surface: params.request.surface,
      status: "queued",
      stage: "preparing",
      model: params.policy.model,
      effort,
      createdAt,
      updatedAt: createdAt,
    };
    await writeRun(run, env);
    const controller = new AbortController();
    const promise = (async () => {
      const update = async (patch: Partial<PccPlanningRun>) => {
        if (
          run.status === "cancelled" &&
          patch.status !== undefined &&
          patch.status !== "cancelled"
        ) {
          return;
        }
        run = { ...run, ...patch, updatedAt: clock().toISOString() };
        await writeRun(run, env);
      };
      await update({ status: "running", startedAt: clock().toISOString() });
      try {
        const plan = await (params.generatePlan ?? generatePccPlanWithCodex)({
          cfg: params.cfg,
          request: params.request,
          policy: params.policy,
          runAgent: params.runAgent,
          now: clock,
          abortSignal: controller.signal,
          onStage: (stage) => update({ stage }),
          onUsage: (usage) => update({ usage }),
        });
        controller.signal.throwIfAborted();
        await update({
          status: "succeeded",
          stage: "ready",
          plan,
          endedAt: clock().toISOString(),
        });
      } catch (error) {
        const cancelled = controller.signal.aborted;
        await update({
          status: cancelled ? "cancelled" : "failed",
          error: cancelled
            ? "Plan generation was cancelled. Your project description is still available."
            : error instanceof Error
              ? error.message
              : String(error),
          endedAt: clock().toISOString(),
        });
      } finally {
        activeRuns.delete(run.id);
      }
    })();
    activeRuns.set(run.id, { controller, promise });
    return run;
  } finally {
    releaseCapacityLock();
    releaseStartLock();
  }
}

export async function cancelPccPlanningRun(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PccPlanningRun> {
  const run = await readPccPlanningRun(id, env);
  if (!run) {
    throw new Error("PCC planning run not found");
  }
  const active = activeRuns.get(id);
  if (run.status === "queued" || run.status === "running") {
    const now = new Date().toISOString();
    const cancelled = {
      ...run,
      status: "cancelled" as const,
      error: "Plan generation was cancelled. Your project description is still available.",
      updatedAt: now,
      endedAt: now,
    };
    await writeRun(cancelled, env);
    active?.controller.abort(new Error("Cancelled by the operator"));
    return cancelled;
  }
  return run;
}

export function resetPccPlanningRunsForTest(): void {
  for (const active of activeRuns.values()) {
    active.controller.abort();
    // Test roots are removed immediately after this synchronous reset. The
    // aborted runner may still be unwinding and attempting its terminal write;
    // consume that expected cleanup rejection instead of leaking an unhandled
    // promise into the next test.
    void active.promise.catch(() => undefined);
  }
  activeRuns.clear();
  startRunLocks.clear();
}
