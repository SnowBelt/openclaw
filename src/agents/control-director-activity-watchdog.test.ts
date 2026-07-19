import { describe, expect, it, vi } from "vitest";
import { startControlDirectorActivityWatchdog } from "./control-director-activity-watchdog.js";

describe("Control Director activity watchdog", () => {
  it("emits bounded recurring heartbeats and stops idempotently", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const onHeartbeat = vi.fn();
    const onGap = vi.fn();
    const stop = startControlDirectorActivityWatchdog({
      runId: "run-1",
      intervalMs: 1_000,
      onHeartbeat,
      onGap,
    });

    vi.advanceTimersByTime(3_000);
    expect(onHeartbeat).toHaveBeenCalledTimes(3);
    expect(onHeartbeat).toHaveBeenLastCalledWith(4_000, 3);
    expect(onGap).not.toHaveBeenCalled();

    stop();
    stop();
    vi.advanceTimersByTime(3_000);
    expect(onHeartbeat).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("reports late timers and failed persistence without terminating the run", () => {
    let now = 100;
    let callback: (() => void) | undefined;
    const gaps: string[] = [];
    const stop = startControlDirectorActivityWatchdog({
      runId: "run-2",
      intervalMs: 1_000,
      now: () => now,
      schedule: (next) => {
        callback = next;
        return { unref() {} } as ReturnType<typeof setTimeout>;
      },
      cancel: () => undefined,
      onHeartbeat: () => {
        throw new Error("task store unavailable");
      },
      onGap: (gap) => gaps.push(`${gap.reason}:${gap.detail}`),
    });

    now = 3_500;
    callback?.();
    expect(gaps).toEqual([
      "timer_late:Visible activity timer was delayed by 2400ms.",
      "heartbeat_failed:task store unavailable",
    ]);
    stop();
  });
});
