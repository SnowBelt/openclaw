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
  type ReleaseLocalModelCompatibilityProof,
  type ReleaseProofProfile,
} from "./contracts.js";

const SHA_PATTERN = /^[a-f0-9]{40,64}$/u;
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const PROOF_PROFILES = new Set<ReleaseProofProfile>(["default", "mac_studio_control_director"]);
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const RELEASE_LOCAL_MODEL_COMPATIBILITY_CHECK_ID =
  "isolated_local_model_compatibility" as const;
export const RELEASE_LOCAL_MODEL_COMPATIBILITY_RESPONSE = "PATTERNLAB_RUNTIME_COMPAT_OK" as const;
const LOCAL_MODEL_COMPATIBILITY_PROOF_ORDER = [
  "resource_admission",
  "process_spawn",
  "response",
  "owned_process_cleanup",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

/** Validate the immutable local-model proof payload before it enters a receipt. */
export function validateReleaseLocalModelCompatibilityProof(value: unknown): string[] {
  if (!isRecord(value)) {
    return ["Local model compatibility proof is not an object."];
  }
  const errors: string[] = [];
  if (value.operation !== RELEASE_LOCAL_MODEL_COMPATIBILITY_CHECK_ID) {
    errors.push("Local model compatibility proof operation is invalid.");
  }
  if (typeof value.candidateReleaseId !== "string" || !value.candidateReleaseId.trim()) {
    errors.push("Local model compatibility proof candidate release identity is missing.");
  }
  if (typeof value.sourceCommit !== "string" || !SHA_PATTERN.test(value.sourceCommit)) {
    errors.push("Local model compatibility proof source commit is invalid.");
  }
  for (const [key, label] of [
    ["sourceSha256", "source"],
    ["artifactSha256", "artifact"],
    ["runtimeClosureSha256", "runtime closure"],
    ["manifestSha256", "manifest"],
    ["activeRuntimeBaselineSha256", "active baseline"],
    ["configuredModelSha256", "configured model"],
    ["promptSha256", "prompt"],
    ["responseSha256", "response"],
  ] as const) {
    if (!isSha256(value[key])) {
      errors.push(`Local model compatibility proof ${label} hash is invalid.`);
    }
  }
  if (typeof value.configuredModel !== "string" || !value.configuredModel.trim()) {
    errors.push("Local model compatibility proof configured model is missing.");
  }
  if (value.responseMarker !== RELEASE_LOCAL_MODEL_COMPATIBILITY_RESPONSE) {
    errors.push("Local model compatibility proof response marker is invalid.");
  }
  if (
    !Array.isArray(value.resourceAdmissionSamples) ||
    value.resourceAdmissionSamples.length !== 3
  ) {
    errors.push("Local model compatibility proof must contain exactly three admission samples.");
  } else {
    let previousAt: number | undefined;
    for (const [index, sample] of value.resourceAdmissionSamples.entries()) {
      if (!isRecord(sample) || !isTimestamp(sample.observedAt)) {
        errors.push(
          `Local model compatibility admission sample ${index + 1} timestamp is invalid.`,
        );
        continue;
      }
      const observedAt = Date.parse(sample.observedAt);
      if (
        !Number.isInteger(sample.activeOpenClawWorkerCount) ||
        sample.activeOpenClawWorkerCount !== 0 ||
        !Number.isInteger(sample.activeOllamaClientCount) ||
        sample.activeOllamaClientCount !== 0
      ) {
        errors.push(`Local model compatibility admission sample ${index + 1} is not quiescent.`);
      }
      if (previousAt !== undefined && observedAt - previousAt < 5_000) {
        errors.push("Local model compatibility admission samples are not five seconds apart.");
      }
      previousAt = observedAt;
    }
  }
  if (value.ownedProcessCleanup !== true) {
    errors.push("Local model compatibility owned-process cleanup is not proven.");
  }
  if (!Array.isArray(value.warnings) || value.warnings.length !== 0) {
    errors.push("Local model compatibility proof contains warnings.");
  }
  if (
    !Array.isArray(value.proofOrder) ||
    value.proofOrder.length !== LOCAL_MODEL_COMPATIBILITY_PROOF_ORDER.length ||
    value.proofOrder.some((stage, index) => stage !== LOCAL_MODEL_COMPATIBILITY_PROOF_ORDER[index])
  ) {
    errors.push("Local model compatibility proof ordering is invalid.");
  }
  if (!isTimestamp(value.startedAt) || !isTimestamp(value.completedAt)) {
    errors.push("Local model compatibility proof timestamps are invalid.");
  } else if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    errors.push("Local model compatibility proof completed before it started.");
  }
  return errors;
}

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

export function createReleaseLocalModelCompatibilityReceipt(params: {
  candidateSha: string;
  proofProfile: ReleaseProofProfile;
  proofProfileVersion: number;
  proofPhase: ReleaseProofPhase;
  activeRuntimeSha: string | null;
  command: string;
  verifierSha256: string;
  browserArtifactSha256: string | null;
  recordedAt: string;
  localModelCompatibility: ReleaseLocalModelCompatibilityProof;
}): ReleaseLocalProofReceipt {
  const receipt = createReleaseLocalProofReceipt({
    candidateSha: params.candidateSha,
    proofProfile: params.proofProfile,
    proofProfileVersion: params.proofProfileVersion,
    proofPhase: params.proofPhase,
    activeRuntimeSha: params.activeRuntimeSha,
    checkId: RELEASE_LOCAL_MODEL_COMPATIBILITY_CHECK_ID,
    command: params.command,
    verifierSha256: params.verifierSha256,
    browserArtifactSha256: params.browserArtifactSha256,
  });
  const proofErrors = validateReleaseLocalModelCompatibilityProof(params.localModelCompatibility);
  if (proofErrors.length > 0) {
    throw new Error(proofErrors.join("\n"));
  }
  if (!isTimestamp(params.recordedAt)) {
    throw new Error("Local model compatibility receipt timestamp is invalid.");
  }
  if (Date.parse(params.recordedAt) < Date.parse(params.localModelCompatibility.completedAt)) {
    throw new Error("Local model compatibility receipt predates proof completion.");
  }
  return {
    ...receipt,
    recordedAt: params.recordedAt,
    localModelCompatibility: params.localModelCompatibility,
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
