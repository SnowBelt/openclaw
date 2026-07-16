import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { classifyReleaseCandidate, validateReleaseCandidateFacts } from "./classifier.js";
import {
  RELEASE_EVIDENCE_SCHEMA,
  RELEASE_GOVERNANCE_STATUS_SCHEMA,
  type ReleaseEvidenceBundle,
  type ReleaseEvidenceBundleInput,
  type ReleaseGovernanceStatus,
  type ReleaseGovernorPolicy,
} from "./contracts.js";
import { decideReleasePolicy, requiredReleaseReviewRoles } from "./decision.js";
import { evaluateReleaseHealth } from "./health.js";

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
  if (bundle.ledger.projectId !== bundle.facts.project) {
    errors.push("Evidence project does not match candidate facts.");
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
    candidateSha: bundle.facts.candidateSha,
    activeRuntimeSha: bundle.runtime.activeRuntimeSha,
    riskLevel: bundle.evaluation.classification.riskLevel,
    protectedPaths: bundle.evaluation.classification.protectedPaths,
    capabilityDiff: bundle.evaluation.capabilityDiff,
    checks: bundle.checks,
    approvalStatus: bundle.evaluation.decision.approvalMode,
    approvalScope:
      approval && "candidateSha" in approval
        ? `${approval.repository}:${approval.branch}@${approval.candidateSha} -> ${approval.destination}`
        : approval
          ? `${approval.project}:${approval.repository}:${approval.branch} descendants of ${approval.approvedBaseSha} -> ${approval.destination}`
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
