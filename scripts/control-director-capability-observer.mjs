#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTITY_PATTERN = /^[A-Za-z0-9._:@/+~-]{1,160}$/u;
const PHASES = new Set(["active", "rollback", "restored"]);
const FORBIDDEN_OUTCOME_FIELDS = new Set(["passed", "status", "evidenceRefs"]);
const LIFECYCLE_LOCK_SCHEMA = "openclaw.custom-runtime-lifecycle-lock.v1";
const BROWSER_EVIDENCE_SCHEMA = "openclaw.control-director-browser-capability-evidence.v1";
const BROWSER_CAPTURE_MODE = "direct-visible-google-chrome-v1";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const capabilityRequirements = {
  "dashboard:pcc": [
    "immutable-runtime-contract",
    "capability-contract:dashboard:pcc",
    "surface-contract:pcc",
  ],
  "dashboard:app-studio": [
    "immutable-runtime-contract",
    "capability-contract:dashboard:app-studio",
    "surface-contract:app-studio",
  ],
  "dashboard:music-studio": [
    "immutable-runtime-contract",
    "capability-contract:dashboard:music-studio",
    "surface-contract:music-studio",
  ],
  "dashboard:snes-studio": [
    "immutable-runtime-contract",
    "capability-contract:dashboard:snes-studio",
    "surface-contract:snes-studio",
  ],
  "dashboard:book-writer": [
    "immutable-runtime-contract",
    "capability-contract:dashboard:book-writer",
    "surface-contract:book-writer",
  ],
  "dashboard:kalshi": [
    "immutable-runtime-contract",
    "capability-contract:dashboard:kalshi",
    "surface-contract:kalshi",
  ],
  "dashboard:pattern-lab": [
    "immutable-runtime-contract",
    "capability-contract:dashboard:pattern-lab",
    "surface-contract:pattern-lab",
  ],
  "plugin:apps": [
    "immutable-runtime-contract",
    "capability-contract:plugin:apps",
    "plugin-contract:apps",
  ],
  "plugin:book-writer": [
    "immutable-runtime-contract",
    "capability-contract:plugin:book-writer",
    "plugin-contract:book-writer",
  ],
  "workflow:pcc-project-management": [
    "immutable-runtime-contract",
    "capability-contract:workflow:pcc-project-management",
  ],
  "workflow:pcc-operational-excellence": [
    "immutable-runtime-contract",
    "capability-contract:workflow:pcc-operational-excellence",
  ],
  "runtime:control-director-deployment-consistency": [
    "immutable-runtime-contract",
    "capability-contract:runtime:control-director-deployment-consistency",
  ],
  "runtime:control-director-truth-gates": [
    "immutable-runtime-contract",
    "capability-contract:runtime:control-director-truth-gates",
  ],
  "runtime:control-director-codex-chat": [
    "immutable-runtime-contract",
    "capability-contract:runtime:control-director-codex-chat",
  ],
  "runtime:local-first-model-intelligence": [
    "immutable-runtime-contract",
    "capability-contract:runtime:local-first-model-intelligence",
  ],
  "runtime:chat-work-surface": [
    "immutable-runtime-contract",
    "capability-contract:runtime:chat-work-surface",
  ],
  "runtime:chat-native-projects": [
    "immutable-runtime-contract",
    "capability-contract:runtime:chat-native-projects",
  ],
  "runtime:chat-plan-mode": [
    "immutable-runtime-contract",
    "capability-contract:runtime:chat-plan-mode",
  ],
  "runtime:chat-pursue-goal": [
    "immutable-runtime-contract",
    "capability-contract:runtime:chat-pursue-goal",
  ],
  "runtime:chat-approval-cards": [
    "immutable-runtime-contract",
    "capability-contract:runtime:chat-approval-cards",
  ],
  "runtime:chat-tool-proof-artifact-cards": [
    "immutable-runtime-contract",
    "capability-contract:runtime:chat-tool-proof-artifact-cards",
  ],
  "runtime:chat-multi-agent-work-tree": [
    "immutable-runtime-contract",
    "capability-contract:runtime:chat-multi-agent-work-tree",
  ],
  "runtime:chat-truth-completion-diagnostics": [
    "immutable-runtime-contract",
    "capability-contract:runtime:chat-truth-completion-diagnostics",
  ],
  "runtime:chat-polish-accessibility": [
    "immutable-runtime-contract",
    "capability-contract:runtime:chat-polish-accessibility",
  ],
  "runtime:chat-network-remote-approvals": [
    "immutable-runtime-contract",
    "capability-contract:runtime:chat-network-remote-approvals",
  ],
  "runtime:pcc-mobile-control": [
    "immutable-runtime-contract",
    "capability-contract:runtime:pcc-mobile-control",
  ],
  "runtime:chat-ux-cleanup": [
    "immutable-runtime-contract",
    "capability-contract:runtime:chat-ux-cleanup",
  ],
  "runtime:control-director-chat-reliability": [
    "immutable-runtime-contract",
    "capability-contract:runtime:control-director-chat-reliability",
  ],
  "runtime:pcc-chat-sync": [
    "immutable-runtime-contract",
    "capability-contract:runtime:pcc-chat-sync",
  ],
  "runtime:dashboard-codex-plus-apps": [
    "immutable-runtime-contract",
    "capability-contract:runtime:dashboard-codex-plus-apps",
  ],
  "runtime:operations-room": [
    "immutable-runtime-contract",
    "capability-contract:runtime:operations-room",
  ],
  "runtime:update-safe-customizations": [
    "immutable-runtime-contract",
    "capability-contract:runtime:update-safe-customizations",
  ],
  "runtime:tailscale-primary-continuity": [
    "immutable-runtime-contract",
    "capability-contract:runtime:tailscale-primary-continuity",
    "tailscale-status",
    "tailscale-serve-status",
  ],
  "runtime:self-improvement-governor": [
    "immutable-runtime-contract",
    "capability-contract:runtime:self-improvement-governor",
  ],
  "runtime:release-governor": [
    "immutable-runtime-contract",
    "capability-contract:runtime:release-governor",
  ],
};

const dashboardCapabilityRoutes = Object.freeze({
  "dashboard:pcc": "/pcc",
  "dashboard:app-studio": "/app-studio",
  "dashboard:music-studio": "/music-studio",
  "dashboard:snes-studio": "/snes-studio",
  "dashboard:book-writer": "/book-writer",
  "dashboard:kalshi": "/kalshi",
  "dashboard:pattern-lab": "/pattern-lab",
});
const browserRouteContracts = Object.freeze({
  "/pcc": { surfaceId: "pcc", markers: ["PCC"] },
  "/app-studio": { surfaceId: "app-studio", markers: ["App Studio"] },
  "/music-studio": { surfaceId: "music-studio", markers: ["Music Studio"] },
  "/snes-studio": { surfaceId: "snes-studio", markers: ["SNES Studio"] },
  "/book-writer": { surfaceId: "book-writer", markers: ["Book Writer"] },
  "/kalshi": { surfaceId: "kalshi", markers: ["Kalshi"] },
  "/pattern-lab": { surfaceId: "pattern-lab", markers: ["Pattern Lab"] },
  "/chat": { surfaceId: "chat", markers: ["Chat"] },
  "/operations": { surfaceId: "operations", markers: ["Operations Room"] },
});
const chatRuntimeCapabilities = new Set([
  "runtime:control-director-codex-chat",
  "runtime:chat-work-surface",
  "runtime:chat-native-projects",
  "runtime:chat-plan-mode",
  "runtime:chat-pursue-goal",
  "runtime:chat-approval-cards",
  "runtime:chat-tool-proof-artifact-cards",
  "runtime:chat-multi-agent-work-tree",
  "runtime:chat-truth-completion-diagnostics",
  "runtime:chat-polish-accessibility",
  "runtime:chat-network-remote-approvals",
  "runtime:chat-ux-cleanup",
  "runtime:control-director-chat-reliability",
]);
for (const [id, requirements] of Object.entries(capabilityRequirements)) {
  requirements.push("gateway-health");
  requirements.push(`capability-runtime:${id}`);
  if (dashboardCapabilityRoutes[id]) {
    requirements.push(`dashboard-route:${dashboardCapabilityRoutes[id]}`);
  }
  if (id.startsWith("plugin:")) {
    requirements.push("plugin-inventory");
  }
  if (id.includes("pcc") || id.startsWith("workflow:pcc-")) {
    requirements.push("pcc-summary");
  }
  if (chatRuntimeCapabilities.has(id)) {
    requirements.push("dashboard-route:/chat");
  }
  if (id === "runtime:operations-room") {
    requirements.push("operations-snapshot", "dashboard-route:/operations");
  }
  if (id === "runtime:local-first-model-intelligence") {
    requirements.push("ollama-residency");
  }
  if (id === "runtime:self-improvement-governor") {
    requirements.push("sig-health");
  }
  if (id === "runtime:release-governor") {
    requirements.push("sig-production-check", "dashboard-route:/pcc");
  }
}

export const CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS = Object.freeze(
  Object.fromEntries(
    Object.entries(capabilityRequirements).map(([id, probeIds]) => [id, Object.freeze(probeIds)]),
  ),
);
export const CONTROL_DIRECTOR_CAPABILITY_IDS = Object.freeze(
  Object.keys(CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS).toSorted((left, right) =>
    left.localeCompare(right),
  ),
);
export const CONTROL_DIRECTOR_CAPABILITY_OBSERVATION_SCHEMA =
  "openclaw.control-director-capability-observation.v2";

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function exact(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`${label} is missing or invalid.`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(object(value, label)).toSorted((left, right) =>
    left.localeCompare(right),
  );
  const wanted = [...expected].toSorted((left, right) => left.localeCompare(right));
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} contains unexpected or missing fields.`);
  }
}

function rejectCallerOutcomes(value, label = "observation") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectCallerOutcomes(entry, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_OUTCOME_FIELDS.has(key)) {
      fail(`${label} contains forbidden caller-authored outcome field ${key}.`);
    }
    rejectCallerOutcomes(entry, `${label}.${key}`);
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalControlDirectorCapabilityBytes(value) {
  return Buffer.from(JSON.stringify(canonicalValue(value)), "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

export function digestControlDirectorCapabilityObservation(observation) {
  const { contentSha256: _contentSha256, ...unsigned } = object(observation, "observation");
  return sha256(canonicalControlDirectorCapabilityBytes(unsigned));
}

export function digestControlDirectorCapabilityEvidence({
  phase,
  sourceSha,
  releaseId,
  selectedModelId,
  configurationDigests,
  authorizationBindings,
  capability,
  probes,
}) {
  const contractProbeId = `capability-contract:${capability.id}`;
  const evidenceProbeIds = capability.probeIds.filter((probeId) => probeId !== contractProbeId);
  const evidenceProbes = Object.fromEntries(
    evidenceProbeIds.map((probeId) => {
      const probe = probes[probeId];
      if (!probe) {
        fail(`Capability ${capability.id} is missing evidence probe ${probeId}.`);
      }
      return [probeId, probe];
    }),
  );
  return sha256(
    canonicalControlDirectorCapabilityBytes({
      schema: "openclaw.control-director-capability-evidence.v1",
      phase,
      sourceSha,
      releaseId,
      selectedModelId,
      configurationDigests,
      authorizationBindings,
      capability: {
        id: capability.id,
        kind: capability.kind,
        requiredPathDigests: capability.requiredPathDigests,
        evidenceProbeIds,
      },
      evidenceProbes,
    }),
  );
}

export function digestControlDirectorCapabilityRuntimeEvidence({
  phase,
  sourceSha,
  releaseId,
  selectedModelId,
  configurationDigests,
  authorizationBindings,
  capability,
  probes,
  runtimeEvidence,
}) {
  const excludedProbeIds = new Set([
    `capability-contract:${capability.id}`,
    `capability-runtime:${capability.id}`,
  ]);
  const semanticProbeIds = capability.probeIds.filter((probeId) => !excludedProbeIds.has(probeId));
  const semanticProbes = Object.fromEntries(
    semanticProbeIds.map((probeId) => {
      const probe = probes[probeId];
      if (!probe) {
        fail(`Capability ${capability.id} is missing semantic probe ${probeId}.`);
      }
      return [probeId, probe];
    }),
  );
  if (!Array.isArray(runtimeEvidence) || runtimeEvidence.length === 0) {
    fail(`Capability ${capability.id} has no immutable semantic evidence.`);
  }
  const immutableEvidence = Object.fromEntries(
    runtimeEvidence.map((binding, index) => {
      exactKeys(
        binding,
        ["logicalPath", "path", "sha256"],
        `${capability.id} runtimeEvidence[${index}]`,
      );
      exact(binding.logicalPath, /^.+$/u, `${capability.id} runtimeEvidence[${index}].logicalPath`);
      exact(binding.sha256, DIGEST_PATTERN, `${capability.id} runtimeEvidence[${index}].sha256`);
      return [binding.logicalPath, binding.sha256];
    }),
  );
  if (Object.keys(immutableEvidence).length !== runtimeEvidence.length) {
    fail(`Capability ${capability.id} repeats immutable semantic evidence.`);
  }
  return sha256(
    canonicalControlDirectorCapabilityBytes({
      schema: "openclaw.control-director-capability-runtime-evidence.v1",
      phase,
      sourceSha,
      releaseId,
      selectedModelId,
      configurationDigests,
      authorizationBindings,
      capability: {
        id: capability.id,
        kind: capability.kind,
        requiredPathDigests: capability.requiredPathDigests,
        semanticProbeIds,
        immutableEvidence,
      },
      semanticProbes,
    }),
  );
}

function readJson(filePath, label) {
  try {
    return object(JSON.parse(fs.readFileSync(filePath, "utf8")), label);
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function readBoundAbsoluteJson(binding, label) {
  exactKeys(binding, ["path", "sha256"], label);
  if (typeof binding.path !== "string" || !path.isAbsolute(binding.path)) {
    fail(`${label}.path must be absolute.`);
  }
  const stat = fs.lstatSync(binding.path);
  if (!stat.isFile() || stat.isSymbolicLink() || fileSha256(binding.path) !== binding.sha256) {
    fail(`${label} failed regular-file digest verification.`);
  }
  return readJson(binding.path, label);
}

function childPath(root, candidate, label) {
  const rootReal = fs.realpathSync(root);
  const candidateReal = fs.realpathSync(candidate);
  if (candidateReal === rootReal || !candidateReal.startsWith(`${rootReal}${path.sep}`)) {
    fail(`${label} is outside its authorized root.`);
  }
  return candidateReal;
}

function regularFileWithin(root, relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/u).includes("..")
  ) {
    fail(`${label} is not a safe relative path.`);
  }
  const candidate = path.join(root, relativePath);
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${label} is not a regular non-symlink file.`);
  }
  return childPath(root, candidate, label);
}

