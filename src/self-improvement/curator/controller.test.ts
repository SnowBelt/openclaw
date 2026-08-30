import { describe, expect, it, vi } from "vitest";
import type { SelfImprovementProposal } from "../types.js";
import { createCuratorReviewController } from "./controller.js";
import type { CuratorModelAdapter, CuratorModelRecommendation } from "./model-adapter.js";
import type { CuratorProposalRepository } from "./ports.js";

const now = 2_000;

function proposal(overrides: Partial<SelfImprovementProposal> = {}): SelfImprovementProposal {
  return {
    id: "sip_controller",
    createdAt: 1_000,
    updatedAt: 1_500,
    status: "pending",
    kind: "memory_skill",
    groupId: "group_controller",
    groupKey: "knowledge_hygiene:controller",
    title: "Controller proposal",
    summary: "A bounded proposal.",
    route: {
      role: "memory_curator",
      targetAgentId: "memory-knowledge-curator",
      targetAgentLabel: "Memory & Knowledge Curator",
      reason: "Memory review.",
    },
    sourceRecommendationIds: ["sir_controller"],
    recommendedAction: "Review cited evidence.",
    requiredEvidence: ["Current evidence."],
    safetyNotes: ["No writes."],
    approvalRequired: true,
    testsRequired: false,
    analysisMode: "deterministic",
    ...overrides,
  };
}

const accepted: CuratorModelRecommendation = {
  status: "accepted_for_workshop",
  evidence: [{ sourceClass: "instruction", sourceRef: "sir_controller" }],
  confidence: "high",
  freshness: "current",
  privacy: "shared_safe",
  contradiction: false,
  reason: "Evidence is bounded and current.",
  nextAction: "Keep the workshop approval-gated.",
};

function harness(params?: {
  proposal?: SelfImprovementProposal;
  model?: CuratorModelAdapter;
  update?: CuratorProposalRepository["updateStatus"];
}) {
  const existing = params?.proposal ?? proposal();
  const repository: CuratorProposalRepository = {
    list: vi.fn(async () => [existing]),
    get: vi.fn(async () => existing),
    updateStatus:
      params?.update ??
      vi.fn(async (command) => ({
        ...existing,
        curatorStatus: command.curatorStatus,
        curationReview: command.review,
      })),
    updateDispatch: vi.fn(async () => existing),
  };
  const model =
    params?.model ??
    ({
      recommend: vi.fn(async () => ({
        modelRef: "local/small-model",
        recommendation: accepted,
      })),
    } satisfies CuratorModelAdapter);
  return {
    repository,
    model,
    controller: createCuratorReviewController({ repository, model, now: () => now }),
  };
}

describe("curator review controller", () => {
  it("owns exactly one read and one CAS decision write", async () => {
    const { controller, repository, model } = harness();
    const receipt = await controller.review("sip_controller");

    expect(receipt).toMatchObject({
      status: "accepted_for_workshop",
      modelRef: "local/small-model",
      modelAttempts: 1,
      modelAccepted: true,
      usedFallback: false,
      trace: { proposalReads: 1, decisionWrites: 1, forbiddenOperations: [] },
      privateContentDisclosed: false,
    });
    expect(repository.get).toHaveBeenCalledTimes(1);
    expect(repository.updateStatus).toHaveBeenCalledTimes(1);
    expect(model.recommend).toHaveBeenCalledTimes(1);
  });

  it("bypasses the model and rejects sensitive evidence without disclosure", async () => {
    const { controller, repository, model } = harness({
      proposal: proposal({ summary: "token=[redacted] PRIVATE-SENSITIVE-CONTENT" }),
    });
    const receipt = await controller.review("sip_controller");

    expect(receipt).toMatchObject({
      status: "rejected",
      privacy: "blocked_sensitive",
      modelAttempts: 0,
      privateContentDisclosed: false,
    });
    expect(model.recommend).not.toHaveBeenCalled();
    expect(
      JSON.stringify((repository.updateStatus as ReturnType<typeof vi.fn>).mock.calls),
    ).not.toContain("PRIVATE-SENSITIVE-CONTENT");
  });

  it("keeps incomplete evidence pending without invoking a model", async () => {
    const { controller, model } = harness({ proposal: proposal({ requiredEvidence: [] }) });
    await expect(controller.review("sip_controller")).resolves.toMatchObject({
      status: "needs_more_evidence",
      modelAttempts: 0,
    });
    expect(model.recommend).not.toHaveBeenCalled();
  });

  it("repairs generation once then fails closed without retrying the decision", async () => {
    const model: CuratorModelAdapter = {
      recommend: vi.fn(async () => {
        throw new Error("malformed JSON");
      }),
    };
    const update = vi.fn(async (command) => ({
      ...proposal(),
      curatorStatus: command.curatorStatus,
      curationReview: command.review,
    }));
    const { controller, repository } = harness({ model, update });
    const receipt = await controller.review("sip_controller");

    expect(receipt).toMatchObject({
      status: "needs_more_evidence",
      modelAttempts: 2,
      modelAccepted: false,
      usedFallback: true,
    });
    expect(model.recommend).toHaveBeenCalledTimes(2);
    expect(repository.updateStatus).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a CAS conflict and never retries the write", async () => {
    const update = vi.fn(async () => null);
    const { controller, repository } = harness({ update });

    await expect(controller.review("sip_controller")).rejects.toThrow(
      "changed while it was being reviewed",
    );
    expect(repository.get).toHaveBeenCalledTimes(1);
    expect(repository.updateStatus).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["private advice", { ...accepted, privacy: "private_reference_only" as const }],
    ["stale advice", { ...accepted, freshness: "stale_risk" as const }],
    ["contradictory advice", { ...accepted, contradiction: true }],
    ["low-confidence advice", { ...accepted, confidence: "low" as const }],
  ])("downgrades %s to needs_more_evidence", async (_label, recommendation) => {
    const model: CuratorModelAdapter = {
      recommend: vi.fn(async () => ({ modelRef: "local/adversarial", recommendation })),
    };
    const { controller } = harness({ model });
    await expect(controller.review("sip_controller")).resolves.toMatchObject({
      status: "needs_more_evidence",
    });
  });
});
