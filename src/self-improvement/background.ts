import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { CronJob } from "../cron/types.js";
import { onInternalDiagnosticEvent } from "../infra/diagnostic-events.js";
import { formatErrorMessage } from "../infra/errors.js";
import { runSelfImprovementAnalysis } from "./analysis.js";
import { appendSelfImprovementAuditEvent } from "./audit-events.js";
import { writeSelfImprovementOperationalHealthSnapshot } from "./operational-health.js";
import { runSelfImprovementGovernorScan } from "./runner.js";
import {
  adaptDiagnosticEventToSelfImprovementSignal,
  recordSelfImprovementSignal,
} from "./signals.js";
import type { SelfImprovementScanTrigger } from "./types.js";

const DEFAULT_SELF_IMPROVEMENT_INTERVAL_MS = 6 * 60 * 60_000;
const DEFAULT_SELF_IMPROVEMENT_INITIAL_DELAY_MS = 5 * 60_000;
const DEFAULT_SELF_IMPROVEMENT_ANALYSIS_LIMIT = 25;
const MIN_SELF_IMPROVEMENT_INTERVAL_MS = 15 * 60_000;
const DEFAULT_SELF_IMPROVEMENT_TIMEOUT_MS = 20 * 60_000;
const DEFAULT_SELF_IMPROVEMENT_JITTER_RATIO = 0.1;
const MAX_SELF_IMPROVEMENT_INTERVAL_MS = 24 * 60 * 60_000;
const ACTIVE_SELF_IMPROVEMENT_INTERVAL_MS = 60 * 60_000;
const FAILURE_SELF_IMPROVEMENT_INTERVAL_MS = 30 * 60_000;
const DEFAULT_SIGNAL_WAKE_DELAY_MS = 1_000;
export const SELF_IMPROVEMENT_BACKGROUND_ENABLED_ENV = "OPENCLAW_SELF_IMPROVEMENT_BACKGROUND";

/** Gateway background mutation stays fail-closed until an operator explicitly opts in. */
export function isSelfImprovementBackgroundEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[SELF_IMPROVEMENT_BACKGROUND_ENABLED_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

type SelfImprovementBackgroundScan = typeof runSelfImprovementGovernorScan;
type SelfImprovementBackgroundAnalysis = typeof runSelfImprovementAnalysis;

async function recordBackgroundCycleHealth(params: {
  success: boolean;
  analysisLimit: number;
  log?: { error: (message: string) => void };
  error?: string;
  skipped?: boolean;
  skipReason?: string;
  nextIntervalMs?: number;
}) {
  const now = Date.now();
  try {
    await appendSelfImprovementAuditEvent({
      event: {
        createdAt: now,
        actor: "governor",
        kind: "background_cycle",
        targetId: "self-improvement-background",
        summary: params.skipped
          ? "Skipped Self-Improvement background cycle."
          : params.success
            ? "Completed Self-Improvement background cycle."
            : "Self-Improvement background cycle failed.",
        metadata: {
          success: params.success,
          ...(params.skipped ? { skipped: true } : {}),
          ...(params.skipReason ? { skipReason: params.skipReason } : {}),
          ...(params.success ? { analysisLimit: params.analysisLimit } : {}),
          ...(params.error ? { error: params.error } : {}),
          ...(params.nextIntervalMs ? { nextIntervalMs: params.nextIntervalMs } : {}),
        },
      },
    });
    await writeSelfImprovementOperationalHealthSnapshot({ now, actor: "governor" });
  } catch (error) {
    params.log?.error(
      `self-improvement operational health recording failed: ${formatErrorMessage(error)}`,
    );
  }
}

export function resolveAdaptiveSelfImprovementInterval(params: {
  baseIntervalMs: number;
  quietCycles: number;
  producedNewWork: boolean;
  failed: boolean;
}): number {
  const baseIntervalMs = Math.max(MIN_SELF_IMPROVEMENT_INTERVAL_MS, params.baseIntervalMs);
  if (params.failed) {
    return Math.max(
      MIN_SELF_IMPROVEMENT_INTERVAL_MS,
      Math.min(baseIntervalMs, FAILURE_SELF_IMPROVEMENT_INTERVAL_MS),
    );
  }
  if (params.producedNewWork) {
    return Math.max(
      MIN_SELF_IMPROVEMENT_INTERVAL_MS,
      Math.min(baseIntervalMs, ACTIVE_SELF_IMPROVEMENT_INTERVAL_MS),
    );
  }
  const multiplier = 2 ** Math.min(2, Math.max(0, Math.floor(params.quietCycles)));
  return Math.min(MAX_SELF_IMPROVEMENT_INTERVAL_MS, baseIntervalMs * multiplier);
}

function resolveIntervalMs(env: NodeJS.ProcessEnv): number {
  const raw = env.OPENCLAW_SELF_IMPROVEMENT_INTERVAL_MS?.trim();
  if (!raw) {
    return DEFAULT_SELF_IMPROVEMENT_INTERVAL_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(MIN_SELF_IMPROVEMENT_INTERVAL_MS, Math.floor(parsed))
    : DEFAULT_SELF_IMPROVEMENT_INTERVAL_MS;
}

function resolveTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.OPENCLAW_SELF_IMPROVEMENT_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_SELF_IMPROVEMENT_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1_000, Math.floor(parsed))
    : DEFAULT_SELF_IMPROVEMENT_TIMEOUT_MS;
}

