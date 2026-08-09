import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureReleaseLocalProof, createReleaseLocalProofReceipt } from "./local-proof.js";

const CANDIDATE_SHA = "a".repeat(40);
const VERIFIER_SHA = "b".repeat(64);
const roots: string[] = [];

const candidateReceiptFields = {
  proofProfileVersion: 2,
  proofPhase: "candidate" as const,
  activeRuntimeSha: null,
  verifierSha256: VERIFIER_SHA,
  browserArtifactSha256: null,
};

function commandForNode(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

function makeRoot(): string {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "openclaw-release-local-proof-"),
  );
  fs.chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("release local proof capture", () => {
  it("creates the canonical receipt contract", () => {
    expect(
      createReleaseLocalProofReceipt({
        candidateSha: CANDIDATE_SHA,
        proofProfile: "mac_studio_control_director",
        ...candidateReceiptFields,
        checkId: "source_typecheck",
        command: "pnpm tsgo",
      }),
    ).toEqual({
      schema: "openclaw.release-local-proof.v2",
      candidateSha: CANDIDATE_SHA,
      proofProfile: "mac_studio_control_director",
      ...candidateReceiptFields,
      checkId: "source_typecheck",
      command: "pnpm tsgo",
      result: "passed",
    });
  });

  it("executes a passing command before writing a private receipt", () => {
    const root = makeRoot();
    const output = path.join(root, "source-typecheck.json");
    const command = commandForNode("process.exit(0)");

    const captured = captureReleaseLocalProof({
      candidateSha: CANDIDATE_SHA,
      proofProfile: "mac_studio_control_director",
      ...candidateReceiptFields,
      checkId: "source_typecheck",
      command,
      output,
      timeoutMs: 10_000,
    });

    expect(captured.output).toBe(output);
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toEqual(captured.receipt);
    expect(fs.statSync(output).mode & 0o777).toBe(0o600);
  });

  it("fails closed without writing a receipt when the command fails", () => {
    const root = makeRoot();
    const output = path.join(root, "failed.json");

    expect(() =>
      captureReleaseLocalProof({
        candidateSha: CANDIDATE_SHA,
        proofProfile: "mac_studio_control_director",
        ...candidateReceiptFields,
        checkId: "source_typecheck",
        command: commandForNode("process.exit(7)"),
        output,
        timeoutMs: 10_000,
      }),
    ).toThrow(/exit status 7/u);
    expect(fs.existsSync(output)).toBe(false);
  });

  it("rejects an existing output instead of replacing it", () => {
    const root = makeRoot();
    const output = path.join(root, "existing.json");
    fs.writeFileSync(output, "existing\n", { mode: 0o600 });

    expect(() =>
      captureReleaseLocalProof({
        candidateSha: CANDIDATE_SHA,
        proofProfile: "mac_studio_control_director",
        ...candidateReceiptFields,
        checkId: "source_typecheck",
        command: commandForNode("process.exit(0)"),
        output,
        timeoutMs: 10_000,
      }),
    ).toThrow(/already exists/u);
    expect(fs.readFileSync(output, "utf8")).toBe("existing\n");
  });
});
