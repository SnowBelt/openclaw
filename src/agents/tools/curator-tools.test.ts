import { describe, expect, it, vi } from "vitest";
import { createCuratorTools } from "./curator-tools.js";

const review = {
  evidence: [{ sourceClass: "instruction", sourceRef: "proposal-source" }],
  confidence: "high",
  freshness: "current",
  privacy: "shared_safe",
  contradiction: false,
  reason: "Evidence is current and bounded.",
  nextAction: "Keep the workshop draft pending approval.",
  reviewedAt: 1,
};

describe("curator tools", () => {
  it("exposes only bounded read and reviewer-decision tools", () => {
    const tools = createCuratorTools({ callGateway: vi.fn() as never });

    expect(tools.map((tool) => tool.name)).toEqual(["curator_get", "curator_decide"]);
  });

  it("uses flat enum schemas accepted by providers that reject anyOf", () => {
    const tools = createCuratorTools({ callGateway: vi.fn() as never });
    const decisionSchema = tools[1]?.parameters as {
      properties?: Record<
        string,
        {
          anyOf?: unknown[];
          properties?: Record<string, unknown>;
          items?: { properties?: Record<string, { anyOf?: unknown[]; enum?: unknown[] }> };
          enum?: unknown[];
        }
      >;
    };
    const reviewSchema = decisionSchema.properties?.curationReview?.properties as Record<
      string,
      { anyOf?: unknown[]; enum?: unknown[] }
    >;
    const evidenceSchema = reviewSchema.evidence as unknown as {
      items?: { properties?: Record<string, { anyOf?: unknown[]; enum?: unknown[] }> };
    };
    const evidenceProperties = evidenceSchema.items?.properties ?? {};

    expect(decisionSchema.properties?.curatorStatus?.enum).toEqual([
      "accepted_for_workshop",
      "rejected",
      "needs_more_evidence",
      "superseded",
    ]);
    expect(decisionSchema.properties?.curatorStatus?.anyOf).toBeUndefined();
    expect(evidenceProperties.sourceClass?.anyOf).toBeUndefined();
    expect(evidenceProperties.sourceClass?.enum).toContain("instruction");
    expect(reviewSchema.confidence?.anyOf).toBeUndefined();
    expect(reviewSchema.freshness?.anyOf).toBeUndefined();
    expect(reviewSchema.privacy?.anyOf).toBeUndefined();
  });

  it("routes proposal reads and one structured decision through Gateway RPC", async () => {
    const callGateway = vi.fn().mockResolvedValue({ proposal: { id: "sip_test" } });
    const tools = createCuratorTools({ callGateway: callGateway as never });

    await tools[0]?.execute("get-1", { proposalId: "sip_test" });
    await tools[1]?.execute("decide-1", {
      proposalId: "sip_test",
      curatorStatus: "needs_more_evidence",
      curationReview: review,
      proof: "Bounded review proof.",
    });

    expect(callGateway).toHaveBeenNthCalledWith(1, {
      method: "selfImprovement.curator.get",
      params: { id: "sip_test" },
    });
    expect(callGateway).toHaveBeenNthCalledWith(2, {
      method: "selfImprovement.curator.update",
      params: {
        id: "sip_test",
        curatorStatus: "needs_more_evidence",
        curationReview: review,
        proof: "Bounded review proof.",
        reason: "Evidence is current and bounded.",
      },
    });
    expect(callGateway).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: expect.stringContaining("promot") }),
    );
  });

  it("falls back to reviewer-only note metadata on older curator RPCs", async () => {
    const callGateway = vi
      .fn()
      .mockResolvedValueOnce({ proposal: { id: "sip_legacy" } })
      .mockRejectedValueOnce(
        new Error(
          "invalid selfImprovement.curator.update params: at root: unexpected property 'curationReview'",
        ),
      )
      .mockResolvedValueOnce({ proposal: { id: "sip_legacy" } });
    const tools = createCuratorTools({ callGateway: callGateway as never });

    await tools[0]?.execute("get-legacy", { proposalId: "sip_legacy" });
    await tools[1]?.execute("decide-legacy", {
      proposalId: "sip_legacy",
      curatorStatus: "needs_more_evidence",
      curationReview: review,
      proof: "Bounded legacy review proof.",
    });

    expect(callGateway).toHaveBeenCalledTimes(3);
    expect(callGateway).toHaveBeenNthCalledWith(3, {
      method: "selfImprovement.curator.update",
      params: {
        id: "sip_legacy",
        curatorStatus: "needs_more_evidence",
        proof: "Bounded legacy review proof.",
        reason: "Evidence is current and bounded.",
        note: `reviewer-only-curation-review:${JSON.stringify(review)}`,
      },
    });
  });

  it("rejects decide-before-read, mismatched ids, duplicate reads, and duplicate decisions", async () => {
    const callGateway = vi.fn().mockResolvedValue({ proposal: { id: "sip_guard" } });
    const tools = createCuratorTools({ callGateway: callGateway as never });
    const decision = {
      proposalId: "sip_guard",
      curatorStatus: "needs_more_evidence",
      curationReview: review,
      proof: "Guard proof.",
    };

    await expect(tools[1]?.execute("decide-before-read", decision)).rejects.toThrow(
      "curator_get must complete",
    );
    await tools[0]?.execute("get-once", { proposalId: "sip_guard" });
    await expect(tools[0]?.execute("get-twice", { proposalId: "sip_guard" })).rejects.toThrow(
      "exactly once",
    );
    await expect(
      tools[1]?.execute("decide-mismatch", { ...decision, proposalId: "sip_other" }),
    ).rejects.toThrow("must match");
    await tools[1]?.execute("decide-once", decision);
    await expect(tools[1]?.execute("decide-twice", decision)).rejects.toThrow("exactly once");
    expect(callGateway).toHaveBeenCalledTimes(2);
  });

  it("allows one decision retry only when the Gateway write itself fails", async () => {
    const callGateway = vi
      .fn()
      .mockResolvedValueOnce({ proposal: { id: "sip_retry" } })
      .mockRejectedValueOnce(new Error("temporary write failure"))
      .mockResolvedValueOnce({ proposal: { id: "sip_retry" } });
    const tools = createCuratorTools({ callGateway: callGateway as never });
    const decision = {
      proposalId: "sip_retry",
      curatorStatus: "needs_more_evidence",
      curationReview: review,
      proof: "Retry proof.",
    };

    await tools[0]?.execute("get", { proposalId: "sip_retry" });
    await expect(tools[1]?.execute("decide-fail", decision)).rejects.toThrow(
      "temporary write failure",
    );
    await expect(tools[1]?.execute("decide-retry", decision)).resolves.toBeDefined();
    expect(callGateway).toHaveBeenCalledTimes(3);
  });
});