function jitterDelayMs(params: {
  baseMs: number;
  jitterRatio: number;
  random: () => number;
}): number {
  if (params.jitterRatio <= 0 || params.baseMs <= 0) {
    return params.baseMs;
  }
  const boundedRandom = Math.min(1, Math.max(0, params.random()));
  const maxJitter = Math.floor(params.baseMs * params.jitterRatio);
  return params.baseMs + Math.floor(boundedRandom * maxJitter);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Self-Improvement background cycle timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function startSelfImprovementGovernorBackgroundTask(params: {
  getRuntimeConfig: () => OpenClawConfig;
  listCronJobs?: () => Promise<CronJob[]>;
  log?: { error: (message: string) => void };
  intervalMs?: number;
  initialDelayMs?: number;
  timeoutMs?: number;
  jitterRatio?: number;
  analysisLimit?: number;
  analyzeAfterScan?: boolean;
  recordOperationalHealth?: boolean;
  runScan?: SelfImprovementBackgroundScan;
  runAnalysis?: SelfImprovementBackgroundAnalysis;
  env?: NodeJS.ProcessEnv;
  random?: () => number;
  stateDir?: string;
  signalBridgeEnabled?: boolean;
  signalWakeDelayMs?: number;
  subscribeDiagnosticEvents?: typeof onInternalDiagnosticEvent;
  recordSignal?: typeof recordSelfImprovementSignal;
}): {
  interval: ReturnType<typeof setInterval>;
  initial: ReturnType<typeof setTimeout>;
  runNow: (trigger?: SelfImprovementScanTrigger) => Promise<void>;
  stop: () => void;
} {
  let inFlight: Promise<void> | null = null;
  let quietCycles = 0;
  let nextEligibleAt = 0;
  let pendingSignalWake = false;
  let signalWakeTimer: ReturnType<typeof setTimeout> | undefined;
  const baseIntervalMs = params.intervalMs ?? resolveIntervalMs(params.env ?? process.env);
  const random = params.random ?? Math.random;
  const jitterRatio = params.jitterRatio ?? DEFAULT_SELF_IMPROVEMENT_JITTER_RATIO;
  const scheduleSignalWake = (runNow: (trigger?: SelfImprovementScanTrigger) => Promise<void>) => {
    if (signalWakeTimer) {
      return;
    }
    signalWakeTimer = setTimeout(() => {
      signalWakeTimer = undefined;
      void runNow("signal");
    }, params.signalWakeDelayMs ?? DEFAULT_SIGNAL_WAKE_DELAY_MS);
    signalWakeTimer.unref?.();
  };
  const runNow = async (trigger: SelfImprovementScanTrigger = "background") => {
    if (inFlight) {
      if (trigger === "signal") {
        pendingSignalWake = true;
      }
      if (params.recordOperationalHealth !== false) {
        await recordBackgroundCycleHealth({
          success: true,
          skipped: true,
          skipReason: "overlap",
          analysisLimit: params.analysisLimit ?? DEFAULT_SELF_IMPROVEMENT_ANALYSIS_LIMIT,
          log: params.log,
        });
      }
      return;
    }
    inFlight = (async () => {
      const timeoutMs = params.timeoutMs ?? resolveTimeoutMs(params.env ?? process.env);
      await withTimeout(
        (async () => {
          const cfg = params.getRuntimeConfig();
          const scan = await (params.runScan ?? runSelfImprovementGovernorScan)({
            cfg,
            trigger,
            listCronJobs: params.listCronJobs,
            ...(params.stateDir ? { stateDir: params.stateDir } : {}),
          });
          const producedNewWork = scan.scan.created + scan.scan.reopened > 0;
          quietCycles = producedNewWork ? 0 : quietCycles + 1;
          const nextIntervalMs = resolveAdaptiveSelfImprovementInterval({
            baseIntervalMs,
            quietCycles,
            producedNewWork,
            failed: false,
          });
          nextEligibleAt = Date.now() + nextIntervalMs;
          if (params.analyzeAfterScan === false) {
            return;
          }
          await (params.runAnalysis ?? runSelfImprovementAnalysis)({
            cfg,
            limit: params.analysisLimit ?? DEFAULT_SELF_IMPROVEMENT_ANALYSIS_LIMIT,
            writeHealthSnapshot: false,
          });
          if (params.recordOperationalHealth !== false) {
            await recordBackgroundCycleHealth({
              success: true,
              analysisLimit: params.analysisLimit ?? DEFAULT_SELF_IMPROVEMENT_ANALYSIS_LIMIT,
              log: params.log,
              nextIntervalMs,
            });
          }
        })(),
        timeoutMs,
      );
    })()
      .then(() => undefined)
      .catch(async (error: unknown) => {
        const message = formatErrorMessage(error);
        const nextIntervalMs = resolveAdaptiveSelfImprovementInterval({
          baseIntervalMs,
          quietCycles,
          producedNewWork: false,
          failed: true,
        });
        nextEligibleAt = Date.now() + nextIntervalMs;
        params.log?.error(`self-improvement background cycle failed: ${message}`);
        if (params.recordOperationalHealth !== false) {
          await recordBackgroundCycleHealth({
            success: false,
            analysisLimit: params.analysisLimit ?? DEFAULT_SELF_IMPROVEMENT_ANALYSIS_LIMIT,
            log: params.log,
            error: message,
            nextIntervalMs,
          });
        }
      })
      .finally(() => {
        inFlight = null;
        if (pendingSignalWake) {
          pendingSignalWake = false;
          scheduleSignalWake(runNow);
        }
      });
    return await inFlight;
  };
  const initialDelayMs =
    params.initialDelayMs ??
    jitterDelayMs({
      baseMs: DEFAULT_SELF_IMPROVEMENT_INITIAL_DELAY_MS,
      jitterRatio,
      random,
    });
  const intervalDelayMs = jitterDelayMs({
    baseMs: Math.min(baseIntervalMs, MIN_SELF_IMPROVEMENT_INTERVAL_MS),
    jitterRatio,
    random,
  });
  const interval = setInterval(() => {
    if (Date.now() >= nextEligibleAt) {
      void runNow();
    }
  }, intervalDelayMs);
  const initial = setTimeout(() => {
    void runNow();
  }, initialDelayMs);
  interval.unref?.();
  initial.unref?.();
  const stopSignalListener =
    params.signalBridgeEnabled === false
      ? () => {}
      : (params.subscribeDiagnosticEvents ?? onInternalDiagnosticEvent)((event, metadata) => {
          const input = adaptDiagnosticEventToSelfImprovementSignal(event, metadata);
          if (!input) {
            return;
          }
          void (params.recordSignal ?? recordSelfImprovementSignal)({
            input,
            stateDir: params.stateDir,
          })
            .then((result) => {
              if (
                !result.duplicate &&
                result.signal.trusted &&
                (result.signal.severity === "critical" || result.signal.severity === "high")
              ) {
                scheduleSignalWake(runNow);
              }
            })
            .catch((error: unknown) => {
              params.log?.error(
                `self-improvement signal ingestion failed: ${formatErrorMessage(error)}`,
              );
            });
        });
  const stop = () => {
    clearInterval(interval);
    clearTimeout(initial);
    if (signalWakeTimer) {
      clearTimeout(signalWakeTimer);
      signalWakeTimer = undefined;
    }
    stopSignalListener();
  };
  return { interval, initial, runNow, stop };
}
