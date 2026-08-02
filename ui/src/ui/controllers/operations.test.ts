import { describe, expect, it, vi } from "vitest";
import type { OperationsSnapshotV1Result } from "../../../../packages/gateway-protocol/src/schema/types.js";
import { GatewayRequestError } from "../gateway.ts";
import type {
  OperationsActionPreview,
  OperationsActionReceipt,
  OperationsSnapshot,
} from "../types.ts";
import { createOperationsTestSnapshot } from "../views/operations.fixture.ts";
import {
  loadOperationsRoom,
  runGuardedOperationsAction,
  type OperationsState,
} from "./operations.ts";

function state(request: ReturnType<typeof vi.fn>): OperationsState {
  return {
    client: { request } as unknown as OperationsState["client"],
    connected: true,
    operationsLoading: false,
    operationsActionBusy: false,
    operationsError: null,
    operationsActionNotice: null,
    operationsActionNoticeTone: null,
    operationsSnapshot: null,
    operationsUpdatedAt: null,
    operationsLastSuccessfulAt: null,
    operationsRefreshFailedAt: null,
  };
}

function legacySnapshot(): OperationsSnapshotV1Result {
  return {
    schema: "openclaw.operations-room.v1",
    generatedAt: 123,
    qualityTarget: 93,
    qualityScore: 100,
    overallStatus: "healthy",
    summary: {
      agents: 1,
      workingAgents: 0,
      attentionAgents: 0,
      tasks: 0,
      activeTasks: 0,
      failedTasks: 0,
      workflows: 0,
      activeWorkflows: 0,
      cronJobs: 0,
      failingCronJobs: 0,
      plugins: 0,
      skills: 0,
      tools: 0,
      models: 0,
      findings: 0,
      criticalFindings: 0,
    },
    host: {
      hostname: "studio",
      platform: "darwin",
      arch: "arm64",
      uptimeMs: 1_000,
      logicalCpuCount: 12,
      loadAverage: [1, 1, 1],
      totalMemoryBytes: 100,
      freeMemoryBytes: 40,
      availableMemoryBytes: 60,
      usedMemoryBytes: 40,
      memoryUsedPercent: 40,
      memoryAvailabilitySource: "macos_memory_pressure",
      processRssBytes: 10,
      processHeapUsedBytes: 5,
      processHeapTotalBytes: 8,
      status: "healthy",
    },
    agents: [
      {
        id: "main",
        name: "Control Director",
        workspace: "/workspace",
        duty: "always_on",
        status: "healthy",
        fallbackModels: [],
        activeTaskCount: 0,
        blockedTaskCount: 0,
        latestTask: "legacy raw task text must stay hidden",
        heartbeat: { enabled: true, every: "30m", everyMs: 1_800_000, target: "last" },
        memoryBytes: null,
        memoryAttribution: "unavailable",
      },
    ],
    tasks: [],
    workflows: [],
    cronJobs: [],
    skills: [],
    plugins: [],
    tools: [],
    models: [],
    processes: [],
    findings: [],
    reconciler: {
      mode: "shadow",
      autoRemediationEnabled: false,
      intervalMs: 60_000,
      lastSweepAt: 123,
      nextSweepAt: 60_123,
      recommendedActionCount: 0,
      ruleCount: 9,
      note: "Legacy monitor.",
    },
    controls: {
      mode: "guarded",
      previewRequired: true,
      supportedActions: [],
      note: "Confirmation required.",
    },
  };
}

