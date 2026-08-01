#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveAgentIdByOperationalRole } from "../src/agents/agent-scope-config.ts";
import {
  CONTROL_DIRECTOR_STABILITY_SAMPLE_SCHEMA,
  buildControlDirectorCacheIdentityEvidence,
  digestControlDirectorStabilitySample,
} from "../src/agents/control-director-model-governance-proof.ts";
import { buildControlDirectorModelRegistry } from "../src/agents/control-director-model-registry.ts";
import { verifyControlDirectorCapabilityObservation } from "./control-director-capability-observer.mjs";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

function fail(message) {
  throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function digestFile(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseOllamaList(output) {
  const models = new Set();
  for (const line of String(output).split(/\r?\n/u)) {
    const [name] = line.trim().split(/\s+/u);
    if (name && name !== "NAME") {
      models.add(name);
    }
  }
  return models;
}

function parseOllamaModelfileBaseDigests(output) {
  return [
    ...new Set(
      String(output)
        .split(/\r?\n/u)
        .map((line) => line.match(/^FROM\s+.*\/sha256-([a-f0-9]{64})\s*$/iu)?.[1]?.toLowerCase())
        .filter(Boolean),
    ),
  ].toSorted((left, right) => left.localeCompare(right));
}

function parseLaunchctlKvCacheType(output) {
  return (
    String(output)
      .match(/OLLAMA_KV_CACHE_TYPE\s*=>\s*([^\n]+)/u)?.[1]
      ?.trim() ?? ""
  );
}

function resolveOllamaBaseUrl(config) {
  const provider = config.models?.providers?.ollama ?? {};
  const configured = provider.baseUrl ?? provider.baseURL ?? "http://127.0.0.1:11434";
  if (typeof configured !== "string") {
    fail("Configured Ollama base URL must be a string.");
  }
  const baseUrl = new URL(configured.trim().replace(/\/+$/u, "").replace(/\/v1$/iu, ""));
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    !["127.0.0.1", "localhost"].includes(baseUrl.hostname) ||
    baseUrl.username ||
    baseUrl.password
  ) {
    fail("Control Director Ollama identity capture requires loopback.");
  }
  return baseUrl.toString().replace(/\/$/u, "");
}

function rawTranscript(rootDir, name, bytes) {
  const transcriptPath = path.join(rootDir, name);
  fs.writeFileSync(transcriptPath, bytes, { flag: "wx", mode: 0o600 });
  return transcriptPath;
}

function containedBinding(repoRoot, filePath) {
  const relative = path.relative(repoRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("Runtime-identity transcript must remain inside the source checkout.");
  }
  return { path: relative, sha256: digestFile(filePath) };
}

function typedIdentity(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:@/+~-]{1,160}$/u.test(value.trim())) {
    fail(`${label} must be a bounded typed identity.`);
  }
  return value.trim();
}

function coreCacheEvidence(evidence) {
  const { capture: _capture, ...core } = evidence;
  return core;
}

function readBoundTranscript(repoRoot, binding, label) {
  const transcriptPath = path.resolve(repoRoot, binding?.path ?? "");
  const relative = path.relative(repoRoot, transcriptPath);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !fs.existsSync(transcriptPath) ||
    fs.lstatSync(transcriptPath).isSymbolicLink() ||
    !fs.statSync(transcriptPath).isFile() ||
    !DIGEST_PATTERN.test(String(binding?.sha256 ?? "")) ||
    digestFile(transcriptPath) !== binding.sha256
  ) {
    fail(`${label} transcript binding failed verification.`);
  }
  return fs.readFileSync(transcriptPath);
}

