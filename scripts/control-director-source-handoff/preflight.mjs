import fs from "node:fs";
import path from "node:path";
import { normalizeSourceHandoffPolicy } from "./policy.mjs";
import {
  CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT,
  immutableSha,
  normalizeRemoteUrl,
  normalizeText,
  redactSensitiveText,
  SHA_PATTERN,
  SOURCE_HANDOFF_SCHEMA,
  validateSourceHandoffBranch,
} from "./shared.mjs";

function samePath(left, right) {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

function addBlocker(blockers, code, message, command) {
  blockers.push({ code, message, ...(command ? { command } : {}) });
}

function preflightChecks({ state, expectedSha, expectedBranch, policy, repoRoot }) {
  const blockers = [];
  const checks = [];
  const check = (id, passed, detail) => checks.push({ id, passed, detail });
  let normalizedExpectedSha = "";
  try {
    normalizedExpectedSha = immutableSha(expectedSha, "--sha");
    check("expected-sha-format", true, "expected SHA is immutable");
  } catch (error) {
    check("expected-sha-format", false, error instanceof Error ? error.message : String(error));
    addBlocker(
      blockers,
      "invalid_expected_sha",
      error instanceof Error ? error.message : String(error),
    );
  }

  let normalizedExpectedBranch = "";
  try {
    normalizedExpectedBranch = validateSourceHandoffBranch(expectedBranch, "--branch");
    check("expected-branch-format", true, "expected branch is a safe codex branch");
  } catch (error) {
    check("expected-branch-format", false, error instanceof Error ? error.message : String(error));
    addBlocker(
      blockers,
      "invalid_expected_branch",
      error instanceof Error ? error.message : String(error),
    );
  }

  const headShaMatches =
    SHA_PATTERN.test(state.headSha) &&
    Boolean(normalizedExpectedSha) &&
    state.headSha === normalizedExpectedSha;
  check(
    "head-sha",
    headShaMatches,
    headShaMatches
      ? `HEAD matches ${normalizedExpectedSha}`
      : `HEAD ${state.headSha || "<missing>"} does not match ${normalizedExpectedSha || "<missing>"}`,
  );
  if (!headShaMatches) {
    addBlocker(
      blockers,
      "head_sha_mismatch",
      "The checked-out HEAD is not the approved exact source SHA.",
    );
  }

  const branchMatches =
    Boolean(normalizedExpectedBranch) && state.branch === normalizedExpectedBranch;
  check(
    "branch",
    branchMatches,
    branchMatches
      ? `checked out branch is ${normalizedExpectedBranch}`
      : `checked out branch ${state.branch || "<detached>"} does not match ${normalizedExpectedBranch || "<missing>"}`,
  );
  if (!branchMatches) {
    addBlocker(
      blockers,
      "branch_mismatch",
      "The checked-out branch is not the approved source branch.",
    );
  }

  const clean = state.status === "";
  check("source-clean", clean, clean ? "source checkout is clean" : "source checkout has changes");
  if (!clean) {
    addBlocker(blockers, "dirty_checkout", "The source checkout has tracked or untracked changes.");
  }

  const remoteMatches =
    normalizeRemoteUrl(state.remoteUrl) === normalizeRemoteUrl(policy.canonicalRemoteUrl);
  check(
    "canonical-remote",
    remoteMatches,
    remoteMatches
      ? `${policy.canonicalRemoteName} points to the canonical destination`
      : `${policy.canonicalRemoteName} points to ${redactSensitiveText(state.remoteUrl) || "<missing>"}, not ${policy.canonicalRemoteUrl}`,
  );
  if (!remoteMatches) {
    addBlocker(
      blockers,
      "canonical_remote_mismatch",
      "The push remote is not the canonical approved destination.",
    );
  }

  const rootMatches = samePath(state.repoRoot, repoRoot);
  check(
    "worktree-root",
    rootMatches,
    rootMatches
      ? "Git resolved the expected isolated worktree"
      : "Git resolved a different worktree root",
  );
  if (!rootMatches) {
    addBlocker(
      blockers,
      "worktree_root_mismatch",
      "The command is not operating on the expected isolated worktree.",
    );
  }

  for (const error of state.errors) {
    check(`git-${error.field}`, false, error.message);
    addBlocker(
      blockers,
      "git_identity_read_failed",
      `Could not read Git ${error.field}: ${error.message}`,
    );
  }

  return {
    expectedSha: normalizedExpectedSha,
    expectedBranch: normalizedExpectedBranch,
    checks,
    blockers,
    passed: blockers.length === 0,
  };
}

export function evaluateSourceHandoffPreflight({
  state,
  expectedSha,
  expectedBranch,
  policy,
  repoRoot = CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT,
}) {
  const normalizedPolicy = normalizeSourceHandoffPolicy(policy);
  const result = preflightChecks({
    state,
    expectedSha,
    expectedBranch,
    policy: normalizedPolicy,
    repoRoot,
  });
  const destinationUrl = normalizedPolicy.canonicalRemoteUrl;
  return {
    schema: SOURCE_HANDOFF_SCHEMA,
    version: 1,
    operation: "preflight",
    state: result.passed ? "ready_local" : "blocked",
    passed: result.passed,
    source: {
      sha: result.expectedSha || normalizeText(state.headSha).toLowerCase(),
      branch: result.expectedBranch || normalizeText(state.branch),
      clean: state.status === "",
      worktreeRoot: normalizeText(state.repoRoot),
    },
    destination: {
      remoteName: normalizedPolicy.canonicalRemoteName,
      remoteUrl: normalizedPolicy.canonicalRemoteUrl,
      repository: normalizedPolicy.canonicalRepository,
      baseBranch: normalizedPolicy.baseBranch,
      prMode: normalizedPolicy.prMode,
      proofMode: normalizedPolicy.proofMode,
      explicitApproval: {
        required: true,
        supplied: false,
        exact: false,
        expectedUrl: destinationUrl,
      },
    },
    checks: result.checks,
    blockers: result.blockers,
    evidence: [
      "git rev-parse HEAD",
      "git branch --show-current",
      "git status --porcelain=v1 --untracked-files=all",
      `git remote get-url ${normalizedPolicy.canonicalRemoteName}`,
    ],
    nextAction: result.passed
      ? `Run finish with --approve-destination ${destinationUrl}; no mutation is attempted by preflight.`
      : "Inspect the listed blocker(s), correct the source identity, and rerun preflight.",
    externalMutationAttempted: false,
  };
}
