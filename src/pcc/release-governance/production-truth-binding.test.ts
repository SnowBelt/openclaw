import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closePccLedgerStorageForTest, readPccLedger, withPccLedger } from "../ledger-store.js";
import { browserProofPhaseForCheckId } from "./browser-proof-contract.js";
import type {
  ReleaseApprovalGrant,
  ReleaseCandidateFacts,
  ReleaseLedgerPreflightReceipt,
  ReleaseCheck,
  ReleaseEvidenceBundleInput,
  ReleaseExactApproval,
  ReleaseGovernorEvaluation,
  ReleaseGovernorInput,
  ReleaseOperation,
  ReleaseReview,
} from "./contracts.js";
import {
  createReleaseEvidenceBundle,
  verifyReleaseEvidenceAuthorization,
  verifyReleaseEvidenceBundle,
  verifyReleaseRuntimeArtifacts,
} from "./evidence.js";
import { evaluateReleaseGovernor } from "./governor.js";
import { recordReleaseEvidenceInPccLedger, releaseLedgerPreflightHash } from "./ledger.js";
import { parseReleaseGovernorPolicy, readReleaseGovernorPolicy } from "./policy.js";

const NOW = "2026-07-15T12:00:00.000Z";
const SHA = "a".repeat(40);
const PARENT_SHA = "b".repeat(40);
const policy = readReleaseGovernorPolicy();
const roots: string[] = [];

function ledgerPreflightReceipt(candidateSha = SHA): ReleaseLedgerPreflightReceipt {
  const receiptInput = {
    schema: "openclaw.release-ledger-preflight.v1" as const,
    candidateSha,
    projectId: "project-command-center",
    milestoneId: "release-governor",
    ledgerRevision: 1,
    checkedAt: NOW,
  };
  return { ...receiptInput, receiptHash: releaseLedgerPreflightHash(receiptInput) };
}

function capabilityManifest(requiredPaths = ["src/example.ts", "src/example-proof.ts"]): unknown {
  return {
    schema: "openclaw.custom-runtime-capabilities.v1",
    version: 1,
    capabilities: [{ id: "runtime:required", kind: "runtime", requiredPaths }],
  };
}

function facts(
  changedFiles: string[],
  overrides: Partial<ReleaseCandidateFacts> = {},
): ReleaseCandidateFacts {
  return {
    project: "project-command-center",
    candidateSha: SHA,
    parentSha: PARENT_SHA,
    branch: "codex/release-governor-test",
    repository: "SnowBelt/openclaw",
    destination: null,
    changedFiles,
    externalDisclosure: false,
    ancestorShas: [PARENT_SHA],
    descendantDepth: 1,
    commitCount: 1,
    scopeCoordinationMaterial: false,
    proofProfile: "default",
    proofPhase: "candidate",
    ...overrides,
  };
}

function passedChecks(operation: keyof typeof policy.requiredChecks): ReleaseCheck[] {
  return policy.requiredChecks[operation].map((id) => ({
    id,
    status: "passed",
    summary: `${id} passed`,
    recordedAt: NOW,
  }));
}

function customChecks(operation: ReleaseOperation): ReleaseCheck[] {
  const profile = policy.proofProfiles.mac_studio_control_director;
  if (!profile) {
    throw new Error("Test policy is missing mac_studio_control_director.");
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-local-release-proof-"));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  return profile.requiredChecks[operation].map((id) => {
    if (["candidate_sha", "parent_sha"].includes(id)) {
      return {
        id,
        status: "passed",
        summary: `${id} passed`,
        recordedAt: NOW,
      };
    }
    const artifact = path.join(root, `${id}.json`);
    const command = `verify-${id} --candidate ${SHA}`;
    const proofPhase =
      browserProofPhaseForCheckId(id) ??
      (operation === "finalize" ? "post_deployment" : "candidate");
    const verifierSha256 = createHash("sha256").update(`verifier:${id}`).digest("hex");
    const browserArtifactSha256 = browserProofPhaseForCheckId(id)
      ? createHash("sha256").update(`browser-artifact:${id}`).digest("hex")
      : null;
    const contents = `${JSON.stringify({
      schema: "openclaw.release-local-proof.v2",
      candidateSha: SHA,
      proofProfile: "mac_studio_control_director",
      proofProfileVersion: 2,
      proofPhase,
      activeRuntimeSha: proofPhase === "post_deployment" ? SHA : null,
      checkId: id,
      command,
      verifierSha256,
      browserArtifactSha256,
      result: "passed",
    })}\n`;
    fs.writeFileSync(artifact, contents, { mode: 0o600 });
    return {
      id,
      status: "passed",
      summary: `${id} passed`,
      command,
      artifact,
      artifactSha256: createHash("sha256").update(contents).digest("hex"),
      proofPhase,
      proofProfileVersion: 2,
      verifierSha256,
      browserArtifactSha256,
      recordedAt: NOW,
    };
  });
}

function healthySample(): NonNullable<ReleaseGovernorInput["health"]> {
  return {
    gatewayConnected: true,
    routes: [
      { path: "/pcc", status: 200, latencyMs: 20 },
      { path: "/operations", status: 200, latencyMs: 20 },
    ],
    errorRate: 0,
    startupFailures: 0,
    missingCapabilities: [],
    desktopBrowserErrors: 0,
    mobileBrowserErrors: 0,
    activeRunsReconciled: true,
    serviceWorkerIntegrity: "passed",
  };
}

