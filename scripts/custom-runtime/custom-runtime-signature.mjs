#!/usr/bin/env node
// Verify exact release-governance receipts with the existing local device key.
// Verification never creates, repairs, or prints private key material.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SIGNATURE_SCHEMA = "openclaw.custom-runtime-signature.v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DEVICE_ID_PATTERN = /^[a-f0-9]{64}$/u;
const PRIVATE_KEY_HEADER = ["BEGIN", "PRIVATE", "KEY"].join(" ");

/** @returns {never} */
function fail(message) {
  throw new Error(`signature verification blocked: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutSignature(record) {
  if (!isRecord(record)) {
    fail("signed record is not an object");
  }
  const payload = { ...record };
  delete payload.signature;
  return payload;
}

function readPrivateJson(filePath, label) {
  let info;
  try {
    info = fs.lstatSync(filePath);
  } catch {
    fail(`${label} is missing`);
  }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    fail(`${label} is not a private regular file`);
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(value)) {
      fail(`${label} is malformed`);
    }
    return value;
  } catch (error) {
    if (error?.message?.startsWith("signature verification blocked:")) {
      throw error;
    }
    return fail(`${label} is malformed`);
  }
}

function resolveIdentityPath(identityPath) {
  return path.resolve(
    identityPath ||
      process.env.OPENCLAW_DEVICE_IDENTITY_PATH ||
      path.join(os.homedir(), ".openclaw", "identity", "device.json"),
  );
}

function loadIdentity(identityPath, includePrivate) {
  const record = readPrivateJson(resolveIdentityPath(identityPath), "device identity");
  if (
    typeof record.deviceId !== "string" ||
    !DEVICE_ID_PATTERN.test(record.deviceId) ||
    typeof record.publicKeyPem !== "string" ||
    !record.publicKeyPem.includes("BEGIN PUBLIC KEY")
  ) {
    fail("device identity shape is invalid");
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(record.publicKeyPem);
  } catch {
    fail("device public key is invalid");
  }
  const der = publicKey.export({ type: "spki", format: "der" });
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  if (!der.subarray(0, prefix.length).equals(prefix) || der.length !== prefix.length + 32) {
    fail("device public key is not Ed25519");
  }
  const derivedDeviceId = sha256(der.subarray(prefix.length));
  if (derivedDeviceId !== record.deviceId) {
    fail("device identity fingerprint does not match its public key");
  }
  if (!includePrivate) {
    return { deviceId: record.deviceId, publicKeyPem: record.publicKeyPem };
  }
  if (
    typeof record.privateKeyPem !== "string" ||
    !record.privateKeyPem.includes(PRIVATE_KEY_HEADER)
  ) {
    fail("device private key is unavailable");
  }
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(record.privateKeyPem);
  } catch {
    fail("device private key is invalid");
  }
  const selfCheckPayload = Buffer.from("openclaw-release-governance-signature-self-check", "utf8");
  const selfCheck = crypto.sign(null, selfCheckPayload, privateKey);
  if (!crypto.verify(null, selfCheckPayload, publicKey, selfCheck)) {
    fail("device key pair does not verify");
  }
  return { deviceId: record.deviceId, publicKeyPem: record.publicKeyPem, privateKey };
}

function signaturePayload(record) {
  const payload = canonicalize(withoutSignature(record));
  return { payload, payloadSha256: sha256(payload) };
}

export function verifySignedRecord({
  record,
  identityPath,
  expectedOperation,
  expectedCandidateSha,
}) {
  if (!isRecord(record) || !isRecord(record.signature)) {
    fail("signed record or signature is missing");
  }
  const signature = record.signature;
  if (
    signature.schema !== SIGNATURE_SCHEMA ||
    signature.algorithm !== "ed25519" ||
    typeof signature.deviceId !== "string" ||
    typeof signature.publicKeySha256 !== "string" ||
    typeof signature.payloadSha256 !== "string" ||
    typeof signature.signatureBase64Url !== "string" ||
    !SHA256_PATTERN.test(signature.publicKeySha256) ||
    !SHA256_PATTERN.test(signature.payloadSha256) ||
    !signature.signatureBase64Url
  ) {
    fail("signature fields are invalid");
  }
  const identity = loadIdentity(identityPath, false);
  if (signature.deviceId !== identity.deviceId) {
    fail("signature device identity does not match the local device");
  }
  const publicKey = crypto.createPublicKey(identity.publicKeyPem);
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  if (sha256(publicKeyDer) !== signature.publicKeySha256) {
    fail("signature public-key hash does not match the local device");
  }
  const { payload, payloadSha256 } = signaturePayload(record);
  if (payloadSha256 !== signature.payloadSha256) {
    fail("signature payload hash does not match the record");
  }
  if (expectedOperation !== undefined && record.operation !== expectedOperation) {
    fail("signed record operation does not match the requested operation");
  }
  if (expectedCandidateSha !== undefined && record.candidateSha !== expectedCandidateSha) {
    fail("signed record candidate does not match the requested candidate");
  }
  let signatureBytes;
  try {
    signatureBytes = Buffer.from(signature.signatureBase64Url, "base64url");
  } catch {
    fail("signature encoding is invalid");
  }
  if (
    signatureBytes.length !== 64 ||
    !crypto.verify(null, Buffer.from(payload, "utf8"), publicKey, signatureBytes)
  ) {
    fail("signature does not verify");
  }
  return { deviceId: identity.deviceId, payloadSha256 };
}

export function signRecord({ record, identityPath }) {
  if (!isRecord(record)) {
    fail("record is not an object");
  }
  const identity = loadIdentity(identityPath, true);
  const { payload, payloadSha256 } = signaturePayload(record);
  const publicKeyDer = crypto
    .createPublicKey(identity.publicKeyPem)
    .export({ type: "spki", format: "der" });
  const signatureBase64Url = crypto
    .sign(null, Buffer.from(payload, "utf8"), identity.privateKey)
    .toString("base64url");
  const signed = {
    ...withoutSignature(record),
    signature: {
      schema: SIGNATURE_SCHEMA,
      algorithm: "ed25519",
      deviceId: identity.deviceId,
      publicKeySha256: sha256(publicKeyDer),
      payloadSha256,
      signatureBase64Url,
    },
  };
  verifySignedRecord({ record: signed, identityPath });
  return signed;
}

function readJson(filePath) {
  return readPrivateJson(filePath, "signed record");
}

function writeAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail("record directory is unsafe");
  }
  try {
    const existing = fs.lstatSync(filePath);
    if (existing.isSymbolicLink() || !existing.isFile() || (existing.mode & 0o077) !== 0) {
      fail("signed record destination is unsafe");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.chmodSync(temporary, 0o600);
    const descriptor = fs.openSync(temporary, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, filePath);
    const directoryDescriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
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

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isMainModule()) {
  try {
    const { command, values } = parseCli(process.argv.slice(2));
    const recordPath = values.get("record");
    if (!recordPath) {
      fail("--record is required");
    }
    const record = readJson(recordPath);
    if (command === "sign") {
      writeAtomic(recordPath, signRecord({ record, identityPath: values.get("identity") }));
      process.stdout.write(
        JSON.stringify({ result: "signed", record: path.resolve(recordPath) }) + "\n",
      );
    } else if (command === "verify") {
      const result = verifySignedRecord({
        record,
        identityPath: values.get("identity"),
        expectedOperation: values.get("operation"),
        expectedCandidateSha: values.get("candidate-sha"),
      });
      process.stdout.write(JSON.stringify({ result: "verified", ...result }) + "\n");
    } else {
      fail("command must be sign or verify");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
