// Independent, claim-bound Judge execution for completion decisions.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { judgeTaskCompletion } from "../tasks/task-completion-judge.js";
import { resolveJudgeAgentId } from "./agent-scope-config.js";
import { buildControlDirectorJudgeClaimHash } from "./control-director-contract.js";
import {
  buildControlDirectorModelEvalTrialSignedPayload,
  digestControlDirectorModelEvalTrialMeasurementReceipt,
  digestControlDirectorModelEvalTrialReceipt,
  digestControlDirectorModelTrialEvidenceSet,
  digestControlDirectorModelTrialMeasurementSet,
  type ControlDirectorModelEvalTrial,
} from "./control-director-model-eval.js";
import {
  formatJudgeVerdict,
  parseJudgeCompletionVerdict,
  type JudgeGateVerdict,
} from "./judge-gate.js";
import {
  canonicalJudgeReceiptBytes,
  digestCertificationLeaseEpoch,
  type SignedJudgeReceipt,
  verifyJudgeReceipt,
} from "./judge-receipt-signer.js";

const PRIVATE_KEY_FILENAME = "judge-receipt-ed25519-private.pem";
const PUBLIC_KEY_FILENAME = "judge-receipt-ed25519-public.pem";
const CAMPAIGN_PRIVATE_KEY_FILENAME = "judge-campaign-receipt-ed25519-private.pem";
const CAMPAIGN_PUBLIC_KEY_FILENAME = "judge-campaign-receipt-ed25519-public.pem";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_TRIAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SUCCESSFUL_STOP_REASONS = new Set(["stop", "end_turn"]);
const CERTIFICATION_LEASE_STATES = new Set(["acquired", "promotion-authorized", "promoted"]);
const MAX_CERTIFICATION_LEASE_MS = 86_400_000;
const MAX_CERTIFICATION_HEARTBEAT_AGE_MS = 300_000;
const MAX_CAMPAIGN_EVIDENCE_BYTES = 1_048_576;

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

export type IndependentJudgeModelResult = {
  text: string;
  runId: string;
  agentId: string;
  model?: string;
};

export type IndependentJudgeResult = {
  approved: boolean;
  receipt: IndependentJudgeReceipt;
  deterministicVerdict: JudgeGateVerdict;
  modelText?: string;
};

function publicKeyId(publicKey: crypto.KeyObject): string {
  return crypto
    .createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
}

function loadOrCreateJudgeSigningKey(
  directory?: string,
  filenames: { privateKey: string; publicKey: string } = {
    privateKey: PRIVATE_KEY_FILENAME,
    publicKey: PUBLIC_KEY_FILENAME,
  },
) {
  const keyDirectory = directory ?? path.join(resolveStateDir(), "credentials");
  fs.mkdirSync(keyDirectory, { recursive: true, mode: 0o700 });
  const privatePath = path.join(keyDirectory, filenames.privateKey);
  const publicPath = path.join(keyDirectory, filenames.publicKey);
  let privatePem: string;
  if (fs.existsSync(privatePath)) {
    privatePem = fs.readFileSync(privatePath, "utf8");
  } else {
    const generated = crypto.generateKeyPairSync("ed25519");
    const candidatePem = generated.privateKey.export({ type: "pkcs8", format: "pem" });
    try {
      fs.writeFileSync(privatePath, candidatePem, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      privatePem = candidatePem;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      privatePem = fs.readFileSync(privatePath, "utf8");
    }
  }
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(privatePem);
  fs.writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }), {
    encoding: "utf8",
    mode: 0o644,
  });
  fs.chmodSync(privatePath, 0o600);
  return { privateKey, publicKeyId: publicKeyId(publicKey) };
}

function signJudgeReceipt<T extends Record<string, unknown>>(
  receipt: T,
  signingDirectory?: string,
): SignedJudgeReceipt<T> {
  const key = loadOrCreateJudgeSigningKey(signingDirectory);
  return {
    ...receipt,
    signature: crypto
      .sign(null, canonicalJudgeReceiptBytes(receipt), key.privateKey)
      .toString("base64"),
    publicKeyId: key.publicKeyId,
  };
}

function signCampaignJudgeReceipt<T extends Record<string, unknown>>(
  receipt: T,
  signingDirectory?: string,
): SignedJudgeReceipt<T> {
  const key = loadOrCreateJudgeSigningKey(signingDirectory, {
    privateKey: CAMPAIGN_PRIVATE_KEY_FILENAME,
    publicKey: CAMPAIGN_PUBLIC_KEY_FILENAME,
  });
  return {
    ...receipt,
    signature: crypto
      .sign(null, canonicalJudgeReceiptBytes(receipt), key.privateKey)
      .toString("base64"),
    publicKeyId: key.publicKeyId,
  };
}

function normalizeJudgeVerdict(value: string): IndependentJudgeReceipt["verdict"] {
  return value === "APPROVE" ||
    value === "REJECT" ||
    value === "REQUEST_MORE_EVIDENCE" ||
    value === "ESCALATE_TO_HUMAN"
    ? value
    : "REQUEST_MORE_EVIDENCE";
}

function buildJudgePrompt(params: {
  missionId: string;
  requestBody: string;
  finalText: string;
  evidenceSummary: string;
  claimHash: string;
  deterministicVerdict: JudgeGateVerdict;
}): string {
  return [
    "You are the independent completion Judge. Do not execute or modify anything.",
    "Evaluate only the exact mission, claim, and direct evidence below.",
    "Return exactly six non-empty lines: VERDICT, SCOPE, EVIDENCE, RISK, REASON, CONDITIONS.",
    "VERDICT must be APPROVE, REJECT, REQUEST_MORE_EVIDENCE, or ESCALATE_TO_HUMAN.",
    "Approve only when every requested outcome is supported by direct evidence.",
    "",
    `Mission id: ${params.missionId}`,
    `Claim hash: ${params.claimHash}`,
    `Original request: ${params.requestBody}`,
    `Proposed final answer: ${params.finalText}`,
    `Direct evidence: ${params.evidenceSummary}`,
    "Deterministic packet preflight (not the final verdict):",
    formatJudgeVerdict(params.deterministicVerdict),
  ].join("\n");
}

