import { recommendPccWorkflow } from "../../../../../src/pcc/intake-quality.js";
import type { PccProjectFormState } from "../contracts.ts";

const REQUEST_PREFIXES = [
  /^(?:please\s+)+/iu,
  /^(?:can|could|would|will)\s+you\s+/iu,
  /^help\s+(?:me|us)\s+(?:to\s+)?/iu,
  /^(?:i|we)\s+(?:want|need|would like|am looking|are looking)\s+(?:you\s+)?(?:to\s+)?/iu,
] as const;

const TITLE_ACTION_PREFIX =
  /^(?:build|create|make|develop|design|plan|launch|implement|set up|produce|deliver|organize|improve|fix|repair|audit|review)\s+/iu;
const TITLE_CLAUSE_BOUNDARY = /\s+(?:so that|so we|in order to|which|that|with the goal of)\b/iu;
const GENERIC_TITLES = new Set(["", "i", "it", "project", "the project", "new project"]);
const PRESERVED_TITLE_WORDS: Readonly<Record<string, string>> = {
  ai: "AI",
  api: "API",
  ios: "iOS",
  llm: "LLM",
  openclaw: "OpenClaw",
  pcc: "PCC",
  qa: "QA",
  snes: "SNES",
  ui: "UI",
  ux: "UX",
};
const LOWERCASE_TITLE_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

function normalizePrompt(value: string): string {
  return value
    .replace(/^\s*(?:[-*]|\d+[.)])\s+/gmu, "")
    .replace(/^\s*#+\s*/gmu, "")
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function stripRequestPrefix(value: string): string {
  let result = value.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const previous = result;
    for (const pattern of REQUEST_PREFIXES) {
      result = result.replace(pattern, "").trim();
    }
    result = result.replace(/^to\s+/iu, "").trim();
    if (result === previous) {
      break;
    }
  }
  return result;
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const shortened = value.slice(0, maxLength + 1);
  const lastSpace = shortened.lastIndexOf(" ");
  return (
    lastSpace >= Math.floor(maxLength * 0.6)
      ? shortened.slice(0, lastSpace)
      : shortened.slice(0, maxLength)
  ).trim();
}

function titleCase(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .map((word, index) => {
      const leading = word.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? "";
      const trailing = word.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? "";
      const core = word.slice(leading.length, word.length - trailing.length || undefined);
      const normalized = core.toLowerCase();
      const preserved = PRESERVED_TITLE_WORDS[normalized];
      if (preserved) {
        return `${leading}${preserved}${trailing}`;
      }
      if (/\p{Lu}/u.test(core.slice(1)) || /\d/u.test(core)) {
        return word;
      }
      if (index > 0 && LOWERCASE_TITLE_WORDS.has(normalized)) {
        return `${leading}${normalized}${trailing}`;
      }
      return `${leading}${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}${trailing}`;
    })
    .join(" ");
}

function validGeneratedTitle(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return value.trim().length >= 2 && !GENERIC_TITLES.has(normalized);
}

function meaningfulDraftText(value: string, minimumLength = 8): boolean {
  const normalized = value.trim().toLowerCase();
  return value.trim().length >= minimumLength && !GENERIC_TITLES.has(normalized);
}

