import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTROL_DIRECTOR_CAPABILITY_IDS,
  CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS,
  deriveHttpProbeCode,
  deriveProcessProbeCode,
  digestControlDirectorCapabilityEvidence,
  digestControlDirectorCapabilityObservation,
  observeControlDirectorCapabilityPhase,
  verifyControlDirectorCapabilityObservation,
} from "../../scripts/control-director-capability-observer.mjs";

const activeSha = "a".repeat(40);
const rollbackSha = "b".repeat(40);
const activeReleaseId = "release-active";
const rollbackReleaseId = "release-rollback";
const roots: string[] = [];
const authorizationBindings = {
  leaseOwner: "codex:test",
  approvalId: "release-governor:test",
  operationId: "certification:test",
  invocationId: "certification-test",
};
const selectedModelId = "openclaw-control-qwen25-32b:latest";
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

function probeStdout(args: string[], phase: "active" | "rollback" | "restored" = "active") {
  if (args.includes("--verify")) {
    return phase === "rollback"
      ? `CUSTOM_RUNTIME_OK sha=${rollbackSha} release=${rollbackReleaseId}\n`
      : `CUSTOM_RUNTIME_OK sha=${activeSha} release=${activeReleaseId}\n`;
  }
  if (args[0] === "plugins") {
    return JSON.stringify({
      plugins: [
        { id: "apps", enabled: true, status: "loaded" },
        { id: "book-writer", enabled: true, status: "loaded" },
      ],
    });
  }
  if (args.includes("health")) {
    return JSON.stringify({ ok: true, ts: 1_785_420_000_000 });
  }
  if (args.includes("pcc.summary.get")) {
    return JSON.stringify({
      portfolio: {},
      planningPolicy: {},
      executionCapacity: {},
      runtimeIdentity: {},
      updateSafety: {},
    });
  }
  if (args.includes("operations.snapshot.v2")) {
    return JSON.stringify({
      schema: "openclaw.operations-room.v2",
      freshness: { status: "fresh" },
      completeness: { status: "complete" },
      qualityTarget: 93,
      qualityScore: 100,
    });
  }
  if (args.includes("selfImprovement.health")) {
    return JSON.stringify({ current: { status: "ready", score: 100 }, snapshots: [] });
  }
  if (args.includes("selfImprovement.productionCheck")) {
    return JSON.stringify({
      ready: true,
      status: "ready",
      score: 100,
      runtime: {
        sourceCommit: phase === "rollback" ? rollbackSha : activeSha,
        releaseId: phase === "rollback" ? rollbackReleaseId : activeReleaseId,
      },
    });
  }
  if (args.includes("status") && !args.includes("serve")) {
    return JSON.stringify({ BackendState: "Running" });
  }
  if (args.includes("serve")) {
    return JSON.stringify({ Web: { "https://example": { Proxy: "http://127.0.0.1:18789/" } } });
  }
  return JSON.stringify({ error: "unexpected probe" });
}

async function probeFetch(url: string) {
  return url.endsWith("/api/ps")
    ? new Response(
        JSON.stringify({
          models: [
            {
              name: selectedModelId,
              digest: "4".repeat(64),
              size: 32_000_000_000,
              size_vram: 24_000_000_000,
              expires_at: "2030-01-01T00:00:00.000Z",
            },
          ],
        }),
        { status: 200 },
      )
    : new Response(
        '<!doctype html><html><title>OpenClaw</title><body><div id="app"></div><script src="/assets/index.js"></script></body></html>',
        { status: 200 },
      );
}

function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "control-director-capability-"));
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