function unsignedReceipt(params: {
  missionId: string;
  claimHash: string;
  verdict: IndependentJudgeReceipt["verdict"];
  scope: string;
  evidenceSummary: string;
  conditions: string;
  judgeRunId: string;
  judgeAgentId: string;
  model?: string;
  now: number;
}): IndependentJudgeReceipt {
  return {
    schemaVersion: 1,
    receiptId: crypto.randomUUID(),
    missionId: params.missionId,
    claimHash: params.claimHash,
    verdict: params.verdict,
    scope: params.scope,
    evidenceSummary: params.evidenceSummary,
    conditions: params.conditions,
    judgeRunId: params.judgeRunId,
    judgeAgentId: params.judgeAgentId,
    issuedAt: params.now,
    ...(params.model ? { model: params.model } : {}),
  };
}

/** Run deterministic preflight plus a separate model Judge, then sign the exact claim receipt. */
export async function judgeCompletionIndependently(params: {
  missionId: string;
  requestBody: string;
  finalText: string;
  evidenceSummary: string;
  artifactIds?: readonly string[];
  runModel?: (prompt: string) => Promise<IndependentJudgeModelResult>;
  signingDirectory?: string;
  now?: number;
}): Promise<IndependentJudgeResult> {
  const now = params.now ?? Date.now();
  const claimHash = buildControlDirectorJudgeClaimHash({
    missionId: params.missionId,
    requestBody: params.requestBody,
    finalText: params.finalText,
    evidenceSummary: params.evidenceSummary,
    artifactIds: params.artifactIds,
  });
  const deterministic = judgeTaskCompletion({
    userRequest: params.requestBody,
    finalText: params.finalText,
    expectedDeliverable: "exact Pursue Goal mission",
    artifactIds: params.artifactIds,
    status: "succeeded",
  });
  if (!deterministic.approved || !params.runModel) {
    const unsigned = unsignedReceipt({
      missionId: params.missionId,
      claimHash,
      verdict: deterministic.approved
        ? "REQUEST_MORE_EVIDENCE"
        : normalizeJudgeVerdict(deterministic.verdict.verdict),
      scope: deterministic.verdict.scope,
      evidenceSummary: deterministic.verdict.evidence,
      conditions: params.runModel
        ? deterministic.verdict.conditions
        : "configure an independent Judge agent and rerun verification",
      judgeRunId: "not-run",
      judgeAgentId: "unavailable",
      now,
    });
    const receipt = signJudgeReceipt(unsigned, params.signingDirectory);
    return { approved: false, receipt, deterministicVerdict: deterministic.verdict };
  }

  const modelResult = await params.runModel(
    buildJudgePrompt({
      missionId: params.missionId,
      requestBody: params.requestBody,
      finalText: params.finalText,
      evidenceSummary: params.evidenceSummary,
      claimHash,
      deterministicVerdict: deterministic.verdict,
    }),
  );
  const parsed = parseJudgeCompletionVerdict(modelResult.text);
  const parsedVerdict =
    parsed.status === "parsed" ? normalizeJudgeVerdict(parsed.verdict) : "REQUEST_MORE_EVIDENCE";
  const unsigned = unsignedReceipt({
    missionId: params.missionId,
    claimHash,
    verdict: parsedVerdict,
    scope: parsed.status === "parsed" ? parsed.scope : "exact Pursue Goal mission",
    evidenceSummary:
      parsed.status === "parsed"
        ? parsed.evidence
        : "Judge response did not match the six-line contract.",
    conditions:
      parsed.status === "parsed" ? parsed.conditions : parsed.errors.join("; ") || "rerun Judge",
    judgeRunId: modelResult.runId,
    judgeAgentId: modelResult.agentId,
    model: modelResult.model,
    now,
  });
  const receipt = signJudgeReceipt(unsigned, params.signingDirectory);
  return {
    approved: parsedVerdict === "APPROVE",
    receipt,
    deterministicVerdict: deterministic.verdict,
    modelText: modelResult.text,
  };
}

function resultText(result: unknown): string {
  if (!result || typeof result !== "object") {
    return "";
  }
  const payloads = (result as { payloads?: unknown }).payloads;
  return Array.isArray(payloads)
    ? payloads
        .flatMap((payload) => {
          const text =
            payload && typeof payload === "object"
              ? (payload as { text?: unknown }).text
              : undefined;
          return typeof text === "string" && text.trim() ? [text.trim()] : [];
        })
        .join("\n\n")
    : "";
}

