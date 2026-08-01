#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CONTROL_DIRECTOR_CAPABILITY_IDS,
  CONTROL_DIRECTOR_CAPABILITY_OBSERVATION_SCHEMA,
  CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS,
  digestControlDirectorCapabilityEvidence,
  digestControlDirectorCapabilityObservation,
  verifyControlDirectorCapabilityObservation,
} from "./control-director-capability-observer.mjs";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTITY_PATTERN = /^[A-Za-z0-9._:@/+~-]{1,160}$/u;
const PHASES = ["active", "rollback", "restored"];

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function readJson(filePath, label = filePath) {
  try {
    return object(JSON.parse(fs.readFileSync(filePath, "utf8")), label);
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function digest(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") {
      continue;
    }
    if (!key?.startsWith("--") || !argv[index + 1]) {
      fail(`Missing value for ${key ?? "argument"}.`);
    }
    values.set(key.slice(2), argv[++index]);
  }
  for (const key of [
    "source-sha",
    "rollback-sha",
    "active-release-id",
    "rollback-release-id",
    "config-digest",
    "secondary-config-digest",
    "lease-owner",
    "approval-id",
    "operation-id",
    "invocation-id",
    ...PHASES,
    "output",
  ]) {
    if (!values.get(key)) {
      fail(`Missing --${key}.`);
    }
  }
  return values;
}

function exact(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`${label} is missing or invalid.`);
  }
  return value;
}

function manifestCapabilityMap(manifestCapabilities) {
  const ids = manifestCapabilities.map((entry) => entry?.id).toSorted();
  if (
    ids.length !== CONTROL_DIRECTOR_CAPABILITY_IDS.length ||
    new Set(ids).size !== CONTROL_DIRECTOR_CAPABILITY_IDS.length ||
    JSON.stringify(ids) !== JSON.stringify(CONTROL_DIRECTOR_CAPABILITY_IDS)
  ) {
    fail("Capability manifest must exactly equal the static 35-capability probe registry.");
  }
  return new Map(manifestCapabilities.map((entry) => [entry.id, entry]));
}

function verifyFileBinding(binding, label) {
  const value = object(binding, label);
  exact(value.path, /^.+$/u, `${label}.path`);
  exact(value.sha256, DIGEST_PATTERN, `${label}.sha256`);
  const stat = fs.lstatSync(value.path);
  if (!stat.isFile() || stat.isSymbolicLink() || digest(value.path) !== value.sha256) {
    fail(`${label} failed regular-file digest verification.`);
  }
}

function verifyObservationFiles(observation) {
  for (const [index, binding] of observation.configuration.entries()) {
    verifyFileBinding(binding, `configuration[${index}]`);
    if (binding.sha256 !== observation.configurationDigests[index]) {
      fail(`Configuration artifact ${index + 1} does not match the observation digest.`);
    }
  }
  for (const [name, binding] of Object.entries(observation.runtime)) {
    if (name !== "runtimeRootSha256") {
      verifyFileBinding(binding, `runtime.${name}`);
    }
  }
  verifyFileBinding(observation.lifecycle.lease, "lifecycle.lease");
  for (const receipt of observation.lifecycle.receipts) {
    verifyFileBinding(receipt, `lifecycle.receipt.${receipt.result}`);
  }
  if (observation.lifecycle.restartReceipt) {
    verifyFileBinding(observation.lifecycle.restartReceipt, "lifecycle.restartReceipt");
  }
}

function expectedLifecycleResults(phase) {
  if (phase === "active") {
    return ["acquired", "promoted"];
  }
  if (phase === "rollback") {
    return ["rollback-authorized", "rolled-back"];
  }
  return ["restored"];
}

