// Ed25519 integrity receipts for independent Judge completion decisions.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { buildControlDirectorJudgeClaimHash } from "./control-director-contract.js";
import { parseJudgeCompletionVerdict } from "./judge-gate.js";

const PUBLIC_KEY_FILENAME = "judge-receipt-ed25519-public.pem";
const PRIVATE_KEY_FILENAME = "judge-receipt-ed25519-private.pem";
const MAX_CERTIFICATION_HEARTBEAT_AGE_MS = 300_000;
const CERTIFICATION_LEASE_STATES = new Set([
  "acquired",
  "promotion-authorized",
  "promoted",
  "rollback-drill",
]);
const CERTIFICATION_LEASE_EPOCH_FIELDS = [
  "schema",
  "activeSha",
  "candidateSha",
  "rollbackSha",
  "activeReleaseId",
  "rollbackReleaseId",
  "owner",
  "actor",
  "approvalId",
  "operationId",
  "invocationId",
  "operationClass",
  "createdAt",
  "expiresAt",
  "heartbeatRequired",
  "pid",
] as const;

export type SignedJudgeReceipt<T extends Record<string, unknown>> = T & {
  signature: string;
  publicKeyId: string;
};

export type ControlDirectorImmutableModelIdentity = {
  modelDigest: string;
  cacheDigest: string;
};

export type ControlDirectorCertificationLeaseBinding = {
  schema: "openclaw.custom-runtime-certification-lease.v2";
  runtimeHome: string;
  observedLeaseSha256: string;
  epochSha256: string;
  state: string;
  activeSha: string;
  candidateSha: string;
  rollbackSha: string;
  activeReleaseId: string;
  rollbackReleaseId: string;
  owner: string;
  actor: string;
  approvalId: string;
  operationId: string;
  invocationId: string;
  operationClass: "release-certification";
  createdAt: string;
  expiresAt: string;
  heartbeatAt: string;
  heartbeatRequired: true;
  heartbeatSequence: number;
  pid: number;
};

export type ControlDirectorTrialJudgeIssuance = {
  schema: "openclaw.control-director-trial-judge-issuance.v1";
  purpose: "control-director-model-trial";
  campaignNonce: string;
  trialId: string;
  trialModelRef: string;
  trialModelIdentity: ControlDirectorImmutableModelIdentity;
  judgeModelIdentity: ControlDirectorImmutableModelIdentity;
  measurementReceiptSha256: string;
  measurementSetSha256: string;
  evidenceSetSha256: string;
  certificationLease: ControlDirectorCertificationLeaseBinding;
  transcript: { path: string; sha256: string; content: string };
  invocation: {
    runId: string;
    sessionId: string;
    judgeAgentId: string;
    provider: string;
    model: string;
    startedAt: string;
    endedAt: string;
    requestPromptSha256: string;
    finalPromptSha256: string;
    rawOutputSha256: string;
    stopReason: string;
  };
  parsing: {
    parser: "judge-six-line-v1";
    status: "parsed";
    verdict: IndependentJudgeReceipt["verdict"];
    parsedVerdictSha256: string;
  };
  measurementSources: Array<{
    metric: string;
    evidenceRef: string;
    artifactSha256: string;
    jsonPointer: string;
    valueSha256: string;
  }>;
  evidenceArtifacts: Array<{
    evidenceRef: string;
    path: string;
    sha256: string;
    content: string;
  }>;
};