describe("Operations Room controller", () => {
  it("loads a snapshot and records refresh time", async () => {
    const snapshot = createOperationsTestSnapshot(123);
    const request = vi.fn(async () => snapshot);
    const host = state(request);

    await loadOperationsRoom(host, { includeProcesses: false });

    expect(request).toHaveBeenCalledWith("operations.snapshot.v2", { includeProcesses: false });
    expect(host.operationsSnapshot).toBe(snapshot);
    expect(host.operationsError).toBeNull();
    expect(host.operationsUpdatedAt).toBe(snapshot.generatedAt);
    expect(host.operationsLastSuccessfulAt).toEqual(expect.any(Number));
    expect(host.operationsRefreshFailedAt).toBeNull();
  });

  it("keeps the newest overlapping refresh and ignores a slower older response", async () => {
    let resolveOlder!: (value: OperationsSnapshot) => void;
    let resolveNewer!: (value: OperationsSnapshot) => void;
    const older = new Promise<OperationsSnapshot>((resolve) => {
      resolveOlder = resolve;
    });
    const newer = new Promise<OperationsSnapshot>((resolve) => {
      resolveNewer = resolve;
    });
    const request = vi.fn().mockReturnValueOnce(older).mockReturnValueOnce(newer);
    const host = state(request);

    const olderLoad = loadOperationsRoom(host);
    const newerLoad = loadOperationsRoom(host, { quiet: true });
    const newerSnapshot = createOperationsTestSnapshot(200);
    resolveNewer(newerSnapshot);
    await newerLoad;
    resolveOlder(createOperationsTestSnapshot(100));
    await olderLoad;

    expect(host.operationsSnapshot).toBe(newerSnapshot);
    expect(host.operationsUpdatedAt).toBe(200);
    expect(host.operationsError).toBeNull();
    expect(host.operationsLoading).toBe(false);
  });

  it("accepts a later request after a Gateway restart even when its clock is lower", async () => {
    const restartedSnapshot = createOperationsTestSnapshot(100);
    const request = vi.fn(async () => restartedSnapshot);
    const host = state(request);
    host.operationsSnapshot = createOperationsTestSnapshot(200);
    host.operationsUpdatedAt = 200;

    await loadOperationsRoom(host, { quiet: true });

    expect(host.operationsSnapshot).toBe(restartedSnapshot);
    expect(host.operationsUpdatedAt).toBe(100);
    expect(host.operationsError).toBeNull();
  });

  it("falls back to V1 only when an old Gateway does not expose V2", async () => {
    const legacy = legacySnapshot();
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new GatewayRequestError({
          code: "INVALID_REQUEST",
          message: "unknown method: operations.snapshot.v2",
        }),
      )
      .mockResolvedValueOnce(legacy);
    const host = state(request);

    await loadOperationsRoom(host, { includeProcesses: false });

    expect(request.mock.calls).toEqual([
      ["operations.snapshot.v2", { includeProcesses: false }],
      ["operations.snapshot", { includeProcesses: false }],
    ]);
    expect(host.operationsSnapshot).toMatchObject({
      schema: "openclaw.operations-room.v2",
      overallStatus: "unknown",
      qualityScore: 92,
      completeness: { status: "partial" },
      freshness: { status: "unknown" },
    });
    expect(host.operationsSnapshot?.agents[0]).toMatchObject({
      healthState: "unknown",
      activityState: "unknown",
    });
    expect(host.operationsSnapshot?.findings).toContainEqual(
      expect.objectContaining({ id: "operations:legacy-gateway", disposition: "watching" }),
    );
    expect(JSON.stringify(host.operationsSnapshot)).not.toContain("legacy raw task text");
    expect(host.operationsError).toBeNull();
  });

  it("does not hide a real V2 snapshot failure behind the legacy endpoint", async () => {
    const request = vi.fn(async () => {
      throw new GatewayRequestError({ code: "UNAVAILABLE", message: "collector unavailable" });
    });
    const host = state(request);

    await loadOperationsRoom(host);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("operations.snapshot.v2", { includeProcesses: true });
    expect(host.operationsSnapshot).toBeNull();
    expect(host.operationsError).toContain("collector unavailable");
  });

  it("does not treat a method-specific V2 validation failure as legacy incompatibility", async () => {
    const request = vi.fn(async () => {
      throw new GatewayRequestError({
        code: "INVALID_REQUEST",
        message: "operations.snapshot.v2 rejected invalid parameters",
      });
    });
    const host = state(request);

    await loadOperationsRoom(host);

    expect(request).toHaveBeenCalledTimes(1);
    expect(host.operationsSnapshot).toBeNull();
    expect(host.operationsError).toContain("rejected invalid parameters");
  });

  it("previews, confirms, applies, and refreshes a guarded action", async () => {
    const preview: OperationsActionPreview = {
      token: "preview-1",
      action: "cron.disable",
      targetId: "cron-1",
      summary: "Pause cron-1.",
      risk: "high",
      expiresAt: Date.now() + 60_000,
      requiresConfirmation: true,
    };
    const receipt: OperationsActionReceipt = {
      action: preview.action,
      targetId: preview.targetId,
      status: "applied",
      summary: "Paused cron-1.",
      appliedAt: Date.now(),
    };
    const snapshot = createOperationsTestSnapshot(123);
    const request = vi
      .fn()
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce(receipt)
      .mockResolvedValueOnce(snapshot);
    const host = state(request);
    const confirm = vi.fn(async () => true);

    await runGuardedOperationsAction(host, {
      action: preview.action,
      targetId: preview.targetId,
      confirm,
    });

    expect(confirm).toHaveBeenCalledWith(preview);
    expect(request.mock.calls).toEqual([
      ["operations.action.preview", { action: "cron.disable", targetId: "cron-1" }],
      [
        "operations.action.apply",
        { token: "preview-1", action: "cron.disable", targetId: "cron-1" },
      ],
      ["operations.snapshot.v2", { includeProcesses: true }],
    ]);
    expect(host.operationsActionNotice).toBe("Paused cron-1.");
    expect(host.operationsActionNoticeTone).toBe("success");
    expect(host.operationsActionBusy).toBe(false);
  });

  it("runs a non-mutating investigation with one click", async () => {
    const preview: OperationsActionPreview = {
      token: "preview-investigation",
      action: "remediation.investigate",
      targetId: "plugin:example:failed",
      summary: "Run a bounded local-AI investigation.",
      risk: "low",
      expiresAt: Date.now() + 60_000,
      requiresConfirmation: true,
    };
    const receipt: OperationsActionReceipt = {
      action: preview.action,
      targetId: preview.targetId,
      status: "applied",
      summary: "Investigation complete.",
      appliedAt: Date.now(),
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce(receipt)
      .mockResolvedValueOnce(createOperationsTestSnapshot(123));
    const host = state(request);
    const confirm = vi.fn(() => false);

    await runGuardedOperationsAction(host, {
      action: preview.action,
      targetId: preview.targetId,
      confirm,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(3);
    expect(host.operationsActionNotice).toBe("Investigation complete.");
    expect(host.operationsActionNoticeTone).toBe("success");
  });

  it("does not apply an action when confirmation is declined", async () => {
    const preview = {
      token: "preview-1",
      action: "flow.cancel",
      targetId: "flow-1",
      summary: "Cancel flow-1.",
      risk: "high",
      expiresAt: Date.now() + 60_000,
      requiresConfirmation: true,
    } satisfies OperationsActionPreview;
    const request = vi.fn(async () => preview);
    const host = state(request);

    await runGuardedOperationsAction(host, {
      action: preview.action,
      targetId: preview.targetId,
      confirm: () => false,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(host.operationsActionNotice).toBe("Action cancelled. Nothing changed.");
    expect(host.operationsActionNoticeTone).toBe("info");
  });

  it.each(["rejected", "failed"] as const)(
    "surfaces a %s action receipt as an error instead of success",
    async (status) => {
      const preview = {
        token: "preview-1",
        action: "cron.run",
        targetId: "cron-1",
        summary: "Run cron-1.",
        risk: "low",
        expiresAt: Date.now() + 60_000,
        requiresConfirmation: true,
      } satisfies OperationsActionPreview;
      const receipt = {
        action: preview.action,
        targetId: preview.targetId,
        status,
        summary: `Action ${status}.`,
        appliedAt: Date.now(),
      } satisfies OperationsActionReceipt;
      const request = vi.fn().mockResolvedValueOnce(preview).mockResolvedValueOnce(receipt);
      const host = state(request);

      await runGuardedOperationsAction(host, {
        action: preview.action,
        targetId: preview.targetId,
        confirm: () => true,
      });

      expect(request).toHaveBeenCalledTimes(2);
      expect(host.operationsActionNotice).toBeNull();
      expect(host.operationsActionNoticeTone).toBeNull();
      expect(host.operationsError).toBe(`Action ${status}.`);
      expect(host.operationsActionBusy).toBe(false);
    },
  );

  it("keeps the last successful snapshot and marks it stale when refresh fails", async () => {
    const previous = createOperationsTestSnapshot(123);
    const request = vi.fn(async () => {
      throw new Error("Gateway unavailable");
    });
    const host = state(request);
    host.operationsSnapshot = previous;
    host.operationsUpdatedAt = previous.generatedAt;
    host.operationsLastSuccessfulAt = 456;

    await loadOperationsRoom(host);

    expect(host.operationsSnapshot).toBe(previous);
    expect(host.operationsUpdatedAt).toBe(previous.generatedAt);
    expect(host.operationsLastSuccessfulAt).toBe(456);
    expect(host.operationsRefreshFailedAt).toEqual(expect.any(Number));
    expect(host.operationsError).toBe("Gateway unavailable");
  });

  it("keeps the last truthful snapshot when a V2 response contradicts its collection counts", async () => {
    const previous = createOperationsTestSnapshot(100);
    const invalid = createOperationsTestSnapshot(200);
    invalid.collections.agents.shown += 1;
    const request = vi.fn(async () => invalid);
    const host = state(request);
    host.operationsSnapshot = previous;
    host.operationsUpdatedAt = previous.generatedAt;

    await loadOperationsRoom(host);

    expect(host.operationsSnapshot).toBe(previous);
    expect(host.operationsUpdatedAt).toBe(100);
    expect(host.operationsError).toContain("invalid Operations Room snapshot");
    expect(host.operationsRefreshFailedAt).toEqual(expect.any(Number));
  });
});
