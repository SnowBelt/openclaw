#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const CONTROL_DIRECTOR_SOURCE_HANDOFF_POLICY_PATH = path.join(
  CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT,
  "work",
  "control-director",
  "reliability-v1",
  "source-handoff-policy.json",
);
export const SOURCE_HANDOFF_SCHEMA = "openclaw.control-director.source-handoff.v1";
export const SOURCE_HANDOFF_STATES = Object.freeze([
  "ready_local",
  "destination_approval_required",
  "pushing",
  "pushed",
  "draft_pr_ready",
  "blocked",
]);

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const BRANCH_PATTERN = /^codex\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const POLICY_SCHEMA = "openclaw.control-director.source-handoff-policy.v1";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function redactSensitiveText(value) {
  return normalizeText(value)
    .replace(/(https?:\/\/)[^\s/@]+@/giu, "$1<redacted>@")
    .replace(
      /([?&](?:token|secret|password|apikey|api_key|authorization)=)[^&\s]+/giu,
      "$1<redacted>",
    );
}

export function normalizeRemoteUrl(value) {
  return normalizeText(value)
    .replace(/\/+$/u, "")
    .replace(/\.git$/u, "")
    .toLowerCase();
}

function immutableSha(value, label) {
  const normalized = normalizeText(value).toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be an immutable 40-character SHA.`);
  }
  return normalized;
}

export function validateSourceHandoffBranch(value, label = "branch") {
  const branch = normalizeText(value);
  if (
    !BRANCH_PATTERN.test(branch) ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.endsWith("/") ||
    branch.endsWith(".")
  ) {
    throw new Error(`${label} must be a safe codex/* branch name.`);
  }
  return branch;
}

export function normalizeSourceHandoffPolicy(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Source handoff policy must be a JSON object.");
  }
  const policy = raw;
  if (policy.schema !== POLICY_SCHEMA || policy.version !== 1) {
    throw new Error("Source handoff policy identity is invalid.");
  }
  const canonicalRemoteName = normalizeText(policy.canonicalRemoteName);
  const canonicalRemoteUrl = normalizeText(policy.canonicalRemoteUrl);
  const canonicalRepository = normalizeText(policy.canonicalRepository);
  const headOwner = normalizeText(policy.headOwner);
  const baseBranch = normalizeText(policy.baseBranch);
  if (!canonicalRemoteName || !canonicalRemoteUrl || !canonicalRepository || !headOwner) {
    throw new Error("Source handoff policy is missing canonical remote or repository identity.");
  }
  if (!/^[A-Za-z0-9_.-]+$/u.test(canonicalRemoteName)) {
    throw new Error("Source handoff policy remote name is invalid.");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(canonicalRepository)) {
    throw new Error("Source handoff policy repository must be owner/name.");
  }
  if (!/^[A-Za-z0-9_.-]+$/u.test(headOwner)) {
    throw new Error("Source handoff policy head owner is invalid.");
  }
  if (!/^[A-Za-z0-9._/-]+$/u.test(baseBranch) || baseBranch.includes("..")) {
    throw new Error("Source handoff policy base branch is invalid.");
  }
  const canonicalRemoteMatch = canonicalRemoteUrl.match(
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\.git$/u,
  );
  if (!canonicalRemoteMatch || canonicalRemoteMatch[1] !== headOwner) {
    throw new Error(
      "Source handoff policy must use the canonical HTTPS GitHub remote for its head owner.",
    );
  }
  if (policy.prMode !== "draft" || policy.proofMode !== "local-only") {
    throw new Error("Source handoff policy must require draft PRs and local-only proof.");
  }
  if (policy.requireExplicitDestinationApproval !== true) {
    throw new Error("Source handoff policy must require explicit destination approval.");
  }
  return Object.freeze({
    schema: POLICY_SCHEMA,
    version: 1,
    canonicalRemoteName,
    canonicalRemoteUrl,
    canonicalRepository,
    headOwner,
    baseBranch,
    prMode: "draft",
    proofMode: "local-only",
    requireExplicitDestinationApproval: true,
  });
}

function defaultRunCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function executeCommand(commandRunner, command, args, cwd) {
  const result = commandRunner(command, args, cwd);
  if (!result || typeof result.status !== "number") {
    throw new Error(`${command} runner returned an invalid result.`);
  }
  return {
    status: result.status,
    stdout: normalizeText(result.stdout),
    stderr: normalizeText(result.stderr),
  };
}

function commandLabel(command, args) {
  return [command, ...args].join(" ");
}

function addBlocker(blockers, code, message, command) {
  blockers.push({ code, message, ...(command ? { command } : {}) });
}

export function readSourceHandoffGitState({
  repoRoot = CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT,
  remoteName = "SnowBelt",
  runCommand: injectedRunCommand,
} = {}) {
  const run = injectedRunCommand ?? defaultRunCommand;
  const errors = [];
  const commands = [];
  const read = (args, field) => {
    commands.push(commandLabel("git", args));
    const result = executeCommand(run, "git", args, repoRoot);
    if (result.status !== 0) {
      errors.push({
        field,
        message: redactSensitiveText(
          result.stderr || result.stdout || `git ${args.join(" ")} failed`,
        ),
      });
      return "";
    }
    return result.stdout;
  };
  return {
    repoRoot: read(["rev-parse", "--show-toplevel"], "repoRoot"),
    headSha: read(["rev-parse", "HEAD"], "headSha").toLowerCase(),
    branch: read(["branch", "--show-current"], "branch"),
    status: read(["status", "--porcelain=v1", "--untracked-files=all"], "status"),
    remoteUrl: read(["remote", "get-url", remoteName], "remoteUrl"),
    errors,
    commands,
  };
}

function samePath(left, right) {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
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

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function pullRequestQueryArgs(policy, branch) {
  return [
    "pr",
    "list",
    "--repo",
    policy.canonicalRepository,
    "--head",
    `${policy.headOwner}:${branch}`,
    "--state",
    "all",
    "--json",
    "number,url,state,isDraft,headRefOid,headRefName,baseRefName",
  ];
}

function validatePullRequestRecord(record, { policy, expectedSha, expectedBranch }) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {
      ok: false,
      code: "pull_request_identity_invalid",
      message: "Pull request metadata is not an object.",
    };
  }
  const number = Number(record.number);
  if (!Number.isInteger(number) || number <= 0) {
    return {
      ok: false,
      code: "pull_request_identity_invalid",
      message: "Pull request number is invalid.",
    };
  }
  if (record.headRefName !== expectedBranch || record.headRefOid?.toLowerCase() !== expectedSha) {
    return {
      ok: false,
      code: "pull_request_source_mismatch",
      message: "The existing pull request does not point to the exact source branch and SHA.",
    };
  }
  if (record.baseRefName !== policy.baseBranch) {
    return {
      ok: false,
      code: "pull_request_base_mismatch",
      message: `The existing pull request targets ${record.baseRefName || "<missing>"}, not ${policy.baseBranch}.`,
    };
  }
  if (record.state !== "OPEN") {
    return {
      ok: false,
      code: "closed_pull_request_exists",
      message:
        "A closed pull request already uses this source branch; it will not be reused or replaced automatically.",
    };
  }
  if (record.isDraft !== true) {
    return {
      ok: false,
      code: "pull_request_not_draft",
      message:
        "The existing pull request is not a draft; explicit review ownership is required before changing it.",
    };
  }
  if (!normalizeText(record.url)) {
    return {
      ok: false,
      code: "pull_request_url_missing",
      message: "The exact draft pull request URL is missing.",
    };
  }
  return { ok: true, record: { ...record, number } };
}

function queryPullRequests({ policy, branch, run, repoRoot }) {
  const args = pullRequestQueryArgs(policy, branch);
  const result = executeCommand(run, "gh", args, repoRoot);
  if (result.status !== 0) {
    return {
      ok: false,
      code: "github_query_failed",
      message: redactSensitiveText(result.stderr || result.stdout || "gh pr list failed."),
      command: commandLabel("gh", args),
    };
  }
  let records;
  try {
    records = parseJsonOutput(result.stdout || "[]", "gh pr list");
  } catch (error) {
    return {
      ok: false,
      code: "github_query_invalid",
      message: error instanceof Error ? error.message : String(error),
      command: commandLabel("gh", args),
    };
  }
  if (!Array.isArray(records)) {
    return {
      ok: false,
      code: "github_query_invalid",
      message: "gh pr list did not return an array.",
      command: commandLabel("gh", args),
    };
  }
  return { ok: true, records, command: commandLabel("gh", args) };
}

function buildPullRequestBody({ sourceSha, branch, policy }) {
  return [
    "## Summary",
    "- Adds deterministic Control Director source-handoff preflight and idempotent draft-PR verification.",
    "- Keeps GitHub mutation outside the managed Gateway and requires an exact destination approval.",
    "",
    "## Verification",
    `- Exact source SHA: \`${sourceSha}\``,
    `- Source branch: \`${branch}\``,
    "- Proof mode: Mac Studio local-only; hosted, Blacksmith, and Crabbox execution are not required.",
    `- Base branch: \`${policy.baseBranch}\``,
    "- Runtime mutation: none.",
  ].join("\n");
}

function findExactPullRequest(records, context) {
  if (records.length === 0) {
    return { kind: "none" };
  }
  if (records.length > 1) {
    return {
      kind: "blocked",
      code: "multiple_pull_requests",
      message:
        "More than one pull request matches the source branch; no PR is changed automatically.",
    };
  }
  const validated = validatePullRequestRecord(records[0], context);
  return validated.ok
    ? { kind: "exact", record: validated.record }
    : { kind: "blocked", code: validated.code, message: validated.message };
}

function withPullRequest(base, pullRequest) {
  return pullRequest ? { ...base, pullRequest } : base;
}

export function runSourceHandoff({
  operation = "preflight",
  repoRoot = CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT,
  policy,
  expectedSha,
  expectedBranch,
  destinationApproval,
  runCommand: injectedRunCommand,
  now = () => new Date().toISOString(),
} = {}) {
  const normalizedPolicy = normalizeSourceHandoffPolicy(policy);
  if (!new Set(["preflight", "status", "finish"]).has(operation)) {
    throw new Error("Source handoff operation must be preflight, status, or finish.");
  }
  const run = injectedRunCommand ?? defaultRunCommand;
  const state = readSourceHandoffGitState({
    repoRoot,
    remoteName: normalizedPolicy.canonicalRemoteName,
    runCommand: run,
  });
  const preflight = evaluateSourceHandoffPreflight({
    state,
    expectedSha,
    expectedBranch,
    policy: normalizedPolicy,
    repoRoot,
  });
  const receipt = {
    ...preflight,
    schema: SOURCE_HANDOFF_SCHEMA,
    operation,
    generatedAt: now(),
    destination: {
      ...preflight.destination,
      explicitApproval: {
        ...preflight.destination.explicitApproval,
        supplied: Boolean(destinationApproval),
        exact:
          Boolean(destinationApproval) &&
          normalizeRemoteUrl(destinationApproval) ===
            normalizeRemoteUrl(normalizedPolicy.canonicalRemoteUrl),
      },
    },
    commands: [...state.commands],
    externalMutationAttempted: false,
  };

  if (operation === "preflight") {
    return receipt;
  }

  const prContext = {
    policy: normalizedPolicy,
    expectedSha: preflight.source.sha,
    expectedBranch: preflight.source.branch,
  };
  if (!preflight.passed) {
    return {
      ...receipt,
      nextAction: "Resolve the source preflight blocker(s); no destination action was attempted.",
    };
  }

  const query = queryPullRequests({
    policy: normalizedPolicy,
    branch: preflight.source.branch,
    run,
    repoRoot,
  });
  receipt.commands.push(query.command);
  if (!query.ok) {
    if (operation === "status") {
      return {
        ...receipt,
        state: "blocked",
        passed: false,
        blockers: [{ code: query.code, message: query.message }],
        nextAction:
          "Verify local GitHub authentication and rerun status; no mutation was attempted.",
      };
    }
    return {
      ...receipt,
      state: "blocked",
      passed: false,
      blockers: [{ code: query.code, message: query.message }],
      nextAction: "Verify local GitHub authentication and rerun finish; no push was attempted.",
    };
  }
  const found = findExactPullRequest(query.records, prContext);
  if (found.kind === "blocked") {
    return {
      ...receipt,
      state: "blocked",
      passed: false,
      blockers: [{ code: found.code, message: found.message }],
      nextAction: "Resolve the exact pull-request identity blocker manually; no PR was changed.",
    };
  }
  if (operation === "status") {
    return found.kind === "exact"
      ? withPullRequest(
          {
            ...receipt,
            state: "draft_pr_ready",
            passed: true,
            nextAction: "No action is needed; the exact draft PR is already ready.",
          },
          found.record,
        )
      : {
          ...receipt,
          state: "ready_local",
          passed: true,
          nextAction:
            "Run finish with the exact destination approval to push and create the draft PR.",
        };
  }

  const approvalMatches =
    normalizedPolicy.requireExplicitDestinationApproval &&
    Boolean(destinationApproval) &&
    normalizeRemoteUrl(destinationApproval) ===
      normalizeRemoteUrl(normalizedPolicy.canonicalRemoteUrl);
  if (!approvalMatches) {
    return {
      ...receipt,
      state: "destination_approval_required",
      passed: false,
      blockers: [
        {
          code: destinationApproval
            ? "destination_approval_mismatch"
            : "destination_approval_required",
          message: `Finish requires --approve-destination ${normalizedPolicy.canonicalRemoteUrl}; no push or PR mutation was attempted.`,
        },
      ],
      nextAction: `Rerun finish with --approve-destination ${normalizedPolicy.canonicalRemoteUrl}.`,
    };
  }

  const pushArgs = [
    "push",
    "--set-upstream",
    normalizedPolicy.canonicalRemoteName,
    preflight.source.branch,
  ];
  receipt.state = "pushing";
  receipt.commands.push(commandLabel("git", pushArgs));
  receipt.externalMutationAttempted = true;
  const push = executeCommand(run, "git", pushArgs, repoRoot);
  receipt.push = { attempted: true, passed: push.status === 0 };
  if (push.status !== 0) {
    return {
      ...receipt,
      state: "blocked",
      passed: false,
      blockers: [
        {
          code: "destination_push_failed",
          message: redactSensitiveText(push.stderr || push.stdout || "git push failed."),
        },
      ],
      nextAction:
        "Inspect the push error and rerun only after the destination is known to be safe; the receipt records that a push was attempted.",
    };
  }

  const afterPushState = readSourceHandoffGitState({
    repoRoot,
    remoteName: normalizedPolicy.canonicalRemoteName,
    runCommand: run,
  });
  receipt.commands.push(...afterPushState.commands);
  const afterPush = evaluateSourceHandoffPreflight({
    state: afterPushState,
    expectedSha: preflight.source.sha,
    expectedBranch: preflight.source.branch,
    policy: normalizedPolicy,
    repoRoot,
  });
  receipt.sourceAfterPush = afterPush.source;
  if (!afterPush.passed) {
    return {
      ...receipt,
      state: "blocked",
      passed: false,
      blockers: [
        {
          code: "source_changed_after_push",
          message: "Source identity changed after push; no pull request was created or changed.",
        },
      ],
      nextAction: "Stop and reconcile the exact source receipt before any retry.",
    };
  }

  const postPushQuery = queryPullRequests({
    policy: normalizedPolicy,
    branch: preflight.source.branch,
    run,
    repoRoot,
  });
  receipt.commands.push(postPushQuery.command);
  if (!postPushQuery.ok) {
    return {
      ...receipt,
      state: "blocked",
      passed: false,
      blockers: [{ code: postPushQuery.code, message: postPushQuery.message }],
      nextAction:
        "Verify GitHub read access before retrying; the branch push already succeeded and must not be duplicated blindly.",
    };
  }
  const postPushFound = findExactPullRequest(postPushQuery.records, prContext);
  if (postPushFound.kind === "blocked") {
    return {
      ...receipt,
      state: "blocked",
      passed: false,
      blockers: [{ code: postPushFound.code, message: postPushFound.message }],
      nextAction:
        "Resolve the exact pull-request identity blocker; the exact branch push is preserved.",
    };
  }
  if (postPushFound.kind === "exact") {
    return withPullRequest(
      {
        ...receipt,
        state: "draft_pr_ready",
        passed: true,
        nextAction: "No PR mutation was needed; the exact draft PR is ready for review.",
      },
      postPushFound.record,
    );
  }

  const createArgs = [
    "pr",
    "create",
    "--repo",
    normalizedPolicy.canonicalRepository,
    "--head",
    `${normalizedPolicy.headOwner}:${preflight.source.branch}`,
    "--base",
    normalizedPolicy.baseBranch,
    "--draft",
    "--title",
    `Operations Room source handoff ${preflight.source.sha.slice(0, 12)}`,
    "--body",
    buildPullRequestBody({
      sourceSha: preflight.source.sha,
      branch: preflight.source.branch,
      policy: normalizedPolicy,
    }),
  ];
  receipt.commands.push(commandLabel("gh", createArgs));
  const create = executeCommand(run, "gh", createArgs, repoRoot);
  receipt.pullRequestMutation = { attempted: true, passed: create.status === 0 };
  if (create.status !== 0) {
    return {
      ...receipt,
      state: "blocked",
      passed: false,
      blockers: [
        {
          code: "draft_pr_create_failed",
          message: redactSensitiveText(create.stderr || create.stdout || "gh pr create failed."),
        },
      ],
      nextAction:
        "Inspect the GitHub error; the exact branch push is preserved and no retry should assume PR creation succeeded.",
    };
  }
  const finalQuery = queryPullRequests({
    policy: normalizedPolicy,
    branch: preflight.source.branch,
    run,
    repoRoot,
  });
  receipt.commands.push(finalQuery.command);
  if (!finalQuery.ok) {
    return {
      ...receipt,
      state: "blocked",
      passed: false,
      blockers: [{ code: finalQuery.code, message: finalQuery.message }],
      nextAction:
        "Verify GitHub read access before retrying; PR creation was attempted and must be reconciled.",
    };
  }
  const finalFound = findExactPullRequest(finalQuery.records, prContext);
  if (finalFound.kind !== "exact") {
    return {
      ...receipt,
      state: "blocked",
      passed: false,
      blockers: [
        {
          code: finalFound.kind === "blocked" ? finalFound.code : "draft_pr_not_visible",
          message:
            finalFound.kind === "blocked"
              ? finalFound.message
              : "The created draft PR was not visible with the exact source SHA.",
        },
      ],
      nextAction: "Stop and reconcile the GitHub result before any retry.",
    };
  }
  return withPullRequest(
    {
      ...receipt,
      state: "draft_pr_ready",
      passed: true,
      nextAction:
        "The exact branch and draft PR are ready; no runtime or release mutation was attempted.",
    },
    finalFound.record,
  );
}

function parseArgs(argv) {
  const args = {
    operation: "preflight",
    expectedSha: "",
    expectedBranch: "",
    destinationApproval: "",
    policyPath: CONTROL_DIRECTOR_SOURCE_HANDOFF_POLICY_PATH,
    receiptPath: "",
    json: false,
  };
  let operationSet = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      continue;
    }
    if (!operationSet && !value.startsWith("-")) {
      args.operation = value;
      operationSet = true;
      continue;
    }
    const next = () => {
      const candidate = argv[++index];
      if (!candidate) {
        throw new Error(`Missing value for ${value}.`);
      }
      return candidate;
    };
    if (value === "--sha") {
      args.expectedSha = next();
    } else if (value === "--branch") {
      args.expectedBranch = next();
    } else if (value === "--approve-destination") {
      args.destinationApproval = next();
    } else if (value === "--policy") {
      args.policyPath = path.resolve(next());
    } else if (value === "--receipt") {
      args.receiptPath = path.resolve(next());
    } else if (value === "--json") {
      args.json = true;
    } else if (value === "--help" || value === "-h") {
      console.log(
        "Usage: pnpm control-director:source-handoff -- <preflight|status|finish> --sha <sha> --branch <codex/branch> [--approve-destination <url>] [--receipt <path>] [--json]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

function defaultReceiptPath(sha, operation) {
  const safeSha = SHA_PATTERN.test(sha) ? sha : "unknown";
  return path.join(
    CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT,
    ".artifacts",
    "control-director",
    "source-handoff",
    `${safeSha}-${operation}.json`,
  );
}

function writeReceipt(filePath, receipt) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}${os.EOL}`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = normalizeSourceHandoffPolicy(JSON.parse(fs.readFileSync(args.policyPath, "utf8")));
  const receipt = runSourceHandoff({
    operation: args.operation,
    expectedSha: args.expectedSha,
    expectedBranch: args.expectedBranch,
    destinationApproval: args.destinationApproval,
    policy,
  });
  const receiptPath = args.receiptPath || defaultReceiptPath(receipt.source.sha, args.operation);
  writeReceipt(receiptPath, receipt);
  if (args.json) {
    console.log(JSON.stringify({ ...receipt, receiptPath }, null, 2));
  } else {
    console.log(`source-handoff: ${receipt.state}`);
    console.log(receipt.nextAction);
    console.log(`receipt: ${receiptPath}`);
  }
  if (!receipt.passed && receipt.state !== "ready_local") {
    process.exitCode = 2;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
