import { describe, expect, it } from "vitest";
import {
  browserProofCheckId,
  validateBrowserProofReceiptBinding,
} from "./browser-proof-contract.js";

const CANDIDATE_SHA = "a".repeat(40);
const ACTIVE_SHA = "b".repeat(40);
const VERIFIER_SHA = "c".repeat(64);
const ARTIFACT_SHA = "d".repeat(64);

function binding(
  phase: "candidate" | "post_deployment",
  overrides: Partial<Parameters<typeof validateBrowserProofReceiptBinding>[0]> = {},
) {
  return {
    candidateSha: CANDIDATE_SHA,
    activeRuntimeSha: phase === "candidate" ? null : ACTIVE_SHA,
    proofProfile: "mac_studio_control_director" as const,
    proofProfileVersion: 2,
    proofPhase: phase,
    checkId: browserProofCheckId("mac_studio_control_director", phase)!,
    verifierSha256: VERIFIER_SHA,
    browserArtifactSha256: ARTIFACT_SHA,
    ...overrides,
  };
}

describe("phase-aware PCC browser-proof contract", () => {
  it("accepts an isolated candidate receipt without active-runtime claims", () => {
    expect(validateBrowserProofReceiptBinding(binding("candidate"))).toEqual([]);
  });

  it("accepts post-deployment proof only when it binds the candidate as active", () => {
    expect(
      validateBrowserProofReceiptBinding(
        binding("post_deployment", { activeRuntimeSha: CANDIDATE_SHA }),
      ),
    ).toEqual([]);
  });

  it("rejects candidate evidence that claims an active runtime", () => {
    expect(
      validateBrowserProofReceiptBinding(binding("candidate", { activeRuntimeSha: ACTIVE_SHA })),
    ).toContain("Candidate browser proof must not claim an active-runtime SHA.");
  });

  it("rejects post-deployment evidence bound to the wrong runtime", () => {
    expect(validateBrowserProofReceiptBinding(binding("post_deployment"))).toContain(
      "Post-deployment browser proof must bind the active runtime to the candidate SHA.",
    );
  });

  it("rejects profile, phase, check, verifier, and artifact drift", () => {
    const errors = validateReleaseProofBindingSafely({
      ...binding("candidate"),
      proofProfile: "default",
      proofProfileVersion: 2,
      proofPhase: "post_deployment",
      checkId: "authenticated_local_candidate_control_director_pcc_browser",
      verifierSha256: "not-a-hash",
      browserArtifactSha256: null,
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        "Browser proof profile version must be 1 for default.",
        "Post-deployment browser proof must bind the active runtime to the candidate SHA.",
        "Browser proof verifier hash is invalid.",
        "Browser proof artifact hash is required.",
        "The local Mac Studio browser-proof check is not authorized for the default profile.",
      ]),
    );
  });

  it("rejects an unregistered browser check carrying a local artifact", () => {
    expect(
      validateReleaseProofBindingSafely(
        binding("candidate", {
          checkId: "browser-proof-without-a-phase-contract",
        }),
      ),
    ).toContain(
      "Browser proof check browser-proof-without-a-phase-contract is not authorized for candidate.",
    );
  });

  it("does not let a local candidate receipt satisfy the default profile", () => {
    expect(
      validateReleaseProofBindingSafely(
        binding("candidate", {
          proofProfile: "default",
          proofProfileVersion: 1,
        }),
      ),
    ).toContain(
      "The local Mac Studio browser-proof check is not authorized for the default profile.",
    );
  });

  it("rejects unknown phases and profiles instead of falling back", () => {
    const phaseErrors = validateReleaseProofBindingSafely({
      ...binding("candidate"),
      proofPhase: "unknown" as never,
    });
    const profileErrors = validateReleaseProofBindingSafely({
      ...binding("candidate"),
      proofProfile: "unknown" as never,
    });
    expect(phaseErrors).toContain("Browser proof phase is unknown.");
    expect(profileErrors).toContain("Browser proof profile is unknown.");
  });
});

function validateReleaseProofBindingSafely(
  value: Parameters<typeof validateBrowserProofReceiptBinding>[0],
): string[] {
  return validateBrowserProofReceiptBinding(value);
}
