import { describe, expect, it, vi } from "vitest";
import type { SelfImprovementProposal } from "../types.js";
import type { CuratorProposalRepository } from "./ports.js";
import {
  CuratorDecisionConflictError,
  CuratorPolicyError,
  CuratorProposalNotFoundError,
  createCuratorService,
} from "./service.js";

const proposal: SelfImprovementProposal = {
  id: "sip_service",
  createdAt: 1,
  updatedAt: 1,
  status: "pending",
  kind: "memory_skill",
  groupId: "group_service",
  groupKey: "knowledge_hygiene:service",
  title: "Service proposal",
  summary: "A service-layer proposal.",
  route: {
    role: "memory_curator",
    targetAgentId: "memory-knowledge-curator",
    targetAgentLabel: "Memory & Knowledge Curator",
    reason: "Memory review.",
  },
  sourceRecommendationIds: ["sir_service"],
  recommendedAction: "Review evidence.",
  requiredEvidence: ["Evidence."],
  safetyNotes: ["No direct writes."],
  approvalRequired: true,
  testsRequired: false,
  analysisMode: "deterministic",
};

const review = {
  evidence: [{ sourceClass: "instruction" as const, sourceRef: "service-test" }],
  confidence: "high" as const,
  freshness: "current" as const,
  privacy: "shared_safe" as const,
  contradiction: false,
  reason: "The evidence is sufficient.",
  nextAction: "Keep the draft pending approval.",
  reviewedAt: 1,
};

function repository(overrides: Partial<CuratorProposalRepository> = {}): CuratorProposalRepository {
  return {
    list: vi.fn(async () => [proposal]),
    get: vi.fn(async (id: string) => (id === proposal.id ? proposal : null)),
    updateStatus: vi.fn(async (command) => ({
      ...proposal,
      curatorStatus: command.curatorStatus,
      curatorProof: command.proof,
      curatorReason: command.reason,
      curationReview: command.review,
    })),
    updateDispatch: vi.fn(async () => proposal),
    ...overrides,
  };
}

describe("curator service", () => {
  it("keeps list/get/decision orchestration behind repository ports", async () => {
    const repo = repository();
    const service = createCuratorService({ repository: repo });

    await expect(service.list({ status: "pending_review" })).resolves.toEqual([proposal]);
    await expect(service.get(proposal.id)).resolves.toEqual(proposal);
    await expect(
      service.decide({
        id: proposal.id,
        curatorStatus: "accepted_for_workshop",
        curationReview: review,
        proof: "Service proof.",
        note: "Reviewer-only note.",
      }),
    ).resolves.toMatchObject({ curatorStatus: "accepted_for_workshop" });

    expect(repo.updateStatus).toHaveBeenCalledWith({
      id: proposal.id,
      curatorStatus: "accepted_for_workshop",
      expectedUpdatedAt: proposal.updatedAt,
      expectedCuratorStatus: "pending_review",
      proof: "Service proof.",
      review,
      note: "Reviewer-only note.",
    });
  });

  it("turns missing proposals and policy failures into typed errors", async () => {
    const service = createCuratorService({
      repository: repository({ get: vi.fn(async () => null) }),
    });
    await expect(
      service.decide({ id: "missing", curatorStatus: "rejected", reason: "Not applicable." }),
    ).rejects.toBeInstanceOf(CuratorProposalNotFoundError);

    const policyService = createCuratorService({ repository: repository() });
    await expect(
      policyService.decide({ id: proposal.id, curatorStatus: "rejected" }),
    ).rejects.toBeInstanceOf(CuratorPolicyError);
  });

  it("fails closed when the proposal changes between read and decision", async () => {
    const service = createCuratorService({
      repository: repository({ updateStatus: vi.fn(async () => null) }),
    });

    await expect(
      service.decide({
        id: proposal.id,
        curatorStatus: "accepted_for_workshop",
        curationReview: review,
        proof: "Service proof.",
      }),
    ).rejects.toBeInstanceOf(CuratorDecisionConflictError);
  });

  it("commits a prepared decision without re-reading the proposal", async () => {
    const repo = repository();
    const service = createCuratorService({ repository: repo });

    await service.decidePrepared(proposal, {
      id: proposal.id,
      curatorStatus: "accepted_for_workshop",
      curationReview: review,
      proof: "Prepared proof.",
    });

    expect(repo.get).not.toHaveBeenCalled();
    expect(repo.updateStatus).toHaveBeenCalledTimes(1);
  });
});