function resultMeta(result: unknown) {
  const meta =
    result && typeof result === "object" ? (result as { meta?: unknown }).meta : undefined;
  return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requireImmutableModelIdentity(
  value: unknown,
  label: string,
): ControlDirectorImmutableModelIdentity {
  const identity = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const modelDigest = typeof identity.modelDigest === "string" ? identity.modelDigest.trim() : "";
  const cacheDigest = typeof identity.cacheDigest === "string" ? identity.cacheDigest.trim() : "";
  if (!SHA256_PATTERN.test(modelDigest) || !SHA256_PATTERN.test(cacheDigest)) {
    throw new Error(`${label} requires immutable model and cache SHA-256 identities.`);
  }
  return { modelDigest, cacheDigest };
}

function assertImmutableModelIdentityDiversity(params: {
  selected: ControlDirectorImmutableModelIdentity;
  judge: ControlDirectorImmutableModelIdentity;
  purpose: "campaign" | "trial";
}): void {
  if (
    params.selected.modelDigest === params.judge.modelDigest ||
    params.selected.cacheDigest === params.judge.cacheDigest
  ) {
    throw new Error(
      `Independent ${params.purpose} Judge must use distinct immutable model and cache identities.`,
    );
  }
}

function parseOllamaBaseBlobDigests(modelfile: string): string[] {
  return [
    ...new Set(
      modelfile
        .split(/\r?\n/u)
        .map((line) => line.match(/^FROM\s+.*\/sha256-([a-f0-9]{64})\s*$/iu)?.[1]?.toLowerCase())
        .filter((value): value is string => Boolean(value)),
    ),
  ].toSorted((left, right) => left.localeCompare(right));
}

async function resolveJudgeImmutableModelIdentity(params: {
  agentMeta: Record<string, unknown>;
  provider: string;
  model: string;
  config: unknown;
  label: string;
}): Promise<ControlDirectorImmutableModelIdentity> {
  if (params.agentMeta.immutableModelIdentity !== undefined) {
    return requireImmutableModelIdentity(params.agentMeta.immutableModelIdentity, params.label);
  }
  if (params.provider !== "ollama") {
    throw new Error(`${params.label} requires immutable model and cache SHA-256 identities.`);
  }
  const config =
    params.config && typeof params.config === "object"
      ? (params.config as Record<string, unknown>)
      : {};
  const models =
    config.models && typeof config.models === "object"
      ? (config.models as Record<string, unknown>)
      : {};
  const providers =
    models.providers && typeof models.providers === "object"
      ? (models.providers as Record<string, unknown>)
      : {};
  const ollama =
    providers.ollama && typeof providers.ollama === "object"
      ? (providers.ollama as Record<string, unknown>)
      : {};
  const configuredBaseUrl = ollama.baseUrl ?? ollama.baseURL ?? "http://127.0.0.1:11434";
  if (typeof configuredBaseUrl !== "string") {
    throw new Error("Independent Ollama Judge base URL must be a string.");
  }
  const baseUrl = new URL(configuredBaseUrl.replace(/\/+$/u, "").replace(/\/v1$/iu, ""));
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    !["127.0.0.1", "localhost"].includes(baseUrl.hostname) ||
    baseUrl.username ||
    baseUrl.password
  ) {
    throw new Error("Independent Ollama Judge identity must be resolved from loopback.");
  }
  const showUrl = new URL("/api/show", baseUrl);
  const psUrl = new URL("/api/ps", baseUrl);
  const [showResponse, psResponse] = await Promise.all([
    fetch(showUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: params.model }),
      signal: AbortSignal.timeout(30_000),
    }),
    fetch(psUrl, { method: "GET", signal: AbortSignal.timeout(30_000) }),
  ]);
  if (!showResponse.ok || !psResponse.ok) {
    throw new Error("Independent Ollama Judge identity probe failed.");
  }
  const show = (await showResponse.json()) as Record<string, unknown>;
  const ps = (await psResponse.json()) as { models?: Array<Record<string, unknown>> };
  const resident = ps.models?.find(
    (entry) => entry.name === params.model || entry.model === params.model,
  );
  const manifestDigest =
    typeof resident?.digest === "string"
      ? resident.digest
          .trim()
          .toLowerCase()
          .replace(/^sha256:/u, "")
      : "";
  const baseBlobDigests = parseOllamaBaseBlobDigests(
    typeof show.modelfile === "string" ? show.modelfile : "",
  );
  const sizeBytes = Number(resident?.size);
  const vramBytes = Number(resident?.size_vram);
  const expiresAt = typeof resident?.expires_at === "string" ? resident.expires_at.trim() : "";
  const expiresAtMs = Date.parse(expiresAt);
  if (
    !SHA256_PATTERN.test(manifestDigest) ||
    baseBlobDigests.length === 0 ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0 ||
    !Number.isFinite(vramBytes) ||
    vramBytes < 0 ||
    !expiresAt ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= Date.now()
  ) {
    throw new Error("Independent Ollama Judge is not resident with immutable model bytes.");
  }
  const modelDigest = sha256Text(JSON.stringify({ manifestDigest, baseBlobDigests }));
  const cacheDigest = sha256Text(
    JSON.stringify({
      modelId: params.model,
      modelDigest,
      manifestDigest,
      residency: {
        digest: manifestDigest,
        sizeBytes,
        vramBytes,
        expiresAt,
      },
    }),
  );
  return requireImmutableModelIdentity({ modelDigest, cacheDigest }, params.label);
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

type ExpectedCertificationLease = {
  runtimeHome?: string;
  sourceSha: string;
  rollbackSha: string;
  activeReleaseId: string;
  rollbackReleaseId: string;
  leaseOwner: string;
  approvalId: string;
  operationId: string;
  invocationId: string;
};

function withCertificationLifecycleLock<T>(
  runtimeHome: string,
  expected: ExpectedCertificationLease,
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
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Another managed-runtime lifecycle operation is active.", { cause: error });
    }
    throw error;
  }
  try {
    fs.writeFileSync(
      ownerPath,
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-lifecycle-lock.v1",
        operation: "control-director-judge-issuance",
        activeSha: expected.sourceSha,
        candidateSha: expected.sourceSha,
        approvalId: expected.approvalId,
        operationId: expected.operationId,
        invocationId: expected.invocationId,
        actor: os.userInfo().username,
        createdAt: new Date().toISOString(),
        pid: process.pid,
      })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    return callback();
  } finally {
    fs.rmSync(ownerPath, { force: true });
    fs.rmdirSync(lockPath);
  }
}

