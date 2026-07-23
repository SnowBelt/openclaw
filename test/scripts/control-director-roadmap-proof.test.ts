import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  controlDirectorSourceProofMatchesRoot,
  validateControlDirectorRoadmap,
} from "../../scripts/control-director-roadmap-proof.mjs";

const sourceSha = "a".repeat(40);
const selectedModel = "ollama/openclaw-control-gemma4-31b-q8:latest";
const sourceCheckedAt = "2026-07-19T12:05:00.000Z";
const runtimeCheckedAt = "2026-07-21T02:05:00.000Z";
const readinessCheckedAt = "2026-07-21T02:10:00.000Z";

function roadmap(): Record<string, unknown> {
  const value = JSON.parse(
    fs.readFileSync(path.resolve("work/control-director/reliability-v1/roadmap.json"), "utf8"),
  ) as Record<string, unknown>;
  value.evidenceBinding = {
    sourceProof: ".artifacts/control-director/source-gates-<source-sha>.json",
    updateSurvival: ".artifacts/control-director/update-survival-<source-sha>.json",
    runtimeProof: ".artifacts/control-director/runtime-<source-sha>/runtime-proof.json",
    remoteProof: ".artifacts/control-director/remote-gates-<source-sha>.json",
    readiness: ".artifacts/control-director/runtime-<source-sha>/readiness.json",
    finalReceipt: ".artifacts/control-director/final-ledger-<source-sha>.json",
  };
  for (const milestone of value.milestones as Array<Record<string, unknown>>) {
    milestone.status = "passed";
    milestone.evidence = ["binding:sourceProof", "test:synthetic"];
  }
  const milestone61 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M61",
  );
  milestone61!.evidence = [
    "binding:sourceProof",
    "binding:updateSurvival",
    "binding:runtimeProof",
    "binding:readiness",
    "test:update-survival",
    "runtime:update-survival",
  ];
  const milestone66 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M66",
  );
  milestone66!.evidence = ["binding:runtimeProof", "runtime:deployment-consistency"];
  const milestone67 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M67",
  );
  milestone67!.evidence = ["binding:runtimeProof", "runtime:diagnostic-truth"];
  const milestone68 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M68",
  );
  milestone68!.evidence = [
    "binding:sourceProof",
    "binding:updateSurvival",
    "binding:runtimeProof",
    "binding:remoteProof",
    "binding:readiness",
    "runtime:end-to-end-orchestration",
  ];
  return value;
}

function sourceProof() {
  return {
    schemaVersion: 2,
    sourceSha,
    expectedSha: sourceSha,
    sourceRoot: "/tmp/repo",
    sourceClean: true,
    identityVerified: true,
    passed: true,
    generatedAt: sourceCheckedAt,
    completedAt: sourceCheckedAt,
    commands: [
      "protocol-coverage",
      "protocol-generated",
      "torture",
      "chaos",
      "tests",
      "ui-tests",
      "extension-tests",
      "ui-i18n",
      "deployment-consistency",
      "custom-runtime-contracts",
      "update-survival",
      "pcc-contracts",
      "plugin-sdk-api",
      "docs-mdx",
      "docs-links",
      "lint-scripts",
      "format-check",
      "typecheck-core",
      "typecheck-ui",
      "typecheck-extensions",
      "build",
    ].map((id) => ({ id, status: "passed" })),
  };
}

function updateSurvival() {
  return {
    schema: "openclaw.custom-runtime-update-survival.v1",
    mode: "source-contract",
    sourceSha,
    sourceClean: true,
    contractVersion: 2,
    sourceStrategy: "merge_from_active_sha",
    dashboardChangePolicy: "register_verify_and_block",
    approvalPolicy: "explicit_exact_candidate",
    proofCommand: "pnpm custom-runtime:update-survival",
    manifestVersion: 5,
    manifestSha256: "d".repeat(64),
    verificationCommands: [
      "pnpm check:custom-runtime-capabilities",
      "pnpm check:pcc-capabilities",
      "pnpm control-director:verify -- --expected-sha <candidate-sha>",
      "pnpm check",
      "pnpm ui:build",
      "pnpm build",
      "pnpm ui:smoke:dashboard --artifact-profile release --artifact-root .artifacts/custom-runtime-update",
    ],
    facts: [
      "capability-manifest",
      "exact-parent-update-broker",
      "proof-bound-approval",
      "managed-stage-and-rollback",
      "managed-runtime-guard",
      "workflow-sanity",
      "control-director-readiness",
      "reliability-skill",
      "M61-roadmap",
    ].map((id) => ({ id, passed: true })),
    checkedAt: sourceCheckedAt,
    evidenceRefs: ["config/custom-runtime-capabilities.json"],
    passed: true,
  };
}

