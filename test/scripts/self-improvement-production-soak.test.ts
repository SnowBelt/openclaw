import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSelfImprovementSoakRestartCommand,
  buildSelfImprovementSoakRollbackCommand,
  collectSelfImprovementSoakSample,
  executeSelfImprovementSoakCycle,
  hashSelfImprovementSoakEvidence,
  readSelfImprovementSoakReceipt,
  withSelfImprovementSoakReceiptLock,
  writeSelfImprovementSoakReceipt,
  type SelfImprovementSoakDependencies,
} from "../../scripts/dev/self-improvement-production-soak.js";
import { createSelfImprovementSoakReceipt } from "../../src/self-improvement/soak.js";

const temporaryDirectories: string[] = [];
const now = Date.parse("2026-07-13T12:00:00.000Z");

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sig-production-soak-"));
  temporaryDirectories.push(root);
  await fs.mkdir(path.join(root, "work", "self-improvement"), { recursive: true });
  return root;
}

function productionResult(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    ready: true,
    score: 95,
    blockers: [],
    warnings: [],
    runtime: { releaseId: "candidate" },
    health: {
      dimensions: [
        {
          id: "effectiveness",
          metrics: [{ key: "safetyViolations", value: 0 }],
        },
      ],
    },
    ...overrides,
  };
}

function receipt() {
  return createSelfImprovementSoakReceipt({
    candidateReleaseId: "candidate",
    rollbackReleaseId: "previous",
    automaticRollbackEnabled: true,
    startedAt: now,
    rollbackEvidence: { path: "work/self-improvement/rollback.json", sha256: "a".repeat(64) },
  });
}