export type ControlDirectorCampaignJudgeIssuance = {
  schema: "openclaw.control-director-campaign-judge-issuance.v1";
  purpose: "control-director-m01-m106";
  sourceSha: string;
  rollbackSha: string;
  activeReleaseId: string;
  rollbackReleaseId: string;
  configurationDigest: string;
  selectedModel: string;
  selectedModelIdentity: ControlDirectorImmutableModelIdentity;
  judgeModelIdentity: ControlDirectorImmutableModelIdentity;
  claimHash: string;
  artifactSetSha256: string;
  certificationLease: ControlDirectorCertificationLeaseBinding;
  transcript: { path: string; sha256: string; content: string };
  invocation: {
    runId: string;
    sessionId: string;
    judgeAgentId: string;
    provider: string;
    model: string;
    startedAt: string;
    endedAt: string;
    requestPromptSha256: string;
    finalPromptSha256: string;
    rawOutputSha256: string;
    stopReason: string;
  };
  parsing: {
    parser: "judge-six-line-v1";
    status: "parsed";
    verdict: IndependentJudgeReceipt["verdict"];
    parsedVerdictSha256: string;
  };
  evidenceArtifacts: Array<{
    artifactId: string;
    path: string;
    sha256: string;
    content: string;
  }>;
};

export type IndependentJudgeReceipt = {
  schemaVersion: 1;
  receiptId: string;
  missionId: string;
  claimHash: string;
  verdict: "APPROVE" | "REJECT" | "REQUEST_MORE_EVIDENCE" | "ESCALATE_TO_HUMAN";
  scope: string;
  evidenceSummary: string;
  conditions: string;
  judgeRunId: string;
  judgeAgentId: string;
  model?: string;
  issuedAt: number;
  trialIssuance?: ControlDirectorTrialJudgeIssuance;
  campaignIssuance?: ControlDirectorCampaignJudgeIssuance;
  signature?: string;
  publicKeyId?: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "signature" && key !== "publicKeyId")
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function snapshotJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(snapshotJsonValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, snapshotJsonValue(entry)]),
  );
}

export function canonicalJudgeReceiptBytes(receipt: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(canonicalize(receipt)), "utf8");
}

export function digestCertificationLeaseEpoch(lease: Record<string, unknown>): string {
  const epoch = Object.fromEntries(
    CERTIFICATION_LEASE_EPOCH_FIELDS.map((field) => [field, lease[field]]),
  );
  return crypto.createHash("sha256").update(JSON.stringify(epoch)).digest("hex");
}

