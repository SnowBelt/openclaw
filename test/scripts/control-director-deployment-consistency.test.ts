import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTROL_DIRECTOR_DEPLOYMENT_CAPABILITY_ID,
  CONTROL_DIRECTOR_DEPLOYMENT_PATHS,
  CONTROL_DIRECTOR_DEPLOYMENT_REQUIRED_PATHS,
  verifyControlDirectorDeploymentConsistency,
} from "../../scripts/control-director-deployment-consistency.js";

const roots: string[] = [];
const sha = "a".repeat(40);

function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "control-director-deployment-"));
  roots.push(value);
  return value;
}

function write(filePath: string, value: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function manifest() {
  return {
    schema: "openclaw.custom-runtime-capabilities.v2",
    version: 5,
    preservation: {
      contractVersion: 2,
      criticality: "required",
      migrationPolicy: "preserve_or_block",
      rollbackPolicy: "immutable_release_pointer",
      sourceStrategy: "merge_from_active_sha",
      dashboardChangePolicy: "register_verify_and_block",
      approvalPolicy: "explicit_exact_candidate",
      proofCommand: "pnpm custom-runtime:update-survival",
      standardsRegistry: "src/pcc/capability-addition-registry.ts",
      verificationCommands: ["pnpm check:custom-runtime-capabilities"],
    },
    capabilities: [
      {
        id: CONTROL_DIRECTOR_DEPLOYMENT_CAPABILITY_ID,
        kind: "runtime",
        requiredPaths: CONTROL_DIRECTOR_DEPLOYMENT_REQUIRED_PATHS,
      },
    ],
  };
}

function sourceFixture() {
  const source = root();
  for (const relativePath of CONTROL_DIRECTOR_DEPLOYMENT_REQUIRED_PATHS) {
    write(path.join(source, relativePath), `${relativePath}\n`);
  }
  write(
    path.join(source, "config/custom-runtime-capabilities.json"),
    `${JSON.stringify(manifest())}\n`,
  );
  return source;
}

function liveFixture() {
  const source = sourceFixture();
  const releases = root();
  const runtime = path.join(releases, "release-1");
  fs.cpSync(source, runtime, { recursive: true });
  for (const pluginId of ["apps", "book-writer"]) {
    write(path.join(runtime, `dist-runtime/extensions/${pluginId}/openclaw.plugin.json`), "{}\n");
  }
  write(path.join(runtime, ".openclaw-production-sha"), `${sha}\n`);
  write(
    path.join(runtime, "snapshot.json"),
    `${JSON.stringify({ releaseId: "release-1", source: { commit: sha } })}\n`,
  );
  const capabilityManifestPath = path.join(runtime, "config/custom-runtime-capabilities.json");
  const capabilityManifestSha256 = createHash("sha256")
    .update(fs.readFileSync(capabilityManifestPath))
    .digest("hex");
  const runtimeHome = root();
  const pointer = path.join(runtimeHome, "active-runtime.json");
  write(
    pointer,
    `${JSON.stringify({
      runtimeRoot: runtime,
      sourceSha: sha,
      releaseId: "release-1",
      promotedAt: "2026-07-21T20:00:00Z",
      capabilityManifestPath,
      capabilityManifestSha256,
      requiredCapabilities: [CONTROL_DIRECTOR_DEPLOYMENT_CAPABILITY_ID],
    })}\n`,
  );
  const restartReceipt = path.join(runtimeHome, "receipts", "restart.json");
  write(
    restartReceipt,
    `${JSON.stringify({
      at: "20260721T200001Z",
      result: "restarted_verified",
      release: "release-1",
    })}\n`,
  );
  return { source, releases, runtime, pointer, restartReceipt };
}

afterEach(() => {
  for (const value of roots.splice(0)) {
    fs.rmSync(value, { recursive: true, force: true });
  }
});

describe("Control Director deployment consistency", () => {
  it("binds every mandatory deployment category to the customization inventory", () => {
    const source = sourceFixture();
    const receipt = verifyControlDirectorDeploymentConsistency({
      sourceRoot: source,
      expectedSha: sha,
    });
    expect(receipt.mode).toBe("source");
    expect(receipt.capability.pathCount).toBe(CONTROL_DIRECTOR_DEPLOYMENT_REQUIRED_PATHS.length);
    expect(Object.keys(receipt.categories).toSorted()).toEqual(
      Object.keys(CONTROL_DIRECTOR_DEPLOYMENT_PATHS).toSorted(),
    );
  });

  it("verifies exact immutable files, bundled plugins, restart proof, and managed services", () => {
    const fixture = liveFixture();
    const receipt = verifyControlDirectorDeploymentConsistency({
      sourceRoot: fixture.source,
      expectedSha: sha,
      pointerPath: fixture.pointer,
      releasesRoot: fixture.releases,
      restartReceiptPath: fixture.restartReceipt,
      launcherPath: "/managed/launcher",
      launcherVerify: () => true,
      serviceProbe: () => true,
    });
    expect(receipt.runtime).toMatchObject({
      exactSha: true,
      immutable: true,
      restartReceiptBound: true,
      bundledPluginsVerified: true,
      releaseId: "release-1",
    });
    expect(Object.values(receipt.runtime?.services ?? {})).toEqual([true, true, true]);
  });

  it("fails closed when one installed file drifts from exact source", () => {
    const fixture = liveFixture();
    write(path.join(fixture.runtime, "src/agents/control-director-turn-policy.ts"), "drift\n");
    expect(() =>
      verifyControlDirectorDeploymentConsistency({
        sourceRoot: fixture.source,
        expectedSha: sha,
        pointerPath: fixture.pointer,
        releasesRoot: fixture.releases,
        restartReceiptPath: fixture.restartReceipt,
        launcherVerify: () => true,
        serviceProbe: () => true,
      }),
    ).toThrow("Immutable runtime file differs from source");
  });

  it("fails closed when restart proof or a managed service is unavailable", () => {
    const fixture = liveFixture();
    write(
      fixture.restartReceipt,
      `${JSON.stringify({
        at: "20260721T200001Z",
        result: "restarted_verified",
        release: "another-release",
      })}\n`,
    );
    expect(() =>
      verifyControlDirectorDeploymentConsistency({
        sourceRoot: fixture.source,
        expectedSha: sha,
        pointerPath: fixture.pointer,
        releasesRoot: fixture.releases,
        restartReceiptPath: fixture.restartReceipt,
        launcherVerify: () => true,
        serviceProbe: () => true,
      }),
    ).toThrow("Restart receipt is not bound");

    write(
      fixture.restartReceipt,
      `${JSON.stringify({
        at: "20260721T200001Z",
        result: "restarted_verified",
        release: "release-1",
      })}\n`,
    );
    expect(() =>
      verifyControlDirectorDeploymentConsistency({
        sourceRoot: fixture.source,
        expectedSha: sha,
        pointerPath: fixture.pointer,
        releasesRoot: fixture.releases,
        restartReceiptPath: fixture.restartReceipt,
        launcherVerify: () => true,
        serviceProbe: (label) => label !== "ai.openclaw.custom-runtime.guard",
      }),
    ).toThrow("ai.openclaw.custom-runtime.guard");
  });

  it("fails closed when the managed launcher cannot verify the active release", () => {
    const fixture = liveFixture();
    expect(() =>
      verifyControlDirectorDeploymentConsistency({
        sourceRoot: fixture.source,
        expectedSha: sha,
        pointerPath: fixture.pointer,
        releasesRoot: fixture.releases,
        restartReceiptPath: fixture.restartReceipt,
        launcherVerify: () => false,
        serviceProbe: () => true,
      }),
    ).toThrow("launcher verification failed");
  });
});
