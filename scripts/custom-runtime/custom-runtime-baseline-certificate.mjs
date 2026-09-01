#!/usr/bin/env node
// Bind every strict-green update gate to one immutable candidate identity.
// This certificate records only hashes and already-produced proof receipts; it
// never turns a missing or failed proof into a pass.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CUSTOM_RUNTIME_BASELINE_CERTIFICATE_SCHEMA =
  "openclaw.custom-runtime-baseline-certificate.v1";
export const CUSTOM_RUNTIME_BASELINE_CERTIFICATE_VERSION = 1;
export const DEFAULT_BASELINE_WORKFLOW = ".github/workflows/control-director-reliability.yml";
export const DEFAULT_BASELINE_REPOSITORY = "SnowBelt/openclaw";

const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/u;
const MAX_CERTIFICATE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ROLLBACK_SUCCESS_RESULTS = new Set(["passed", "rollback_ready", "rolled_back_verified"]);

/** @returns {never} */
function fail(message) {
  throw new Error(`custom runtime baseline certificate blocked: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(filePath, label) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(value)) {
      return fail(`${label} is not a JSON object`);
    }
    return value;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("custom runtime baseline certificate blocked:")
    ) {
      throw error;
    }
    return fail(`${label} is missing or malformed`);
  }
}

function writeAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function baselineCertificateHash(input) {
  return crypto
    .createHash("sha256")
    .update(`${JSON.stringify(canonicalize(input), null, 2)}\n`)
    .digest("hex");
}

function exactSourceSha(value, label) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!SOURCE_SHA_PATTERN.test(normalized)) {
    fail(`${label} must be an exact lowercase Git SHA`);
  }
  return normalized;
}

function normalizedBranch(value) {
  if (typeof value !== "string" || !value.trim() || !BRANCH_PATTERN.test(value)) {
    fail("branch is invalid");
  }
  if (
    spawnSync("git", ["check-ref-format", "--branch", value], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).status !== 0
  ) {
    fail("branch is not a valid Git branch name");
  }
  return value;
}

function trustedWorkflowPath(value) {
  const normalized = normalizedRelativePath(value, "workflow path");
  if (!normalized.startsWith(".github/workflows/") || !normalized.endsWith(".yml")) {
    fail("trusted workflow must be a repository-native .github/workflows YAML file");
  }
  return normalized;
}

function normalizedRelativePath(value, label) {
  if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)) {
    fail(`${label} must be repository-relative`);
  }
  const normalized = value.replaceAll("\\", "/");
  const posix = path.posix.normalize(normalized);
  if (
    posix !== normalized ||
    posix === "." ||
    posix === ".." ||
    posix.startsWith("../") ||
    path.posix.isAbsolute(posix)
  ) {
    fail(`${label} must be a normalized repository-relative path`);
  }
  return posix;
}

function sameOrChild(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function regularFile(filePath, label, { privateFile = false } = {}) {
  let info;
  try {
    info = fs.lstatSync(filePath);
  } catch {
    fail(`${label} is missing`);
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    fail(`${label} is not a regular non-symlink file`);
  }
  if (privateFile && (info.mode & 0o077) !== 0) {
    fail(`${label} is not private`);
  }
}

function privateEvidencePath(filePath, evidenceRoot, label) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(evidenceRoot);
  if (!sameOrChild(resolved, root)) {
    fail(`${label} is outside the evidence root`);
  }
  regularFile(resolved, label, { privateFile: true });
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(root);
    realFile = fs.realpathSync(resolved);
  } catch {
    fail(`${label} cannot be resolved safely`);
  }
  if (!sameOrChild(realFile, realRoot)) {
    fail(`${label} escapes the evidence root through a symlink`);
  }
  return realFile;
}

function runGit(repoRoot, args, label) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15 * 60 * 1000,
  });
  if (result.error || result.status !== 0) {
    fail(`${label} failed: ${result.stderr?.trim() || result.error?.message || result.status}`);
  }
  return result.stdout.trim();
}

function assertStandaloneSource(sourceRoot, sourceSha, branch) {
  let root;
  try {
    root = fs.realpathSync(path.resolve(sourceRoot));
  } catch {
    fail("source repository is missing");
  }
  regularFile(path.join(root, ".git", "HEAD"), "source Git HEAD");
  let gitInfo;
  try {
    gitInfo = fs.lstatSync(path.join(root, ".git"));
  } catch {
    fail("source Git directory is missing");
  }
  if (!gitInfo.isDirectory() || gitInfo.isSymbolicLink()) {
    fail("source must use a standalone Git directory");
  }
  if (fs.existsSync(path.join(root, ".git", "commondir"))) {
    fail("source must not use a shared Git directory");
  }
  const gitDirectory = path.resolve(
    root,
    runGit(root, ["rev-parse", "--git-dir"], "source Git directory"),
  );
  const commonDirectory = path.resolve(
    root,
    runGit(root, ["rev-parse", "--git-common-dir"], "source Git common directory"),
  );
  if (gitDirectory !== commonDirectory) {
    fail("source must not use a shared Git object database");
  }
  if (runGit(root, ["branch", "--show-current"], "source branch") !== branch) {
    fail("source branch does not match the certificate");
  }
  if (runGit(root, ["rev-parse", "HEAD"], "source HEAD") !== sourceSha) {
    fail("source HEAD does not match the certificate");
  }
  if (runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"], "source status")) {
    fail("source checkout is dirty");
  }
  runGit(root, ["fsck", "--full", "--strict"], "source Git integrity");
  return root;
}

function sourceBinding(sourceRoot, relativePath, label, { requireTracked = true } = {}) {
  const normalized = normalizedRelativePath(relativePath, label);
  const filePath = path.join(sourceRoot, normalized);
  regularFile(filePath, label);
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(sourceRoot);
    realFile = fs.realpathSync(filePath);
  } catch {
    fail(`${label} cannot be resolved safely`);
  }
  if (!sameOrChild(realFile, realRoot)) {
    fail(`${label} escapes the source checkout through a symlink`);
  }
  if (requireTracked) {
    runGit(sourceRoot, ["ls-files", "--error-unmatch", "--", normalized], `${label} tracking`);
  }
  return { path: normalized, sha256: sha256File(realFile) };
}

function validateCapabilityManifest(sourceRoot, binding, sourceSha) {
  const manifest = readJson(path.join(sourceRoot, binding.path), "capability manifest");
  if (
    manifest.schema !== "openclaw.custom-runtime-capabilities.v2" ||
    !Number.isInteger(manifest.version) ||
    manifest.version < 5 ||
    !Array.isArray(manifest.capabilities) ||
    !isRecord(manifest.preservation) ||
    manifest.preservation.contractVersion !== 2 ||
    manifest.preservation.criticality !== "required" ||
    manifest.preservation.migrationPolicy !== "preserve_or_block" ||
    manifest.preservation.rollbackPolicy !== "immutable_release_pointer" ||
    manifest.preservation.sourceStrategy !== "merge_from_active_sha" ||
    manifest.preservation.dashboardChangePolicy !== "register_verify_and_block" ||
    manifest.preservation.approvalPolicy !== "explicit_exact_candidate" ||
    manifest.preservation.proofCommand !== "pnpm custom-runtime:update-survival"
  ) {
    fail("capability manifest is not the required preservation contract");
  }
  if (typeof manifest.sourceSha === "string" && manifest.sourceSha !== sourceSha) {
    fail("capability manifest source identity does not match the certificate");
  }
  return manifest;
}

function validateCompletenessManifest(sourceRoot, binding, sourceSha) {
  const manifest = readJson(path.join(sourceRoot, binding.path), "completeness manifest");
  if (
    manifest.schema !== "openclaw.custom-runtime-completeness.v1" ||
    manifest.version !== 1 ||
    !isRecord(manifest.source) ||
    manifest.source.commit !== sourceSha ||
    !isRecord(manifest.build) ||
    !isRecord(manifest.artifacts)
  ) {
    fail("completeness manifest is not bound to the exact source SHA");
  }
  return manifest;
}

function evidenceIdentity(receipt, label, sourceSha) {
  const candidates = [receipt.sourceSha, receipt.candidateSha, receipt.sourceCommit];
  const identity = candidates.find((value) => typeof value === "string" && value.trim());
  if (!identity || identity.trim().toLowerCase() !== sourceSha) {
    fail(`${label} is not bound to the exact source SHA`);
  }
}

function evidencePassed(receipt, label, role) {
  const result = typeof receipt.result === "string" ? receipt.result : "";
  const passed = result === "passed" || (!result && receipt.passed === true);
  const rollbackReady = role === "rollback" && ROLLBACK_SUCCESS_RESULTS.has(result);
  if (!passed && !rollbackReady) {
    fail(`${label} does not contain an accepted successful result`);
  }
}

function proofBinding({ id, filePath, evidenceRoot, sourceSha, role }) {
  if (typeof id !== "string" || !/^[A-Za-z0-9._:-]+$/u.test(id)) {
    fail(`${role} evidence id is invalid`);
  }
  const resolved = privateEvidencePath(filePath, evidenceRoot, `${role} evidence`);
  const receipt = readJson(resolved, `${role} evidence`);
  evidenceIdentity(receipt, `${role} evidence`, sourceSha);
  evidencePassed(receipt, `${role} evidence`, role);
  return {
    id,
    path: resolved,
    sha256: sha256File(resolved),
    schema: typeof receipt.schema === "string" ? receipt.schema : null,
    sourceSha,
  };
}

function validateEvidenceSet({ evidence, sourceSha, evidenceRoot }) {
  const byPath = new Set();
  const bindings = {};
  for (const role of ["security", "runtime", "rollback"]) {
    const filePath = evidence?.[role];
    if (typeof filePath !== "string" || !filePath) {
      fail(`${role} evidence is required`);
    }
    const binding = proofBinding({
      id: role,
      filePath,
      evidenceRoot,
      sourceSha,
      role,
    });
    if (byPath.has(binding.path)) {
      fail("security, runtime, and rollback evidence must be distinct receipts");
    }
    byPath.add(binding.path);
    bindings[role] = binding;
  }
  if (!Array.isArray(evidence?.proofs) || evidence.proofs.length === 0) {
    fail("at least one proof receipt is required");
  }
  const proofs = evidence.proofs
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.path !== "string") {
        fail("proof receipt entries must contain an id and path");
      }
      const binding = proofBinding({
        id: entry.id,
        filePath: entry.path,
        evidenceRoot,
        sourceSha,
        role: "proof",
      });
      if (byPath.has(binding.path)) {
        fail("every certificate evidence receipt must be a distinct file");
      }
      byPath.add(binding.path);
      return binding;
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const ids = proofs.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    fail("proof receipt ids must be unique");
  }
  return { ...bindings, proofs };
}

function verifyCertificateEvidenceBinding({ binding, role, sourceSha, evidenceRoot }) {
  if (
    !isRecord(binding) ||
    typeof binding.id !== "string" ||
    !/^[A-Za-z0-9._:-]+$/u.test(binding.id) ||
    typeof binding.path !== "string"
  ) {
    fail(`${role} evidence binding is invalid`);
  }
  if (["security", "runtime", "rollback"].includes(role) && binding.id !== role) {
    fail(`${role} evidence id changed after certification`);
  }
  const resolved = privateEvidencePath(binding.path, evidenceRoot, `${role} evidence`);
  const receipt = readJson(resolved, `${role} evidence`);
  evidenceIdentity(receipt, `${role} evidence`, sourceSha);
  evidencePassed(receipt, `${role} evidence`, role);
  const digest = sha256File(resolved);
  if (binding.sha256 !== digest || binding.sourceSha !== sourceSha) {
    fail(`${role} evidence hash or source identity changed after certification`);
  }
  if (
    (typeof receipt.schema === "string" ? receipt.schema : null) !==
    (typeof binding.schema === "string" ? binding.schema : null)
  ) {
    fail(`${role} evidence schema changed after certification`);
  }
  return { ...binding, path: resolved, sha256: digest, sourceSha };
}

function verifyCertificateEvidenceSet({ evidence, sourceSha, evidenceRoot }) {
  if (!isRecord(evidence)) {
    fail("certificate evidence is missing");
  }
  const byPath = new Set();
  const bindings = {};
  for (const role of ["security", "runtime", "rollback"]) {
    const binding = verifyCertificateEvidenceBinding({
      binding: evidence[role],
      role,
      sourceSha,
      evidenceRoot,
    });
    if (byPath.has(binding.path)) {
      fail("certificate evidence receipts must be distinct files");
    }
    byPath.add(binding.path);
    bindings[role] = binding;
  }
  if (!Array.isArray(evidence.proofs) || evidence.proofs.length === 0) {
    fail("certificate proof receipts are missing");
  }
  const proofs = evidence.proofs.map((binding) => {
    const verified = verifyCertificateEvidenceBinding({
      binding,
      role: "proof",
      sourceSha,
      evidenceRoot,
    });
    if (byPath.has(verified.path)) {
      fail("certificate evidence receipts must be distinct files");
    }
    byPath.add(verified.path);
    return verified;
  });
  const ids = proofs.map((binding) => binding.id);
  if (new Set(ids).size !== ids.length) {
    fail("certificate proof receipt ids must be unique");
  }
  return { ...bindings, proofs };
}

function certificateInput({
  sourceRoot,
  sourceSha,
  branch,
  repository,
  workflowPath,
  lockfilePath,
  capabilityManifestPath,
  completenessManifestPath,
  evidence,
  evidenceRoot,
  checkedAt,
}) {
  const normalizedSha = exactSourceSha(sourceSha, "sourceSha");
  const normalizedBranchValue = normalizedBranch(branch);
  const root = assertStandaloneSource(sourceRoot, normalizedSha, normalizedBranchValue);
  if (repository !== DEFAULT_BASELINE_REPOSITORY) {
    fail(`repository must be ${DEFAULT_BASELINE_REPOSITORY}`);
  }
  const normalizedWorkflow = trustedWorkflowPath(workflowPath);
  const workflow = sourceBinding(root, normalizedWorkflow, "trusted workflow");
  const lockfile = sourceBinding(root, lockfilePath, "lockfile");
  const capabilities = sourceBinding(root, capabilityManifestPath, "capability manifest");
  const completeness = sourceBinding(root, completenessManifestPath, "completeness manifest", {
    // The completeness manifest is generated from the exact checkout during
    // the build and is intentionally not a tracked source file.
    requireTracked: false,
  });
  validateCapabilityManifest(root, capabilities, normalizedSha);
  validateCompletenessManifest(root, completeness, normalizedSha);
  const parsedEvidence = validateEvidenceSet({ evidence, sourceSha: normalizedSha, evidenceRoot });
  const createdAt = checkedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) {
    fail("certificate timestamp is invalid");
  }
  return {
    schema: CUSTOM_RUNTIME_BASELINE_CERTIFICATE_SCHEMA,
    version: CUSTOM_RUNTIME_BASELINE_CERTIFICATE_VERSION,
    sourceRoot: root,
    sourceSha: normalizedSha,
    branch: normalizedBranchValue,
    repository,
    trustedWorkflow: workflow,
    lockfile,
    manifests: {
      capabilities,
      completeness,
    },
    evidence: parsedEvidence,
    createdAt,
    result: "passed",
  };
}

export function createBaselineCertificate(params) {
  const input = certificateInput(params);
  const certificate = {
    ...input,
    certificateSha256: baselineCertificateHash(input),
  };
  writeAtomic(params.outputPath, certificate);
  return {
    ...certificate,
    certificatePath: path.resolve(params.outputPath),
  };
}

function readBindingFile(binding, label, root, { relativeToRoot = false, evidenceRoot } = {}) {
  if (
    !isRecord(binding) ||
    typeof binding.path !== "string" ||
    !SHA256_PATTERN.test(String(binding.sha256))
  ) {
    fail(`${label} binding is invalid`);
  }
  const filePath = relativeToRoot
    ? path.join(root, normalizedRelativePath(binding.path, label))
    : privateEvidencePath(binding.path, evidenceRoot, label);
  if (relativeToRoot) {
    try {
      const resolvedRoot = fs.realpathSync(root);
      const resolvedFile = fs.realpathSync(filePath);
      if (!sameOrChild(resolvedFile, resolvedRoot)) {
        fail(`${label} escapes the source checkout through a symlink`);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("custom runtime baseline certificate blocked:")
      ) {
        throw error;
      }
      fail(`${label} cannot be resolved safely`);
    }
  }
  regularFile(filePath, label, { privateFile: !relativeToRoot });
  if (sha256File(filePath) !== String(binding.sha256).toLowerCase()) {
    fail(`${label} hash changed after certification`);
  }
  return filePath;
}

export function verifyBaselineCertificate({
  certificatePath,
  expectedSha,
  sourceRoot,
  evidenceRoot,
  maxAgeMs = MAX_CERTIFICATE_AGE_MS,
}) {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    fail("certificate maximum age is invalid");
  }
  const resolvedCertificate = path.resolve(certificatePath);
  regularFile(resolvedCertificate, "baseline certificate", { privateFile: true });
  const certificate = readJson(resolvedCertificate, "baseline certificate");
  const sourceSha = exactSourceSha(expectedSha, "expectedSha");
  if (
    certificate.schema !== CUSTOM_RUNTIME_BASELINE_CERTIFICATE_SCHEMA ||
    certificate.version !== CUSTOM_RUNTIME_BASELINE_CERTIFICATE_VERSION ||
    certificate.result !== "passed" ||
    typeof certificate.sourceRoot !== "string" ||
    certificate.sourceSha !== sourceSha ||
    certificate.repository !== DEFAULT_BASELINE_REPOSITORY ||
    typeof certificate.certificateSha256 !== "string"
  ) {
    fail("certificate identity or result is invalid");
  }
  const { certificateSha256, ...input } = certificate;
  if (baselineCertificateHash(input) !== certificateSha256) {
    fail("certificate hash does not match its contents");
  }
  const createdAt = Date.parse(String(certificate.createdAt ?? ""));
  if (
    !Number.isFinite(createdAt) ||
    createdAt > Date.now() + 60_000 ||
    Date.now() - createdAt > maxAgeMs
  ) {
    fail("certificate is stale or future-dated");
  }
  const branch = normalizedBranch(certificate.branch);
  const root = assertStandaloneSource(sourceRoot, sourceSha, branch);
  if (certificate.sourceRoot !== root) {
    fail("certificate source root does not match the verified checkout");
  }
  const workflowPath = readBindingFile(certificate.trustedWorkflow, "trusted workflow", root, {
    relativeToRoot: true,
  });
  trustedWorkflowPath(certificate.trustedWorkflow?.path);
  readBindingFile(certificate.lockfile, "lockfile", root, { relativeToRoot: true });
  const capabilitiesPath = readBindingFile(
    certificate.manifests?.capabilities,
    "capability manifest",
    root,
    {
      relativeToRoot: true,
    },
  );
  const completenessPath = readBindingFile(
    certificate.manifests?.completeness,
    "completeness manifest",
    root,
    {
      relativeToRoot: true,
    },
  );
  validateCapabilityManifest(
    root,
    {
      path: path.relative(root, capabilitiesPath).replaceAll("\\", "/"),
    },
    sourceSha,
  );
  validateCompletenessManifest(
    root,
    {
      path: path.relative(root, completenessPath).replaceAll("\\", "/"),
    },
    sourceSha,
  );
  const evidenceBindings = verifyCertificateEvidenceSet({
    evidence: certificate.evidence,
    sourceSha,
    evidenceRoot,
  });
  return {
    result: "verified",
    certificatePath: resolvedCertificate,
    certificateSha256,
    sourceSha,
    trustedWorkflow: workflowPath,
    proofCount: evidenceBindings.proofs.length,
  };
}

function parseOptions(argv) {
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

function requiredOption(values, name) {
  const value = values.get(name);
  if (typeof value !== "string" || !value.trim()) {
    fail(`--${name} is required`);
  }
  return value;
}

function proofArguments(values) {
  const proofs = [];
  const raw = values.get("proof");
  if (raw) {
    for (const item of raw.split(",")) {
      const separator = item.indexOf("=");
      if (separator <= 0 || separator === item.length - 1) {
        fail("--proof must be ID=PATH entries separated by commas");
      }
      proofs.push({ id: item.slice(0, separator), path: item.slice(separator + 1) });
    }
  }
  return proofs;
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isMainModule()) {
  try {
    const { command, values } = parseOptions(process.argv.slice(2));
    const sourceRoot = path.resolve(requiredOption(values, "source"));
    const evidenceRoot = path.resolve(requiredOption(values, "evidence-root"));
    const result =
      command === "create"
        ? createBaselineCertificate({
            sourceRoot,
            sourceSha: requiredOption(values, "sha"),
            branch: requiredOption(values, "branch"),
            repository: values.get("repository") || DEFAULT_BASELINE_REPOSITORY,
            workflowPath: values.get("workflow") || DEFAULT_BASELINE_WORKFLOW,
            lockfilePath: values.get("lockfile") || "pnpm-lock.yaml",
            capabilityManifestPath:
              values.get("capabilities") || "config/custom-runtime-capabilities.json",
            completenessManifestPath:
              values.get("completeness") || "dist/custom-runtime-completeness.json",
            evidence: {
              security: values.get("security") || "",
              runtime: values.get("runtime") || "",
              rollback: values.get("rollback") || "",
              proofs: proofArguments(values),
            },
            evidenceRoot,
            outputPath: path.resolve(requiredOption(values, "output")),
          })
        : command === "verify"
          ? verifyBaselineCertificate({
              certificatePath: path.resolve(requiredOption(values, "certificate")),
              expectedSha: requiredOption(values, "sha"),
              sourceRoot,
              evidenceRoot,
            })
          : fail("command must be create or verify");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
