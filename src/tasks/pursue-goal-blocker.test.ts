import { describe, expect, it } from "vitest";
import {
  nextPursueGoalBlockerCount,
  PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS,
} from "./pursue-goal-blocker.js";

describe("Pursue Goal blocker confirmation", () => {
  it("increments only the same normalized blocker", () => {
    expect(
      nextPursueGoalBlockerCount({
        previousSummary: "Waiting for `APPROVAL_OK`.",
        previousCount: 1,
        currentSummary: "waiting for approval_ok",
      }),
    ).toBe(2);
    expect(
      nextPursueGoalBlockerCount({
        previousSummary: "Waiting for approval.",
        previousCount: 2,
        currentSummary: "Network is unavailable.",
      }),
    ).toBe(1);
    expect(PURSUE_GOAL_BLOCKER_CONFIRMATION_TURNS).toBe(3);
  });
});
