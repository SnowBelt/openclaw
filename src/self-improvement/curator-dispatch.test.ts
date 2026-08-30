import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSelfImprovementCuratorDispatch } from "./curator-dispatch.js";
import {
  buildSelfImprovementProposalsFromGroups,
  getSelfImprovementProposal,
  updateSelfImprovementCuratorDispatch,
  updateSelfImprovementCuratorStatus,
  upsertSelfImprovementProposals,
} from "./proposals.js";
import type { SelfImprovementRecommendationGroup } from "./types.js";

const now = Date.parse("2026-08-21T12:00:00.000Z");
let stateDir: string;

function group(): SelfImprovementRecommendationGroup {
  return {
    id: "sig_memory_dispatch",
    groupKey: "knowledge_hygiene:knowledge:dispatch",
    title: "Dispatch proposal",
    category: "knowledge_hygiene",
    severity: "medium",
    criticality: "medium",
    priority: "medium",
    status: "open",
    route: {
      role: "memory_curator",
      targetAgentId: "memory-knowledge-curator",
      targetAgentLabel: "Memory & Knowledge Curator",
      reason: "Memory review.",
    },
    count: 1,
    open: 1,
    acknowledged: 0,
    assigned: 0,
    inProgress: 0,
    reopened: 0,
    quarantined: 0,
    resolved: 0,
    dismissed: 0,
    requiresTests: false,
    requiresApproval: true,
    firstSeenAt: now,
    lastSeenAt: now,
    lastUpdatedAt: now,
    recommendationIds: ["sir_memory_dispatch"],
    topEvidence: ["Dispatch evidence."],
    recommendedAction: "Review the proposal.",
    analysis: {
      mode: "deterministic",
      summary: "Bounded dispatch test.",
      generatedAt: now,
      confidence: 0.9,
      promptVersion: "test",
      evidenceCount: 1,
      safetyNotes: ["No writes."],
    },
  };
}

async function createProposal() {
  const [proposal] = buildSelfImprovementProposalsFromGroups({ groups: [group()], now });
  if (!proposal) {
    throw new Error("expected memory proposal");
  }
  await upsertSelfImprovementProposals({ stateDir, proposals: [proposal] });
  return proposal;
}

