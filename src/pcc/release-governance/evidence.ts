import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  browserProofPhaseForCheckId,
  isBrowserProofCheckId,
  proofProfileVersion,
  validateBrowserProofReceiptBinding,
} from "./browser-proof-contract.js";
import { classifyReleaseCandidate, validateReleaseCandidateFacts } from "./classifier.js";
import {
  RELEASE_EVIDENCE_SCHEMA,
  RELEASE_GOVERNANCE_STATUS_SCHEMA,
  RELEASE_LOCAL_PROOF_SCHEMA,
  type ReleaseEvidenceBundle,
  type ReleaseEvidenceBundleInput,
  type ReleaseGovernanceStatus,
  type ReleaseGovernorPolicy,
  type ReleaseCheck,
} from "./contracts.js";
import { decideReleasePolicy, requiredReleaseReviewRoles } from "./decision.js";
import { evaluateReleaseHealth } from "./health.js";
import { verifyReleaseLedgerPreflightReceipt } from "./ledger.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalReleaseJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function releaseEvidenceHash(input: ReleaseEvidenceBundleInput): string {
  return createHash("sha256").update(canonicalReleaseJson(input)).digest("hex");
}

export function createReleaseEvidenceBundle(
  input: ReleaseEvidenceBundleInput,
): ReleaseEvidenceBundle {
  return {
    schema: RELEASE_EVIDENCE_SCHEMA,
    ...input,
    receiptHash: releaseEvidenceHash(input),
  };
}

export function verifyReleaseEvidenceBundle(bundle: ReleaseEvidenceBundle): string[] {
  const errors: string[] = [];
  if (bundle.schema !== RELEASE_EVIDENCE_SCHEMA) {
    errors.push(`Unsupported release evidence schema: ${String(bundle.schema)}.`);
  }
  const { schema: _schema, receiptHash, ...input } = bundle;
  const expected = releaseEvidenceHash(input);
  if (receiptHash !== expected) {
    errors.push(`Release evidence hash mismatch: expected ${expected}; received ${receiptHash}.`);
  }
  if (bundle.evaluation.classification.candidateSha !== bundle.facts.candidateSha) {
    errors.push("Evidence classification SHA does not match candidate facts.");
  }
  if (bundle.runtime.candidateRuntimeSha !== bundle.facts.candidateSha) {
    errors.push("Evidence runtime SHA does not match candidate facts.");
  }
  if (bundle.branch !== bundle.facts.branch) {
    errors.push("Evidence branch does not match candidate facts.");
  }
  if (bundle.sourceRepository !== bundle.facts.repository) {
    errors.push("Evidence repository does not match candidate facts.");
  }
  if (bundle.destination !== bundle.facts.destination) {
    errors.push("Evidence destination does not match candidate facts.");
  }
  if (
    bundle.proofPhase !== bundle.facts.proofPhase ||
    bundle.evaluation.classification.proofPhase !== bundle.facts.proofPhase ||
    bundle.evaluation.decision.proofPhase !== bundle.facts.proofPhase
  ) {
    errors.push(
      "Evidence proof phase does not match candidate facts, classification, and decision.",
    );
  }
  if (bundle.ledger.projectId !== bundle.facts.project) {
    errors.push("Evidence project does not match candidate facts.");
  }
  if (bundle.ledger.ready) {
    if (!bundle.ledger.preflightReceipt) {
      errors.push("PCC ledger readiness is missing its exact-SHA preflight receipt.");
    } else {
      errors.push(
        ...verifyReleaseLedgerPreflightReceipt({
          receipt: bundle.ledger.preflightReceipt,
          candidateSha: bundle.facts.candidateSha,
          projectId: bundle.ledger.projectId,
          milestoneId: bundle.ledger.milestoneId,
        }),
      );
    }
  }
  return errors;
}

const REQUIRED_RUNTIME_ARTIFACTS = [
  "dist/index.js",
  "dist/release-governor.js",
  "dist/control-ui/dashboard-surfaces.json",
  "config/release-governor-policy.json",
  "config/custom-runtime-capabilities.json",
] as const;

function safeArtifactPath(value: string): boolean {
  return (
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/u).some((segment) => segment === "..")
  );
}