function runtimeProof() {
  const surface = {
    sourceSha,
    passed: true,
    checkedAt: runtimeCheckedAt,
    evidenceRefs: ["artifact:synthetic"],
  };
  const deviceSurface = (width: number, height: number) => ({
    ...surface,
    viewport: { width, height },
    transcriptVisible: true,
    composerVisible: true,
    pccOverlapFree: true,
    truthCompletionOverlapFree: true,
  });
  const latencySample = (substantiveResponseMs: number) => ({
    ackMs: 100,
    firstActivityMs: 500,
    maximumActivityGapMs: 1_000,
    cancelAckMs: 200,
    substantiveResponseMs,
  });
  const results = [
    "conversation",
    "recall",
    "planning",
    "delegation",
    "steering",
    "verification",
  ].flatMap((taskClass) =>
    [true, false].map((cold) => ({
      trial: {
        trialId: `${taskClass}-${cold ? "cold" : "warm"}`,
        taskClass,
        cold,
        modelRef: selectedModel,
        route: "local",
        evidenceRefs: ["artifact:trial"],
      },
      quality: { score: 100 },
      resourcePassed: true,
      passed: true,
      blockers: [],
    })),
  );
  return {
    schemaVersion: 2,
    sourceSha,
    generatedAt: runtimeCheckedAt,
    sigBackgroundEnabled: true,
    lineage: {
      status: "ready",
      sourceSha,
      checkedAt: runtimeCheckedAt,
      evidenceRefs: ["artifact:lineage"],
      selectedModel,
      artifactHash: "b".repeat(64),
      canary: { sourceSha, uiBuildId: "b".repeat(64) },
    },
    artifacts: { lineage: { sha256: "c".repeat(64) } },
    desktop: deviceSurface(1440, 900),
    tablet: deviceSurface(1024, 768),
    mobile: deviceSurface(390, 844),
    localModelRouting: {
      ...surface,
      route: "local",
      modelRef: selectedModel,
      qualityScore: 100,
    },
    localModelLatency: {
      ...surface,
      cold: latencySample(20_000),
      warm: latencySample(7_000),
    },
    memory: {
      ...surface,
      recentRecallTopK: 3,
      recallPassed: true,
      provenanceVerified: true,
    },
    delegation: {
      ...surface,
      controlDirectorRunId: "run-director",
      programManagerRunId: "run-program-manager",
      workerRunId: "run-worker",
      taskRootVerified: true,
      handoffVerified: true,
    },
    judge: {
      ...surface,
      receiptId: "judge-receipt",
      independent: true,
      signatureVerified: true,
      claimBound: true,
    },
    sig: {
      ...surface,
      auditEventId: "sig-event",
      ingested: true,
      routed: true,
      backgroundEnabled: true,
    },
    pcc: {
      ...surface,
      projectId: "pcc-project",
      stateConsistent: true,
      evidenceProjectionVerified: true,
    },
    queue: {
      ...surface,
      queuedTurnId: "queued-turn",
      accepted: true,
      processed: true,
      orderPreserved: true,
    },
    steer: {
      ...surface,
      steerTurnId: "steer-turn",
      accepted: true,
      applied: true,
      activeRunPreserved: true,
    },
    cancel: {
      ...surface,
      cancelId: "cancel-run",
      accepted: true,
      workStopped: true,
      staleRunningCleared: true,
    },
    pursueGoal: {
      ...surface,
      goalId: "goal-run",
      leaseObserved: true,
      progressObserved: true,
      resumeVerified: true,
      stopVerified: true,
    },
    restartRecovery: {
      ...surface,
      restartId: "restart-run",
      serviceHealthy: true,
      goalRecovered: true,
      pendingTurnsRecovered: true,
    },
    soak: {
      ...surface,
      durationMs: 300_000,
      startedAt: "2026-07-19T12:00:00.000Z",
      endedAt: runtimeCheckedAt,
    },
    rollback: {
      ...surface,
      rollbackSha: "b".repeat(40),
      restored: true,
      serviceHealthy: true,
    },
    liveDiagnostic: {
      ...surface,
      sessionId: "live-session",
      ackObserved: true,
      activityObserved: true,
      finalResponseReceived: true,
    },
    modelEval: {
      schemaVersion: 1,
      evaluatedAt: runtimeCheckedAt,
      passed: true,
      exactRuntime: true,
      sourceSha,
      passRate: 100,
      criticalOmissions: 0,
      coveragePassed: true,
      results,
    },
  };
}

