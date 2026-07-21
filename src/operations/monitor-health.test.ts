import { describe, expect, it } from "vitest";
import { deriveOperationsMonitorHealth } from "./monitor-health.js";
import type { OperationsShadowMonitorState } from "./monitor-state.js";

function state(
  overrides: Partial<OperationsShadowMonitorState> = {},
): OperationsShadowMonitorState {
  return {
    running: true,
    intervalMs: 60_000,
    startedAt: 10,
    lastAttemptAt: 100,
    lastSweepAt: 100,
    nextSweepAt: 60_100,
    lastDurationMs: 5,
    attemptCount: 1,
    sweepCount: 1,
    lastError: null,
    findingIds: [],
    ...overrides,
  };
}

describe("Operations monitor health", () => {
  it("reports a recent successful monitor as available", () => {
    expect(deriveOperationsMonitorHealth(state(), 1_000)).toEqual({
      source: { status: "available", observedAt: 100 },
    });
  });

  it("fails closed when the monitor is stopped or has never succeeded", () => {
    expect(deriveOperationsMonitorHealth(state({ running: false }), 1_000)).toMatchObject({
      source: { status: "unavailable" },
      finding: {
        id: "process:operations-monitor:health",
        disposition: "needs_user",
      },
    });
    expect(
      deriveOperationsMonitorHealth(
        state({ lastSweepAt: null, sweepCount: 0, lastError: "probe failed" }),
        1_000,
      ),
    ).toMatchObject({
      source: { status: "unavailable" },
      finding: { title: "Operations monitor has not completed a sweep" },
    });
  });

  it("distinguishes a failed attempt from stale successful data", () => {
    expect(
      deriveOperationsMonitorHealth(
        state({ lastError: "probe failed", lastAttemptAt: 900 }),
        1_000,
      ),
    ).toMatchObject({
      source: { status: "fallback", observedAt: 100 },
      finding: { title: "Latest Operations monitor attempt failed" },
    });
    expect(
      deriveOperationsMonitorHealth(
        state({ lastSweepAt: 100, lastAttemptAt: 200, lastError: "probe failed" }),
        130_101,
      ),
    ).toMatchObject({
      source: { status: "stale", observedAt: 100 },
      finding: { title: "Operations monitor data is stale" },
    });
  });
});
