import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const sealScript = path.resolve("scripts/custom-runtime/custom-runtime-seal.sh");
const statusScript = path.resolve("scripts/custom-runtime/custom-runtime-status.sh");
const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.chmodSync(root, 0o700);
    spawnSync("chmod", ["-R", "u+w", root]);
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("custom runtime sealing and status", () => {
  it("seals every release path and verifies the exact source marker", () => {
    const root = temporaryRoot("openclaw-runtime-seal-");
    const releases = path.join(root, "releases");
    const release = path.join(releases, "candidate");
    const home = path.join(root, "home");
    const runtimeHome = path.join(home, ".openclaw-custom-runtime");
    const sourceSha = "a".repeat(40);
    fs.mkdirSync(path.join(release, "node_modules", "json5"), { recursive: true });
    fs.writeFileSync(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);
    fs.writeFileSync(path.join(release, "node_modules", "json5", "package.json"), "{}\n");
    const provenanceRecord = path.join(
      runtimeHome,
      "source-provenance",
      sourceSha,
      "provenance.json",
    );
    fs.mkdirSync(path.dirname(provenanceRecord), { recursive: true, mode: 0o700 });
    fs.writeFileSync(provenanceRecord, "{}\n", { mode: 0o600 });
    fs.writeFileSync(
      path.join(release, ".openclaw-runtime-provenance.json"),
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-runtime-provenance.v1",
        sourceSha,
        treeSha: "a".repeat(40),
        recordPath: provenanceRecord,
        recordSha256: createHash("sha256").update(fs.readFileSync(provenanceRecord)).digest("hex"),
      })}\n`,
      { mode: 0o600 },
    );
    fs.mkdirSync(path.join(release, "scripts", "custom-runtime"), {
      recursive: true,
      mode: 0o700,
    });
    fs.writeFileSync(
      path.join(release, "scripts", "custom-runtime", "custom-runtime-source-provenance.mjs"),
      "process.exit(0);\n",
      { mode: 0o600 },
    );
    fs.mkdirSync(path.join(runtimeHome, "bin"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(runtimeHome, "bin", "custom-runtime-source-provenance.mjs"),
      "process.exit(0);\n",
      { mode: 0o700 },
    );
    const fakeNode = path.join(root, "fake-node");
    fs.writeFileSync(fakeNode, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    const sealEnv = {
      ...process.env,
      HOME: home,
      OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
      OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
      OPENCLAW_NODE_BIN: fakeNode,
    };
    const result = spawnSync(sealScript, ["--seal", "--release", release], {
      encoding: "utf8",
      env: sealEnv,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`CUSTOM_RUNTIME_SEALED sha=${sourceSha}`);
    expect(fs.readFileSync(path.join(release, ".openclaw-runtime-sealed"), "utf8").trim()).toBe(
      sourceSha,
    );
    for (const sealedPath of [
      release,
      path.join(release, "node_modules"),
      path.join(release, "node_modules", "json5"),
      path.join(release, ".openclaw-production-sha"),
      path.join(release, ".openclaw-runtime-sealed"),
      path.join(release, "node_modules", "json5", "package.json"),
    ]) {
      expect(fs.statSync(sealedPath).mode & 0o222).toBe(0);
    }
    const verified = spawnSync(sealScript, ["--verify", "--release", release], {
      encoding: "utf8",
      env: sealEnv,
    });
    expect(verified.status, verified.stderr).toBe(0);

    const packagePath = path.join(release, "node_modules", "json5", "package.json");
    fs.chmodSync(packagePath, 0o600);
    const tampered = spawnSync(sealScript, ["--verify", "--release", release], {
      encoding: "utf8",
      env: sealEnv,
    });
    expect(tampered.status).not.toBe(0);
    expect(tampered.stderr).toContain("writable path");
  });

  it("seals a release with portable v2 source provenance", () => {
    const root = temporaryRoot("openclaw-runtime-seal-portable-");
    const releases = path.join(root, "releases");
    const release = path.join(releases, "candidate");
    const sourceSha = "b".repeat(40);
    const treeSha = "c".repeat(40);
    const bundle = path.join(release, ".openclaw-provenance", "source.bundle");
    fs.mkdirSync(path.dirname(bundle), { recursive: true, mode: 0o700 });
    fs.writeFileSync(bundle, "portable bundle\n", { mode: 0o600 });
    fs.writeFileSync(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`, {
      mode: 0o600,
    });
    fs.writeFileSync(
      path.join(release, ".openclaw-runtime-provenance.json"),
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-runtime-provenance.v2",
        sourceSha,
        treeSha,
        objectFormat: "sha1",
        bundlePath: bundle,
        bundleSha256: createHash("sha256").update(fs.readFileSync(bundle)).digest("hex"),
      })}\n`,
      { mode: 0o600 },
    );
    fs.mkdirSync(path.join(release, "scripts", "custom-runtime"), {
      recursive: true,
      mode: 0o700,
    });
    fs.writeFileSync(
      path.join(release, "scripts", "custom-runtime", "custom-runtime-source-provenance.mjs"),
      "process.exit(0);\n",
      { mode: 0o700 },
    );
    const fakeNode = path.join(root, "fake-node");
    fs.writeFileSync(fakeNode, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    const result = spawnSync(sealScript, ["--seal", "--release", release], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: path.join(root, "home"),
        OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
        OPENCLAW_NODE_BIN: fakeNode,
      },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`CUSTOM_RUNTIME_SEALED sha=${sourceSha}`);
    expect(fs.readFileSync(path.join(release, ".openclaw-runtime-sealed"), "utf8").trim()).toBe(
      sourceSha,
    );
  });

  it("runs status through the managed launcher without invoking a package manager", () => {
    const root = temporaryRoot("openclaw-runtime-status-");
    const runtimeHome = path.join(root, "runtime-home");
    const launcher = path.join(runtimeHome, "bin", "custom-runtime-launcher.sh");
    const marker = path.join(root, "launcher-args.txt");
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(marker)}\n`, {
      mode: 0o700,
    });

    const result = spawnSync(statusScript, ["--deep", "--json"], {
      encoding: "utf8",
      env: { ...process.env, OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(marker, "utf8").trim().split("\n")).toEqual([
      "gateway",
      "status",
      "--deep",
      "--json",
    ]);
  });
});
