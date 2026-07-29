import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closePccLedgerStorageForTest, readPccLedger, withPccLedger } from "../ledger-store.js";
import { resolveReleaseProofProfile } from "./classifier.js";
import type {
  ReleaseApprovalGrant,
  ReleaseCandidateFacts,
  ReleaseCheck,
  ReleaseEvidenceBundleInput,
  ReleaseExactApproval,
  ReleaseGovernorEvaluation,
  ReleaseGovernorInput,
  ReleaseProofProfile,
  ReleaseReview,
} from "./contracts.js";
import {
  createReleaseEvidenceBundle,
  verifyReleaseEvidenceAuthorization,
  verifyReleaseEvidenceBundle,
  verifyReleaseRuntimeArtifacts,
} from "./evidence.js";
import { evaluateReleaseGovernor } from "./governor.js";
import { recordReleaseEvidenceInPccLedger } from "./ledger.js";
import { readReleaseGovernorPolicy, requiredReleaseChecksForProfile } from "./policy.js";

const NOW = "2026-07-15T12:00:00.000Z";
const SHA = "a".repeat(40);
const PARENT_SHA = "b".repeat(40);
const policy = readReleaseGovernorPolicy();
const roots: string[] = [];

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
    ...overrides,
  };
}

function passedChecks(
  operation: keyof typeof policy.requiredChecks,
  profile: ReleaseProofProfile = "standard",
): ReleaseCheck[] {
  return requiredReleaseChecksForProfile({ policy, operation, profile }).map((id) => ({
    id,
    status: "passed",
    summary: `${id} passed`,
    recordedAt: NOW,
  }));
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

function telemetryReview(): ReleaseReview {
  return {
    role: "telemetry_evaluation_analyst",
    reviewerId: "telemetry-test",
    decision: "approve",
    confidence: 1,
    summary: "Runtime health passed.",
    evidenceIds: ["health"],
    reviewedAt: NOW,
  };
}

function healthySample(): NonNullable<ReleaseGovernorInput["health"]> {
  return {
    gatewayConnected: true,
    routes: [{ path: "/pcc", status: 200, latencyMs: 100 }],
    errorRate: 0,
    startupFailures: 0,
    missingCapabilities: [],
    desktopBrowserErrors: 0,
    mobileBrowserErrors: 0,
    activeRunsReconciled: true,
    serviceWorkerIntegrity: "passed",
  };
}

function exactApproval(
  operation: ReleaseExactApproval["operations"][number],
): ReleaseExactApproval {
  return {
    id: "approval-exact",
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
    checks: passedChecks(operation, resolveReleaseProofProfile(candidateFacts)),
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
    browserProof: { desktop: "desktop.png", mobile: "mobile.png", consoleErrors: 0 },
    ledger: { projectId: "project-command-center", milestoneId: "release-governor", ready: true },
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

  it("uses authenticated Mac Studio Control Director proof for local-only PCC releases", () => {
    const releaseInput = input({
      changedFiles: ["ui/src/ui/views/pcc.ts"],
      operation: "promotion",
      facts: { proofProfile: "mac_studio_control_director" },
      reviews: [...reviews(), telemetryReview()],
    });
    releaseInput.health = healthySample();
    releaseInput.health.mobileBrowserErrors = 7;
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);

    expect(evaluation.classification).toMatchObject({
      proofProfile: "mac_studio_control_director",
      requiredChecks: expect.arrayContaining(["control_director_mac_studio"]),
    });
    expect(evaluation.classification.requiredChecks).not.toContain("workflow_sanity");
    expect(evaluation.classification.requiredChecks).not.toContain("browser_desktop");
    expect(evaluation.classification.requiredChecks).not.toContain("browser_mobile");
    expect(evaluation.decision).toMatchObject({ decision: "authorize", blockers: [] });

    const evidenceInput = finalizedBundleInput(evaluation);
    evidenceInput.facts = releaseInput.facts;
    evidenceInput.checks = releaseInput.checks;
    evidenceInput.reviews = releaseInput.reviews;
    evidenceInput.healthSample = releaseInput.health;
    evidenceInput.workflowSanity = [];
    evidenceInput.browserProof = { desktop: null, mobile: null, consoleErrors: 0 };
    evidenceInput.controlDirectorProof = {
      host: "mac_studio",
      artifact: "control-director-pcc.png",
      authenticated: true,
      consoleErrors: 0,
    };
    const bundle = createReleaseEvidenceBundle(evidenceInput);
    expect(verifyReleaseEvidenceAuthorization({ bundle, policy, now: NOW })).toEqual([]);

    const missingProof = createReleaseEvidenceBundle({
      ...evidenceInput,
      controlDirectorProof: undefined,
    });
    expect(
      verifyReleaseEvidenceAuthorization({ bundle: missingProof, policy, now: NOW }),
    ).toContain(
      "Authenticated, error-free Control Director proof from the Mac Studio is required by the selected proof profile.",
    );
  });

  it("selects Mac Studio Control Director proof automatically for local-only PCC releases", () => {
    const releaseInput = input({
      changedFiles: ["config/release-governor-policy.json"],
      operation: "promotion",
      facts: { proofProfile: undefined },
      reviews: [...reviews(true), telemetryReview()],
    });
    releaseInput.health = healthySample();

    const evaluation = evaluateReleaseGovernor(releaseInput, policy);

    expect(evaluation.classification.proofProfile).toBe("mac_studio_control_director");
    expect(evaluation.classification.requiredChecks).toContain("control_director_mac_studio");
    expect(evaluation.decision.exactApprovalWording).toContain(
      "verified local Mac Studio build and Control Director proof",
    );
  });

  it("keeps the Mac Studio profile local-only and preserves standard remote proof gates", () => {
    expect(() =>
      evaluateReleaseGovernor(
        input({
          changedFiles: ["ui/src/ui/views/pcc.ts"],
          facts: {
            proofProfile: "mac_studio_control_director",
            destination: "https://github.com/SnowBelt/openclaw",
            externalDisclosure: true,
          },
        }),
        policy,
      ),
    ).toThrow(/limited to local-only Project Command Center releases/u);

    const standardHealthInput = input({
      changedFiles: ["ui/src/ui/views/pcc.ts"],
      operation: "promotion",
      facts: { proofProfile: "standard" },
      reviews: [...reviews(), telemetryReview()],
    });
    standardHealthInput.health = healthySample();
    standardHealthInput.health.mobileBrowserErrors = 1;
    expect(evaluateReleaseGovernor(standardHealthInput, policy).health).toMatchObject({
      passed: false,
      blockers: [expect.stringContaining("desktop/mobile browser error")],
    });

    const releaseInput = input({
      changedFiles: ["ui/src/ui/views/pcc.ts"],
      operation: "promotion",
      facts: { proofProfile: "standard" },
      reviews: [...reviews(), telemetryReview()],
    });
    releaseInput.health = healthySample();
    const evaluation = evaluateReleaseGovernor(releaseInput, policy);
    const evidenceInput = finalizedBundleInput(evaluation);
    evidenceInput.facts = releaseInput.facts;
    evidenceInput.checks = releaseInput.checks;
    evidenceInput.reviews = releaseInput.reviews;
    evidenceInput.healthSample = releaseInput.health;
    evidenceInput.workflowSanity = [];
    evidenceInput.browserProof = { desktop: null, mobile: null, consoleErrors: 0 };
    const bundle = createReleaseEvidenceBundle(evidenceInput);
    expect(verifyReleaseEvidenceAuthorization({ bundle, policy, now: NOW })).toEqual(
      expect.arrayContaining([
        "Exact-SHA Workflow Sanity evidence is required by the selected proof profile.",
        "Desktop browser proof is required by the selected proof profile.",
        "Mobile browser proof is required by the selected proof profile.",
      ]),
    );
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