function dependencies(callGateway: SelfImprovementSoakDependencies["callGateway"]) {
  return {
    callGateway,
    now: () => now,
    probeRoute: vi.fn(async () => true),
    restartManagedGateway: vi.fn(async () => {}),
    rollbackCandidate: vi.fn(async () => ({
      releaseId: "previous",
      performedAt: now + 1,
      verifiedAt: now + 2,
    })),
    sleep: vi.fn(async () => {}),
  } satisfies SelfImprovementSoakDependencies;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("Self-Improvement production soak runner", () => {
  it("collects production, RPC, dashboard, runtime, and safety proof", async () => {
    const callGateway = vi.fn(async (method: string) =>
      method === "selfImprovement.productionCheck" ? productionResult() : { groups: [] },
    );
    const sample = await collectSelfImprovementSoakSample({
      callGateway,
      dashboardBaseUrl: "http://127.0.0.1:18789",
      now: () => now,
      probeRoute: async () => true,
    });
    expect(sample).toMatchObject({
      runtimeReleaseId: "candidate",
      productionReady: true,
      productionScore: 95,
      rpcReady: true,
      dashboardReady: true,
      safetyViolations: 0,
      blockers: [],
    });
    expect(callGateway).toHaveBeenCalledWith("selfImprovement.summary", { limit: 100 });
  });

  it("fails closed when the safety metric or dashboard proof is missing", async () => {
    const callGateway = vi.fn(async (method: string) =>
      method === "selfImprovement.productionCheck"
        ? productionResult({ health: { dimensions: [] } })
        : { groups: [] },
    );
    const sample = await collectSelfImprovementSoakSample({
      callGateway,
      dashboardBaseUrl: "http://127.0.0.1:18789",
      now: () => now,
      probeRoute: async (url) => !url.endsWith("/readyz"),
    });
    expect(sample.safetyViolations).toBe(1);
    expect(sample.dashboardReady).toBe(false);
    expect(sample.blockers).toEqual(
      expect.arrayContaining([
        "Production health omitted the numeric safetyViolations metric.",
        "One or more dashboard acceptance routes failed.",
      ]),
    );
  });

  it("automatically rolls back only after an unhealthy candidate sample", async () => {
    const callGateway = vi.fn(async (method: string) =>
      method === "selfImprovement.productionCheck"
        ? productionResult({ score: 80 })
        : { groups: [] },
    );
    const deps = dependencies(callGateway);
    const result = await executeSelfImprovementSoakCycle({
      receipt: receipt(),
      dashboardBaseUrl: "http://127.0.0.1:18789",
      dependencies: deps,
    });
    expect(result.rolledBack).toBe(true);
    expect(result.receipt.rollbackResult).toMatchObject({
      fromReleaseId: "candidate",
      toReleaseId: "previous",
    });
    expect(deps.rollbackCandidate).toHaveBeenCalledOnce();
  });

  it("uses the preregistered managed rollback when RPC collection fails", async () => {
    const deps = dependencies(
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const result = await executeSelfImprovementSoakCycle({
      receipt: receipt(),
      dashboardBaseUrl: "http://127.0.0.1:18789",
      dependencies: deps,
    });
    expect(result.rolledBack).toBe(true);
    expect(result.receipt.samples).toHaveLength(0);
    expect(result.receipt.rollbackResult).toMatchObject({
      fromReleaseId: "candidate",
      toReleaseId: "previous",
    });
    expect(deps.rollbackCandidate).toHaveBeenCalledOnce();
  });

  it("builds only the managed custom-runtime restart and rollback commands", () => {
    expect(
      buildSelfImprovementSoakRestartCommand({ runtimeHome: "/managed/runtime", port: 18888 }),
    ).toEqual({
      command: "/managed/runtime/bin/custom-runtime-restart.sh",
      args: ["--port", "18888"],
    });
    expect(
      buildSelfImprovementSoakRollbackCommand({
        runtimeHome: "/managed/runtime",
        candidateRuntimeReleaseId: "native-candidate",
        rollbackReleaseId: "custom-previous",
        port: 18888,
        verifyOnly: true,
      }),
    ).toEqual({
      command: "/managed/runtime/bin/custom-runtime-rollback.sh",
      args: [
        "--candidate-runtime-release",
        "native-candidate",
        "--rollback-release",
        "custom-previous",
        "--port",
        "18888",
        "--verify-only",
      ],
    });
  });

  it("writes durable receipts and hashes only bounded evidence artifacts", async () => {
    const root = await temporaryRoot();
    const receiptPath = path.join(root, "work", "self-improvement", "soak.json");
    const evidencePath = path.join(root, "work", "self-improvement", "rollback.json");
    await fs.writeFile(evidencePath, '{"passed":true}\n', "utf8");
    const evidence = await hashSelfImprovementSoakEvidence({
      filePath: evidencePath,
      rootDir: root,
    });
    expect(evidence).toMatchObject({
      path: "work/self-improvement/rollback.json",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    await writeSelfImprovementSoakReceipt({
      filePath: receiptPath,
      receipt: receipt(),
      exclusive: true,
    });
    expect(await readSelfImprovementSoakReceipt(receiptPath)).toEqual(receipt());
    await expect(
      writeSelfImprovementSoakReceipt({
        filePath: receiptPath,
        receipt: receipt(),
        exclusive: true,
      }),
    ).rejects.toThrow("Refusing to overwrite existing soak receipt");
  });

  it("prevents concurrent receipt writers and preserves stale lock evidence", async () => {
    const root = await temporaryRoot();
    const receiptPath = path.join(root, "work", "self-improvement", "soak.json");
    let releaseFirstLock: (() => void) | undefined;
    const first = withSelfImprovementSoakReceiptLock({
      receiptPath,
      run: async () =>
        await new Promise<void>((resolve) => {
          releaseFirstLock = resolve;
        }),
    });
    await vi.waitUntil(() => releaseFirstLock !== undefined);
    await expect(
      withSelfImprovementSoakReceiptLock({ receiptPath, run: async () => "second" }),
    ).rejects.toThrow("already owns");
    releaseFirstLock?.();
    await first;

    await fs.writeFile(
      `${receiptPath}.lock`,
      `${JSON.stringify({ version: 1, pid: -1, createdAt: 0 })}\n`,
      "utf8",
    );
    await expect(
      withSelfImprovementSoakReceiptLock({ receiptPath, run: async () => "recovered" }),
    ).resolves.toBe("recovered");
    expect(
      (await fs.readdir(path.dirname(receiptPath))).some((entry) => entry.includes(".lock.stale.")),
    ).toBe(true);
  });
});
