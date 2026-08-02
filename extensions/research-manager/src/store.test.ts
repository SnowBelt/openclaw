import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../api.js";
import type { AcceptanceBenchmarkReceipt } from "./acceptance.js";
import { resolveResearchManagerConfig } from "./config.js";
import {
  recoverInterruptedAcceptanceReceipts,
  recoverInterruptedResearchRuns,
} from "./durability.js";
import { ResearchRunStore } from "./store.js";
import type { ResearchRunReport, ResearchRunStatus } from "./types.js";

function createStore(): ResearchRunStore {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "research-manager-store-"));
  temporaryDirectories.push(stateDir);
  const api = {
    logger: { warn: vi.fn() },
    runtime: {
      state: {
        resolveStateDir: () => stateDir,
        openKeyedStore: vi.fn(),
      },
    },
  } as unknown as OpenClawPluginApi;
  return new ResearchRunStore(api, resolveResearchManagerConfig({ stateTtlDays: 2 }));
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function report(runId: string, status: ResearchRunStatus): ResearchRunReport {
  const now = new Date().toISOString();
  return {
    runId,
    query: `Query ${runId}`,
    mode: "certified",
    status,
    sources: [],
    claims: [],
    findings: [],
    attempts: [],
    gaps: [],
    createdAt: now,
    updatedAt: now,
    repairPasses: 0,
    localModelCalls: 0,
    remoteModelCalls: 0,
  };
}

describe("ResearchRunStore", () => {
  it("rejects duplicate run IDs and serializes concurrent updates without lost writes", async () => {
    const store = createStore();
    await store.create(report("run-1", "queued"));
    await expect(store.create(report("run-1", "queued"))).rejects.toThrow(/already exists/);

    const first = store.update("run-1", async (current) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      return { ...current, localModelCalls: current.localModelCalls + 1 };
    });
    const second = store.update("run-1", (current) => ({
      ...current,
      remoteModelCalls: current.remoteModelCalls + 1,
    }));
    await Promise.all([first, second]);

    expect(await store.load("run-1")).toMatchObject({
      localModelCalls: 1,
      remoteModelCalls: 1,
    });
  });

  it("recovers interrupted runs once, preserves history, and never restarts remote work", async () => {
    const store = createStore();
    const interrupted = report("interrupted", "researching");
    interrupted.attempts.push({
      id: "A1",
      role: "researcher",
      modelId: "local",
      provider: "ollama",
      model: "local",
      startedAt: interrupted.createdAt,
      endedAt: interrupted.createdAt,
      status: "succeeded",
      local: true,
      reservedMemoryGb: 8,
    });
    await store.create(interrupted);
    await store.create(report("done", "completed"));

    expect(await recoverInterruptedResearchRuns(store)).toEqual(["interrupted"]);
    expect(await store.load("interrupted")).toMatchObject({
      status: "blocked",
      attempts: [{ id: "A1" }],
      blockedReason: expect.stringMatching(/resume from the last durable stage/i),
    });
    expect((await store.load("interrupted"))?.completedAt).toBeDefined();
    expect((await store.load("done"))?.status).toBe("completed");
    expect(await recoverInterruptedResearchRuns(store)).toEqual([]);
  });

  it("cancels interrupted acceptance receipts once so they can be resumed", async () => {
    const store = createStore();
    const now = new Date().toISOString();
    const receipt: AcceptanceBenchmarkReceipt = {
      schemaVersion: 1,
      receiptId: "interrupted-acceptance",
      status: "running",
      corpusVersion: "fixture-v1",
      corpusSha256: "a".repeat(64),
      corpusTaskCount: 1,
      selectedTaskIds: ["fixture"],
      thresholds: {
        minimumScore: 93,
        nonInferiorityMargin: 0,
        minimumLocalCallShare: 0.5,
      },
      startedAt: now,
      updatedAt: now,
      cases: [],
      receiptSha256: "b".repeat(64),
    };
    await store.saveAcceptance(receipt);

    expect(await recoverInterruptedAcceptanceReceipts(store)).toEqual(["interrupted-acceptance"]);
    const recovered = await store.loadAcceptance("interrupted-acceptance");
    expect(recovered).toMatchObject({
      status: "cancelled",
      completedAt: expect.any(String),
    });
    expect(recovered?.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(recovered?.receiptSha256).not.toBe(receipt.receiptSha256);
    expect(await recoverInterruptedAcceptanceReceipts(store)).toEqual([]);
  });
});
