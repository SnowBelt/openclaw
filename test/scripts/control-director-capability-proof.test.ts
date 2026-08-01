import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS,
  digestControlDirectorCapabilityEvidence,
  digestControlDirectorCapabilityObservation,
  digestControlDirectorCapabilityRuntimeEvidence,
} from "../../scripts/control-director-capability-observer.mjs";
import { buildControlDirectorCapabilityProof } from "../../scripts/control-director-capability-proof.mjs";

const sourceSha = "a".repeat(40);
const rollbackSha = "b".repeat(40);
const configurationDigests = ["c".repeat(64), "d".repeat(64)];
const roots: string[] = [];
const manifestCapabilities = (
  JSON.parse(fs.readFileSync(path.resolve("config/custom-runtime-capabilities.json"), "utf8")) as {
    capabilities: Array<{
      id: string;
      kind: string;
      requiredPaths: string[];
    }>;
  }
).capabilities;
const authorizationBindings = {
  activeReleaseId: "release-active",
  rollbackReleaseId: "release-rollback",
  rollbackSha,
  leaseOwner: "codex:test",
  approvalId: "release-governor:test",
  operationId: "certification:test",
  invocationId: "certification-test",
};
const observationAuthorizationBindings = {
  leaseOwner: authorizationBindings.leaseOwner,
  approvalId: authorizationBindings.approvalId,
  operationId: authorizationBindings.operationId,
  invocationId: authorizationBindings.invocationId,
};
const browserRouteMarkers = {
  "/pcc": ["pcc", "PCC"],
  "/app-studio": ["app-studio", "App Studio"],
  "/music-studio": ["music-studio", "Music Studio"],
  "/snes-studio": ["snes-studio", "SNES Studio"],
  "/book-writer": ["book-writer", "Book Writer"],
  "/kalshi": ["kalshi", "Kalshi"],
  "/pattern-lab": ["pattern-lab", "Pattern Lab"],
  "/chat": ["chat", "Chat"],
  "/operations": ["operations", "Operations Room"],
} as const;
const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "capability-proof-"));
  roots.push(value);
  return value;
}