export function verifyControlDirectorRuntimeIdentityEvidence(params) {
  const cacheEvidence = params.cacheEvidence;
  const fallbackEvidence = params.fallbackEvidence;
  const capture = cacheEvidence?.capture;
  if (
    !capture ||
    capture.schema !== "openclaw.control-director-runtime-identity-capture.v1" ||
    (capture.phase !== "pre-rollback" && capture.phase !== "restored") ||
    (params.expected.phase && capture.phase !== params.expected.phase) ||
    (fallbackEvidence &&
      (fallbackEvidence.schema !== "openclaw.control-director-fallback-order.v2" ||
        JSON.stringify(fallbackEvidence.capture) !== JSON.stringify(capture))) ||
    capture.sourceSha !== params.expected.sourceSha ||
    capture.activeReleaseId !== params.expected.activeReleaseId ||
    capture.configDigest !== params.expected.configDigest ||
    capture.invocationId !== params.expected.invocationId ||
    cacheEvidence.selectedModel !== params.expected.selectedModel ||
    (fallbackEvidence && fallbackEvidence.selectedModel !== params.expected.selectedModel)
  ) {
    fail("Runtime-identity evidence does not match the expected exact identities.");
  }
  const transcripts = capture.transcripts;
  const requiredTranscriptNames = [
    "config",
    "lifecycle",
    "ollamaList",
    "ollamaModelfile",
    "ollamaPs",
    "ollamaLaunchctl",
  ];
  if (
    JSON.stringify(Object.keys(transcripts).toSorted()) !==
    JSON.stringify(requiredTranscriptNames.toSorted())
  ) {
    fail("Runtime-identity evidence does not contain the exact transcript set.");
  }
  const raw = Object.fromEntries(
    Object.keys(transcripts).map((name) => [
      name,
      readBoundTranscript(params.repoRoot, transcripts[name], `capture.${name}`),
    ]),
  );
  const config = readJson(params.managedConfigPath);
  if (digestFile(params.managedConfigPath) !== capture.configDigest) {
    fail("Managed configuration digest changed after runtime-identity capture.");
  }
  const agentId = resolveAgentIdByOperationalRole(config, "control_director");
  if (!agentId) {
    fail("Managed configuration has no Control Director role owner.");
  }
  const registry = buildControlDirectorModelRegistry({ config, agentId });
  if (
    registry.selected.status !== "ready" ||
    registry.selected.effective !== params.expected.selectedModel
  ) {
    fail("Managed configuration does not resolve the expected selected model.");
  }
  const configTranscript = JSON.parse(raw.config.toString("utf8"));
  if (
    configTranscript.configDigest !== capture.configDigest ||
    configTranscript.agentId !== agentId ||
    JSON.stringify(configTranscript.registry) !== JSON.stringify(registry)
  ) {
    fail("Sanitized configuration transcript does not derive from managed configuration.");
  }
  const lifecycle = JSON.parse(raw.lifecycle.toString("utf8"));
  const expectedLifecycleResult = capture.phase === "pre-rollback" ? "promoted" : "restored";
  const expectedTransitionId =
    capture.phase === "pre-rollback" ? transcripts.lifecycle.sha256 : lifecycle.transitionId;
  if (
    lifecycle.result !== expectedLifecycleResult ||
    lifecycle.activeSha !== capture.sourceSha ||
    lifecycle.candidateSha !== capture.sourceSha ||
    lifecycle.invocationId !== capture.invocationId ||
    lifecycle.lease?.activeReleaseId !== capture.activeReleaseId ||
    capture.transitionId !== expectedTransitionId
  ) {
    fail("Runtime-identity capture does not bind the expected lifecycle transition.");
  }
  const selectedModelId = params.expected.selectedModel.replace(/^ollama\//u, "");
  if (!parseOllamaList(raw.ollamaList.toString("utf8")).has(selectedModelId)) {
    fail("Ollama list transcript does not contain the selected model.");
  }
  const baseBlobDigests = parseOllamaModelfileBaseDigests(raw.ollamaModelfile.toString("utf8"));
  const ps = JSON.parse(raw.ollamaPs.toString("utf8"));
  const resident = Array.isArray(ps.models)
    ? ps.models.find((entry) => entry?.name === selectedModelId || entry?.model === selectedModelId)
    : undefined;
  const kvCacheType = parseLaunchctlKvCacheType(raw.ollamaLaunchctl.toString("utf8"));
  const manifestDigest =
    typeof resident?.digest === "string" ? resident.digest.trim().toLowerCase() : "";
  const recomputed = buildControlDirectorCacheIdentityEvidence({
    selectedModel: params.expected.selectedModel,
    modelId: selectedModelId,
    modelDigest: createHash("sha256")
      .update(JSON.stringify({ manifestDigest, baseBlobDigests }))
      .digest("hex"),
    manifestDigest,
    baseBlobDigests,
    kvCacheType,
    residency: {
      modelId: selectedModelId,
      digest: manifestDigest,
      sizeBytes: Number(resident?.size),
      vramBytes: Number(resident?.size_vram),
    },
  });
  if (JSON.stringify(coreCacheEvidence(cacheEvidence)) !== JSON.stringify(recomputed)) {
    fail("Cache identity receipt does not replay from raw Ollama transcripts.");
  }
  const expectedOrder = [
    params.expected.selectedModel,
    ...registry.fallbacks,
    "fail-closed",
  ].filter((entry, index, values) => values.indexOf(entry) === index);
  const expectedOrderDigest = createHash("sha256")
    .update(JSON.stringify(expectedOrder))
    .digest("hex");
  if (fallbackEvidence) {
    if (
      fallbackEvidence.sourceSha !== capture.sourceSha ||
      fallbackEvidence.activeReleaseId !== capture.activeReleaseId ||
      JSON.stringify(fallbackEvidence.order) !== JSON.stringify(expectedOrder) ||
      fallbackEvidence.orderDigest !== expectedOrderDigest
    ) {
      fail("Fallback-order receipt does not replay from managed configuration.");
    }
  }
  return { cacheEvidence, fallbackEvidence };
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") {
      continue;
    }
    if (!key?.startsWith("--")) {
      fail(`Unknown argument: ${key ?? ""}`);
    }
    const value = argv[++index];
    if (!value) {
      fail(`Missing value for ${key}.`);
    }
    values.set(key.slice(2), value);
  }
  for (const key of [
    "mode",
    "capability-observation",
    "capability-observation-artifact-path",
    "cache-evidence",
    "cache-evidence-artifact-path",
    "expected-source-sha",
    "expected-active-release-id",
    "expected-selected-model",
    "expected-config-digest",
    "artifact-path",
    "output-receipt",
    "output-binding",
  ]) {
    if (!values.get(key)) {
      fail(`Missing --${key}.`);
    }
  }
  return values;
}

function parseCaptureArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") {
      continue;
    }
    if (!key?.startsWith("--")) {
      fail(`Unknown capture argument: ${key ?? ""}`);
    }
    const value = argv[++index];
    if (!value) {
      fail(`Missing value for ${key}.`);
    }
    values.set(key.slice(2), value);
  }
  for (const key of [
    "phase",
    "source-sha",
    "active-release-id",
    "selected-model",
    "config",
    "config-digest",
    "invocation-id",
    "lifecycle-receipt",
    "artifact-root",
    "cache-output",
    "fallback-output",
  ]) {
    if (!values.get(key)) {
      fail(`Missing --${key}.`);
    }
  }
  return values;
}

function runText(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function captureRuntimeIdentityMain(argv) {
  const args = parseCaptureArgs(argv);
  const phase = args.get("phase");
  if (phase !== "pre-rollback" && phase !== "restored") {
    fail("--phase must be pre-rollback or restored.");
  }
  const sourceSha = args.get("source-sha").toLowerCase();
  const configDigest = args.get("config-digest").toLowerCase();
  if (!SHA_PATTERN.test(sourceSha) || !DIGEST_PATTERN.test(configDigest)) {
    fail("Runtime-identity capture requires exact source and configuration digests.");
  }
  const activeReleaseId = typedIdentity(args.get("active-release-id"), "activeReleaseId");
  const invocationId = typedIdentity(args.get("invocation-id"), "invocationId");
  const selectedModel = args.get("selected-model");
  if (!selectedModel.startsWith("ollama/")) {
    fail("--selected-model must be an Ollama provider-qualified model.");
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (runText("git", ["-C", repoRoot, "rev-parse", "HEAD"]).trim() !== sourceSha) {
    fail("Runtime-identity capture checkout does not match the exact source SHA.");
  }
  if (
    runText("git", ["-C", repoRoot, "status", "--porcelain=v1", "--untracked-files=all"]).trim()
  ) {
    fail("Runtime-identity capture requires a clean exact-source checkout.");
  }
  const configPath = path.resolve(args.get("config"));
  if (digestFile(configPath) !== configDigest) {
    fail("Managed configuration does not match --config-digest.");
  }
  const config = readJson(configPath);
  const agentId = resolveAgentIdByOperationalRole(config, "control_director");
  if (!agentId) {
    fail("Managed configuration has no Control Director role owner.");
  }
  const registry = buildControlDirectorModelRegistry({ config, agentId });
  if (registry.selected.status !== "ready" || registry.selected.effective !== selectedModel) {
    fail("Managed configuration does not resolve --selected-model.");
  }
  const modelId = selectedModel.replace(/^ollama\//u, "");
  const lifecyclePath = path.resolve(args.get("lifecycle-receipt"));
  const lifecycle = readJson(lifecyclePath);
  const expectedLifecycleResult = phase === "pre-rollback" ? "promoted" : "restored";
  if (
    lifecycle.result !== expectedLifecycleResult ||
    lifecycle.activeSha !== sourceSha ||
    lifecycle.candidateSha !== sourceSha ||
    lifecycle.invocationId !== invocationId ||
    lifecycle.lease?.activeReleaseId !== activeReleaseId
  ) {
    fail("Lifecycle receipt does not match the capture phase and exact identities.");
  }
  const artifactRoot = path.resolve(args.get("artifact-root"));
  const artifactRelative = path.relative(repoRoot, artifactRoot);
  if (
    artifactRelative.startsWith("..") ||
    path.isAbsolute(artifactRelative) ||
    fs.existsSync(artifactRoot)
  ) {
    fail("Capture artifact root must be a new contained checkout directory.");
  }
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) {
    fail("Runtime-identity capture requires the current macOS user ID.");
  }
  const transcriptPaths = {
    config: rawTranscript(
      artifactRoot,
      "config-projection.json",
      `${JSON.stringify({ configDigest, agentId, registry }, null, 2)}\n`,
    ),
    lifecycle: rawTranscript(
      artifactRoot,
      "lifecycle-receipt.json",
      fs.readFileSync(lifecyclePath),
    ),
    ollamaList: rawTranscript(artifactRoot, "ollama-list.txt", runText("ollama", ["list"])),
    ollamaModelfile: rawTranscript(
      artifactRoot,
      "ollama-modelfile.txt",
      runText("ollama", ["show", modelId, "--modelfile"]),
    ),
    ollamaPs: rawTranscript(
      artifactRoot,
      "ollama-ps.json",
      runText("curl", [
        "--fail",
        "--silent",
        "--show-error",
        `${resolveOllamaBaseUrl(config)}/api/ps`,
      ]),
    ),
    ollamaLaunchctl: rawTranscript(
      artifactRoot,
      "ollama-launchctl.txt",
      runText("launchctl", ["print", `gui/${uid}/ai.openclaw.ollama`]),
    ),
  };
  const transcripts = Object.fromEntries(
    Object.entries(transcriptPaths).map(([name, filePath]) => [
      name,
      containedBinding(repoRoot, filePath),
    ]),
  );
  const transitionId =
    phase === "pre-rollback" ? transcripts.lifecycle.sha256 : String(lifecycle.transitionId ?? "");
  if (!DIGEST_PATTERN.test(transitionId)) {
    fail("Lifecycle receipt does not supply a valid capture transition identity.");
  }
  const capture = {
    schema: "openclaw.control-director-runtime-identity-capture.v1",
    phase,
    transitionId,
    capturedAt: new Date().toISOString(),
    sourceSha,
    activeReleaseId,
    configDigest,
    invocationId,
    transcripts,
  };
  const ps = JSON.parse(fs.readFileSync(transcriptPaths.ollamaPs, "utf8"));
  const resident = Array.isArray(ps.models)
    ? ps.models.find((entry) => entry?.name === modelId || entry?.model === modelId)
    : undefined;
  const baseBlobDigests = parseOllamaModelfileBaseDigests(
    fs.readFileSync(transcriptPaths.ollamaModelfile, "utf8"),
  );
  const manifestDigest =
    typeof resident?.digest === "string" ? resident.digest.trim().toLowerCase() : "";
  const cacheEvidence = {
    ...buildControlDirectorCacheIdentityEvidence({
      selectedModel,
      modelId,
      modelDigest: createHash("sha256")
        .update(JSON.stringify({ manifestDigest, baseBlobDigests }))
        .digest("hex"),
      manifestDigest,
      baseBlobDigests,
      kvCacheType: parseLaunchctlKvCacheType(
        fs.readFileSync(transcriptPaths.ollamaLaunchctl, "utf8"),
      ),
      residency: {
        modelId,
        digest: manifestDigest,
        sizeBytes: Number(resident?.size),
        vramBytes: Number(resident?.size_vram),
      },
    }),
    capture,
  };
  const order = [selectedModel, ...registry.fallbacks, "fail-closed"].filter(
    (entry, index, values) => values.indexOf(entry) === index,
  );
  const fallbackEvidence = {
    schema: "openclaw.control-director-fallback-order.v2",
    sourceSha,
    activeReleaseId,
    selectedModel,
    order,
    orderDigest: createHash("sha256").update(JSON.stringify(order)).digest("hex"),
    capture,
  };
  const cacheOutput = path.resolve(args.get("cache-output"));
  const fallbackOutput = path.resolve(args.get("fallback-output"));
  fs.mkdirSync(path.dirname(cacheOutput), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(fallbackOutput), { recursive: true, mode: 0o700 });
  fs.writeFileSync(cacheOutput, `${JSON.stringify(cacheEvidence, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  fs.writeFileSync(fallbackOutput, `${JSON.stringify(fallbackEvidence, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  verifyControlDirectorRuntimeIdentityEvidence({
    cacheEvidence,
    fallbackEvidence,
    repoRoot,
    managedConfigPath: configPath,
    expected: { sourceSha, activeReleaseId, selectedModel, configDigest, invocationId },
  });
  process.stdout.write(`${cacheOutput}\n${fallbackOutput}\n`);
}

export function buildControlDirectorStabilitySampleReceipt(params) {
  if (params.mode !== "active" && params.mode !== "passive") {
    fail("Stability sample mode must be active or passive.");
  }
  if (!SHA_PATTERN.test(params.expectedSourceSha)) {
    fail("Stability sample requires an exact source SHA.");
  }
  if (!DIGEST_PATTERN.test(params.expectedConfigDigest)) {
    fail("Stability sample requires an exact configuration digest.");
  }
  const verifyObservation = params.verifyObservation ?? verifyControlDirectorCapabilityObservation;
  const observation = verifyObservation(params.capabilityObservation);
  const cacheEvidence = params.cacheEvidence;
  const selectedModelId = params.expectedSelectedModel.replace(/^ollama\//u, "");
  if (
    observation.phase !== "restored" ||
    observation.sourceSha !== params.expectedSourceSha ||
    observation.releaseId !== params.expectedActiveReleaseId ||
    observation.selectedModelId !== selectedModelId ||
    observation.configurationDigests[0] !== params.expectedConfigDigest ||
    observation.capabilities.length !== 35 ||
    cacheEvidence.selectedModel !== params.expectedSelectedModel ||
    cacheEvidence.modelId !== selectedModelId ||
    !DIGEST_PATTERN.test(cacheEvidence.cacheDigest) ||
    cacheEvidence.capture?.schema !== "openclaw.control-director-runtime-identity-capture.v1" ||
    cacheEvidence.capture.phase !== "restored" ||
    cacheEvidence.capture.sourceSha !== params.expectedSourceSha ||
    cacheEvidence.capture.activeReleaseId !== params.expectedActiveReleaseId ||
    cacheEvidence.capture.configDigest !== params.expectedConfigDigest ||
    !DIGEST_PATTERN.test(cacheEvidence.capture.transitionId) ||
    !Number.isFinite(Date.parse(cacheEvidence.capture.capturedAt)) ||
    Date.parse(cacheEvidence.capture.capturedAt) > Date.parse(observation.checkedAt) ||
    Date.parse(observation.checkedAt) - Date.parse(cacheEvidence.capture.capturedAt) > 300_000 ||
    params.capabilityObservationBinding.receipt.contentSha256 !== observation.contentSha256 ||
    JSON.stringify(params.capabilityObservationBinding.receipt) !==
      JSON.stringify(params.capabilityObservation) ||
    !DIGEST_PATTERN.test(params.capabilityObservationBinding.sha256) ||
    !params.capabilityObservationBinding.path ||
    params.cacheEvidenceBinding.receipt.cacheDigest !== cacheEvidence.cacheDigest ||
    !DIGEST_PATTERN.test(params.cacheEvidenceBinding.sha256) ||
    !params.cacheEvidenceBinding.path
  ) {
    fail("Stability sample inputs do not match the restored exact-runtime identities.");
  }
  return {
    schema: CONTROL_DIRECTOR_STABILITY_SAMPLE_SCHEMA,
    checkedAt: observation.checkedAt,
    mode: params.mode,
    sourceSha: observation.sourceSha,
    activeReleaseId: observation.releaseId,
    selectedModel: params.expectedSelectedModel,
    configDigest: observation.configurationDigests[0],
    gatewayHealthy: true,
    capabilitiesPassed: observation.capabilities.length,
    routeDriftDetected: false,
    capabilityLossDetected: false,
    cacheDigest: cacheEvidence.cacheDigest,
    cacheEvidence: params.cacheEvidenceBinding,
    capabilityObservation: params.capabilityObservationBinding,
    capabilityObservationSha256: observation.contentSha256,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const capabilityObservationPath = path.resolve(args.get("capability-observation"));
  const cacheEvidencePath = path.resolve(args.get("cache-evidence"));
  const outputReceipt = path.resolve(args.get("output-receipt"));
  const outputBinding = path.resolve(args.get("output-binding"));
  const receipt = buildControlDirectorStabilitySampleReceipt({
    mode: args.get("mode"),
    capabilityObservation: readJson(capabilityObservationPath),
    capabilityObservationBinding: {
      path: args.get("capability-observation-artifact-path"),
      sha256: createHash("sha256").update(fs.readFileSync(capabilityObservationPath)).digest("hex"),
      receipt: readJson(capabilityObservationPath),
    },
    cacheEvidence: readJson(cacheEvidencePath),
    cacheEvidenceBinding: {
      path: args.get("cache-evidence-artifact-path"),
      sha256: createHash("sha256").update(fs.readFileSync(cacheEvidencePath)).digest("hex"),
      receipt: readJson(cacheEvidencePath),
    },
    expectedSourceSha: args.get("expected-source-sha"),
    expectedActiveReleaseId: args.get("expected-active-release-id"),
    expectedSelectedModel: args.get("expected-selected-model"),
    expectedConfigDigest: args.get("expected-config-digest"),
  });
  fs.mkdirSync(path.dirname(outputReceipt), { recursive: true, mode: 0o700 });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  fs.writeFileSync(outputReceipt, receiptBytes, { flag: "wx", mode: 0o600 });
  const bindingWithoutDigest = {
    path: args.get("artifact-path"),
    sha256: createHash("sha256").update(receiptBytes).digest("hex"),
    receipt,
  };
  const binding = {
    ...bindingWithoutDigest,
    sampleDigest: digestControlDirectorStabilitySample(bindingWithoutDigest),
  };
  fs.mkdirSync(path.dirname(outputBinding), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputBinding, `${JSON.stringify(binding, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`${outputBinding}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "capture-runtime-identity") {
      captureRuntimeIdentityMain(process.argv.slice(3));
    } else {
      main();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
