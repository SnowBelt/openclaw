import { spawnSync } from "node:child_process";
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
  it("seals every release directory and verifies the exact source marker", () => {
    const root = temporaryRoot("openclaw-runtime-seal-");
    const releases = path.join(root, "releases");
    const release = path.join(releases, "candidate");
    const sourceSha = "a".repeat(40);
    fs.mkdirSync(path.join(release, "node_modules", "json5"), { recursive: true });
    fs.writeFileSync(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);
    fs.writeFileSync(path.join(release, "node_modules", "json5", "package.json"), "{}\n");

    const result = spawnSync(sealScript, ["--seal", "--release", release], {
      encoding: "utf8",
      env: { ...process.env, OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`CUSTOM_RUNTIME_SEALED sha=${sourceSha}`);
    expect(fs.readFileSync(path.join(release, ".openclaw-runtime-sealed"), "utf8").trim()).toBe(
      sourceSha,
    );
    for (const directory of [
      release,
      path.join(release, "node_modules"),
      path.join(release, "node_modules", "json5"),
    ]) {
      expect(fs.statSync(directory).mode & 0o222).toBe(0);
    }
    const verified = spawnSync(sealScript, ["--verify", "--release", release], {
      encoding: "utf8",
      env: { ...process.env, OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases },
    });
    expect(verified.status, verified.stderr).toBe(0);
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
