import crypto from "node:crypto";
import { formatErrorMessage } from "../infra/errors.js";
import { buildCuratorReviewSessionKey } from "./curator/review-task.js";
import {
  getSelfImprovementProposal,
  listSelfImprovementProposals,
  updateSelfImprovementCuratorDispatch,
} from "./proposals.js";

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [0, 60_000, 5 * 60_000] as const;
const STALE_RUNNING_MS = 10 * 60_000;

export type CuratorReviewRunner = (params: {
  proposalId: string;
  sessionKey: string;
  attempt: number;
}) => Promise<unknown>;

export type CuratorDispatch = {
  enqueue: (proposalIds: readonly string[]) => Promise<void>;
  reconcile: () => Promise<void>;
  retry: (proposalId: string) => Promise<void>;
  dispose: () => void;
};

export function createSelfImprovementCuratorDispatch(params: {
  stateDir?: string;
  runReview: CuratorReviewRunner;
  log?: { error: (message: string) => void };
  now?: () => number;
}): CuratorDispatch {
  const active = new Set<string>();
  const activeRuns = new Map<string, Promise<void>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  const now = params.now ?? Date.now;
  let startRun: (proposalId: string) => void = () => {};

  const clearTimer = (proposalId: string) => {
    const timer = timers.get(proposalId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(proposalId);
    }
  };

  const run = async (proposalId: string): Promise<void> => {
    clearTimer(proposalId);
    if (disposed || active.has(proposalId)) {
      return;
    }
    active.add(proposalId);
    let attempt = 1;
    let startedAt = now();
    try {
      const proposal = await getSelfImprovementProposal({
        id: proposalId,
        stateDir: params.stateDir,
      });
      if (
        !proposal ||
        proposal.kind !== "memory_skill" ||
        proposal.curatorStatus !== "pending_review"
      ) {
        return;
      }
      const previousAttempts = proposal.curatorDispatch?.attempts ?? 0;
      if (previousAttempts >= MAX_ATTEMPTS) {
        return;
      }
      attempt = previousAttempts + 1;
      startedAt = now();
      const runId = crypto.randomUUID();
      await updateSelfImprovementCuratorDispatch({
        id: proposalId,
        status: "running",
        attempts: attempt,
        lastAttemptAt: startedAt,
        stateDir: params.stateDir,
      });
      await params.runReview({
        proposalId,
        sessionKey: buildCuratorReviewSessionKey(proposalId, attempt, runId),
        attempt,
      });
      const reviewed = await getSelfImprovementProposal({
        id: proposalId,
        stateDir: params.stateDir,
      });
      if (reviewed?.curatorStatus && reviewed.curatorStatus !== "pending_review") {
        await updateSelfImprovementCuratorDispatch({
          id: proposalId,
          status: "succeeded",
          attempts: attempt,
          lastAttemptAt: startedAt,
          stateDir: params.stateDir,
        });
      } else {
        throw new Error("curator run completed without a reviewer decision");
      }
    } catch (error) {
      const message = formatErrorMessage(error);
      const retryDelayMs = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS.at(-1)!;
      const retryAt = attempt < MAX_ATTEMPTS ? startedAt + retryDelayMs : undefined;
      await updateSelfImprovementCuratorDispatch({
        id: proposalId,
        status: "failed",
        attempts: attempt,
        lastAttemptAt: startedAt,
        ...(retryAt !== undefined ? { nextAttemptAt: retryAt } : {}),
        error: message,
        stateDir: params.stateDir,
      });
      if (retryAt !== undefined) {
        const delay = Math.max(0, retryAt - now());
        const timer = setTimeout(() => startRun(proposalId), delay);
        timer.unref?.();
        timers.set(proposalId, timer);
      } else {
        params.log?.error(`curator review exhausted for ${proposalId}: ${message}`);
      }
    } finally {
      active.delete(proposalId);
    }
  };

  startRun = (proposalId) => {
    if (disposed || active.has(proposalId)) {
      return;
    }
    const completion = run(proposalId);
    activeRuns.set(proposalId, completion);
    const settle = () => {
      if (activeRuns.get(proposalId) === completion) {
        activeRuns.delete(proposalId);
      }
    };
    void completion.then(settle, (error) => {
      settle();
      params.log?.error(`curator run failed for ${proposalId}: ${formatErrorMessage(error)}`);
    });
  };

  const enqueue = async (proposalIds: readonly string[]) => {
    if (disposed) {
      return;
    }
    for (const proposalId of [...new Set(proposalIds)].toSorted()) {
      const proposal = await getSelfImprovementProposal({
        id: proposalId,
        stateDir: params.stateDir,
      });
      if (
        !proposal ||
        proposal.kind !== "memory_skill" ||
        proposal.curatorStatus !== "pending_review"
      ) {
        continue;
      }
      if (proposal.curatorDispatch?.status === "succeeded") {
        continue;
      }
      if ((proposal.curatorDispatch?.attempts ?? 0) >= MAX_ATTEMPTS) {
        continue;
      }
      startRun(proposalId);
    }
  };

  const reconcile = async () => {
    if (disposed) {
      return;
    }
    const proposals = await listSelfImprovementProposals({ stateDir: params.stateDir });
    const eligible = proposals
      .filter((proposal) => {
        if (proposal.kind !== "memory_skill" || proposal.curatorStatus !== "pending_review") {
          return false;
        }
        const dispatch = proposal.curatorDispatch;
        if (!dispatch) {
          return true;
        }
        if (dispatch.attempts >= MAX_ATTEMPTS) {
          return false;
        }
        if (dispatch.status === "pending") {
          return true;
        }
        if (dispatch.status === "failed") {
          return (dispatch.nextAttemptAt ?? 0) <= now();
        }
        return (
          dispatch.status === "running" && (dispatch.lastAttemptAt ?? 0) + STALE_RUNNING_MS <= now()
        );
      })
      .map((proposal) => proposal.id);
    await enqueue(eligible);
  };

  const retry = async (proposalId: string) => {
    if (disposed) {
      throw new Error("curator dispatch is disposed");
    }
    const activeRun = activeRuns.get(proposalId);
    if (activeRun) {
      await activeRun;
      if (disposed) {
        throw new Error("curator dispatch is disposed");
      }
    }
    clearTimer(proposalId);
    const proposal = await getSelfImprovementProposal({
      id: proposalId,
      stateDir: params.stateDir,
    });
    if (
      !proposal ||
      proposal.kind !== "memory_skill" ||
      proposal.curatorStatus !== "pending_review"
    ) {
      throw new Error(`curator proposal is not pending review: ${proposalId}`);
    }
    await updateSelfImprovementCuratorDispatch({
      id: proposalId,
      status: "pending",
      attempts: 0,
      stateDir: params.stateDir,
    });
    await enqueue([proposalId]);
  };

  const dispose = () => {
    disposed = true;
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
  };

  return { enqueue, reconcile, retry, dispose };
}