const NON_ATTESTED_LOCAL_CHECKS = new Set(["candidate_sha", "parent_sha"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;

function verifyLocalProofReceipt(params: {
  bundle: ReleaseEvidenceBundle;
  check: ReleaseCheck;
}): string | null {
  const { bundle, check } = params;
  const command = check.command?.trim();
  const artifact = check.artifact?.trim();
  if (!command || !artifact) {
    return `Local proof receipt is missing its command or artifact: ${check.id}.`;
  }
  try {
    const value = JSON.parse(fs.readFileSync(artifact, "utf8")) as Record<string, unknown>;
    const expectedPhase =
      check.proofPhase ?? browserProofPhaseForCheckId(check.id) ?? bundle.facts.proofPhase;
    const expectedProfileVersion =
      check.proofProfileVersion ?? proofProfileVersion(bundle.facts.proofProfile);
    const bindingErrors = validateBrowserProofReceiptBinding({
      candidateSha: bundle.facts.candidateSha,
      activeRuntimeSha:
        expectedPhase === "post_deployment" ? bundle.runtime.activeRuntimeSha : null,
      proofProfile: bundle.facts.proofProfile,
      proofProfileVersion: expectedProfileVersion,
      proofPhase: expectedPhase,
      checkId: check.id,
      verifierSha256: typeof value.verifierSha256 === "string" ? value.verifierSha256 : "",
      browserArtifactSha256:
        typeof value.browserArtifactSha256 === "string" ? value.browserArtifactSha256 : null,
    });
    if (bindingErrors.length > 0) {
      return `Local proof receipt binding is invalid for ${check.id}: ${bindingErrors.join(" ")}`;
    }
    if (
      value.schema !== RELEASE_LOCAL_PROOF_SCHEMA ||
      value.candidateSha !== bundle.facts.candidateSha ||
      value.proofProfile !== bundle.facts.proofProfile ||
      value.proofProfileVersion !== expectedProfileVersion ||
      value.proofPhase !== expectedPhase ||
      value.activeRuntimeSha !==
        (expectedPhase === "post_deployment" ? bundle.runtime.activeRuntimeSha : null) ||
      value.checkId !== check.id ||
      value.command !== command ||
      value.verifierSha256 !== check.verifierSha256 ||
      value.browserArtifactSha256 !== (check.browserArtifactSha256 ?? null) ||
      value.result !== "passed"
    ) {
      return `Local proof receipt is not bound to the candidate, phase, profile, hashes, check, command, and passed result: ${check.id}.`;
    }
    return null;
  } catch {
    return `Local proof receipt is not valid JSON: ${check.id}.`;
  }
}

function verifyMacStudioControlDirectorProof(params: {
  bundle: ReleaseEvidenceBundle;
  policy: ReleaseGovernorPolicy;
}): string[] {
  const { bundle, policy } = params;
  if (bundle.facts.proofProfile !== "mac_studio_control_director") {
    return [];
  }
  const errors: string[] = [];
  if (
    bundle.facts.project !== "project-command-center" ||
    bundle.facts.destination !== "local-only" ||
    bundle.destination !== "local-only" ||
    bundle.facts.externalDisclosure
  ) {
    errors.push(
      "The mac_studio_control_director proof profile is restricted to a local-only project-command-center release.",
    );
  }
  if (bundle.workflowSanity.length > 0) {
    errors.push(
      "The mac_studio_control_director proof profile must not contain remote workflow evidence.",
    );
  }
  if (bundle.browserProof.mobile !== null) {
    errors.push(
      "The mac_studio_control_director proof profile must not claim mobile-device proof.",
    );
  }
  const configuredProfile = policy.proofProfiles.mac_studio_control_director;
  if (!configuredProfile) {
    return ["The active policy does not define the mac_studio_control_director proof profile."];
  }
  if (configuredProfile.version !== proofProfileVersion(bundle.facts.proofProfile)) {
    errors.push("The active Mac Studio proof profile version is not canonical.");
  }
  const required = new Set(bundle.evaluation.classification.requiredChecks);
  const prohibited = new Set(configuredProfile.prohibitedChecks);
  for (const check of bundle.checks) {
    if (prohibited.has(check.id)) {
      errors.push(`The mac_studio_control_director proof profile forbids check ${check.id}.`);
    }
    if (check.id === "authenticated_local_control_director_pcc_browser") {
      errors.push("The legacy unphased local browser proof check is not accepted.");
    }
    if (isBrowserProofCheckId(check.id) && !check.proofPhase) {
      errors.push(`Browser proof check ${check.id} is missing its explicit phase.`);
    }
    if (check.status === "passed" && check.id !== "candidate_sha" && check.id !== "parent_sha") {
      const expectedPhase = browserProofPhaseForCheckId(check.id) ?? bundle.proofPhase;
      if (check.proofPhase !== expectedPhase) {
        errors.push(`Local proof check ${check.id} is not bound to phase ${expectedPhase}.`);
      }
    }
  }
  for (const checkId of required) {
    if (NON_ATTESTED_LOCAL_CHECKS.has(checkId)) {
      continue;
    }
    const check = bundle.checks.find((candidate) => candidate.id === checkId);
    if (!check || check.status !== "passed") {
      continue;
    }
    if (!check.command?.trim()) {
      errors.push(`Local proof check ${checkId} is missing its exact command.`);
      continue;
    }
    if (!check.artifact?.trim() || !check.artifactSha256?.match(SHA256_PATTERN)) {
      errors.push(`Local proof check ${checkId} is missing a hash-bound artifact.`);
      continue;
    }
    try {
      const artifact = fs.lstatSync(check.artifact);
      if (artifact.isSymbolicLink() || !artifact.isFile()) {
        errors.push(`Local proof artifact is not a regular non-symlink file: ${checkId}.`);
        continue;
      }
      if ((artifact.mode & 0o077) !== 0) {
        errors.push(`Local proof artifact is not private: ${checkId}.`);
      }
      const actual = createHash("sha256").update(fs.readFileSync(check.artifact)).digest("hex");
      if (actual !== check.artifactSha256) {
        errors.push(`Local proof artifact hash mismatch: ${checkId}.`);
        continue;
      }
      const receiptError = verifyLocalProofReceipt({
        bundle,
        check,
      });
      if (receiptError) {
        errors.push(receiptError);
      }
    } catch {
      errors.push(`Local proof artifact is missing or unreadable: ${checkId}.`);
    }
  }
  for (const [phase, field] of [
    ["candidate", "candidate"],
    ["post_deployment", "postDeployment"],
  ] as const) {
    const checkId =
      phase === "candidate"
        ? "authenticated_local_candidate_control_director_pcc_browser"
        : "authenticated_local_active_runtime_control_director_pcc_browser";
    if (!required.has(checkId)) {
      continue;
    }
    const browserCheck = bundle.checks.find((check) => check.id === checkId);
    const browserArtifact = bundle.browserProof[field];
    if (!browserCheck?.artifact || !browserArtifact || browserArtifact !== browserCheck.artifact) {
      errors.push(`Authenticated local ${phase} browser proof must match its hash-bound artifact.`);
      continue;
    }
    if (browserCheck.proofPhase !== phase) {
      errors.push(`Authenticated local browser proof check ${checkId} has the wrong phase.`);
    }
    if (browserCheck.browserArtifactSha256 === null || !browserCheck.browserArtifactSha256) {
      errors.push(`Authenticated local ${phase} browser proof is missing its artifact hash.`);
    }
  }
  const candidateBrowserCheck = bundle.checks.find(
    (check) => check.id === "authenticated_local_candidate_control_director_pcc_browser",
  );
  const postDeploymentBrowserCheck = bundle.checks.find(
    (check) => check.id === "authenticated_local_active_runtime_control_director_pcc_browser",
  );
  if (
    candidateBrowserCheck?.artifact &&
    postDeploymentBrowserCheck?.artifact &&
    candidateBrowserCheck.artifact === postDeploymentBrowserCheck.artifact
  ) {
    errors.push(
      "Candidate browser evidence must use a distinct artifact from post-deployment browser evidence.",
    );
  }
  if (
    (required.has("authenticated_local_candidate_control_director_pcc_browser") ||
      required.has("authenticated_local_active_runtime_control_director_pcc_browser")) &&
    bundle.browserProof.consoleErrors !== 0
  ) {
    errors.push("Authenticated local browser proof contains console errors.");
  }
  if (required.has("ledger_ready") && !bundle.ledger.ready) {
    errors.push("PCC ledger readiness is not proven.");
  }
  if (
    required.has("post_deployment_health") &&
    (!bundle.deployment.postDeploymentHealth ||
      !bundle.deployment.postDeploymentHealth.passed ||
      bundle.deployment.postDeploymentHealth.deterministicRollbackTrigger)
  ) {
    errors.push("Post-deployment health is not proven.");
  }
  return errors;
}

export function verifyReleaseRuntimeArtifacts(params: {
  bundle: ReleaseEvidenceBundle;
  releaseRoot: string;
}): string[] {
  const errors: string[] = [];
  let root: string;
  try {
    if (fs.lstatSync(params.releaseRoot).isSymbolicLink()) {
      return ["Release root must not be a symbolic link."];
    }
    root = fs.realpathSync(params.releaseRoot);
  } catch {
    return ["Release root is missing or unreadable."];
  }
  const stampPath = path.join(root, ".openclaw-production-sha");
  try {
    if (fs.lstatSync(stampPath).isSymbolicLink()) {
      errors.push("Release source stamp must not be a symbolic link.");
    } else if (fs.readFileSync(stampPath, "utf8").trim() !== params.bundle.facts.candidateSha) {
      errors.push("Release source stamp does not match the exact candidate SHA.");
    }
  } catch {
    errors.push("Release source stamp is missing or unreadable.");
  }
  const artifacts = [...REQUIRED_RUNTIME_ARTIFACTS, params.bundle.build.buildInfoPath].filter(
    (value, index, values) => values.indexOf(value) === index,
  );
  for (const relative of artifacts) {
    if (!safeArtifactPath(relative)) {
      errors.push(`Release artifact path is unsafe: ${relative}.`);
      continue;
    }
    const expected = params.bundle.build.artifactHashes[relative];
    if (!expected || !/^[a-f0-9]{64}$/iu.test(expected)) {
      errors.push(`Release artifact hash is missing or invalid: ${relative}.`);
      continue;
    }
    const target = path.join(root, relative);
    try {
      if (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isFile()) {
        errors.push(`Release artifact is not a regular non-symlink file: ${relative}.`);
        continue;
      }
      const actual = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
      if (actual !== expected) {
        errors.push(`Release artifact hash mismatch: ${relative}.`);
      }
    } catch {
      errors.push(`Release artifact is missing or unreadable: ${relative}.`);
    }
  }
  const buildInfoPath = path.join(root, params.bundle.build.buildInfoPath);
  if (safeArtifactPath(params.bundle.build.buildInfoPath) && fs.existsSync(buildInfoPath)) {
    try {
      const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8")) as { commit?: unknown };
      if (buildInfo.commit !== params.bundle.facts.candidateSha) {
        errors.push("Build information is not bound to the exact candidate SHA.");
      }
    } catch {
      errors.push("Build information is invalid JSON.");
    }
  }
  return [...new Set(errors)];
}

export function verifyReleaseEvidenceAuthorization(params: {
  bundle: ReleaseEvidenceBundle;
  policy: ReleaseGovernorPolicy;
  now: string;
}): string[] {
  const { bundle, policy } = params;
  const errors = verifyReleaseEvidenceBundle(bundle);
  if (
    bundle.proofProfile !== bundle.facts.proofProfile ||
    bundle.evaluation.classification.proofProfile !== bundle.facts.proofProfile ||
    bundle.evaluation.decision.proofProfile !== bundle.facts.proofProfile
  ) {
    errors.push(
      "Evidence proof profile does not match candidate facts, classification, and decision.",
    );
  }
  if (
    bundle.proofPhase !== bundle.facts.proofPhase ||
    bundle.evaluation.classification.proofPhase !== bundle.facts.proofPhase ||
    bundle.evaluation.decision.proofPhase !== bundle.facts.proofPhase
  ) {
    errors.push(
      "Evidence proof phase does not match candidate facts, classification, and decision.",
    );
  }
  const factErrors = validateReleaseCandidateFacts(bundle.facts);
  errors.push(...factErrors);
  if (factErrors.length > 0) {
    return [...new Set(errors)];
  }
  const classification = classifyReleaseCandidate({
    policy,
    facts: bundle.facts,
    capabilityDiff: bundle.evaluation.capabilityDiff,
    operation: bundle.evaluation.decision.operation,
  });
  if (
    canonicalReleaseJson(classification) !== canonicalReleaseJson(bundle.evaluation.classification)
  ) {
    errors.push("Evidence classification does not match deterministic policy output.");
  }
  const requiresHealth = bundle.evaluation.decision.operation !== "stage";
  if (requiresHealth && !bundle.healthSample) {
    errors.push(`Health sample is required for ${bundle.evaluation.decision.operation}.`);
  }
  const health = bundle.healthSample ? evaluateReleaseHealth(bundle.healthSample, policy) : null;
  if (canonicalReleaseJson(health) !== canonicalReleaseJson(bundle.evaluation.health)) {
    errors.push("Evidence health decision does not match deterministic threshold evaluation.");
  }
  const exactApprovals = bundle.approvals.filter(
    (approval): approval is Extract<(typeof bundle.approvals)[number], { candidateSha: string }> =>
      "candidateSha" in approval,
  );
  const approvalGrants = bundle.approvals.filter(
    (
      approval,
    ): approval is Extract<(typeof bundle.approvals)[number], { approvedBaseSha: string }> =>
      "approvedBaseSha" in approval,
  );
  const decision = decideReleasePolicy({
    policy,
    operation: bundle.evaluation.decision.operation,
    facts: bundle.facts,
    classification,
    checks: bundle.checks,
    reviews: bundle.reviews,
    exactApprovals,
    approvalGrants,
    health,
    rollbackAuthorized: bundle.rollbackAuthorized,
    now: params.now,
  });
  if (canonicalReleaseJson(decision) !== canonicalReleaseJson(bundle.evaluation.decision)) {
    errors.push("Evidence decision does not match deterministic policy output.");
  }
  const expectedRoles = requiredReleaseReviewRoles({
    operation: bundle.evaluation.decision.operation,
    classification,
    scopeCoordinationMaterial: bundle.facts.scopeCoordinationMaterial,
  });
  if (
    canonicalReleaseJson(expectedRoles.toSorted()) !==
    canonicalReleaseJson(bundle.evaluation.decision.requiredReviewRoles.toSorted())
  ) {
    errors.push("Evidence required-review role set is incomplete or expanded unexpectedly.");
  }
  if (bundle.build.buildStamp !== bundle.facts.candidateSha) {
    errors.push("Build stamp is not bound to the exact candidate SHA.");
  }
  if (Object.keys(bundle.build.artifactHashes).length === 0) {
    errors.push("Immutable build artifact hashes are missing.");
  }
  errors.push(...verifyMacStudioControlDirectorProof({ bundle, policy }));
  for (const workflow of bundle.workflowSanity) {
    if (workflow.headSha !== bundle.facts.candidateSha || workflow.conclusion !== "success") {
      errors.push(
        `Workflow Sanity ${workflow.runId} is not successful for the exact candidate SHA.`,
      );
    }
  }
  if (bundle.evaluation.decision.decision !== "authorize") {
    errors.push(`Release policy decision is ${bundle.evaluation.decision.decision}.`);
  }
  return [...new Set(errors)];
}

export function releaseGovernanceStatusFromBundle(
  bundle: ReleaseEvidenceBundle,
): ReleaseGovernanceStatus {
  const approval = [...bundle.approvals].toSorted((left, right) =>
    right.grantedAt.localeCompare(left.grantedAt),
  )[0];
  return {
    schema: RELEASE_GOVERNANCE_STATUS_SCHEMA,
    policyVersion: bundle.evaluation.decision.policyVersion,
    proofProfile: bundle.facts.proofProfile,
    proofProfileVersion: proofProfileVersion(bundle.facts.proofProfile),
    proofPhase: bundle.facts.proofPhase,
    candidateSha: bundle.facts.candidateSha,
    activeRuntimeSha: bundle.runtime.activeRuntimeSha,
    riskLevel: bundle.evaluation.classification.riskLevel,
    protectedPaths: bundle.evaluation.classification.protectedPaths,
    capabilityDiff: bundle.evaluation.capabilityDiff,
    checks: bundle.checks,
    approvalStatus: bundle.evaluation.decision.approvalMode,
    approvalScope:
      approval && "candidateSha" in approval
        ? `${approval.repository}:${approval.branch}@${approval.candidateSha} [${approval.proofProfile}] -> ${approval.destination}`
        : approval
          ? `${approval.project}:${approval.repository}:${approval.branch} descendants of ${approval.approvedBaseSha} [${approval.proofProfile}] -> ${approval.destination}`
          : null,
    reviews: bundle.reviews,
    rollbackTarget: bundle.deployment.rollbackTarget,
    decision: bundle.evaluation.decision.decision,
    evidenceReceiptHash: bundle.receiptHash,
    evidencePath: null,
    exactBlocker: bundle.evaluation.decision.blockers[0] ?? null,
    approvalWording: bundle.evaluation.decision.exactApprovalWording,
    updatedAt: bundle.createdAt,
  };
}