function customInput(operation: ReleaseOperation): ReleaseGovernorInput {
  return {
    ...input({
      changedFiles: ["docs/release.md"],
      operation,
      facts: {
        destination: "local-only",
        proofProfile: "mac_studio_control_director",
        proofPhase: operation === "finalize" ? "post_deployment" : "candidate",
      },
    }),
    checks: customChecks(operation),
    reviews: [
      ...reviews(),
      ...(["promotion", "restart", "rollback", "finalize"].includes(operation)
        ? [
            {
              role: "telemetry_evaluation_analyst" as const,
              reviewerId: "telemetry-local-test",
              decision: "approve" as const,
              confidence: 1,
              summary: "Local runtime health is proven.",
              evidenceIds: ["local-health"],
              reviewedAt: NOW,
            },
          ]
        : []),
    ],
    health: operation === "stage" ? undefined : healthySample(),
    rollbackAuthorized: operation === "rollback",
  };
}

function reviews(includeControlDirector = false): ReleaseReview[] {
  const roles: ReleaseReview["role"][] = ["release_governor", "judge"];
  if (includeControlDirector) {
    roles.push("control_director");
  }
  return roles.map((role) => ({
    role,
    reviewerId: `${role}-test`,
    decision: "approve",
    confidence: 1,
    summary: `${role} approved`,
    evidenceIds: ["local-proof"],
    reviewedAt: NOW,
  }));
}

function exactApproval(
  operation: ReleaseExactApproval["operations"][number],
): ReleaseExactApproval {
  return {
    id: "approval-exact",
    proofProfile: "default",
    approvingUser: "test-user",
    repository: "SnowBelt/openclaw",
    branch: "codex/release-governor-test",
    candidateSha: SHA,
    destination: "local-only",
    operations: [operation],
    grantedAt: NOW,
  };
}

function input(params: {
  changedFiles: string[];
  operation?: ReleaseGovernorInput["operation"];
  candidateManifest?: unknown;
  approvals?: ReleaseExactApproval[];
  approvalGrants?: ReleaseApprovalGrant[];
  reviews?: ReleaseReview[];
  facts?: Partial<ReleaseCandidateFacts>;
}): ReleaseGovernorInput {
  const operation = params.operation ?? "stage";
  const candidateFacts = facts(params.changedFiles, params.facts);
  const protectedChange = params.changedFiles.some((entry) => entry.includes("release-governance"));
  return {
    operation,
    facts: candidateFacts,
    activeCapabilityManifest: capabilityManifest(),
    candidateCapabilityManifest: params.candidateManifest ?? capabilityManifest(),
    requiredCapabilityIds: ["runtime:required"],
    checks: passedChecks(operation),
    reviews: params.reviews ?? reviews(protectedChange),
    exactApprovals: params.approvals ?? [],
    approvalGrants: params.approvalGrants ?? [],
    rollbackAuthorized: false,
    now: NOW,
  };
}

function finalizedBundleInput(evaluation: ReleaseGovernorEvaluation): ReleaseEvidenceBundleInput {
  return {
    evaluation,
    facts: facts(["docs/release.md"]),
    branch: "codex/release-governor-test",
    sourceRepository: "SnowBelt/openclaw",
    destination: null,
    proofProfile: "default",
    proofPhase: "candidate",
    diffSummary: "Documentation-only release governance test.",
    checks: passedChecks("stage"),
    reviews: reviews(),
    approvals: [],
    healthSample: null,
    rollbackAuthorized: false,
    workflowSanity: [
      { runId: "1", url: "https://example.invalid/1", headSha: SHA, conclusion: "success" },
    ],
    build: {
      buildInfoPath: "dist/build-info.json",
      buildStamp: SHA,
      artifactHashes: { dist: "hash" },
    },
    runtime: {
      openclawVersion: "2026.7.15",
      gatewayVersion: "2026.7.15",
      activeRuntimeSha: PARENT_SHA,
      candidateRuntimeSha: SHA,
    },
    deployment: {
      deployedAt: NOW,
      rollbackTarget: PARENT_SHA,
      stageResult: "passed",
      promotionResult: "passed",
      restartResult: "passed",
      postDeploymentHealth: { passed: true, deterministicRollbackTrigger: false, blockers: [] },
    },
    browserProof: {
      desktop: "desktop.png",
      mobile: "mobile.png",
      candidate: null,
      postDeployment: null,
      consoleErrors: 0,
    },
    ledger: {
      projectId: "project-command-center",
      milestoneId: "release-governor",
      ready: true,
      preflightReceipt: ledgerPreflightReceipt(),
    },
    createdAt: NOW,
  };
}

function customBundleInput(
  evaluation: ReleaseGovernorEvaluation,
  checks: ReleaseCheck[],
): ReleaseEvidenceBundleInput {
  const browserArtifact =
    checks.find(
      (check) => check.id === "authenticated_local_candidate_control_director_pcc_browser",
    )?.artifact ?? null;
  const postDeploymentBrowserArtifact =
    checks.find(
      (check) => check.id === "authenticated_local_active_runtime_control_director_pcc_browser",
    )?.artifact ?? null;
  const activeRuntimeSha = checks.some(
    (check) => check.id === "authenticated_local_active_runtime_control_director_pcc_browser",
  )
    ? SHA
    : PARENT_SHA;
  return {
    evaluation,
    facts: facts(["docs/release.md"], {
      destination: "local-only",
      proofProfile: "mac_studio_control_director",
      proofPhase: evaluation.decision.proofPhase,
    }),
    branch: "codex/release-governor-test",
    sourceRepository: "SnowBelt/openclaw",
    destination: "local-only",
    proofProfile: "mac_studio_control_director",
    proofPhase: evaluation.decision.proofPhase,
    diffSummary: "Local-only Mac Studio Control Director release.",
    checks,
    reviews: evaluation.decision.requiredReviewRoles.map((role) => ({
      role,
      reviewerId: `${role}-test`,
      decision: "approve",
      confidence: 1,
      summary: `${role} approved local evidence`,
      evidenceIds: ["local-proof"],
      reviewedAt: NOW,
    })),
    approvals: [],
    healthSample: evaluation.health ? healthySample() : null,
    rollbackAuthorized: evaluation.decision.operation === "rollback",
    workflowSanity: [],
    build: {
      buildInfoPath: "dist/build-info.json",
      buildStamp: SHA,
      artifactHashes: { "dist/index.js": "f".repeat(64) },
    },
    runtime: {
      openclawVersion: "2026.7.15",
      gatewayVersion: "2026.7.15",
      activeRuntimeSha,
      candidateRuntimeSha: SHA,
    },
    deployment: {
      deployedAt: evaluation.decision.operation === "stage" ? null : NOW,
      rollbackTarget: PARENT_SHA,
      stageResult: "passed",
      promotionResult: "passed",
      restartResult: "passed",
      postDeploymentHealth: {
        passed: true,
        deterministicRollbackTrigger: false,
        blockers: [],
      },
    },
    browserProof: {
      desktop: null,
      mobile: null,
      candidate: browserArtifact,
      postDeployment: postDeploymentBrowserArtifact,
      consoleErrors: 0,
    },
    ledger: {
      projectId: "project-command-center",
      milestoneId: "release-governor",
      ready: true,
      preflightReceipt: ledgerPreflightReceipt(),
    },
    createdAt: NOW,
  };
}

