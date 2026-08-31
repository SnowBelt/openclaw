import { describe, expect, it } from "vitest";
import {
  assertPublishedBranch,
  assertExactTargetCheckoutLog,
  assertSuccessfulRun,
  assertGithubHostedManualDispatchWorkflow,
  parseDispatchedRunId,
  selectDispatchedRun,
} from "../../scripts/custom-runtime/custom-runtime-update-github-proof.mjs";

const sha = "a".repeat(40);
const branch = "codex/runtime-update-20260829T120000Z";
const workflowRef = "codex/runtime-update-test-workflow";
const workflowSha = "b".repeat(40);

function successfulRun() {
  return {
    databaseId: 123,
    headBranch: workflowRef,
    headSha: workflowSha,
    status: "completed",
    conclusion: "success",
    workflowName: "CI",
    createdAt: "2026-08-29T12:00:01.000Z",
    updatedAt: "2026-08-29T12:10:00.000Z",
    url: "https://github.com/SnowBelt/openclaw/actions/runs/123",
    jobs: [
      { name: "runner-admission", conclusion: "success" },
      { name: "preflight", conclusion: "success" },
      { name: "checks-fast-core", conclusion: "success" },
      { name: "android", conclusion: "skipped" },
    ],
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

  it("requires the run URL returned by the trusted dispatch", () => {
    expect(parseDispatchedRunId("https://github.com/mindfire-lab/openclaw/actions/runs/123")).toBe(
      123,
    );
    expect(() =>
      parseDispatchedRunId("https://github.com/mindfire-lab/openclaw/actions/runs/"),
    ).toThrow(/did not return a run URL/u);
    expect(() => parseDispatchedRunId("https://example.com/actions/runs/123")).toThrow(
      /did not return a run URL/u,
    );
  });

  it("accepts only successful trusted-workflow jobs", () => {
    expect(() => assertSuccessfulRun(successfulRun(), workflowSha, workflowRef)).not.toThrow();
    expect(() =>
      assertSuccessfulRun(
        {
          ...successfulRun(),
          jobs: [
            { name: "runner-admission", conclusion: "success" },
            { name: "preflight", conclusion: "success" },
            { name: "proof", conclusion: "failure" },
          ],
        },
        workflowSha,
        workflowRef,
      ),
    ).toThrow(/contains an unsuccessful job/u);
    expect(() =>
      assertSuccessfulRun(
        {
          ...successfulRun(),
          jobs: [
            { name: "preflight", conclusion: "success" },
            { name: "ci-timings-summary", conclusion: "success" },
          ],
        },
        workflowSha,
        workflowRef,
      ),
    ).not.toThrow();
    expect(() =>
      assertSuccessfulRun({ ...successfulRun(), jobs: [] }, workflowSha, workflowRef),
    ).toThrow(/contains no jobs/u);
    expect(() => assertSuccessfulRun(successfulRun(), sha, workflowRef)).toThrow(
      /not a successful trusted workflow run/u,
    );
    expect(() => assertSuccessfulRun(successfulRun(), workflowSha, branch)).toThrow(
      /not a successful trusted workflow run/u,
    );
  });

  it("requires the trusted preflight log to prove the exact candidate checkout", () => {
    const checkoutLog = [`preflight\tCheckout\t * [new ref] ${sha} -> origin/checkout`].join("\n");
    expect(() => assertExactTargetCheckoutLog(checkoutLog, sha)).not.toThrow();
    expect(() =>
      assertExactTargetCheckoutLog(
        `${checkoutLog}\nworkflow_dispatch target_ref '${sha}' is unavailable; falling back to head SHA`,
        sha,
      ),
    ).toThrow(/fell back/u);
    expect(() => assertExactTargetCheckoutLog(`CHECKOUT_REF: ${sha}`, sha)).toThrow(
      /does not prove/u,
    );
    expect(() =>
      assertExactTargetCheckoutLog(
        `preflight\tCheckout\tCHECKOUT_REF: ${"b".repeat(40)}\npreflight\tCheckout\t * [new ref] ${"b".repeat(40)} -> origin/checkout`,
        sha,
      ),
    ).toThrow(/does not prove/u);
  });

  it("accepts only workflows with hosted manual-dispatch runner branches", () => {
    expect(() =>
      assertGithubHostedManualDispatchWorkflow(`
        on:
          workflow_dispatch:
        jobs:
          check:
            runs-on: \${{ github.event_name == 'workflow_dispatch' && 'ubuntu-24.04' || 'blacksmith-4vcpu-ubuntu-2404' }}
      `),
    ).not.toThrow();
    expect(() =>
      assertGithubHostedManualDispatchWorkflow(`
        on:
          workflow_dispatch:
        jobs:
          check:
            runs-on: blacksmith-4vcpu-ubuntu-2404
      `),
    ).toThrow(/prohibited runner/u);
    expect(() =>
      assertGithubHostedManualDispatchWorkflow(`
        on:
          workflow_dispatch:
        jobs:
          check:
            runs-on: self-hosted
      `),
    ).toThrow(/unrecognized runner/u);
  });

  it("discovers one newly dispatched trusted run when the CLI omits its URL", () => {
    const dispatchedAtMs = Date.parse("2026-08-29T12:00:00.000Z");
    const runInfo = {
      ...successfulRun(),
      createdAt: "2026-08-29T12:00:01.000Z",
    };
    expect(
      selectDispatchedRun([runInfo], {
        workflowRef,
        workflowSha,
        dispatchedAtMs,
        beforeRunIds: new Set(["122"]),
      }),
    ).toBe(runInfo);
    expect(
      selectDispatchedRun([runInfo], {
        workflowRef,
        workflowSha,
        dispatchedAtMs,
        beforeRunIds: new Set(["123"]),
      }),
    ).toBeNull();
    expect(() =>
      selectDispatchedRun([runInfo, { ...runInfo, databaseId: 124 }], {
        workflowRef,
        workflowSha,
        dispatchedAtMs,
        beforeRunIds: new Set(),
      }),
    ).toThrow(/multiple ambiguous/u);
  });
});
