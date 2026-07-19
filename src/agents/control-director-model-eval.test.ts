import { describe, expect, it } from "vitest";
import {
  buildControlDirectorModelEvalMatrix,
  CONTROL_DIRECTOR_EVAL_TASK_CLASSES,
  evaluateControlDirectorModelTrial,
  parseControlDirectorModelEvalTrials,
  type ControlDirectorModelEvalTrial,
} from "./control-director-model-eval.js";

function trial(
  overrides: Partial<ControlDirectorModelEvalTrial> = {},
): ControlDirectorModelEvalTrial {
  return {
    trialId: "trial-1",
    modelRef: "ollama/openclaw-control-gemma4-31b-q8:latest",
    route: "local",
    taskClass: "verification",
    cold: false,
    ackMs: 100,
    firstActivityMs: 500,
    maximumActivityGapMs: 10_000,
    cancelAckMs: 300,
    substantiveResponseMs: 5_000,
    instructionCoveragePercent: 100,
    recentRecallTop3: true,
    missionContinuity: true,
    completionProofValid: true,
    layoutVisible: true,
    peakCpuPercent: 500,
    peakMemoryGb: 40,
    thermalPressure: "nominal",
    evidenceRefs: [
      "latency:run-1",
      "recall:test-1",
      "coverage:test-2",
      "mission:test-3",
      "judge:receipt-1",
      "layout:screenshot-1",
      "resource:sample-1",
    ],
    ...overrides,
  };
}

function completeTrials(): ControlDirectorModelEvalTrial[] {
  return CONTROL_DIRECTOR_EVAL_TASK_CLASSES.flatMap((taskClass) => [
    trial({ trialId: `${taskClass}-cold`, taskClass, cold: true, substantiveResponseMs: 20_000 }),
    trial({ trialId: `${taskClass}-warm`, taskClass, cold: false }),
  ]);
}

describe("Control Director model evaluation matrix", () => {
  it("admits only exact-runtime trials passing quality, latency, memory, and resource gates", () => {
    const matrix = buildControlDirectorModelEvalMatrix({
      trials: completeTrials(),
      exactRuntime: true,
      sourceSha: "a".repeat(40),
      evaluatedAt: "2026-07-18T00:00:00.000Z",
    });
    expect(matrix).toMatchObject({
      passed: true,
      passRate: 100,
      criticalOmissions: 0,
      coveragePassed: true,
    });
    expect(matrix.admittedModels).toEqual(["ollama/openclaw-control-gemma4-31b-q8:latest"]);
  });

  it("fails closed on critical omissions, thermal pressure, and deterministic-only evidence", () => {
    const failed = evaluateControlDirectorModelTrial(
      trial({ completionProofValid: false, thermalPressure: "critical" }),
    );
    expect(failed.passed).toBe(false);
    expect(failed.blockers).toContain("critical thermal pressure");
    expect(failed.quality.criticalOmissions.map((entry) => entry.metric)).toContain(
      "completion_proof",
    );
    expect(
      buildControlDirectorModelEvalMatrix({ trials: [trial()], exactRuntime: false }).passed,
    ).toBe(false);
  });

  it("rejects a model trial that exceeds the bounded model-process memory budget", () => {
    const failed = evaluateControlDirectorModelTrial(trial({ peakMemoryGb: 49 }));
    expect(failed.passed).toBe(false);
    expect(failed.blockers).toContain("peak memory 49GB exceeds 48GB");
  });

  it("rejects a model until every required task class has both cold and warm evidence", () => {
    const matrix = buildControlDirectorModelEvalMatrix({
      trials: [trial()],
      exactRuntime: true,
      sourceSha: "a".repeat(40),
    });
    expect(matrix.coveragePassed).toBe(false);
    expect(matrix.coverageBlockers).toContain(
      "ollama/openclaw-control-gemma4-31b-q8:latest: missing cold conversation trial",
    );
    expect(matrix.admittedModels).toEqual([]);
    expect(matrix.passed).toBe(false);
  });

  it("parses untrusted trial JSON and rejects malformed, duplicate, or unproved trials", () => {
    const parsed = parseControlDirectorModelEvalTrials(completeTrials());
    expect(parsed).toHaveLength(12);

    expect(() => parseControlDirectorModelEvalTrials([{ ...trial(), ackMs: -1 }])).toThrow(
      "ackMs must be a finite number",
    );
    expect(() => parseControlDirectorModelEvalTrials([trial(), trial()])).toThrow(
      "Duplicate model-evaluation trialId",
    );

    const unproved = evaluateControlDirectorModelTrial(trial({ evidenceRefs: ["latency:run-1"] }));
    expect(unproved.passed).toBe(false);
    expect(unproved.blockers).toContain("missing resource: exact-runtime evidence reference");
  });
});
