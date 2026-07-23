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

function deviceSurface(width: number, height: number) {
  return surface({
    viewport: { width, height },
    transcriptVisible: true,
    composerVisible: true,
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
      desktop: deviceSurface(1440, 900),
      tablet: deviceSurface(1024, 768),
      mobile: deviceSurface(390, 844),
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
      schemaVersion: 2,
      sourceSha,
      generatedAt: checkedAt,
      sigBackgroundEnabled: true,
      lineage: { status: "ready", sourceSha },
      desktop: { passed: true },
      tablet: { passed: true },
      soak: { durationMs: 300_000 },
    });
  });

  it("rejects mismatched, incomplete, or too-short runtime proof", () => {
    const mismatched = input();
    mismatched.surfaces.mobile.sourceSha = "b".repeat(40);
    expect(() => buildControlDirectorRuntimeProof(mismatched)).toThrow("mobile sourceSha");

    const incompleteTablet = input();
    incompleteTablet.surfaces.tablet.passed = false;
    expect(() => buildControlDirectorRuntimeProof(incompleteTablet)).toThrow(
      "tablet evidence has not passed",
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
    futureSurface.surfaces.desktop.checkedAt = "2026-07-18T00:05:01.000Z";
    expect(() => buildControlDirectorRuntimeProof(futureSurface)).toThrow(
      "desktop evidence cannot postdate generatedAt",
    );
  });
});