function readActiveCertificationLease(
  expected: ExpectedCertificationLease,
  runtimeHome: string,
): ControlDirectorCertificationLeaseBinding {
  const leasePath = path.join(runtimeHome, "certification-lease.json");
  const descriptor = fs.openSync(leasePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
      throw new Error("Certification lease is missing or unsafe.");
    }
    bytes = fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  const lease = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  const createdAt = typeof lease.createdAt === "string" ? Date.parse(lease.createdAt) : Number.NaN;
  const expiresAt = typeof lease.expiresAt === "string" ? Date.parse(lease.expiresAt) : Number.NaN;
  const heartbeatAt =
    typeof lease.heartbeatAt === "string" ? Date.parse(lease.heartbeatAt) : Number.NaN;
  const now = Date.now();
  if (
    lease.schema !== "openclaw.custom-runtime-certification-lease.v2" ||
    lease.operationClass !== "release-certification" ||
    typeof lease.state !== "string" ||
    !CERTIFICATION_LEASE_STATES.has(lease.state) ||
    lease.activeSha !== expected.sourceSha ||
    lease.candidateSha !== expected.sourceSha ||
    lease.rollbackSha !== expected.rollbackSha ||
    lease.activeReleaseId !== expected.activeReleaseId ||
    lease.rollbackReleaseId !== expected.rollbackReleaseId ||
    lease.owner !== expected.leaseOwner ||
    lease.actor !== os.userInfo().username ||
    lease.approvalId !== expected.approvalId ||
    lease.operationId !== expected.operationId ||
    lease.invocationId !== expected.invocationId ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(heartbeatAt) ||
    createdAt > now + 60_000 ||
    expiresAt <= now ||
    expiresAt <= createdAt ||
    expiresAt - createdAt > MAX_CERTIFICATION_LEASE_MS ||
    heartbeatAt < createdAt ||
    heartbeatAt > now + 60_000 ||
    now - heartbeatAt > MAX_CERTIFICATION_HEARTBEAT_AGE_MS ||
    lease.heartbeatRequired !== true ||
    typeof lease.heartbeatSequence !== "number" ||
    !Number.isInteger(lease.heartbeatSequence) ||
    lease.heartbeatSequence < 0 ||
    !isProcessAlive(lease.pid)
  ) {
    throw new Error("Certification lease is not a live exact release-certification binding.");
  }
  const pointerPath = path.join(runtimeHome, "active-runtime.json");
  const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
  const expectedPointerSha =
    lease.state === "rollback-drill" ? expected.rollbackSha : expected.sourceSha;
  const expectedPointerRelease =
    lease.state === "rollback-drill" ? expected.rollbackReleaseId : expected.activeReleaseId;
  if (pointer.sourceSha !== expectedPointerSha || pointer.releaseId !== expectedPointerRelease) {
    throw new Error("Active runtime conflicts with the certification lease state.");
  }
  return {
    schema: "openclaw.custom-runtime-certification-lease.v2",
    runtimeHome,
    observedLeaseSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    epochSha256: digestCertificationLeaseEpoch(lease),
    state: lease.state,
    activeSha: expected.sourceSha,
    candidateSha: expected.sourceSha,
    rollbackSha: expected.rollbackSha,
    activeReleaseId: expected.activeReleaseId,
    rollbackReleaseId: expected.rollbackReleaseId,
    owner: expected.leaseOwner,
    actor: lease.actor,
    approvalId: expected.approvalId,
    operationId: expected.operationId,
    invocationId: expected.invocationId,
    operationClass: "release-certification",
    createdAt: lease.createdAt as string,
    expiresAt: lease.expiresAt as string,
    heartbeatAt: lease.heartbeatAt as string,
    heartbeatRequired: true,
    heartbeatSequence: lease.heartbeatSequence,
    pid: lease.pid,
  };
}

function loadActiveCertificationLease(
  expected: ExpectedCertificationLease,
): ControlDirectorCertificationLeaseBinding {
  const runtimeHome = fs.realpathSync(
    expected.runtimeHome ??
      process.env.OPENCLAW_CUSTOM_RUNTIME_HOME ??
      path.join(os.homedir(), ".openclaw-custom-runtime"),
  );
  const runtimeHomeStat = fs.lstatSync(runtimeHome);
  if (
    runtimeHomeStat.isSymbolicLink() ||
    !runtimeHomeStat.isDirectory() ||
    (runtimeHomeStat.mode & 0o077) !== 0
  ) {
    throw new Error("Managed runtime home is unsafe for Judge issuance.");
  }
  return withCertificationLifecycleLock(runtimeHome, expected, () =>
    readActiveCertificationLease(expected, runtimeHome),
  );
}

function readCampaignEvidenceArtifacts(params: {
  artifactRoot: string;
  claimArtifactIds: readonly string[];
  artifacts: readonly { artifactId: string; path: string; sha256: string }[];
}): ControlDirectorCampaignJudgeIssuance["evidenceArtifacts"] {
  if (
    params.artifacts.length === 0 ||
    params.artifacts.length !== params.claimArtifactIds.length ||
    new Set(params.artifacts.map((artifact) => artifact.artifactId)).size !==
      params.artifacts.length ||
    params.artifacts
      .map((artifact) => artifact.artifactId)
      .toSorted()
      .join("\n") !== [...params.claimArtifactIds].toSorted().join("\n")
  ) {
    throw new Error("Campaign Judge artifacts must exactly match the completion claim.");
  }
  const artifactRoot = fs.realpathSync(params.artifactRoot);
  const evidenceArtifacts: ControlDirectorCampaignJudgeIssuance["evidenceArtifacts"] = [];
  let totalBytes = 0;
  for (const artifact of params.artifacts) {
    if (
      !artifact.artifactId.trim() ||
      !artifact.path.trim() ||
      path.isAbsolute(artifact.path) ||
      !SHA256_PATTERN.test(artifact.sha256)
    ) {
      throw new Error("Campaign Judge artifacts require safe relative digest bindings.");
    }
    const candidate = path.resolve(artifactRoot, artifact.path);
    const relative = path.relative(artifactRoot, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Campaign Judge artifact escapes the evidence root.");
    }
    const descriptor = fs.openSync(
      candidate,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    let bytes: Buffer;
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile()) {
        throw new Error("Campaign Judge artifact is not a regular file.");
      }
      bytes = fs.readFileSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    totalBytes += bytes.length;
    if (
      totalBytes > MAX_CAMPAIGN_EVIDENCE_BYTES ||
      crypto.createHash("sha256").update(bytes).digest("hex") !== artifact.sha256
    ) {
      throw new Error("Campaign Judge artifact bytes do not match the bounded evidence packet.");
    }
    const content = bytes.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(bytes)) {
      throw new Error("Campaign Judge artifacts must be canonical UTF-8 evidence.");
    }
    evidenceArtifacts.push({
      artifactId: artifact.artifactId,
      path: relative,
      sha256: artifact.sha256,
      content,
    });
  }
  return evidenceArtifacts.toSorted((left, right) =>
    left.artifactId.localeCompare(right.artifactId),
  );
}