function publicKeyId(publicKey: crypto.KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(der).digest("hex");
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isProcessAlive(pid: unknown): pid is number {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readSafeRuntimeFile(filePath: string, privateMode: boolean): Buffer {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || (privateMode && (stat.mode & 0o077) !== 0)) {
      throw new Error("Managed runtime evidence file is unsafe.");
    }
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function withLifecycleSnapshotLock<T>(
  runtimeHome: string,
  binding: Record<string, unknown>,
  callback: () => T,
): T {
  const locksDir = path.join(runtimeHome, "locks");
  const lockPath = path.join(locksDir, "lifecycle.lock");
  const ownerPath = path.join(lockPath, "owner.json");
  fs.mkdirSync(locksDir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(locksDir).isSymbolicLink()) {
    throw new Error("Managed runtime lifecycle lock directory is unsafe.");
  }
  fs.chmodSync(locksDir, 0o700);
  let owned = false;
  try {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      owned = true;
      fs.writeFileSync(
        ownerPath,
        `${JSON.stringify(
          {
            schema: "openclaw.custom-runtime-lifecycle-lock.v1",
            operation: "certification-lease",
            activeSha: binding.activeSha,
            candidateSha: binding.candidateSha,
            approvalId: binding.approvalId,
            operationId: binding.operationId,
            invocationId: binding.invocationId,
            actor: os.userInfo().username,
            createdAt: new Date().toISOString(),
            pid: process.pid,
          },
          null,
          2,
        )}\n`,
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const owner = JSON.parse(readSafeRuntimeFile(ownerPath, true).toString("utf8")) as Record<
        string,
        unknown
      >;
      if (
        owner.schema !== "openclaw.custom-runtime-lifecycle-lock.v1" ||
        owner.invocationId !== binding.invocationId ||
        owner.pid !== process.pid
      ) {
        throw new Error("Another managed-runtime lifecycle operation is active.", {
          cause: error,
        });
      }
    }
    return callback();
  } finally {
    if (owned) {
      fs.rmSync(ownerPath, { force: true });
      fs.rmdirSync(lockPath);
    }
  }
}

function verifyCurrentCertificationLease(
  binding: unknown,
  certificationAt: number,
  requireCurrentLiveness: boolean,
  authoritativeRuntimeHome?: string,
): boolean {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    return false;
  }
  const expected = binding as Record<string, unknown>;
  const runtimeHome =
    typeof expected.runtimeHome === "string" && path.isAbsolute(expected.runtimeHome)
      ? expected.runtimeHome
      : "";
  if (!runtimeHome) {
    return false;
  }
  try {
    const resolvedRuntimeHome = fs.realpathSync(runtimeHome);
    const expectedRuntimeHome = fs.realpathSync(
      authoritativeRuntimeHome ??
        process.env.OPENCLAW_CUSTOM_RUNTIME_HOME ??
        path.join(os.homedir(), ".openclaw-custom-runtime"),
    );
    const runtimeHomeStat = fs.lstatSync(resolvedRuntimeHome);
    if (
      resolvedRuntimeHome !== expectedRuntimeHome ||
      runtimeHomeStat.isSymbolicLink() ||
      !runtimeHomeStat.isDirectory() ||
      (runtimeHomeStat.mode & 0o077) !== 0 ||
      expected.actor !== os.userInfo().username ||
      !isProcessAlive(expected.pid)
    ) {
      return false;
    }
    return withLifecycleSnapshotLock(resolvedRuntimeHome, expected, () => {
      const leasePath = path.join(resolvedRuntimeHome, "certification-lease.json");
      const pointerPath = path.join(resolvedRuntimeHome, "active-runtime.json");
      const firstLeaseBytes = readSafeRuntimeFile(leasePath, true);
      const lease = JSON.parse(firstLeaseBytes.toString("utf8")) as Record<string, unknown>;
      const pointer = JSON.parse(
        readSafeRuntimeFile(pointerPath, false).toString("utf8"),
      ) as Record<string, unknown>;
      const secondLeaseBytes = readSafeRuntimeFile(leasePath, true);
      const firstDigest = crypto.createHash("sha256").update(firstLeaseBytes).digest("hex");
      const secondDigest = crypto.createHash("sha256").update(secondLeaseBytes).digest("hex");
      const currentEpochDigest = digestCertificationLeaseEpoch(lease);
      const currentAt = Date.now();
      const createdAt =
        typeof lease.createdAt === "string" ? Date.parse(lease.createdAt) : Number.NaN;
      const expiresAt =
        typeof lease.expiresAt === "string" ? Date.parse(lease.expiresAt) : Number.NaN;
      const heartbeatAt =
        typeof lease.heartbeatAt === "string" ? Date.parse(lease.heartbeatAt) : Number.NaN;
      const heartbeatReferenceAt = requireCurrentLiveness ? currentAt : certificationAt;
      const immutableFields = [
        "schema",
        "activeSha",
        "candidateSha",
        "rollbackSha",
        "activeReleaseId",
        "rollbackReleaseId",
        "owner",
        "actor",
        "approvalId",
        "operationId",
        "invocationId",
        "operationClass",
        "createdAt",
        "expiresAt",
        "pid",
      ] as const;
      const expectedPointerSha =
        lease.state === "rollback-drill" ? expected.rollbackSha : expected.activeSha;
      return (
        firstDigest === secondDigest &&
        typeof expected.observedLeaseSha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(expected.observedLeaseSha256) &&
        currentEpochDigest === expected.epochSha256 &&
        immutableFields.every((field) => lease[field] === expected[field]) &&
        lease.heartbeatRequired === true &&
        typeof lease.state === "string" &&
        CERTIFICATION_LEASE_STATES.has(lease.state) &&
        typeof lease.heartbeatSequence === "number" &&
        Number.isInteger(lease.heartbeatSequence) &&
        lease.heartbeatSequence >= 0 &&
        Number.isFinite(createdAt) &&
        Number.isFinite(expiresAt) &&
        Number.isFinite(heartbeatAt) &&
        createdAt <= certificationAt &&
        expiresAt > certificationAt &&
        (!requireCurrentLiveness || expiresAt > currentAt) &&
        heartbeatAt >= createdAt &&
        heartbeatAt <= currentAt + 60_000 &&
        heartbeatReferenceAt - heartbeatAt <= MAX_CERTIFICATION_HEARTBEAT_AGE_MS &&
        pointer.sourceSha === expectedPointerSha &&
        pointer.releaseId ===
          (lease.state === "rollback-drill" ? expected.rollbackReleaseId : expected.activeReleaseId)
      );
    });
  } catch {
    return false;
  }
}

/** Compatibility signer for non-trial Judge receipts; model-trial issuance is service-only. */
export function signJudgeReceipt<T extends Record<string, unknown>>(
  receipt: T,
  options?: { directory?: string },
): SignedJudgeReceipt<T> {
  const snapshot = snapshotJsonValue(receipt) as T;
  if (
    snapshot.trialIssuance !== undefined ||
    snapshot.campaignIssuance !== undefined ||
    snapshot.schema === "openclaw.control-director-model-eval-trial.v2" ||
    (snapshot.judgeReceipt !== null &&
      typeof snapshot.judgeReceipt === "object" &&
      (snapshot.judgeReceipt as Record<string, unknown>).trialIssuance !== undefined) ||
    (typeof snapshot.missionId === "string" &&
      (snapshot.missionId.startsWith("control-director-model-eval:") ||
        snapshot.missionId.startsWith("control-director-m01-m106:")))
  ) {
    throw new Error("Control Director certification receipts require the Judge issuance service.");
  }
  const keyDirectory = options?.directory ?? path.join(resolveStateDir(), "credentials");
  fs.mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
  const privatePath = path.join(keyDirectory, PRIVATE_KEY_FILENAME);
  const publicPath = path.join(keyDirectory, PUBLIC_KEY_FILENAME);
  if (!fs.existsSync(privatePath)) {
    const generated = crypto.generateKeyPairSync("ed25519");
    try {
      fs.writeFileSync(privatePath, generated.privateKey.export({ type: "pkcs8", format: "pem" }), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }
  const privatePem = fs.readFileSync(privatePath, "utf8");
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(privatePem);
  fs.writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }), {
    encoding: "utf8",
    mode: 0o644,
  });
  fs.chmodSync(privatePath, 0o600);
  return {
    ...snapshot,
    signature: crypto
      .sign(null, canonicalJudgeReceiptBytes(snapshot), privateKey)
      .toString("base64"),
    publicKeyId: publicKeyId(publicKey),
  };
}

