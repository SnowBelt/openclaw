#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { signRecord, verifySignedRecord } from "./custom-runtime-signature.mjs";

export const APPROVAL_ENVELOPE_SCHEMA = "openclaw.release-approval-envelope.v1";
export const APPROVAL_INGESTION_RECEIPT_SCHEMA = "openclaw.release-approval-ingestion.v1";
export const APPROVAL_REPLAY_LEDGER_SCHEMA = "openclaw.release-approval-replay-ledger.v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const ID_PATTERN = /^[A-Za-z0-9._:@/+~-]{1,200}$/u;
const MAX_APPROVAL_LIFETIME_MS = 24 * 60 * 60_000;

function fail(message) {
  throw new Error(`release approval ingestion blocked: ${message}`);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPrivateJson(filePath, label) {
  let info;
  try {
    info = fs.lstatSync(filePath);
  } catch {
    return fail(`${label} is missing`);
  }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    fail(`${label} is not a private regular file`);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(parsed)) {
      fail(`${label} is malformed`);
    }
    return parsed;
  } catch (error) {
    if (error?.message?.startsWith("release approval ingestion blocked:")) {
      throw error;
    }
    return fail(`${label} is malformed`);
  }
}

function writeDurable(filePath, value, exclusive) {
  const directory = path.dirname(path.resolve(filePath));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    const descriptor = fs.openSync(tempPath, "r");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (exclusive && fs.existsSync(filePath)) {
      fail("ingestion receipt already exists");
    }
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
    const directoryDescriptor = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function stringField(record, field) {
  const value = record[field];
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    fail(`${field} is missing or invalid`);
  }
  return value;
}

function validateEnvelope(envelope, expected, nowMs) {
  if (envelope.schema !== APPROVAL_ENVELOPE_SCHEMA) {
    fail("approval envelope schema is invalid");
  }
  const operation = stringField(envelope, "operation");
  const candidateSha = stringField(envelope, "candidateSha");
  const approvalId = stringField(envelope, "approvalId");
  const sourceThreadId = stringField(envelope, "sourceThreadId");
  const destinationThreadId = stringField(envelope, "destinationThreadId");
  const destinationHost = stringField(envelope, "destinationHost");
  const repository = stringField(envelope, "repository");
  const branch = stringField(envelope, "branch");
  const destination = stringField(envelope, "destination");
  const nonce = stringField(envelope, "nonce");
  if (!SHA_PATTERN.test(candidateSha)) {
    fail("candidateSha is invalid");
  }
  if (!SHA256_PATTERN.test(envelope.authorizationMaterialSha256)) {
    fail("authorization material hash is invalid");
  }
  const grantedAtMs = Date.parse(envelope.grantedAt);
  const expiresAtMs = Date.parse(envelope.expiresAt);
  if (
    !Number.isFinite(grantedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= grantedAtMs ||
    expiresAtMs - grantedAtMs > MAX_APPROVAL_LIFETIME_MS ||
    grantedAtMs > nowMs ||
    expiresAtMs <= nowMs
  ) {
    fail("approval lifetime is invalid or expired");
  }
  const actual = {
    operation,
    candidateSha,
    approvalId,
    sourceThreadId,
    destinationThreadId,
    destinationHost,
    repository,
    branch,
    destination,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (expectedValue !== undefined && actual[field] !== expectedValue) {
      fail(`${field} does not match the requested operation`);
    }
  }
  return { ...actual, nonce, grantedAt: envelope.grantedAt, expiresAt: envelope.expiresAt };
}

function readLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) {
    return { schema: APPROVAL_REPLAY_LEDGER_SCHEMA, consumed: [] };
  }
  const ledger = readPrivateJson(ledgerPath, "approval replay ledger");
  if (
    ledger.schema !== APPROVAL_REPLAY_LEDGER_SCHEMA ||
    !Array.isArray(ledger.consumed) ||
    ledger.consumed.some(
      (entry) =>
        !isRecord(entry) ||
        typeof entry.nonce !== "string" ||
        typeof entry.envelopePayloadSha256 !== "string",
    )
  ) {
    fail("approval replay ledger is malformed");
  }
  return ledger;
}

function withLedgerLock(ledgerPath, callback) {
  const lockPath = `${ledgerPath}.lock`;
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("approval replay ledger is locked");
    }
    throw error;
  }
  try {
    return callback();
  } finally {
    fs.rmdirSync(lockPath);
  }
}

