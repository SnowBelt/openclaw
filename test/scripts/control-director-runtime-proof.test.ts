import { describe, expect, it } from "vitest";
import { buildControlDirectorRuntimeProof } from "../../scripts/control-director-runtime-proof.js";

const sourceSha = "a".repeat(40);
const checkedAt = "2026-07-18T00:05:00.000Z";

function surface(extra: Record<string, unknown> = {}) {
  return {
    passed: true,
    sourceSha,
    checkedAt,
    evidenceRefs: ["artifact:test"],
    ...extra,
  };
}

function input() {
  return {
    sourceSha,
    lineageReceipt: {
      ...surface(),
      sigBackgroundEnabled: true,
      lineage: { status: "ready", sourceSha },
    },
    modelEval: {
      passed: true,
      exactRuntime: true,
      sourceSha,
      passRate: 100,
      criticalOmissions: 0,
      coveragePassed: true,
    },
    surfaces: {
      desktop: surface(),
      tablet: surface(),
      mobile: surface(),
      restartRecovery: surface(),
      soak: surface({
        durationMs: 300_000,
        startedAt: "2026-07-18T00:00:00.000Z",
        endedAt: checkedAt,
      }),
      rollback: surface(),
      liveDiagnostic: surface(),
    },
    generatedAt: checkedAt,
  };
}

describe("Control Director runtime proof assembler", () => {
  it("assembles exact-SHA evidence only after every runtime surface passes", () => {
    expect(buildControlDirectorRuntimeProof(input())).toMatchObject({
      schemaVersion: 2,
      sourceSha,
      generatedAt: checkedAt,
      sigBackgroundEnabled: true,
      lineage: { status: "ready", sourceSha },
      desktop: { passed: true },
      tablet: { passed: true },
      soak: { durationMs: 300_000 },
    });
  });

  it("rejects mismatched, incomplete, or too-short runtime proof", () => {
    const mismatched = input();
    mismatched.surfaces.mobile.sourceSha = "b".repeat(40);
    expect(() => buildControlDirectorRuntimeProof(mismatched)).toThrow("mobile sourceSha");

    const incompleteTablet = input();
    incompleteTablet.surfaces.tablet.passed = false;
    expect(() => buildControlDirectorRuntimeProof(incompleteTablet)).toThrow(
      "tablet evidence has not passed",
    );

    const short = input();
    short.surfaces.soak.durationMs = 299_999;
    expect(() => buildControlDirectorRuntimeProof(short)).toThrow("at least 300000ms");

    const partialEval = input();
    partialEval.modelEval.coveragePassed = false;
    expect(() => buildControlDirectorRuntimeProof(partialEval)).toThrow("full coverage");

    const sigDisabled = input();
    sigDisabled.lineageReceipt.sigBackgroundEnabled = false;
    expect(() => buildControlDirectorRuntimeProof(sigDisabled)).toThrow(
      "managed SIG background processing",
    );
  });
});