function writeReleaseArtifacts(root: string): Record<string, string> {
  const contents: Record<string, string> = {
    "dist/index.js": "// gateway\n",
    "dist/release-governor.js": "// governor\n",
    "dist/control-ui/dashboard-surfaces.json": '{"surfaces":[]}\n',
    "config/release-governor-policy.json": '{"version":1}\n',
    "config/custom-runtime-capabilities.json": '{"capabilities":[]}\n',
    "dist/build-info.json": `${JSON.stringify({ commit: SHA })}\n`,
  };
  const hashes: Record<string, string> = {};
  for (const [relative, content] of Object.entries(contents)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    hashes[relative] = createHash("sha256").update(content).digest("hex");
  }
  fs.writeFileSync(path.join(root, ".openclaw-production-sha"), `${SHA}\n`);
  return hashes;
}

afterEach(() => {
  closePccLedgerStorageForTest();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("PCC Release Governor", () => {
  it("preserves default proof requirements while defining one exact local Mac Studio profile", () => {
    expect(policy.version).toBe(3);
    expect(policy.requiredChecks.promotion).toEqual(
      expect.arrayContaining(["workflow_sanity", "browser_mobile"]),
    );
    expect(policy.proofProfiles.mac_studio_control_director).toMatchObject({
      version: 2,
      project: "project-command-center",
      destination: "local-only",
      externalDisclosure: false,
      prohibitedChecks: expect.arrayContaining([
        "workflow_sanity",
        "remote_ci",
        "browser_mobile",
        "remote_device",
        "blacksmith",
        "testbox",
        "crabbox",
      ]),
    });
    const malformed = structuredClone(policy) as unknown as Record<string, unknown>;
    malformed.proofProfiles = {
      unknown_profile: {
        project: "project-command-center",
        destination: "local-only",
        externalDisclosure: false,
        prohibitedChecks: [],
        requiredChecks: policy.requiredChecks,
      },
    };
    expect(parseReleaseGovernorPolicy(malformed)).toBeNull();
  });

  it("authorizes complete hash-bound local proof without remote or mobile evidence", () => {
    const releaseInput = customInput("stage");
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);
    expect(evaluation.classification).toMatchObject({
      proofProfile: "mac_studio_control_director",
      requiredChecks: expect.arrayContaining([
        "local_tests",
        "source_typecheck",
        "test_typecheck",
        "policy_checks",
        "capability_checks",
        "immutable_candidate",
      ]),
    });
    expect(evaluation.classification.requiredChecks).not.toEqual(
      expect.arrayContaining(["workflow_sanity", "browser_mobile"]),
    );
    expect(evaluation.decision).toMatchObject({
      decision: "authorize",
      proofProfile: "mac_studio_control_director",
    });
    const bundle = createReleaseEvidenceBundle(customBundleInput(evaluation, releaseInput.checks));
    expect(verifyReleaseEvidenceAuthorization({ bundle, policy, now: NOW })).toEqual([]);
  });

  it("fails closed when the local profile is used outside its exact project and destination", () => {
    for (const overrides of [
      { project: "other-project" },
      { destination: "https://github.com/SnowBelt/openclaw", externalDisclosure: true },
      { destination: null },
    ] satisfies Array<Partial<ReleaseCandidateFacts>>) {
      expect(() =>
        evaluateReleaseGovernor(
          input({
            changedFiles: ["docs/release.md"],
            facts: {
              proofProfile: "mac_studio_control_director",
              destination: "local-only",
              ...overrides,
            },
          }),
          policy,
        ),
      ).toThrow(/restricted to local-only project-command-center/u);
    }
  });

  it("generates profile-specific approval wording without remote CI or mobile proof", () => {
    const releaseInput = customInput("stage");
    releaseInput.facts.changedFiles = ["src/pcc/release-governance/policy.ts"];
    releaseInput.reviews = reviews(true);
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);
    expect(evaluation.decision.decision).toBe("escalate");
    expect(evaluation.decision.exactApprovalWording).toContain(
      "authenticated local Mac Studio production-Chrome Control Director and PCC proof",
    );
    expect(evaluation.decision.exactApprovalWording).not.toContain("CI workflow");
    expect(evaluation.decision.exactApprovalWording).not.toContain("desktop/mobile");
  });

  it("does not reuse an exact approval issued for a different proof profile", () => {
    const releaseInput = customInput("stage");
    releaseInput.facts.changedFiles = ["src/pcc/release-governance/policy.ts"];
    releaseInput.reviews = reviews(true);
    releaseInput.exactApprovals = [exactApproval("stage")];
    const mismatch = evaluateReleaseGovernor(releaseInput, policy);
    expect(mismatch.decision).toMatchObject({ decision: "escalate", approvalMode: "none" });

    releaseInput.exactApprovals = [
      { ...exactApproval("stage"), proofProfile: "mac_studio_control_director" },
    ];
    const matching = evaluateReleaseGovernor(releaseInput, policy);
    expect(matching.decision).toMatchObject({ decision: "authorize", approvalMode: "exact" });
  });

  it("rejects fabricated, missing, prohibited, and profile-drifted local proof", () => {
    const releaseInput = customInput("finalize");
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);
    expect(evaluation.decision.decision).toBe("authorize");
    const validInput = customBundleInput(evaluation, releaseInput.checks);

    const missingBrowser = createReleaseEvidenceBundle({
      ...validInput,
      browserProof: { ...validInput.browserProof, candidate: null },
    });
    expect(
      verifyReleaseEvidenceAuthorization({ bundle: missingBrowser, policy, now: NOW }),
    ).toContain("Authenticated local candidate browser proof must match its hash-bound artifact.");

    const candidateBrowserCheck = validInput.checks.find(
      (check) => check.id === "authenticated_local_candidate_control_director_pcc_browser",
    );
    const activeBrowserCheck = validInput.checks.find(
      (check) => check.id === "authenticated_local_active_runtime_control_director_pcc_browser",
    );
    if (!candidateBrowserCheck?.artifact || !activeBrowserCheck?.artifact) {
      throw new Error("Test browser proof checks are missing artifacts.");
    }
    const reusedBrowserArtifact = createReleaseEvidenceBundle({
      ...validInput,
      checks: validInput.checks.map((check) =>
        check.id === activeBrowserCheck.id
          ? {
              ...check,
              artifact: candidateBrowserCheck.artifact,
              artifactSha256: candidateBrowserCheck.artifactSha256,
            }
          : check,
      ),
      browserProof: {
        ...validInput.browserProof,
        postDeployment: candidateBrowserCheck.artifact,
      },
    });
    expect(
      verifyReleaseEvidenceAuthorization({ bundle: reusedBrowserArtifact, policy, now: NOW }),
    ).toContain(
      "Candidate browser evidence must use a distinct artifact from post-deployment browser evidence.",
    );

    const phaseDrift = createReleaseEvidenceBundle({
      ...validInput,
      proofPhase: "candidate",
    });
    expect(verifyReleaseEvidenceAuthorization({ bundle: phaseDrift, policy, now: NOW })).toContain(
      "Evidence proof phase does not match candidate facts, classification, and decision.",
    );

    const workflowEvidence = createReleaseEvidenceBundle({
      ...validInput,
      workflowSanity: [
        { runId: "remote", url: "https://example.invalid", headSha: SHA, conclusion: "success" },
      ],
    });
    expect(
      verifyReleaseEvidenceAuthorization({ bundle: workflowEvidence, policy, now: NOW }),
    ).toContain(
      "The mac_studio_control_director proof profile must not contain remote workflow evidence.",
    );

    const tamperedChecks = validInput.checks.map((check) =>
      check.id === "local_tests" ? { ...check, artifactSha256: "0".repeat(64) } : check,
    );
    const fabricated = createReleaseEvidenceBundle({ ...validInput, checks: tamperedChecks });
    expect(verifyReleaseEvidenceAuthorization({ bundle: fabricated, policy, now: NOW })).toContain(
      "Local proof artifact hash mismatch: local_tests.",
    );

    const localTestCheck = validInput.checks.find((check) => check.id === "local_tests");
    if (!localTestCheck?.artifact || !localTestCheck.command) {
      throw new Error("Test local proof is missing.");
    }
    const falseReceiptPath = path.join(path.dirname(localTestCheck.artifact), "false-claim.json");
    const falseReceipt = `${JSON.stringify({
      schema: "openclaw.release-local-proof.v2",
      candidateSha: PARENT_SHA,
      proofProfile: "mac_studio_control_director",
      proofProfileVersion: 2,
      proofPhase: "candidate",
      activeRuntimeSha: null,
      checkId: "local_tests",
      command: localTestCheck.command,
      verifierSha256: localTestCheck.verifierSha256,
      browserArtifactSha256: null,
      result: "passed",
    })}\n`;
    fs.writeFileSync(falseReceiptPath, falseReceipt, { mode: 0o600 });
    const falseClaimChecks = validInput.checks.map((check) =>
      check.id === "local_tests"
        ? {
            ...check,
            artifact: falseReceiptPath,
            artifactSha256: createHash("sha256").update(falseReceipt).digest("hex"),
          }
        : check,
    );
    const falseClaim = createReleaseEvidenceBundle({
      ...validInput,
      checks: falseClaimChecks,
    });
    expect(verifyReleaseEvidenceAuthorization({ bundle: falseClaim, policy, now: NOW })).toContain(
      "Local proof receipt is not bound to the candidate, phase, profile, hashes, check, command, and passed result: local_tests.",
    );

    const drifted = createReleaseEvidenceBundle({ ...validInput, proofProfile: "default" });
    expect(verifyReleaseEvidenceAuthorization({ bundle: drifted, policy, now: NOW })).toContain(
      "Evidence proof profile does not match candidate facts, classification, and decision.",
    );
  });

  it("fails closed on malformed candidate identity or unsafe changed-file paths", () => {
    expect(() =>
      evaluateReleaseGovernor(
        input({ changedFiles: ["../outside"], facts: { candidateSha: "not-a-sha" } }),
        policy,
      ),
    ).toThrow(/candidate SHA|repository-relative/u);
  });

  it("automatically authorizes a fully proven local P3 change", () => {
    const evaluation = evaluateReleaseGovernor(
      input({ changedFiles: ["docs/release.md"] }),
      policy,
    );

    expect(evaluation.classification).toMatchObject({
      riskLevel: "P3",
      approvalRequired: false,
      ambiguous: false,
    });
    expect(evaluation.decision).toMatchObject({
      decision: "authorize",
      approvalMode: "automatic",
      blockers: [],
    });
  });

  it("requires exact user approval for Release Governor changes and rejects bounded expansion", () => {
    const changedFiles = ["src/pcc/release-governance/policy.ts"];
    const withoutApproval = evaluateReleaseGovernor(input({ changedFiles }), policy);

    expect(withoutApproval.classification.protectedPaths).not.toHaveLength(0);
    expect(withoutApproval.decision.decision).toBe("escalate");
    expect(withoutApproval.decision.exactApprovalWording).toContain(SHA);

    const withApproval = evaluateReleaseGovernor(
      input({ changedFiles, approvals: [exactApproval("stage")] }),
      policy,
    );
    expect(withApproval.decision).toMatchObject({ decision: "authorize", approvalMode: "exact" });
  });

  it("keeps bounded approvals project, destination, risk, path, depth, commit, and expiry scoped", () => {
    const grant: ReleaseApprovalGrant = {
      id: "grant-docs",
      proofProfile: "default",
      approvingUser: "test-user",
      project: "project-command-center",
      repository: "SnowBelt/openclaw",
      branch: "codex/release-governor-test",
      approvedBaseSha: PARENT_SHA,
      destination: "local-only",
      allowedChangeClasses: ["documentation"],
      forbiddenPaths: ["docs/security/**"],
      maximumRisk: "P3",
      expiresAt: "2026-07-16T12:00:00.000Z",
      maximumDescendantDepth: 2,
      maximumCommitCount: 2,
      receiptId: "receipt-docs",
      grantedAt: NOW,
    };
    const covered = evaluateReleaseGovernor(
      input({ changedFiles: ["docs/release.md"], approvalGrants: [grant] }),
      policy,
    );
    expect(covered.decision).toMatchObject({
      decision: "authorize",
      approvalMode: "bounded_grant",
    });

    const outOfScopeCases: Array<Partial<ReleaseCandidateFacts>> = [
      { project: "other-project" },
      { destination: "https://github.com/SnowBelt/openclaw" },
      { descendantDepth: 3 },
      { commitCount: 3 },
    ];
    for (const factOverrides of outOfScopeCases) {
      const result = evaluateReleaseGovernor(
        input({
          changedFiles: ["docs/release.md"],
          approvalGrants: [grant],
          facts: factOverrides,
        }),
        policy,
      );
      expect(result.decision.approvalMode).not.toBe("bounded_grant");
    }

    const forbidden = evaluateReleaseGovernor(
      input({ changedFiles: ["docs/security/policy.md"], approvalGrants: [grant] }),
      policy,
    );
    expect(forbidden.decision.approvalMode).not.toBe("bounded_grant");

    const expired = evaluateReleaseGovernor(
      {
        ...input({ changedFiles: ["docs/release.md"], approvalGrants: [grant] }),
        now: "2026-07-17T12:00:00.000Z",
      },
      policy,
    );
    expect(expired.decision.approvalMode).not.toBe("bounded_grant");
  });

  it("requires exact approval wording for unknown paths and new external disclosure", () => {
    const unknown = evaluateReleaseGovernor(
      input({ changedFiles: ["unknown/new.file"], reviews: reviews(true) }),
      policy,
    );
    expect(unknown.classification).toMatchObject({ ambiguous: true, approvalRequired: true });
    expect(unknown.decision).toMatchObject({ decision: "escalate", approvalMode: "none" });

    const external = evaluateReleaseGovernor(
      input({
        changedFiles: ["docs/release.md"],
        facts: {
          destination: "https://github.com/SnowBelt/openclaw",
          externalDisclosure: true,
        },
      }),
      policy,
    );
    expect(external.decision.decision).toBe("escalate");
    expect(external.decision.exactApprovalWording).toContain("externally hosted destination");
    expect(external.decision.exactApprovalWording).toContain(SHA);
  });

  it("blocks required capability weakening even with an exact approval", () => {
    const evaluation = evaluateReleaseGovernor(
      input({
        changedFiles: ["scripts/observer.ts"],
        candidateManifest: capabilityManifest(["src/example.ts"]),
        approvals: [exactApproval("stage")],
      }),
      policy,
    );

    expect(evaluation.capabilityDiff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "runtime:required", change: "weakened" }),
      ]),
    );
    expect(evaluation.decision.decision).toBe("deny");
    expect(evaluation.decision.blockers.join(" ")).toContain(
      "Required capability runtime:required is weakened",
    );
  });

  it("blocks missing, failed, or low-confidence required review evidence", () => {
    const releaseInput = input({ changedFiles: ["docs/release.md"] });
    releaseInput.reviews = [
      { ...reviews()[0], confidence: 0.2 },
      { ...reviews()[1], decision: "deny" },
    ];
    releaseInput.checks = releaseInput.checks.filter((check) => check.id !== "rollback_ready");
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);

    expect(evaluation.decision.decision).toBe("deny");
    expect(evaluation.decision.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("rollback_ready is missing"),
        expect.stringContaining("release_governor review confidence"),
        expect.stringContaining("judge review decided deny"),
      ]),
    );
  });

  it("requires independent structured reviewers and Program Manager scope review", () => {
    const sharedReviewer = "same-reviewer";
    const sharedReviews = reviews();
    for (const review of sharedReviews) {
      review.reviewerId = sharedReviewer;
    }
    const releaseInput = input({
      changedFiles: ["docs/release.md"],
      facts: { scopeCoordinationMaterial: true },
      reviews: [
        ...sharedReviews,
        {
          role: "program_manager",
          reviewerId: sharedReviewer,
          decision: "approve",
          confidence: 1,
          summary: "Scope is coordinated.",
          evidenceIds: ["scope"],
          reviewedAt: NOW,
        },
      ],
    });
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);
    expect(evaluation.decision.requiredReviewRoles).toContain("program_manager");
    expect(evaluation.decision.decision).toBe("deny");
    expect(evaluation.decision.blockers.join(" ")).toContain("reviews are not independent");
  });

  it("blocks rollback unless deterministic health and rollback authorization are both present", () => {
    const releaseInput = input({
      changedFiles: ["docs/release.md"],
      operation: "rollback",
      approvals: [exactApproval("rollback")],
    });
    releaseInput.health = {
      gatewayConnected: false,
      routes: [{ path: "/pcc", status: 503, latencyMs: 100 }],
      errorRate: 0.1,
      startupFailures: 1,
      missingCapabilities: [],
      desktopBrowserErrors: 0,
      mobileBrowserErrors: 0,
      activeRunsReconciled: true,
      serviceWorkerIntegrity: "passed",
    };
    releaseInput.reviews.push({
      role: "telemetry_evaluation_analyst",
      reviewerId: "telemetry-test",
      decision: "approve",
      confidence: 1,
      summary: "Rollback trigger is deterministic.",
      evidenceIds: ["health"],
      reviewedAt: NOW,
    });

    const denied = evaluateReleaseGovernor(releaseInput, policy);
    expect(denied.decision.decision).toBe("deny");
    expect(denied.decision.blockers).toContain(
      "Rollback is not authorized by the current policy scope.",
    );

    releaseInput.rollbackAuthorized = true;
    const authorized = evaluateReleaseGovernor(releaseInput, policy);
    expect(authorized.decision.decision).toBe("authorize");
    expect(authorized.decision.blockers).not.toContain(
      "Rollback is not authorized by the current policy scope.",
    );
  });

  it("detects evidence tampering and records production receipts idempotently", () => {
    const evaluation = evaluateReleaseGovernor(
      input({ changedFiles: ["docs/release.md"] }),
      policy,
    );
    const bundle = createReleaseEvidenceBundle(finalizedBundleInput(evaluation));
    expect(verifyReleaseEvidenceBundle(bundle)).toEqual([]);
    expect(verifyReleaseEvidenceAuthorization({ bundle, policy, now: NOW })).toEqual([]);
    expect(verifyReleaseEvidenceBundle({ ...bundle, diffSummary: "tampered" })).toEqual([
      expect.stringContaining("hash mismatch"),
    ]);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-release-governor-"));
    roots.push(root);
    const env = { OPENCLAW_STATE_DIR: root };
    withPccLedger(
      (ledger) => {
        ledger.projects.push({
          id: "project-command-center",
          title: "Project Command Center",
          goal: "PCC",
          status: "active",
          priority: 5,
          owner: "OpenClaw",
          createdAt: NOW,
          updatedAt: NOW,
        });
        ledger.milestones.push({
          id: "release-governor",
          projectId: "project-command-center",
          title: "Release Governor",
          status: "complete",
          order: 0,
          createdAt: NOW,
          updatedAt: NOW,
        });
      },
      { write: true },
      env,
    );
    expect(recordReleaseEvidenceInPccLedger(bundle, env)).toMatchObject({
      evidenceAdded: true,
      receiptAdded: true,
    });
    expect(recordReleaseEvidenceInPccLedger(bundle, env)).toMatchObject({
      evidenceAdded: false,
      receiptAdded: false,
    });
    expect(readPccLedger(env).evidence).toHaveLength(1);
    expect(readPccLedger(env).receipts).toHaveLength(1);
  });

  it("atomically binds verified local post-deployment browser proof to PCC production truth", () => {
    const releaseInput = customInput("finalize");
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);
    const bundle = createReleaseEvidenceBundle(customBundleInput(evaluation, releaseInput.checks));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-release-governor-truth-"));
    roots.push(root);
    const env = { OPENCLAW_STATE_DIR: root };
    withPccLedger(
      (ledger) => {
        ledger.projects.push({
          id: "project-command-center",
          title: "Project Command Center",
          goal: "PCC",
          status: "active",
          priority: 5,
          owner: "OpenClaw",
          createdAt: NOW,
          updatedAt: NOW,
        });
        ledger.milestones.push({
          id: "release-governor",
          projectId: "project-command-center",
          title: "Release Governor",
          status: "complete",
          order: 0,
          createdAt: NOW,
          updatedAt: NOW,
        });
      },
      { write: true },
      env,
    );

    const first = recordReleaseEvidenceInPccLedger(bundle, env);
    expect(first).toMatchObject({
      evidenceAdded: true,
      receiptAdded: true,
      browserEvidenceId: `${first.evidenceId}-post-deployment-browser`,
      browserEvidenceAdded: true,
      productionTruthBound: true,
    });
    const firstLedger = readPccLedger(env);
    const browserEvidence = firstLedger.evidence.find(
      (entry) => entry.id === first.browserEvidenceId,
    );
    const project = firstLedger.projects.find((entry) => entry.id === "project-command-center");
    const truth = project?.metadata?.pccProductionTruth as Record<string, unknown>;
    expect(browserEvidence).toMatchObject({
      kind: "browser_proof",
      status: "passed",
      sha: SHA,
      path: bundle.browserProof.postDeployment,
      metadata: {
        proofProfile: "mac_studio_control_director",
        proofProfileVersion: 2,
        proofPhase: "post_deployment",
        browserArtifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        verifierSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        pccProductionSourceProof: true,
      },
    });
    expect(truth).toMatchObject({
      proofProfile: "mac_studio_control_director",
      proofProfileVersion: 2,
      proofPhase: "post_deployment",
      latestVerifiedSha: SHA,
      sourceProofSha: SHA,
      sourceProofPassed: true,
      runtimeSha: SHA,
      runtimeProofSha: SHA,
      runtimeProofPassed: true,
      browserProofSha: SHA,
      browserProofScreenshotPath: bundle.browserProof.postDeployment,
      proofArtifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      proofVerifierSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      releaseEvidenceReceiptHash: bundle.receiptHash,
      releaseEvidenceReceiptId: first.receiptId,
      productionCurrent: true,
      noProofGaps: true,
      finalized: true,
      proofEvidenceIds: [first.evidenceId, first.browserEvidenceId],
    });
    expect(firstLedger.receipts[0]?.proofEvidenceIds).toEqual([
      first.evidenceId,
      first.browserEvidenceId,
    ]);
    const firstRevision = project?.revision;

    const second = recordReleaseEvidenceInPccLedger(bundle, env);
    expect(second).toMatchObject({
      evidenceAdded: false,
      receiptAdded: false,
      browserEvidenceId: first.browserEvidenceId,
      browserEvidenceAdded: false,
      productionTruthBound: false,
    });
    expect(readPccLedger(env).evidence).toHaveLength(2);
    expect(readPccLedger(env).receipts).toHaveLength(1);
    expect(
      readPccLedger(env).projects.find((entry) => entry.id === "project-command-center")?.revision,
    ).toBe(firstRevision);
  });

  it("fails closed before any ledger mutation when local post-deployment proof is incomplete", () => {
    const releaseInput = customInput("finalize");
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);
    const validInput = customBundleInput(evaluation, releaseInput.checks);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-release-governor-truth-invalid-"));
    roots.push(root);
    const env = { OPENCLAW_STATE_DIR: root };
    withPccLedger(
      (ledger) => {
        ledger.projects.push({
          id: "project-command-center",
          title: "Project Command Center",
          goal: "PCC",
          status: "active",
          createdAt: NOW,
          updatedAt: NOW,
        });
        ledger.milestones.push({
          id: "release-governor",
          projectId: "project-command-center",
          title: "Release Governor",
          status: "complete",
          createdAt: NOW,
          updatedAt: NOW,
        });
      },
      { write: true },
      env,
    );

    const missingBrowserProof = createReleaseEvidenceBundle({
      ...validInput,
      browserProof: { ...validInput.browserProof, postDeployment: null },
    });
    expect(() => recordReleaseEvidenceInPccLedger(missingBrowserProof, env)).toThrow(
      "hash-bound local post-deployment browser proof",
    );
    const unchanged = readPccLedger(env);
    expect(unchanged.evidence).toEqual([]);
    expect(unchanged.receipts).toEqual([]);
    expect(unchanged.projects[0]?.metadata).toBeUndefined();

    const mismatchedRuntime = createReleaseEvidenceBundle({
      ...validInput,
      runtime: { ...validInput.runtime, activeRuntimeSha: PARENT_SHA },
    });
    expect(() => recordReleaseEvidenceInPccLedger(mismatchedRuntime, env)).toThrow(
      "exact active and candidate SHA equality",
    );
    expect(readPccLedger(env).evidence).toEqual([]);
    expect(readPccLedger(env).receipts).toEqual([]);
  });

  it("rejects a tampered evidence bundle before mutating the ledger", () => {
    const releaseInput = customInput("finalize");
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);
    const bundle = createReleaseEvidenceBundle(customBundleInput(evaluation, releaseInput.checks));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-release-governor-truth-hash-"));
    roots.push(root);
    const env = { OPENCLAW_STATE_DIR: root };
    withPccLedger(
      (ledger) => {
        ledger.projects.push({
          id: "project-command-center",
          title: "Project Command Center",
          status: "active",
          createdAt: NOW,
          updatedAt: NOW,
        });
        ledger.milestones.push({
          id: "release-governor",
          projectId: "project-command-center",
          title: "Release Governor",
          status: "complete",
          createdAt: NOW,
          updatedAt: NOW,
        });
      },
      { write: true },
      env,
    );

    expect(() =>
      recordReleaseEvidenceInPccLedger({ ...bundle, diffSummary: "tampered" }, env),
    ).toThrow("Release evidence bundle is not hash-bound");
    expect(readPccLedger(env).evidence).toEqual([]);
    expect(readPccLedger(env).receipts).toEqual([]);
    expect(readPccLedger(env).projects[0]?.metadata).toBeUndefined();
  });

  it("does not bind candidate-phase local evidence to production truth", () => {
    const releaseInput = customInput("stage");
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);
    const validInput = customBundleInput(evaluation, releaseInput.checks);
    const bundle = createReleaseEvidenceBundle({
      ...validInput,
      deployment: {
        ...validInput.deployment,
        deployedAt: NOW,
      },
    });
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-release-governor-truth-candidate-"),
    );
    roots.push(root);
    const env = { OPENCLAW_STATE_DIR: root };
    withPccLedger(
      (ledger) => {
        ledger.projects.push({
          id: "project-command-center",
          title: "Project Command Center",
          status: "active",
          createdAt: NOW,
          updatedAt: NOW,
        });
        ledger.milestones.push({
          id: "release-governor",
          projectId: "project-command-center",
          title: "Release Governor",
          status: "complete",
          createdAt: NOW,
          updatedAt: NOW,
        });
      },
      { write: true },
      env,
    );

    const result = recordReleaseEvidenceInPccLedger(bundle, env);
    expect(result.productionTruthBound).toBeUndefined();
    expect(readPccLedger(env).evidence).toHaveLength(1);
    expect(readPccLedger(env).projects[0]?.metadata).toBeUndefined();
  });

  it("upgrades a legacy local release receipt without replacing its historical release evidence", () => {
    const releaseInput = customInput("finalize");
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);
    const bundle = createReleaseEvidenceBundle(customBundleInput(evaluation, releaseInput.checks));
    const deployedAt = bundle.deployment.deployedAt;
    if (!deployedAt) {
      throw new Error("Test fixture must include a deployment timestamp.");
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-release-governor-truth-legacy-"));
    roots.push(root);
    const env = { OPENCLAW_STATE_DIR: root };
    const evidenceId = `release-governor-${bundle.receiptHash}`;
    const receiptId = `release-governor-receipt-${bundle.receiptHash}`;
    withPccLedger(
      (ledger) => {
        ledger.projects.push({
          id: "project-command-center",
          title: "Project Command Center",
          status: "active",
          createdAt: NOW,
          updatedAt: NOW,
        });
        ledger.milestones.push({
          id: "release-governor",
          projectId: "project-command-center",
          title: "Release Governor",
          status: "complete",
          createdAt: NOW,
          updatedAt: NOW,
        });
        ledger.evidence.push({
          id: evidenceId,
          projectId: "project-command-center",
          milestoneId: "release-governor",
          kind: "receipt",
          status: "passed",
          summary: "Legacy release receipt",
          source: "PCC Release Governor",
          sha: SHA,
          createdAt: bundle.createdAt,
          metadata: { receiptHash: bundle.receiptHash },
        });
        ledger.receipts.push({
          id: receiptId,
          projectId: "project-command-center",
          milestoneId: "release-governor",
          summary: "Legacy release receipt",
          proofEvidenceIds: [evidenceId],
          proofLevel: "production",
          completedBy: "PCC Release Governor",
          completedAt: deployedAt,
        });
      },
      { write: true },
      env,
    );

    const result = recordReleaseEvidenceInPccLedger(bundle, env);
    expect(result).toMatchObject({
      evidenceAdded: false,
      receiptAdded: false,
      browserEvidenceAdded: true,
      productionTruthBound: true,
    });
    const ledger = readPccLedger(env);
    expect(ledger.evidence.map((entry) => entry.id)).toEqual([
      evidenceId,
      result.browserEvidenceId,
    ]);
    expect(ledger.receipts[0]?.proofEvidenceIds).toEqual([evidenceId, result.browserEvidenceId]);
    expect(ledger.projects[0]?.metadata?.pccProductionTruth).toMatchObject({
      releaseEvidenceReceiptId: receiptId,
      finalized: true,
    });
  });

  it("fails closed when an existing PCC browser proof does not match the verified bundle", () => {
    const releaseInput = customInput("finalize");
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);
    const bundle = createReleaseEvidenceBundle(customBundleInput(evaluation, releaseInput.checks));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-release-governor-truth-tamper-"));
    roots.push(root);
    const env = { OPENCLAW_STATE_DIR: root };
    withPccLedger(
      (ledger) => {
        ledger.projects.push({
          id: "project-command-center",
          title: "Project Command Center",
          status: "active",
          createdAt: NOW,
          updatedAt: NOW,
        });
        ledger.milestones.push({
          id: "release-governor",
          projectId: "project-command-center",
          title: "Release Governor",
          status: "complete",
          createdAt: NOW,
          updatedAt: NOW,
        });
      },
      { write: true },
      env,
    );
    const first = recordReleaseEvidenceInPccLedger(bundle, env);
    withPccLedger(
      (ledger) => {
        const browserEvidence = ledger.evidence.find(
          (entry) => entry.id === first.browserEvidenceId,
        );
        if (browserEvidence) {
          browserEvidence.path = `${browserEvidence.path}.tampered`;
        }
      },
      { write: true },
      env,
    );

    expect(() => recordReleaseEvidenceInPccLedger(bundle, env)).toThrow(
      "mismatched PCC post-deployment browser proof",
    );
    const unchanged = readPccLedger(env);
    expect(unchanged.evidence.find((entry) => entry.id === first.browserEvidenceId)?.path).toBe(
      `${bundle.browserProof.postDeployment}.tampered`,
    );
    expect(unchanged.receipts[0]?.proofEvidenceIds).toEqual([
      first.evidenceId,
      first.browserEvidenceId,
    ]);
  });

  it("refuses to create dangling Release Governor ledger records", () => {
    const evaluation = evaluateReleaseGovernor(
      input({ changedFiles: ["docs/release.md"] }),
      policy,
    );
    const bundle = createReleaseEvidenceBundle(finalizedBundleInput(evaluation));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-release-governor-"));
    roots.push(root);
    const env = { OPENCLAW_STATE_DIR: root };

    expect(() => recordReleaseEvidenceInPccLedger(bundle, env)).toThrow(
      "Release evidence project does not exist",
    );
    expect(readPccLedger(env).evidence).toEqual([]);
    expect(readPccLedger(env).receipts).toEqual([]);
  });

  it("binds runtime artifacts and build information to the exact candidate SHA", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-release-artifacts-"));
    roots.push(root);
    const evaluation = evaluateReleaseGovernor(
      input({ changedFiles: ["docs/release.md"] }),
      policy,
    );
    const hashes = writeReleaseArtifacts(root);
    const evidenceInput = finalizedBundleInput(evaluation);
    evidenceInput.build.artifactHashes = hashes;
    const bundle = createReleaseEvidenceBundle(evidenceInput);
    expect(verifyReleaseRuntimeArtifacts({ bundle, releaseRoot: root })).toEqual([]);

    fs.writeFileSync(path.join(root, "dist", "index.js"), "// tampered\n");
    expect(verifyReleaseRuntimeArtifacts({ bundle, releaseRoot: root })).toContain(
      "Release artifact hash mismatch: dist/index.js.",
    );
  });
});
