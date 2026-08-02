import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  cancelPccPlanningRun,
  readPccPlanningRun,
  resetPccPlanningRunsForTest,
  startPccPlanningRun,
} from "./planning-run-store.js";
import { DEFAULT_PCC_PLANNING_POLICY, type PccPlanGenerationResult } from "./planning.js";

const roots: string[] = [];

function makeEnv(): NodeJS.ProcessEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pcc-planning-run-"));
  roots.push(root);
  return { OPENCLAW_STATE_DIR: root };
}

function plan(): PccPlanGenerationResult {
  return {
    schemaVersion: 1,
    title: "Durable Planning Proof",
    goal: "Prove that project planning is visible and durable.",
    outcomeMetrics: ["The planning run reaches a durable terminal state."],
    workflowTemplateId: "software-product",
    milestones: [],
    risks: [],
    assumptions: [],
    provenance: {
      generatedAt: "2026-07-27T00:00:00.000Z",
      provider: "openai",
      model: DEFAULT_PCC_PLANNING_POLICY.model,
      runtime: "codex",
      effort: "medium",
      auth: "oauth",
      source: "live_codex",
      planningOnly: true,
    },
  };
}

async function waitForTerminal(runId: string, env: NodeJS.ProcessEnv) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = await readPccPlanningRun(runId, env);
    if (run && !["queued", "running"].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
  throw new Error("planning run did not reach a terminal state");
}

async function waitForAdmission(runId: string, env: NodeJS.ProcessEnv) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = await readPccPlanningRun(runId, env);
    if (run && run.status !== "queued") {
      return run;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
  throw new Error("planning run did not leave the queue");
}

afterEach(() => {
  resetPccPlanningRunsForTest();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("PCC durable planning runs", () => {
  it("persists stage transitions and the completed plan", async () => {
    const env = makeEnv();
    const run = await startPccPlanningRun({
      cfg: {} as OpenClawConfig,
      request: { surface: "project_creation", description: "Build a durable project planner." },
      policy: DEFAULT_PCC_PLANNING_POLICY,
      env,
      generatePlan: async ({ onStage, onUsage }) => {
        await onStage?.("planner_running");
        await onUsage?.({ input: 900, output: 100, totalTokens: 1_000 });
        await onStage?.("validating");
        return plan();
      },
    });

    expect(run.status).toBe("running");
    const completed = await waitForTerminal(run.id, env);
    expect(completed).toMatchObject({
      status: "succeeded",
      stage: "ready",
      usage: { input: 900, output: 100, totalTokens: 1_000 },
      plan: { title: "Durable Planning Proof" },
    });
  });

  it("deduplicates the same active request", async () => {
    const env = makeEnv();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const input = {
      cfg: {} as OpenClawConfig,
      request: { surface: "project_creation" as const, description: "Build one project." },
      policy: DEFAULT_PCC_PLANNING_POLICY,
      env,
      generatePlan: async () => {
        await gate;
        return plan();
      },
    };

    const [first, duplicate] = await Promise.all([
      startPccPlanningRun(input),
      startPccPlanningRun(input),
    ]);
    expect(duplicate.id).toBe(first.id);
    release();
    await waitForTerminal(first.id, env);
  });

  it("queues additional plans and automatically admits them when capacity is available", async () => {
    const env = makeEnv();
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const start = (description: string, gate: Promise<void>) =>
      startPccPlanningRun({
        cfg: {} as OpenClawConfig,
        request: { surface: "project_creation", description },
        policy: DEFAULT_PCC_PLANNING_POLICY,
        env,
        maxConcurrentRuns: 2,
        generatePlan: async () => {
          await gate;
          return plan();
        },
      });

    const first = await start("First bounded plan.", firstGate);
    const second = await start("Second bounded plan.", secondGate);
    const third = await startPccPlanningRun({
      cfg: {} as OpenClawConfig,
      request: { surface: "project_creation", description: "Third bounded plan." },
      policy: DEFAULT_PCC_PLANNING_POLICY,
      env,
      maxConcurrentRuns: 2,
      generatePlan: async () => plan(),
    });
    expect(third).toMatchObject({ status: "queued", queuePosition: 1 });

    releaseFirst();
    await waitForTerminal(first.id, env);
    expect(["running", "succeeded"]).toContain((await waitForAdmission(third.id, env)).status);
    releaseSecond();
    await waitForTerminal(second.id, env);
    expect((await waitForTerminal(third.id, env)).status).toBe("succeeded");
  });

  it("cancels immediately and never overwrites cancellation with success", async () => {
    const env = makeEnv();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = await startPccPlanningRun({
      cfg: {} as OpenClawConfig,
      request: { surface: "project_creation", description: "Build a cancellable project." },
      policy: DEFAULT_PCC_PLANNING_POLICY,
      env,
      generatePlan: async () => {
        await gate;
        return plan();
      },
    });

    const cancelled = await cancelPccPlanningRun(run.id, env);
    expect(cancelled.status).toBe("cancelled");
    release();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect((await readPccPlanningRun(run.id, env))?.status).toBe("cancelled");
  });
});
