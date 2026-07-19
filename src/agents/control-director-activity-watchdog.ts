// Visible liveness heartbeat for a long-running Control Director chat turn.
import { CONTROL_DIRECTOR_UX_SLOS } from "./control-director-slos.js";

export const CONTROL_DIRECTOR_ACTIVITY_WATCHDOG_SLACK_MS = 2_000;

export type ControlDirectorActivityGap = {
  runId: string;
  reason: "timer_late" | "heartbeat_failed";
  observedGapMs: number;
  detail: string;
};

type Timer = ReturnType<typeof setTimeout>;

/**
 * Keep active Chat work visibly alive without extending or cancelling the model run.
 * Recursive scheduling prevents overlapping persistence writes. Stop is idempotent.
 */
export function startControlDirectorActivityWatchdog(params: {
  runId: string;
  onHeartbeat: (at: number, sequence: number) => void;
  onGap: (gap: ControlDirectorActivityGap) => void;
  now?: () => number;
  intervalMs?: number;
  schedule?: (callback: () => void, delayMs: number) => Timer;
  cancel?: (timer: Timer) => void;
}): () => void {
  const now = params.now ?? Date.now;
  const intervalMs = Math.max(
    250,
    params.intervalMs ?? CONTROL_DIRECTOR_UX_SLOS.activityHeartbeatMs,
  );
  const schedule = params.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = params.cancel ?? clearTimeout;
  let stopped = false;
  let sequence = 0;
  let previousTickAt = now();
  let timer: Timer | undefined;

  const arm = () => {
    if (stopped) return;
    timer = schedule(tick, intervalMs);
    timer.unref?.();
  };
  const tick = () => {
    if (stopped) return;
    const at = now();
    const observedGapMs = Math.max(0, at - previousTickAt);
    previousTickAt = at;
    sequence += 1;
    if (observedGapMs > intervalMs + CONTROL_DIRECTOR_ACTIVITY_WATCHDOG_SLACK_MS) {
      params.onGap({
        runId: params.runId,
        reason: "timer_late",
        observedGapMs,
        detail: `Visible activity timer was delayed by ${observedGapMs - intervalMs}ms.`,
      });
    }
    try {
      params.onHeartbeat(at, sequence);
    } catch (error) {
      params.onGap({
        runId: params.runId,
        reason: "heartbeat_failed",
        observedGapMs,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    arm();
  };
  arm();
  return () => {
    if (stopped) return;
    stopped = true;
    if (timer) cancel(timer);
  };
}
