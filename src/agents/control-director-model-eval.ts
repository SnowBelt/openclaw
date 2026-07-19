// Quality, latency, memory, and resource admission for Control Director model routes.
import {
  assessControlDirectorQuality,
  booleanQualityObservation,
  buildControlDirectorLatencyObservations,
  type ControlDirectorQualityAssessment,
} from "./control-director-quality-rubric.js";

export const CONTROL_DIRECTOR_MODEL_EVAL_VERSION = 1 as const;

export type ControlDirectorEvalTaskClass =
  | "conversation"
  | "recall"
  | "planning"
  | "delegation"
  | "steering"
  | "verification";

export const CONTROL_DIRECTOR_EVAL_TASK_CLASSES: readonly ControlDirectorEvalTaskClass[] = [
  "conversation",
  "recall",
  "planning",
  "delegation",
  "steering",
  "verification",
] as const;

export type ControlDirectorModelEvalTrial = {
  trialId: string;
  modelRef: string;
  route: "local" | "codex";
  taskClass: ControlDirectorEvalTaskClass;
  cold: boolean;
  ackMs: number;
  firstActivityMs: number;
  maximumActivityGapMs: number;
  cancelAckMs: number;
  substantiveResponseMs: number;
  instructionCoveragePercent: number;
  recentRecallTop3: boolean;
  missionContinuity: boolean;
  completionProofValid: boolean;
  layoutVisible: boolean;
  peakCpuPercent: number;
  peakMemoryGb: number;
  thermalPressure: "nominal" | "fair" | "serious" | "critical" | "unknown";
  evidenceRefs: string[];
};

export type ControlDirectorModelEvalTrialResult = {
  trial: ControlDirectorModelEvalTrial;
  quality: ControlDirectorQualityAssessment;
  resourcePassed: boolean;
  passed: boolean;
  blockers: string[];
};

export type ControlDirectorModelEvalMatrix = {
  schemaVersion: typeof CONTROL_DIRECTOR_MODEL_EVAL_VERSION;
  evaluatedAt: string;
  sourceSha?: string;
  exactRuntime: boolean;
  passed: boolean;
  passRate: number;
  criticalOmissions: number;
  coveragePassed: boolean;
  coverageBlockers: string[];
  results: ControlDirectorModelEvalTrialResult[];
  admittedModels: string[];
  rejectedModels: string[];
};

const MAX_CPU_PERCENT = 800;
// A 36GB estimated Q8 model gets 12GB process/runtime headroom; host reserve is
// enforced separately by the live resource governor.
const MAX_MEMORY_GB = 48;
const MAX_LATENCY_MS = 60 * 60 * 1_000;
const MAX_REPORTED_CPU_PERCENT = 10_000;
const MAX_REPORTED_MEMORY_GB = 1_024;

const TASK_CLASSES = new Set<ControlDirectorEvalTaskClass>(CONTROL_DIRECTOR_EVAL_TASK_CLASSES);
const THERMAL_PRESSURES = new Set<ControlDirectorModelEvalTrial["thermalPressure"]>([
  "nominal",
  "fair",
  "serious",
  "critical",
  "unknown",
]);

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean.`);
  }
  return value;
}

function boundedNumber(value: unknown, field: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${field} must be a finite number from 0 through ${maximum}.`);
  }
  return value;
}

