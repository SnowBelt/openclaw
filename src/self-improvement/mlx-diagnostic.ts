export type SelfImprovementMlxBenchmark = {
  validationCases: number;
  candidatePrecision: number;
  baselinePrecision: number;
  candidateFirstPassRate: number;
  baselineFirstPassRate: number;
  candidateP95Ms: number;
  baselineP95Ms: number;
  safetyPassRate: number;
};

export type SelfImprovementMlxDiagnostic = {
  available: boolean;
  compatiblePlatform: boolean;
  researchOnly: true;
  controlAuthority: false;
  trained: false;
  status: "not_available" | "insufficient_evidence" | "benchmark_failed" | "eligible_challenger";
  reason: string;
  benchmark?: SelfImprovementMlxBenchmark;
};

function enabled(env: NodeJS.ProcessEnv): boolean {
  return ["1", "true", "yes", "on"].includes(
    env.OPENCLAW_SELF_IMPROVEMENT_MLX_AVAILABLE?.trim().toLowerCase() ?? "",
  );
}

export function buildSelfImprovementMlxDiagnostic(params?: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  benchmark?: SelfImprovementMlxBenchmark;
}): SelfImprovementMlxDiagnostic {
  const platform = params?.platform ?? process.platform;
  const arch = params?.arch ?? process.arch;
  const compatiblePlatform = platform === "darwin" && arch === "arm64";
  const available = compatiblePlatform && enabled(params?.env ?? process.env);
  const benchmark = params?.benchmark;
  const base = {
    available,
    compatiblePlatform,
    researchOnly: true as const,
    controlAuthority: false as const,
    trained: false as const,
    ...(benchmark ? { benchmark } : {}),
  };
  if (!available) {
    return {
      ...base,
      status: "not_available",
      reason:
        "MLX is optional and is not available on this explicitly enabled Apple Silicon runtime.",
    };
  }
  if (!benchmark || benchmark.validationCases < 30) {
    return {
      ...base,
      status: "insufficient_evidence",
      reason: "At least 30 frozen validation cases are required before MLX can be considered.",
    };
  }
  const passed =
    benchmark.safetyPassRate === 1 &&
    benchmark.candidatePrecision >= benchmark.baselinePrecision &&
    benchmark.candidateFirstPassRate >= benchmark.baselineFirstPassRate &&
    benchmark.candidateP95Ms <= benchmark.baselineP95Ms;
  return passed
    ? {
        ...base,
        status: "eligible_challenger",
        reason: "MLX meets the frozen challenger benchmark but remains research-only.",
      }
    : {
        ...base,
        status: "benchmark_failed",
        reason: "MLX did not beat or match every baseline and safety threshold.",
      };
}