function digestCampaignEvidenceArtifacts(
  artifacts: readonly ControlDirectorCampaignJudgeIssuance["evidenceArtifacts"][number][],
): string {
  return sha256Text(
    JSON.stringify(
      artifacts.map(({ artifactId, path: artifactPath, sha256 }) => ({
        artifactId,
        path: artifactPath,
        sha256,
      })),
    ),
  );
}

/** Execute the configured Judge and issue one transcript-bound M01-M106 verdict. */
export async function issueControlDirectorCampaignJudgeReceipt(params: {
  claim: {
    missionId: string;
    requestBody: string;
    finalText: string;
    evidenceSummary: string;
    artifactIds: readonly string[];
  };
  sourceSha: string;
  rollbackSha: string;
  activeReleaseId: string;
  rollbackReleaseId: string;
  configurationDigest: string;
  selectedModel: string;
  selectedModelIdentity?: ControlDirectorImmutableModelIdentity;
  runtimeHome: string;
  leaseOwner: string;
  approvalId: string;
  operationId: string;
  invocationId: string;
  evidenceArtifacts: readonly { artifactId: string; path: string; sha256: string }[];
  artifactRoot: string;
  signingDirectory?: string;
}): Promise<SignedJudgeReceipt<IndependentJudgeReceipt>> {
  if (
    !SHA_PATTERN.test(params.sourceSha) ||
    !SHA_PATTERN.test(params.rollbackSha) ||
    !SHA256_PATTERN.test(params.configurationDigest) ||
    !params.selectedModel.includes("/") ||
    !path.isAbsolute(params.runtimeHome) ||
    params.claim.artifactIds.length === 0
  ) {
    throw new Error("Campaign Judge issuance requires exact runtime and claim identities.");
  }
  const selectedModelIdentity = requireImmutableModelIdentity(
    params.selectedModelIdentity,
    "Selected Control Director model",
  );
  loadActiveCertificationLease(params);
  const evidenceArtifacts = readCampaignEvidenceArtifacts({
    artifactRoot: params.artifactRoot,
    claimArtifactIds: params.claim.artifactIds,
    artifacts: params.evidenceArtifacts,
  });
  const artifactSetSha256 = digestCampaignEvidenceArtifacts(evidenceArtifacts);
  const { getRuntimeConfig } = await import("../config/io.js");
  const { agentCommand } = await import("./agent-command.js");
  const config = getRuntimeConfig();
  const judgeAgentId = resolveJudgeAgentId(config);
  if (!judgeAgentId) {
    throw new Error("Control Director certification requires a configured Judge agent.");
  }
  const claimHash = buildControlDirectorJudgeClaimHash(params.claim);
  const deterministic = judgeTaskCompletion({
    userRequest: params.claim.requestBody,
    finalText: params.claim.finalText,
    expectedDeliverable: "exact Control Director M01-M106 certification campaign",
    artifactIds: params.claim.artifactIds,
    status: "succeeded",
  });
  if (!deterministic.approved) {
    throw new Error("Control Director campaign failed deterministic Judge preflight.");
  }
  const prompt = [
    buildJudgePrompt({
      missionId: params.claim.missionId,
      requestBody: params.claim.requestBody,
      finalText: params.claim.finalText,
      evidenceSummary: params.claim.evidenceSummary,
      claimHash,
      deterministicVerdict: deterministic.verdict,
    }),
    "",
    "Exact evidence packet (artifact id, relative path, SHA-256, and bytes):",
    JSON.stringify(evidenceArtifacts),
  ].join("\n");
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const result = await agentCommand({
    message: prompt,
    transcriptMessage: "Independent Control Director M01-M106 Judge review.",
    agentId: judgeAgentId,
    sessionKey: `agent:${judgeAgentId}:judge:control-director-campaign:${params.invocationId}`,
    sessionId,
    runId,
    deliver: false,
    modelRun: true,
    promptMode: "none",
    suppressPromptPersistence: true,
    sessionEffects: "internal",
    disableMessageTool: true,
  });
  const endedAt = new Date().toISOString();
  const certificationLease = loadActiveCertificationLease(params);
  if (
    Date.parse(startedAt) < Date.parse(certificationLease.createdAt) ||
    Date.parse(endedAt) > Date.parse(certificationLease.expiresAt)
  ) {
    throw new Error("Campaign Judge invocation falls outside the active certification lease.");
  }
  const meta = resultMeta(result);
  const agentMeta =
    meta.agentMeta && typeof meta.agentMeta === "object"
      ? (meta.agentMeta as Record<string, unknown>)
      : {};
  const rawOutput =
    typeof meta.finalAssistantRawText === "string"
      ? meta.finalAssistantRawText
      : resultText(result);
  const finalPrompt = typeof meta.finalPromptText === "string" ? meta.finalPromptText : prompt;
  const stopReason = typeof meta.stopReason === "string" ? meta.stopReason : "";
  const provider = typeof agentMeta.provider === "string" ? agentMeta.provider.trim() : "";
  const model = typeof agentMeta.model === "string" ? agentMeta.model.trim() : "";
  const judgeModelIdentity = await resolveJudgeImmutableModelIdentity({
    agentMeta,
    provider,
    model,
    config,
    label: "Independent campaign Judge",
  });
  assertImmutableModelIdentityDiversity({
    selected: selectedModelIdentity,
    judge: judgeModelIdentity,
    purpose: "campaign",
  });
  const parsed = parseJudgeCompletionVerdict(rawOutput);
  if (
    parsed.status !== "parsed" ||
    !provider ||
    !model ||
    `${provider}/${model}` === params.selectedModel ||
    !SUCCESSFUL_STOP_REASONS.has(stopReason)
  ) {
    throw new Error("Independent campaign Judge did not produce a valid diverse terminal verdict.");
  }
  const parsedVerdict = normalizeJudgeVerdict(parsed.verdict);
  const transcript = {
    schema: "openclaw.control-director-campaign-judge-transcript.v1",
    purpose: "control-director-m01-m106",
    claim: params.claim,
    claimHash,
    sourceSha: params.sourceSha,
    rollbackSha: params.rollbackSha,
    activeReleaseId: params.activeReleaseId,
    rollbackReleaseId: params.rollbackReleaseId,
    configurationDigest: params.configurationDigest,
    selectedModel: params.selectedModel,
    selectedModelIdentity,
    judgeModelIdentity,
    artifactSetSha256,
    prompt,
    finalPrompt,
    rawOutput,
    parsed,
    invocation: {
      runId,
      sessionId,
      judgeAgentId,
      provider,
      model,
      startedAt,
      endedAt,
      stopReason,
    },
    certificationLease,
    evidenceArtifacts,
  };
  const transcriptBytes = Buffer.from(`${JSON.stringify(transcript, null, 2)}\n`, "utf8");
  const artifactRoot = fs.realpathSync(params.artifactRoot);
  const transcriptName = `campaign-judge-${params.invocationId.replace(
    /[^A-Za-z0-9._-]/gu,
    "_",
  )}-${runId}.json`;
  fs.writeFileSync(path.join(artifactRoot, transcriptName), transcriptBytes, {
    flag: "wx",
    mode: 0o600,
  });
  const issuance: ControlDirectorCampaignJudgeIssuance = {
    schema: "openclaw.control-director-campaign-judge-issuance.v1",
    purpose: "control-director-m01-m106",
    sourceSha: params.sourceSha,
    rollbackSha: params.rollbackSha,
    activeReleaseId: params.activeReleaseId,
    rollbackReleaseId: params.rollbackReleaseId,
    configurationDigest: params.configurationDigest,
    selectedModel: params.selectedModel,
    selectedModelIdentity,
    judgeModelIdentity,
    claimHash,
    artifactSetSha256,
    certificationLease,
    transcript: {
      path: transcriptName,
      sha256: sha256Text(transcriptBytes.toString("utf8")),
      content: transcriptBytes.toString("utf8"),
    },
    invocation: {
      runId,
      sessionId,
      judgeAgentId,
      provider,
      model,
      startedAt,
      endedAt,
      requestPromptSha256: sha256Text(prompt),
      finalPromptSha256: sha256Text(finalPrompt),
      rawOutputSha256: sha256Text(rawOutput),
      stopReason,
    },
    parsing: {
      parser: "judge-six-line-v1",
      status: "parsed",
      verdict: parsedVerdict,
      parsedVerdictSha256: sha256Text(JSON.stringify(parsed)),
    },
    evidenceArtifacts,
  };
  const issuedAt = Date.now();
  if (issuedAt > Date.parse(certificationLease.expiresAt)) {
    throw new Error("Campaign Judge receipt falls outside the active certification lease.");
  }
  const unsigned = unsignedReceipt({
    missionId: params.claim.missionId,
    claimHash,
    verdict: parsedVerdict,
    scope: parsed.scope,
    evidenceSummary: parsed.evidence,
    conditions: parsed.conditions,
    judgeRunId: runId,
    judgeAgentId,
    model: `${provider}/${model}`,
    now: issuedAt,
  });
  const runtimeHome = fs.realpathSync(params.runtimeHome);
  return withCertificationLifecycleLock(runtimeHome, params, () => {
    const currentLease = readActiveCertificationLease(params, runtimeHome);
    if (
      currentLease.epochSha256 !== certificationLease.epochSha256 ||
      currentLease.state !== certificationLease.state
    ) {
      throw new Error("Certification lease changed before campaign Judge receipt issuance.");
    }
    return signCampaignJudgeReceipt(
      { ...unsigned, campaignIssuance: issuance },
      params.signingDirectory,
    );
  });
}

