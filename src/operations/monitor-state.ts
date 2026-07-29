// Shared in-process state for the deterministic Operations monitor.
// Keeping this state separate lets the collector read monitor health without
// creating a collector <-> monitor module cycle.

export const OPERATIONS_SHADOW_INTERVAL_MS = 60_000;

export type OperationsShadowMonitorState = {
  running: boolean;
  intervalMs: number;
  startedAt: number | null;
  lastAttemptAt: number | null;
  lastSweepAt: number | null;
  nextSweepAt: number | null;
  lastDurationMs: number | null;
  attemptCount: number;
  sweepCount: number;
  lastError: string | null;
  findingIds: string[];
  autoRemediationEnabled?: boolean;
};

function initialState(): OperationsShadowMonitorState {
  return {
    running: false,
    intervalMs: OPERATIONS_SHADOW_INTERVAL_MS,
    startedAt: null,
    lastAttemptAt: null,
    lastSweepAt: null,
    nextSweepAt: null,
    lastDurationMs: null,
    attemptCount: 0,
    sweepCount: 0,
    lastError: null,
    findingIds: [],
    autoRemediationEnabled: false,
  };
}

let state = initialState();

export function getOperationsShadowMonitorState(): OperationsShadowMonitorState {
  return { ...state, findingIds: [...state.findingIds] };
}

export function setOperationsShadowMonitorState(next: OperationsShadowMonitorState): void {
  state = { ...next, findingIds: [...next.findingIds] };
}

export function updateOperationsShadowMonitorState(
  update: (current: OperationsShadowMonitorState) => OperationsShadowMonitorState,
): void {
  setOperationsShadowMonitorState(update(getOperationsShadowMonitorState()));
}

export function resetOperationsShadowMonitorStateForTest(): void {
  state = initialState();
}
