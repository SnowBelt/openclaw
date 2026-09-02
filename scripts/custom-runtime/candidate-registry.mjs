#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CANDIDATE_REGISTRY_SCHEMA = "openclaw.custom-runtime-candidate-registry.v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/u;
const STATES = new Set(["sealed", "smoked", "staged", "active", "superseded", "failed"]);
const TRANSITIONS = new Map([
  ["sealed", new Set(["smoked", "failed"])],
  ["smoked", new Set(["staged", "failed"])],
  ["staged", new Set(["active", "failed"])],
  ["active", new Set(["superseded", "failed"])],
  ["superseded", new Set()],
  ["failed", new Set()],
]);

function fail(message) {
  throw new Error(`candidate registry blocked: ${message}`);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function sha256Value(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function privateRegular(filePath, label) {
  let info;
  try {
    info = fs.lstatSync(filePath);
  } catch {
    fail(`${label} is missing`);
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    fail(`${label} is unsafe`);
  }
  return info;
}

function readJson(filePath, label) {
  privateRegular(filePath, label);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(parsed)) {
      fail(`${label} is malformed`);
    }
    return parsed;
  } catch (error) {
    if (error?.message?.startsWith("candidate registry blocked:")) {
      throw error;
    }
    fail(`${label} is malformed`);
  }
}

function writeAtomic(filePath, value) {
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

function withRegistryLock(registryPath, callback) {
  const lockPath = `${registryPath}.lock`;
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("registry is locked");
    }
    throw error;
  }
  try {
    return callback();
  } finally {
    fs.rmdirSync(lockPath);
  }
}

function readRegistry(registryPath) {
  if (!fs.existsSync(registryPath)) {
    return { schema: CANDIDATE_REGISTRY_SCHEMA, candidates: {} };
  }
  const registry = readJson(registryPath, "candidate registry");
  if (registry.schema !== CANDIDATE_REGISTRY_SCHEMA || !isRecord(registry.candidates)) {
    fail("candidate registry schema is invalid");
  }
  return registry;
}

function assertInside(root, candidate, label) {
  const resolvedRoot = fs.realpathSync(root);
  const resolvedCandidate = fs.realpathSync(candidate);
  if (
    resolvedCandidate === resolvedRoot ||
    !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    fail(`${label} is outside the immutable release`);
  }
  return resolvedCandidate;
}

function inspectSealedRelease(releaseRoot) {
  const root = fs.realpathSync(releaseRoot);
  const releaseInfo = fs.lstatSync(root);
  if (!releaseInfo.isDirectory() || releaseInfo.isSymbolicLink()) {
    fail("release root is unsafe");
  }
  const releaseId = path.basename(root);
  if (!RELEASE_ID_PATTERN.test(releaseId)) {
    fail("release ID is invalid");
  }
  const sourceStamp = path.join(root, ".openclaw-production-sha");
  const sealMarker = path.join(root, ".openclaw-runtime-sealed");
  const snapshotPath = path.join(root, "snapshot.json");
  privateRegular(sourceStamp, "source stamp");
  privateRegular(sealMarker, "seal marker");
  const sourceSha = fs.readFileSync(sourceStamp, "utf8").trim();
  if (!SOURCE_SHA_PATTERN.test(sourceSha)) {
    fail("source identity is invalid");
  }
  const marker = fs.readFileSync(sealMarker, "utf8").trim().split(/\s+/u);
  const snapshot = readJson(snapshotPath, "runtime snapshot");
  if (
    marker[0] !== sourceSha ||
    snapshot.releaseId !== releaseId ||
    snapshot.root !== root ||
    snapshot.source?.commit !== sourceSha ||
    !SHA256_PATTERN.test(snapshot.artifactHash) ||
    !SHA256_PATTERN.test(snapshot.runtimeClosureHash) ||
    marker[1] !== snapshot.runtimeClosureHash
  ) {
    fail("sealed release identity is inconsistent");
  }
  const capabilityPath = path.join(root, "config", "custom-runtime-capabilities.json");
  privateRegular(capabilityPath, "capability manifest");
  const provenancePath = path.join(root, ".openclaw-runtime-provenance.json");
  let provenanceSha256 = null;
  if (fs.existsSync(provenancePath)) {
    const provenance = readJson(provenancePath, "runtime provenance envelope");
    if (provenance.schema !== "openclaw.custom-runtime-runtime-provenance.v2") {
      fail("runtime provenance is not self-contained v2");
    }
    const bundlePath = assertInside(root, provenance.bundlePath, "runtime provenance bundle");
    privateRegular(bundlePath, "runtime provenance bundle");
    if (sha256File(bundlePath) !== provenance.bundleSha256) {
      fail("runtime provenance bundle hash mismatch");
    }
    provenanceSha256 = sha256File(provenancePath);
  }
  const identity = {
    releaseId,
    releaseRoot: root,
    sourceSha,
    artifactSha256: snapshot.artifactHash,
    runtimeClosureSha256: snapshot.runtimeClosureHash,
    snapshotSha256: sha256File(snapshotPath),
    capabilityManifestSha256: sha256File(capabilityPath),
    provenanceSha256,
  };
  return { ...identity, identitySha256: sha256Value(identity) };
}

