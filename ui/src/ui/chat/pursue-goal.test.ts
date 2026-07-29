import { describe, expect, it } from "vitest";
import {
  CHAT_PURSUE_GOAL_CONTROLLER_ID,
  type ChatGoalFlowSummary,
  resolveCurrentChatGoal,
} from "./pursue-goal.ts";

function goal(
  id: string,
  status: ChatGoalFlowSummary["status"],
  controllerId = CHAT_PURSUE_GOAL_CONTROLLER_ID,
): ChatGoalFlowSummary {
  return { controllerId, goal: id, id, status };
}

describe("resolveCurrentChatGoal", () => {
  it("returns the first active Pursue Goal without allocating a filtered copy", () => {
    const flows = [
      goal("unrelated", "running", "other-controller"),
      goal("finished", "succeeded"),
      goal("active", "waiting"),
      goal("later-active", "running"),
    ];

    expect(resolveCurrentChatGoal(flows)?.id).toBe("active");
  });

  it("falls back to the first terminal Pursue Goal", () => {
    const flows = [goal("unrelated", "running", "other-controller"), goal("first", "failed")];

    expect(resolveCurrentChatGoal(flows)?.id).toBe("first");
    expect(resolveCurrentChatGoal(undefined)).toBeNull();
  });
});
