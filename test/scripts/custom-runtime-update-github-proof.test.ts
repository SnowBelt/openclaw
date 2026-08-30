import { describe, expect, it } from "vitest";
import {
  assertPublishedBranch,
  assertSuccessfulRun,
  exactRun,
} from "../../scripts/custom-runtime/custom-runtime-update-github-proof.mjs";

const sha = "a".repeat(40);
const branch = "codex/runtime-update-20260829T120000Z";

function successfulRun() {
  return {
    databaseId: 123,
    headBranch: branch,
    headSha: sha,
    status: "completed",
    conclusion: "success",
    workflowName: "Control Director Reliability",
    createdAt: "2026-08-29T12:00:01.000Z",
    updatedAt: "2026-08-29T12:10:00.000Z",
    url: "https://github.com/SnowBelt/openclaw/actions/runs/123",
    jobs: [{ name: "Exact-source Control Director proof", conclusion: "success" }],
  };
}

describe("custom runtime repository-native GitHub proof", () => {
  it("accepts only the exact current managed branch ref", () => {
    expect(() => assertPublishedBranch(`${sha}\trefs/heads/${branch}`, sha, branch)).not.toThrow();
    expect(() => assertPublishedBranch("", sha, branch)).toThrow(/does not resolve/u);
    expect(() =>
      assertPublishedBranch(`${"b".repeat(40)}\trefs/heads/${branch}`, sha, branch),
    ).toThrow(/does not resolve/u);
    expect(() => assertPublishedBranch(`${sha}\trefs/heads/${branch}-moved`, sha, branch)).toThrow(
      /does not resolve/u,
    );
  });

  it("selects exactly one newly dispatched run for the candidate SHA", () => {
    const selected = exactRun(
      [successfulRun(), { ...successfulRun(), databaseId: 122, headSha: "b".repeat(40) }],
      sha,
      Date.parse("2026-08-29T12:00:00.000Z"),
    );

    expect(selected.databaseId).toBe(123);
  });

  it("rejects ambiguous exact-SHA runs", () => {
    expect(() =>
      exactRun(
        [successfulRun(), { ...successfulRun(), databaseId: 124 }],
        sha,
        Date.parse("2026-08-29T12:00:00.000Z"),
      ),
    ).toThrow(/exactly one/u);
  });

  it("accepts only successful exact-branch jobs", () => {
    expect(() => assertSuccessfulRun(successfulRun(), sha, branch)).not.toThrow();
    expect(() =>
      assertSuccessfulRun(
        { ...successfulRun(), jobs: [{ name: "proof", conclusion: "failure" }] },
        sha,
        branch,
      ),
    ).toThrow(/missing or unsuccessful job/u);
    expect(() => assertSuccessfulRun({ ...successfulRun(), jobs: [] }, sha, branch)).toThrow(
      /missing or unsuccessful job/u,
    );
    expect(() => assertSuccessfulRun(successfulRun(), sha, `${branch}-other`)).toThrow(
      /not a successful exact-SHA run/u,
    );
  });
});
