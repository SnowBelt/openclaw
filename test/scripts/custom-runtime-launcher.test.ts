import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

function fixture(requiredSurfaces: string[], requiredCapabilities: string[] = ["dashboard:pcc"]) {
  const home = mkdtempSync(path.join(os.tmpdir(), "openclaw-custom-runtime-launcher-"));
  roots.push(home);
  const release = path.join(home, ".openclaw-runtime-releases", "release-1");
  const controlUi = path.join(release, "dist", "control-ui");
  const assets = path.join(controlUi, "assets");
  const entrypoint = path.join(release, "dist", "index.js");
  const manifestPath = path.join(controlUi, "dashboard-surfaces.json");
  const capabilityManifestPath = path.join(release, "config", "custom-runtime-capabilities.json");
  const pointer = path.join(home, "pointer.json");
  const sourceSha = "abcdef1234567890abcdef1234567890abcdef12";
  mkdirSync(assets, { recursive: true });
  mkdirSync(path.dirname(capabilityManifestPath), { recursive: true });
  writeFileSync(entrypoint, "export {};\n");
  writeFileSync(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);
  writeFileSync(path.join(assets, "pcc.js"), "// pcc\n");
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      buildId: "fixture-build",
      surfaces: [{ id: "pcc", path: "/pcc", assets: ["assets/pcc.js"] }],
    })}\n`,
  );
  const manifestSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
  writeFileSync(
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
  writeFileSync(
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
  return { capabilityManifestPath, home, pointer };
}

function verifyLauncher(input: ReturnType<typeof fixture>) {
  return spawnSync(
    "sh",
    [path.join(process.cwd(), "scripts/custom-runtime/custom-runtime-launcher.sh"), "--verify"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: input.home,
        OPENCLAW_CUSTOM_RUNTIME_POINTER: input.pointer,
        OPENCLAW_NODE_BIN: process.execPath,
      },
    },
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("custom runtime launcher", () => {
  it("accepts a hash-bound runtime that contains every pointer-required surface", () => {
    const result = verifyLauncher(fixture(["pcc"]));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CUSTOM_RUNTIME_OK");
  });

  it("rejects a release that dropped an active required custom surface", () => {
    const result = verifyLauncher(fixture(["pcc", "kalshi"]));

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("surface contract failed: kalshi");
  });

  it("rejects a pointer that weakens integrity with duplicate required surfaces", () => {
    const result = verifyLauncher(fixture(["pcc", "pcc"]));

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("invalid runtime pointer");
  });

  it("rejects a release that dropped an active required custom capability", () => {
    const result = verifyLauncher(fixture(["pcc"], ["dashboard:pcc", "plugin:apps"]));

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("capability contract failed: plugin:apps");
  });

  it("rejects duplicate required custom capabilities", () => {
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
});