function remoteProof() {
  const jobs = [
    { id: 101, name: "required-check", status: "completed", conclusion: "success" },
    { id: 102, name: "platform-exclusion", status: "completed", conclusion: "skipped" },
    { id: 103, name: "policy-check", status: "completed", conclusion: "success" },
  ];
  const gate = {
    runId: 12_345,
    runUrl: "https://github.com/SnowBelt/openclaw/actions/runs/12345",
    checkedAt: "2026-07-21T01:00:00.000Z",
    evidenceRefs: ["github:run:12345"],
    status: "completed",
    conclusion: "success",
    headSha: sourceSha,
    acceptedJobs: jobs.length,
    totalJobs: jobs.length,
    jobs,
  };
  return {
    schema: "openclaw.control-director-remote-gates.v1",
    sourceSha,
    generatedAt: "2026-07-21T01:05:00.000Z",
    evidenceRefs: ["github:pr:33", "github:run:12345"],
    passed: true,
    workflowSanity: gate,
    nonAndroidCi: gate,
    landing: {
      merged: true,
      mergeSha: sourceSha,
      pullRequest: 33,
      mergedAt: "2026-07-21T01:04:00.000Z",
      evidenceRefs: ["github:pr:33"],
    },
  };
}

function readiness() {
  const requiredFacts = [
    "immutable-source",
    "expected-source",
    "clean-source",
    "canonical-root",
    "wiring-updateSafeCustomizationLifecycle",
    "gate-torture",
    "gate-chaos",
    "gate-chat-stack",
    "gate-typecheck",
    "gate-tests",
    "gate-build",
    "runtime-proof",
    "runtime-proof-contract",
    "runtime-lineage",
    "runtime-sig-background",
    "runtime-update-broker",
    "runtime-recovery-guard",
    "runtime-model-digest",
    "runtime-ollama-env",
    "runtime-model-smoke",
    "runtime-model-eval",
    "runtime-desktop",
    "runtime-tablet",
    "runtime-mobile",
    "runtime-localModelRouting",
    "runtime-localModelLatency",
    "runtime-memory",
    "runtime-delegation",
    "runtime-judge",
    "runtime-sig",
    "runtime-pcc",
    "runtime-queue",
    "runtime-steer",
    "runtime-cancel",
    "runtime-pursueGoal",
    "runtime-restartRecovery",
    "runtime-soak",
    "runtime-rollback",
    "runtime-liveDiagnostic",
  ];
  return {
    schemaVersion: 2,
    generatedAt: readinessCheckedAt,
    sourceSha,
    expectedSha: sourceSha,
    selectedModel,
    sourceReady: true,
    productionReady: true,
    passPercent: 100,
    mode: "production",
    facts: requiredFacts.map((id) => ({ id, passed: true, critical: true })),
    failedCritical: [],
  };
}

function validate(value = roadmap()) {
  return validateControlDirectorRoadmap({
    roadmap: value,
    sourceSha,
    sourceProof: sourceProof(),
    updateSurvival: updateSurvival(),
    runtimeProof: runtimeProof(),
    remoteProof: remoteProof(),
    readiness: readiness(),
  });
}

