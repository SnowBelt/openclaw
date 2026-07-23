import { describe, expect, it } from "vitest";
import { resolveSubagentSpawnRecommendedAction } from "./subagent-spawn-recovery.js";

describe("subagent spawn recovery guidance", () => {
  it.each([
    ["cwd is outside the approved task root", "inherit_task_root"],
    ["agentId is not allowed (allowed: builder)", "retry_allowed_agent"],
    ["sessions_spawn has reached max active children", "wait_or_cancel_child"],
    ["sessions_spawn is not allowed at this depth", "delegate_from_parent"],
    ["sessions_spawn requires explicit agentId", "retry_allowed_agent"],
    ["Role control_director cannot delegate to role judge", "retry_allowed_agent"],
    ["Role worker requires a typed handoff envelope", "correct_and_retry"],
    ["Role judge cannot accept a mutation-requiring handoff", "correct_and_retry"],
    ["backend disconnected", "report_blocker"],
  ])("maps %s to an action the caller can perform", (error, code) => {
    const action = resolveSubagentSpawnRecommendedAction(error);
    expect(action.code).toBe(code);
    expect(action.instruction.length).toBeGreaterThan(20);
  });
});