function assertExactManifestIds(manifestCapabilities) {
  const ids = manifestCapabilities
    .map((entry) => entry?.id)
    .toSorted((left, right) => left.localeCompare(right));
  if (
    ids.length !== CONTROL_DIRECTOR_CAPABILITY_IDS.length ||
    new Set(ids).size !== CONTROL_DIRECTOR_CAPABILITY_IDS.length ||
    JSON.stringify(ids) !== JSON.stringify(CONTROL_DIRECTOR_CAPABILITY_IDS)
  ) {
    fail("Capability manifest IDs do not exactly equal the static 35-capability probe registry.");
  }
}

function parseTimestamp(value, label) {
  const normalized =
    typeof value === "string" && /^\d{8}T\d{6}Z$/u.test(value)
      ? value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u, "$1-$2-$3T$4:$5:$6Z")
      : value;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    fail(`${label} is not a valid timestamp.`);
  }
  return timestamp;
}

function validateAuthorizationBindings(bindings) {
  exactKeys(
    bindings,
    ["leaseOwner", "approvalId", "operationId", "invocationId"],
    "authorizationBindings",
  );
  for (const [field, value] of Object.entries(bindings)) {
    exact(value, IDENTITY_PATTERN, `authorizationBindings.${field}`);
  }
}

function requiredLifecycleResults(phase) {
  if (phase === "active") {
    return ["acquired", "promoted"];
  }
  if (phase === "rollback") {
    return ["rollback-authorized", "rolled-back"];
  }
  return ["restored"];
}

function verifyLifecycleReceipt(receipt, expected, checkedAt) {
  if (
    receipt.schema !== "openclaw.custom-runtime-certification-lease-receipt.v2" ||
    receipt.result !== expected.result ||
    receipt.activeSha !== expected.activeSourceSha ||
    receipt.candidateSha !== expected.activeSourceSha ||
    receipt.approvalId !== expected.authorizationBindings.approvalId ||
    receipt.operationId !== expected.authorizationBindings.operationId ||
    receipt.invocationId !== expected.authorizationBindings.invocationId ||
    parseTimestamp(receipt.at, `${expected.result} receipt.at`) > checkedAt
  ) {
    fail(`Lifecycle receipt ${expected.result} has invalid exact bindings.`);
  }
  const lease = object(receipt.lease, `${expected.result} receipt.lease`);
  if (
    lease.activeSha !== expected.activeSourceSha ||
    lease.candidateSha !== expected.activeSourceSha ||
    lease.rollbackSha !== expected.rollbackSourceSha ||
    lease.activeReleaseId !== expected.activeReleaseId ||
    lease.rollbackReleaseId !== expected.rollbackReleaseId ||
    lease.owner !== expected.authorizationBindings.leaseOwner ||
    lease.actor !== os.userInfo().username ||
    lease.approvalId !== expected.authorizationBindings.approvalId ||
    lease.operationId !== expected.authorizationBindings.operationId ||
    lease.invocationId !== expected.authorizationBindings.invocationId ||
    lease.operationClass !== "release-certification"
  ) {
    fail(`Lifecycle receipt ${expected.result} lease has invalid exact bindings.`);
  }
  if (
    ["rolled-back", "restored"].includes(expected.result) &&
    !DIGEST_PATTERN.test(receipt.transitionId)
  ) {
    fail(`Lifecycle receipt ${expected.result} is missing its transition ID.`);
  }
}

function artifactReference(artifactRoot, filePath) {
  const realRoot = fs.realpathSync(artifactRoot);
  const realFile = childPath(realRoot, filePath, "Probe transcript");
  const relative = path.relative(realRoot, realFile);
  return { path: relative, sha256: fileSha256(realFile) };
}

function writeProbeTranscript(artifactRoot, probeId, stream, value) {
  const artifacts = path.join(artifactRoot, "artifacts");
  fs.mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  const safeId = probeId.replace(/[^A-Za-z0-9._-]/gu, "_");
  const target = path.join(artifacts, `${safeId}.${stream}`);
  fs.writeFileSync(target, value, { mode: 0o600 });
  return artifactReference(artifactRoot, target);
}

function snapshotEvidenceFile(artifactRoot, evidenceId, filePath) {
  const artifacts = path.join(artifactRoot, "artifacts");
  fs.mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  const safeId = evidenceId.replace(/[^A-Za-z0-9._-]/gu, "_");
  const target = path.join(artifacts, `${safeId}.evidence`);
  fs.copyFileSync(filePath, target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target, 0o600);
  return { path: target, sha256: fileSha256(target) };
}

function assertCompletePng(bytes, label) {
  if (
    bytes.length < 45 ||
    !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR" ||
    bytes.readUInt32BE(16) <= 0 ||
    bytes.readUInt32BE(20) <= 0
  ) {
    fail(`${label} is not a complete PNG image.`);
  }
  let offset = 8;
  let sawIend = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const next = offset + 12 + length;
    if (next > bytes.length) {
      fail(`${label} has a truncated PNG chunk.`);
    }
    if (type === "IEND") {
      if (length !== 0 || next !== bytes.length) {
        fail(`${label} has an invalid PNG terminator.`);
      }
      sawIend = true;
      break;
    }
    offset = next;
  }
  if (!sawIend) {
    fail(`${label} has no PNG terminator.`);
  }
}

function verifyCapturedBrowserDom(bytes, route, contract) {
  const captured = parseJsonObject(bytes, `${route} captured browser DOM`);
  exactKeys(
    captured,
    [
      "schema",
      "captureMode",
      "route",
      "finalPath",
      "authenticated",
      "connectionStatus",
      "visibleMarkers",
    ],
    `${route} captured browser DOM`,
  );
  const visibleMarkers = Array.isArray(captured.visibleMarkers) ? captured.visibleMarkers : [];
  const connectionStatus = object(
    captured.connectionStatus,
    `${route} captured browser DOM.connectionStatus`,
  );
  exactKeys(
    connectionStatus,
    ["className", "text", "rect"],
    `${route} captured browser DOM.connectionStatus`,
  );
  const connectionRect = object(
    connectionStatus.rect,
    `${route} captured browser DOM.connectionStatus.rect`,
  );
  exactKeys(
    connectionRect,
    ["x", "y", "width", "height"],
    `${route} captured browser DOM.connectionStatus.rect`,
  );
  for (const [index, entry] of visibleMarkers.entries()) {
    const markerEvidence = object(entry, `${route} captured browser DOM.visibleMarkers[${index}]`);
    exactKeys(
      markerEvidence,
      ["marker", "tagName", "text", "rect"],
      `${route} captured browser DOM.visibleMarkers[${index}]`,
    );
    const rect = object(
      markerEvidence.rect,
      `${route} captured browser DOM.visibleMarkers[${index}].rect`,
    );
    exactKeys(
      rect,
      ["x", "y", "width", "height"],
      `${route} captured browser DOM.visibleMarkers[${index}].rect`,
    );
  }
  if (
    captured.schema !== "openclaw.control-director-visible-dom-evidence.v1" ||
    captured.captureMode !== BROWSER_CAPTURE_MODE ||
    captured.route !== route ||
    captured.finalPath !== route ||
    captured.authenticated !== true ||
    typeof connectionStatus.className !== "string" ||
    !connectionStatus.className.split(/\s+/u).includes("sidebar-connection-status--online") ||
    typeof connectionStatus.text !== "string" ||
    !Number.isFinite(connectionRect.x) ||
    !Number.isFinite(connectionRect.y) ||
    !Number.isFinite(connectionRect.width) ||
    connectionRect.width <= 0 ||
    !Number.isFinite(connectionRect.height) ||
    connectionRect.height <= 0 ||
    visibleMarkers.length !== contract.markers.length ||
    !contract.markers.every((marker) =>
      visibleMarkers.some(
        (entry) =>
          entry?.marker === marker &&
          typeof entry?.tagName === "string" &&
          entry.tagName.length > 0 &&
          typeof entry?.text === "string" &&
          entry.text.includes(marker) &&
          Number.isFinite(entry?.rect?.x) &&
          Number.isFinite(entry?.rect?.y) &&
          Number.isFinite(entry?.rect?.width) &&
          entry.rect.width > 0 &&
          Number.isFinite(entry?.rect?.height) &&
          entry.rect.height > 0,
      ),
    )
  ) {
    fail(`${route} captured DOM does not prove visible authenticated route markers.`);
  }
  return captured;
}

function runSystemText(command, args, label) {
  const result = spawnSync(command, args, {
    env: runtimeProbeEnvironment({}),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || !result.stdout?.trim()) {
    fail(`${label} could not be read from the Mac Studio.`);
  }
  return result.stdout.trim();
}

function readMacStudioHostIdentity() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    fail("Visible browser capture requires the arm64 Mac Studio.");
  }
  const hardware = parseJsonObject(
    runSystemText("system_profiler", ["SPHardwareDataType", "-json"], "Mac hardware identity"),
    "Mac hardware identity",
  );
  const rows = Array.isArray(hardware.SPHardwareDataType) ? hardware.SPHardwareDataType : [];
  const row = object(rows[0], "Mac hardware identity row");
  if (
    row.machine_name !== "Mac Studio" ||
    typeof row.machine_model !== "string" ||
    !row.machine_model.trim() ||
    typeof row.platform_UUID !== "string" ||
    !row.platform_UUID.trim()
  ) {
    fail("Browser capture host is not the exact Mac Studio hardware class.");
  }
  return {
    hardwareClass: "Mac Studio",
    osName: "macOS",
    osVersion: runSystemText("sw_vers", ["-productVersion"], "macOS version"),
    architecture: "arm64",
    hostIdentitySha256: sha256(
      Buffer.from(`${row.machine_model.trim()}:${row.platform_UUID.trim()}`, "utf8"),
    ),
  };
}

