import { describe, expect, it } from "vitest";
import { buildControlDirectorRuntimeProof } from "../../scripts/control-director-runtime-proof.js";

const sourceSha = "a".repeat(40);
const checkedAt = "2026-07-18T00:05:00.000Z";

function surface(extra: Record<string, unknown> = {}) {
  return {
    passed: true,
    sourceSha,
    checkedAt,
    evidenceRefs: ["artifact:test"],
    ...extra,
  };
}

function macStudioDashboardSurface(width: number, height: number) {
  return surface({
    platform: "mac-studio",
    host: {
      hardwareClass: "Mac Studio",
      osName: "macOS",
      osVersion: "15.6",
      architecture: "arm64",
      hostIdentitySha256: "c".repeat(64),
    },
    browserName: "Chrome",
    browserVersion: "140.0.0",
    viewport: { width, height },
    transcriptVisible: true,
    composerVisible: true,
    keyboardPassed: true,
    accessibilityPassed: true,
    pccOverlapFree: true,
    truthCompletionOverlapFree: true,
  });
}

function latencySample(substantiveResponseMs: number) {
  return {
    ackMs: 100,
    firstActivityMs: 500,
    maximumActivityGapMs: 1_000,
    cancelAckMs: 200,
    substantiveResponseMs,
  };
}

function input() {
  return {
    sourceSha,
    lineageReceipt: {
      ...surface(),
      lineage: { status: "ready", sourceSha },
    },
    modelEval: {
      passed: true,
      exactRuntime: true,
      sourceSha,
      evaluatedAt: checkedAt,
      passRate: 100,
      criticalOmissions: 0,
      coveragePassed: true,
    },
    surfaces: {
      macStudioDashboard: macStudioDashboardSurface(1440, 900),
      localModelRouting: surface({
        route: "local",
        modelRef: "ollama/qwen3.6:27b-q8_0",
        qualityScore: 95,
      }),
      localModelLatency: surface({
        cold: latencySample(20_000),
        warm: latencySample(7_000),
      }),
      memory: surface({
        recentRecallTopK: 3,
        recallPassed: true,
        provenanceVerified: true,
      }),
      delegation: surface({
        controlDirectorRunId: "run-director",
        programManagerRunId: "run-program-manager",
        workerRunId: "run-worker",
        taskRootVerified: true,
        handoffVerified: true,
      }),
      judge: surface({
        receiptId: "judge-receipt",
        independent: true,
        signatureVerified: true,
        claimBound: true,
      }),
      sig: surface({
        auditEventId: "sig-event",
        ingested: true,
        routed: true,
        backgroundEnabled: true,
      }),
      pcc: surface({
        projectId: "pcc-project",
        stateConsistent: true,
        evidenceProjectionVerified: true,
      }),
      queue: surface({
        queuedTurnId: "queued-turn",
        accepted: true,
        processed: true,
        orderPreserved: true,
      }),
      steer: surface({
        steerTurnId: "steer-turn",
        accepted: true,
        applied: true,
        activeRunPreserved: true,
      }),
      cancel: surface({
        cancelId: "cancel-run",
        accepted: true,
        workStopped: true,
        staleRunningCleared: true,
      }),
      pursueGoal: surface({
        goalId: "goal-run",
        leaseObserved: true,
        progressObserved: true,
        resumeVerified: true,
        stopVerified: true,
      }),
      restartRecovery: surface({
        restartId: "restart-run",
        serviceHealthy: true,
        goalRecovered: true,
        pendingTurnsRecovered: true,
      }),
      soak: surface({
        durationMs: 300_000,
        startedAt: "2026-07-18T00:00:00.000Z",
        endedAt: checkedAt,
      }),
      rollback: surface({
        rollbackSha: "b".repeat(40),
        restored: true,
        serviceHealthy: true,
      }),
      liveDiagnostic: surface({
        sessionId: "live-session",
        ackObserved: true,
        activityObserved: true,
        finalResponseReceived: true,
      }),
    },
    generatedAt: checkedAt,
  };
}

describe("Control Director runtime proof assembler", () => {
  it("assembles exact-SHA evidence only after every runtime surface passes", () => {
    expect(buildControlDirectorRuntimeProof(input())).toMatchObject({
      schemaVersion: 3,
      sourceSha,
      generatedAt: checkedAt,
      sigBackgroundEnabled: true,
      lineage: { status: "ready", sourceSha },
      macStudioDashboard: {
        passed: true,
        platform: "mac-studio",
        host: { hardwareClass: "Mac Studio", architecture: "arm64" },
      },
      soak: { durationMs: 300_000 },
    });
  });

  it("rejects mismatched, incomplete, or too-short runtime proof", () => {
    const mismatched = input();
    mismatched.surfaces.macStudioDashboard.sourceSha = "b".repeat(40);
    expect(() => buildControlDirectorRuntimeProof(mismatched)).toThrow(
      "macStudioDashboard sourceSha",
    );

    const incompleteDashboard = input();
    incompleteDashboard.surfaces.macStudioDashboard.passed = false;
    expect(() => buildControlDirectorRuntimeProof(incompleteDashboard)).toThrow(
      "macStudioDashboard evidence has not passed",
    );

    const wrongHost = input();
    wrongHost.surfaces.macStudioDashboard.host.hardwareClass = "MacBook Pro";
    expect(() => buildControlDirectorRuntimeProof(wrongHost)).toThrow(
      "arm64 Mac Studio running macOS",
    );

    const short = input();
    short.surfaces.soak.durationMs = 299_999;
    expect(() => buildControlDirectorRuntimeProof(short)).toThrow("at least 300000ms");

    const partialEval = input();
    partialEval.modelEval.coveragePassed = false;
    expect(() => buildControlDirectorRuntimeProof(partialEval)).toThrow("full coverage");

    const invalidTimestamp = input();
    invalidTimestamp.generatedAt = "not-a-timestamp";
    expect(() => buildControlDirectorRuntimeProof(invalidTimestamp)).toThrow(
      "generatedAt must be a valid timestamp",
    );

    const disabledSigBackground = input();
    disabledSigBackground.surfaces.sig.backgroundEnabled = false;
    expect(() => buildControlDirectorRuntimeProof(disabledSigBackground)).toThrow(
      "sig.backgroundEnabled must be true",
    );

    const futureSurface = input();
    futureSurface.surfaces.macStudioDashboard.checkedAt = "2026-07-18T00:05:01.000Z";
    expect(() => buildControlDirectorRuntimeProof(futureSurface)).toThrow(
      "macStudioDashboard evidence cannot postdate generatedAt",
    );
  });
});