function verifyCampaignIssuance(
  receipt: Record<string, unknown>,
  issuance: Record<string, unknown>,
  certificationAt: number,
  requireCurrentLiveness: boolean,
  authoritativeRuntimeHome?: string,
): boolean {
  if (
    issuance.schema !== "openclaw.control-director-campaign-judge-issuance.v1" ||
    issuance.purpose !== "control-director-m01-m106" ||
    issuance.claimHash !== receipt.claimHash ||
    typeof issuance.sourceSha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(issuance.sourceSha) ||
    typeof issuance.rollbackSha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(issuance.rollbackSha) ||
    typeof issuance.configurationDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(issuance.configurationDigest) ||
    typeof issuance.selectedModel !== "string" ||
    !issuance.selectedModel.includes("/") ||
    typeof issuance.artifactSetSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(issuance.artifactSetSha256) ||
    !verifyCurrentCertificationLease(
      issuance.certificationLease,
      certificationAt,
      requireCurrentLiveness,
      authoritativeRuntimeHome,
    )
  ) {
    return false;
  }
  const artifacts = Array.isArray(issuance.evidenceArtifacts) ? issuance.evidenceArtifacts : [];
  if (artifacts.length === 0) {
    return false;
  }
  const normalizedArtifacts = artifacts
    .map((artifact) => {
      if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
        return undefined;
      }
      const value = artifact as Record<string, unknown>;
      if (
        typeof value.artifactId !== "string" ||
        !value.artifactId.trim() ||
        typeof value.path !== "string" ||
        !value.path.trim() ||
        path.isAbsolute(value.path) ||
        value.path.split(/[\\/]/u).includes("..") ||
        typeof value.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(value.sha256) ||
        typeof value.content !== "string" ||
        sha256Text(value.content) !== value.sha256
      ) {
        return undefined;
      }
      return {
        artifactId: value.artifactId,
        path: value.path,
        sha256: value.sha256,
      };
    })
    .filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== undefined)
    .toSorted((left, right) => left.artifactId.localeCompare(right.artifactId));
  if (
    normalizedArtifacts.length !== artifacts.length ||
    new Set(normalizedArtifacts.map((artifact) => artifact.artifactId)).size !== artifacts.length ||
    sha256Text(JSON.stringify(normalizedArtifacts)) !== issuance.artifactSetSha256
  ) {
    return false;
  }
  const transcript =
    issuance.transcript && typeof issuance.transcript === "object"
      ? (issuance.transcript as Record<string, unknown>)
      : undefined;
  const invocation =
    issuance.invocation && typeof issuance.invocation === "object"
      ? (issuance.invocation as Record<string, unknown>)
      : undefined;
  const parsing =
    issuance.parsing && typeof issuance.parsing === "object"
      ? (issuance.parsing as Record<string, unknown>)
      : undefined;
  if (
    !transcript ||
    typeof transcript.path !== "string" ||
    !transcript.path.trim() ||
    path.isAbsolute(transcript.path) ||
    transcript.path.split(/[\\/]/u).includes("..") ||
    typeof transcript.content !== "string" ||
    typeof transcript.sha256 !== "string" ||
    sha256Text(transcript.content) !== transcript.sha256 ||
    !invocation ||
    !parsing
  ) {
    return false;
  }
  const transcriptValue = JSON.parse(transcript.content) as Record<string, unknown>;
  const transcriptClaim =
    transcriptValue.claim && typeof transcriptValue.claim === "object"
      ? (transcriptValue.claim as Record<string, unknown>)
      : undefined;
  const transcriptInvocation =
    transcriptValue.invocation && typeof transcriptValue.invocation === "object"
      ? (transcriptValue.invocation as Record<string, unknown>)
      : undefined;
  const transcriptMissionId =
    typeof transcriptClaim?.missionId === "string" ? transcriptClaim.missionId : "";
  const transcriptRequestBody =
    typeof transcriptClaim?.requestBody === "string" ? transcriptClaim.requestBody : "";
  const transcriptFinalText =
    typeof transcriptClaim?.finalText === "string" ? transcriptClaim.finalText : "";
  const transcriptEvidenceSummary =
    typeof transcriptClaim?.evidenceSummary === "string" ? transcriptClaim.evidenceSummary : "";
  const invocationProvider = typeof invocation.provider === "string" ? invocation.provider : "";
  const invocationModel = typeof invocation.model === "string" ? invocation.model : "";
  const selectedModelIdentity =
    issuance.selectedModelIdentity && typeof issuance.selectedModelIdentity === "object"
      ? (issuance.selectedModelIdentity as Record<string, unknown>)
      : undefined;
  const judgeModelIdentity =
    issuance.judgeModelIdentity && typeof issuance.judgeModelIdentity === "object"
      ? (issuance.judgeModelIdentity as Record<string, unknown>)
      : undefined;
  const identitiesAreDistinct =
    typeof selectedModelIdentity?.modelDigest === "string" &&
    /^[a-f0-9]{64}$/u.test(selectedModelIdentity.modelDigest) &&
    typeof selectedModelIdentity.cacheDigest === "string" &&
    /^[a-f0-9]{64}$/u.test(selectedModelIdentity.cacheDigest) &&
    typeof judgeModelIdentity?.modelDigest === "string" &&
    /^[a-f0-9]{64}$/u.test(judgeModelIdentity.modelDigest) &&
    typeof judgeModelIdentity.cacheDigest === "string" &&
    /^[a-f0-9]{64}$/u.test(judgeModelIdentity.cacheDigest) &&
    selectedModelIdentity.modelDigest !== judgeModelIdentity.modelDigest &&
    selectedModelIdentity.cacheDigest !== judgeModelIdentity.cacheDigest;
  const parsed = parseJudgeCompletionVerdict(
    typeof transcriptValue.rawOutput === "string" ? transcriptValue.rawOutput : "",
  );
  const startedAt =
    typeof invocation.startedAt === "string" ? Date.parse(invocation.startedAt) : Number.NaN;
  const endedAt =
    typeof invocation.endedAt === "string" ? Date.parse(invocation.endedAt) : Number.NaN;
  const issuedAt = typeof receipt.issuedAt === "number" ? receipt.issuedAt : Number.NaN;
  const certificationLease =
    issuance.certificationLease && typeof issuance.certificationLease === "object"
      ? (issuance.certificationLease as Record<string, unknown>)
      : undefined;
  const leaseCreatedAt =
    typeof certificationLease?.createdAt === "string"
      ? Date.parse(certificationLease.createdAt)
      : Number.NaN;
  const leaseExpiresAt =
    typeof certificationLease?.expiresAt === "string"
      ? Date.parse(certificationLease.expiresAt)
      : Number.NaN;
  if (
    transcriptValue.schema !== "openclaw.control-director-campaign-judge-transcript.v1" ||
    transcriptValue.purpose !== issuance.purpose ||
    !transcriptClaim ||
    !transcriptMissionId ||
    !transcriptRequestBody ||
    !transcriptFinalText ||
    !transcriptEvidenceSummary ||
    buildControlDirectorJudgeClaimHash({
      missionId: transcriptMissionId,
      requestBody: transcriptRequestBody,
      finalText: transcriptFinalText,
      evidenceSummary: transcriptEvidenceSummary,
      artifactIds: Array.isArray(transcriptClaim.artifactIds)
        ? transcriptClaim.artifactIds.filter(
            (artifactId): artifactId is string => typeof artifactId === "string",
          )
        : [],
    }) !== issuance.claimHash ||
    transcriptValue.claimHash !== issuance.claimHash ||
    transcriptValue.sourceSha !== issuance.sourceSha ||
    transcriptValue.rollbackSha !== issuance.rollbackSha ||
    transcriptValue.activeReleaseId !== issuance.activeReleaseId ||
    transcriptValue.rollbackReleaseId !== issuance.rollbackReleaseId ||
    transcriptValue.configurationDigest !== issuance.configurationDigest ||
    transcriptValue.selectedModel !== issuance.selectedModel ||
    JSON.stringify(transcriptValue.selectedModelIdentity) !==
      JSON.stringify(selectedModelIdentity) ||
    JSON.stringify(transcriptValue.judgeModelIdentity) !== JSON.stringify(judgeModelIdentity) ||
    !identitiesAreDistinct ||
    transcriptValue.artifactSetSha256 !== issuance.artifactSetSha256 ||
    JSON.stringify(transcriptValue.certificationLease) !==
      JSON.stringify(issuance.certificationLease) ||
    JSON.stringify(transcriptValue.evidenceArtifacts) !== JSON.stringify(artifacts) ||
    !transcriptInvocation ||
    JSON.stringify(transcriptInvocation) !==
      JSON.stringify({
        runId: invocation.runId,
        sessionId: invocation.sessionId,
        judgeAgentId: invocation.judgeAgentId,
        provider: invocation.provider,
        model: invocation.model,
        startedAt: invocation.startedAt,
        endedAt: invocation.endedAt,
        stopReason: invocation.stopReason,
      }) ||
    invocation.runId !== receipt.judgeRunId ||
    invocation.judgeAgentId !== receipt.judgeAgentId ||
    !invocationProvider ||
    !invocationModel ||
    `${invocationProvider}/${invocationModel}` !== receipt.model ||
    `${invocationProvider}/${invocationModel}` === issuance.selectedModel ||
    (invocation.stopReason !== "stop" && invocation.stopReason !== "end_turn") ||
    typeof transcriptValue.prompt !== "string" ||
    sha256Text(transcriptValue.prompt) !== invocation.requestPromptSha256 ||
    typeof transcriptValue.finalPrompt !== "string" ||
    sha256Text(transcriptValue.finalPrompt) !== invocation.finalPromptSha256 ||
    typeof transcriptValue.rawOutput !== "string" ||
    sha256Text(transcriptValue.rawOutput) !== invocation.rawOutputSha256 ||
    parsed.status !== "parsed" ||
    parsing.parser !== "judge-six-line-v1" ||
    parsing.status !== "parsed" ||
    parsing.verdict !== parsed.verdict ||
    sha256Text(JSON.stringify(parsed)) !== parsing.parsedVerdictSha256 ||
    parsing.verdict !== receipt.verdict ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(leaseCreatedAt) ||
    !Number.isFinite(leaseExpiresAt) ||
    startedAt < leaseCreatedAt ||
    endedAt < startedAt ||
    endedAt > leaseExpiresAt ||
    issuedAt < endedAt ||
    issuedAt > leaseExpiresAt ||
    issuedAt > certificationAt
  ) {
    return false;
  }
  return true;
}

