import { describe, expect, it, vi } from "vitest";
import type { OperationsRepairRecipe } from "./remediation-engine.js";
import { createOperationsRemediationLocalAi } from "./remediation-local-ai.js";
import type { OperationsFinding } from "./types.js";

const finding = {
  id: "cron:one:failure",
  severity: "critical",
  category: "cron",
  title: "Failed schedule",
  detail: "Repeated failure",
  lastObservedAt: 1,
  disposition: "needs_user",
  responseState: "waiting_for_user",
  impact: "Future runs may fail.",
} satisfies OperationsFinding;

const recipe = {
  id: "recipe.v1",
  risk: "medium",
  domain: "routine",
  confidence: 0.98,
  recommendationReason: "Pausing the repeated failure is bounded.",
  exactRepair: "Pause it.",
  expectedChange: "Only the schedule is paused.",
  verificationPlan: "Read the schedule back and confirm it is paused.",
  rollback: "Enable it.",
  reversible: true,
  verificationMode: "authoritative_readback",
  rollbackVerificationMode: "authoritative_readback",
  matches: () => true,
  apply: async () => {},
  verify: async () => ({ passed: true, evidence: "ok" }),
} satisfies OperationsRepairRecipe;

function response(content: string, model = "qwen3.6:27b-q8_0") {
  return new Response(JSON.stringify({ done: true, message: { content }, model }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Operations remediation local AI", () => {
  it("uses only the required local models and parses bounded JSON", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(JSON.stringify({ confidence: 0.99, recommendation: "Safe." })),
      )
      .mockResolvedValueOnce(
        response(
          JSON.stringify({ approved: true, reason: "Verified." }),
          "openclaw-judge-qwen35-27b-q8:latest",
        ),
      );
    const ai = createOperationsRemediationLocalAi({ fetchImpl });
    const investigation = await ai.investigate({ finding, recipe });
    await expect(ai.judge({ finding, recipe, investigation })).resolves.toEqual({
      approved: true,
      reason: "Verified.",
    });
    const investigationRequest = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(investigationRequest.model).toBe("qwen3.6:27b-q8_0");
    expect(investigationRequest.think).toBe(false);
    expect(investigationRequest.options).toMatchObject({
      num_ctx: 8192,
      num_predict: 512,
      temperature: 0,
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).model).toBe(
      "openclaw-judge-qwen35-27b-q8:latest",
    );
    expect(fetchImpl.mock.calls[0][1].body).toContain("untrusted data");
    expect(fetchImpl.mock.calls[0][1].body).not.toContain("Repeated failure");
  });

  it("produces advisory recommendations and keeps Judge approval non-executable", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            risk: "high",
            domain: "novel",
            confidence: 0.94,
            recommendedFix: "Collect a read-only diagnostic bundle.",
            reason: "No approved recipe matches.",
            expectedChange: "No runtime state changes.",
            verificationPlan: "Verify the bundle is complete and secret-free.",
            rollback: "Not needed for a read-only recommendation.",
          }),
        ),
      )
      .mockResolvedValueOnce(
        response(
          JSON.stringify({ approved: true, reason: "Bounded and read-only." }),
          "openclaw-judge-qwen35-27b-q8:latest",
        ),
      );
    const ai = createOperationsRemediationLocalAi({ fetchImpl });
    const recommendation = await ai.recommend?.({ finding });
    await expect(
      ai.judgeRecommendation?.({ finding, recommendation: recommendation! }),
    ).resolves.toEqual({ approved: true, reason: "Bounded and read-only." });
    expect(recommendation).toMatchObject({
      risk: "high",
      domain: "novel",
      confidence: 0.94,
      recommendedFix: "Collect a read-only diagnostic bundle.",
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe("qwen3.6:27b-q8_0");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).model).toBe(
      "openclaw-judge-qwen35-27b-q8:latest",
    );
  });

  it("rejects non-loopback model endpoints", () => {
    expect(() =>
      createOperationsRemediationLocalAi({ baseUrl: "http://example.com:11434" }),
    ).toThrow(/loopback/);
  });

  it("fails closed on an invalid model decision", async () => {
    const ai = createOperationsRemediationLocalAi({
      fetchImpl: vi.fn(async () =>
        response('{"approved":"yes"}', "openclaw-judge-qwen35-27b-q8:latest"),
      ),
    });
    await expect(
      ai.judge({
        finding,
        recipe,
        investigation: {
          confidence: 0.99,
          recommendation: "Safe.",
        },
      }),
    ).rejects.toThrow(/invalid decision/);
  });

  it("fails closed when Ollama returns a different model identity", async () => {
    const ai = createOperationsRemediationLocalAi({
      fetchImpl: vi.fn(async () =>
        response('{"confidence":0.99,"recommendation":"Safe."}', "unexpected-model"),
      ),
    });
    await expect(ai.investigate({ finding, recipe })).rejects.toThrow(/identity/);
  });
});
