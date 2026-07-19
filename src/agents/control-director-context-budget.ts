// Deterministic Control Director prompt budgeting and mission continuity across compaction.
import type { SessionControlDirectorMissionLedgerEntry } from "../config/sessions/types.js";
import { truncateUtf16Safe } from "../utils.js";
import type { ControlDirectorResponseMode } from "./control-director-contract.js";

export const CONTROL_DIRECTOR_PROMPT_BUDGET = {
  policyChars: 2_400,
  missionChars: 6_000,
  recentContextChars: 4_000,
  totalChars: 12_400,
} as const;

const CONTINUITY_STATUSES = new Set<SessionControlDirectorMissionLedgerEntry["status"]>([
  "running",
  "blocked",
  "needs_user_input",
  "continuing",
  "continuation_queued",
]);

function compactLine(value: string | undefined, maxChars: number): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? truncateUtf16Safe(normalized, maxChars) : undefined;
}

function compactList(
  label: string,
  values: readonly string[] | undefined,
  options: { maxItems?: number; maxItemChars?: number } = {},
): string | undefined {
  const entries = [...new Set(values ?? [])]
    .map((entry) => compactLine(entry, options.maxItemChars ?? 400))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, options.maxItems ?? 20);
  return entries.length > 0
    ? `${label}:\n${entries.map((entry) => `- ${entry}`).join("\n")}`
    : undefined;
}

/** Select the newest nonterminal mission; completed history never bloats a new turn. */
export function selectActiveControlDirectorMission(
  ledger: readonly SessionControlDirectorMissionLedgerEntry[] | undefined,
): SessionControlDirectorMissionLedgerEntry | undefined {
  return [...(ledger ?? [])]
    .filter((entry) => CONTINUITY_STATUSES.has(entry.status))
    .toSorted((left, right) => right.updatedAt - left.updatedAt)[0];
}

/** Build a bounded authoritative continuity packet without replaying transcript prose. */
export function buildControlDirectorMissionContinuityContext(
  entry: SessionControlDirectorMissionLedgerEntry | undefined,
): string | null {
  if (!entry || !CONTINUITY_STATUSES.has(entry.status)) {
    return null;
  }
  const request = compactLine(entry.requestBody ?? entry.requestSummary, 3_600);
  const lines = [
    "## Active Mission Continuity",
    "Authoritative durable state. Preserve this mission across compaction; do not reinterpret it from transcript summaries.",
    `Mission ID: ${entry.missionId}`,
    entry.idempotencyKey ? `Idempotency key: ${entry.idempotencyKey}` : undefined,
    `State: ${entry.status}${entry.finalStatus ? `; final status ${entry.finalStatus}` : ""}.`,
    entry.responseMode ? `Response mode: ${entry.responseMode}.` : undefined,
    request ? `Original request:\n${request}` : undefined,
    compactList("Acceptance criteria", entry.acceptanceCriteria),
    compactList("Scope boundaries", entry.scope),
    compactList("Approved actions", entry.approvals),
    compactList("Provenance", entry.provenance, { maxItemChars: 240 }),
    compactList("Artifacts", entry.artifactIds, { maxItemChars: 240 }),
    compactLine(entry.verifiedEvidenceSummary, 1_000)
      ? `Verified evidence: ${compactLine(entry.verifiedEvidenceSummary, 1_000)}`
      : undefined,
    compactLine(entry.nextBuildGap, 800)
      ? `Next required action: ${compactLine(entry.nextBuildGap, 800)}`
      : undefined,
    entry.continuationQueueId ? `Continuation queue ID: ${entry.continuationQueueId}` : undefined,
    "Never claim completion from this packet alone. Recheck current execution state and direct evidence.",
  ].filter((line): line is string => Boolean(line));
  return truncateUtf16Safe(lines.join("\n"), CONTROL_DIRECTOR_PROMPT_BUDGET.missionChars);
}

export type ControlDirectorCompiledPromptBudget = {
  schemaVersion: 1;
  mode: ControlDirectorResponseMode;
  prompt: string;
  estimatedTokens: number;
  chars: {
    policy: number;
    mission: number;
    recentContext: number;
    total: number;
  };
  included: { policy: boolean; mission: boolean; recentContext: boolean };
};

/** Compile one bounded prompt packet in stable policy, mission, recent-context order. */
export function compileControlDirectorPromptBudget(params: {
  mode: ControlDirectorResponseMode;
  policyPrompt: string;
  missionContext?: string | null;
  recentContext?: string | null;
}): ControlDirectorCompiledPromptBudget {
  const policy = truncateUtf16Safe(
    params.policyPrompt.trim(),
    CONTROL_DIRECTOR_PROMPT_BUDGET.policyChars,
  );
  const mission = truncateUtf16Safe(
    params.missionContext?.trim() ?? "",
    CONTROL_DIRECTOR_PROMPT_BUDGET.missionChars,
  );
  const recentContext = truncateUtf16Safe(
    params.recentContext?.trim() ?? "",
    CONTROL_DIRECTOR_PROMPT_BUDGET.recentContextChars,
  );
  const prompt = truncateUtf16Safe(
    [policy, mission, recentContext].filter(Boolean).join("\n\n"),
    CONTROL_DIRECTOR_PROMPT_BUDGET.totalChars,
  );
  return {
    schemaVersion: 1,
    mode: params.mode,
    prompt,
    estimatedTokens: Math.ceil(prompt.length / 4),
    chars: {
      policy: policy.length,
      mission: mission.length,
      recentContext: recentContext.length,
      total: prompt.length,
    },
    included: {
      policy: Boolean(policy),
      mission: Boolean(mission),
      recentContext: Boolean(recentContext),
    },
  };
}