function verifyLifecycleSemantics(observation, expected) {
  const results = observation.lifecycle.receipts.map((entry) => entry.result);
  if (JSON.stringify(results) !== JSON.stringify(expectedLifecycleResults(observation.phase))) {
    fail(`Capability observation ${observation.phase} lifecycle sequence is incomplete.`);
  }
  for (const binding of observation.lifecycle.receipts) {
    const receipt = readJson(binding.path, `${binding.result} lifecycle receipt`);
    const lease = object(receipt.lease, `${binding.result} receipt lease`);
    if (
      receipt.schema !== "openclaw.custom-runtime-certification-lease-receipt.v2" ||
      receipt.result !== binding.result ||
      receipt.activeSha !== expected.sourceSha ||
      receipt.candidateSha !== expected.sourceSha ||
      receipt.approvalId !== expected.authorizationBindings.approvalId ||
      receipt.operationId !== expected.authorizationBindings.operationId ||
      receipt.invocationId !== expected.authorizationBindings.invocationId ||
      lease.activeSha !== expected.sourceSha ||
      lease.candidateSha !== expected.sourceSha ||
      lease.rollbackSha !== expected.rollbackSha ||
      lease.activeReleaseId !== expected.activeReleaseId ||
      lease.rollbackReleaseId !== expected.rollbackReleaseId ||
      lease.owner !== expected.authorizationBindings.leaseOwner ||
      lease.actor !== os.userInfo().username ||
      lease.approvalId !== expected.authorizationBindings.approvalId ||
      lease.operationId !== expected.authorizationBindings.operationId ||
      lease.invocationId !== expected.authorizationBindings.invocationId ||
      lease.operationClass !== "release-certification"
    ) {
      fail(`Capability observation ${observation.phase} lifecycle receipt drifted.`);
    }
    if (
      ["rolled-back", "restored"].includes(binding.result) &&
      (receipt.transitionId !== binding.transitionId || !DIGEST_PATTERN.test(binding.transitionId))
    ) {
      fail(`Capability observation ${observation.phase} transition binding is invalid.`);
    }
  }
  if (observation.phase === "rollback") {
    if (observation.lifecycle.restartReceipt !== null) {
      fail("Rollback capability observation must not claim a post-restoration restart.");
    }
  } else {
    const restart = readJson(
      observation.lifecycle.restartReceipt.path,
      `${observation.phase} restart receipt`,
    );
    const expectedReleaseId =
      observation.phase === "active" ? expected.activeReleaseId : expected.activeReleaseId;
    if (restart.result !== "restarted_verified" || restart.release !== expectedReleaseId) {
      fail(`Capability observation ${observation.phase} restart receipt drifted.`);
    }
  }
}

function verifyManifestProjection(observation, manifestById) {
  for (const capability of observation.capabilities) {
    const manifestCapability = object(
      manifestById.get(capability.id),
      `manifest capability ${capability.id}`,
    );
    if (
      capability.kind !== manifestCapability.kind ||
      JSON.stringify(
        Object.keys(capability.requiredPathDigests).toSorted((left, right) =>
          left.localeCompare(right),
        ),
      ) !==
        JSON.stringify(
          [...manifestCapability.requiredPaths].toSorted((left, right) =>
            left.localeCompare(right),
          ),
        ) ||
      JSON.stringify(capability.probeIds) !==
        JSON.stringify(CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS[capability.id])
    ) {
      fail(`Capability ${capability.id} does not project the immutable manifest contract.`);
    }
    const contractProbe = observation.probes[`capability-contract:${capability.id}`];
    if (
      contractProbe?.commandId !== "independent-capability-evidence-contract" ||
      contractProbe?.parsedResult?.code !== "capability-evidence-contract-ok" ||
      contractProbe?.parsedResult?.digest !==
        digestControlDirectorCapabilityEvidence({
          phase: observation.phase,
          sourceSha: observation.sourceSha,
          releaseId: observation.releaseId,
          selectedModelId: observation.selectedModelId,
          configurationDigests: observation.configurationDigests,
          authorizationBindings: observation.authorizationBindings,
          capability,
          probes: observation.probes,
        })
    ) {
      fail(`Capability ${capability.id} independent evidence digest mismatch.`);
    }
  }
}

