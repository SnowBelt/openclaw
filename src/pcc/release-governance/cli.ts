#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import type { ReleaseProofPhase } from "./browser-proof-contract.js";
import type {
  ReleaseEvidenceBundle,
  ReleaseEvidenceBundleInput,
  ReleaseGovernorInput,
  ReleaseOperation,
  ReleaseProofProfile,
} from "./contracts.js";
import {
  canonicalReleaseJson,
  createReleaseEvidenceBundle,
  verifyReleaseEvidenceAuthorization,
  verifyReleaseRuntimeArtifacts,
} from "./evidence.js";
import { evaluateReleaseGovernor } from "./governor.js";
import { createReleaseLedgerPreflightReceipt, recordReleaseEvidenceInPccLedger } from "./ledger.js";
import { captureReleaseLocalProof } from "./local-proof.js";
import { readReleaseGovernorPolicy } from "./policy.js";
import { readReleaseGovernanceStatus, writeReleaseEvidenceBundle } from "./store.js";

type Arguments = { command: string; values: Map<string, string | true> };

function parseArguments(argv: string[]): Arguments {
  const [command = "help", ...rest] = argv;
  const values = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected argument: ${value}`);
    }
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(value.slice(2), true);
    } else {
      values.set(value.slice(2), next);
      index += 1;
    }
  }
  return { command, values };
}

function stringValue(args: Arguments, name: string, required = true): string | null {
  const value = args.values.get(name);
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (required) {
    throw new Error(`Missing --${name}.`);
  }
  return null;
}

function readJson(target: string): unknown {
  return JSON.parse(fs.readFileSync(target, "utf8")) as unknown;
}

function writeJson(target: string | null, value: unknown): void {
  const contents = canonicalReleaseJson(value);
  if (!target || target === "-") {
    process.stdout.write(contents);
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}

function operationValue(args: Arguments): ReleaseOperation {
  const value = stringValue(args, "operation");
  if (!value || !["stage", "promotion", "restart", "rollback", "finalize"].includes(value)) {
    throw new Error(`Invalid release operation: ${String(value)}.`);
  }
  return value as ReleaseOperation;
}

function evaluate(args: Arguments): void {
  const input = readJson(stringValue(args, "input")!) as ReleaseGovernorInput;
  const policy = readReleaseGovernorPolicy(stringValue(args, "policy", false) ?? undefined);
  writeJson(stringValue(args, "output", false), evaluateReleaseGovernor(input, policy));
}

function bundle(args: Arguments): void {
  const input = readJson(stringValue(args, "input")!) as ReleaseEvidenceBundleInput;
  const evidence = createReleaseEvidenceBundle(input);
  const output = stringValue(args, "output", false);
  if (output) {
    writeJson(output, evidence);
    return;
  }
  const stored = writeReleaseEvidenceBundle(evidence);
  writeJson(null, { ...stored, receiptHash: evidence.receiptHash });
}

function verify(args: Arguments): void {
  const evidence = readJson(stringValue(args, "bundle")!) as ReleaseEvidenceBundle;
  const operation = operationValue(args);
  const candidateSha = stringValue(args, "candidate-sha")!;
  const policy = readReleaseGovernorPolicy(stringValue(args, "policy", false) ?? undefined);
  const releaseRoot = stringValue(args, "release")!;
  const errors = verifyReleaseEvidenceAuthorization({
    bundle: evidence,
    policy,
    now: new Date().toISOString(),
  });
  errors.push(...verifyReleaseRuntimeArtifacts({ bundle: evidence, releaseRoot }));
  if (evidence.facts.candidateSha !== candidateSha) {
    errors.push(
      `Evidence candidate ${evidence.facts.candidateSha} does not match ${candidateSha}.`,
    );
  }
  if (evidence.evaluation.decision.operation !== operation) {
    errors.push(
      `Evidence operation ${evidence.evaluation.decision.operation} does not match ${operation}.`,
    );
  }
  if (evidence.evaluation.decision.policyVersion !== policy.version) {
    errors.push(
      `Evidence policy version ${evidence.evaluation.decision.policyVersion} does not match active version ${policy.version}.`,
    );
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  const stored = args.values.has("no-record") ? null : writeReleaseEvidenceBundle(evidence);
  writeJson(null, {
    authorized: true,
    candidateSha,
    operation,
    proofProfile: evidence.facts.proofProfile,
    proofPhase: evidence.facts.proofPhase,
    receiptHash: evidence.receiptHash,
    stored,
  });
}

function recordLedger(args: Arguments): void {
  const evidence = readJson(stringValue(args, "bundle")!) as ReleaseEvidenceBundle;
  const policy = readReleaseGovernorPolicy(stringValue(args, "policy", false) ?? undefined);
  const releaseRoot = stringValue(args, "release")!;
  const errors = verifyReleaseEvidenceAuthorization({
    bundle: evidence,
    policy,
    now: new Date().toISOString(),
  });
  errors.push(...verifyReleaseRuntimeArtifacts({ bundle: evidence, releaseRoot }));
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  writeJson(null, recordReleaseEvidenceInPccLedger(evidence));
}

function preflightLedger(args: Arguments): void {
  writeJson(
    stringValue(args, "output", false),
    createReleaseLedgerPreflightReceipt({ candidateSha: stringValue(args, "candidate-sha")! }),
  );
}

function captureProof(args: Arguments): void {
  const timeout = stringValue(args, "timeout-ms", false);
  const result = captureReleaseLocalProof({
    candidateSha: stringValue(args, "candidate-sha")!,
    proofProfile: stringValue(args, "proof-profile") as ReleaseProofProfile,
    proofProfileVersion: Number(stringValue(args, "proof-profile-version")),
    proofPhase: stringValue(args, "proof-phase") as ReleaseProofPhase,
    activeRuntimeSha: stringValue(args, "active-runtime-sha", false),
    checkId: stringValue(args, "check-id")!,
    command: stringValue(args, "command")!,
    output: stringValue(args, "output")!,
    verifierSha256: stringValue(args, "verifier-sha256")!,
    browserArtifactSha256: stringValue(args, "browser-artifact-sha256", false),
    cwd: stringValue(args, "cwd", false) ?? undefined,
    timeoutMs: timeout ? Number(timeout) : undefined,
  });
  writeJson(null, result.receipt);
}

function main(): void {
  const args = parseArguments(process.argv.slice(2));
  switch (args.command) {
    case "evaluate":
      evaluate(args);
      return;
    case "bundle":
      bundle(args);
      return;
    case "verify":
      verify(args);
      return;
    case "ledger-record":
      recordLedger(args);
      return;
    case "ledger-preflight":
      preflightLedger(args);
      return;
    case "capture-proof":
      captureProof(args);
      return;
    case "status":
      writeJson(null, readReleaseGovernanceStatus());
      return;
    default:
      process.stderr.write(
        "usage: release-governor <evaluate|bundle|verify|capture-proof|status|ledger-preflight|ledger-record> [options]\n",
      );
      process.exitCode = 64;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `Release Governor blocked: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
