import { describe, expect, it } from "vitest";
import {
  appendSelfImprovementSoakSample,
  createSelfImprovementSoakReceipt,
  recordSelfImprovementSoakRestart,
  recordSelfImprovementSoakRollback,
  shouldAutomaticallyRollbackSelfImprovementSoak,
} from "./soak.js";

const startedAt = Date.parse("2026-07-13T12:00:00.000Z");
const candidateReleaseId = "candidate-release";
const rollbackReleaseId = "previous-release";

function receipt() {
  return createSelfImprovementSoakReceipt({
    candidateReleaseId,
    rollbackReleaseId,
    automaticRollbackEnabled: true,
    startedAt,
    rollbackEvidence: { path: "work/rollback.json", sha256: "a".repeat(64) },
  });
}

function sample() {
  return {
    observedAt: startedAt,
    runtimeReleaseId: candidateReleaseId,
    productionReady: true,
    productionScore: 95,
    blockers: [],
    rpcReady: true,
    dashboardReady: true,
    safetyViolations: 0,
  };
}

describe("Self-Improvement production soak receipt", () => {
  it("requires a distinct preregistered rollback release for automatic rollback", () => {
    expect(() =>
      createSelfImprovementSoakReceipt({
        candidateReleaseId,
        automaticRollbackEnabled: true,
        startedAt,
        rollbackEvidence: { path: "work/rollback.json", sha256: "a".repeat(64) },
      }),
    ).toThrow("Automatic rollback requires a rollback release id.");
    expect(() =>
      createSelfImprovementSoakReceipt({
        candidateReleaseId,
        rollbackReleaseId: candidateReleaseId,
        automaticRollbackEnabled: true,
        startedAt,
        rollbackEvidence: { path: "work/rollback.json", sha256: "a".repeat(64) },
      }),
    ).toThrow("Rollback release must differ from the candidate release.");
  });

  it("appends idempotent bounded samples and verifies candidate restarts", () => {
    const first = appendSelfImprovementSoakSample({ receipt: receipt(), sample: sample() });
    const replaced = appendSelfImprovementSoakSample({
      receipt: first,
      sample: { ...sample(), productionScore: 96 },
    });
    expect(replaced.samples).toHaveLength(1);
    expect(replaced.samples[0]?.productionScore).toBe(96);
    expect(
      recordSelfImprovementSoakRestart({
        receipt: replaced,
        releaseId: candidateReleaseId,
        observedAt: startedAt + 1,
      }).managedRestartReleaseIds,
    ).toEqual([candidateReleaseId]);
    expect(() =>
      recordSelfImprovementSoakRestart({
        receipt: replaced,
        releaseId: rollbackReleaseId,
        observedAt: startedAt + 1,
      }),
    ).toThrow("Managed restart did not return to the candidate release.");
  });

  it("permits automatic rollback only for an unhealthy active candidate sample", () => {
    expect(
      shouldAutomaticallyRollbackSelfImprovementSoak({
        receipt: receipt(),
        sample: { ...sample(), productionScore: 92 },
      }),
    ).toBe(true);
    expect(
      shouldAutomaticallyRollbackSelfImprovementSoak({
        receipt: receipt(),
        sample: { ...sample(), runtimeReleaseId: rollbackReleaseId, productionScore: 0 },
      }),
    ).toBe(false);
  });

  it("records rollback only after the preregistered release is verified", () => {
    const rolledBack = recordSelfImprovementSoakRollback({
      receipt: receipt(),
      performedAt: startedAt + 1,
      verifiedAt: startedAt + 2,
      toReleaseId: rollbackReleaseId,
    });
    expect(rolledBack.rollbackResult).toMatchObject({
      fromReleaseId: candidateReleaseId,
      toReleaseId: rollbackReleaseId,
    });
    expect(() =>
      recordSelfImprovementSoakRollback({
        receipt: receipt(),
        performedAt: startedAt + 1,
        verifiedAt: startedAt + 2,
        toReleaseId: "unapproved-release",
      }),
    ).toThrow("Rollback verification did not match the preregistered rollback release.");
  });
});
