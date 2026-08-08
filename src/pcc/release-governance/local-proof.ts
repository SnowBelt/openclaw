import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  isReleaseProofPhase,
  validateBrowserProofReceiptBinding,
  type ReleaseProofPhase,
} from "./browser-proof-contract.js";
import {
  RELEASE_LOCAL_PROOF_SCHEMA,
  type ReleaseLocalProofReceipt,
  type ReleaseProofProfile,
} from "./contracts.js";

const SHA_PATTERN = /^[a-f0-9]{40,64}$/u;
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const PROOF_PROFILES = new Set<ReleaseProofProfile>(["default", "mac_studio_control_director"]);
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;

export type CaptureReleaseLocalProofParams = {
  candidateSha: string;
  proofProfile: ReleaseProofProfile;
  proofProfileVersion: number;
  proofPhase: ReleaseProofPhase;
  activeRuntimeSha: string | null;
  checkId: string;
  command: string;
  output: string;
  verifierSha256: string;
  browserArtifactSha256: string | null;
  cwd?: string;
  timeoutMs?: number;
};

export type CapturedReleaseLocalProof = {
  output: string;
  receipt: ReleaseLocalProofReceipt;
};

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT",
  );
}

function requireValidParams(params: CaptureReleaseLocalProofParams): void {
  if (!SHA_PATTERN.test(params.candidateSha)) {
    throw new Error("Release local proof candidate SHA must be a lowercase 40-64 character SHA.");
  }
  if (!PROOF_PROFILES.has(params.proofProfile)) {
    throw new Error(`Unsupported release local proof profile: ${params.proofProfile}.`);
  }
  if (!isReleaseProofPhase(params.proofPhase)) {
    throw new Error(`Unsupported release local proof phase: ${String(params.proofPhase)}.`);
  }
  if (!CHECK_ID_PATTERN.test(params.checkId)) {
    throw new Error(`Invalid release local proof check ID: ${params.checkId}.`);
  }
  if (!params.command.trim()) {
    throw new Error("Release local proof command must not be empty.");
  }
  if (!params.output.trim()) {
    throw new Error("Release local proof output path must not be empty.");
  }
  const bindingErrors = validateBrowserProofReceiptBinding({
    candidateSha: params.candidateSha,
    activeRuntimeSha: params.activeRuntimeSha,
    proofProfile: params.proofProfile,
    proofProfileVersion: params.proofProfileVersion,
    proofPhase: params.proofPhase,
    checkId: params.checkId,
    verifierSha256: params.verifierSha256,
    browserArtifactSha256: params.browserArtifactSha256,
  });
  if (bindingErrors.length > 0) {
    throw new Error(bindingErrors.join("\n"));
  }
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(
      `Release local proof timeout must be an integer from 1 to ${MAX_TIMEOUT_MS} ms.`,
    );
  }
}

export function createReleaseLocalProofReceipt(params: {
  candidateSha: string;
  proofProfile: ReleaseProofProfile;
  proofProfileVersion: number;
  proofPhase: ReleaseProofPhase;
  activeRuntimeSha: string | null;
  checkId: string;
  command: string;
  verifierSha256: string;
  browserArtifactSha256: string | null;
}): ReleaseLocalProofReceipt {
  requireValidParams({ ...params, output: "receipt.json" });
  return {
    schema: RELEASE_LOCAL_PROOF_SCHEMA,
    candidateSha: params.candidateSha,
    proofProfile: params.proofProfile,
    proofProfileVersion: params.proofProfileVersion,
    proofPhase: params.proofPhase,
    activeRuntimeSha: params.activeRuntimeSha,
    checkId: params.checkId,
    command: params.command,
    verifierSha256: params.verifierSha256,
    browserArtifactSha256: params.browserArtifactSha256,
    result: "passed",
  };
}

function ensurePrivateOutputDirectory(output: string): string {
  const outputPath = path.resolve(output);
  const parent = path.dirname(outputPath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error("Release local proof output directory must be a regular directory.");
  }
  if (fs.realpathSync(parent) !== parent) {
    throw new Error("Release local proof output directory must not contain symlink traversal.");
  }
  if ((parentStat.mode & 0o077) !== 0) {
    throw new Error("Release local proof output directory must be private.");
  }
  try {
    const outputStat = fs.lstatSync(outputPath);
    if (outputStat.isSymbolicLink() || !outputStat.isFile()) {
      throw new Error("Release local proof output must be a regular file.");
    }
    throw new Error(`Release local proof output already exists: ${outputPath}.`);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
  return outputPath;
}

function writeReceipt(output: string, receipt: ReleaseLocalProofReceipt): void {
  const temporary = `${output}.tmp-${process.pid}-${Date.now()}`;
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  try {
    fs.writeFileSync(temporary, serialized, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, output);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function captureReleaseLocalProof(
  params: CaptureReleaseLocalProofParams,
): CapturedReleaseLocalProof {
  requireValidParams(params);
  const output = ensurePrivateOutputDirectory(params.output);
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const result = spawnSync(params.command, {
    cwd: params.cwd ?? process.cwd(),
    shell: true,
    stdio: "inherit",
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
  if (result.error) {
    throw new Error(`Release local proof command failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const reason = result.signal ? `signal ${result.signal}` : `exit status ${result.status}`;
    throw new Error(`Release local proof command failed with ${reason}.`);
  }
  const receipt = createReleaseLocalProofReceipt(params);
  writeReceipt(output, receipt);
  return { output, receipt };
}
