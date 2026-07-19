import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateControlDirectorRoadmap } from "../../scripts/control-director-roadmap-proof.mjs";

const sourceSha = "a".repeat(40);

function roadmap(): Record<string, unknown> {
  const value = JSON.parse(
    fs.readFileSync(path.resolve("work/control-director/reliability-v1/roadmap.json"), "utf8"),
  ) as Record<string, unknown>;
  value.evidenceBinding = {
    sourceProof: ".artifacts/control-director/source-gates-<source-sha>.json",
    runtimeProof: ".artifacts/control-director/runtime-<source-sha>/runtime-proof.json",
    remoteProof: ".artifacts/control-director/remote-gates-<source-sha>.json",
    readiness: ".artifacts/control-director/runtime-<source-sha>/readiness.json",
    finalReceipt: ".artifacts/control-director/final-ledger-<source-sha>.json",
  };
  for (const milestone of value.milestones as Array<Record<string, unknown>>) {
    milestone.status = "passed";
    milestone.evidence = ["binding:sourceProof", "test:synthetic"];
  }
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
    commands: [{ id: "tests", status: "passed" }],
  };
}

function runtimeProof() {
  const surface = { sourceSha, passed: true };
  return {
    schemaVersion: 2,
    sourceSha,
    sigBackgroundEnabled: true,
    desktop: surface,
    tablet: surface,
    mobile: surface,
    restartRecovery: surface,
    soak: surface,
    rollback: surface,
    liveDiagnostic: surface,
    modelEval: {
      passed: true,
      exactRuntime: true,
      passRate: 100,
      criticalOmissions: 0,
      results: [{ quality: { score: 100 } }],
    },
  };
}

function remoteProof() {
  const gate = {
    status: "completed",
    conclusion: "success",
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
    sourceSha,
    sourceReady: true,
    productionReady: true,
    passPercent: 100,
    mode: "production",
  };
}

function validate(value = roadmap()) {
  return validateControlDirectorRoadmap({
    roadmap: value,
    sourceSha,
    sourceProof: sourceProof(),
    runtimeProof: runtimeProof(),
    remoteProof: remoteProof(),
    readiness: readiness(),
  });
}

describe("Control Director final roadmap proof", () => {
  it("accepts only the complete 60-milestone exact-proof ledger", () => {
    expect(validate()).toMatchObject({
      milestoneCount: 60,
      passedMilestones: 60,
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
        runtimeProof: weakRuntime,
        remoteProof: remoteProof(),
        readiness: readiness(),
      }),
    ).toThrow("quality score");
  });
});
