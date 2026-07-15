import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const launcher = path.resolve("scripts/custom-runtime/custom-runtime-launcher.sh");

function createRuntimeFixtureRoot(prefix: string): string {
  // The production launcher intentionally rejects /tmp releases. Linux exposes
  // os.tmpdir() as /tmp, while macOS uses a per-user /private/var directory.
  const base = process.platform === "linux" ? os.homedir() : os.tmpdir();
  return mkdtempSync(path.join(base, prefix));
}

function writeFile(filePath: string, value: string, mode?: number) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, "utf8");
  if (mode !== undefined) {
    chmodSync(filePath, mode);
  }
}

function fixture(requiredSurfaces: string[], requiredCapabilities: string[] = ["dashboard:pcc"]) {
  const home = realpathSync(createRuntimeFixtureRoot("openclaw-custom-runtime-launcher-"));
  roots.push(home);
  const release = path.join(home, ".openclaw-runtime-releases", "release-1");
  const controlUi = path.join(release, "dist", "control-ui");
  const bundledPlugins = path.join(release, "dist-runtime", "extensions");
  const entrypoint = path.join(release, "dist", "index.js");
  const manifestPath = path.join(controlUi, "dashboard-surfaces.json");
  const capabilityManifestPath = path.join(release, "config", "custom-runtime-capabilities.json");
  const pointer = path.join(home, "pointer.json");
  const sourceSha = "abcdef1234567890abcdef1234567890abcdef12";
  writeFile(entrypoint, "export {};\n");
  writeFile(path.join(bundledPlugins, "example", "package.json"), "{}\n");
  writeFile(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);
  writeFile(path.join(controlUi, "assets", "pcc.js"), "// pcc\n");
  writeFile(
    manifestPath,
    `${JSON.stringify({
      buildId: "fixture-build",
      surfaces: [{ id: "pcc", path: "/pcc", assets: ["assets/pcc.js"] }],
    })}\n`,
  );
  const manifestSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
  writeFile(
    capabilityManifestPath,
    `${JSON.stringify({
      schema: "openclaw.custom-runtime-capabilities.v1",
      version: 1,
      capabilities: [
        {
          id: "dashboard:pcc",
          kind: "dashboard_surface",
          surfaceId: "pcc",
          requiredPaths: ["dist/control-ui/dashboard-surfaces.json"],
        },
      ],
    })}\n`,
  );
  const capabilityManifestSha256 = createHash("sha256")
    .update(readFileSync(capabilityManifestPath))
    .digest("hex");
  writeFile(
    path.join(release, "snapshot.json"),
    `${JSON.stringify({
      version: 2,
      releaseId: "release-1",
      root: release,
      createdAt: "2026-07-14T06:29:44.990Z",
      packageVersion: "2026.6.11",
      artifactHash: "a".repeat(64),
      source: { commit: sourceSha },
      schemas: {
        runtimeSnapshot: 2,
        selfImprovementLedger: 1,
        selfImprovementRecommendationStore: 3,
        selfImprovementSignal: 1,
      },
      paths: { entrypoint, controlUi, bundledPlugins },
    })}\n`,
  );
  writeFile(
    pointer,
    `${JSON.stringify({
      runtimeRoot: release,
      entrypoint,
      sourceSha,
      manifestPath,
      manifestSha256,
      requiredSurfaces,
      capabilityManifestPath,
      capabilityManifestSha256,
      requiredCapabilities,
    })}\n`,
  );
  const fakeNode = path.join(home, "fake-node.sh");
  writeFile(
    fakeNode,
    [
      "#!/bin/sh",
      "printf 'runtime=%s\\n' \"$OPENCLAW_RUNTIME_SNAPSHOT_ROOT\"",
      "printf 'plugins=%s\\n' \"$OPENCLAW_BUNDLED_PLUGINS_DIR\"",
      "printf 'args=%s\\n' \"$*\"",
      "",
    ].join("\n"),
    0o700,
  );
  return {
    bundledPlugins,
    capabilityManifestPath,
    fakeNode,
    home,
    pointer,
    release,
    sourceSha,
  };
}

