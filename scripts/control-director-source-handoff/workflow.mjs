import { commandLabel, defaultRunCommand, executeCommand } from "./command.mjs";
import { readSourceHandoffGitState } from "./git-state.mjs";
import { findExactPullRequest, pullRequestCreateArgs, queryPullRequests } from "./github.mjs";
import { normalizeSourceHandoffPolicy } from "./policy.mjs";
import { evaluateSourceHandoffPreflight } from "./preflight.mjs";
import {
  CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT,
  normalizeRemoteUrl,
  redactSensitiveText,
  SOURCE_HANDOFF_SCHEMA,
} from "./shared.mjs";

const OPERATIONS = new Set(["preflight", "status", "finish"]);

function withPullRequest(base, pullRequest) {
  return pullRequest ? { ...base, pullRequest } : base;
}

function blockedReceipt(receipt, blocker, nextAction) {
  return {
    ...receipt,
    state: "blocked",
    passed: false,
    blockers: [blocker],
    nextAction,
  };
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
  if (!OPERATIONS.has(operation)) {
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
    return blockedReceipt(
      receipt,
      { code: query.code, message: query.message },
      operation === "status"
        ? "Verify local GitHub authentication and rerun status; no mutation was attempted."
        : "Verify local GitHub authentication and rerun finish; no push was attempted.",
    );
  }
  const found = findExactPullRequest(query.records, prContext);
  if (found.kind === "blocked") {
    return blockedReceipt(
      receipt,
      { code: found.code, message: found.message },
      "Resolve the exact pull-request identity blocker manually; no PR was changed.",
    );
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
    return blockedReceipt(
      receipt,
      {
        code: "destination_push_failed",
        message: redactSensitiveText(push.stderr || push.stdout || "git push failed."),
      },
      "Inspect the push error and rerun only after the destination is known to be safe; the receipt records that a push was attempted.",
    );
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
    return blockedReceipt(
      receipt,
      {
        code: "source_changed_after_push",
        message: "Source identity changed after push; no pull request was created or changed.",
      },
      "Stop and reconcile the exact source receipt before any retry.",
    );
  }

  const postPushQuery = queryPullRequests({
    policy: normalizedPolicy,
    branch: preflight.source.branch,
    run,
    repoRoot,
  });
  receipt.commands.push(postPushQuery.command);
  if (!postPushQuery.ok) {
    return blockedReceipt(
      receipt,
      { code: postPushQuery.code, message: postPushQuery.message },
      "Verify GitHub read access before retrying; the branch push already succeeded and must not be duplicated blindly.",
    );
  }
  const postPushFound = findExactPullRequest(postPushQuery.records, prContext);
  if (postPushFound.kind === "blocked") {
    return blockedReceipt(
      receipt,
      { code: postPushFound.code, message: postPushFound.message },
      "Resolve the exact pull-request identity blocker; the exact branch push is preserved.",
    );
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

  const createArgs = pullRequestCreateArgs({
    policy: normalizedPolicy,
    sourceSha: preflight.source.sha,
    branch: preflight.source.branch,
  });
  receipt.commands.push(commandLabel("gh", createArgs));
  const create = executeCommand(run, "gh", createArgs, repoRoot);
  receipt.pullRequestMutation = { attempted: true, passed: create.status === 0 };
  if (create.status !== 0) {
    return blockedReceipt(
      receipt,
      {
        code: "draft_pr_create_failed",
        message: redactSensitiveText(create.stderr || create.stdout || "gh pr create failed."),
      },
      "Inspect the GitHub error; the exact branch push is preserved and no retry should assume PR creation succeeded.",
    );
  }
  const finalQuery = queryPullRequests({
    policy: normalizedPolicy,
    branch: preflight.source.branch,
    run,
    repoRoot,
  });
  receipt.commands.push(finalQuery.command);
  if (!finalQuery.ok) {
    return blockedReceipt(
      receipt,
      { code: finalQuery.code, message: finalQuery.message },
      "Verify GitHub read access before retrying; PR creation was attempted and must be reconciled.",
    );
  }
  const finalFound = findExactPullRequest(finalQuery.records, prContext);
  if (finalFound.kind !== "exact") {
    return blockedReceipt(
      receipt,
      {
        code: finalFound.kind === "blocked" ? finalFound.code : "draft_pr_not_visible",
        message:
          finalFound.kind === "blocked"
            ? finalFound.message
            : "The created draft PR was not visible with the exact source SHA.",
      },
      "Stop and reconcile the GitHub result before any retry.",
    );
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