export function ingestReleaseApproval(params) {
  const envelope = readPrivateJson(params.envelopePath, "signed approval envelope");
  const signature = verifySignedRecord({
    record: envelope,
    identityPath: params.identityPath,
    expectedOperation: params.expected.operation,
    expectedCandidateSha: params.expected.candidateSha,
  });
  const now = params.now ?? new Date();
  const binding = validateEnvelope(envelope, params.expected, now.getTime());
  return withLedgerLock(params.ledgerPath, () => {
    const ledger = readLedger(params.ledgerPath);
    if (
      ledger.consumed.some(
        (entry) =>
          entry.nonce === binding.nonce || entry.envelopePayloadSha256 === signature.payloadSha256,
      )
    ) {
      fail("approval envelope was already consumed");
    }
    const receipt = signRecord({
      identityPath: params.identityPath,
      record: {
        schema: APPROVAL_INGESTION_RECEIPT_SCHEMA,
        ...binding,
        authorizationMaterialSha256: envelope.authorizationMaterialSha256,
        envelopePayloadSha256: signature.payloadSha256,
        signerDeviceId: signature.deviceId,
        consumedAt: now.toISOString(),
      },
    });
    writeDurable(params.receiptPath, receipt, true);
    writeDurable(
      params.ledgerPath,
      {
        schema: APPROVAL_REPLAY_LEDGER_SCHEMA,
        consumed: [
          ...ledger.consumed,
          {
            nonce: binding.nonce,
            envelopePayloadSha256: signature.payloadSha256,
            approvalId: binding.approvalId,
            consumedAt: now.toISOString(),
            receiptPath: path.resolve(params.receiptPath),
          },
        ].slice(-10_000),
      },
      false,
    );
    return receipt;
  });
}

export function verifyReleaseApprovalReceipt(params) {
  const receipt = readPrivateJson(params.receiptPath, "approval ingestion receipt");
  const verified = verifySignedRecord({
    record: receipt,
    identityPath: params.identityPath,
    expectedOperation: params.expected.operation,
    expectedCandidateSha: params.expected.candidateSha,
  });
  if (receipt.schema !== APPROVAL_INGESTION_RECEIPT_SCHEMA) {
    fail("approval ingestion receipt schema is invalid");
  }
  validateEnvelope(
    {
      ...receipt,
      schema: APPROVAL_ENVELOPE_SCHEMA,
      authorizationMaterialSha256: receipt.authorizationMaterialSha256,
    },
    params.expected,
    (params.now ?? new Date()).getTime(),
  );
  if (
    !SHA256_PATTERN.test(receipt.envelopePayloadSha256) ||
    !SHA256_PATTERN.test(receipt.authorizationMaterialSha256) ||
    receipt.signerDeviceId !== verified.deviceId
  ) {
    fail("approval ingestion receipt binding is invalid");
  }
  return { deviceId: verified.deviceId, payloadSha256: verified.payloadSha256 };
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`invalid argument near ${key ?? "<end>"}`);
    }
    values.set(key.slice(2), value);
  }
  return { command, values };
}

function required(values, key) {
  const value = values.get(key);
  if (!value) {
    fail(`--${key} is required`);
  }
  return value;
}

function expectedFrom(values) {
  return {
    operation: required(values, "operation"),
    candidateSha: required(values, "candidate-sha"),
    approvalId: required(values, "approval-id"),
    sourceThreadId: required(values, "source-thread-id"),
    destinationThreadId: required(values, "destination-thread-id"),
    destinationHost: required(values, "destination-host"),
    repository: required(values, "repository"),
    branch: required(values, "branch"),
    destination: required(values, "destination"),
  };
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isMainModule()) {
  try {
    const { command, values } = parseCli(process.argv.slice(2));
    const common = {
      identityPath: values.get("identity"),
      expected: expectedFrom(values),
    };
    if (command === "ingest") {
      const receipt = ingestReleaseApproval({
        ...common,
        envelopePath: required(values, "envelope"),
        receiptPath: required(values, "receipt"),
        ledgerPath: required(values, "ledger"),
      });
      process.stdout.write(
        `${JSON.stringify({ result: "ingested", receipt: path.resolve(required(values, "receipt")), payloadSha256: receipt.signature.payloadSha256 })}\n`,
      );
    } else if (command === "verify") {
      const verified = verifyReleaseApprovalReceipt({
        ...common,
        receiptPath: required(values, "receipt"),
      });
      process.stdout.write(`${JSON.stringify({ result: "verified", ...verified })}\n`);
    } else {
      fail("command must be ingest or verify");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 78;
  }
}