describe("Control Director final roadmap proof", () => {
  it("requires the source receipt to name the current canonical source root", () => {
    expect(controlDirectorSourceProofMatchesRoot("/tmp/repo", "/tmp/repo")).toBe(true);
    expect(controlDirectorSourceProofMatchesRoot("/tmp/other", "/tmp/repo")).toBe(false);
    expect(controlDirectorSourceProofMatchesRoot(undefined, "/tmp/repo")).toBe(false);
  });

  it("accepts only the complete 68-milestone exact-proof ledger", () => {
    expect(validate()).toMatchObject({
      milestoneCount: 68,
      passedMilestones: 68,
      weightedCompletionPercent: 100,
      minimumQualityScore: 100,
      requiredQualityScore: 93,
    });
  });

  it("rejects a pending milestone, missing evidence, stale SHA, or weak quality", () => {
    const pending = structuredClone(roadmap()) as {
      milestones: Array<{ status: string; evidence: string[] }>;
    };
    pending.milestones[0]!.status = "pending";
    expect(() => validate(pending)).toThrow("M01 is not passed");

    const missingEvidence = structuredClone(roadmap()) as {
      milestones: Array<{ status: string; evidence: string[] }>;
    };
    missingEvidence.milestones[0]!.evidence = [];
    expect(() => validate(missingEvidence)).toThrow("M01 requires at least two");

    const staleSource = sourceProof();
    staleSource.sourceSha = "b".repeat(40);
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: staleSource,
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("sourceProof sourceSha");

    const weakRuntime = runtimeProof();
    weakRuntime.modelEval.results[0]!.quality.score = 92;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: weakRuntime,
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("quality score");

    const staleModelEval = runtimeProof();
    staleModelEval.modelEval.sourceSha = "b".repeat(40);
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: staleModelEval,
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("runtimeProof.modelEval sourceSha");

    const incompleteCoverage = runtimeProof();
    incompleteCoverage.modelEval.results = incompleteCoverage.modelEval.results.slice(1);
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: incompleteCoverage,
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("missing required cold or warm task coverage");

    const weakReadiness = readiness();
    weakReadiness.facts[0]!.passed = false;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        remoteProof: remoteProof(),
        readiness: weakReadiness,
      }),
    ).toThrow("all-passed fact ledger");

    const prematureSource = sourceProof();
    prematureSource.completedAt = "2026-07-17T23:59:59.000Z";
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: prematureSource,
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("clean exact-identity v2 pass");
  });

  it("rejects abbreviated or unauditable remote-gate evidence", () => {
    const abbreviatedRemote = remoteProof();
    abbreviatedRemote.workflowSanity.jobs = [];
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        remoteProof: abbreviatedRemote,
        readiness: readiness(),
      }),
    ).toThrow("workflowSanity is not an all-jobs exact-SHA success");

    const unboundLanding = remoteProof();
    unboundLanding.landing.evidenceRefs = [];
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        remoteProof: unboundLanding,
        readiness: readiness(),
      }),
    ).toThrow("Remote landing does not bind the exact source SHA");
  });

  it("rejects proof assembled out of source, remote, landing, and runtime order", () => {
    const lateSource = sourceProof();
    lateSource.completedAt = "2026-07-21T01:06:00.000Z";
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: lateSource,
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("Exact-source proof must complete before the remote proof bundle");

    const preLandingRuntime = runtimeProof();
    preLandingRuntime.generatedAt = "2026-07-21T01:03:00.000Z";
    preLandingRuntime.lineage.checkedAt = "2026-07-21T01:03:00.000Z";
    preLandingRuntime.modelEval.evaluatedAt = "2026-07-21T01:03:00.000Z";
    for (const surface of [
      "desktop",
      "tablet",
      "mobile",
      "localModelRouting",
      "localModelLatency",
      "memory",
      "delegation",
      "judge",
      "sig",
      "pcc",
      "queue",
      "steer",
      "cancel",
      "pursueGoal",
      "restartRecovery",
      "soak",
      "rollback",
      "liveDiagnostic",
    ] as const) {
      preLandingRuntime[surface].checkedAt = "2026-07-21T01:03:00.000Z";
    }
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: preLandingRuntime,
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("Managed-runtime proof must be measured after exact-SHA landing");
  });

  it("rejects weakened or unbound M61 update-survival evidence", () => {
    const weakened = updateSurvival();
    weakened.dashboardChangePolicy = "ignore";
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: weakened,
        runtimeProof: runtimeProof(),
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("Update-survival proof");

    const abbreviatedSource = sourceProof();
    abbreviatedSource.commands = abbreviatedSource.commands.filter(
      (command) => command.id !== "protocol-coverage",
    );
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: abbreviatedSource,
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("protocol-coverage");

    const abbreviatedUpdate = updateSurvival();
    abbreviatedUpdate.facts = abbreviatedUpdate.facts.filter(
      (fact) => fact.id !== "exact-parent-update-broker",
    );
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: abbreviatedUpdate,
        runtimeProof: runtimeProof(),
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("exact-parent-update-broker");

    const unbound = roadmap() as {
      milestones: Array<{ id: string; evidence: string[] }>;
    };
    unbound.milestones.find((milestone) => milestone.id === "M61")!.evidence = [
      "binding:sourceProof",
      "test:update-survival",
    ];
    expect(() => validate(unbound)).toThrow("M61 is not bound to updateSurvival");

    const weakReadiness = readiness();
    weakReadiness.facts = weakReadiness.facts.filter((fact) => fact.id !== "runtime-update-broker");
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        remoteProof: remoteProof(),
        readiness: weakReadiness,
      }),
    ).toThrow("runtime-update-broker");
  });

  it("independently rejects fabricated runtime-surface passes", () => {
    const obstructed = runtimeProof();
    obstructed.mobile.truthCompletionOverlapFree = false;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: obstructed,
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("runtimeProof.mobile.truthCompletionOverlapFree must be true");

    const unsignedJudge = runtimeProof();
    unsignedJudge.judge.signatureVerified = false;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: unsignedJudge,
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("runtimeProof.judge.signatureVerified must be true");

    const disabledSigBackground = runtimeProof();
    disabledSigBackground.sig.backgroundEnabled = false;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: disabledSigBackground,
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("runtimeProof.sig.backgroundEnabled must be true");

    const slowLocalModel = runtimeProof();
    slowLocalModel.localModelLatency.warm.ackMs = 60_000;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: slowLocalModel,
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("runtimeProof.localModelLatency.warm.ackMs exceeds");
  });
});
