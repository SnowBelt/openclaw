import { describe, expect, it } from "vitest";
import {
  evaluateSelfImprovementFinalAcceptance,
  evaluateSelfImprovementProductionSoak,
  SELF_IMPROVEMENT_ACCEPTANCE_SURFACES,
  SELF_IMPROVEMENT_PRODUCTION_SOAK_MS,
  type SelfImprovementSoakInput,
} from "./acceptance.js";

const start = Date.parse("2026-07-10T12:00:00.000Z");
const releaseId = "20260710T120000Z-candidate";

function passingSoak(): SelfImprovementSoakInput {
  return {
    candidateReleaseId: releaseId,
    startedAt: start,
    checkedAt: start + SELF_IMPROVEMENT_PRODUCTION_SOAK_MS,
    samples: Array.from({ length: 13 }, (_, index) => ({
      observedAt: start + index * 6 * 60 * 60_000,
      runtimeReleaseId: releaseId,
      productionReady: true,
      productionScore: 95,
      blockers: [],
      rpcReady: true,
      dashboardReady: true,
      safetyViolations: 0,
    })),
    managedRestartReleaseIds: [releaseId, releaseId],
    rollbackVerified: true,
  };
}

describe("Self-Improvement final acceptance", () => {
  it("passes only after a continuous quality-safe candidate soak", () => {
    expect(evaluateSelfImprovementProductionSoak(passingSoak())).toMatchObject({
      status: "passed",
      sampleCount: 13,
      distributedSampleCount: 13,
      blockers: [],
    });
  });

  it("keeps an otherwise healthy soak pending until duration and restart proof are complete", () => {
    const input = passingSoak();
    input.checkedAt = start + 24 * 60 * 60_000;
    input.samples = input.samples.slice(0, 5);
    input.managedRestartReleaseIds = [releaseId];
    input.rollbackVerified = false;
    const result = evaluateSelfImprovementProductionSoak(input);
    expect(result.status).toBe("pending");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("managed candidate restart"),
        "Candidate rollback has not been verified.",
        expect.stringContaining("required 259200000ms duration"),
        expect.stringContaining("requires 13 distributed samples"),
      ]),
    );
  });

  it("fails closed on runtime drift, low quality, or a safety violation", () => {
    const input = passingSoak();
    input.samples[4] = {
      ...input.samples[4],
      runtimeReleaseId: "different-release",
      productionScore: 80,
      safetyViolations: 1,
    };
    const result = evaluateSelfImprovementProductionSoak(input);
    expect(result.status).toBe("failed");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "A soak sample came from a different runtime release.",
        "At least one soak sample is below the 93 quality target.",
        "At least one soak sample reported a safety-boundary violation.",
      ]),
    );
  });

  it("rejects samples outside the declared window and incomplete end coverage", () => {
    const outsideWindow = passingSoak();
    outsideWindow.samples[0] = {
      ...outsideWindow.samples[0],
      observedAt: outsideWindow.startedAt - 1,
    };
    expect(evaluateSelfImprovementProductionSoak(outsideWindow)).toMatchObject({
      status: "failed",
      blockers: expect.arrayContaining([
        "Every soak sample must fall inside the declared observation window.",
      ]),
    });

    const staleCompletion = passingSoak();
    staleCompletion.samples = staleCompletion.samples.slice(0, -3);
    expect(evaluateSelfImprovementProductionSoak(staleCompletion)).toMatchObject({
      status: "failed",
      blockers: expect.arrayContaining([
        "The latest soak sample is older than the maximum allowed completion gap.",
      ]),
    });
  });

  it("does not count rapid repeated samples as distributed soak coverage", () => {
    const input = passingSoak();
    input.samples = Array.from({ length: 13 }, (_, index) => ({
      ...input.samples[0],
      observedAt: start + index * 60_000,
    }));
    const result = evaluateSelfImprovementProductionSoak(input);
    expect(result).toMatchObject({
      status: "failed",
      sampleCount: 13,
      distributedSampleCount: 1,
      blockers: expect.arrayContaining([
        "The latest soak sample is older than the maximum allowed completion gap.",
      ]),
    });
  });

  it("requires every proof surface plus quality, safety, and soak evidence", () => {
    const receipts = SELF_IMPROVEMENT_ACCEPTANCE_SURFACES.map((surface) => ({
      surface,
      status: "passed" as const,
      observedAt: start,
      evidence: [`receipt:${surface}`],
    }));
    const passed = evaluateSelfImprovementFinalAcceptance({
      receipts,
      qualityScore: 95,
      safetyScore: 100,
      soak: passingSoak(),
    });
    expect(passed.complete).toBe(true);
    expect(Object.values(passed.surfaces).every(Boolean)).toBe(true);

    const failedReceipts = receipts.filter((receipt) => receipt.surface !== "dashboard");
    const rpcReceipt = failedReceipts.find((receipt) => receipt.surface === "rpc");
    if (rpcReceipt) {
      rpcReceipt.evidence = ["   "];
    }
    const failed = evaluateSelfImprovementFinalAcceptance({
      receipts: failedReceipts,
      qualityScore: 92,
      safetyScore: 99,
      soak: passingSoak(),
    });
    expect(failed.complete).toBe(false);
    expect(failed.blockers).toEqual(
      expect.arrayContaining([
        "Acceptance surface dashboard lacks a passing evidence receipt.",
        "Acceptance surface rpc lacks a passing evidence receipt.",
        "Quality score 92 is below 93.",
        "Safety score 99 must equal 100.",
      ]),
    );
  });
});