function verifyLauncher(input: ReturnType<typeof fixture>, args = ["--verify"]) {
  return spawnSync(launcher, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: input.home,
      OPENCLAW_CUSTOM_RUNTIME_POINTER: input.pointer,
      OPENCLAW_NODE_BIN: input.fakeNode,
    },
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("custom runtime launcher", () => {
  it("accepts a hash-bound runtime with complete provenance, surfaces, and capabilities", () => {
    const result = verifyLauncher(fixture(["pcc"]));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CUSTOM_RUNTIME_OK");
  });

  it("exports the verified candidate identity instead of inherited snapshot state", () => {
    const input = fixture(["pcc"]);
    const result = spawnSync(launcher, ["gateway", "--port", "18789"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: input.home,
        OPENCLAW_BUNDLED_PLUGINS_DIR: "/stale/plugins",
        OPENCLAW_CUSTOM_RUNTIME_POINTER: input.pointer,
        OPENCLAW_NODE_BIN: input.fakeNode,
        OPENCLAW_RUNTIME_SNAPSHOT_ROOT: "/stale/runtime",
      },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`runtime=${input.release}`);
    expect(result.stdout).toContain(`plugins=${input.bundledPlugins}`);
    expect(result.stdout).toContain("gateway --port 18789");
  });

  it("rejects a release that dropped an active required custom surface", () => {
    const result = verifyLauncher(fixture(["pcc", "kalshi"]));

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("surface contract failed: kalshi");
  });

  it("rejects duplicate required surfaces", () => {
    const result = verifyLauncher(fixture(["pcc", "pcc"]));

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("invalid runtime pointer");
  });

  it("rejects a release that dropped an active required custom capability", () => {
    const result = verifyLauncher(fixture(["pcc"], ["dashboard:pcc", "plugin:apps"]));

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("capability contract failed: plugin:apps");
  });

  it("rejects duplicate required capabilities", () => {
    const result = verifyLauncher(fixture(["pcc"], ["dashboard:pcc", "dashboard:pcc"]));

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("invalid runtime pointer");
  });

  it("rejects a hash-bound capability manifest with the wrong schema", () => {
    const input = fixture(["pcc"]);
    const capabilityManifest = JSON.parse(
      readFileSync(input.capabilityManifestPath, "utf8"),
    ) as Record<string, unknown>;
    capabilityManifest.schema = "openclaw.custom-runtime-capabilities.invalid";
    writeFileSync(input.capabilityManifestPath, `${JSON.stringify(capabilityManifest)}\n`);
    const pointer = JSON.parse(readFileSync(input.pointer, "utf8")) as Record<string, unknown>;
    pointer.capabilityManifestSha256 = createHash("sha256")
      .update(readFileSync(input.capabilityManifestPath))
      .digest("hex");
    writeFileSync(input.pointer, `${JSON.stringify(pointer)}\n`);

    const result = verifyLauncher(input);

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("capability contract failed: dashboard:pcc");
  });

  it("fails closed when runtime provenance points at another root", () => {
    const input = fixture(["pcc"]);
    const snapshotPath = path.join(input.release, "snapshot.json");
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, unknown>;
    snapshot.root = "/another/runtime";
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`);

    const result = verifyLauncher(input);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("runtime provenance root mismatch");
  });

  it("fails closed when packaged source provenance changes after selection", () => {
    const input = fixture(["pcc"]);
    const provenance = path.join(input.release, ".openclaw-runtime-provenance.json");
    writeFile(provenance, `${JSON.stringify({ schemaVersion: 2 })}\n`);
    const provenanceSha = createHash("sha256").update(readFileSync(provenance)).digest("hex");
    writeFileSync(path.join(input.release, ".openclaw-production-sha"), `${provenanceSha}\n`);
    const pointer = JSON.parse(readFileSync(input.pointer, "utf8")) as Record<string, unknown>;
    pointer.sourceSha = provenanceSha;
    writeFileSync(input.pointer, `${JSON.stringify(pointer)}\n`);
    appendFileSync(provenance, "tampered\n");

    const result = verifyLauncher(input);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("source provenance hash mismatch");
  });
});
