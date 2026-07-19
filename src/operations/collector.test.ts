import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { CronServiceContract } from "../cron/service-contract.js";
import type { CronJob } from "../cron/types.js";
import { collectOperationsSnapshot } from "./collector.js";

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-operations-room-"));
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("Operations Room collector", () => {
  it("projects agents, schedules, models, resources, and findings without process arguments", async () => {
    const cfg = {
      agents: {
        defaults: {
          workspace,
          model: { primary: "ollama/gemma", fallbacks: ["ollama/qwen"] },
          heartbeat: { every: "30m", target: "last" },
        },
        list: [{ id: "main", name: "Control Director" }],
      },
    } as OpenClawConfig;
    const cronJob: CronJob = {
      id: "cron-1",
      name: "Reliability sweep",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 2,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Check health" },
      state: {
        nextRunAtMs: 10_000,
        lastRunStatus: "error",
        lastError: "probe failed",
        consecutiveErrors: 3,
      },
    };
    const cron = {
      list: vi.fn(async () => [cronJob]),
    } as unknown as CronServiceContract;

    const snapshot = await collectOperationsSnapshot({
      cfg,
      cron,
      includeProcesses: false,
      now: 5_000,
      modelCatalog: [
        {
          id: "gemma",
          name: "Gemma",
          provider: "ollama",
          route: "local",
          certification: "certified",
        },
      ],
    });

    expect(snapshot.schema).toBe("openclaw.operations-room.v1");
    expect(snapshot.agents).toEqual([
      expect.objectContaining({
        id: "main",
        name: "Control Director",
        model: "ollama/gemma",
        fallbackModels: ["ollama/qwen"],
        memoryBytes: null,
        memoryAttribution: "unavailable",
      }),
    ]);
    expect(snapshot.cronJobs).toEqual([
      expect.objectContaining({ id: "cron-1", status: "failed", consecutiveErrors: 3 }),
    ]);
    expect(snapshot.models).toEqual([
      expect.objectContaining({ id: "ollama/gemma", route: "local", status: "healthy" }),
    ]);
    expect(snapshot.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cron:cron-1:failure", severity: "critical" }),
      ]),
    );
    expect(snapshot.processes).toEqual([]);
    expect(snapshot.controls).toMatchObject({ mode: "guarded", previewRequired: true });
    expect(snapshot.reconciler.autoRemediationEnabled).toBe(false);
  });
});
