import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const WORKFLOW_PATH = ".github/workflows/operations-room-proof.yml";
const EXPECTED_SHA_EXPRESSION = "${{ inputs.expected_sha || github.sha }}";
const TARGET_REF_EXPRESSION = "${{ inputs.target_ref || github.ref_name }}";

function readWorkflow() {
  return parse(readFileSync(WORKFLOW_PATH, "utf8"));
}

describe("Operations Room proof workflow", () => {
  it("binds recovery-branch pushes and manual dispatches to an exact candidate", () => {
    const workflow = readWorkflow();
    const job = workflow.jobs["operations-room-proof"];
    const checkout = job.steps.find(
      (step: { name?: string }) => step.name === "Checkout candidate",
    );
    const verifyIdentity = job.steps.find(
      (step: { name?: string }) => step.name === "Verify exact candidate identity",
    );
    const canonical = job.steps.find(
      (step: { name?: string }) => step.name === "Run canonical Operations Room verification",
    );
    const validateBrowser = job.steps.find(
      (step: { name?: string }) => step.name === "Validate browser proof receipt",
    );
    const writeReceipt = job.steps.find(
      (step: { name?: string }) => step.name === "Write exact-SHA workflow receipt",
    );
    const uploadReceipt = job.steps.find(
      (step: { name?: string }) => step.name === "Upload Operations Room proof receipts",
    );

    expect(workflow.on.push.branches).toEqual(["codex/operations-room-recovery-*"]);
    expect(workflow.on.workflow_dispatch.inputs.expected_sha.required).toBe(true);
    expect(workflow["run-name"]).toContain(EXPECTED_SHA_EXPRESSION);
    expect(workflow.concurrency.group).toContain(EXPECTED_SHA_EXPRESSION);
    expect(checkout.with.ref).toBe("${{ inputs.target_ref || github.sha }}");
    expect(verifyIdentity.env).toMatchObject({
      EXPECTED_SHA: EXPECTED_SHA_EXPRESSION,
      TARGET_REF: TARGET_REF_EXPRESSION,
    });
    expect(canonical.env).toMatchObject({
      GITHUB_REF_NAME: TARGET_REF_EXPRESSION,
      GITHUB_SHA: EXPECTED_SHA_EXPRESSION,
    });
    expect(validateBrowser.env).toMatchObject({
      EXPECTED_SHA: EXPECTED_SHA_EXPRESSION,
      TARGET_REF: TARGET_REF_EXPRESSION,
    });
    expect(writeReceipt.env).toMatchObject({
      EXPECTED_SHA: EXPECTED_SHA_EXPRESSION,
      TARGET_REF: TARGET_REF_EXPRESSION,
    });
    expect(uploadReceipt.with.name).toBe(
      `operations-room-v2-proof-receipts-${EXPECTED_SHA_EXPRESSION}`,
    );
  });
});
