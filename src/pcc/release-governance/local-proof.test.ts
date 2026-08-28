import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureReleaseLocalProof,
  createReleaseLocalModelCompatibilityReceipt,
  createReleaseLocalProofReceipt,
} from "./local-proof.js";

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

  it("creates a hash-bound local-model compatibility receipt", () => {
    const receipt = createReleaseLocalModelCompatibilityReceipt({
      candidateSha: CANDIDATE_SHA,
      proofProfile: "mac_studio_control_director",
      ...candidateReceiptFields,
      command: "patternlab local-model smoke",
      recordedAt: "2026-07-15T12:00:20.000Z",
      localModelCompatibility: {
        operation: "isolated_local_model_compatibility",
        candidateReleaseId: "candidate-release",
        sourceCommit: CANDIDATE_SHA,
        sourceSha256: "c".repeat(64),
        artifactSha256: "d".repeat(64),
        runtimeClosureSha256: "e".repeat(64),
        manifestSha256: "f".repeat(64),
        activeRuntimeBaselineSha256: "1".repeat(64),
        configuredModel: "qwen3.6:27b-q8_0",
        configuredModelSha256: "2".repeat(64),
        promptSha256: "3".repeat(64),
        responseSha256: "4".repeat(64),
        responseMarker: "PATTERNLAB_RUNTIME_COMPAT_OK",
        resourceAdmissionSamples: [
          {
            observedAt: "2026-07-15T12:00:00.000Z",
            activeOpenClawWorkerCount: 0,
            activeOllamaClientCount: 0,
          },
          {
            observedAt: "2026-07-15T12:00:05.000Z",
            activeOpenClawWorkerCount: 0,
            activeOllamaClientCount: 0,
          },
          {
            observedAt: "2026-07-15T12:00:10.000Z",
            activeOpenClawWorkerCount: 0,
            activeOllamaClientCount: 0,
          },
        ],
        ownedProcessCleanup: true,
        warnings: [],
        proofOrder: ["resource_admission", "process_spawn", "response", "owned_process_cleanup"],
        startedAt: "2026-07-15T12:00:00.000Z",
        completedAt: "2026-07-15T12:00:15.000Z",
      },
    });
    expect(receipt.localModelCompatibility?.responseMarker).toBe("PATTERNLAB_RUNTIME_COMPAT_OK");
    expect(receipt.recordedAt).toBe("2026-07-15T12:00:20.000Z");
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
