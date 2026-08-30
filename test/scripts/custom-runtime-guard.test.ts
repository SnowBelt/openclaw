import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const guard = fs.readFileSync(
  path.resolve("scripts/custom-runtime/custom-runtime-guard.sh"),
  "utf8",
);
const authHelper = path.resolve("scripts/custom-runtime/custom-runtime-auth.sh");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("custom runtime guard verification cache", () => {
  it("keeps the cheap process check and binds the full proof to all runtime identities", () => {
    expect(guard).toContain("full_verification_ttl=900");
    expect(guard).toContain("openclaw.custom-runtime-guard-verification.v1");
    expect(guard).toContain("pointerSha256");
    expect(guard).toContain("launcherSha256");
    expect(guard).toContain("plistSha256");
    expect(guard).toContain("guardPlistSha256");
    expect(guard).toContain("guardExecutableSha256");
    expect(guard).toContain("guardProgramArguments");
    expect(guard).toContain("gatewayEnvWrapperSha256");
    expect(guard).toContain("gatewayEnvFileSha256");
    expect(guard).toContain("provenanceSha256");
    expect(guard).toContain("provenanceRecordSha256");
    expect(guard).toContain("provenanceMigrationSha256");
    expect(guard).toContain("dashboardManifestSha256");
    expect(guard).toContain("gatewayConfigSha256");
    expect(guard).toContain('[ -n "$dashboard_manifest_sha" ]');
    expect(guard).toContain("dashboard_runtime_ok");
    expect(guard).toContain("served Dashboard build does not match the active manifest");
    expect(guard).toContain("served service worker does not match the Dashboard build");
    expect(guard).toContain("provenance_invalid=false");
    expect(guard).toContain("custom_runtime_ensure_node_bin");
    expect(guard).toContain("custom_runtime_read_effective_gateway_section");
    expect(guard).not.toContain('json.load(f)\norigins = ((config.get("gateway")');
    expect(guard).toContain("custom_runtime_init_process_probes");
    expect(guard).toContain('custom_runtime_port_owner_pid "$port" "$runtime_root"');
    expect(guard).not.toContain('pgrep -f "$runtime_root/dist/index.js gateway"');
    expect(guard).toContain('"$launcher" --verify');
    expect(guard).toContain("os.lstat(path)");
    expect(guard).toContain("os.replace(temporary, target)");
    expect(guard).toContain('if [ "$status" -ne 0 ]; then');
    expect(guard).toContain('rm -f "$verification_receipt"');
    expect(guard).toContain('[ "$1" = --verify-only ]');
    expect(guard).toContain('[ "$lifecycle_status" -eq 75 ] && exit 75');
    expect(guard).toContain("receipt verification_failed");
  });

  it("rejects a symlinked managed Gateway config before loading it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-guard-config-"));
    temporaryRoots.push(root);
    const target = path.join(root, "target.json");
    const config = path.join(root, "openclaw.director.json");
    fs.writeFileSync(target, "{}\n");
    fs.symlinkSync(target, config);

    const result = spawnSync(
      "sh",
      [
        "-c",
        '. "$1"; custom_runtime_read_effective_gateway_section "$2" "$3" auth',
        "guard-config-test",
        authHelper,
        config,
        path.join(root, "runtime"),
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENCLAW_NODE_BIN: process.execPath,
          OPENCLAW_VERIFIED_RUNTIME_ROOT: path.join(root, "runtime"),
        },
      },
    );

    expect(result.status).not.toBe(0);
  });

  it("normalizes an omitted optional Control UI section to its default object", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-guard-control-ui-"));
    temporaryRoots.push(root);
    const config = path.join(root, "openclaw.director.json");
    const runtimeRoot = path.join(root, "runtime");
    const configModule = path.join(runtimeRoot, "dist", "config", "config.js");
    fs.writeFileSync(config, "{}\n");
    fs.mkdirSync(path.dirname(configModule), { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, "package.json"), '{"type":"module"}\n');
    fs.writeFileSync(
      configModule,
      "export async function readConfigFileSnapshot() { return { valid: true, config: { gateway: { auth: { mode: 'token', token: 'fixture' } } } }; }\n",
    );

    const result = spawnSync(
      "sh",
      [
        "-c",
        '. "$1"; custom_runtime_read_effective_gateway_section "$2" "$3" controlUi',
        "guard-control-ui-test",
        authHelper,
        config,
        runtimeRoot,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENCLAW_NODE_BIN: process.execPath,
          OPENCLAW_VERIFIED_RUNTIME_ROOT: runtimeRoot,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
  });

  it("does not import config code from an unverified runtime root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-guard-unverified-runtime-"));
    temporaryRoots.push(root);
    const config = path.join(root, "openclaw.director.json");
    const runtimeRoot = path.join(root, "runtime");
    const trustedRuntimeRoot = path.join(root, "trusted-runtime");
    const marker = path.join(root, "imported");
    const configModule = path.join(runtimeRoot, "dist", "config", "config.js");
    fs.writeFileSync(config, "{}\n");
    fs.mkdirSync(path.dirname(configModule), { recursive: true });
    fs.mkdirSync(trustedRuntimeRoot);
    fs.writeFileSync(path.join(runtimeRoot, "package.json"), '{"type":"module"}\n');
    fs.writeFileSync(
      configModule,
      `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "executed"); export async function readConfigFileSnapshot() { return { valid: true, config: {} }; }\n`,
    );

    const result = spawnSync(
      "sh",
      [
        "-c",
        '. "$1"; custom_runtime_read_effective_gateway_section "$2" "$3" auth',
        "guard-unverified-runtime-test",
        authHelper,
        config,
        runtimeRoot,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENCLAW_NODE_BIN: process.execPath,
          OPENCLAW_VERIFIED_RUNTIME_ROOT: trustedRuntimeRoot,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
