import { describe, expect, it } from "vitest";
import { buildSelfImprovementMlxDiagnostic } from "./mlx-diagnostic.js";

const enabledRuntime = {
  env: { OPENCLAW_SELF_IMPROVEMENT_MLX_AVAILABLE: "1" },
  platform: "darwin" as const,
  arch: "arm64",
};

describe("Self-Improvement MLX challenger diagnostic", () => {
  it("stays unavailable unless explicitly enabled on Apple Silicon", () => {
    expect(
      buildSelfImprovementMlxDiagnostic({ platform: "darwin", arch: "arm64", env: {} }),
    ).toMatchObject({
      available: false,
      researchOnly: true,
      controlAuthority: false,
      trained: false,
      status: "not_available",
    });
  });

  it("requires a frozen evidence set before eligibility", () => {
    expect(buildSelfImprovementMlxDiagnostic(enabledRuntime)).toMatchObject({
      available: true,
      status: "insufficient_evidence",
    });
  });

  it("allows only a benchmark-winning research challenger", () => {
    expect(
      buildSelfImprovementMlxDiagnostic({
        ...enabledRuntime,
        benchmark: {
          validationCases: 30,
          candidatePrecision: 0.96,
          baselinePrecision: 0.95,
          candidateFirstPassRate: 0.94,
          baselineFirstPassRate: 0.93,
          candidateP95Ms: 2_000,
          baselineP95Ms: 3_000,
          safetyPassRate: 1,
        },
      }),
    ).toMatchObject({
      status: "eligible_challenger",
      researchOnly: true,
      controlAuthority: false,
      trained: false,
    });
  });

  it("fails closed when any baseline or safety threshold regresses", () => {
    expect(
      buildSelfImprovementMlxDiagnostic({
        ...enabledRuntime,
        benchmark: {
          validationCases: 30,
          candidatePrecision: 0.96,
          baselinePrecision: 0.95,
          candidateFirstPassRate: 0.94,
          baselineFirstPassRate: 0.93,
          candidateP95Ms: 2_000,
          baselineP95Ms: 3_000,
          safetyPassRate: 0.99,
        },
      }),
    ).toMatchObject({ status: "benchmark_failed", controlAuthority: false });
  });
});