export function buildControlDirectorCapabilityProof({
  sourceSha,
  rollbackSha,
  activeReleaseId,
  rollbackReleaseId,
  configurationDigests,
  authorizationBindings,
  manifestCapabilities,
  observations,
  artifacts = {},
}) {
  exact(sourceSha, SHA_PATTERN, "sourceSha");
  exact(rollbackSha, SHA_PATTERN, "rollbackSha");
  if (sourceSha === rollbackSha) {
    fail("rollbackSha must differ from sourceSha.");
  }
  exact(activeReleaseId, IDENTITY_PATTERN, "activeReleaseId");
  exact(rollbackReleaseId, IDENTITY_PATTERN, "rollbackReleaseId");
  if (activeReleaseId === rollbackReleaseId) {
    fail("Active and rollback releases must differ.");
  }
  if (
    !Array.isArray(configurationDigests) ||
    configurationDigests.length !== 2 ||
    configurationDigests.some((entry) => !DIGEST_PATTERN.test(entry))
  ) {
    fail("Exactly two configuration SHA-256 digests are required.");
  }
  for (const [field, value] of Object.entries(authorizationBindings)) {
    exact(value, field === "rollbackSha" ? SHA_PATTERN : IDENTITY_PATTERN, field);
  }
  if (
    authorizationBindings.rollbackSha !== rollbackSha ||
    authorizationBindings.activeReleaseId !== activeReleaseId ||
    authorizationBindings.rollbackReleaseId !== rollbackReleaseId
  ) {
    fail("Authorization bindings conflict with capability-proof identities.");
  }
  const manifestById = manifestCapabilityMap(manifestCapabilities);
  const normalizedPhases = {};
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  let previousContentSha256 = null;
  let selectedModelId = null;
  for (const phase of PHASES) {
    const observation = observations[phase];
    const expectedPhaseSha = phase === "rollback" ? rollbackSha : sourceSha;
    const expectedReleaseId = phase === "rollback" ? rollbackReleaseId : activeReleaseId;
    if (
      observation.schema !== CONTROL_DIRECTOR_CAPABILITY_OBSERVATION_SCHEMA ||
      observation.phase !== phase ||
      observation.releaseId !== expectedReleaseId ||
      observation.sourceSha !== expectedPhaseSha ||
      JSON.stringify(observation.configurationDigests) !== JSON.stringify(configurationDigests) ||
      JSON.stringify(observation.authorizationBindings) !==
        JSON.stringify({
          leaseOwner: authorizationBindings.leaseOwner,
          approvalId: authorizationBindings.approvalId,
          operationId: authorizationBindings.operationId,
          invocationId: authorizationBindings.invocationId,
        })
    ) {
      fail(`Capability observation ${phase} has mismatched exact identities.`);
    }
    if (selectedModelId !== null && observation.selectedModelId !== selectedModelId) {
      fail("Capability observations changed selected model across lifecycle phases.");
    }
    selectedModelId = observation.selectedModelId;
    verifyControlDirectorCapabilityObservation(observation);
    const checkedAt = Date.parse(observation.checkedAt);
    if (!Number.isFinite(checkedAt) || checkedAt <= previousTimestamp) {
      fail("Capability observation timestamps must be valid and strictly ordered.");
    }
    if (observation.previousObservationSha256 !== previousContentSha256) {
      fail(`Capability observation ${phase} breaks the active-to-rollback-to-restored hash chain.`);
    }
    previousTimestamp = checkedAt;
    previousContentSha256 = observation.contentSha256;
    verifyObservationFiles(observation);
    verifyLifecycleSemantics(observation, {
      sourceSha,
      rollbackSha,
      activeReleaseId,
      rollbackReleaseId,
      authorizationBindings,
    });
    verifyManifestProjection(observation, manifestById);
    normalizedPhases[phase] = observation;
  }
  return {
    schema: "openclaw.control-director-capability-proof.v3",
    sourceSha,
    rollbackSha,
    selectedModelId,
    checkedAt: observations.restored.checkedAt,
    passed: true,
    configurationDigests,
    authorizationBindings,
    observationDigests: Object.fromEntries(
      PHASES.map((phase) => [
        phase,
        digestControlDirectorCapabilityObservation(observations[phase]),
      ]),
    ),
    phases: normalizedPhases,
    artifacts,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const inputPaths = Object.fromEntries(
    PHASES.map((phase) => [phase, path.resolve(args.get(phase))]),
  );
  const manifestPath = path.join(repoRoot, "config/custom-runtime-capabilities.json");
  const manifest = readJson(manifestPath, "Capability manifest");
  const proof = buildControlDirectorCapabilityProof({
    sourceSha: args.get("source-sha"),
    rollbackSha: args.get("rollback-sha"),
    activeReleaseId: args.get("active-release-id"),
    rollbackReleaseId: args.get("rollback-release-id"),
    configurationDigests: [args.get("config-digest"), args.get("secondary-config-digest")],
    authorizationBindings: {
      activeReleaseId: args.get("active-release-id"),
      rollbackReleaseId: args.get("rollback-release-id"),
      rollbackSha: args.get("rollback-sha"),
      leaseOwner: args.get("lease-owner"),
      approvalId: args.get("approval-id"),
      operationId: args.get("operation-id"),
      invocationId: args.get("invocation-id"),
    },
    manifestCapabilities: manifest.capabilities,
    observations: Object.fromEntries(
      PHASES.map((phase) => [phase, readJson(inputPaths[phase], `${phase} observation`)]),
    ),
    artifacts: {
      manifest: { path: manifestPath, sha256: digest(manifestPath) },
      ...Object.fromEntries(
        PHASES.map((phase) => [
          phase,
          { path: inputPaths[phase], sha256: digest(inputPaths[phase]) },
        ]),
      ),
    },
  });
  const output = path.resolve(args.get("output"));
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  fs.writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${output}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