function parseEvidenceRefs(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of evidence references.`);
  }
  const refs = value.map((entry, index) => requiredString(entry, `${field}[${index}]`));
  if (refs.length === 0 || new Set(refs).size !== refs.length) {
    throw new Error(`${field} must contain unique evidence references.`);
  }
  return refs;
}

/** Parse untrusted runtime-trial JSON before it can influence admission. */
export function parseControlDirectorModelEvalTrials(
  value: unknown,
): ControlDirectorModelEvalTrial[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Model evaluation input must be a non-empty JSON array.");
  }
  const seenTrialIds = new Set<string>();
  return value.map((entry, index) => {
    const record = object(entry);
    if (!record) {
      throw new Error(`trials[${index}] must be a JSON object.`);
    }
    const prefix = `trials[${index}]`;
    const trialId = requiredString(record.trialId, `${prefix}.trialId`);
    if (seenTrialIds.has(trialId)) {
      throw new Error(`Duplicate model-evaluation trialId: ${trialId}.`);
    }
    seenTrialIds.add(trialId);
    const route = requiredString(record.route, `${prefix}.route`);
    if (route !== "local" && route !== "codex") {
      throw new Error(`${prefix}.route must be local or codex.`);
    }
    const taskClass = requiredString(record.taskClass, `${prefix}.taskClass`);
    if (!TASK_CLASSES.has(taskClass as ControlDirectorEvalTaskClass)) {
      throw new Error(`${prefix}.taskClass is not admitted.`);
    }
    const thermalPressure = requiredString(record.thermalPressure, `${prefix}.thermalPressure`);
    if (
      !THERMAL_PRESSURES.has(thermalPressure as ControlDirectorModelEvalTrial["thermalPressure"])
    ) {
      throw new Error(`${prefix}.thermalPressure is not admitted.`);
    }
    return {
      trialId,
      modelRef: requiredString(record.modelRef, `${prefix}.modelRef`),
      route,
      taskClass: taskClass as ControlDirectorEvalTaskClass,
      cold: requiredBoolean(record.cold, `${prefix}.cold`),
      ackMs: boundedNumber(record.ackMs, `${prefix}.ackMs`, MAX_LATENCY_MS),
      firstActivityMs: boundedNumber(
        record.firstActivityMs,
        `${prefix}.firstActivityMs`,
        MAX_LATENCY_MS,
      ),
      maximumActivityGapMs: boundedNumber(
        record.maximumActivityGapMs,
        `${prefix}.maximumActivityGapMs`,
        MAX_LATENCY_MS,
      ),
      cancelAckMs: boundedNumber(record.cancelAckMs, `${prefix}.cancelAckMs`, MAX_LATENCY_MS),
      substantiveResponseMs: boundedNumber(
        record.substantiveResponseMs,
        `${prefix}.substantiveResponseMs`,
        MAX_LATENCY_MS,
      ),
      instructionCoveragePercent: boundedNumber(
        record.instructionCoveragePercent,
        `${prefix}.instructionCoveragePercent`,
        100,
      ),
      recentRecallTop3: requiredBoolean(record.recentRecallTop3, `${prefix}.recentRecallTop3`),
      missionContinuity: requiredBoolean(record.missionContinuity, `${prefix}.missionContinuity`),
      completionProofValid: requiredBoolean(
        record.completionProofValid,
        `${prefix}.completionProofValid`,
      ),
      layoutVisible: requiredBoolean(record.layoutVisible, `${prefix}.layoutVisible`),
      peakCpuPercent: boundedNumber(
        record.peakCpuPercent,
        `${prefix}.peakCpuPercent`,
        MAX_REPORTED_CPU_PERCENT,
      ),
      peakMemoryGb: boundedNumber(
        record.peakMemoryGb,
        `${prefix}.peakMemoryGb`,
        MAX_REPORTED_MEMORY_GB,
      ),
      thermalPressure: thermalPressure as ControlDirectorModelEvalTrial["thermalPressure"],
      evidenceRefs: parseEvidenceRefs(record.evidenceRefs, `${prefix}.evidenceRefs`),
    };
  });
}

function evidence(trial: ControlDirectorModelEvalTrial, suffix: string): string {
  return trial.evidenceRefs.find((ref) => ref.startsWith(`${suffix}:`)) ?? "";
}

function trialEvidenceBlockers(trial: ControlDirectorModelEvalTrial): string[] {
  const required = ["latency", "coverage", "mission", "layout", "resource"];
  if (trial.taskClass === "recall") {
    required.push("recall");
  }
  if (trial.taskClass === "verification") {
    required.push("judge");
  }
  return required.flatMap((kind) =>
    evidence(trial, kind) ? [] : [`missing ${kind}: exact-runtime evidence reference`],
  );
}

export function evaluateControlDirectorModelTrial(
  trial: ControlDirectorModelEvalTrial,
): ControlDirectorModelEvalTrialResult {
  const observations = [
    ...buildControlDirectorLatencyObservations({
      ...trial,
      evidencePrefix: evidence(trial, "latency"),
    }),
    ...(trial.taskClass === "recall"
      ? [
          booleanQualityObservation({
            metric: "recent_recall_top3" as const,
            passed: trial.recentRecallTop3,
            score: trial.recentRecallTop3 ? 100 : 0,
            observed: trial.recentRecallTop3
              ? "relevant source in Top-3"
              : "relevant source missed Top-3",
            evidenceRef: evidence(trial, "recall"),
          }),
        ]
      : []),
    booleanQualityObservation({
      metric: "instruction_coverage",
      passed: trial.instructionCoveragePercent >= 98,
      score: trial.instructionCoveragePercent,
      observed: `${trial.instructionCoveragePercent}% instruction coverage`,
      evidenceRef: evidence(trial, "coverage"),
    }),
    booleanQualityObservation({
      metric: "mission_continuity",
      passed: trial.missionContinuity,
      observed: trial.missionContinuity ? "mission retained" : "mission lost",
      evidenceRef: evidence(trial, "mission"),
    }),
    ...(trial.taskClass === "verification"
      ? [
          booleanQualityObservation({
            metric: "completion_proof" as const,
            passed: trial.completionProofValid,
            observed: trial.completionProofValid
              ? "valid claim-bound proof"
              : "proof invalid or missing",
            evidenceRef: evidence(trial, "judge"),
          }),
        ]
      : []),
    booleanQualityObservation({
      metric: "layout_visibility",
      passed: trial.layoutVisible,
      observed: trial.layoutVisible ? "chat visible" : "chat obstructed",
      evidenceRef: evidence(trial, "layout"),
    }),
  ];
  const quality = assessControlDirectorQuality(observations);
  const evidenceBlockers = trialEvidenceBlockers(trial);
  const resourcePassed =
    evidenceBlockers.length === 0 &&
    trial.peakCpuPercent <= MAX_CPU_PERCENT &&
    trial.peakMemoryGb <= MAX_MEMORY_GB &&
    trial.thermalPressure !== "critical";
  const blockers = [
    ...evidenceBlockers,
    ...quality.criticalOmissions.map(
      (observation) => `${observation.metric}: ${observation.observed}`,
    ),
    ...(quality.score < 93 ? [`quality score ${quality.score} is below 93`] : []),
    ...(trial.peakCpuPercent > MAX_CPU_PERCENT
      ? [`peak CPU ${trial.peakCpuPercent}% exceeds ${MAX_CPU_PERCENT}%`]
      : []),
    ...(trial.peakMemoryGb > MAX_MEMORY_GB
      ? [`peak memory ${trial.peakMemoryGb}GB exceeds ${MAX_MEMORY_GB}GB`]
      : []),
    ...(trial.thermalPressure === "critical" ? ["critical thermal pressure"] : []),
  ];
  return {
    trial,
    quality,
    resourcePassed,
    passed: quality.passed && resourcePassed && evidenceBlockers.length === 0,
    blockers,
  };
}

export function buildControlDirectorModelEvalMatrix(params: {
  trials: readonly ControlDirectorModelEvalTrial[];
  exactRuntime: boolean;
  sourceSha?: string;
  evaluatedAt?: string;
}): ControlDirectorModelEvalMatrix {
  const results = params.trials.map(evaluateControlDirectorModelTrial);
  const byModel = new Map<string, ControlDirectorModelEvalTrialResult[]>();
  for (const result of results) {
    const group = byModel.get(result.trial.modelRef) ?? [];
    group.push(result);
    byModel.set(result.trial.modelRef, group);
  }
  const modelCoverage = new Map<string, string[]>();
  for (const [model, modelResults] of byModel) {
    const missing: string[] = [];
    for (const taskClass of CONTROL_DIRECTOR_EVAL_TASK_CLASSES) {
      for (const cold of [true, false] as const) {
        if (
          !modelResults.some(
            (result) => result.trial.taskClass === taskClass && result.trial.cold === cold,
          )
        ) {
          missing.push(`${model}: missing ${cold ? "cold" : "warm"} ${taskClass} trial`);
        }
      }
    }
    modelCoverage.set(model, missing);
  }
  const coverageBlockers = [...modelCoverage.values()].flat().toSorted();
  const coveragePassed = byModel.size > 0 && coverageBlockers.length === 0;
  const admittedModels = [...byModel.entries()]
    .filter(
      ([model, modelResults]) =>
        modelResults.length > 0 &&
        modelResults.every((result) => result.passed) &&
        modelCoverage.get(model)?.length === 0,
    )
    .map(([model]) => model)
    .toSorted();
  const rejectedModels = [...byModel.keys()]
    .filter((model) => !admittedModels.includes(model))
    .toSorted();
  const passedCount = results.filter((result) => result.passed).length;
  const criticalOmissions = results.reduce(
    (sum, result) => sum + result.quality.criticalOmissions.length,
    0,
  );
  return {
    schemaVersion: CONTROL_DIRECTOR_MODEL_EVAL_VERSION,
    evaluatedAt: params.evaluatedAt ?? new Date().toISOString(),
    ...(params.sourceSha ? { sourceSha: params.sourceSha } : {}),
    exactRuntime: params.exactRuntime,
    passed:
      params.exactRuntime &&
      results.length > 0 &&
      passedCount === results.length &&
      criticalOmissions === 0 &&
      coveragePassed,
    passRate: results.length === 0 ? 0 : Math.round((passedCount / results.length) * 1_000) / 10,
    criticalOmissions,
    coveragePassed,
    coverageBlockers,
    results,
    admittedModels,
    rejectedModels,
  };
}
