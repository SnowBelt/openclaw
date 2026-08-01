import { describe, expect, it, vi } from "vitest";
import {
  evaluateSourceHandoffPreflight,
  normalizeSourceHandoffPolicy,
  runSourceHandoff,
  SOURCE_HANDOFF_SCHEMA,
} from "../../scripts/control-director-source-handoff.mjs";
import {
  pullRequestCreateArgs,
  pullRequestQueryArgs,
} from "../../scripts/control-director-source-handoff/github.mjs";

const sha = "a".repeat(40);
const policy = normalizeSourceHandoffPolicy({
  schema: "openclaw.control-director.source-handoff-policy.v1",
  version: 1,
  canonicalRemoteName: "SnowBelt",
  canonicalRemoteUrl: "https://github.com/SnowBelt/openclaw.git",
  canonicalRepository: "mindfire-lab/openclaw",
  headOwner: "SnowBelt",
  baseBranch: "main",
  prMode: "draft",
  proofMode: "local-only",
  requireExplicitDestinationApproval: true,
});

function state(overrides: Record<string, unknown> = {}) {
  return {
    repoRoot: "/tmp/source-handoff",
    headSha: sha,
    branch: "codex/example",
    status: "",
    remoteUrl: "https://github.com/SnowBelt/openclaw.git",
    errors: [],
    commands: [],
    ...overrides,
  };
}

