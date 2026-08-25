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

  it("fails closed when the Gateway lacks the structured curator RPC contract", async () => {
    const callGateway = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "invalid selfImprovement.curator.update params: at root: unexpected property 'curationReview'",
        ),
      );
    const tools = createCuratorTools({ callGateway: callGateway as never });

    await expect(
      tools[1]?.execute("decide-legacy", {
        proposalId: "sip_legacy",
        curatorStatus: "needs_more_evidence",
        curationReview: review,
        proof: "Bounded legacy review proof.",
      }),
    ).rejects.toThrow("unexpected property 'curationReview'");

    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(callGateway).toHaveBeenCalledWith({
      method: "selfImprovement.curator.update",
      params: {
        id: "sip_legacy",
        curatorStatus: "needs_more_evidence",
        curationReview: review,
        proof: "Bounded legacy review proof.",
        reason: "Evidence is current and bounded.",
      },
    });
  });
});
