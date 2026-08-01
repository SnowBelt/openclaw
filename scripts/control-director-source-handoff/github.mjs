import { commandLabel, executeCommand } from "./command.mjs";
import { normalizeText, redactSensitiveText } from "./shared.mjs";

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

export function pullRequestQueryArgs(policy, branch) {
  return [
    "pr",
    "list",
    "--repo",
    policy.canonicalRepository,
    "--head",
    branch,
    "--state",
    "all",
    "--json",
    "number,url,state,isDraft,headRefOid,headRefName,baseRefName",
  ];
}

export function validatePullRequestRecord(record, { policy, expectedSha, expectedBranch }) {
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

export function queryPullRequests({ policy, branch, run, repoRoot }) {
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

export function buildPullRequestBody({ sourceSha, branch, policy }) {
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

export function findExactPullRequest(records, context) {
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

export function pullRequestCreateArgs({ policy, sourceSha, branch }) {
  return [
    "pr",
    "create",
    "--repo",
    policy.canonicalRepository,
    "--head",
    branch,
    "--base",
    policy.baseBranch,
    "--draft",
    "--title",
    `Operations Room source handoff ${sourceSha.slice(0, 12)}`,
    "--body",
    buildPullRequestBody({ sourceSha, branch, policy }),
  ];
}
