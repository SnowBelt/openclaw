import { afterEach, describe, expect, it, vi } from "vitest";
import {
  onInternalDiagnosticEvent,
  resetDiagnosticEventsForTest,
} from "../infra/diagnostic-events.js";
import {
  buildControlDirectorJourneyDiagnostic,
  emitControlDirectorJourneySignal,
  isControlDirectorJourneySignalCode,
} from "./control-director-journeys.js";
import { adaptDiagnosticEventToSelfImprovementSignal } from "./signals.js";

describe("typed Control Director SIG journeys", () => {
  afterEach(() => resetDiagnosticEventsForTest());

  it("maps every journey code to trusted, owned, bounded improvement evidence", () => {
    expect(isControlDirectorJourneySignalCode("stalled_goal")).toBe(true);
    expect(isControlDirectorJourneySignalCode("arbitrary_error")).toBe(false);
    const event = buildControlDirectorJourneyDiagnostic({
      code: "stalled_goal",
      idempotencyKey: "flow-1",
      summary: "Goal lost its lease.",
      observed: "running label with expired lease",
      runId: "flow-1",
    });
    expect(event).toMatchObject({
      type: "improvement.signal",
      idempotencyKey: "control-director:stalled_goal:flow-1",
      source: { component: "control-director", subsystem: "journey:stalled_goal" },
      kind: "blocked",
      severity: "critical",
      errorCode: "stalled_goal",
      desiredState: { owner: "task-orchestrator", sloMs: 45_000 },
    });
  });

  it("enters SIG through the trusted diagnostic adapter", async () => {
    const received = vi.fn();
    const off = onInternalDiagnosticEvent(received);
    emitControlDirectorJourneySignal({
      code: "delivery_miss",
      idempotencyKey: "flow-2",
      summary: "Terminal update did not queue.",
      observed: "enqueue returned false",
    });
    await vi.waitFor(() => expect(received).toHaveBeenCalled());
    off();
    const [event, metadata] = received.mock.calls[0]!;
    expect(metadata.trusted).toBe(true);
    expect(adaptDiagnosticEventToSelfImprovementSignal(event, metadata)).toMatchObject({
      errorCode: "delivery_miss",
      trusted: true,
    });
  });
});