async function captureVisibleAuthenticatedChromeEvidence({
  artifactRoot,
  controlUiUrl,
  identity,
  managedConfigPath,
  requiredRoutes,
}) {
  let authUrlValue = process.env.OPENCLAW_CONTROL_DIRECTOR_BROWSER_AUTH_URL;
  if (
    (!authUrlValue || !authUrlValue.trim()) &&
    process.env.OPENCLAW_CONTROL_DIRECTOR_ALLOW_LOCAL_TOKEN_RESOLUTION === "1"
  ) {
    const stat = fs.lstatSync(managedConfigPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    ) {
      fail("Managed Dashboard configuration is missing or unsafe for local token resolution.");
    }
    const config = readJson(managedConfigPath, "Managed Dashboard configuration");
    const token = config.gateway?.auth?.token;
    if (typeof token !== "string" || !token.trim()) {
      fail("Managed Dashboard configuration does not contain a directly usable local token.");
    }
    const localAuthUrl = new URL(controlUiUrl);
    localAuthUrl.hash = `token=${encodeURIComponent(token)}`;
    authUrlValue = localAuthUrl.toString();
  }
  if (typeof authUrlValue !== "string" || !authUrlValue.trim()) {
    fail(
      "Visible browser capture requires an authenticated URL or explicitly approved local token resolution.",
    );
  }
  const authUrl = new URL(authUrlValue);
  const expectedOrigin = new URL(controlUiUrl);
  if (
    authUrl.origin !== expectedOrigin.origin ||
    !["http:", "https:"].includes(authUrl.protocol) ||
    !["127.0.0.1", "localhost"].includes(authUrl.hostname) ||
    authUrl.username ||
    authUrl.password ||
    (!authUrl.hash.includes("token=") && !authUrl.searchParams.has("token"))
  ) {
    fail("Visible browser auth URL must be token-authenticated on the exact loopback origin.");
  }
  const browserRoot = path.join(artifactRoot, "visible-browser-capture");
  fs.mkdirSync(browserRoot, { recursive: true, mode: 0o700 });
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    headless: false,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    env: runtimeProbeEnvironment({}),
  });
  try {
    const viewport = { width: 1440, height: 1000 };
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const routes = [];
    for (const route of [...requiredRoutes].toSorted((left, right) => left.localeCompare(right))) {
      const contract = browserRouteContracts[route];
      if (!contract) {
        fail(`Visible browser capture has no route contract for ${route}.`);
      }
      const target = new URL(authUrl);
      target.pathname = route;
      try {
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
      } catch {
        fail(`Visible Chrome route ${route} navigation failed without exposing credentials.`);
      }
      await page.waitForFunction(
        ({ markers }) => {
          const visible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number(style.opacity) > 0 &&
              rect.width > 0 &&
              rect.height > 0
            );
          };
          const renderedText = (element) => {
            // oxlint-disable-next-line unicorn/prefer-dom-node-text-content -- Certification must exclude hidden descendant text.
            return element.innerText;
          };
          const elements = [...document.querySelectorAll("main.content *")];
          const connectionStatus = document.querySelector(".sidebar-connection-status--online");
          return (
            markers.every((marker) =>
              elements.some(
                (element) => renderedText(element)?.includes(marker) && visible(element),
              ),
            ) &&
            connectionStatus instanceof HTMLElement &&
            visible(connectionStatus)
          );
        },
        { markers: contract.markers },
        { timeout: 45_000 },
      );
      const state = await page.evaluate(
        ({ markers }) => {
          const visible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number(style.opacity) > 0 &&
              rect.width > 0 &&
              rect.height > 0
            );
          };
          const renderedText = (element) => {
            // oxlint-disable-next-line unicorn/prefer-dom-node-text-content -- Certification must exclude hidden descendant text.
            return element.innerText;
          };
          const elements = [...document.querySelectorAll("main.content *")];
          const connectionStatusElement = document.querySelector(
            ".sidebar-connection-status--online",
          );
          const visibleMarkers = markers.map((marker) => {
            const matches = elements
              .filter((element) => renderedText(element)?.includes(marker) && visible(element))
              .toSorted(
                (left, right) =>
                  (renderedText(left)?.length ?? Number.MAX_SAFE_INTEGER) -
                  (renderedText(right)?.length ?? Number.MAX_SAFE_INTEGER),
              );
            const element = matches[0];
            if (!element) {
              return null;
            }
            const rect = element.getBoundingClientRect();
            return {
              marker,
              tagName: element.tagName.toLowerCase(),
              text: (renderedText(element) ?? "").replace(/\s+/gu, " ").trim().slice(0, 256),
              rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            };
          });
          const connectionRect = connectionStatusElement?.getBoundingClientRect();
          return {
            finalPath: window.location.pathname,
            unauthorized: /unauthorized|forbidden|sign in required/iu.test(
              document.documentElement.textContent ?? "",
            ),
            connectionStatus:
              connectionStatusElement instanceof HTMLElement &&
              connectionRect &&
              visible(connectionStatusElement)
                ? {
                    className: connectionStatusElement.className,
                    text: renderedText(connectionStatusElement)
                      .replace(/\s+/gu, " ")
                      .trim()
                      .slice(0, 128),
                    rect: {
                      x: Math.round(connectionRect.x),
                      y: Math.round(connectionRect.y),
                      width: Math.round(connectionRect.width),
                      height: Math.round(connectionRect.height),
                    },
                  }
                : null,
            visibleMarkers,
          };
        },
        { markers: contract.markers },
      );
      if (
        state.finalPath !== route ||
        state.unauthorized ||
        !state.connectionStatus ||
        state.visibleMarkers.some((entry) => entry === null)
      ) {
        fail(`Visible Chrome route ${route} is not authenticated.`);
      }
      const safeId = contract.surfaceId.replace(/[^A-Za-z0-9._-]/gu, "_");
      const domPath = path.join(browserRoot, `${safeId}.html`);
      const screenshotPath = path.join(browserRoot, `${safeId}.png`);
      fs.writeFileSync(
        domPath,
        `${JSON.stringify({
          schema: "openclaw.control-director-visible-dom-evidence.v1",
          captureMode: BROWSER_CAPTURE_MODE,
          route,
          finalPath: state.finalPath,
          authenticated: true,
          connectionStatus: state.connectionStatus,
          visibleMarkers: state.visibleMarkers,
        })}\n`,
        { flag: "wx", mode: 0o600 },
      );
      await page.screenshot({ path: screenshotPath, fullPage: false });
      fs.chmodSync(screenshotPath, 0o600);
      assertCompletePng(fs.readFileSync(screenshotPath), `${route} visible screenshot`);
      routes.push({
        route,
        finalPath: state.finalPath,
        surfaceId: contract.surfaceId,
        observedAt: new Date().toISOString(),
        dom: { path: domPath, sha256: fileSha256(domPath) },
        screenshot: { path: screenshotPath, sha256: fileSha256(screenshotPath) },
      });
    }
    const evidencePath = path.join(browserRoot, "evidence.json");
    fs.writeFileSync(
      evidencePath,
      `${JSON.stringify(
        {
          schema: BROWSER_EVIDENCE_SCHEMA,
          captureMode: BROWSER_CAPTURE_MODE,
          sourceSha: identity.sourceSha,
          releaseId: identity.releaseId,
          checkedAt: new Date().toISOString(),
          platform: "mac-studio",
          host: readMacStudioHostIdentity(),
          browserName: "Google Chrome",
          browserVersion: browser.version(),
          viewport,
          authenticated: true,
          routes,
        },
        null,
        2,
      )}\n`,
      { flag: "wx", mode: 0o600 },
    );
    return evidencePath;
  } finally {
    await browser.close();
  }
}

function runtimeProbeEnvironment(extra) {
  const env = { ...process.env, ...extra };
  delete env.OPENCLAW_CONTROL_DIRECTOR_BROWSER_AUTH_URL;
  delete env.OPENCLAW_CONTROL_DIRECTOR_ALLOW_LOCAL_TOKEN_RESOLUTION;
  return env;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function validateLifecycleLockOwner(owner, expected, { requireLivePid = false } = {}) {
  exactKeys(
    owner,
    [
      "activeSha",
      "actor",
      "approvalId",
      "candidateSha",
      "createdAt",
      "invocationId",
      "operation",
      "operationId",
      "pid",
      "schema",
    ],
    "Global lifecycle lock owner",
  );
  if (
    owner.schema !== LIFECYCLE_LOCK_SCHEMA ||
    owner.activeSha !== expected.activeSourceSha ||
    owner.candidateSha !== expected.activeSourceSha ||
    owner.actor !== os.userInfo().username ||
    owner.approvalId !== expected.authorizationBindings.approvalId ||
    owner.operationId !== expected.authorizationBindings.operationId ||
    owner.invocationId !== expected.authorizationBindings.invocationId ||
    owner.operation !== "certification-lease" ||
    !Number.isInteger(owner.pid) ||
    owner.pid <= 0 ||
    !Number.isFinite(parseTimestamp(owner.createdAt, "Global lifecycle lock owner.createdAt"))
  ) {
    fail("Global lifecycle lock is not bound to the exact certification authorization.");
  }
  if (requireLivePid && !processIsAlive(owner.pid)) {
    fail("Global lifecycle lock owner PID is not live.");
  }
  return owner;
}

function readLiveLifecycleLockOwner(runtimeHome, expected) {
  const ownerPath = childPath(
    runtimeHome,
    path.join(runtimeHome, "locks/lifecycle.lock/owner.json"),
    "Global lifecycle lock owner",
  );
  const owner = validateLifecycleLockOwner(
    readJson(ownerPath, "Global lifecycle lock owner"),
    expected,
    { requireLivePid: true },
  );
  return { ownerPath, owner, sha256: fileSha256(ownerPath) };
}

function verifyExternalEvidenceBinding(binding, label) {
  exactKeys(binding, ["path", "sha256"], label);
  if (typeof binding.path !== "string" || !path.isAbsolute(binding.path)) {
    fail(`${label}.path must be absolute.`);
  }
  exact(binding.sha256, DIGEST_PATTERN, `${label}.sha256`);
  const stat = fs.lstatSync(binding.path);
  if (!stat.isFile() || stat.isSymbolicLink() || fileSha256(binding.path) !== binding.sha256) {
    fail(`${label} failed regular-file digest verification.`);
  }
  return fs.realpathSync(binding.path);
}

function snapshotBrowserRouteEvidence({
  artifactRoot,
  browserEvidencePath,
  identity,
  requiredRoutes,
  startedAt,
  checkedAt,
}) {
  const evidence = readJson(browserEvidencePath, "Mac Studio browser evidence");
  exactKeys(
    evidence,
    [
      "schema",
      "captureMode",
      "sourceSha",
      "releaseId",
      "checkedAt",
      "platform",
      "host",
      "browserName",
      "browserVersion",
      "viewport",
      "authenticated",
      "routes",
    ],
    "Mac Studio browser evidence",
  );
  const host = object(evidence.host, "Mac Studio browser evidence.host");
  exactKeys(
    host,
    ["hardwareClass", "osName", "osVersion", "architecture", "hostIdentitySha256"],
    "Mac Studio browser evidence.host",
  );
  const viewport = object(evidence.viewport, "Mac Studio browser evidence.viewport");
  exactKeys(viewport, ["width", "height"], "Mac Studio browser evidence.viewport");
  const browserCheckedAt = parseTimestamp(
    evidence.checkedAt,
    "Mac Studio browser evidence.checkedAt",
  );
  if (
    evidence.schema !== BROWSER_EVIDENCE_SCHEMA ||
    evidence.captureMode !== BROWSER_CAPTURE_MODE ||
    evidence.sourceSha !== identity.sourceSha ||
    evidence.releaseId !== identity.releaseId ||
    evidence.platform !== "mac-studio" ||
    host.hardwareClass !== "Mac Studio" ||
    host.osName !== "macOS" ||
    host.architecture !== "arm64" ||
    typeof host.osVersion !== "string" ||
    !host.osVersion.trim() ||
    !DIGEST_PATTERN.test(host.hostIdentitySha256) ||
    typeof evidence.browserName !== "string" ||
    !/Google Chrome/iu.test(evidence.browserName) ||
    typeof evidence.browserVersion !== "string" ||
    !evidence.browserVersion.trim() ||
    !Number.isFinite(viewport.width) ||
    viewport.width <= 0 ||
    !Number.isFinite(viewport.height) ||
    viewport.height <= 0 ||
    evidence.authenticated !== true ||
    browserCheckedAt < startedAt ||
    browserCheckedAt > checkedAt
  ) {
    fail("Mac Studio browser evidence does not match the exact authenticated runtime contract.");
  }
  const routes = Array.isArray(evidence.routes) ? evidence.routes : [];
  const routesByPath = new Map();
  for (const [index, route] of routes.entries()) {
    exactKeys(
      route,
      ["route", "finalPath", "surfaceId", "observedAt", "dom", "screenshot"],
      `Mac Studio browser evidence.routes[${index}]`,
    );
    if (routesByPath.has(route.route)) {
      fail(`Mac Studio browser evidence repeats route ${String(route.route)}.`);
    }
    const contract = browserRouteContracts[route.route];
    const routeObservedAt = parseTimestamp(route.observedAt, `${route.route}.observedAt`);
    if (
      !contract ||
      route.finalPath !== route.route ||
      route.surfaceId !== contract.surfaceId ||
      routeObservedAt < startedAt ||
      routeObservedAt > browserCheckedAt
    ) {
      fail(`Mac Studio browser evidence route ${String(route.route)} is invalid.`);
    }
    const domPath = verifyExternalEvidenceBinding(route.dom, `${route.route}.dom`);
    const screenshotPath = verifyExternalEvidenceBinding(
      route.screenshot,
      `${route.route}.screenshot`,
    );
    const dom = fs.readFileSync(domPath);
    const screenshot = fs.readFileSync(screenshotPath);
    assertCompletePng(screenshot, `${route.route} screenshot`);
    verifyCapturedBrowserDom(dom, route.route, contract);
    const domSnapshot = snapshotEvidenceFile(
      artifactRoot,
      `browser-${identity.releaseId}-${route.surfaceId}-dom`,
      domPath,
    );
    const screenshotSnapshot = snapshotEvidenceFile(
      artifactRoot,
      `browser-${identity.releaseId}-${route.surfaceId}-screenshot`,
      screenshotPath,
    );
    const normalized = {
      schema: "openclaw.control-director-browser-route-evidence.v1",
      captureMode: evidence.captureMode,
      sourceSha: identity.sourceSha,
      releaseId: identity.releaseId,
      checkedAt: evidence.checkedAt,
      platform: evidence.platform,
      host: evidence.host,
      browserName: evidence.browserName,
      browserVersion: evidence.browserVersion,
      viewport: evidence.viewport,
      authenticated: true,
      route: route.route,
      finalPath: route.finalPath,
      surfaceId: route.surfaceId,
      observedAt: route.observedAt,
      domSha256: domSnapshot.sha256,
      screenshotSha256: screenshotSnapshot.sha256,
    };
    const normalizedPath = path.join(
      artifactRoot,
      "artifacts",
      `browser-${route.surfaceId}.evidence.json`,
    );
    fs.writeFileSync(normalizedPath, `${JSON.stringify(normalized)}\n`, { mode: 0o600 });
    routesByPath.set(route.route, {
      evidence: artifactReference(artifactRoot, normalizedPath),
      dom: {
        path: path.relative(artifactRoot, domSnapshot.path),
        sha256: domSnapshot.sha256,
      },
      screenshot: {
        path: path.relative(artifactRoot, screenshotSnapshot.path),
        sha256: screenshotSnapshot.sha256,
      },
    });
  }
  const actualRoutes = [...routesByPath.keys()].toSorted((left, right) =>
    left.localeCompare(right),
  );
  const expectedRoutes = [...requiredRoutes].toSorted((left, right) => left.localeCompare(right));
  if (JSON.stringify(actualRoutes) !== JSON.stringify(expectedRoutes)) {
    fail("Mac Studio browser evidence does not contain the exact required route set.");
  }
  return routesByPath;
}

function parseJsonObject(bytes, label) {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  return object(parsed, label);
}

export function deriveProcessProbeCode(
  probeId,
  stdout,
  { expectedPluginIds = [], expectedSourceSha = "", expectedReleaseId = "" } = {},
) {
  const text = Buffer.from(stdout).toString("utf8").trim();
  if (probeId === "immutable-runtime-contract") {
    return text === `CUSTOM_RUNTIME_OK sha=${expectedSourceSha} release=${expectedReleaseId}`
      ? "immutable-runtime-contract-ok"
      : "";
  }
  const parsed = parseJsonObject(stdout, `${probeId} stdout`);
  if (parsed.error) {
    return "";
  }
  if (probeId === "gateway-health") {
    return parsed.ok === true && Number.isFinite(parsed.ts) ? "gateway-health-ok" : "";
  }
  if (probeId === "tailscale-status") {
    return parsed.BackendState === "Running" ? "tailscale-status-ok" : "";
  }
  if (probeId === "tailscale-serve-status") {
    const values = [];
    const visit = (value) => {
      if (typeof value === "string") {
        values.push(value);
      } else if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value && typeof value === "object") {
        Object.values(value).forEach(visit);
      }
    };
    visit(parsed);
    return values.some((value) => /^http:\/\/(?:127\.0\.0\.1|localhost):18789(?:\/|$)/u.test(value))
      ? "tailscale-serve-status-ok"
      : "";
  }
  if (probeId === "plugin-inventory") {
    const plugins = Array.isArray(parsed.plugins) ? parsed.plugins : [];
    return expectedPluginIds.every((pluginId) =>
      plugins.some(
        (plugin) =>
          plugin?.id === pluginId &&
          plugin?.enabled === true &&
          !["error", "failed", "disabled"].includes(String(plugin?.status ?? "").toLowerCase()),
      ),
    )
      ? "plugin-inventory-ok"
      : "";
  }
  if (probeId === "pcc-summary") {
    return [
      "portfolio",
      "planningPolicy",
      "executionCapacity",
      "runtimeIdentity",
      "updateSafety",
    ].every((key) => parsed[key] && typeof parsed[key] === "object")
      ? "pcc-summary-ok"
      : "";
  }
  if (probeId === "operations-snapshot") {
    return parsed.schema === "openclaw.operations-room.v2" &&
      parsed.freshness?.status === "fresh" &&
      parsed.completeness?.status === "complete" &&
      parsed.qualityTarget === 93 &&
      Number(parsed.qualityScore) >= 93
      ? "operations-snapshot-ok"
      : "";
  }
  if (probeId === "sig-health") {
    return parsed.current?.status === "ready" &&
      Number(parsed.current?.score) >= 93 &&
      Array.isArray(parsed.snapshots)
      ? "sig-health-ok"
      : "";
  }
  if (probeId === "sig-production-check") {
    return parsed.ready === true &&
      parsed.status === "ready" &&
      Number(parsed.score) >= 93 &&
      parsed.runtime?.sourceCommit === expectedSourceSha &&
      parsed.runtime?.releaseId === expectedReleaseId
      ? "sig-production-check-ok"
      : "";
  }
  return "";
}