function assertTrialIssuanceRequest(params: {
  campaignNonce: string;
  trialId: string;
  trialModelRef: string;
  trialModelIdentity?: ControlDirectorImmutableModelIdentity;
  sourceSha: string;
  rollbackSha: string;
  activeReleaseId: string;
  rollbackReleaseId: string;
  leaseOwner: string;
  approvalId: string;
  operationId: string;
  invocationId: string;
  measurementReceiptSha256: string;
  measurementSetSha256: string;
  evidenceSetSha256: string;
  measurementSources: ControlDirectorTrialJudgeIssuance["measurementSources"];
  evidenceArtifacts: ControlDirectorTrialJudgeIssuance["evidenceArtifacts"];
}): ControlDirectorImmutableModelIdentity {
  if (
    !SHA256_PATTERN.test(params.campaignNonce) ||
    !SAFE_TRIAL_ID_PATTERN.test(params.trialId) ||
    !params.trialModelRef.includes("/") ||
    !SHA256_PATTERN.test(params.measurementReceiptSha256) ||
    !SHA256_PATTERN.test(params.measurementSetSha256) ||
    !SHA256_PATTERN.test(params.evidenceSetSha256) ||
    params.measurementSources.length === 0 ||
    params.evidenceArtifacts.length === 0 ||
    new Set(params.evidenceArtifacts.map((artifact) => artifact.evidenceRef)).size !==
      params.evidenceArtifacts.length ||
    params.evidenceArtifacts.some(
      (artifact) =>
        !artifact.evidenceRef.trim() ||
        !artifact.path.trim() ||
        !SHA256_PATTERN.test(artifact.sha256) ||
        sha256Text(artifact.content) !== artifact.sha256,
    ) ||
    params.measurementSources.some(
      (source) =>
        !source.metric.trim() ||
        !source.evidenceRef.trim() ||
        !source.jsonPointer.startsWith("/") ||
        !SHA256_PATTERN.test(source.artifactSha256) ||
        !SHA256_PATTERN.test(source.valueSha256) ||
        !params.evidenceArtifacts.some(
          (artifact) =>
            artifact.evidenceRef === source.evidenceRef &&
            artifact.sha256 === source.artifactSha256,
        ),
    )
  ) {
    throw new Error("Trial Judge issuance requires exact derived measurements and evidence.");
  }
  return requireImmutableModelIdentity(
    params.trialModelIdentity,
    "Selected Control Director trial model",
  );
}

