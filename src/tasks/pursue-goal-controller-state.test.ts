import { describe, expect, it } from "vitest";
import {
  createPursueGoalControllerState,
  isPursueGoalLeaseCurrent,
  parsePursueGoalControllerState,
  withPursueGoalEvent,
} from "./pursue-goal-controller-state.js";

describe("Pursue Goal controller state", () => {
  it("creates and round-trips durable state", () => {
    const state = createPursueGoalControllerState({
      flowId: "flow-1",
      goal: "Finish the verified change",
      workerAgentId: "program-manager",
      now: 100,
      missionId: "mission-1",
      workerSessionId: "session-1",
    });

    expect(parsePursueGoalControllerState(state)).toEqual(state);
    expect(state.workerSessionKey).toBe("agent:program-manager:goal:flow-1");
    expect(state.phase).toBe("queued");
    expect(state.events[0]?.name).toBe("goal.created");
  });

  it("fails closed for foreign or malformed state", () => {
    expect(parsePursueGoalControllerState({ schemaVersion: 1, kind: "other" })).toBeUndefined();
  });

  it("appends typed events and validates a live lease", () => {
    let state = createPursueGoalControllerState({
      flowId: "flow-1",
      goal: "Finish",
      workerAgentId: "main",
      now: 100,
    });
    state = withPursueGoalEvent(
      {
        ...state,
        lease: {
          ownerId: "process-1",
          leaseId: "lease-1",
          acquiredAt: 100,
          heartbeatAt: 110,
          expiresAt: 200,
        },
      },
      {
        flowId: "flow-1",
        category: "activity",
        name: "activity.working",
        actorId: "process-1",
        summary: "Working.",
        at: 120,
      },
    );

    expect(state.events.at(-1)?.sequence).toBe(1);
    expect(
      isPursueGoalLeaseCurrent(state, { ownerId: "process-1", leaseId: "lease-1", now: 150 }),
    ).toBe(true);
    expect(
      isPursueGoalLeaseCurrent(state, { ownerId: "process-1", leaseId: "lease-1", now: 250 }),
    ).toBe(false);
  });
});
