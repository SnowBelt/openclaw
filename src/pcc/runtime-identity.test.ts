import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePccRuntimeIdentity } from "./runtime-identity.js";

const roots: string[] = [];

function makeReleaseFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pcc-runtime-"));
  roots.push(root);
  const release = path.join(root, "release");
  const manifestPath = path.join(release, "dist", "control-ui", "dashboard-surfaces.json");
  const capabilityManifestPath = path.join(release, "config", "custom-runtime-capabilities.json");
  const workflowPath = path.join(release, "src", "pcc", "project-workflows.ts");
  const entrypoint = path.join(release, "dist", "index.js");
  const sha = "abcdef1234567890abcdef1234567890abcdef12";
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(capabilityManifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
  fs.writeFileSync(entrypoint, "export {};\n");
  fs.writeFileSync(path.join(release, ".openclaw-production-sha"), `${sha}\n`);
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({
      buildId: "2026.6.11-abcdef123456",
      surfaces: [{ id: "pcc", assets: ["assets/pcc.js"] }],
    })}\n`,
  );
  fs.writeFileSync(workflowPath, "export {};\n");
  fs.writeFileSync(
    capabilityManifestPath,
    `${JSON.stringify({
      schema: "openclaw.custom-runtime-capabilities.v1",
      version: 1,
      capabilities: [
        {
          id: "workflow:pcc",
          kind: "workflow",
          requiredPaths: ["src/pcc/project-workflows.ts"],
        },
      ],
    })}\n`,
  );
  const manifestSha256 = createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");
  const capabilityManifestSha256 = createHash("sha256")
    .update(fs.readFileSync(capabilityManifestPath))
    .digest("hex");
  const pointerPath = path.join(root, "active-runtime.json");
  fs.writeFileSync(
    pointerPath,
    `${JSON.stringify({
      runtimeRoot: release,
      entrypoint,
      sourceSha: sha,
      manifestPath,
      manifestSha256,
      requiredSurfaces: ["pcc"],
      capabilityManifestPath,
      capabilityManifestSha256,
      requiredCapabilities: ["workflow:pcc"],
    })}\n`,
  );
  return { capabilityManifestPath, entrypoint, manifestPath, pointerPath, release, sha };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("PCC runtime identity", () => {
  it("derives a verified identity from the immutable release pointer", () => {
    const fixture = makeReleaseFixture();

    const identity = resolvePccRuntimeIdentity({
      env: {},
      homedir: path.dirname(fixture.pointerPath),
      pointerPath: fixture.pointerPath,
      argv: [process.execPath, fixture.entrypoint],
    });

    expect(identity).toMatchObject({
      runtimeSha: fixture.sha,
      runtimeEntrypoint: fixture.entrypoint,
      expectedRuntimeRoot: fixture.release,
      expectedRuntimeEntrypoint: fixture.entrypoint,
      manifestPath: fixture.manifestPath,
      capabilityManifestPath: fixture.capabilityManifestPath,
      buildId: "2026.6.11-abcdef123456",
      requiredSurfaces: ["pcc"],
      missingRequiredSurfaces: [],
      requiredCapabilities: ["workflow:pcc"],
      missingRequiredCapabilities: [],
      identitySource: "release_pointer",
      verified: true,
      driftReason: null,
    });
  });

  it("fails closed when a release pointer does not match its source marker", () => {
    const fixture = makeReleaseFixture();
    fs.writeFileSync(path.join(fixture.release, ".openclaw-production-sha"), "different-sha\n");

    const identity = resolvePccRuntimeIdentity({
      env: {},
      pointerPath: fixture.pointerPath,
      argv: [process.execPath, fixture.entrypoint],
    });

    expect(identity.verified).toBe(false);
    expect(identity.driftReason).toContain("source marker does not match");
  });

  it("reports entrypoint drift when the running gateway is outside the immutable release", () => {
    const fixture = makeReleaseFixture();

    const identity = resolvePccRuntimeIdentity({
      env: {},
      pointerPath: fixture.pointerPath,
      argv: [
        process.execPath,
        path.join(path.dirname(fixture.release), "other", "dist", "index.js"),
      ],
    });

    expect(identity.verified).toBe(false);
    expect(identity.driftReason).toContain("Gateway entrypoint is outside");
  });

  it("fails closed when an update pointer requires a custom surface the release dropped", () => {
    const fixture = makeReleaseFixture();
    const pointer = JSON.parse(fs.readFileSync(fixture.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    pointer.requiredSurfaces = ["pcc", "kalshi"];
    fs.writeFileSync(fixture.pointerPath, `${JSON.stringify(pointer)}\n`);

    const identity = resolvePccRuntimeIdentity({
      env: {},
      pointerPath: fixture.pointerPath,
      argv: [process.execPath, fixture.entrypoint],
    });

    expect(identity.verified).toBe(false);
    expect(identity.missingRequiredSurfaces).toEqual(["kalshi"]);
    expect(identity.driftReason).toContain("missing required custom surfaces: kalshi");
  });

  it("fails closed when an update drops a required custom capability file", () => {
    const fixture = makeReleaseFixture();
    fs.rmSync(path.join(fixture.release, "src", "pcc", "project-workflows.ts"));

    const identity = resolvePccRuntimeIdentity({
      env: {},
      pointerPath: fixture.pointerPath,
      argv: [process.execPath, fixture.entrypoint],
    });

    expect(identity.verified).toBe(false);
    expect(identity.missingRequiredCapabilities).toEqual(["workflow:pcc"]);
    expect(identity.driftReason).toContain("missing required custom capabilities: workflow:pcc");
  });
});
