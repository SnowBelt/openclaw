import { describe, expect, it } from "vitest";
import {
  verifyControlDirectorDiagnosticEvidence,
  type ControlDirectorDiagnosticClaim,
  type ControlDirectorDiagnosticEvidence,
} from "./control-director-diagnostic-evidence.js";

const NOW = 1_800_000;

function claim(
  overrides: Partial<ControlDirectorDiagnosticClaim> = {},
): ControlDirectorDiagnosticClaim {
  return {
    schemaVersion: 1,
    kind: "completion",
    subjectId: "mission-1",
    expectedBinding: "claim-hash-1",
    ...overrides,
  };
}

function evidence(
  overrides: Partial<ControlDirectorDiagnosticEvidence> = {},
): ControlDirectorDiagnosticEvidence {
  return {
    schemaVersion: 1,
    kind: "completion",
    subjectId: "mission-1",
    source: "judge_receipt",
    sourceId: "judge-receipt-1",
    observedAt: NOW - 1_000,
    binding: "claim-hash-1",
    status: "supported",
    ...overrides,
  };
}

describe("verifyControlDirectorDiagnosticEvidence", () => {
  it.each(["completion", "blocker", "worker", "task_root"] as const)(
    "supports a fresh, exactly bound %s claim",
    (kind) => {
      const result = verifyControlDirectorDiagnosticEvidence({
        claim: claim({ kind }),
        evidence: evidence({ kind }),
        now: NOW,
      });

      expect(result.status).toBe("supported");
      expect(result.claimHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(result).toHaveProperty("evidenceId");
    },
  );

  it("rejects unavailable evidence", () => {
    expect(verifyControlDirectorDiagnosticEvidence({ claim: claim(), now: NOW })).toMatchObject({
      status: "rejected",
      reason: "unavailable",
    });
  });

  it("rejects evidence that explicitly does not support the claim", () => {
    expect(
      verifyControlDirectorDiagnosticEvidence({
        claim: claim({ kind: "blocker", expectedBinding: "blocker-hash" }),
        evidence: evidence({
          kind: "blocker",
          binding: "blocker-hash",
          status: "unsupported",
        }),
        now: NOW,
      }),
    ).toMatchObject({ status: "rejected", reason: "unsupported" });
  });

  it.each([
    { name: "kind", evidence: { kind: "worker" as const } },
    { name: "subject", evidence: { subjectId: "mission-2" } },
    { name: "binding", evidence: { binding: "different-claim" } },
    { name: "schema", evidence: { schemaVersion: 2 as 1 } },
  ])("rejects mismatched $name evidence", ({ evidence: mismatch }) => {
    expect(
      verifyControlDirectorDiagnosticEvidence({
        claim: claim(),
        evidence: evidence(mismatch),
        now: NOW,
      }),
    ).toMatchObject({ status: "rejected", reason: "mismatched" });
  });

  it.each([
    { name: "too old", evidence: { observedAt: NOW - 300_001 } },
    { name: "future", evidence: { observedAt: NOW + 1 } },
    { name: "expired", evidence: { expiresAt: NOW - 1 } },
  ])("rejects $name evidence as stale", ({ evidence: stale }) => {
    expect(
      verifyControlDirectorDiagnosticEvidence({
        claim: claim(),
        evidence: evidence(stale),
        now: NOW,
      }),
    ).toMatchObject({ status: "rejected", reason: "stale" });
  });

  it("rejects evidence without a durable source id", () => {
    expect(
      verifyControlDirectorDiagnosticEvidence({
        claim: claim({ kind: "task_root", expectedBinding: "root-fingerprint" }),
        evidence: evidence({
          kind: "task_root",
          binding: "root-fingerprint",
          source: "spawn_receipt",
          sourceId: " ",
        }),
        now: NOW,
      }),
    ).toMatchObject({ status: "rejected", reason: "unavailable" });
  });
});