async function executeProcessProbe(
  {
    artifactRoot,
    probeId,
    commandId,
    command,
    args,
    env,
    expectedPluginIds,
    expectedSourceSha,
    expectedReleaseId,
  },
  deps,
) {
  const startedAt = deps.now().toISOString();
  const result = await deps.runProcess(command, args, {
    env,
    timeoutMs: 30_000,
    maxBufferBytes: 4 * 1024 * 1024,
  });
  const endedAt = deps.now().toISOString();
  const stdout = Buffer.from(result.stdout ?? "");
  const stderr = Buffer.from(result.stderr ?? "");
  const probe = {
    type: "process",
    commandId,
    startedAt,
    endedAt,
    exitCode: Number(result.exitCode),
    stdout: writeProbeTranscript(artifactRoot, probeId, "stdout", stdout),
    stderr: writeProbeTranscript(artifactRoot, probeId, "stderr", stderr),
    parsedResult: {
      code:
        result.exitCode === 0
          ? deriveProcessProbeCode(probeId, stdout, {
              expectedPluginIds,
              expectedSourceSha,
              expectedReleaseId,
            })
          : "",
    },
  };
  if (probe.exitCode !== 0 || !probe.parsedResult.code) {
    fail(`Process probe ${probeId} did not produce a successful derived result.`);
  }
  return probe;
}

function replayBrowserRouteEvidence(probeId, browser, artifactRoot, expected) {
  exactKeys(browser, ["evidence", "dom", "screenshot"], `${probeId}.browser`);
  for (const [name, binding] of Object.entries(browser)) {
    verifyArtifactBinding(artifactRoot, binding, `${probeId}.browser.${name}`);
  }
  const routeEvidence = parseJsonObject(
    fs.readFileSync(regularFileWithin(artifactRoot, browser.evidence.path, probeId)),
    `${probeId} browser evidence`,
  );
  const route = probeId.slice("dashboard-route:".length);
  const contract = browserRouteContracts[route];
  if (!contract) {
    fail(`HTTP probe ${probeId} has no browser route contract.`);
  }
  const dom = fs.readFileSync(regularFileWithin(artifactRoot, browser.dom.path, probeId));
  const screenshot = fs.readFileSync(
    regularFileWithin(artifactRoot, browser.screenshot.path, probeId),
  );
  assertCompletePng(screenshot, `${probeId} screenshot`);
  verifyCapturedBrowserDom(dom, route, contract);
  const browserCheckedAt = parseTimestamp(routeEvidence.checkedAt, `${probeId}.browser.checkedAt`);
  const browserObservedAt = parseTimestamp(
    routeEvidence.observedAt,
    `${probeId}.browser.observedAt`,
  );
  if (
    routeEvidence.schema !== "openclaw.control-director-browser-route-evidence.v1" ||
    routeEvidence.captureMode !== BROWSER_CAPTURE_MODE ||
    routeEvidence.sourceSha !== expected.sourceSha ||
    routeEvidence.releaseId !== expected.releaseId ||
    routeEvidence.platform !== "mac-studio" ||
    routeEvidence.host?.hardwareClass !== "Mac Studio" ||
    routeEvidence.host?.osName !== "macOS" ||
    routeEvidence.host?.architecture !== "arm64" ||
    typeof routeEvidence.host?.hostIdentitySha256 !== "string" ||
    !DIGEST_PATTERN.test(routeEvidence.host.hostIdentitySha256) ||
    typeof routeEvidence.browserName !== "string" ||
    !/Google Chrome/iu.test(routeEvidence.browserName) ||
    typeof routeEvidence.browserVersion !== "string" ||
    !routeEvidence.browserVersion.trim() ||
    routeEvidence.authenticated !== true ||
    routeEvidence.route !== route ||
    routeEvidence.finalPath !== route ||
    routeEvidence.surfaceId !== contract.surfaceId ||
    routeEvidence.domSha256 !== browser.dom.sha256 ||
    routeEvidence.screenshotSha256 !== browser.screenshot.sha256 ||
    browserCheckedAt < expected.observationStartedAt ||
    browserCheckedAt > expected.observationCheckedAt ||
    browserObservedAt < expected.observationStartedAt ||
    browserObservedAt > browserCheckedAt
  ) {
    fail(`HTTP probe ${probeId} lacks exact authenticated semantic browser evidence.`);
  }
  return routeEvidence;
}

async function executeHttpProbe(
  {
    artifactRoot,
    probeId,
    commandId,
    url,
    expectedModelId,
    expectedSourceSha,
    expectedReleaseId,
    browser,
  },
  deps,
) {
  const requestedPath = new URL(url).pathname;
  const startedAt = deps.now().toISOString();
  const response = await deps.fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const body = Buffer.from(await response.arrayBuffer());
  const endedAt = deps.now().toISOString();
  const code = deriveHttpProbeCode(probeId, response.status, body, expectedModelId, {
    browser,
    artifactRoot,
    sourceSha: expectedSourceSha,
    releaseId: expectedReleaseId,
  });
  const responseTranscript = writeProbeTranscript(
    artifactRoot,
    probeId,
    "response.json",
    Buffer.from(
      JSON.stringify({
        status: response.status,
        bodyBase64: body.toString("base64"),
      }),
      "utf8",
    ),
  );
  if (!code) {
    fail(`HTTP probe ${probeId} did not produce a successful derived result.`);
  }
  return {
    type: "http",
    commandId,
    requestedPath,
    startedAt,
    endedAt,
    response: responseTranscript,
    ...(browser ? { browser } : {}),
    parsedResult: { code },
  };
}