async function waitForProposal(
  id: string,
  predicate: (status: Awaited<ReturnType<typeof getSelfImprovementProposal>>) => boolean,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const proposal = await getSelfImprovementProposal({ id, stateDir });
    if (predicate(proposal)) {
      return proposal;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  return await getSelfImprovementProposal({ id, stateDir });
}

describe("self-improvement curator dispatch", () => {
  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-curator-dispatch-"));
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("deduplicates an event and records a successful reviewer decision", async () => {
    const proposal = await createProposal();
    let reviewRuns = 0;
    const sessionKeys: string[] = [];
    const dispatch = createSelfImprovementCuratorDispatch({
      stateDir,
      now: () => now,
      runReview: async ({ proposalId, sessionKey }) => {
        reviewRuns += 1;
        sessionKeys.push(sessionKey);
        await updateSelfImprovementCuratorStatus({
          stateDir,
          id: proposalId,
          curatorStatus: "accepted_for_workshop",
          proof: "Bounded test review.",
          review: {
            evidence: [{ sourceClass: "instruction", sourceRef: "dispatch-test" }],
            confidence: "high",
            freshness: "current",
            privacy: "shared_safe",
            contradiction: false,
            reason: "Evidence is current.",
            nextAction: "Keep the draft pending approval.",
            reviewedAt: now,
          },
          now,
        });
      },
    });

    await dispatch.enqueue([proposal.id, proposal.id]);
    const reviewed = await waitForProposal(
      proposal.id,
      (entry) => entry?.curatorDispatch?.status === "succeeded",
    );
    dispatch.dispose();

    expect(reviewRuns).toBe(1);
    expect(sessionKeys).toHaveLength(1);
    expect(sessionKeys[0]).toMatch(
      new RegExp(`:curator-review:${proposal.id}:attempt-1:[0-9a-f-]{36}$`),
    );
    expect(reviewed).toMatchObject({
      curatorStatus: "accepted_for_workshop",
      curatorDispatch: { status: "succeeded", attempts: 1 },
      workshopDraft: { status: "pending" },
    });
  });

  it("claims a proposal before async reads so concurrent events still run once", async () => {
    const proposal = await createProposal();
    let reviewRuns = 0;
    let releaseReview!: () => void;
    const reviewReleased = new Promise<void>((resolve) => {
      releaseReview = resolve;
    });
    let reviewStarted!: () => void;
    const reviewHasStarted = new Promise<void>((resolve) => {
      reviewStarted = resolve;
    });
    const dispatch = createSelfImprovementCuratorDispatch({
      stateDir,
      now: () => now,
      runReview: async ({ proposalId }) => {
        reviewRuns += 1;
        reviewStarted();
        await reviewReleased;
        await updateSelfImprovementCuratorStatus({
          stateDir,
          id: proposalId,
          curatorStatus: "rejected",
          proof: "Concurrent dispatch test.",
          review: {
            evidence: [{ sourceClass: "instruction", sourceRef: "concurrency-test" }],
            confidence: "high",
            freshness: "current",
            privacy: "shared_safe",
            contradiction: false,
            reason: "Test evidence is sufficient.",
            nextAction: "Keep the proposal rejected.",
            reviewedAt: now,
          },
          now,
        });
      },
    });

    await Promise.all([dispatch.enqueue([proposal.id]), dispatch.enqueue([proposal.id])]);
    await reviewHasStarted;
    releaseReview();
    const reviewed = await waitForProposal(
      proposal.id,
      (entry) => entry?.curatorDispatch?.status === "succeeded",
    );
    dispatch.dispose();

    expect(reviewRuns).toBe(1);
    expect(reviewed?.curatorStatus).toBe("rejected");
  });

  it("records a failed review and permits an explicit bounded retry", async () => {
    const proposal = await createProposal();
    let reviewRuns = 0;
    const sessionKeys: string[] = [];
    const dispatch = createSelfImprovementCuratorDispatch({
      stateDir,
      now: () => now,
      runReview: async ({ sessionKey }) => {
        reviewRuns += 1;
        sessionKeys.push(sessionKey);
        throw new Error("reviewer unavailable");
      },
    });

    await dispatch.enqueue([proposal.id]);
    const failed = await waitForProposal(
      proposal.id,
      (entry) => entry?.curatorDispatch?.status === "failed",
    );
    expect(failed?.curatorDispatch).toMatchObject({ status: "failed", attempts: 1 });

    const firstUpdatedAt = failed?.updatedAt;
    await dispatch.retry(proposal.id);
    const retried = await waitForProposal(
      proposal.id,
      (entry) => entry?.curatorDispatch?.status === "failed" && entry.updatedAt !== firstUpdatedAt,
    );
    dispatch.dispose();

    expect(reviewRuns).toBe(2);
    expect(sessionKeys[0]).not.toBe(sessionKeys[1]);
    expect(sessionKeys.every((key) => key.includes(`:curator-review:${proposal.id}:`))).toBe(true);
    expect(retried?.curatorStatus).toBe("pending_review");
  });

  it("does not dispatch proposals that already exhausted their attempts", async () => {
    const proposal = await createProposal();
    await updateSelfImprovementCuratorDispatchForTest(proposal.id);
    let reviewRuns = 0;
    const dispatch = createSelfImprovementCuratorDispatch({
      stateDir,
      runReview: async () => {
        reviewRuns += 1;
      },
    });
    await dispatch.reconcile();
    dispatch.dispose();

    expect(reviewRuns).toBe(0);
  });
});

async function updateSelfImprovementCuratorDispatchForTest(id: string) {
  await updateSelfImprovementCuratorDispatch({
    stateDir,
    id,
    status: "failed",
    attempts: 3,
    error: "exhausted",
    now,
  });
}
