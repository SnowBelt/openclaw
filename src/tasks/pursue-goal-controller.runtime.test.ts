import { describe, expect, it } from "vitest";
import { createPursueGoalControllerState } from "./pursue-goal-controller-state.js";
import { resolvePursueGoalCodexRoute } from "./pursue-goal-controller.runtime.js";

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
});