function write(filePath: string, value: string | Buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function digest(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function binding(filePath: string) {
  return { path: filePath, sha256: digest(filePath) };
}

function derivedProbe(code: string, value: string) {
  return {
    type: "derived",
    commandId: code,
    parsedResult: { code, digest: value },
  };
}

function observation(
  phase: "active" | "rollback" | "restored",
  minute: number,
  previousObservationSha256: string | null,
) {
  const base = root();
  const artifactRoot = path.join(base, "artifacts-root");
  const evidenceDerivedProbe = (
    code: string,
    logicalPath: string,
    value: string,
  ): Record<string, unknown> => {
    const relativePath = `artifacts/${logicalPath.replace(/[^A-Za-z0-9._-]/gu, "_")}.evidence`;
    const filePath = path.join(artifactRoot, relativePath);
    write(filePath, value);
    const sha256 = digest(filePath);
    return {
      type: "derived",
      commandId: code.startsWith("dashboard-")
        ? "immutable-dashboard-surface-contract"
        : "immutable-bundled-plugin-contract",
      evidence: [{ logicalPath, path: relativePath, sha256 }],
      parsedResult: {
        code,
        digest: createHash("sha256")
          .update(JSON.stringify({ [logicalPath]: sha256 }))
          .digest("hex"),
      },
    };
  };
  const processCommandIds: Record<string, string> = {
    "immutable-runtime-contract": "managed-launcher-verify",
    "gateway-health": "gateway-health-rpc",
    "plugin-inventory": "managed-plugin-inventory",
    "pcc-summary": "pcc-summary-rpc",
    "operations-snapshot": "operations-snapshot-rpc",
    "sig-health": "self-improvement-health-rpc",
    "sig-production-check": "self-improvement-production-check-rpc",
    "tailscale-status": "tailscale-read-only-status",
    "tailscale-serve-status": "tailscale-read-only-serve-status",
  };
  const processProbe = (probeId: string) => {
    const safeId = probeId.replace(/[^A-Za-z0-9._-]/gu, "_");
    const stdout = path.join(artifactRoot, "artifacts", `${safeId}.stdout`);
    const stderr = path.join(artifactRoot, "artifacts", `${safeId}.stderr`);
    const stdoutValue =
      probeId === "immutable-runtime-contract"
        ? `CUSTOM_RUNTIME_OK sha=${phase === "rollback" ? rollbackSha : sourceSha} release=${
            phase === "rollback"
              ? authorizationBindings.rollbackReleaseId
              : authorizationBindings.activeReleaseId
          }\n`
        : probeId === "plugin-inventory"
          ? JSON.stringify({
              plugins: [
                { id: "apps", enabled: true, status: "loaded" },
                { id: "book-writer", enabled: true, status: "loaded" },
              ],
            })
          : probeId === "tailscale-status"
            ? JSON.stringify({ BackendState: "Running" })
            : probeId === "tailscale-serve-status"
              ? JSON.stringify({
                  Web: { "https://example": { Proxy: "http://127.0.0.1:18789/" } },
                })
              : probeId === "gateway-health"
                ? JSON.stringify({ ok: true, ts: 1_785_420_000_000 })
                : probeId === "pcc-summary"
                  ? JSON.stringify({
                      portfolio: {},
                      planningPolicy: {},
                      executionCapacity: {},
                      runtimeIdentity: {},
                      updateSafety: {},
                    })
                  : probeId === "operations-snapshot"
                    ? JSON.stringify({
                        schema: "openclaw.operations-room.v2",
                        freshness: { status: "fresh" },
                        completeness: { status: "complete" },
                        qualityTarget: 93,
                        qualityScore: 100,
                      })
                    : probeId === "sig-health"
                      ? JSON.stringify({
                          current: { status: "ready", score: 100 },
                          snapshots: [],
                        })
                      : probeId === "sig-production-check"
                        ? JSON.stringify({
                            ready: true,
                            status: "ready",
                            score: 100,
                            runtime: {
                              sourceCommit: phase === "rollback" ? rollbackSha : sourceSha,
                              releaseId:
                                phase === "rollback"
                                  ? authorizationBindings.rollbackReleaseId
                                  : authorizationBindings.activeReleaseId,
                            },
                          })
                        : JSON.stringify({ error: "unexpected probe" });
    write(stdout, stdoutValue);
    write(stderr, "");
    return {
      type: "process",
      commandId: processCommandIds[probeId],
      startedAt: `2026-07-30T10:${String(minute).padStart(2, "0")}:00.000Z`,
      endedAt: `2026-07-30T10:${String(minute).padStart(2, "0")}:01.000Z`,
      exitCode: 0,
      stdout: { path: `artifacts/${safeId}.stdout`, sha256: digest(stdout) },
      stderr: { path: `artifacts/${safeId}.stderr`, sha256: digest(stderr) },
      parsedResult: { code: `${probeId}-ok` },
    };
  };
  const httpProbe = (probeId: string) => {
    const safeId = probeId.replace(/[^A-Za-z0-9._-]/gu, "_");
    const response = path.join(artifactRoot, "artifacts", `${safeId}.response`);
    const body =
      probeId === "ollama-residency"
        ? JSON.stringify({
            models: [
              {
                name: "openclaw-control-qwen25-32b:latest",
                digest: "4".repeat(64),
                size: 32_000_000_000,
                size_vram: 24_000_000_000,
                expires_at: "2030-01-01T00:00:00.000Z",
              },
            ],
          })
        : '<!doctype html><html><body><div id="app"></div><script src="/assets/index.js"></script></body></html>';
    write(
      response,
      JSON.stringify({ status: 200, bodyBase64: Buffer.from(body).toString("base64") }),
    );
    const route = probeId.startsWith("dashboard-route:")
      ? probeId.slice("dashboard-route:".length)
      : null;
    const browserContract = route
      ? browserRouteMarkers[route as keyof typeof browserRouteMarkers]
      : undefined;
    let browser;
    if (route && browserContract) {
      const [surfaceId, marker] = browserContract;
      const domPath = path.join(artifactRoot, "artifacts", `${safeId}.dom.json`);
      const screenshotPath = path.join(artifactRoot, "artifacts", `${safeId}.png`);
      write(
        domPath,
        `${JSON.stringify({
          schema: "openclaw.control-director-visible-dom-evidence.v1",
          captureMode: "direct-visible-google-chrome-v1",
          route,
          finalPath: route,
          authenticated: true,
          connectionStatus: {
            className: "sidebar-connection-status sidebar-connection-status--online",
            text: "Connected",
            rect: { x: 12, y: 12, width: 96, height: 24 },
          },
          visibleMarkers: [
            {
              marker,
              tagName: "h1",
              text: marker,
              rect: { x: 10, y: 10, width: 200, height: 40 },
            },
          ],
        })}\n`,
      );
      write(screenshotPath, validPng);
      const domSha256 = digest(domPath);
      const screenshotSha256 = digest(screenshotPath);
      const evidencePath = path.join(artifactRoot, "artifacts", `${safeId}.browser.json`);
      write(
        evidencePath,
        `${JSON.stringify({
          schema: "openclaw.control-director-browser-route-evidence.v1",
          captureMode: "direct-visible-google-chrome-v1",
          sourceSha: phase === "rollback" ? rollbackSha : sourceSha,
          releaseId:
            phase === "rollback"
              ? authorizationBindings.rollbackReleaseId
              : authorizationBindings.activeReleaseId,
          checkedAt: `2026-07-30T10:${String(minute).padStart(2, "0")}:02.000Z`,
          platform: "mac-studio",
          host: {
            hardwareClass: "Mac Studio",
            osName: "macOS",
            osVersion: "15.6",
            architecture: "arm64",
            hostIdentitySha256: "f".repeat(64),
          },
          browserName: "Google Chrome",
          browserVersion: "140.0.0.0",
          viewport: { width: 1440, height: 1000 },
          authenticated: true,
          route,
          finalPath: route,
          surfaceId,
          observedAt: `2026-07-30T10:${String(minute).padStart(2, "0")}:00.500Z`,
          domSha256,
          screenshotSha256,
        })}\n`,
      );
      browser = {
        evidence: { path: path.relative(artifactRoot, evidencePath), sha256: digest(evidencePath) },
        dom: { path: path.relative(artifactRoot, domPath), sha256: domSha256 },
        screenshot: {
          path: path.relative(artifactRoot, screenshotPath),
          sha256: screenshotSha256,
        },
      };
    }
    return {
      type: "http",
      commandId:
        probeId === "ollama-residency" ? "ollama-loopback-residency" : "control-ui-loopback-route",
      requestedPath:
        probeId === "ollama-residency" ? "/api/ps" : probeId.slice("dashboard-route:".length),
      startedAt: `2026-07-30T10:${String(minute).padStart(2, "0")}:00.000Z`,
      endedAt: `2026-07-30T10:${String(minute).padStart(2, "0")}:01.000Z`,
      response: { path: `artifacts/${safeId}.response`, sha256: digest(response) },
      ...(browser ? { browser } : {}),
      parsedResult: {
        code: route ? `${probeId}-semantic-browser-ok` : `${probeId}-ok`,
      },
    };
  };
  const config = configurationDigests.map((sha256, index) => {
    const filePath = path.join(base, `config-${index}.json`);
    write(filePath, `${index}`);
    return { path: filePath, sha256 };
  });
  for (let index = 0; index < config.length; index += 1) {
    write(config[index]!.path, String.fromCharCode(index));
    configurationDigests[index] = digest(config[index]!.path);
    config[index]!.sha256 = configurationDigests[index]!;
  }
  const runtimeFiles = Object.fromEntries(
    ["pointer", "capabilityManifest", "surfaceManifest", "launcher", "snapshot", "sourceStamp"].map(
      (name) => {
        const filePath = path.join(base, `${name}.json`);
        write(filePath, `${name}\n`);
        return [name, binding(filePath)];
      },
    ),
  );
  write(
    runtimeFiles.pointer.path,
    `${JSON.stringify({
      sourceSha: phase === "rollback" ? rollbackSha : sourceSha,
      releaseId:
        phase === "rollback"
          ? authorizationBindings.rollbackReleaseId
          : authorizationBindings.activeReleaseId,
    })}\n`,
  );
  runtimeFiles.pointer.sha256 = digest(runtimeFiles.pointer.path);
  write(
    runtimeFiles.surfaceManifest.path,
    `${JSON.stringify({
      surfaces: manifestCapabilities
        .filter((entry) => entry.kind === "dashboard_surface")
        .map((entry) => ({
          id: entry.id.slice("dashboard:".length),
          assets: [`assets/${entry.id.slice("dashboard:".length)}.js`],
        })),
    })}\n`,
  );
  runtimeFiles.surfaceManifest.sha256 = digest(runtimeFiles.surfaceManifest.path);
  const lifecycleResults =
    phase === "active"
      ? ["acquired", "promoted"]
      : phase === "rollback"
        ? ["rollback-authorized", "rolled-back"]
        : ["restored"];
  const receipts = lifecycleResults.map((result, index) => {
    const filePath = path.join(base, `${result}.json`);
    const transitionId =
      result === "rolled-back" || result === "restored" ? String(index + 1).repeat(64) : undefined;
    write(
      filePath,
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-certification-lease-receipt.v2",
        result,
        at: `2026-07-30T10:${String(minute).padStart(2, "0")}:00.000Z`,
        activeSha: sourceSha,
        candidateSha: sourceSha,
        approvalId: authorizationBindings.approvalId,
        operationId: authorizationBindings.operationId,
        invocationId: authorizationBindings.invocationId,
        ...(transitionId ? { transitionId } : {}),
        lease: {
          activeSha: sourceSha,
          candidateSha: sourceSha,
          rollbackSha,
          activeReleaseId: authorizationBindings.activeReleaseId,
          rollbackReleaseId: authorizationBindings.rollbackReleaseId,
          owner: authorizationBindings.leaseOwner,
          actor: os.userInfo().username,
          approvalId: authorizationBindings.approvalId,
          operationId: authorizationBindings.operationId,
          invocationId: authorizationBindings.invocationId,
          operationClass: "release-certification",
        },
      })}\n`,
    );
    const fileBinding = binding(filePath);
    const receiptBinding = {
      result,
      path: fileBinding.path,
      sha256: fileBinding.sha256,
      transitionId,
    };
    if (!transitionId) {
      delete receiptBinding.transitionId;
    }
    return receiptBinding;
  });
  const leasePath = path.join(base, "lease.json");
  const phaseSourceSha = phase === "rollback" ? rollbackSha : sourceSha;
  write(
    leasePath,
    `${JSON.stringify({
      activeSha: phaseSourceSha,
      candidateSha: phaseSourceSha,
      owner: authorizationBindings.leaseOwner,
      approvalId: authorizationBindings.approvalId,
      operationId: authorizationBindings.operationId,
      invocationId: authorizationBindings.invocationId,
      state: phase === "rollback" ? "rollback-drill" : "promoted",
    })}\n`,
  );
  const lockOwnerPath = path.join(base, "lifecycle-lock-owner.json");
  write(
    lockOwnerPath,
    `${JSON.stringify({
      activeSha: phaseSourceSha,
      actor: os.userInfo().username,
      approvalId: authorizationBindings.approvalId,
      candidateSha: phaseSourceSha,
      createdAt: `2026-07-30T10:${String(minute).padStart(2, "0")}:00.000Z`,
      invocationId: authorizationBindings.invocationId,
      operation: "certification-lease",
      operationId: authorizationBindings.operationId,
      pid: process.pid,
      schema: "openclaw.custom-runtime-lifecycle-lock.v1",
    })}\n`,
  );
  let restartReceipt = null;
  if (phase !== "rollback") {
    const restartPath = path.join(base, "restart.json");
    write(
      restartPath,
      `${JSON.stringify({
        at: "20260730T100000Z",
        result: "restarted_verified",
        release: authorizationBindings.activeReleaseId,
      })}\n`,
    );
    restartReceipt = binding(restartPath);
  }
  const probes: Record<string, Record<string, unknown>> = {};
  const runtimeEvidenceByCapability = new Map<
    string,
    Array<{ logicalPath: string; path: string; sha256: string }>
  >();
  const capabilities = manifestCapabilities
    .map((entry) => {
      const runtimeEvidence = entry.requiredPaths
        .toSorted((left, right) => left.localeCompare(right))
        .map((relativePath, index) => {
          const evidencePath = path.join(
            artifactRoot,
            "artifacts",
            `required-${entry.id.replace(/[^A-Za-z0-9._-]/gu, "_")}-${index}.json`,
          );
          write(
            evidencePath,
            `${JSON.stringify({ phase, capabilityId: entry.id, logicalPath: relativePath })}\n`,
          );
          return {
            logicalPath: relativePath,
            path: path.relative(artifactRoot, evidencePath),
            sha256: digest(evidencePath),
          };
        });
      const requiredPathDigests = Object.fromEntries(
        runtimeEvidence.map((binding) => [binding.logicalPath, binding.sha256]),
      );
      for (const probeId of CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS[entry.id]!) {
        if (
          !probeId.startsWith("capability-contract:") &&
          !probeId.startsWith("capability-runtime:") &&
          !probes[probeId]
        ) {
          probes[probeId] = processCommandIds[probeId]
            ? processProbe(probeId)
            : probeId === "ollama-residency" || probeId.startsWith("dashboard-route:")
              ? httpProbe(probeId)
              : probeId.startsWith("surface-contract:")
                ? evidenceDerivedProbe(
                    "dashboard-surface-contract-ok",
                    `assets/${probeId.slice("surface-contract:".length)}.js`,
                    `${phase}:${probeId}\n`,
                  )
                : probeId.startsWith("plugin-contract:")
                  ? evidenceDerivedProbe(
                      "bundled-plugin-contract-ok",
                      `dist-runtime/extensions/${probeId.slice("plugin-contract:".length)}/openclaw.plugin.json`,
                      `${phase}:${probeId}\n`,
                    )
                  : derivedProbe("unsupported-derived-probe", "f".repeat(64));
        }
      }
      runtimeEvidenceByCapability.set(entry.id, runtimeEvidence);
      return {
        id: entry.id,
        kind: entry.kind,
        requiredPathDigests,
        probeIds: [...CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS[entry.id]!],
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
  for (const capability of capabilities) {
    const runtimeEvidence = runtimeEvidenceByCapability.get(capability.id)!;
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
          phase,
          sourceSha: phase === "rollback" ? rollbackSha : sourceSha,
          releaseId:
            phase === "rollback"
              ? authorizationBindings.rollbackReleaseId
              : authorizationBindings.activeReleaseId,
          selectedModelId: "openclaw-control-qwen25-32b:latest",
          configurationDigests,
          authorizationBindings: observationAuthorizationBindings,
          capability,
          probes,
          runtimeEvidence,
        }),
      },
    };
  }
  for (const capability of capabilities) {
    probes[`capability-contract:${capability.id}`] = derivedProbe(
      "capability-evidence-contract-ok",
      digestControlDirectorCapabilityEvidence({
        phase,
        sourceSha: phase === "rollback" ? rollbackSha : sourceSha,
        releaseId:
          phase === "rollback"
            ? authorizationBindings.rollbackReleaseId
            : authorizationBindings.activeReleaseId,
        selectedModelId: "openclaw-control-qwen25-32b:latest",
        configurationDigests,
        authorizationBindings: observationAuthorizationBindings,
        capability,
        probes,
      }),
    );
    probes[`capability-contract:${capability.id}`]!.commandId =
      "independent-capability-evidence-contract";
  }
  const checkedAt = `2026-07-30T10:${String(minute).padStart(2, "0")}:05.000Z`;
  const value = {
    schema: "openclaw.control-director-capability-observation.v2",
    phase,
    sourceSha: phase === "rollback" ? rollbackSha : sourceSha,
    releaseId:
      phase === "rollback"
        ? authorizationBindings.rollbackReleaseId
        : authorizationBindings.activeReleaseId,
    selectedModelId: "openclaw-control-qwen25-32b:latest",
    startedAt: `2026-07-30T10:${String(minute).padStart(2, "0")}:00.000Z`,
    checkedAt,
    configurationDigests: [...configurationDigests],
    configuration: config,
    authorizationBindings: observationAuthorizationBindings,
    artifactRoot,
    runtime: {
      ...runtimeFiles,
      runtimeRootSha256: "9".repeat(64),
    },
    lifecycle: {
      lease: binding(leasePath),
      lock: {
        owner: binding(lockOwnerPath),
        ownerPid: process.pid,
        verifiedLiveAt: checkedAt,
      },
      receipts,
      restartReceipt,
    },
    capabilities,
    probes,
    previousObservationSha256,
  };
  return {
    ...value,
    contentSha256: digestControlDirectorCapabilityObservation(value),
  };
}

function observations() {
  const active = observation("active", 0, null);
  const rollback = observation("rollback", 5, active.contentSha256);
  const restored = observation("restored", 10, rollback.contentSha256);
  return { active, rollback, restored };
}

function build(input = observations()) {
  return buildControlDirectorCapabilityProof({
    sourceSha,
    rollbackSha,
    activeReleaseId: authorizationBindings.activeReleaseId,
    rollbackReleaseId: authorizationBindings.rollbackReleaseId,
    configurationDigests,
    authorizationBindings,
    manifestCapabilities,
    observations: input,
  });
}

afterEach(() => {
  for (const value of roots.splice(0)) {
    fs.rmSync(value, { recursive: true, force: true });
  }
});

describe("Control Director capability proof", () => {
  it("recomputes all 35 capabilities across the ordered phase chain", () => {
    expect(build()).toMatchObject({
      schema: "openclaw.control-director-capability-proof.v3",
      sourceSha,
      rollbackSha,
      passed: true,
      authorizationBindings,
    });
  });

  it("rejects fabricated pass fields, a missing capability, and config drift", () => {
    const fabricated = observations();
    (fabricated.rollback as Record<string, unknown>).passed = true;
    expect(() => build(fabricated)).toThrow("forbidden caller-authored outcome");

    const missing = observations();
    missing.rollback.capabilities.pop();
    missing.rollback.contentSha256 = digestControlDirectorCapabilityObservation(missing.rollback);
    expect(() => build(missing)).toThrow("exact static 35-capability registry");

    const drifted = observations();
    drifted.restored.configurationDigests[0] = "0".repeat(64);
    drifted.restored.contentSha256 = digestControlDirectorCapabilityObservation(drifted.restored);
    expect(() => build(drifted)).toThrow("mismatched exact identities");
  });

  it("rejects a wrong phase identity, unordered phase, and broken hash chain", () => {
    const wrongRelease = observations();
    wrongRelease.rollback.releaseId = "release-other";
    wrongRelease.rollback.contentSha256 = digestControlDirectorCapabilityObservation(
      wrongRelease.rollback,
    );
    expect(() => build(wrongRelease)).toThrow("mismatched exact identities");

    const unordered = observations();
    unordered.active.checkedAt = "2026-07-30T10:06:00.000Z";
    unordered.active.contentSha256 = digestControlDirectorCapabilityObservation(unordered.active);
    unordered.rollback.previousObservationSha256 = unordered.active.contentSha256;
    unordered.rollback.contentSha256 = digestControlDirectorCapabilityObservation(
      unordered.rollback,
    );
    unordered.restored.previousObservationSha256 = unordered.rollback.contentSha256;
    unordered.restored.contentSha256 = digestControlDirectorCapabilityObservation(
      unordered.restored,
    );
    expect(() => build(unordered)).toThrow("strictly ordered");

    const broken = observations();
    broken.restored.previousObservationSha256 = "0".repeat(64);
    broken.restored.contentSha256 = digestControlDirectorCapabilityObservation(broken.restored);
    expect(() => build(broken)).toThrow("breaks the active-to-rollback-to-restored hash chain");
  });

  it("rehashes probe transcripts and lifecycle receipts", () => {
    const input = observations();
    const stdoutPath = path.join(
      input.active.artifactRoot,
      input.active.probes["immutable-runtime-contract"].stdout.path,
    );
    fs.appendFileSync(stdoutPath, "tamper");
    expect(() => build(input)).toThrow("digest verification failed");

    const lifecycle = observations();
    fs.appendFileSync(lifecycle.rollback.lifecycle.receipts[0]!.path, "tamper");
    expect(() => build(lifecycle)).toThrow("regular-file digest verification");
  });

  it("rejects a shared or replayed per-capability evidence contract", () => {
    const input = observations();
    input.rollback.probes["capability-contract:runtime:chat-plan-mode"] = structuredClone(
      input.rollback.probes["capability-contract:runtime:chat-work-surface"],
    );
    input.rollback.contentSha256 = digestControlDirectorCapabilityObservation(input.rollback);
    input.restored.previousObservationSha256 = input.rollback.contentSha256;
    input.restored.contentSha256 = digestControlDirectorCapabilityObservation(input.restored);
    expect(() => build(input)).toThrow("evidence contract is not independently bound");

    const runtimeReplay = observations();
    const targetRuntimeProbe = structuredClone(
      runtimeReplay.active.probes["capability-runtime:runtime:chat-plan-mode"],
    );
    const replayedRuntimeProbe = structuredClone(
      runtimeReplay.active.probes["capability-runtime:runtime:chat-work-surface"],
    );
    replayedRuntimeProbe.evidence = targetRuntimeProbe.evidence;
    replayedRuntimeProbe.semanticProbeIds = targetRuntimeProbe.semanticProbeIds;
    runtimeReplay.active.probes["capability-runtime:runtime:chat-plan-mode"] = replayedRuntimeProbe;
    const replayedCapability = runtimeReplay.active.capabilities.find(
      (capability) => capability.id === "runtime:chat-plan-mode",
    )!;
    runtimeReplay.active.probes["capability-contract:runtime:chat-plan-mode"].parsedResult.digest =
      digestControlDirectorCapabilityEvidence({
        phase: runtimeReplay.active.phase,
        sourceSha: runtimeReplay.active.sourceSha,
        releaseId: runtimeReplay.active.releaseId,
        selectedModelId: runtimeReplay.active.selectedModelId,
        configurationDigests: runtimeReplay.active.configurationDigests,
        authorizationBindings: runtimeReplay.active.authorizationBindings,
        capability: replayedCapability,
        probes: runtimeReplay.active.probes,
      });
    runtimeReplay.active.contentSha256 = digestControlDirectorCapabilityObservation(
      runtimeReplay.active,
    );
    runtimeReplay.rollback.previousObservationSha256 = runtimeReplay.active.contentSha256;
    runtimeReplay.rollback.contentSha256 = digestControlDirectorCapabilityObservation(
      runtimeReplay.rollback,
    );
    runtimeReplay.restored.previousObservationSha256 = runtimeReplay.rollback.contentSha256;
    runtimeReplay.restored.contentSha256 = digestControlDirectorCapabilityObservation(
      runtimeReplay.restored,
    );
    expect(() => build(runtimeReplay)).toThrow("runtime evidence is not independently bound");
  });

  it("rejects replayed phase transcripts and arbitrary derived digests", () => {
    const replayed = observations();
    replayed.rollback.probes["gateway-health"] = structuredClone(
      replayed.active.probes["gateway-health"],
    );
    replayed.rollback.contentSha256 = digestControlDirectorCapabilityObservation(replayed.rollback);
    replayed.restored.previousObservationSha256 = replayed.rollback.contentSha256;
    replayed.restored.contentSha256 = digestControlDirectorCapabilityObservation(replayed.restored);
    expect(() => build(replayed)).toThrow("outside the observation time window");

    const fabricated = observations();
    fabricated.restored.probes["surface-contract:pcc"].parsedResult.digest = "0".repeat(64);
    fabricated.restored.contentSha256 = digestControlDirectorCapabilityObservation(
      fabricated.restored,
    );
    expect(() => build(fabricated)).toThrow("evidence digest does not replay");

    const substituted = observations();
    const surfaceProbe = substituted.restored.probes["surface-contract:pcc"];
    const substitutePath = "artifacts/unrelated-surface.evidence";
    const substituteFile = path.join(substituted.restored.artifactRoot, substitutePath);
    write(substituteFile, "unrelated\n");
    const substituteSha256 = digest(substituteFile);
    surfaceProbe.evidence = [
      {
        logicalPath: "assets/unrelated.js",
        path: substitutePath,
        sha256: substituteSha256,
      },
    ];
    surfaceProbe.parsedResult.digest = createHash("sha256")
      .update(JSON.stringify({ "assets/unrelated.js": substituteSha256 }))
      .digest("hex");
    substituted.restored.contentSha256 = digestControlDirectorCapabilityObservation(
      substituted.restored,
    );
    expect(() => build(substituted)).toThrow("exact immutable evidence set");
  });
});