export function registerSealedCandidate({ registryPath, releaseRoot, now = new Date() }) {
  const identity = inspectSealedRelease(releaseRoot);
  return withRegistryLock(registryPath, () => {
    const registry = readRegistry(registryPath);
    const existing = registry.candidates[identity.releaseId];
    if (existing) {
      if (existing.identitySha256 !== identity.identitySha256 || existing.state !== "sealed") {
        fail("release ID is already registered with different identity or state");
      }
      return existing;
    }
    const candidate = {
      ...identity,
      state: "sealed",
      registeredAt: now.toISOString(),
      transitions: [],
    };
    writeAtomic(registryPath, {
      schema: CANDIDATE_REGISTRY_SCHEMA,
      candidates: { ...registry.candidates, [identity.releaseId]: candidate },
    });
    return candidate;
  });
}

export function verifyRegisteredCandidate({ registryPath, releaseRoot, expectedState }) {
  const identity = inspectSealedRelease(releaseRoot);
  const registry = readRegistry(registryPath);
  const candidate = registry.candidates[identity.releaseId];
  if (!isRecord(candidate) || candidate.identitySha256 !== identity.identitySha256) {
    fail("candidate is missing or identity-bound bytes drifted");
  }
  if (expectedState && candidate.state !== expectedState) {
    fail(`candidate state is ${String(candidate.state)}, expected ${expectedState}`);
  }
  return candidate;
}

export function transitionCandidate({
  registryPath,
  releaseRoot,
  expectedState,
  nextState,
  operationId,
  evidenceSha256,
  now = new Date(),
}) {
  if (!STATES.has(expectedState) || !STATES.has(nextState)) {
    fail("candidate transition state is invalid");
  }
  if (!TRANSITIONS.get(expectedState)?.has(nextState)) {
    fail(`candidate transition ${expectedState} -> ${nextState} is not allowed`);
  }
  if (!RELEASE_ID_PATTERN.test(operationId) || !SHA256_PATTERN.test(evidenceSha256)) {
    fail("candidate transition evidence is invalid");
  }
  const identity = inspectSealedRelease(releaseRoot);
  return withRegistryLock(registryPath, () => {
    const registry = readRegistry(registryPath);
    const current = registry.candidates[identity.releaseId];
    if (
      !isRecord(current) ||
      current.identitySha256 !== identity.identitySha256 ||
      current.state !== expectedState ||
      !Array.isArray(current.transitions)
    ) {
      fail("candidate transition preflight does not match registry state");
    }
    const transition = {
      from: expectedState,
      to: nextState,
      operationId,
      evidenceSha256,
      recordedAt: now.toISOString(),
    };
    const candidate = {
      ...current,
      state: nextState,
      transitions: [...current.transitions, transition],
    };
    writeAtomic(registryPath, {
      schema: CANDIDATE_REGISTRY_SCHEMA,
      candidates: { ...registry.candidates, [identity.releaseId]: candidate },
    });
    return candidate;
  });
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

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isMainModule()) {
  try {
    const { command, values } = parseCli(process.argv.slice(2));
    const common = {
      registryPath: required(values, "registry"),
      releaseRoot: required(values, "release"),
    };
    const result =
      command === "register"
        ? registerSealedCandidate(common)
        : command === "verify"
          ? verifyRegisteredCandidate({ ...common, expectedState: values.get("state") })
          : command === "transition"
            ? transitionCandidate({
                ...common,
                expectedState: required(values, "from"),
                nextState: required(values, "to"),
                operationId: required(values, "operation-id"),
                evidenceSha256: required(values, "evidence-sha256"),
              })
            : fail("command must be register, verify, or transition");
    process.stdout.write(`${JSON.stringify({ result: "ok", candidate: result })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 78;
  }
}