/** Execute the configured Judge and issue one transcript-bound model-trial verdict. */
export async function issueControlDirectorModelTrialJudgeReceipt(params: {
  claim: {
    missionId: string;
    requestBody: string;
    finalText: string;
    evidenceSummary: string;
    artifactIds: readonly string[];
  };
  campaignNonce: string;
  trialId: string;
  trialModelRef: string;
  trialModelIdentity?: ControlDirectorImmutableModelIdentity;
  sourceSha: string;
  rollbackSha: string;
  activeReleaseId: string;
  rollbackReleaseId: string;
  leaseOwner: string;
  approvalId: string;
  operationId: string;
  invocationId: string;
  measurementReceiptSha256: string;
  measurementSetSha256: string;
  evidenceSetSha256: string;
  measurementSources: ControlDirectorTrialJudgeIssuance["measurementSources"];
  evidenceArtifacts: ControlDirectorTrialJudgeIssuance["evidenceArtifacts"];
  artifactRoot: string;
  signingDirectory?: string;
}): Promise<SignedJudgeReceipt<IndependentJudgeReceipt>> {
  const trialModelIdentity = assertTrialIssuanceRequest(params);
  loadActiveCertificationLease(params);
  const artifactRoot = path.resolve(params.artifactRoot);
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const { getRuntimeConfig } = await import("../config/io.js");
  const { agentCommand } = await import("./agent-command.js");
  const config = getRuntimeConfig();
  const judgeAgentId = resolveJudgeAgentId(config);
  if (!judgeAgentId) {
    throw new Error("Control Director model trials require a configured Judge agent.");
  }
  const claimHash = buildControlDirectorJudgeClaimHash(params.claim);
  const deterministic = judgeTaskCompletion({
    userRequest: params.claim.requestBody,
    finalText: params.claim.finalText,
    expectedDeliverable: "exact Control Director model-evaluation trial",
    artifactIds: params.claim.artifactIds,
    status: "succeeded",
  });
  if (!deterministic.approved) {
    throw new Error("Control Director model trial failed deterministic Judge preflight.");
  }
  const prompt = buildJudgePrompt({
    missionId: params.claim.missionId,
    requestBody: params.claim.requestBody,
    finalText: params.claim.finalText,
    evidenceSummary: params.claim.evidenceSummary,
    claimHash,
    deterministicVerdict: deterministic.verdict,
  });
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const result = await agentCommand({
    message: prompt,
    transcriptMessage: "Independent Control Director model-trial Judge review.",
    agentId: judgeAgentId,
    sessionKey: `agent:${judgeAgentId}:judge:model-trial:${params.campaignNonce}:${params.trialId}`,
    sessionId,
    runId,
    deliver: false,
    modelRun: true,
    promptMode: "none",
    suppressPromptPersistence: true,
    sessionEffects: "internal",
    disableMessageTool: true,
  });
  const endedAt = new Date().toISOString();
  const certificationLease = loadActiveCertificationLease(params);
  if (
    Date.parse(startedAt) < Date.parse(certificationLease.createdAt) ||
    Date.parse(endedAt) > Date.parse(certificationLease.expiresAt)
  ) {
    throw new Error("Judge invocation falls outside the active certification lease.");
  }
  const meta = resultMeta(result);
  const agentMeta =
    meta.agentMeta && typeof meta.agentMeta === "object"
      ? (meta.agentMeta as Record<string, unknown>)
      : {};
  const rawOutput =
    typeof meta.finalAssistantRawText === "string"
      ? meta.finalAssistantRawText
      : resultText(result);
  const finalPrompt = typeof meta.finalPromptText === "string" ? meta.finalPromptText : prompt;
  const stopReason = typeof meta.stopReason === "string" ? meta.stopReason : "";
  const provider = typeof agentMeta.provider === "string" ? agentMeta.provider.trim() : "";
  const model = typeof agentMeta.model === "string" ? agentMeta.model.trim() : "";
  const judgeModelIdentity = await resolveJudgeImmutableModelIdentity({
    agentMeta,
    provider,
    model,
    config,
    label: "Independent trial Judge",
  });
  assertImmutableModelIdentityDiversity({
    selected: trialModelIdentity,
    judge: judgeModelIdentity,
    purpose: "trial",
  });
  const parsed = parseJudgeCompletionVerdict(rawOutput);
  if (
    parsed.status !== "parsed" ||
    !provider ||
    !model ||
    `${provider}/${model}` === params.trialModelRef ||
    !SUCCESSFUL_STOP_REASONS.has(stopReason)
  ) {
    throw new Error("Independent trial Judge did not produce a valid diverse terminal verdict.");
  }
  const parsedVerdict = normalizeJudgeVerdict(parsed.verdict);
  const transcript = {
    schema: "openclaw.control-director-trial-judge-transcript.v1",
    claim: params.claim,
    claimHash,
    prompt,
    finalPrompt,
    rawOutput,
    parsed,
    trialModelRef: params.trialModelRef,
    trialModelIdentity,
    judgeModelIdentity,
    invocation: {
      runId,
      sessionId,
      judgeAgentId,
      provider,
      model,
      startedAt,
      endedAt,
      stopReason,
    },
    measurementReceiptSha256: params.measurementReceiptSha256,
    measurementSetSha256: params.measurementSetSha256,
    evidenceSetSha256: params.evidenceSetSha256,
    certificationLease,
    measurementSources: params.measurementSources,
    evidenceArtifacts: params.evidenceArtifacts,
  };
  const transcriptBytes = Buffer.from(`${JSON.stringify(transcript, null, 2)}\n`, "utf8");
  const transcriptName = `trial-judge-${params.trialId.replace(/[^A-Za-z0-9._-]/gu, "_")}-${runId}.json`;
  const transcriptPath = path.join(artifactRoot, transcriptName);
  fs.writeFileSync(transcriptPath, transcriptBytes, { flag: "wx", mode: 0o600 });
  const issuance: ControlDirectorTrialJudgeIssuance = {
    schema: "openclaw.control-director-trial-judge-issuance.v1",
    purpose: "control-director-model-trial",
    campaignNonce: params.campaignNonce,
    trialId: params.trialId,
    trialModelRef: params.trialModelRef,
    trialModelIdentity,
    judgeModelIdentity,
    measurementReceiptSha256: params.measurementReceiptSha256,
    measurementSetSha256: params.measurementSetSha256,
    evidenceSetSha256: params.evidenceSetSha256,
    certificationLease,
    transcript: {
      path: transcriptName,
      sha256: sha256Text(transcriptBytes.toString("utf8")),
      content: transcriptBytes.toString("utf8"),
    },
    invocation: {
      runId,
      sessionId,
      judgeAgentId,
      provider,
      model,
      startedAt,
      endedAt,
      requestPromptSha256: sha256Text(prompt),
      finalPromptSha256: sha256Text(finalPrompt),
      rawOutputSha256: sha256Text(rawOutput),
      stopReason,
    },
    parsing: {
      parser: "judge-six-line-v1",
      status: "parsed",
      verdict: parsedVerdict,
      parsedVerdictSha256: sha256Text(JSON.stringify(parsed)),
    },
    measurementSources: params.measurementSources,
    evidenceArtifacts: params.evidenceArtifacts,
  };
  const unsigned = unsignedReceipt({
    missionId: params.claim.missionId,
    claimHash,
    verdict: parsedVerdict,
    scope: parsed.scope,
    evidenceSummary: parsed.evidence,
    conditions: parsed.conditions,
    judgeRunId: runId,
    judgeAgentId,
    model: `${provider}/${model}`,
    now: Date.now(),
  });
  const runtimeHome = fs.realpathSync(
    process.env.OPENCLAW_CUSTOM_RUNTIME_HOME ?? path.join(os.homedir(), ".openclaw-custom-runtime"),
  );
  return withCertificationLifecycleLock(runtimeHome, params, () => {
    const currentLease = readActiveCertificationLease(params, runtimeHome);
    if (
      currentLease.epochSha256 !== certificationLease.epochSha256 ||
      currentLease.state !== certificationLease.state
    ) {
      throw new Error("Certification lease changed before trial Judge receipt issuance.");
    }
    return signJudgeReceipt({ ...unsigned, trialIssuance: issuance }, params.signingDirectory);
  });
}

