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
  const entrypoint = path.join(release, "dist", "index.js");
  const sha = "abcdef1234567890abcdef1234567890abcdef12";
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(entrypoint, "export {};\n");
  fs.writeFileSync(path.join(release, ".openclaw-production-sha"), `${sha}\n`);
  fs.writeFileSync(manifestPath, `${JSON.stringify({ buildId: "2026.6.11-abcdef123456" })}\n`);
  const manifestSha256 = createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");
  const pointerPath = path.join(root, "active-runtime.json");
  fs.writeFileSync(
    pointerPath,
    `${JSON.stringify({
      runtimeRoot: release,
      entrypoint,
      sourceSha: sha,
      manifestPath,
      manifestSha256,
    })}\n`,
  );
  return { entrypoint, manifestPath, pointerPath, release, sha };
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
      buildId: "2026.6.11-abcdef123456",
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
});
