import { describe, expect, it } from "vitest";
import { createPursueGoalControllerState } from "./pursue-goal-controller-state.js";
import {
  buildPursueGoalWorkerPrompt,
  resolvePursueGoalCodexRoute,
} from "./pursue-goal-controller.runtime.js";

describe("Pursue Goal governed model route", () => {
  it("stays local and never silently spends Codex without a project approval", () => {
    const state = createPursueGoalControllerState({
      flowId: "flow-local-route",
      goal: "Complete the durable goal.",
      workerAgentId: "program-manager",
      now: 100,
    });
    expect(
      resolvePursueGoalCodexRoute({
        flowId: "flow-local-route",
        goal: "Complete the durable goal.",
        state,
        runId: "run-local-route",
        abortSignal: new AbortController().signal,
      }),
    ).toMatchObject({
      route: "local",
      reason: expect.stringContaining("local route"),
    });
  });

  it("assigns Judge execution to the controller and makes blocker confirmation explicit", () => {
    const state = {
      ...createPursueGoalControllerState({
        flowId: "flow-prompt-contract",
        goal: "Return verified evidence.",
        workerAgentId: "program-manager",
        now: 100,
      }),
      consecutiveBlockers: 1,
    };
    const prompt = buildPursueGoalWorkerPrompt(
      {
        flowId: "flow-prompt-contract",
        goal: "Return verified evidence.",
        state,
        runId: "run-prompt-contract",
        abortSignal: new AbortController().signal,
      },
      "local route",
    );

    expect(prompt).toContain("controller owns independent Judge execution");
    expect(prompt).toContain("Never request, fabricate, or wait for a Judge receipt");
    expect(prompt).toContain("call update_goal status=complete");
    expect(prompt).toContain("blocker confirmation is 1/3");
    expect(prompt).toContain("An unrun Judge is not a blocker");
  });
});
