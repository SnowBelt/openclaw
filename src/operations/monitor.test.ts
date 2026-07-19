import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOperationsShadowMonitorState,
  resetOperationsShadowMonitorStateForTest,
  startOperationsShadowMonitor,
} from "./monitor.js";

describe("Operations Room shadow monitor", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetOperationsShadowMonitorStateForTest();
  });

  it("runs bounded non-overlapping sweeps and stops cleanly", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const collect = vi.fn(async () => ["workflow:flow-1:blocked"]);
    const warn = vi.fn();
    const stop = startOperationsShadowMonitor({
      intervalMs: 5_000,
      now: () => now,
      collect,
      log: { warn },
    });

    await vi.runAllTicks();
    await Promise.resolve();
    expect(getOperationsShadowMonitorState()).toMatchObject({
      running: true,
      sweepCount: 1,
      findingIds: ["workflow:flow-1:blocked"],
    });
    expect(warn).toHaveBeenCalledTimes(1);

    now = 6_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(collect).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);

    stop();
    expect(getOperationsShadowMonitorState().running).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(collect).toHaveBeenCalledTimes(2);
  });
});
