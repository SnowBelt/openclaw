import { describe, expect, it } from "vitest";
import {
  assessControlDirectorQuality,
  booleanQualityObservation,
  buildControlDirectorLatencyObservations,
} from "./control-director-quality-rubric.js";

describe("Control Director quality rubric", () => {
  it("passes measured SLOs and the 93-point quality floor", () => {
    const result = assessControlDirectorQuality([
      ...buildControlDirectorLatencyObservations({
        ackMs: 120,
        firstActivityMs: 900,
        maximumActivityGapMs: 10_000,
        cancelAckMs: 500,
        substantiveResponseMs: 6_000,
        cold: false,
        evidencePrefix: "run:1",
      }),
      booleanQualityObservation({
        metric: "instruction_coverage",
        passed: true,
        observed: "60/60 requirements mapped",
        evidenceRef: "coverage:current",
      }),
    ]);

    expect(result).toMatchObject({ passed: true, score: 100, criticalOmissions: [] });
  });

  it("never averages away a critical omission or missing evidence", () => {
    const result = assessControlDirectorQuality([
      ...Array.from({ length: 19 }, (_, index) =>
        booleanQualityObservation({
          metric: "instruction_coverage",
          passed: true,
          observed: "covered",
          evidenceRef: `proof:${index}`,
        }),
      ),
      booleanQualityObservation({
        metric: "completion_proof",
        passed: false,
        observed: "missing Judge receipt",
        evidenceRef: "judge:missing",
      }),
    ]);

    expect(result.score).toBe(95);
    expect(result.passed).toBe(false);
    expect(result.criticalOmissions.map((entry) => entry.metric)).toEqual(["completion_proof"]);

    expect(
      assessControlDirectorQuality([
        booleanQualityObservation({
          metric: "layout_visibility",
          passed: true,
          observed: "visible",
          evidenceRef: "",
        }),
      ]).passed,
    ).toBe(false);
  });
});
