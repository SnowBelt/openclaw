import type { ReleaseOperation, ReleaseProofProfile } from "./contracts.js";

export type ReleaseProofPhase = "candidate" | "post_deployment";

export const RELEASE_PROOF_PROFILE_VERSIONS = {
  default: 1,
  mac_studio_control_director: 2,
} as const satisfies Record<ReleaseProofProfile, number>;

export const RELEASE_BROWSER_PROOF_CHECKS = {
  candidate: "authenticated_local_candidate_control_director_pcc_browser",
  postDeployment: "authenticated_local_active_runtime_control_director_pcc_browser",
} as const;

export const PCC_BROWSER_CONTRACT_VERSION = "2" as const;
export const PCC_BROWSER_READY_ATTRIBUTE = "data-pcc-ready" as const;
export const PCC_BROWSER_SURFACE_ATTRIBUTE = "data-pcc-surface" as const;
export const PCC_BROWSER_LEDGER_REVISION_ATTRIBUTE = "data-pcc-ledger-revision" as const;

export function proofPhaseForOperation(operation: ReleaseOperation): ReleaseProofPhase {
  return operation === "finalize" ? "post_deployment" : "candidate";
}

const SHA_PATTERN = /^[a-f0-9]{40,64}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PROOF_PROFILES = new Set<ReleaseProofProfile>(["default", "mac_studio_control_director"]);
const PHASES = new Set<ReleaseProofPhase>(["candidate", "post_deployment"]);

export function isReleaseProofPhase(value: unknown): value is ReleaseProofPhase {
  return typeof value === "string" && PHASES.has(value as ReleaseProofPhase);
}

export function isReleaseProofProfile(value: unknown): value is ReleaseProofProfile {
  return typeof value === "string" && PROOF_PROFILES.has(value as ReleaseProofProfile);
}

export function proofProfileVersion(profile: ReleaseProofProfile): number {
  return RELEASE_PROOF_PROFILE_VERSIONS[profile];
}

export function browserProofCheckId(
  profile: ReleaseProofProfile,
  phase: ReleaseProofPhase,
): string | null {
  if (profile !== "mac_studio_control_director") {
    return null;
  }
  return phase === "candidate"
    ? RELEASE_BROWSER_PROOF_CHECKS.candidate
    : RELEASE_BROWSER_PROOF_CHECKS.postDeployment;
}

export function browserProofPhaseForCheckId(value: unknown): ReleaseProofPhase | null {
  if (value === RELEASE_BROWSER_PROOF_CHECKS.candidate) {
    return "candidate";
  }
  if (value === RELEASE_BROWSER_PROOF_CHECKS.postDeployment) {
    return "post_deployment";
  }
  return null;
}

export function isBrowserProofCheckId(value: unknown): boolean {
  return browserProofPhaseForCheckId(value) !== null;
}

export type BrowserProofReceiptBinding = {
  candidateSha: string;
  activeRuntimeSha: string | null;
  proofProfile: ReleaseProofProfile;
  proofProfileVersion: number;
  proofPhase: ReleaseProofPhase;
  checkId: string;
  verifierSha256: string;
  browserArtifactSha256: string | null;
};

export function validateBrowserProofReceiptBinding(receipt: BrowserProofReceiptBinding): string[] {
  const errors: string[] = [];
  if (!SHA_PATTERN.test(receipt.candidateSha)) {
    errors.push("Browser proof candidate SHA is invalid.");
  }
  if (receipt.activeRuntimeSha !== null && !SHA_PATTERN.test(receipt.activeRuntimeSha)) {
    errors.push("Browser proof active-runtime SHA is invalid.");
  }
  if (!isReleaseProofProfile(receipt.proofProfile)) {
    errors.push("Browser proof profile is unknown.");
    return errors;
  }
  if (!isReleaseProofPhase(receipt.proofPhase)) {
    errors.push("Browser proof phase is unknown.");
    return errors;
  }
  const expectedProfileVersion = proofProfileVersion(receipt.proofProfile);
  if (receipt.proofProfileVersion !== expectedProfileVersion) {
    errors.push(
      `Browser proof profile version must be ${expectedProfileVersion} for ${receipt.proofProfile}.`,
    );
  }
  const expectedBrowserCheckId = browserProofCheckId(receipt.proofProfile, receipt.proofPhase);
  if (
    expectedBrowserCheckId &&
    receipt.browserArtifactSha256 !== null &&
    receipt.checkId !== expectedBrowserCheckId
  ) {
    errors.push(
      `Browser proof check ${receipt.checkId} is not authorized for ${receipt.proofPhase}.`,
    );
  }
  if (isBrowserProofCheckId(receipt.checkId)) {
    if (receipt.proofProfile !== "mac_studio_control_director") {
      errors.push(
        "The local Mac Studio browser-proof check is not authorized for the default profile.",
      );
    } else {
      const expectedCheckId = browserProofCheckId(receipt.proofProfile, receipt.proofPhase);
      if (receipt.checkId !== expectedCheckId) {
        errors.push(
          `Browser proof check ${receipt.checkId} is not authorized for ${receipt.proofPhase}.`,
        );
      }
    }
  }
  if (receipt.proofPhase === "candidate" && receipt.activeRuntimeSha !== null) {
    errors.push("Candidate browser proof must not claim an active-runtime SHA.");
  }
  if (
    receipt.proofPhase === "post_deployment" &&
    (!receipt.activeRuntimeSha || receipt.activeRuntimeSha !== receipt.candidateSha)
  ) {
    errors.push("Post-deployment browser proof must bind the active runtime to the candidate SHA.");
  }
  if (!SHA256_PATTERN.test(receipt.verifierSha256)) {
    errors.push("Browser proof verifier hash is invalid.");
  }
  if (isBrowserProofCheckId(receipt.checkId) && !receipt.browserArtifactSha256) {
    errors.push("Browser proof artifact hash is required.");
  } else if (receipt.browserArtifactSha256 && !SHA256_PATTERN.test(receipt.browserArtifactSha256)) {
    errors.push("Browser proof artifact hash is invalid.");
  }
  return errors;
}