export function inferPccProjectTitle(value: string): string {
  const prompt = normalizePrompt(value);
  if (!prompt) {
    return "New Project";
  }

  const explicitlyNamed = prompt.match(
    /\b(?:called|named|titled)\s+["']?([^"'.!?;,]{2,64})["']?/iu,
  )?.[1];
  let candidate = explicitlyNamed?.trim() || stripRequestPrefix(prompt);
  candidate = candidate.split(/[.!?;,]/u)[0]?.trim() ?? candidate;
  candidate = candidate.split(TITLE_CLAUSE_BOUNDARY)[0]?.trim() ?? candidate;
  candidate = candidate.replace(TITLE_ACTION_PREFIX, "").trim();
  candidate = candidate.replace(/^(?:a|an|the)\s+/iu, "").trim();
  candidate = truncateAtWord(candidate, 64)
    .replace(/[-:]+$/u, "")
    .trim();

  const title = titleCase(candidate);
  return validGeneratedTitle(title) ? title : "New Project";
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}` : trimmed;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function inferPccProjectGoal(value: string, title: string): string {
  const prompt = normalizePrompt(value);
  if (!prompt || !validGeneratedTitle(title)) {
    return `Deliver ${title || "this project"} with a clear, verified outcome.`;
  }
  let goal = stripRequestPrefix(prompt);
  if (/^(?:a|an|the|my|our)\s+/iu.test(goal)) {
    goal = `Create ${goal}`;
  }
  goal = truncateAtWord(goal, 320);
  return ensureSentence(sentenceCase(goal));
}

export function inferPccProjectOutcomeMetrics(title: string, goal: string): string {
  const conciseGoal = truncateAtWord(goal.replace(/[.!?]+$/u, "").trim(), 180);
  return [
    `Goal achieved: ${conciseGoal || `${title} delivers its intended outcome`}.`,
    `${title}'s primary deliverable passes documented acceptance criteria and required checks.`,
    "No critical blocker remains, and every completed milestone has current proof.",
  ].join("\n");
}

export function buildPccProjectCreationDraftPatch(
  form: PccProjectFormState,
  options: { preserveExisting?: boolean } = {},
): Partial<PccProjectFormState> {
  const preserveExisting = options.preserveExisting ?? true;
  const description = form.projectDescription?.trim() ?? "";
  const existingTitle = form.title?.trim() ?? "";
  const existingGoal = form.goal?.trim() ?? "";
  const existingOutcomeMetrics = form.outcomeMetrics?.trim() ?? "";
  const existingIntakeAnswers = form.intakeAnswers ?? {};
  const titleSource = description || existingGoal || existingTitle;
  const goalSource = meaningfulDraftText(existingGoal)
    ? existingGoal
    : description || existingTitle;
  const generatedTitle = inferPccProjectTitle(titleSource);
  const title =
    preserveExisting && validGeneratedTitle(existingTitle) ? existingTitle : generatedTitle;
  const generatedGoal = inferPccProjectGoal(goalSource, title);
  const goal = preserveExisting && meaningfulDraftText(existingGoal) ? existingGoal : generatedGoal;
  const outcomeMetrics =
    preserveExisting && meaningfulDraftText(existingOutcomeMetrics)
      ? existingOutcomeMetrics
      : inferPccProjectOutcomeMetrics(title, goal);
  const usesCodex =
    form.executionProfile?.codexRole !== undefined && form.executionProfile.codexRole !== "off";
  const generatedAnswers = {
    goal,
    firstDeliverable: `A reviewed, executable first milestone for ${title}, with an owner, acceptance criteria, and required proof.`,
    doneProof:
      "Every milestone has acceptance criteria, proof requirements, and a completion receipt before PCC marks it complete.",
    constraints: usesCodex
      ? "Codex work is limited to the selected role and requires its scoped approval; destructive, remote, publish, runtime, credential, and reboot actions still require separate approval."
      : "Do not run destructive, remote, publish, runtime, credential, reboot, or Codex actions without separate approval.",
    owner: usesCodex
      ? "OpenClaw coordinator with the approved Codex specialist role"
      : "OpenClaw coordinator",
    blockers:
      "Unknown blockers must be converted into PCC permission, tool, source, dependency, or proof gaps before work starts.",
  };
  const intakeAnswers = Object.fromEntries(
    Object.entries(generatedAnswers).map(([key, value]) => {
      const existing = existingIntakeAnswers[key]?.trim();
      const keepExisting =
        key === "owner" ? Boolean(existing) : meaningfulDraftText(existing ?? "");
      return [key, preserveExisting && keepExisting ? existing : value];
    }),
  );
  // Generic generated proof/blocker language must not bias workflow classification.
  const recommendation = recommendPccWorkflow({
    title,
    goal,
    intakeAnswers: existingIntakeAnswers,
  });

  return {
    title,
    goal,
    outcomeMetrics,
    intakeAnswers,
    workflowTemplateId: form.workflowTemplateId?.trim() || recommendation.templateId,
    planPreviewAccepted: false,
  };
}
