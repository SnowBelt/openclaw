import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PccProject } from "../../packages/gateway-protocol/src/schema/types.js";
import type { PccLedger } from "./domain/ledger.js";
import { createPccExecutionPlan, transitionPccExecutionPlan } from "./execution-plan.js";
import { resolvePccExecutionProfilePreset } from "./execution-profile.js";
import {
  reconcilePccExecutionTerminalEvent,
  registerPccExecutionRun,
  resetPccExecutionReconciliationForTest,
} from "./execution-reconciliation.js";
import { withPccExecutionPlanMetadata } from "./execution-service.js";
import {
  closePccLedgerStorageForTest,
  readPccLedger,
  replacePccLedgerForTest,
} from "./ledger-store.js";

let root: string;
let previousStateDir: string | undefined;

function makeLedger(): PccLedger {
  const project: PccProject = {
    id: "project-reconciliation",
    title: "Family Fighters SNES MVP",
    status: "active" as const,
    revision: 1,
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
  };
  const prepared = createPccExecutionPlan({
    id: "reconciliation-plan",
    projectId: project.id,
    projectRevision: "1",
    profile: resolvePccExecutionProfilePreset("local_parallel"),
    coordinator: {
      sessionId: "agent:main:pcc-reconciliation",
      runId: "reconciliation-run",
    },
    admittedWorkerCount: 1,
    createdAt: project.createdAt,
  });
  const running = transitionPccExecutionPlan(
    transitionPccExecutionPlan(prepared, "dispatching", {
      at: "2026-08-20T12:00:01.000Z",
    }),
    "running",
    { at: "2026-08-20T12:00:02.000Z" },
  );
  project.metadata = {
    ...withPccExecutionPlanMetadata(project, running, "ui:reconciliation", running.updatedAt),
  };
  return {
    version: 1,
    projects: [project],
    milestones: [],
    subMilestones: [],
    permissions: [],
    evidence: [],
    receipts: [],
    decisions: [],
    lastKnownGood: [],
    modelRunReceipts: [],
  };
}

describe("PCC execution terminal reconciliation", () => {
  beforeEach(() => {
    previousStateDir = process.env.OPENCLAW_STATE_DIR;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pcc-reconciliation-"));
    process.env.OPENCLAW_STATE_DIR = root;
    resetPccExecutionReconciliationForTest();
    replacePccLedgerForTest(makeLedger());
  });

  afterEach(() => {
    resetPccExecutionReconciliationForTest();
    closePccLedgerStorageForTest();
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("records terminal facts, reviewable proof, and actual model usage exactly once", async () => {
    registerPccExecutionRun({
      projectId: "project-reconciliation",
      planId: "reconciliation-plan",
      runId: "reconciliation-run",
      model: "ollama/qwen3.6",
      provider: "ollama",
      startedAt: "2026-08-20T12:00:00.000Z",
    });

    await reconcilePccExecutionTerminalEvent({
      runId: "reconciliation-run",
      phase: "end",
      data: {
        endedAt: "2026-08-20T12:01:00.000Z",
        proofCandidate: {
          summary: "The worker completed the local implementation task.",
          changedFiles: ["src/example.ts"],
          checks: ["focused test"],
          risks: ["Review before completion."],
        },
        usage: { input: 100, output: 40, totalTokens: 140 },
      },
    });

    const first = readPccLedger();
    const project = first.projects[0];
    if (!project) {
      throw new Error("reconciliation project was not persisted");
    }
    const rawPlans = project.metadata?.pccExecutionPlans;
    if (!Array.isArray(rawPlans)) {
      throw new Error("reconciliation execution plan metadata was not persisted");
    }
    const plan = rawPlans[0] as Record<string, unknown>;
    expect(plan.status).toBe("completed");
    expect(plan.proofCandidates).toEqual([
      expect.objectContaining({
        status: "pending_review",
        summary: "The worker completed the local implementation task.",
        changedFiles: ["src/example.ts"],
      }),
    ]);
    expect(first.modelRunReceipts).toEqual([
      expect.objectContaining({
        sourceRunId: "reconciliation-run",
        status: "succeeded",
        provider: "ollama",
        model: "ollama/qwen3.6",
        usage: { input: 100, output: 40, totalTokens: 140 },
        usageSource: "provider_reported",
      }),
    ]);

    const revisionAfterFirst = project.revision;
    await reconcilePccExecutionTerminalEvent({
      runId: "reconciliation-run",
      phase: "end",
      data: { endedAt: "2026-08-20T12:01:00.000Z" },
    });
    const second = readPccLedger();
    expect(second.projects[0]?.revision).toBe(revisionAfterFirst);
    expect(second.modelRunReceipts).toHaveLength(1);
  });
});
