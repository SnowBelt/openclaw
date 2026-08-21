import { describe, expect, it } from "vitest";
import {
  appendExecutionEvent,
  createExecutionEvent,
  parseExecutionEvent,
} from "./execution-event.js";

describe("execution event protocol", () => {
  it("creates typed, versioned, monotonically sequenced events", () => {
    const first = createExecutionEvent({
      flowId: "flow-1",
      category: "goal",
      name: "goal.created",
      actorId: "control-ui",
      summary: "Goal accepted.",
      at: 10,
      eventId: "event-1",
    });
    const second = createExecutionEvent({
      flowId: "flow-1",
      category: "activity",
      name: "activity.working",
      actorId: "controller",
      summary: "Worker started.",
      events: [first],
      at: 20,
      eventId: "event-2",
    });

    expect(first.schemaVersion).toBe(1);
    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(parseExecutionEvent(second)).toEqual(second);
  });

  it("rejects a category/name mismatch", () => {
    expect(() =>
      createExecutionEvent({
        flowId: "flow-1",
        category: "goal",
        name: "judge.approved",
        actorId: "controller",
        summary: "Invalid pairing.",
      }),
    ).toThrow("does not belong");
  });

  it("deduplicates by event id and bounds retained history", () => {
    const events = Array.from({ length: 4 }, (_, index) =>
      createExecutionEvent({
        flowId: "flow-1",
        category: "run",
        name: "run.heartbeat",
        actorId: "controller",
        summary: `Heartbeat ${index}`,
        events: [],
        at: index,
        eventId: `event-${index}`,
      }),
    ).map((event, index) => Object.assign(event, { sequence: index }));

    expect(appendExecutionEvent(events, events[3]!, 3).map((event) => event.eventId)).toEqual([
      "event-1",
      "event-2",
      "event-3",
    ]);
  });

  it("rejects a present payload that cannot be represented as JSON", () => {
    const event = createExecutionEvent({
      flowId: "flow-1",
      category: "run",
      name: "run.heartbeat",
      actorId: "controller",
      summary: "Heartbeat",
      eventId: "event-invalid-payload",
      at: 10,
    });

    expect(parseExecutionEvent({ ...event, payload: Symbol("invalid") })).toBeUndefined();
  });
});