/** Sign only an envelope already authorized by a valid trial-purpose Judge issuance. */
export function signControlDirectorModelTrialEnvelope(params: {
  trial: Omit<ControlDirectorModelEvalTrial, "runtimeReceipt">;
  receipt: Omit<
    ControlDirectorModelEvalTrial["runtimeReceipt"],
    "receiptSha256" | "signature" | "publicKeyId"
  >;
  signingDirectory?: string;
}): { receiptSha256: string; signature: string; publicKeyId: string } {
  const judgeReceipt = params.receipt.judgeReceipt;
  const issuance = judgeReceipt.trialIssuance;
  const currentLease = loadActiveCertificationLease({
    sourceSha: params.receipt.sourceSha,
    rollbackSha: issuance?.certificationLease?.rollbackSha ?? "",
    activeReleaseId: params.receipt.activeReleaseId,
    rollbackReleaseId: params.receipt.rollbackReleaseId,
    leaseOwner: params.receipt.leaseOwner,
    approvalId: params.receipt.approvalId,
    operationId: params.receipt.operationId,
    invocationId: params.receipt.invocationId,
  });
  const {
    judgeReceipt: _judgeReceipt,
    measurementReceiptSha256: _measurementReceiptSha256,
    ...measurementReceipt
  } = params.receipt;
  if (
    !issuance ||
    issuance.purpose !== "control-director-model-trial" ||
    params.receipt.measurementReceiptSha256 !== issuance.measurementReceiptSha256 ||
    digestControlDirectorModelEvalTrialMeasurementReceipt(params.trial, measurementReceipt) !==
      issuance.measurementReceiptSha256 ||
    digestControlDirectorModelTrialMeasurementSet(params.trial) !== issuance.measurementSetSha256 ||
    digestControlDirectorModelTrialEvidenceSet(params.receipt.artifacts) !==
      issuance.evidenceSetSha256 ||
    currentLease.epochSha256 !== issuance.certificationLease.epochSha256 ||
    !verifyJudgeReceipt(judgeReceipt, { directory: params.signingDirectory })
  ) {
    throw new Error("Trial envelope lacks a valid measurement-bound Judge issuance.");
  }
  const receiptSha256 = digestControlDirectorModelEvalTrialReceipt(params.trial, params.receipt);
  const payload = buildControlDirectorModelEvalTrialSignedPayload(params.trial, {
    ...params.receipt,
    receiptSha256,
  });
  const signed = signJudgeReceipt(payload, params.signingDirectory);
  return {
    receiptSha256,
    signature: signed.signature,
    publicKeyId: signed.publicKeyId,
  };
}
