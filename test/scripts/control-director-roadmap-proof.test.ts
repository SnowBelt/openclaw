import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  controlDirectorSourceProofMatchesRoot,
  validateControlDirectorRoadmap,
} from "../../scripts/control-director-roadmap-proof.mjs";

const sourceSha = "a".repeat(40);
const selectedModel = "ollama/openclaw-control-gemma4-31b-q8:latest";
const checkedAt = "2026-07-19T12:05:00.000Z";

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
  milestone61!.evidence = ["binding:updateSurvival", "test:update-survival"];
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
    commands: [
      { id: "tests", status: "passed" },
      { id: "update-survival", status: "passed" },
    ],
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
    facts: [{ id: "all", passed: true }],
    checkedAt,
    evidenceRefs: ["config/custom-runtime-capabilities.json"],
    passed: true,
  };
}

function runtimeProof() {
  const surface = {
    sourceSha,
    passed: true,
    checkedAt,
    evidenceRefs: ["artifact:synthetic"],
  };
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
    generatedAt: checkedAt,
    sigBackgroundEnabled: true,
    lineage: {
      status: "ready",
      sourceSha,
      selectedModel,
      artifactHash: "b".repeat(64),
      canary: { sourceSha, uiBuildId: "b".repeat(64) },
    },
    artifacts: { lineage: { sha256: "c".repeat(64) } },
    desktop: { ...surface },
    tablet: { ...surface },
    mobile: { ...surface },
    restartRecovery: { ...surface },
    soak: {
      ...surface,
      durationMs: 300_000,
      startedAt: "2026-07-19T12:00:00.000Z",
      endedAt: checkedAt,
    },
    rollback: { ...surface },
    liveDiagnostic: { ...surface },
    modelEval: {
      schemaVersion: 1,
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
  const gate = {
    status: "completed",
    conclusion: "success",
    headSha: sourceSha,
    acceptedJobs: 3,
    totalJobs: 3,
  };
  return {
    sourceSha,
    passed: true,
    workflowSanity: gate,
    nonAndroidCi: gate,
    landing: { merged: true, mergeSha: sourceSha },
  };
}

function readiness() {
  return {
    schemaVersion: 2,
    sourceSha,
    expectedSha: sourceSha,
    selectedModel,
    sourceReady: true,
    productionReady: true,
    passPercent: 100,
    mode: "production",
    facts: [{ id: "all", passed: true, critical: true }],
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

  it("accepts only the complete 61-milestone exact-proof ledger", () => {
    expect(validate()).toMatchObject({
      milestoneCount: 61,
      passedMilestones: 61,
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

    const unbound = roadmap() as {
      milestones: Array<{ id: string; evidence: string[] }>;
    };
    unbound.milestones.find((milestone) => milestone.id === "M61")!.evidence = [
      "binding:sourceProof",
      "test:update-survival",
    ];
    expect(() => validate(unbound)).toThrow("M61 is not bound to update-survival proof");
  });
});
