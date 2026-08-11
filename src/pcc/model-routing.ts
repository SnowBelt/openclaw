export type PccLocalTaskClass =
  | "coordination"
  | "coding"
  | "analysis"
  | "verification"
  | "vision"
  | "routine";

export type PccLocalModelCapability = {
  ref: string;
  taskClasses: PccLocalTaskClass[];
  qualityTier: "fast" | "balanced" | "strong";
  rationale: string;
};

const TASK_PATTERNS: ReadonlyArray<[PccLocalTaskClass, RegExp]> = [
  ["vision", /\b(?:image|visual|screenshot|sprite|photo|design|ui|ux)\b/iu],
  ["coding", /\b(?:code|implement|refactor|typescript|javascript|fix|debug|build)\b/iu],
  ["verification", /\b(?:test|verify|proof|qa|audit|check|lint|typecheck)\b/iu],
  ["coordination", /\b(?:coordinate|orchestrat|schedule|partition|fan.?in|program manager)\b/iu],
  ["analysis", /\b(?:analy|research|investigat|diagnos|architecture|plan)\b/iu],
];

export function classifyPccLocalTask(title: string): PccLocalTaskClass {
  return TASK_PATTERNS.find(([, pattern]) => pattern.test(title))?.[0] ?? "routine";
}

/**
 * Build a conservative capability projection from configured local model identity.
 * Unknown models remain usable for routine work only; PCC never invents benchmark results.
 */
export function describePccLocalModel(ref: string): PccLocalModelCapability {
  const normalized = ref.trim().toLowerCase();
  const taskClasses = new Set<PccLocalTaskClass>(["routine"]);
  let qualityTier: PccLocalModelCapability["qualityTier"] = "fast";
  const reasons: string[] = [];
  if (/qwen3\.6|coder|codestral|devstral|deepseek.*coder/iu.test(normalized)) {
    taskClasses.add("coding");
    taskClasses.add("verification");
    qualityTier = "strong";
    reasons.push("configured model identity indicates code and verification strength");
  }
  if (/gemma4.*31b|qwen3\.5.*27b|qwen3.*235b|70b|72b/iu.test(normalized)) {
    taskClasses.add("coordination");
    taskClasses.add("analysis");
    taskClasses.add("verification");
    qualityTier = "strong";
    reasons.push("configured model identity indicates larger reasoning capacity");
  } else if (/27b|30b|31b|32b|34b/iu.test(normalized)) {
    taskClasses.add("analysis");
    taskClasses.add("verification");
    qualityTier = "balanced";
    reasons.push("configured model identity indicates balanced local reasoning capacity");
  }
  if (/vision|vl|llava|pixtral/iu.test(normalized)) {
    taskClasses.add("vision");
    qualityTier = qualityTier === "fast" ? "balanced" : qualityTier;
    reasons.push("configured model identity indicates vision input support");
  }
  return {
    ref: ref.trim(),
    taskClasses: [...taskClasses],
    qualityTier,
    rationale:
      reasons.join("; ") ||
      "No evaluated specialization is recorded; use this model for routine work only.",
  };
}

function scoreModel(model: PccLocalModelCapability, taskClass: PccLocalTaskClass): number {
  const capability = model.taskClasses.includes(taskClass) ? 100 : taskClass === "routine" ? 50 : 0;
  const quality = model.qualityTier === "strong" ? 3 : model.qualityTier === "balanced" ? 2 : 1;
  return capability + quality;
}

export function selectPccLocalModel(params: {
  taskTitle: string;
  availableModelRefs: readonly string[];
  preferredModelRef?: string | null;
}): { modelRef: string | null; taskClass: PccLocalTaskClass; rationale: string } {
  const taskClass = classifyPccLocalTask(params.taskTitle);
  const unique = [
    ...new Set(params.availableModelRefs.map((value) => value.trim()).filter(Boolean)),
  ];
  if (params.preferredModelRef && unique.includes(params.preferredModelRef)) {
    return {
      modelRef: params.preferredModelRef,
      taskClass,
      rationale: "The project explicitly selected this configured local model.",
    };
  }
  const ranked = unique
    .map(describePccLocalModel)
    .toSorted((left, right) => scoreModel(right, taskClass) - scoreModel(left, taskClass));
  const selected = ranked.find((model) => model.taskClasses.includes(taskClass)) ?? ranked[0];
  return {
    modelRef: selected?.ref ?? null,
    taskClass,
    rationale: selected
      ? `${selected.rationale}; selected for ${taskClass} work.`
      : "No configured local model is available.",
  };
}