export function deriveHttpProbeCode(probeId, status, body, expectedModelId, context = {}) {
  if (probeId === "ollama-residency") {
    const payload = parseJsonObject(body, "Ollama residency response");
    const models = Array.isArray(payload.models) ? payload.models : [];
    const now = Date.now();
    return status === 200 &&
      models.some(
        (model) =>
          (model?.name === expectedModelId || model?.model === expectedModelId) &&
          typeof model?.digest === "string" &&
          DIGEST_PATTERN.test(model.digest) &&
          Number.isSafeInteger(model?.size) &&
          model.size > 0 &&
          Number.isSafeInteger(model?.size_vram) &&
          model.size_vram > 0 &&
          typeof model?.expires_at === "string" &&
          Number.isFinite(Date.parse(model.expires_at)) &&
          Date.parse(model.expires_at) > now,
      )
      ? "ollama-residency-ok"
      : "";
  }
  if (!probeId.startsWith("dashboard-route:")) {
    return "";
  }
  const text = body.toString("utf8");
  if (
    status !== 200 ||
    !context.browser ||
    !context.artifactRoot ||
    !context.sourceSha ||
    !context.releaseId ||
    !/<!doctype html/iu.test(text) ||
    !/<script\b[^>]*\bsrc=/iu.test(text) ||
    !/(?:id=["']app["']|<openclaw-app\b)/iu.test(text) ||
    /unauthorized|forbidden/iu.test(text)
  ) {
    return "";
  }
  replayBrowserRouteEvidence(probeId, context.browser, context.artifactRoot, {
    sourceSha: context.sourceSha,
    releaseId: context.releaseId,
    observationStartedAt: context.observationStartedAt,
    observationCheckedAt: context.observationCheckedAt,
  });
  return `${probeId}-semantic-browser-ok`;
}

const defaultDependencies = {
  now: () => new Date(),
  fetch: (url, options) => fetch(url, options),
  runProcess(command, args, options) {
    const result = spawnSync(command, args, {
      env: options.env,
      encoding: "buffer",
      timeout: options.timeoutMs,
      maxBuffer: options.maxBufferBytes,
    });
    if (result.error) {
      throw result.error;
    }
    const stdout = result.stdout ?? Buffer.alloc(0);
    return {
      exitCode: result.status ?? 1,
      stdout,
      stderr: result.stderr ?? Buffer.alloc(0),
    };
  },
};

function phaseIdentity(params) {
  return {
    sourceSha:
      params.phase === "rollback"
        ? params.expectedRollbackSourceSha
        : params.expectedActiveSourceSha,
    releaseId:
      params.phase === "rollback"
        ? params.expectedRollbackReleaseId
        : params.expectedActiveReleaseId,
  };
}

export async function observeControlDirectorCapabilityPhase(params, dependencies = {}) {
  const deps = { ...defaultDependencies, ...dependencies };
  if (!PHASES.has(params.phase)) {
    fail("phase must be active, rollback, or restored.");
  }
  exact(params.expectedActiveSourceSha, SHA_PATTERN, "expectedActiveSourceSha");
  exact(params.expectedRollbackSourceSha, SHA_PATTERN, "expectedRollbackSourceSha");
  exact(params.expectedActiveReleaseId, IDENTITY_PATTERN, "expectedActiveReleaseId");
  exact(params.expectedRollbackReleaseId, IDENTITY_PATTERN, "expectedRollbackReleaseId");
  exact(params.selectedModelId, IDENTITY_PATTERN, "selectedModelId");
  const controlUiUrl = new URL(params.controlUiUrl);
  const ollamaUrl = new URL(params.ollamaUrl);
  if (
    !["http:", "https:"].includes(controlUiUrl.protocol) ||
    !["http:", "https:"].includes(ollamaUrl.protocol) ||
    !["127.0.0.1", "localhost"].includes(controlUiUrl.hostname) ||
    !["127.0.0.1", "localhost"].includes(ollamaUrl.hostname) ||
    controlUiUrl.username ||
    controlUiUrl.password ||
    ollamaUrl.username ||
    ollamaUrl.password
  ) {
    fail("Capability HTTP probes must use loopback services.");
  }
  validateAuthorizationBindings(params.authorizationBindings);
  if (
    !Array.isArray(params.configurationDigests) ||
    params.configurationDigests.length !== 2 ||
    params.configurationDigests.some((entry) => !DIGEST_PATTERN.test(entry))
  ) {
    fail("Exactly two expected configuration digests are required.");
  }
  if (!Array.isArray(params.configurationArtifacts) || params.configurationArtifacts.length !== 2) {
    fail("Exactly two configuration artifacts are required.");
  }
  const startedAt = deps.now().toISOString();
  const identity = phaseIdentity(params);
  const runtimeHome = fs.realpathSync(params.runtimeHome);
  const releasesRoot = fs.realpathSync(params.releasesRoot);
  const lifecycleLockExpected = {
    activeSourceSha: params.expectedActiveSourceSha,
    authorizationBindings: params.authorizationBindings,
  };
  const initialLifecycleLock = readLiveLifecycleLockOwner(runtimeHome, lifecycleLockExpected);
  const pointerPath = childPath(runtimeHome, params.pointerPath, "Active runtime pointer");
  const leasePath = childPath(runtimeHome, params.leasePath, "Certification lease");
  const expectedRuntimeRoot = childPath(
    releasesRoot,
    path.join(releasesRoot, identity.releaseId),
    "Immutable release",
  );
  const pointer = readJson(pointerPath, "Active runtime pointer");
  const runtimeRoot = childPath(releasesRoot, pointer.runtimeRoot, "Pointer runtime root");
  if (
    runtimeRoot !== expectedRuntimeRoot ||
    pointer.sourceSha !== identity.sourceSha ||
    pointer.releaseId !== identity.releaseId
  ) {
    fail("Active runtime pointer does not match the expected phase identity.");
  }

  const capabilityManifestPath = regularFileWithin(
    runtimeRoot,
    "config/custom-runtime-capabilities.json",
    "Capability manifest",
  );
  const surfaceManifestPath = regularFileWithin(
    runtimeRoot,
    "dist/control-ui/dashboard-surfaces.json",
    "Surface manifest",
  );
  const snapshotPath = regularFileWithin(runtimeRoot, "snapshot.json", "Runtime snapshot");
  const sourceStampPath = regularFileWithin(
    runtimeRoot,
    ".openclaw-production-sha",
    "Runtime source stamp",
  );
  const releaseLauncherPath = regularFileWithin(
    runtimeRoot,
    "scripts/custom-runtime/custom-runtime-launcher.sh",
    "Release launcher",
  );
  const installedLauncherPath = regularFileWithin(
    runtimeHome,
    "bin/custom-runtime-launcher.sh",
    "Installed launcher",
  );
  if (
    fs.readFileSync(sourceStampPath, "utf8").trim() !== identity.sourceSha ||
    fileSha256(installedLauncherPath) !== fileSha256(releaseLauncherPath)
  ) {
    fail("Immutable release source or installed launcher identity drifted.");
  }
  const capabilityManifest = readJson(capabilityManifestPath, "Capability manifest");
  const manifestCapabilities = Array.isArray(capabilityManifest.capabilities)
    ? capabilityManifest.capabilities
    : [];
  assertExactManifestIds(manifestCapabilities);
  if (
    fileSha256(capabilityManifestPath) !== pointer.capabilityManifestSha256 ||
    fileSha256(surfaceManifestPath) !== pointer.manifestSha256 ||
    JSON.stringify(
      [...pointer.requiredCapabilities].toSorted((left, right) => left.localeCompare(right)),
    ) !== JSON.stringify(CONTROL_DIRECTOR_CAPABILITY_IDS)
  ) {
    fail("Pointer manifest bindings do not match the immutable release.");
  }
  const snapshot = readJson(snapshotPath, "Runtime snapshot");
  if (
    snapshot.releaseId !== identity.releaseId ||
    object(snapshot.source, "Runtime snapshot source").commit !== identity.sourceSha
  ) {
    fail("Runtime snapshot does not match the expected phase identity.");
  }

  const configuration = params.configurationArtifacts.map((filePath, index) => {
    const realPath = fs.realpathSync(filePath);
    const digest = fileSha256(realPath);
    if (digest !== params.configurationDigests[index]) {
      fail(`Configuration artifact ${index + 1} digest mismatch.`);
    }
    return { path: realPath, sha256: digest };
  });

  const lifecycleCheckedAt = deps.now().getTime();
  const expectedResults = requiredLifecycleResults(params.phase);
  if (
    !Array.isArray(params.lifecycleReceipts) ||
    params.lifecycleReceipts.length !== expectedResults.length
  ) {
    fail(`${params.phase} requires lifecycle receipts: ${expectedResults.join(", ")}.`);
  }
  const receiptByResult = new Map();
  for (const receiptPath of params.lifecycleReceipts) {
    const realPath = childPath(runtimeHome, receiptPath, "Lifecycle receipt");
    const receipt = readJson(realPath, "Lifecycle receipt");
    if (receiptByResult.has(receipt.result)) {
      fail(`Duplicate lifecycle receipt result ${String(receipt.result)}.`);
    }
    receiptByResult.set(receipt.result, { realPath, receipt });
  }
  const receipts = expectedResults.map((result) => {
    const entry = receiptByResult.get(result);
    if (!entry) {
      fail(`Missing lifecycle receipt ${result}.`);
    }
    verifyLifecycleReceipt(
      entry.receipt,
      {
        result,
        activeSourceSha: params.expectedActiveSourceSha,
        rollbackSourceSha: params.expectedRollbackSourceSha,
        activeReleaseId: params.expectedActiveReleaseId,
        rollbackReleaseId: params.expectedRollbackReleaseId,
        authorizationBindings: params.authorizationBindings,
      },
      lifecycleCheckedAt,
    );
    const binding = {
      result,
      path: entry.realPath,
      sha256: fileSha256(entry.realPath),
    };
    if (entry.receipt.transitionId) {
      binding.transitionId = entry.receipt.transitionId;
    }
    return binding;
  });
  const lease = readJson(leasePath, "Certification lease");
  const leaseCreatedAt = parseTimestamp(lease.createdAt, "Certification lease.createdAt");
  const leaseExpiresAt = parseTimestamp(lease.expiresAt, "Certification lease.expiresAt");
  const leaseHeartbeatAt = parseTimestamp(lease.heartbeatAt, "Certification lease.heartbeatAt");
  if (
    lease.schema !== "openclaw.custom-runtime-certification-lease.v2" ||
    lease.activeSha !== params.expectedActiveSourceSha ||
    lease.candidateSha !== params.expectedActiveSourceSha ||
    lease.rollbackSha !== params.expectedRollbackSourceSha ||
    lease.activeReleaseId !== params.expectedActiveReleaseId ||
    lease.rollbackReleaseId !== params.expectedRollbackReleaseId ||
    lease.owner !== params.authorizationBindings.leaseOwner ||
    lease.actor !== os.userInfo().username ||
    lease.actor !== initialLifecycleLock.owner.actor ||
    lease.approvalId !== params.authorizationBindings.approvalId ||
    lease.operationId !== params.authorizationBindings.operationId ||
    lease.invocationId !== params.authorizationBindings.invocationId ||
    lease.operationClass !== "release-certification" ||
    lease.state !== (params.phase === "rollback" ? "rollback-drill" : "promoted") ||
    leaseCreatedAt > lifecycleCheckedAt ||
    leaseExpiresAt <= lifecycleCheckedAt ||
    leaseExpiresAt - leaseCreatedAt > 86_400_000 ||
    leaseHeartbeatAt < leaseCreatedAt ||
    leaseHeartbeatAt > lifecycleCheckedAt ||
    lifecycleCheckedAt - leaseHeartbeatAt > 300_000 ||
    lease.heartbeatRequired !== true ||
    !Number.isInteger(lease.heartbeatSequence) ||
    lease.heartbeatSequence < 0 ||
    !Number.isInteger(lease.pid) ||
    !processIsAlive(lease.pid)
  ) {
    fail("Current certification lease does not match the authorized campaign.");
  }
  const initialLockedState = {
    pointerSha256: fileSha256(pointerPath),
    leaseSha256: fileSha256(leasePath),
    lockSha256: initialLifecycleLock.sha256,
  };

  let restartReceipt = null;
  if (params.phase !== "rollback") {
    if (!params.restartReceipt) {
      fail(`${params.phase} requires a post-phase restart receipt.`);
    }
    const restartPath = childPath(runtimeHome, params.restartReceipt, "Restart receipt");
    const restart = readJson(restartPath, "Restart receipt");
    if (
      restart.result !== "restarted_verified" ||
      restart.release !== identity.releaseId ||
      parseTimestamp(restart.at, "Restart receipt.at") > lifecycleCheckedAt
    ) {
      fail("Restart receipt does not match the expected phase release.");
    }
    restartReceipt = { path: restartPath, sha256: fileSha256(restartPath) };
  }

  const artifactRoot = path.resolve(params.artifactRoot);
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const lockedEvidence = {
    pointer: snapshotEvidenceFile(artifactRoot, `${params.phase}-runtime-pointer`, pointerPath),
    lease: snapshotEvidenceFile(artifactRoot, `${params.phase}-certification-lease`, leasePath),
    lock: snapshotEvidenceFile(
      artifactRoot,
      `${params.phase}-global-lifecycle-lock-owner`,
      initialLifecycleLock.ownerPath,
    ),
  };
  const probes = {};
  probes["immutable-runtime-contract"] = await executeProcessProbe(
    {
      artifactRoot,
      probeId: "immutable-runtime-contract",
      commandId: "managed-launcher-verify",
      command: installedLauncherPath,
      args: ["--verify"],
      env: runtimeProbeEnvironment({
        OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releasesRoot,
        OPENCLAW_CUSTOM_RUNTIME_POINTER: pointerPath,
      }),
      expectedSourceSha: identity.sourceSha,
      expectedReleaseId: identity.releaseId,
    },
    deps,
  );
  if (probes["immutable-runtime-contract"].parsedResult.code !== "immutable-runtime-contract-ok") {
    fail("Managed launcher verification output did not match the exact runtime contract.");
  }
  const runtimeEnv = runtimeProbeEnvironment({
    OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
    OPENCLAW_CUSTOM_RUNTIME_RELEASES: releasesRoot,
    OPENCLAW_CUSTOM_RUNTIME_POINTER: pointerPath,
  });
  const processProbeSpecs = [
    ["gateway-health", "gateway-health-rpc", ["gateway", "call", "health", "--json"]],
    ["plugin-inventory", "managed-plugin-inventory", ["plugins", "list", "--json"]],
    ["pcc-summary", "pcc-summary-rpc", ["gateway", "call", "pcc.summary.get", "--json"]],
    [
      "operations-snapshot",
      "operations-snapshot-rpc",
      ["gateway", "call", "operations.snapshot.v2", "--json"],
    ],
    [
      "sig-health",
      "self-improvement-health-rpc",
      ["gateway", "call", "selfImprovement.health", "--json"],
    ],
    [
      "sig-production-check",
      "self-improvement-production-check-rpc",
      ["gateway", "call", "selfImprovement.productionCheck", "--json"],
    ],
  ];
  const requiredProbeIds = new Set(
    Object.values(CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS).flat(),
  );
  const requiredBrowserRoutes = new Set(
    [...requiredProbeIds]
      .filter((probeId) => probeId.startsWith("dashboard-route:"))
      .map((probeId) => probeId.slice("dashboard-route:".length)),
  );
  if (dependencies.captureBrowserEvidence && dependencies.allowTestBrowserCapture !== true) {
    fail("Injected browser capture is test-only and unavailable to production observers.");
  }
  const browserEvidencePath = dependencies.captureBrowserEvidence
    ? await dependencies.captureBrowserEvidence({
        providedPath: params.browserEvidence,
        artifactRoot,
        controlUiUrl: controlUiUrl.toString(),
        identity,
        managedConfigPath: configuration[0].path,
        requiredRoutes: requiredBrowserRoutes,
      })
    : await captureVisibleAuthenticatedChromeEvidence({
        artifactRoot,
        controlUiUrl: controlUiUrl.toString(),
        identity,
        managedConfigPath: configuration[0].path,
        requiredRoutes: requiredBrowserRoutes,
      });
  if (typeof browserEvidencePath !== "string" || !path.isAbsolute(browserEvidencePath)) {
    fail("Mac Studio browser capture did not return an absolute evidence path.");
  }
  const browserEvidenceStat = fs.lstatSync(browserEvidencePath);
  if (!browserEvidenceStat.isFile() || browserEvidenceStat.isSymbolicLink()) {
    fail("Mac Studio browser evidence must be a regular non-symlink file.");
  }
  const browserEvidenceByRoute = snapshotBrowserRouteEvidence({
    artifactRoot,
    browserEvidencePath: fs.realpathSync(browserEvidencePath),
    identity,
    requiredRoutes: requiredBrowserRoutes,
    startedAt: Date.parse(startedAt),
    checkedAt: deps.now().getTime(),
  });
  const pluginIds = manifestCapabilities
    .filter((capability) => capability.kind === "plugin")
    .map((capability) => capability.pluginId);
  for (const [probeId, commandId, args] of processProbeSpecs) {
    if (!requiredProbeIds.has(probeId)) {
      continue;
    }
    probes[probeId] = await executeProcessProbe(
      {
        artifactRoot,
        probeId,
        commandId,
        command: installedLauncherPath,
        args,
        env: runtimeEnv,
        expectedPluginIds: pluginIds,
        expectedSourceSha: identity.sourceSha,
        expectedReleaseId: identity.releaseId,
      },
      deps,
    );
  }
  for (const probeId of requiredProbeIds) {
    if (!probeId.startsWith("dashboard-route:")) {
      continue;
    }
    const route = probeId.slice("dashboard-route:".length);
    probes[probeId] = await executeHttpProbe(
      {
        artifactRoot,
        probeId,
        commandId: "control-ui-loopback-route",
        url: new URL(route, controlUiUrl).toString(),
        expectedSourceSha: identity.sourceSha,
        expectedReleaseId: identity.releaseId,
        browser: browserEvidenceByRoute.get(route),
      },
      deps,
    );
  }
  if (requiredProbeIds.has("ollama-residency")) {
    probes["ollama-residency"] = await executeHttpProbe(
      {
        artifactRoot,
        probeId: "ollama-residency",
        commandId: "ollama-loopback-residency",
        url: new URL("/api/ps", ollamaUrl).toString(),
        expectedModelId: params.selectedModelId,
      },
      deps,
    );
  }

  const surfaceManifest = readJson(surfaceManifestPath, "Surface manifest");
  const surfaces = Array.isArray(surfaceManifest.surfaces) ? surfaceManifest.surfaces : [];
  const immutableEvidenceSnapshots = new Map();
  const semanticEvidenceByCapability = new Map();
  const capabilities = manifestCapabilities
    .map((capability) => {
      const id = exact(capability.id, IDENTITY_PATTERN, "capability.id");
      const requiredPaths = Array.isArray(capability.requiredPaths) ? capability.requiredPaths : [];
      if (requiredPaths.length === 0) {
        fail(`Capability ${id} has no required paths.`);
      }
      const semanticEvidence = [];
      const requiredPathDigests = Object.fromEntries(
        requiredPaths
          .toSorted((left, right) => left.localeCompare(right))
          .map((relativePath) => {
            const filePath = regularFileWithin(runtimeRoot, relativePath, `${id} required path`);
            const digest = fileSha256(filePath);
            let binding = immutableEvidenceSnapshots.get(filePath);
            if (!binding) {
              const evidenceSnapshot = snapshotEvidenceFile(
                artifactRoot,
                `required-${digest}-${immutableEvidenceSnapshots.size}`,
                filePath,
              );
              binding = {
                path: path.relative(artifactRoot, evidenceSnapshot.path),
                sha256: evidenceSnapshot.sha256,
              };
              immutableEvidenceSnapshots.set(filePath, binding);
            }
            semanticEvidence.push({ logicalPath: relativePath, ...binding });
            return [relativePath, digest];
          }),
      );
      semanticEvidenceByCapability.set(id, semanticEvidence);
      if (capability.kind === "dashboard_surface") {
        const surface = surfaces.find((entry) => entry?.id === capability.surfaceId);
        const assets = Array.isArray(surface?.assets) ? surface.assets : [];
        if (assets.length === 0) {
          fail(`Dashboard capability ${id} has no immutable surface assets.`);
        }
        const assetDigests = Object.fromEntries(
          assets
            .toSorted((left, right) => left.localeCompare(right))
            .map((relativePath) => {
              const filePath = regularFileWithin(
                path.join(runtimeRoot, "dist/control-ui"),
                relativePath,
                `${id} surface asset`,
              );
              return [relativePath, fileSha256(filePath)];
            }),
        );
        probes[`surface-contract:${capability.surfaceId}`] = {
          type: "derived",
          commandId: "immutable-dashboard-surface-contract",
          evidence: assets
            .toSorted((left, right) => left.localeCompare(right))
            .map((relativePath) => {
              const filePath = regularFileWithin(
                path.join(runtimeRoot, "dist/control-ui"),
                relativePath,
                `${id} surface asset`,
              );
              const binding = snapshotEvidenceFile(
                artifactRoot,
                `${params.phase}-${id}-surface-${relativePath}`,
                filePath,
              );
              binding.path = path.relative(artifactRoot, binding.path);
              binding.logicalPath = relativePath;
              return binding;
            }),
          parsedResult: {
            code: "dashboard-surface-contract-ok",
            digest: sha256(canonicalControlDirectorCapabilityBytes(assetDigests)),
          },
        };
      } else if (capability.kind === "plugin") {
        const pluginManifestPath = regularFileWithin(
          runtimeRoot,
          `dist-runtime/extensions/${capability.pluginId}/openclaw.plugin.json`,
          `${id} bundled plugin`,
        );
        const logicalPath = `dist-runtime/extensions/${capability.pluginId}/openclaw.plugin.json`;
        const pluginBinding = snapshotEvidenceFile(
          artifactRoot,
          `${params.phase}-${id}-plugin-manifest`,
          pluginManifestPath,
        );
        const evidence = {
          logicalPath,
          ...pluginBinding,
          path: path.relative(artifactRoot, pluginBinding.path),
        };
        probes[`plugin-contract:${capability.pluginId}`] = {
          type: "derived",
          commandId: "immutable-bundled-plugin-contract",
          evidence: [evidence],
          parsedResult: {
            code: "bundled-plugin-contract-ok",
            digest: sha256(
              canonicalControlDirectorCapabilityBytes({
                [logicalPath]: evidence.sha256,
              }),
            ),
          },
        };
      }
      return {
        id,
        kind: capability.kind,
        requiredPathDigests,
        probeIds: [...CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS[id]],
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
  if (
    CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS["runtime:tailscale-primary-continuity"].includes(
      "tailscale-status",
    )
  ) {
    const tailscaleCli = "/opt/homebrew/bin/tailscale";
    const tailscaleSocket = path.join(
      os.homedir(),
      ".local/share/tailscale-userspace/tailscaled.sock",
    );
    probes["tailscale-status"] = await executeProcessProbe(
      {
        artifactRoot,
        probeId: "tailscale-status",
        commandId: "tailscale-read-only-status",
        command: tailscaleCli,
        args: ["--socket", tailscaleSocket, "status", "--json"],
        env: runtimeProbeEnvironment({}),
      },
      deps,
    );
    probes["tailscale-serve-status"] = await executeProcessProbe(
      {
        artifactRoot,
        probeId: "tailscale-serve-status",
        commandId: "tailscale-read-only-serve-status",
        command: tailscaleCli,
        args: ["--socket", tailscaleSocket, "serve", "status", "--json"],
        env: runtimeProbeEnvironment({}),
      },
      deps,
    );
  }
  for (const capability of capabilities) {
    const runtimeEvidence = semanticEvidenceByCapability.get(capability.id);
    const semanticProbeIds = capability.probeIds.filter(
      (probeId) =>
        probeId !== `capability-contract:${capability.id}` &&
        probeId !== `capability-runtime:${capability.id}`,
    );
    probes[`capability-runtime:${capability.id}`] = {
      type: "derived",
      commandId: "capability-specific-semantic-evidence",
      semanticProbeIds,
      evidence: runtimeEvidence,
      parsedResult: {
        code: "capability-semantic-evidence-ok",
        digest: digestControlDirectorCapabilityRuntimeEvidence({
          phase: params.phase,
          sourceSha: identity.sourceSha,
          releaseId: identity.releaseId,
          selectedModelId: params.selectedModelId,
          configurationDigests: params.configurationDigests,
          authorizationBindings: params.authorizationBindings,
          capability,
          probes,
          runtimeEvidence,
        }),
      },
    };
  }
  for (const capability of capabilities) {
    probes[`capability-contract:${capability.id}`] = {
      type: "derived",
      commandId: "independent-capability-evidence-contract",
      parsedResult: {
        code: "capability-evidence-contract-ok",
        digest: digestControlDirectorCapabilityEvidence({
          phase: params.phase,
          sourceSha: identity.sourceSha,
          releaseId: identity.releaseId,
          selectedModelId: params.selectedModelId,
          configurationDigests: params.configurationDigests,
          authorizationBindings: params.authorizationBindings,
          capability,
          probes,
        }),
      },
    };
  }

  let previousObservationSha256 = null;
  if (params.phase !== "active") {
    if (!params.previousObservation) {
      fail(`${params.phase} requires the previous phase observation.`);
    }
    const previous = readJson(params.previousObservation, "Previous capability observation");
    verifyControlDirectorCapabilityObservation(previous);
    const expectedPreviousPhases =
      params.phase === "rollback" ? ["active"] : ["rollback", "restored"];
    if (!expectedPreviousPhases.includes(previous.phase)) {
      fail(`${params.phase} previous observation must be ${expectedPreviousPhases.join(" or ")}.`);
    }
    previousObservationSha256 = previous.contentSha256;
  } else if (params.previousObservation) {
    fail("active must not accept a previous observation.");
  }

  await deps.beforeFinalRecheck?.();
  const finalLifecycleLock = readLiveLifecycleLockOwner(runtimeHome, lifecycleLockExpected);
  if (
    fileSha256(pointerPath) !== initialLockedState.pointerSha256 ||
    fileSha256(leasePath) !== initialLockedState.leaseSha256 ||
    finalLifecycleLock.sha256 !== initialLockedState.lockSha256 ||
    lockedEvidence.pointer.sha256 !== initialLockedState.pointerSha256 ||
    lockedEvidence.lease.sha256 !== initialLockedState.leaseSha256 ||
    lockedEvidence.lock.sha256 !== initialLockedState.lockSha256
  ) {
    fail("Locked pointer, lease, or lifecycle authorization changed before issuance.");
  }
  const finalPointer = readJson(pointerPath, "Final locked runtime pointer");
  const finalLease = readJson(leasePath, "Final locked certification lease");
  const checkedAtDate = deps.now();
  const checkedAtMs = checkedAtDate.getTime();
  const finalLeaseExpiresAt = parseTimestamp(
    finalLease.expiresAt,
    "Final certification lease.expiresAt",
  );
  const finalLeaseHeartbeatAt = parseTimestamp(
    finalLease.heartbeatAt,
    "Final certification lease.heartbeatAt",
  );
  if (
    finalPointer.sourceSha !== identity.sourceSha ||
    finalPointer.releaseId !== identity.releaseId ||
    finalLease.activeSha !== params.expectedActiveSourceSha ||
    finalLease.candidateSha !== params.expectedActiveSourceSha ||
    finalLease.rollbackSha !== params.expectedRollbackSourceSha ||
    finalLease.activeReleaseId !== params.expectedActiveReleaseId ||
    finalLease.rollbackReleaseId !== params.expectedRollbackReleaseId ||
    finalLease.owner !== params.authorizationBindings.leaseOwner ||
    finalLease.actor !== os.userInfo().username ||
    finalLease.actor !== finalLifecycleLock.owner.actor ||
    finalLease.approvalId !== params.authorizationBindings.approvalId ||
    finalLease.operationId !== params.authorizationBindings.operationId ||
    finalLease.invocationId !== params.authorizationBindings.invocationId ||
    finalLease.state !== (params.phase === "rollback" ? "rollback-drill" : "promoted") ||
    finalLeaseExpiresAt <= checkedAtMs ||
    finalLeaseHeartbeatAt > checkedAtMs ||
    checkedAtMs - finalLeaseHeartbeatAt > 300_000 ||
    finalLease.heartbeatRequired !== true ||
    !Number.isInteger(finalLease.pid) ||
    !processIsAlive(finalLease.pid)
  ) {
    fail("Final locked pointer or lease identity does not match the observed phase.");
  }
  const checkedAt = checkedAtDate.toISOString();
  const observation = {
    schema: CONTROL_DIRECTOR_CAPABILITY_OBSERVATION_SCHEMA,
    phase: params.phase,
    sourceSha: identity.sourceSha,
    releaseId: identity.releaseId,
    selectedModelId: params.selectedModelId,
    startedAt,
    checkedAt,
    configurationDigests: [...params.configurationDigests],
    configuration,
    authorizationBindings: { ...params.authorizationBindings },
    artifactRoot,
    runtime: {
      pointer: lockedEvidence.pointer,
      runtimeRootSha256: sha256(Buffer.from(runtimeRoot, "utf8")),
      capabilityManifest: {
        path: capabilityManifestPath,
        sha256: fileSha256(capabilityManifestPath),
      },
      surfaceManifest: { path: surfaceManifestPath, sha256: fileSha256(surfaceManifestPath) },
      launcher: snapshotEvidenceFile(
        artifactRoot,
        `${params.phase}-installed-launcher`,
        installedLauncherPath,
      ),
      snapshot: { path: snapshotPath, sha256: fileSha256(snapshotPath) },
      sourceStamp: { path: sourceStampPath, sha256: fileSha256(sourceStampPath) },
    },
    lifecycle: {
      lease: lockedEvidence.lease,
      lock: {
        owner: lockedEvidence.lock,
        ownerPid: finalLifecycleLock.owner.pid,
        verifiedLiveAt: checkedAt,
      },
      receipts,
      restartReceipt,
    },
    capabilities,
    probes,
    previousObservationSha256,
  };
  observation.contentSha256 = digestControlDirectorCapabilityObservation(observation);
  verifyControlDirectorCapabilityObservation(observation);
  const issuanceLifecycleLock = readLiveLifecycleLockOwner(runtimeHome, lifecycleLockExpected);
  if (
    fileSha256(pointerPath) !== initialLockedState.pointerSha256 ||
    fileSha256(leasePath) !== initialLockedState.leaseSha256 ||
    issuanceLifecycleLock.sha256 !== initialLockedState.lockSha256
  ) {
    fail("Locked pointer, lease, or lifecycle authorization changed at issuance.");
  }
  return observation;
}

function verifyArtifactBinding(artifactRoot, binding, label) {
  exactKeys(binding, ["path", "sha256"], label);
  exact(binding.sha256, DIGEST_PATTERN, `${label}.sha256`);
  const filePath = regularFileWithin(artifactRoot, binding.path, `${label}.path`);
  if (fileSha256(filePath) !== binding.sha256) {
    fail(`${label} digest verification failed.`);
  }
}

const PROCESS_PROBE_COMMAND_IDS = Object.freeze({
  "immutable-runtime-contract": "managed-launcher-verify",
  "gateway-health": "gateway-health-rpc",
  "plugin-inventory": "managed-plugin-inventory",
  "pcc-summary": "pcc-summary-rpc",
  "operations-snapshot": "operations-snapshot-rpc",
  "sig-health": "self-improvement-health-rpc",
  "sig-production-check": "self-improvement-production-check-rpc",
  "tailscale-status": "tailscale-read-only-status",
  "tailscale-serve-status": "tailscale-read-only-serve-status",
});

export function replayControlDirectorCapabilityProbe(probeId, probe, artifactRoot, expected) {
  object(probe, `probe ${probeId}`);
  const expectsProcess = Object.hasOwn(PROCESS_PROBE_COMMAND_IDS, probeId);
  const expectsHttp = probeId === "ollama-residency" || probeId.startsWith("dashboard-route:");
  const expectsDerived =
    probeId.startsWith("capability-contract:") ||
    probeId.startsWith("capability-runtime:") ||
    probeId.startsWith("surface-contract:") ||
    probeId.startsWith("plugin-contract:");
  if (
    (expectsProcess && probe.type !== "process") ||
    (expectsHttp && probe.type !== "http") ||
    (expectsDerived && probe.type !== "derived") ||
    (!expectsProcess && !expectsHttp && !expectsDerived)
  ) {
    fail(`Probe ${probeId} does not use its fixed registered probe type.`);
  }
  if (probe.type === "process") {
    const probeStartedAt = parseTimestamp(probe.startedAt, `${probeId}.startedAt`);
    const probeEndedAt = parseTimestamp(probe.endedAt, `${probeId}.endedAt`);
    if (probe.commandId !== PROCESS_PROBE_COMMAND_IDS[probeId] || probe.exitCode !== 0) {
      fail(`Process probe ${probeId} has invalid fixed command identity or exit code.`);
    }
    if (
      probeEndedAt < probeStartedAt ||
      probeStartedAt < expected.observationStartedAt ||
      probeEndedAt > expected.observationCheckedAt
    ) {
      fail(`Process probe ${probeId} falls outside the observation time window.`);
    }
    verifyArtifactBinding(artifactRoot, probe.stdout, `${probeId}.stdout`);
    verifyArtifactBinding(artifactRoot, probe.stderr, `${probeId}.stderr`);
    const stdout = fs.readFileSync(regularFileWithin(artifactRoot, probe.stdout.path, probeId));
    const derived = deriveProcessProbeCode(probeId, stdout, {
      expectedPluginIds: expected.pluginIds,
      expectedSourceSha: expected.sourceSha,
      expectedReleaseId: expected.releaseId,
    });
    if (!derived || probe.parsedResult?.code !== derived) {
      fail(`Process probe ${probeId} transcript does not replay to its claimed result.`);
    }
    return derived;
  }
  if (probe.type === "http") {
    const probeStartedAt = parseTimestamp(probe.startedAt, `${probeId}.startedAt`);
    const probeEndedAt = parseTimestamp(probe.endedAt, `${probeId}.endedAt`);
    const expectedCommandId =
      probeId === "ollama-residency"
        ? "ollama-loopback-residency"
        : probeId.startsWith("dashboard-route:")
          ? "control-ui-loopback-route"
          : "";
    const expectedPath =
      probeId === "ollama-residency"
        ? "/api/ps"
        : probeId.startsWith("dashboard-route:")
          ? probeId.slice("dashboard-route:".length)
          : "";
    if (probe.commandId !== expectedCommandId || probe.requestedPath !== expectedPath) {
      fail(`HTTP probe ${probeId} has invalid fixed command identity.`);
    }
    if (
      probeEndedAt < probeStartedAt ||
      probeStartedAt < expected.observationStartedAt ||
      probeEndedAt > expected.observationCheckedAt
    ) {
      fail(`HTTP probe ${probeId} falls outside the observation time window.`);
    }
    verifyArtifactBinding(artifactRoot, probe.response, `${probeId}.response`);
    const transcript = parseJsonObject(
      fs.readFileSync(regularFileWithin(artifactRoot, probe.response.path, probeId)),
      `${probeId} response transcript`,
    );
    const body = Buffer.from(String(transcript.bodyBase64 ?? ""), "base64");
    const derived = deriveHttpProbeCode(
      probeId,
      Number(transcript.status),
      body,
      expected.selectedModelId,
      {
        browser: probe.browser,
        artifactRoot,
        sourceSha: expected.sourceSha,
        releaseId: expected.releaseId,
        observationStartedAt: expected.observationStartedAt,
        observationCheckedAt: expected.observationCheckedAt,
      },
    );
    if (!derived || probe.parsedResult?.code !== derived) {
      fail(`HTTP probe ${probeId} transcript does not replay to its claimed result.`);
    }
    return derived;
  }
  if (probe.type === "derived") {
    if (
      typeof probe.parsedResult?.code !== "string" ||
      !probe.parsedResult.code.endsWith("-ok") ||
      !DIGEST_PATTERN.test(probe.parsedResult?.digest)
    ) {
      fail(`Derived probe ${probeId} is invalid.`);
    }
    if (probeId.startsWith("capability-runtime:")) {
      if (
        probe.commandId !== "capability-specific-semantic-evidence" ||
        probe.parsedResult.code !== "capability-semantic-evidence-ok" ||
        !Array.isArray(probe.semanticProbeIds) ||
        JSON.stringify(probe.semanticProbeIds) !==
          JSON.stringify(expected.semanticProbeIds ?? []) ||
        !Array.isArray(probe.evidence) ||
        probe.evidence.length === 0
      ) {
        fail(`Derived probe ${probeId} has an invalid capability-specific evidence contract.`);
      }
      const evidenceDigests = {};
      for (const [index, binding] of probe.evidence.entries()) {
        exactKeys(binding, ["logicalPath", "path", "sha256"], `${probeId}.evidence[${index}]`);
        verifyArtifactBinding(
          artifactRoot,
          { path: binding.path, sha256: binding.sha256 },
          `${probeId}.evidence[${index}]`,
        );
        if (Object.hasOwn(evidenceDigests, binding.logicalPath)) {
          fail(`Derived probe ${probeId} repeats an immutable evidence path.`);
        }
        evidenceDigests[binding.logicalPath] = binding.sha256;
      }
      const expectedDigests = expected.requiredPathDigests ?? {};
      if (
        JSON.stringify(canonicalValue(evidenceDigests)) !==
        JSON.stringify(canonicalValue(expectedDigests))
      ) {
        fail(`Derived probe ${probeId} does not bind the capability's exact immutable evidence.`);
      }
    }
    if (probeId.startsWith("surface-contract:") || probeId.startsWith("plugin-contract:")) {
      const expectedCommandId = probeId.startsWith("surface-contract:")
        ? "immutable-dashboard-surface-contract"
        : "immutable-bundled-plugin-contract";
      const expectedCode = probeId.startsWith("surface-contract:")
        ? "dashboard-surface-contract-ok"
        : "bundled-plugin-contract-ok";
      if (
        probe.commandId !== expectedCommandId ||
        probe.parsedResult.code !== expectedCode ||
        !Array.isArray(probe.evidence) ||
        probe.evidence.length === 0
      ) {
        fail(`Derived probe ${probeId} has an invalid fixed evidence contract.`);
      }
      const digests = {};
      for (const [index, binding] of probe.evidence.entries()) {
        exactKeys(binding, ["logicalPath", "path", "sha256"], `${probeId}.evidence[${index}]`);
        exact(binding.logicalPath, /^.+$/u, `${probeId}.evidence[${index}].logicalPath`);
        verifyArtifactBinding(
          artifactRoot,
          { path: binding.path, sha256: binding.sha256 },
          `${probeId}.evidence[${index}]`,
        );
        if (Object.hasOwn(digests, binding.logicalPath)) {
          fail(`Derived probe ${probeId} repeats an evidence path.`);
        }
        digests[binding.logicalPath] = binding.sha256;
      }
      const logicalPaths = Object.keys(digests).toSorted((left, right) =>
        left.localeCompare(right),
      );
      const expectedLogicalPaths = [...(expected.derivedEvidencePaths ?? [])].toSorted(
        (left, right) => left.localeCompare(right),
      );
      if (JSON.stringify(logicalPaths) !== JSON.stringify(expectedLogicalPaths)) {
        fail(`Derived probe ${probeId} does not bind the exact immutable evidence set.`);
      }
      if (sha256(canonicalControlDirectorCapabilityBytes(digests)) !== probe.parsedResult.digest) {
        fail(`Derived probe ${probeId} evidence digest does not replay.`);
      }
    }
    return probe.parsedResult.code;
  }
  return fail(`Probe ${probeId} has an unsupported type.`);
}

export function verifyControlDirectorCapabilityObservation(observation, options = {}) {
  rejectCallerOutcomes(observation);
  exactKeys(
    observation,
    [
      "schema",
      "phase",
      "sourceSha",
      "releaseId",
      "selectedModelId",
      "startedAt",
      "checkedAt",
      "configurationDigests",
      "configuration",
      "authorizationBindings",
      "artifactRoot",
      "runtime",
      "lifecycle",
      "capabilities",
      "probes",
      "previousObservationSha256",
      "contentSha256",
    ],
    "observation",
  );
  if (
    observation.schema !== CONTROL_DIRECTOR_CAPABILITY_OBSERVATION_SCHEMA ||
    !PHASES.has(observation.phase)
  ) {
    fail("Capability observation schema or phase is invalid.");
  }
  exact(observation.sourceSha, SHA_PATTERN, "observation.sourceSha");
  exact(observation.releaseId, IDENTITY_PATTERN, "observation.releaseId");
  exact(observation.selectedModelId, IDENTITY_PATTERN, "observation.selectedModelId");
  const startedAt = parseTimestamp(observation.startedAt, "observation.startedAt");
  const checkedAt = parseTimestamp(observation.checkedAt, "observation.checkedAt");
  if (checkedAt < startedAt) {
    fail("Capability observation completed before it started.");
  }
  if (
    !Array.isArray(observation.configurationDigests) ||
    observation.configurationDigests.length !== 2 ||
    observation.configurationDigests.some((entry) => !DIGEST_PATTERN.test(entry))
  ) {
    fail("Capability observation has invalid configuration digests.");
  }
  validateAuthorizationBindings(observation.authorizationBindings);
  exact(observation.contentSha256, DIGEST_PATTERN, "observation.contentSha256");
  if (digestControlDirectorCapabilityObservation(observation) !== observation.contentSha256) {
    fail("Capability observation canonical digest mismatch.");
  }
  if (
    observation.phase === "active"
      ? observation.previousObservationSha256 !== null
      : !DIGEST_PATTERN.test(observation.previousObservationSha256)
  ) {
    fail("Capability observation hash-chain binding is invalid.");
  }
  const capabilities = Array.isArray(observation.capabilities) ? observation.capabilities : [];
  const ids = capabilities
    .map((entry) => entry?.id)
    .toSorted((left, right) => left.localeCompare(right));
  if (
    capabilities.length !== CONTROL_DIRECTOR_CAPABILITY_IDS.length ||
    JSON.stringify(ids) !== JSON.stringify(CONTROL_DIRECTOR_CAPABILITY_IDS)
  ) {
    fail("Capability observation does not contain the exact static 35-capability registry.");
  }
  const probes = object(observation.probes, "observation.probes");
  const runtime = object(observation.runtime, "observation.runtime");
  const lifecycle = object(observation.lifecycle, "observation.lifecycle");
  exactKeys(lifecycle, ["lease", "lock", "receipts", "restartReceipt"], "observation.lifecycle");
  const lock = object(lifecycle.lock, "observation.lifecycle.lock");
  exactKeys(lock, ["owner", "ownerPid", "verifiedLiveAt"], "observation.lifecycle.lock");
  const lockOwner = validateLifecycleLockOwner(
    readBoundAbsoluteJson(lock.owner, "observation.lifecycle.lock.owner"),
    {
      activeSourceSha:
        observation.phase === "rollback"
          ? object(
              readBoundAbsoluteJson(lifecycle.lease, "observation.lifecycle.lease"),
              "observation.lifecycle.lease",
            ).activeSha
          : observation.sourceSha,
      authorizationBindings: observation.authorizationBindings,
    },
  );
  const lockVerifiedAt = parseTimestamp(
    lock.verifiedLiveAt,
    "observation.lifecycle.lock.verifiedLiveAt",
  );
  if (lock.ownerPid !== lockOwner.pid || lockVerifiedAt < startedAt || lockVerifiedAt > checkedAt) {
    fail("Capability observation lifecycle lock evidence is invalid.");
  }
  const pointerEvidence = readBoundAbsoluteJson(runtime.pointer, "observation.runtime.pointer");
  const leaseEvidence = readBoundAbsoluteJson(lifecycle.lease, "observation.lifecycle.lease");
  if (
    pointerEvidence.sourceSha !== observation.sourceSha ||
    pointerEvidence.releaseId !== observation.releaseId ||
    leaseEvidence.activeSha !== lockOwner.activeSha ||
    leaseEvidence.candidateSha !== lockOwner.candidateSha ||
    leaseEvidence.owner !== observation.authorizationBindings.leaseOwner ||
    leaseEvidence.approvalId !== observation.authorizationBindings.approvalId ||
    leaseEvidence.operationId !== observation.authorizationBindings.operationId ||
    leaseEvidence.invocationId !== observation.authorizationBindings.invocationId ||
    leaseEvidence.state !== (observation.phase === "rollback" ? "rollback-drill" : "promoted")
  ) {
    fail("Capability observation locked pointer or lease evidence is invalid.");
  }
  const surfaceManifest = readBoundAbsoluteJson(
    runtime.surfaceManifest,
    "observation.runtime.surfaceManifest",
  );
  const surfaceAssetsById = new Map(
    (Array.isArray(surfaceManifest.surfaces) ? surfaceManifest.surfaces : []).map((surface) => [
      surface?.id,
      Array.isArray(surface?.assets) ? surface.assets : [],
    ]),
  );
  const pluginIds = capabilities
    .filter((capability) => capability.id.startsWith("plugin:"))
    .map((capability) => capability.id.slice("plugin:".length));
  for (const capability of capabilities) {
    exactKeys(capability, ["id", "kind", "requiredPathDigests", "probeIds"], capability.id);
    const expectedProbeIds = CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS[capability.id];
    if (JSON.stringify(capability.probeIds) !== JSON.stringify(expectedProbeIds)) {
      fail(`Capability ${capability.id} probe requirements drifted from the static registry.`);
    }
    const requiredPathDigests = object(
      capability.requiredPathDigests,
      `${capability.id}.requiredPathDigests`,
    );
    if (
      Object.keys(requiredPathDigests).length === 0 ||
      Object.values(requiredPathDigests).some((entry) => !DIGEST_PATTERN.test(entry))
    ) {
      fail(`Capability ${capability.id} required-path digest contract is invalid.`);
    }
    const semanticProbeIds = expectedProbeIds.filter(
      (probeId) =>
        probeId !== `capability-contract:${capability.id}` &&
        probeId !== `capability-runtime:${capability.id}`,
    );
    for (const probeId of expectedProbeIds) {
      const probe = object(probes[probeId], `probe ${probeId}`);
      const derivedEvidencePaths = probeId.startsWith("surface-contract:")
        ? surfaceAssetsById.get(probeId.slice("surface-contract:".length))
        : probeId.startsWith("plugin-contract:")
          ? [
              `dist-runtime/extensions/${probeId.slice("plugin-contract:".length)}/openclaw.plugin.json`,
            ]
          : undefined;
      replayControlDirectorCapabilityProbe(probeId, probe, observation.artifactRoot, {
        sourceSha: observation.sourceSha,
        releaseId: observation.releaseId,
        selectedModelId: observation.selectedModelId,
        pluginIds,
        observationStartedAt: startedAt,
        observationCheckedAt: checkedAt,
        derivedEvidencePaths,
        requiredPathDigests,
        semanticProbeIds,
      });
    }
    const contractProbe = object(
      probes[`capability-contract:${capability.id}`],
      `probe capability-contract:${capability.id}`,
    );
    if (
      contractProbe.commandId !== "independent-capability-evidence-contract" ||
      contractProbe.parsedResult?.code !== "capability-evidence-contract-ok" ||
      contractProbe.parsedResult?.digest !==
        digestControlDirectorCapabilityEvidence({
          phase: observation.phase,
          sourceSha: observation.sourceSha,
          releaseId: observation.releaseId,
          selectedModelId: observation.selectedModelId,
          configurationDigests: observation.configurationDigests,
          authorizationBindings: observation.authorizationBindings,
          capability,
          probes,
        })
    ) {
      fail(`Capability ${capability.id} evidence contract is not independently bound.`);
    }
    const runtimeProbe = object(
      probes[`capability-runtime:${capability.id}`],
      `probe capability-runtime:${capability.id}`,
    );
    if (
      runtimeProbe.commandId !== "capability-specific-semantic-evidence" ||
      runtimeProbe.parsedResult?.code !== "capability-semantic-evidence-ok" ||
      runtimeProbe.parsedResult?.digest !==
        digestControlDirectorCapabilityRuntimeEvidence({
          phase: observation.phase,
          sourceSha: observation.sourceSha,
          releaseId: observation.releaseId,
          selectedModelId: observation.selectedModelId,
          configurationDigests: observation.configurationDigests,
          authorizationBindings: observation.authorizationBindings,
          capability,
          probes,
          runtimeEvidence: runtimeProbe.evidence,
        })
    ) {
      fail(`Capability ${capability.id} runtime evidence is not independently bound.`);
    }
  }
  if (options.verifyArtifacts !== false) {
    const artifactRoot = fs.realpathSync(observation.artifactRoot);
    for (const [probeId, probe] of Object.entries(probes)) {
      if (probe.type === "process" || probe.type === "http") {
        replayControlDirectorCapabilityProbe(probeId, probe, artifactRoot, {
          sourceSha: observation.sourceSha,
          releaseId: observation.releaseId,
          selectedModelId: observation.selectedModelId,
          pluginIds,
          observationStartedAt: startedAt,
          observationCheckedAt: checkedAt,
        });
      }
    }
  }
  return observation;
}

function parseArgs(argv) {
  const values = new Map();
  const repeated = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") {
      continue;
    }
    if (!key?.startsWith("--") || !argv[index + 1]) {
      fail(`Missing value for ${key ?? "argument"}.`);
    }
    const name = key.slice(2);
    const value = argv[++index];
    if (name === "lifecycle-receipt") {
      repeated.set(name, [...(repeated.get(name) ?? []), value]);
    } else {
      values.set(name, value);
    }
  }
  return { values, repeated };
}

async function main() {
  const { values, repeated } = parseArgs(process.argv.slice(2));
  if (values.has("browser-evidence")) {
    fail("--browser-evidence is not accepted; the observer captures visible Chrome directly.");
  }
  const required = [
    "phase",
    "active-source-sha",
    "rollback-source-sha",
    "active-release-id",
    "rollback-release-id",
    "config-artifact",
    "secondary-config-artifact",
    "expected-config-digest",
    "expected-secondary-config-digest",
    "runtime-home",
    "releases-root",
    "control-ui-url",
    "ollama-url",
    "selected-model-id",
    "pointer",
    "lease",
    "lease-owner",
    "approval-id",
    "operation-id",
    "invocation-id",
    "artifact-root",
    "output",
  ];
  for (const key of required) {
    if (!values.get(key)) {
      fail(`Missing --${key}.`);
    }
  }
  const observation = await observeControlDirectorCapabilityPhase({
    phase: values.get("phase"),
    expectedActiveSourceSha: values.get("active-source-sha"),
    expectedRollbackSourceSha: values.get("rollback-source-sha"),
    expectedActiveReleaseId: values.get("active-release-id"),
    expectedRollbackReleaseId: values.get("rollback-release-id"),
    configurationDigests: [
      values.get("expected-config-digest"),
      values.get("expected-secondary-config-digest"),
    ],
    configurationArtifacts: [
      values.get("config-artifact"),
      values.get("secondary-config-artifact"),
    ],
    authorizationBindings: {
      leaseOwner: values.get("lease-owner"),
      approvalId: values.get("approval-id"),
      operationId: values.get("operation-id"),
      invocationId: values.get("invocation-id"),
    },
    runtimeHome: values.get("runtime-home"),
    releasesRoot: values.get("releases-root"),
    controlUiUrl: values.get("control-ui-url"),
    ollamaUrl: values.get("ollama-url"),
    selectedModelId: values.get("selected-model-id"),
    pointerPath: values.get("pointer"),
    leasePath: values.get("lease"),
    lifecycleReceipts: repeated.get("lifecycle-receipt") ?? [],
    restartReceipt: values.get("restart-receipt"),
    previousObservation: values.get("previous-observation"),
    artifactRoot: values.get("artifact-root"),
  });
  const output = path.resolve(values.get("output"));
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.writeFileSync(output, `${JSON.stringify(observation, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${output}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch(
    /** @param {unknown} error */ (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