export function verifyJudgeReceipt(
  receipt: Record<string, unknown> & { signature?: unknown; publicKeyId?: unknown },
  options?: {
    directory?: string;
    publicKeyPem?: string;
    certificationAt?: string | number;
    expectedRuntimeHome?: string;
  },
): boolean {
  if (typeof receipt.signature !== "string" || typeof receipt.publicKeyId !== "string") {
    return false;
  }
  try {
    const publicKey = options?.publicKeyPem
      ? crypto.createPublicKey(options.publicKeyPem)
      : crypto.createPublicKey(
          fs.readFileSync(
            path.join(
              options?.directory ?? path.join(resolveStateDir(), "credentials"),
              PUBLIC_KEY_FILENAME,
            ),
            "utf8",
          ),
        );
    if (publicKeyId(publicKey) !== receipt.publicKeyId) {
      return false;
    }
    const verifyKey = publicKey.export({ type: "spki", format: "pem" });
    const signatureValid = crypto.verify(
      null,
      canonicalJudgeReceiptBytes(receipt),
      verifyKey,
      Buffer.from(receipt.signature, "base64"),
    );
    if (!signatureValid) {
      return false;
    }
    const trialIssuance =
      receipt.trialIssuance && typeof receipt.trialIssuance === "object"
        ? (receipt.trialIssuance as Record<string, unknown>)
        : undefined;
    const campaignIssuance =
      receipt.campaignIssuance && typeof receipt.campaignIssuance === "object"
        ? (receipt.campaignIssuance as Record<string, unknown>)
        : undefined;
    const certificationAt =
      typeof options?.certificationAt === "number"
        ? options.certificationAt
        : typeof options?.certificationAt === "string"
          ? Date.parse(options.certificationAt)
          : Date.now();
    if (!Number.isFinite(certificationAt) || (trialIssuance && campaignIssuance)) {
      return false;
    }
    if (trialIssuance) {
      return verifyCurrentCertificationLease(
        trialIssuance.certificationLease,
        certificationAt,
        options?.certificationAt === undefined,
        options?.expectedRuntimeHome,
      );
    }
    return campaignIssuance
      ? verifyCampaignIssuance(
          receipt,
          campaignIssuance,
          certificationAt,
          options?.certificationAt === undefined,
          options?.expectedRuntimeHome,
        )
      : true;
  } catch {
    return false;
  }
}