function writeBrowserEvidence(
  input: ReturnType<typeof fixture>,
  phase: "active" | "rollback" | "restored",
  domOverride?: Partial<Record<keyof typeof browserRouteMarkers, string>>,
) {
  const sourceSha = phase === "rollback" ? rollbackSha : activeSha;
  const releaseId = phase === "rollback" ? rollbackReleaseId : activeReleaseId;
  const phaseSecond = phase === "active" ? 0 : phase === "rollback" ? 10 : 20;
  const observedAt = `2026-07-30T10:05:${String(phaseSecond).padStart(2, "0")}.500Z`;
  const checkedAt = `2026-07-30T10:05:${String(phaseSecond + 1).padStart(2, "0")}.000Z`;
  const browserRoot = path.join(input.base, `browser-${phase}`);
  const routes = Object.entries(browserRouteMarkers).map(([route, [surfaceId, marker]]) => {
    const safeId = surfaceId.replaceAll("/", "-");
    const domPath = path.join(browserRoot, `${safeId}.html`);
    const screenshotPath = path.join(browserRoot, `${safeId}.png`);
    write(
      domPath,
      domOverride?.[route as keyof typeof browserRouteMarkers] ??
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
    return {
      route,
      finalPath: route,
      surfaceId,
      observedAt,
      dom: { path: domPath, sha256: digest(domPath) },
      screenshot: { path: screenshotPath, sha256: digest(screenshotPath) },
    };
  });
  const evidencePath = path.join(browserRoot, "evidence.json");
  write(
    evidencePath,
    `${JSON.stringify({
      schema: "openclaw.control-director-browser-capability-evidence.v1",
      captureMode: "direct-visible-google-chrome-v1",
      sourceSha,
      releaseId,
      checkedAt,
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
      routes,
    })}\n`,
  );
  return evidencePath;
}

function readManifest() {
  return JSON.parse(
    fs.readFileSync(path.resolve("config/custom-runtime-capabilities.json"), "utf8"),
  ) as {
    capabilities: Array<{
      id: string;
      kind: string;
      requiredPaths: string[];
      surfaceId?: string;
      pluginId?: string;
    }>;
  };
}

function fixture() {
  const base = root();
  const runtimeHome = path.join(base, "runtime-home");
  const releasesRoot = path.join(base, "releases");
  const configPrimary = path.join(base, "config-primary.json");
  const configSecondary = path.join(base, "config-secondary.json");
  write(configPrimary, '{"primary":true}\n');
  write(configSecondary, '{"secondary":true}\n');
  const manifest = readManifest();
  for (const [releaseId, sourceSha] of [
    [activeReleaseId, activeSha],
    [rollbackReleaseId, rollbackSha],
  ] as const) {
    const runtimeRoot = path.join(releasesRoot, releaseId);
    for (const capability of manifest.capabilities) {
      for (const relativePath of capability.requiredPaths) {
        write(path.join(runtimeRoot, relativePath), `${releaseId}:${relativePath}\n`);
      }
      if (capability.kind === "plugin") {
        write(
          path.join(
            runtimeRoot,
            "dist-runtime/extensions",
            capability.pluginId!,
            "openclaw.plugin.json",
          ),
          `${JSON.stringify({ id: capability.pluginId })}\n`,
        );
      }
    }
    const surfaces = manifest.capabilities
      .filter((entry) => entry.kind === "dashboard_surface")
      .map((entry) => {
        const asset = `assets/${entry.surfaceId}.js`;
        write(path.join(runtimeRoot, "dist/control-ui", asset), `${entry.surfaceId}\n`);
        return { id: entry.surfaceId, assets: [asset] };
      });
    write(
      path.join(runtimeRoot, "dist/control-ui/dashboard-surfaces.json"),
      `${JSON.stringify({ surfaces })}\n`,
    );
    write(
      path.join(runtimeRoot, "config/custom-runtime-capabilities.json"),
      `${JSON.stringify(manifest)}\n`,
    );
    write(
      path.join(runtimeRoot, "scripts/custom-runtime/custom-runtime-launcher.sh"),
      "#!/bin/sh\n",
    );
    write(path.join(runtimeRoot, ".openclaw-production-sha"), `${sourceSha}\n`);
    write(
      path.join(runtimeRoot, "snapshot.json"),
      `${JSON.stringify({ releaseId, source: { commit: sourceSha } })}\n`,
    );
  }
  const installedLauncher = path.join(runtimeHome, "bin/custom-runtime-launcher.sh");
  fs.mkdirSync(path.dirname(installedLauncher), { recursive: true });
  fs.copyFileSync(
    path.join(releasesRoot, activeReleaseId, "scripts/custom-runtime/custom-runtime-launcher.sh"),
    installedLauncher,
  );
  fs.chmodSync(installedLauncher, 0o755);
  const pointerPath = path.join(runtimeHome, "active-runtime.json");
  const leasePath = path.join(runtimeHome, "certification-lease.json");
  write(
    leasePath,
    `${JSON.stringify({
      schema: "openclaw.custom-runtime-certification-lease.v2",
      activeSha,
      candidateSha: activeSha,
      rollbackSha,
      activeReleaseId,
      rollbackReleaseId,
      owner: authorizationBindings.leaseOwner,
      actor: os.userInfo().username,
      approvalId: authorizationBindings.approvalId,
      operationId: authorizationBindings.operationId,
      invocationId: authorizationBindings.invocationId,
      operationClass: "release-certification",
      state: "promoted",
      createdAt: "2026-07-30T10:00:00.000Z",
      expiresAt: "2026-07-30T11:00:00.000Z",
      heartbeatAt: "2026-07-30T10:04:30.000Z",
      heartbeatRequired: true,
      heartbeatSequence: 1,
      pid: process.pid,
    })}\n`,
  );
  const lockOwnerPath = path.join(runtimeHome, "locks/lifecycle.lock/owner.json");
  write(
    lockOwnerPath,
    `${JSON.stringify({
      activeSha,
      actor: os.userInfo().username,
      approvalId: authorizationBindings.approvalId,
      candidateSha: activeSha,
      createdAt: "2026-07-30T10:00:00.000Z",
      invocationId: authorizationBindings.invocationId,
      operation: "certification-lease",
      operationId: authorizationBindings.operationId,
      pid: process.pid,
      schema: "openclaw.custom-runtime-lifecycle-lock.v1",
    })}\n`,
  );
  return {
    base,
    runtimeHome,
    releasesRoot,
    configPrimary,
    configSecondary,
    configurationDigests: [digest(configPrimary), digest(configSecondary)],
    pointerPath,
    leasePath,
    lockOwnerPath,
    manifest,
  };
}

function writePhasePointer(input: ReturnType<typeof fixture>, phase: string) {
  const releaseId = phase === "rollback" ? rollbackReleaseId : activeReleaseId;
  const sourceSha = phase === "rollback" ? rollbackSha : activeSha;
  const runtimeRoot = path.join(input.releasesRoot, releaseId);
  const capabilityManifestPath = path.join(runtimeRoot, "config/custom-runtime-capabilities.json");
  const manifestPath = path.join(runtimeRoot, "dist/control-ui/dashboard-surfaces.json");
  write(
    input.pointerPath,
    `${JSON.stringify({
      runtimeRoot,
      sourceSha,
      releaseId,
      capabilityManifestPath,
      capabilityManifestSha256: digest(capabilityManifestPath),
      manifestPath,
      manifestSha256: digest(manifestPath),
      requiredCapabilities: CONTROL_DIRECTOR_CAPABILITY_IDS,
    })}\n`,
  );
}

function lifecycleReceipt(input: ReturnType<typeof fixture>, result: string, index: number) {
  const filePath = path.join(input.runtimeHome, "receipts", `${result}.json`);
  write(
    filePath,
    `${JSON.stringify({
      schema: "openclaw.custom-runtime-certification-lease-receipt.v2",
      result,
      at: `2026-07-30T10:0${index}:00.000Z`,
      activeSha,
      candidateSha: activeSha,
      approvalId: authorizationBindings.approvalId,
      operationId: authorizationBindings.operationId,
      invocationId: authorizationBindings.invocationId,
      ...(result === "rolled-back" || result === "restored"
        ? { transitionId: String(index + 1).repeat(64) }
        : {}),
      lease: {
        activeSha,
        candidateSha: activeSha,
        rollbackSha,
        activeReleaseId,
        rollbackReleaseId,
        owner: authorizationBindings.leaseOwner,
        actor: os.userInfo().username,
        approvalId: authorizationBindings.approvalId,
        operationId: authorizationBindings.operationId,
        invocationId: authorizationBindings.invocationId,
        operationClass: "release-certification",
      },
    })}\n`,
  );
  return filePath;
}

async function observe(
  input: ReturnType<typeof fixture>,
  phase: "active" | "rollback" | "restored",
  previousObservation?: string,
  overrides: Record<string, unknown> = {},
) {
  writePhasePointer(input, phase);
  write(
    input.leasePath,
    `${JSON.stringify({
      schema: "openclaw.custom-runtime-certification-lease.v2",
      activeSha,
      candidateSha: activeSha,
      rollbackSha,
      activeReleaseId,
      rollbackReleaseId,
      owner: authorizationBindings.leaseOwner,
      actor: os.userInfo().username,
      approvalId: authorizationBindings.approvalId,
      operationId: authorizationBindings.operationId,
      invocationId: authorizationBindings.invocationId,
      operationClass: "release-certification",
      state: phase === "rollback" ? "rollback-drill" : "promoted",
      createdAt: "2026-07-30T10:00:00.000Z",
      expiresAt: "2026-07-30T11:00:00.000Z",
      heartbeatAt: "2026-07-30T10:04:30.000Z",
      heartbeatRequired: true,
      heartbeatSequence: 1,
      pid: process.pid,
    })}\n`,
  );
  const lifecycleResults =
    phase === "active"
      ? ["acquired", "promoted"]
      : phase === "rollback"
        ? ["rollback-authorized", "rolled-back"]
        : ["restored"];
  const lifecycleReceipts = lifecycleResults.map((result, index) =>
    lifecycleReceipt(input, result, index),
  );
  let restartReceipt: string | undefined;
  if (phase !== "rollback") {
    restartReceipt = path.join(input.runtimeHome, "receipts", `restart-${phase}.json`);
    write(
      restartReceipt,
      `${JSON.stringify({
        at: "20260730T100300Z",
        result: "restarted_verified",
        release: activeReleaseId,
      })}\n`,
    );
  }
  let tick = phase === "active" ? 0 : phase === "rollback" ? 10 : 20;
  const browserEvidence =
    typeof overrides.browserEvidence === "string"
      ? overrides.browserEvidence
      : writeBrowserEvidence(input, phase);
  return observeControlDirectorCapabilityPhase(
    {
      phase,
      expectedActiveSourceSha: activeSha,
      expectedRollbackSourceSha: rollbackSha,
      expectedActiveReleaseId: activeReleaseId,
      expectedRollbackReleaseId: rollbackReleaseId,
      configurationDigests: input.configurationDigests,
      configurationArtifacts: [input.configPrimary, input.configSecondary],
      authorizationBindings,
      runtimeHome: input.runtimeHome,
      releasesRoot: input.releasesRoot,
      controlUiUrl: "http://127.0.0.1:18789",
      browserEvidence,
      ollamaUrl: "http://127.0.0.1:11434",
      selectedModelId,
      pointerPath: input.pointerPath,
      leasePath: input.leasePath,
      lifecycleReceipts,
      restartReceipt,
      previousObservation,
      artifactRoot: path.join(input.base, `artifacts-${phase}`),
      ...overrides,
    },
    {
      now: () => new Date(Date.parse("2026-07-30T10:05:00.000Z") + tick++ * 1_000),
      beforeFinalRecheck:
        typeof overrides.beforeFinalRecheck === "function"
          ? (overrides.beforeFinalRecheck as () => void)
          : undefined,
      runProcess: async (_command, args) => ({
        exitCode: 0,
        stdout: probeStdout(args, phase),
        stderr: "",
      }),
      fetch: probeFetch,
      allowTestBrowserCapture: true,
      captureBrowserEvidence: async () => browserEvidence,
    },
  );
}

afterEach(() => {
  for (const value of roots.splice(0)) {
    fs.rmSync(value, { recursive: true, force: true });
  }
});

describe("Control Director capability observer", () => {
  it("keeps the static probe registry equal to all 35 manifest IDs", () => {
    const ids = readManifest()
      .capabilities.map((entry) => entry.id)
      .toSorted();
    expect(CONTROL_DIRECTOR_CAPABILITY_IDS).toEqual(ids);
    expect(Object.keys(CONTROL_DIRECTOR_CAPABILITY_PROBE_REQUIREMENTS).toSorted()).toEqual(ids);
  });

  it("derives exact active, rollback, and restored observations with a hash chain", async () => {
    const input = fixture();
    const active = await observe(input, "active");
    const activePath = path.join(input.base, "active.json");
    write(activePath, `${JSON.stringify(active)}\n`);
    const rollback = await observe(input, "rollback", activePath);
    const rollbackPath = path.join(input.base, "rollback.json");
    write(rollbackPath, `${JSON.stringify(rollback)}\n`);
    const restored = await observe(input, "restored", rollbackPath);
    const restoredPath = path.join(input.base, "restored.json");
    write(restoredPath, `${JSON.stringify(restored)}\n`);
    const continuedRestored = await observe(input, "restored", restoredPath, {
      artifactRoot: path.join(input.base, "artifacts-restored-continuation"),
    });

    expect(active).toMatchObject({
      schema: "openclaw.control-director-capability-observation.v2",
      phase: "active",
      sourceSha: activeSha,
      releaseId: activeReleaseId,
      previousObservationSha256: null,
    });
    expect(rollback.previousObservationSha256).toBe(active.contentSha256);
    expect(restored.previousObservationSha256).toBe(rollback.contentSha256);
    expect(continuedRestored.previousObservationSha256).toBe(restored.contentSha256);
    expect(restored.capabilities).toHaveLength(35);
    expect(digestControlDirectorCapabilityObservation(restored)).toBe(restored.contentSha256);
    expect(active.runtime.pointer.path).not.toBe(input.pointerPath);
    expect(active.lifecycle.lease.path).not.toBe(input.leasePath);
    expect(active.lifecycle.lock.owner.path).not.toBe(input.lockOwnerPath);
    expect(active.lifecycle.lock.ownerPid).toBe(process.pid);
    expect(active.runtime.pointer.path).toContain(active.artifactRoot);
    expect(active.lifecycle.lease.path).toContain(active.artifactRoot);
    expect(active.lifecycle.lock.owner.path).toContain(active.artifactRoot);
    expect(digest(active.runtime.pointer.path)).toBe(active.runtime.pointer.sha256);
    expect(digest(active.lifecycle.lease.path)).toBe(active.lifecycle.lease.sha256);
  });

  it("rejects fabricated outcomes, missing capabilities, and a broken chain", async () => {
    const input = fixture();
    const active = await observe(input, "active");
    expect(() => verifyControlDirectorCapabilityObservation({ ...active, passed: true })).toThrow(
      "forbidden caller-authored outcome",
    );

    const missing = structuredClone(active);
    missing.capabilities.pop();
    missing.contentSha256 = digestControlDirectorCapabilityObservation(missing);
    expect(() => verifyControlDirectorCapabilityObservation(missing)).toThrow(
      "exact static 35-capability registry",
    );

    const activePath = path.join(input.base, "active.json");
    write(activePath, `${JSON.stringify(active)}\n`);
    const rollback = await observe(input, "rollback", activePath);
    rollback.previousObservationSha256 = "0".repeat(64);
    rollback.contentSha256 = digestControlDirectorCapabilityObservation(rollback);
    expect(rollback.previousObservationSha256).not.toBe(active.contentSha256);
  });

  it("fails closed on configuration, phase, and process-probe failures", async () => {
    const input = fixture();
    await expect(
      observe(input, "active", undefined, {
        configurationDigests: ["0".repeat(64), input.configurationDigests[1]],
      }),
    ).rejects.toThrow("Configuration artifact 1 digest mismatch");

    writePhasePointer(input, "rollback");
    await expect(
      observe(input, "active", undefined, { expectedActiveReleaseId: rollbackReleaseId }),
    ).rejects.toThrow();

    writePhasePointer(input, "active");
    await expect(
      observeControlDirectorCapabilityPhase(
        {
          phase: "active",
          expectedActiveSourceSha: activeSha,
          expectedRollbackSourceSha: rollbackSha,
          expectedActiveReleaseId: activeReleaseId,
          expectedRollbackReleaseId: rollbackReleaseId,
          configurationDigests: input.configurationDigests,
          configurationArtifacts: [input.configPrimary, input.configSecondary],
          authorizationBindings,
          runtimeHome: input.runtimeHome,
          releasesRoot: input.releasesRoot,
          controlUiUrl: "http://127.0.0.1:18789",
          browserEvidence: writeBrowserEvidence(input, "active"),
          ollamaUrl: "http://127.0.0.1:11434",
          selectedModelId,
          pointerPath: input.pointerPath,
          leasePath: input.leasePath,
          lifecycleReceipts: [
            lifecycleReceipt(input, "acquired", 0),
            lifecycleReceipt(input, "promoted", 1),
          ],
          restartReceipt: (() => {
            const value = path.join(input.runtimeHome, "receipts", "restart.json");
            write(
              value,
              `${JSON.stringify({
                at: "20260730T100300Z",
                result: "restarted_verified",
                release: activeReleaseId,
              })}\n`,
            );
            return value;
          })(),
          artifactRoot: path.join(input.base, "artifacts-failed"),
        },
        {
          now: () => new Date("2026-07-30T10:05:00.000Z"),
          runProcess: async () => ({
            exitCode: 1,
            stdout: "",
            stderr: "failed",
          }),
          fetch: probeFetch,
        },
      ),
    ).rejects.toThrow("did not produce a successful derived result");
  });

  it("rejects empty RPCs, offline Tailscale, wrong Serve targets, and generic SPA success", () => {
    expect(deriveProcessProbeCode("gateway-health", Buffer.from("{}"))).toBe("");
    expect(
      deriveProcessProbeCode(
        "tailscale-status",
        Buffer.from(JSON.stringify({ BackendState: "NeedsLogin" })),
      ),
    ).toBe("");
    expect(
      deriveProcessProbeCode(
        "tailscale-serve-status",
        Buffer.from(JSON.stringify({ Web: { Proxy: "http://127.0.0.1:9999/" } })),
      ),
    ).toBe("");
    expect(
      deriveHttpProbeCode(
        "dashboard-route:/pcc",
        200,
        Buffer.from(
          '<!doctype html><html><title>OpenClaw</title><body><div id="app"></div><script src="/assets/index.js"></script></body></html>',
        ),
        selectedModelId,
      ),
    ).toBe("");
  });

  it("fails closed when authenticated browser evidence is only a generic SPA shell", async () => {
    const input = fixture();
    const browserEvidence = writeBrowserEvidence(input, "active", {
      "/pcc": `${JSON.stringify({
        schema: "openclaw.control-director-visible-dom-evidence.v1",
        captureMode: "direct-visible-google-chrome-v1",
        route: "/pcc",
        finalPath: "/pcc",
        authenticated: true,
        connectionStatus: {
          className: "sidebar-connection-status sidebar-connection-status--online",
          text: "Connected",
          rect: { x: 12, y: 12, width: 96, height: 24 },
        },
        visibleMarkers: [],
      })}\n`,
    });
    await expect(observe(input, "active", undefined, { browserEvidence })).rejects.toThrow(
      "does not prove visible authenticated route markers",
    );
  });

  it("rejects browser evidence captured before the observation window", async () => {
    const input = fixture();
    const browserEvidence = writeBrowserEvidence(input, "active");
    const stale = JSON.parse(fs.readFileSync(browserEvidence, "utf8"));
    stale.checkedAt = "2026-07-30T10:04:30.000Z";
    for (const route of stale.routes) {
      route.observedAt = "2026-07-30T10:04:00.000Z";
    }
    write(browserEvidence, `${JSON.stringify(stale)}\n`);

    await expect(observe(input, "active", undefined, { browserEvidence })).rejects.toThrow(
      "does not match the exact authenticated runtime contract",
    );
  });

  it("requires the live exact global lifecycle lock through final issuance", async () => {
    const missing = fixture();
    fs.rmSync(path.dirname(missing.lockOwnerPath), { recursive: true, force: true });
    await expect(observe(missing, "active")).rejects.toThrow();

    const dead = fixture();
    const deadOwner = JSON.parse(fs.readFileSync(dead.lockOwnerPath, "utf8"));
    deadOwner.pid = 2_147_483_647;
    write(dead.lockOwnerPath, `${JSON.stringify(deadOwner)}\n`);
    await expect(observe(dead, "active")).rejects.toThrow("owner PID is not live");

    const changed = fixture();
    await expect(
      observe(changed, "active", undefined, {
        beforeFinalRecheck: () => {
          const owner = JSON.parse(fs.readFileSync(changed.lockOwnerPath, "utf8"));
          owner.operationId = "certification:changed";
          write(changed.lockOwnerPath, `${JSON.stringify(owner)}\n`);
        },
      }),
    ).rejects.toThrow("exact certification authorization");
  });

  it("detects transcript tampering and never invokes the mutating Tailscale helper", async () => {
    const input = fixture();
    const commands: string[] = [];
    let tick = 0;
    const active = await observeControlDirectorCapabilityPhase(
      {
        phase: "active",
        expectedActiveSourceSha: activeSha,
        expectedRollbackSourceSha: rollbackSha,
        expectedActiveReleaseId: activeReleaseId,
        expectedRollbackReleaseId: rollbackReleaseId,
        configurationDigests: input.configurationDigests,
        configurationArtifacts: [input.configPrimary, input.configSecondary],
        authorizationBindings,
        runtimeHome: input.runtimeHome,
        releasesRoot: input.releasesRoot,
        controlUiUrl: "http://127.0.0.1:18789",
        browserEvidence: writeBrowserEvidence(input, "active"),
        ollamaUrl: "http://127.0.0.1:11434",
        selectedModelId,
        pointerPath: (() => {
          writePhasePointer(input, "active");
          return input.pointerPath;
        })(),
        leasePath: input.leasePath,
        lifecycleReceipts: [
          lifecycleReceipt(input, "acquired", 0),
          lifecycleReceipt(input, "promoted", 1),
        ],
        restartReceipt: (() => {
          const value = path.join(input.runtimeHome, "receipts", "restart.json");
          write(
            value,
            `${JSON.stringify({
              at: "20260730T100300Z",
              result: "restarted_verified",
              release: activeReleaseId,
            })}\n`,
          );
          return value;
        })(),
        artifactRoot: path.join(input.base, "artifacts"),
      },
      {
        now: () => new Date(Date.parse("2026-07-30T10:05:00.000Z") + tick++ * 1_000),
        runProcess: async (command, args) => {
          commands.push([command, ...args].join(" "));
          return {
            exitCode: 0,
            stdout: probeStdout(args),
            stderr: "",
          };
        },
        fetch: probeFetch,
        allowTestBrowserCapture: true,
        captureBrowserEvidence: async ({ providedPath }) => providedPath,
      },
    );
    expect(commands.some((entry) => entry.includes("custom-runtime-tailscale-primary.sh"))).toBe(
      false,
    );
    const stdout = path.join(active.artifactRoot, active.probes["tailscale-status"].stdout.path);
    fs.appendFileSync(stdout, "tamper");
    expect(() => verifyControlDirectorCapabilityObservation(active)).toThrow(
      "digest verification failed",
    );
  });

  it("rejects a capability contract copied from another capability or phase", async () => {
    const input = fixture();
    const active = await observe(input, "active");
    active.probes["capability-contract:runtime:chat-plan-mode"] = structuredClone(
      active.probes["capability-contract:runtime:chat-work-surface"],
    );
    active.contentSha256 = digestControlDirectorCapabilityObservation(active);
    expect(() => verifyControlDirectorCapabilityObservation(active)).toThrow(
      "evidence contract is not independently bound",
    );

    const runtimeReplay = await observe(fixture(), "active");
    runtimeReplay.probes["capability-runtime:runtime:chat-plan-mode"] = structuredClone(
      runtimeReplay.probes["capability-runtime:runtime:chat-work-surface"],
    );
    const replayedCapability = runtimeReplay.capabilities.find(
      (capability) => capability.id === "runtime:chat-plan-mode",
    )!;
    runtimeReplay.probes["capability-contract:runtime:chat-plan-mode"].parsedResult.digest =
      digestControlDirectorCapabilityEvidence({
        phase: runtimeReplay.phase,
        sourceSha: runtimeReplay.sourceSha,
        releaseId: runtimeReplay.releaseId,
        selectedModelId: runtimeReplay.selectedModelId,
        configurationDigests: runtimeReplay.configurationDigests,
        authorizationBindings: runtimeReplay.authorizationBindings,
        capability: replayedCapability,
        probes: runtimeReplay.probes,
      });
    runtimeReplay.contentSha256 = digestControlDirectorCapabilityObservation(runtimeReplay);
    expect(() => verifyControlDirectorCapabilityObservation(runtimeReplay)).toThrow(
      "exact immutable evidence",
    );
  });

  it("rejects replayed phase probes and fabricated surface evidence", async () => {
    const input = fixture();
    const active = await observe(input, "active");
    const activePath = path.join(input.base, "active-replay.json");
    write(activePath, `${JSON.stringify(active)}\n`);
    const rollback = await observe(input, "rollback", activePath);
    rollback.probes["gateway-health"] = structuredClone(active.probes["gateway-health"]);
    rollback.contentSha256 = digestControlDirectorCapabilityObservation(rollback);
    expect(() => verifyControlDirectorCapabilityObservation(rollback)).toThrow(
      "outside the observation time window",
    );

    const fabricated = structuredClone(active);
    fabricated.probes["surface-contract:pcc"].parsedResult.digest = "0".repeat(64);
    fabricated.contentSha256 = digestControlDirectorCapabilityObservation(fabricated);
    expect(() => verifyControlDirectorCapabilityObservation(fabricated)).toThrow(
      "evidence digest does not replay",
    );
  });
});
