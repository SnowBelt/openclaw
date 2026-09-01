import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSuccessfulRun,
  exactRun,
  validateIdentity,
} from "../../scripts/custom-runtime/custom-runtime-update-github-proof.mjs";

const sha = "a".repeat(40);
const branch = "codex/runtime-update-20260829T120000Z";
const trustedWorkflowRef = "main";
const temporaryDirectories: string[] = [];

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "OpenClaw GitHub Proof Test",
      GIT_AUTHOR_EMAIL: "github-proof-test@localhost",
      GIT_COMMITTER_NAME: "OpenClaw GitHub Proof Test",
      GIT_COMMITTER_EMAIL: "github-proof-test@localhost",
    },
  }).trim();
}

function createRepository(): { root: string; sha: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-github-proof-test-"));
  temporaryDirectories.push(root);
  runGit(root, ["init", "-q"]);
  runGit(root, ["config", "user.name", "OpenClaw GitHub Proof Test"]);
  runGit(root, ["config", "user.email", "github-proof-test@localhost"]);
  fs.writeFileSync(path.join(root, "README.md"), "proof\n");
  runGit(root, ["add", "README.md"]);
  runGit(root, ["commit", "-qm", "proof fixture"]);
  runGit(root, ["switch", "-qc", branch]);
  return { root, sha: runGit(root, ["rev-parse", "HEAD"]) };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function successfulRun() {
  return {
    databaseId: 123,
    headBranch: trustedWorkflowRef,
    headSha: "b".repeat(40),
    status: "completed",
    conclusion: "success",
    workflowName: "Control Director Reliability",
    displayTitle: `Control Director Reliability / ${sha} / ${branch}`,
    event: "workflow_dispatch",
    createdAt: "2026-08-29T12:00:01.000Z",
    updatedAt: "2026-08-29T12:10:00.000Z",
    url: "https://github.com/SnowBelt/openclaw/actions/runs/123",
    jobs: [{ name: "Exact-source Control Director proof", conclusion: "success" }],
  };
}

describe("custom runtime repository-native GitHub proof", () => {
  it("accepts only a clean standalone attached checkout", () => {
    const repository = createRepository();
    expect(validateIdentity({ source: repository.root, sha: repository.sha, branch })).toBe(
      fs.realpathSync(repository.root),
    );
  });

  it("rejects a detached checkout before publication", () => {
    const repository = createRepository();
    runGit(repository.root, ["checkout", "--detach", "HEAD"]);
    expect(() =>
      validateIdentity({ source: repository.root, sha: repository.sha, branch }),
    ).toThrow(/attached branch checkout/u);
  });

  it("rejects a linked worktree before publication", () => {
    const repository = createRepository();
    const linked = path.join(path.dirname(repository.root), "openclaw-github-proof-linked");
    runGit(repository.root, ["worktree", "add", "--detach", linked, repository.sha]);
    temporaryDirectories.push(linked);
    expect(() => validateIdentity({ source: linked, sha: repository.sha, branch })).toThrow(
      /standalone Git checkout/u,
    );
    runGit(repository.root, ["worktree", "remove", "--force", linked]);
  });

  it("selects exactly one newly dispatched run for the candidate SHA", () => {
    const selected = exactRun(
      [
        successfulRun(),
        {
          ...successfulRun(),
          databaseId: 122,
          displayTitle: `Control Director Reliability / ${"b".repeat(40)} / ${branch}`,
        },
      ],
      sha,
      branch,
      trustedWorkflowRef,
      Date.parse("2026-08-29T12:00:00.000Z"),
    );

    expect(selected.databaseId).toBe(123);
  });

  it("rejects ambiguous exact-SHA runs", () => {
    expect(() =>
      exactRun(
        [successfulRun(), { ...successfulRun(), databaseId: 124 }],
        sha,
        branch,
        trustedWorkflowRef,
        Date.parse("2026-08-29T12:00:00.000Z"),
      ),
    ).toThrow(/exactly one/u);
  });

  it("accepts only successful exact-branch jobs", () => {
    expect(() =>
      assertSuccessfulRun(successfulRun(), sha, branch, trustedWorkflowRef),
    ).not.toThrow();
    expect(() =>
      assertSuccessfulRun(
        { ...successfulRun(), jobs: [{ name: "proof", conclusion: "failure" }] },
        sha,
        branch,
        trustedWorkflowRef,
      ),
    ).toThrow(/missing or unsuccessful job/u);
    expect(() =>
      assertSuccessfulRun(successfulRun(), sha, `${branch}-other`, trustedWorkflowRef),
    ).toThrow(/not a successful exact-SHA run/u);
    expect(() =>
      assertSuccessfulRun(
        { ...successfulRun(), headBranch: branch },
        sha,
        branch,
        trustedWorkflowRef,
      ),
    ).toThrow(/not a successful exact-SHA run/u);
    expect(() =>
      assertSuccessfulRun(
        { ...successfulRun(), headSha: "not-a-sha" },
        sha,
        branch,
        trustedWorkflowRef,
      ),
    ).toThrow(/not a successful exact-SHA run/u);
  });
});