function runnerFor({ prs = [], pushStatus = 0, createStatus = 0 } = {}) {
  return vi.fn((command: string, args: string[]) => {
    if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { status: 0, stdout: "/tmp/source-handoff\n", stderr: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      return { status: 0, stdout: `${sha}\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "branch") {
      return { status: 0, stdout: "codex/example\n", stderr: "" };
    }
    if (command === "git" && args[0] === "status") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args[0] === "remote") {
      return { status: 0, stdout: "https://github.com/SnowBelt/openclaw.git\n", stderr: "" };
    }
    if (command === "git" && args[0] === "push") {
      return {
        status: pushStatus,
        stdout: "pushed\n",
        stderr: pushStatus === 0 ? "" : "push denied",
      };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "list") {
      return { status: 0, stdout: JSON.stringify(prs), stderr: "" };
    }
    if (command === "gh" && args[0] === "pr" && args[1] === "create") {
      return {
        status: createStatus,
        stdout: "https://github.com/mindfire-lab/openclaw/pull/99\n",
        stderr: "",
      };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  });
}

describe("Control Director source handoff", () => {
  it("uses repository-local branch identity instead of a redirect-prone owner alias", () => {
    expect(pullRequestQueryArgs(policy, "codex/example")).toContain("codex/example");
    expect(pullRequestQueryArgs(policy, "codex/example")).not.toContain("SnowBelt:codex/example");
    expect(pullRequestCreateArgs({ policy, sourceSha: sha, branch: "codex/example" })).toContain(
      "codex/example",
    );
  });

  it("passes a clean exact-SHA preflight and names the single next action", () => {
    const result = evaluateSourceHandoffPreflight({
      state: state(),
      expectedSha: sha,
      expectedBranch: "codex/example",
      policy,
      repoRoot: "/tmp/source-handoff",
    });
    expect(result).toMatchObject({
      schema: SOURCE_HANDOFF_SCHEMA,
      state: "ready_local",
      passed: true,
      source: { sha, branch: "codex/example", clean: true },
      destination: {
        remoteName: "SnowBelt",
        repository: "mindfire-lab/openclaw",
        explicitApproval: { required: true, supplied: false, exact: false },
      },
    });
    expect(result.nextAction).toContain("--approve-destination");
  });

  it("enumerates source identity blockers without attempting a mutation", () => {
    const result = evaluateSourceHandoffPreflight({
      state: state({
        headSha: "b".repeat(40),
        branch: "main",
        status: " M file.ts",
        remoteUrl: "https://example.invalid/repo.git",
      }),
      expectedSha: sha,
      expectedBranch: "codex/example",
      policy,
      repoRoot: "/tmp/source-handoff",
    });
    expect(result.state).toBe("blocked");
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "head_sha_mismatch",
      "branch_mismatch",
      "dirty_checkout",
      "canonical_remote_mismatch",
    ]);
  });

  it("redacts credentials from remote diagnostics", () => {
    const result = evaluateSourceHandoffPreflight({
      state: state({ remoteUrl: "https://token:super-secret@github.com/other/repo.git" }),
      expectedSha: sha,
      expectedBranch: "codex/example",
      policy,
      repoRoot: "/tmp/source-handoff",
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(result)).toContain("<redacted>");
  });

  it("requires an exact destination approval before push or PR lookup mutation", () => {
    const runner = runnerFor();
    const result = runSourceHandoff({
      operation: "finish",
      repoRoot: "/tmp/source-handoff",
      policy,
      expectedSha: sha,
      expectedBranch: "codex/example",
      runCommand: runner,
    });
    expect(result).toMatchObject({ state: "destination_approval_required", passed: false });
    expect(result.blockers[0]?.code).toBe("destination_approval_required");
    expect(runner).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["push"]),
      expect.anything(),
    );
  });

  it("is idempotent when the exact draft PR already exists", () => {
    const runner = runnerFor({
      prs: [
        {
          number: 99,
          url: "https://github.com/mindfire-lab/openclaw/pull/99",
          state: "OPEN",
          isDraft: true,
          headRefOid: sha,
          headRefName: "codex/example",
          baseRefName: "main",
        },
      ],
    });
    const result = runSourceHandoff({
      operation: "finish",
      repoRoot: "/tmp/source-handoff",
      policy,
      expectedSha: sha,
      expectedBranch: "codex/example",
      destinationApproval: "https://github.com/SnowBelt/openclaw.git",
      runCommand: runner,
    });
    expect(result).toMatchObject({
      state: "draft_pr_ready",
      passed: true,
      pullRequest: { number: 99 },
    });
    expect(runner).toHaveBeenCalledWith(
      "git",
      ["push", "--set-upstream", "SnowBelt", "codex/example"],
      "/tmp/source-handoff",
    );
    expect(runner).not.toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["create"]),
      "/tmp/source-handoff",
    );
  });

  it("fails closed on an existing PR with a different source SHA", () => {
    const runner = runnerFor({
      prs: [
        {
          number: 99,
          url: "https://github.com/mindfire-lab/openclaw/pull/99",
          state: "OPEN",
          isDraft: true,
          headRefOid: "c".repeat(40),
          headRefName: "codex/example",
          baseRefName: "main",
        },
      ],
    });
    const result = runSourceHandoff({
      operation: "finish",
      repoRoot: "/tmp/source-handoff",
      policy,
      expectedSha: sha,
      expectedBranch: "codex/example",
      destinationApproval: "https://github.com/SnowBelt/openclaw.git",
      runCommand: runner,
    });
    expect(result).toMatchObject({ state: "blocked", passed: false });
    expect(result.blockers[0]?.code).toBe("pull_request_source_mismatch");
  });

  it("creates and then re-reads a missing draft PR before reporting success", () => {
    let listCalls = 0;
    const runner = vi.fn((command: string, args: string[]) => {
      if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel")
        return { status: 0, stdout: "/tmp/source-handoff\n", stderr: "" };
      if (command === "git" && args[0] === "rev-parse")
        return { status: 0, stdout: `${sha}\n`, stderr: "" };
      if (command === "git" && args[0] === "branch")
        return { status: 0, stdout: "codex/example\n", stderr: "" };
      if (command === "git" && args[0] === "status") return { status: 0, stdout: "", stderr: "" };
      if (command === "git" && args[0] === "remote")
        return { status: 0, stdout: "https://github.com/SnowBelt/openclaw.git\n", stderr: "" };
      if (command === "git" && args[0] === "push")
        return { status: 0, stdout: "pushed\n", stderr: "" };
      if (command === "gh" && args[0] === "pr" && args[1] === "list") {
        listCalls += 1;
        return {
          status: 0,
          stdout:
            listCalls <= 2
              ? "[]"
              : JSON.stringify([
                  {
                    number: 101,
                    url: "https://github.com/mindfire-lab/openclaw/pull/101",
                    state: "OPEN",
                    isDraft: true,
                    headRefOid: sha,
                    headRefName: "codex/example",
                    baseRefName: "main",
                  },
                ]),
          stderr: "",
        };
      }
      if (command === "gh" && args[0] === "pr" && args[1] === "create")
        return { status: 0, stdout: "created\n", stderr: "" };
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    });
    const result = runSourceHandoff({
      operation: "finish",
      repoRoot: "/tmp/source-handoff",
      policy,
      expectedSha: sha,
      expectedBranch: "codex/example",
      destinationApproval: "https://github.com/SnowBelt/openclaw.git",
      runCommand: runner,
    });
    expect(result).toMatchObject({
      state: "draft_pr_ready",
      passed: true,
      pullRequest: { number: 101 },
    });
    expect(listCalls).toBe(3);
  });
});
