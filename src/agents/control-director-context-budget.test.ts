import { describe, expect, it } from "vitest";
import type { SessionControlDirectorMissionLedgerEntry } from "../config/sessions/types.js";
import {
  CONTROL_DIRECTOR_PROMPT_BUDGET,
  buildControlDirectorMissionContinuityContext,
  compileControlDirectorPromptBudget,
  selectActiveControlDirectorMission,
} from "./control-director-context-budget.js";

function mission(
  overrides: Partial<SessionControlDirectorMissionLedgerEntry> = {},
): SessionControlDirectorMissionLedgerEntry {
  return {
    schemaVersion: 1,
    missionId: "mission-1",
    requestSummary: "Implement the approved reliability plan.",
    requestBody: "Implement every approved milestone without touching release surfaces.",
    requestHash: "hash-1",
    responseMode: "execute",
    idempotencyKey: "mission-key-1",
    acceptanceCriteria: ["Targeted tests pass", "Managed runtime matches the landed SHA"],
    scope: ["Source, tests, docs", "No npm publish"],
    approvals: ["Edit the clean worktree", "Restart the managed Gateway"],
    provenance: ["chat.turns.create"],
    artifactIds: ["flow-1"],
    status: "continuing",
    startedAt: 100,
    updatedAt: 200,
    continuationCount: 1,
    verifiedEvidenceSummary: "Core typecheck passed.",
    nextBuildGap: "Run browser proof.",
    ...overrides,
  };
}

describe("Control Director context budget", () => {
  it("selects the newest nonterminal mission and ignores completed history", () => {
    expect(
      selectActiveControlDirectorMission([
        mission({ missionId: "complete", status: "complete", updatedAt: 500 }),
        mission({ missionId: "older", updatedAt: 200 }),
        mission({ missionId: "newer", status: "blocked", updatedAt: 300 }),
      ])?.missionId,
    ).toBe("newer");
  });

  it("preserves request, acceptance, scope, approvals, evidence, and next action", () => {
    const context = buildControlDirectorMissionContinuityContext(mission());
    expect(context).toContain("Implement every approved milestone");
    expect(context).toContain("Targeted tests pass");
    expect(context).toContain("No npm publish");
    expect(context).toContain("Restart the managed Gateway");
    expect(context).toContain("Core typecheck passed");
    expect(context).toContain("Run browser proof");
    expect(context).toContain("Never claim completion");
  });

  it("compiles deterministic bounded sections without transcript replay", () => {
    const first = compileControlDirectorPromptBudget({
      mode: "execute",
      policyPrompt: "P".repeat(4_000),
      missionContext: "M".repeat(8_000),
      recentContext: "R".repeat(8_000),
    });
    const second = compileControlDirectorPromptBudget({
      mode: "execute",
      policyPrompt: "P".repeat(4_000),
      missionContext: "M".repeat(8_000),
      recentContext: "R".repeat(8_000),
    });
    expect(first).toEqual(second);
    expect(first.chars.policy).toBe(CONTROL_DIRECTOR_PROMPT_BUDGET.policyChars);
    expect(first.chars.mission).toBe(CONTROL_DIRECTOR_PROMPT_BUDGET.missionChars);
    expect(first.chars.recentContext).toBe(CONTROL_DIRECTOR_PROMPT_BUDGET.recentContextChars);
    expect(first.chars.total).toBeLessThanOrEqual(CONTROL_DIRECTOR_PROMPT_BUDGET.totalChars);
    expect(first.estimatedTokens).toBe(Math.ceil(first.prompt.length / 4));
  });
});
