import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  controlDirectorSourceProofMatchesRoot,
  summarizeControlDirectorProgress,
  validateControlDirectorRoadmap,
} from "../../scripts/control-director-roadmap-proof.mjs";

const sourceSha = "a".repeat(40);
const selectedModel = "ollama/openclaw-control-gemma4-31b-q8:latest";
const sourceCheckedAt = "2026-07-19T12:05:00.000Z";
const runtimeCheckedAt = "2026-07-21T02:05:00.000Z";
const readinessCheckedAt = "2026-07-21T02:10:00.000Z";
const modelGovernanceCheckedAt = "2026-07-21T02:15:00.000Z";
const stabilityCheckedAt = "2026-07-22T02:20:00.000Z";

function roadmap(): Record<string, unknown> {
  const value = JSON.parse(
    fs.readFileSync(path.resolve("work/control-director/reliability-v1/roadmap.json"), "utf8"),
  ) as Record<string, unknown>;
  value.evidenceBinding = {
    sourceProof: ".artifacts/control-director/source-gates-<source-sha>.json",
    updateSurvival: ".artifacts/control-director/update-survival-<source-sha>.json",
    runtimeProof: ".artifacts/control-director/runtime-<source-sha>/runtime-proof.json",
    localValidationProof: ".artifacts/control-director/mac-studio-validation-<source-sha>.json",
    readiness: ".artifacts/control-director/runtime-<source-sha>/readiness.json",
    modelGovernanceProof: ".artifacts/control-director/model-governance-<source-sha>.json",
    stabilityProof: ".artifacts/control-director/stability-<source-sha>.json",
    finalReceipt: ".artifacts/control-director/final-ledger-<source-sha>.json",
  };
  for (const milestone of value.milestones as Array<Record<string, unknown>>) {
    milestone.status = "passed";
    milestone.implementationStatus = "implemented";
    milestone.certificationStatus = "passed";
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
    "binding:localValidationProof",
    "binding:readiness",
    "runtime:end-to-end-orchestration",
  ];
  const milestone85 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M85",
  );
  milestone85!.evidence = [
    "binding:runtimeProof",
    "binding:readiness",
    "runtime:managed-certification",
  ];
  const milestone86 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M86",
  );
  milestone86!.evidence = [
    "binding:sourceProof",
    "binding:updateSurvival",
    "binding:runtimeProof",
    "binding:localValidationProof",
    "binding:readiness",
    "runtime:final-ledger",
  ];
  for (const milestone of (value.milestones as Array<Record<string, unknown>>).filter(
    (entry) => typeof entry.id === "string" && /^M(?:8[7-9]|9[0-9]|10[0-2])$/u.test(entry.id),
  )) {
    milestone.evidence = [
      "binding:modelGovernanceProof",
      "source:model-governance-contract",
      "test:model-governance",
    ];
  }
  for (const milestone of (value.milestones as Array<Record<string, unknown>>).filter(
    (entry) => typeof entry.id === "string" && /^M10[3-5]$/u.test(entry.id),
  )) {
    milestone.evidence = ["binding:stabilityProof", "source:stability-contract", "test:stability"];
  }
  const milestone106 = (value.milestones as Array<Record<string, unknown>>).find(
    (milestone) => milestone.id === "M106",
  );
  milestone106!.evidence = [
    "binding:sourceProof",
    "binding:updateSurvival",
    "binding:runtimeProof",
    "binding:localValidationProof",
    "binding:readiness",
    "binding:modelGovernanceProof",
    "binding:stabilityProof",
    "runtime:durable-final-ledger",
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
  const macStudioDashboardSurface = (width: number, height: number) => ({
    ...surface,
    platform: "mac-studio",
    host: {
      hardwareClass: "Mac Studio",
      osName: "macOS",
      osVersion: "15.6",
      architecture: "arm64",
      hostIdentitySha256: "e".repeat(64),
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
    schemaVersion: 3,
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
    macStudioDashboard: macStudioDashboardSurface(1440, 900),
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

function localValidationProof() {
  const gates = [
    "targeted-tests",
    "source-check",
    "full-tests",
    "workflow-sanity",
    "build",
    "browser-mac-studio",
    "independent-review",
  ].map((id) => ({
    id,
    sourceSha,
    execution: "mac-studio-local",
    command: `local:${id}`,
    status: "passed",
    checkedAt: "2026-07-21T01:00:00.000Z",
    evidenceRefs: [`artifact:${id}`],
  }));
  return {
    schema: "openclaw.control-director-mac-studio-local-validation.v1",
    sourceSha,
    generatedAt: "2026-07-21T01:05:00.000Z",
    platform: "mac-studio",
    remoteExecutionRequired: false,
    host: {
      hardwareClass: "Mac Studio",
      osName: "macOS",
      osVersion: "15.6",
      architecture: "arm64",
      hostIdentitySha256: "e".repeat(64),
    },
    evidenceRefs: ["artifact:mac-studio-local-validation", "github:pr:33"],
    passed: true,
    gates,
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
    "runtime-macStudioDashboard",
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

function modelGovernanceProof() {
  const requiredFacts = [
    "M87-model-admission-identity",
    "M88-evidence-invalidation-graph",
    "M89-transactional-model-config",
    "M90-residency-lease-prewarm",
    "M91-latency-phase-telemetry",
    "M92-qualified-local-fallback",
    "M93-proof-gated-quality-cascade",
    "M94-bounded-shadow-challenger",
    "M95-judge-diversity",
    "M96-statistical-evaluation",
    "M97-cache-identity",
    "M98-immutable-runtime-invocation",
    "M99-pcc-observability",
    "M100-sig-incidents",
    "M101-proof-planner",
    "M102-workflow-skill-convergence",
  ];
  return {
    schema: "openclaw.control-director-model-governance-proof.v1",
    sourceSha,
    generatedAt: modelGovernanceCheckedAt,
    passed: true,
    requiredQualityScore: 93,
    minimumQualityScore: 100,
    failedCritical: [],
    evidenceRefs: ["artifact:model-governance"],
    modelIdentity: {
      sourceSha,
      selectedModel,
      identityDigest: "e".repeat(64),
      configDigest: "f".repeat(64),
    },
    statisticalEvaluation: {
      trialCount: 48,
      passRate: 100,
      criticalOmissions: 0,
      minimumQualityScore: 100,
    },
    facts: requiredFacts.map((id) => ({
      id,
      passed: true,
      checkedAt: modelGovernanceCheckedAt,
      evidenceRefs: ["artifact:model-governance"],
      qualityScore: 100,
    })),
  };
}

function stabilityProof() {
  const requiredFacts = [
    "M103-chaos-suite",
    "M104-fallback-rollback-restoration",
    "M105-extended-monitoring",
    "M106-final-ledger-closure",
  ];
  return {
    schema: "openclaw.control-director-stability-proof.v1",
    sourceSha,
    generatedAt: stabilityCheckedAt,
    passed: true,
    failedCritical: [],
    evidenceRefs: ["artifact:stability"],
    monitoring: {
      activeSoakMinutes: 30,
      passiveMonitorHours: 24,
      routeDriftDetected: false,
      capabilityLossDetected: false,
    },
    restoration: {
      rollbackRestored: true,
      fallbackOrderRestored: true,
      cacheIdentityRestored: true,
      proofStateRestored: true,
    },
    facts: requiredFacts.map((id) => ({
      id,
      passed: true,
      checkedAt: stabilityCheckedAt,
      evidenceRefs: ["artifact:stability"],
    })),
  };
}

function validate(value = roadmap()) {
  return validateControlDirectorRoadmap({
    roadmap: value,
    sourceSha,
    sourceProof: sourceProof(),
    updateSurvival: updateSurvival(),
    runtimeProof: runtimeProof(),
    localValidationProof: localValidationProof(),
    readiness: readiness(),
    modelGovernanceProof: modelGovernanceProof(),
    stabilityProof: stabilityProof(),
  });
}

describe("Control Director final roadmap proof", () => {
  it("requires the source receipt to name the current canonical source root", () => {
    expect(controlDirectorSourceProofMatchesRoot("/tmp/repo", "/tmp/repo")).toBe(true);
    expect(controlDirectorSourceProofMatchesRoot("/tmp/other", "/tmp/repo")).toBe(false);
    expect(controlDirectorSourceProofMatchesRoot(undefined, "/tmp/repo")).toBe(false);
  });

  it("accepts only the complete 106-milestone exact-proof ledger", () => {
    expect(validate()).toMatchObject({
      milestoneCount: 106,
      passedMilestones: 106,
      implementedMilestones: 106,
      certifiedMilestones: 106,
      implementationPercent: 100,
      certificationPercent: 100,
      weightedCompletionPercent: 100,
      minimumQualityScore: 100,
      requiredQualityScore: 93,
    });
  });

  it("rejects a pending milestone, missing evidence, stale SHA, or weak quality", () => {
    const pending = structuredClone(roadmap()) as {
      milestones: Array<{
        certificationStatus: string;
        status: string;
        evidence: string[];
      }>;
    };
    pending.milestones[0]!.status = "pending";
    pending.milestones[0]!.certificationStatus = "pending";
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
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
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
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
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
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
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
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
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
        localValidationProof: localValidationProof(),
        readiness: weakReadiness,
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
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
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("clean exact-identity v2 pass");
  });

  it("reports implementation and certification coverage separately", () => {
    const pending = JSON.parse(
      fs.readFileSync(path.resolve("work/control-director/reliability-v1/roadmap.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(summarizeControlDirectorProgress(pending)).toMatchObject({
      milestoneCount: 106,
      implementedMilestones: 38,
      certifiedMilestones: 4,
      implementationPercent: 35.85,
      certificationPercent: 3.77,
    });
  });

  it("rejects contradictory progress, missing execution milestones, and dependency cycles", () => {
    const contradictory = structuredClone(roadmap()) as {
      milestones: Array<{ certificationStatus: string; status: string }>;
    };
    contradictory.milestones[68]!.status = "pending";
    expect(() => summarizeControlDirectorProgress(contradictory)).toThrow(
      "M69 status does not mirror certificationStatus",
    );

    const missingExecution = structuredClone(roadmap()) as {
      executionWaves: Array<{ milestones: string[] }>;
    };
    missingExecution.executionWaves.at(-1)!.milestones = [];
    expect(() => summarizeControlDirectorProgress(missingExecution)).toThrow(
      "Execution waves omit expanded milestones: M103",
    );

    const cyclic = structuredClone(roadmap()) as {
      milestones: Array<{ dependsOn: string[] }>;
    };
    cyclic.milestones[0]!.dependsOn = ["M106"];
    cyclic.milestones[105]!.dependsOn.push("M01");
    expect(() => summarizeControlDirectorProgress(cyclic)).toThrow(
      "dependency graph contains a cycle",
    );
  });

  it("rejects abbreviated or unauditable Mac Studio-local validation evidence", () => {
    const abbreviatedLocal = localValidationProof();
    abbreviatedLocal.gates = abbreviatedLocal.gates.filter((gate) => gate.id !== "workflow-sanity");
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: abbreviatedLocal,
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("does not contain every exact-SHA all-passed local gate");

    const unboundLanding = localValidationProof();
    unboundLanding.landing.evidenceRefs = [];
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: unboundLanding,
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("Landing does not bind the exact locally validated source SHA");
  });

  it("rejects remote certification policy and non-Mac-Studio local evidence", () => {
    const remoteRoadmap = roadmap() as {
      completionPolicy: { remoteExecutionRequired: boolean; truthSurfaces: string[] };
    };
    remoteRoadmap.completionPolicy.remoteExecutionRequired = true;
    remoteRoadmap.completionPolicy.truthSurfaces.push("remote-ci");
    expect(() => validate(remoteRoadmap)).toThrow(
      "Roadmap completion policy is weaker than the required contract",
    );

    const wrongHost = localValidationProof();
    wrongHost.host.hardwareClass = "MacBook Pro";
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: wrongHost,
        readiness: readiness(),
      }),
    ).toThrow("privacy-safe arm64 Mac Studio identity");
  });

  it("rejects proof assembled out of source, local validation, landing, and runtime order", () => {
    const lateSource = sourceProof();
    lateSource.completedAt = "2026-07-21T01:06:00.000Z";
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: lateSource,
        updateSurvival: updateSurvival(),
        runtimeProof: runtimeProof(),
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("Exact-source proof must complete before the local validation bundle");

    const preLandingRuntime = runtimeProof();
    preLandingRuntime.generatedAt = "2026-07-21T01:03:00.000Z";
    preLandingRuntime.lineage.checkedAt = "2026-07-21T01:03:00.000Z";
    preLandingRuntime.modelEval.evaluatedAt = "2026-07-21T01:03:00.000Z";
    for (const surface of [
      "macStudioDashboard",
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
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
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
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
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
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
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
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
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
        localValidationProof: localValidationProof(),
        readiness: weakReadiness,
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("runtime-update-broker");
  });

  it("independently rejects fabricated runtime-surface passes", () => {
    const obstructed = runtimeProof();
    obstructed.macStudioDashboard.truthCompletionOverlapFree = false;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: obstructed,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("runtimeProof.macStudioDashboard.truthCompletionOverlapFree must be true");

    const unsignedJudge = runtimeProof();
    unsignedJudge.judge.signatureVerified = false;
    expect(() =>
      validateControlDirectorRoadmap({
        roadmap: roadmap(),
        sourceSha,
        sourceProof: sourceProof(),
        updateSurvival: updateSurvival(),
        runtimeProof: unsignedJudge,
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
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
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
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
        localValidationProof: localValidationProof(),
        readiness: readiness(),
        modelGovernanceProof: modelGovernanceProof(),
        stabilityProof: stabilityProof(),
      }),
    ).toThrow("runtimeProof.localModelLatency.warm.ackMs exceeds");
  });
});
