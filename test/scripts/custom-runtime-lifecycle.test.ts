import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const activateScript = path.resolve("scripts/custom-runtime/custom-runtime-activate.sh");
const stageScript = path.resolve("scripts/custom-runtime/custom-runtime-stage.sh");
const promoteScript = path.resolve("scripts/custom-runtime/custom-runtime-promote.sh");
const controlPlaneFiles = [
  "custom-runtime-activate.sh",
  "custom-runtime-guard.sh",
  "custom-runtime-launcher.sh",
  "custom-runtime-promote.sh",
  "custom-runtime-stage.sh",
  "custom-runtime-updater.sh",
  "copy_stage_state.py",
] as const;

function writeFile(filePath: string, value: string, mode?: number) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
  if (mode !== undefined) {
    fs.chmodSync(filePath, mode);
  }
}

function createRoot(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(root);
  return fs.realpathSync(root);
}

function writeCandidateContracts(release: string, sourceSha: string) {
  const entrypoint = path.join(release, "dist", "index.js");
  const controlUi = path.join(release, "dist", "control-ui");
  const bundledPlugins = path.join(release, "dist-runtime", "extensions");
  writeFile(path.join(controlUi, "index.html"), "<!doctype html>\n");
  writeFile(
    path.join(controlUi, "dashboard-surfaces.json"),
    `${JSON.stringify({
      surfaces: [{ id: "pcc", path: "/pcc", assets: ["index.html"] }],
    })}\n`,
  );
  writeFile(path.join(bundledPlugins, "example", "package.json"), "{}\n");
  writeFile(
    path.join(release, "config", "custom-runtime-capabilities.json"),
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
        {
          id: "plugin:apps",
          kind: "plugin",
          pluginId: "apps",
          requiredPaths: ["extensions/apps/openclaw.plugin.json"],
        },
        {
          id: "plugin:book-writer",
          kind: "plugin",
          pluginId: "book-writer",
          requiredPaths: ["extensions/book-writer/openclaw.plugin.json"],
        },
      ],
    })}\n`,
  );
  writeFile(path.join(release, "extensions", "apps", "openclaw.plugin.json"), "{}\n");
  writeFile(path.join(release, "extensions", "book-writer", "openclaw.plugin.json"), "{}\n");
  writeFile(path.join(release, "package.json"), '{"version":"2026.6.11"}\n');
  writeFile(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);
  writeFile(
    path.join(release, "snapshot.json"),
    `${JSON.stringify({
      version: 2,
      releaseId: path.basename(release),
      root: release,
      createdAt: "2026-07-14T06:29:44.990Z",
      packageVersion: "2026.6.11",
      artifactHash: "a".repeat(64),
      source: { commit: "b".repeat(40) },
      schemas: {
        runtimeSnapshot: 2,
        selfImprovementLedger: 1,
        selfImprovementRecommendationStore: 3,
        selfImprovementSignal: 1,
      },
      paths: { entrypoint, controlUi, bundledPlugins },
    })}\n`,
  );
}

function readPlistProgramArguments(plistPath: string): string[] {
  const result = spawnSync(
    "python3",
    [
      "-c",
      "import json, plistlib, sys; print(json.dumps(plistlib.load(open(sys.argv[1], 'rb')).get('ProgramArguments', [])))",
      plistPath,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "could not parse test LaunchAgent plist");
  }
  return JSON.parse(result.stdout) as string[];
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("custom runtime lifecycle", () => {
  it("stages with copied local auth while suppressing external runtime side effects", () => {
    const root = createRoot("openclaw-custom-stage-local-");
    const runtimeHome = path.join(root, "runtime-home");
    const release = path.join(root, "releases", "candidate");
    const state = path.join(root, "state");
    const config = path.join(root, "openclaw.json");
    const provider = path.join(root, "provider.sh");
    const launcher = path.join(root, "launcher.sh");
    const fakeBin = path.join(root, "bin");
    const gatewayMarker = path.join(root, "gateway-marker.json");
    const rpcArgsMarker = path.join(root, "rpc-args.txt");
    const sourceSha = "9".repeat(64);

    writeFile(path.join(release, "dist", "index.js"), "// candidate\n");
    writeCandidateContracts(release, sourceSha);
    writeFile(
      config,
      `${JSON.stringify({
        channels: { discord: { enabled: true, token: "test-only" } },
        gateway: {
          auth: { mode: "token", token: "test-only" },
          port: 18789,
          tailscale: { mode: "serve" },
        },
        plugins: {
          allow: ["apps", "book-writer"],
          entries: { apps: { enabled: true }, "book-writer": { enabled: true } },
        },
      })}\n`,
      0o600,
    );
    fs.mkdirSync(state, { recursive: true });
    writeFile(
      provider,
      '#!/bin/sh\nprintf \'%s\\n\' \'{"values":{"discord/bot-token":"test-only"}}\'\n',
      0o700,
    );
    writeFile(
      launcher,
      [
        "#!/bin/sh",
        'if [ "${1:-}" = --verify ]; then exit 0; fi',
        'if [ "${1:-}" = gateway ]; then',
        `  python3 - "$OPENCLAW_CONFIG_PATH" ${JSON.stringify(gatewayMarker)} "$OPENCLAW_SKIP_CHANNELS" "$OPENCLAW_SKIP_CRON" "$OPENCLAW_SELF_IMPROVEMENT_BACKGROUND" <<'PY'`,
        "import json, sys",
        "config_path, marker, skip_channels, skip_cron, background = sys.argv[1:]",
        "with open(config_path, encoding='utf-8') as f: config = json.load(f)",
        "gateway = config.get('gateway', {})",
        "data = {'port': gateway.get('port'), 'tailscaleMode': gateway.get('tailscale', {}).get('mode'), 'skipChannels': skip_channels, 'skipCron': skip_cron, 'background': background}",
        "with open(marker, 'w', encoding='utf-8') as f: json.dump(data, f, sort_keys=True)",
        "PY",
        "  trap 'exit 0' TERM INT",
        "  while :; do sleep 1; done",
        "fi",
        'if [ "${1:-}" = self-improvement ] && [ "${2:-}" = summary ]; then',
        `  printf '%s\\n' "$@" > ${JSON.stringify(rpcArgsMarker)}`,
        "  python3 - \"$OPENCLAW_CONFIG_PATH\" <<'PY'",
        "import json, sys",
        "with open(sys.argv[1], encoding='utf-8') as f: config = json.load(f)",
        "if config.get('gateway', {}).get('port') != 18790: raise SystemExit(1)",
        "PY",
        "  printf '%s\\n' '{\"scorecard\":{},\"groups\":[]}'",
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
      0o700,
    );
    writeFile(
      path.join(runtimeHome, "active-runtime.json"),
      `${JSON.stringify({ releaseId: "legacy-sig", requiredSurfaces: ["pcc"] })}\n`,
    );
    writeFile(
      path.join(fakeBin, "curl"),
      [
        "#!/bin/sh",
        "header= write_out=false",
        "while [ $# -gt 0 ]; do",
        '  case "$1" in',
        "    --dump-header) header=$2; shift 2;;",
        "    --write-out) write_out=true; shift 2;;",
        "    *) shift;;",
        "  esac",
        "done",
        'if [ -n "$header" ]; then printf \'HTTP/1.1 101 Switching Protocols\\r\\n\\r\\n\' > "$header"; exit 0; fi',
        'if [ "$write_out" = true ]; then printf 200; else printf \'{"ok":true}\'; fi',
        "",
      ].join("\n"),
      0o700,
    );

    const result = spawnSync(
      stageScript,
      ["--release", release, "--source-sha", sourceSha, "--port", "18790"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENCLAW_CONFIG_PATH: config,
          OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
          OPENCLAW_CUSTOM_RUNTIME_LAUNCHER: launcher,
          OPENCLAW_SECRET_PROVIDER: provider,
          OPENCLAW_STATE_DIR: state,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("CUSTOM_RUNTIME_STAGE_OK release=candidate");
    expect(JSON.parse(fs.readFileSync(gatewayMarker, "utf8"))).toEqual({
      background: "0",
      port: 18790,
      skipChannels: "1",
      skipCron: "1",
      tailscaleMode: "off",
    });
    expect(fs.readFileSync(rpcArgsMarker, "utf8")).not.toContain("--url");
    expect(JSON.parse(fs.readFileSync(config, "utf8"))).toMatchObject({
      channels: { discord: { enabled: true } },
      gateway: { port: 18789, tailscale: { mode: "serve" } },
    });
  });

  it("staging fails closed without changing a mismatched immutable release stamp", () => {
    const root = createRoot("openclaw-custom-stage-");
    const runtimeHome = path.join(root, "runtime-home");
    const release = path.join(root, "releases", "candidate");
    const state = path.join(root, "state");
    const config = path.join(root, "openclaw.json");
    const provider = path.join(root, "provider.sh");
    const originalStamp = "a".repeat(64);
    const requestedStamp = "b".repeat(64);

    writeFile(path.join(release, "dist", "index.js"), "// candidate\n");
    writeCandidateContracts(release, originalStamp);
    writeFile(
      config,
      `${JSON.stringify({
        plugins: {
          allow: ["apps", "book-writer"],
          entries: { apps: { enabled: true }, "book-writer": { enabled: true } },
        },
      })}\n`,
    );
    fs.mkdirSync(state, { recursive: true });
    writeFile(
      provider,
      '#!/bin/sh\nprintf \'%s\\n\' \'{"values":{"discord/bot-token":"test-only"}}\'\n',
      0o700,
    );

    const result = spawnSync(
      stageScript,
      ["--release", release, "--source-sha", requestedStamp, "--port", "18790"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENCLAW_CONFIG_PATH: config,
          OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
          OPENCLAW_SECRET_PROVIDER: provider,
          OPENCLAW_STATE_DIR: state,
        },
      },
    );

    expect(result.status, result.stderr).toBe(64);
    expect(result.stderr).toContain("release source stamp does not match");
    expect(fs.readFileSync(path.join(release, ".openclaw-production-sha"), "utf8")).toBe(
      `${originalStamp}\n`,
    );
  });

  it("promotion persists the exact verified runtime identity in the managed service", () => {
    const root = createRoot("openclaw-custom-promote-");
    const home = path.join(root, "home");
    const runtimeHome = path.join(home, ".openclaw-custom-runtime");
    const releases = path.join(home, ".openclaw-runtime-releases");
    const release = path.join(releases, "candidate");
    const launcher = path.join(runtimeHome, "bin", "custom-runtime-launcher.sh");
    const envWrapper = path.join(root, "service-env-wrapper.sh");
    const envFile = path.join(root, "gateway.env");
    const plistPath = path.join(root, "ai.openclaw.gateway.plist");
    const fakeBin = path.join(root, "bin");
    const sigRpcMarker = path.join(root, "sig-rpc-called");
    const sigRpcArgsMarker = path.join(root, "sig-rpc-args");
    const sourceSha = "c".repeat(64);

    writeFile(path.join(release, "dist", "index.js"), "// candidate\n");
    writeCandidateContracts(release, sourceSha);
    writeFile(
      launcher,
      [
        "#!/bin/sh",
        'if [ "${1:-}" = --verify ]; then exit 0; fi',
        'if [ "${1:-}" = self-improvement ] && [ "${2:-}" = summary ]; then',
        `  : > ${JSON.stringify(sigRpcMarker)}`,
        `  printf '%s\\n' "$@" > ${JSON.stringify(sigRpcArgsMarker)}`,
        "  printf '%s\\n' '{\"scorecard\":{},\"groups\":[]}'",
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
      0o700,
    );
    writeFile(
      path.join(runtimeHome, "active-runtime.json"),
      `${JSON.stringify({ releaseId: "legacy-sig", requiredSurfaces: ["pcc"] })}\n`,
    );
    writeFile(envWrapper, "#!/bin/sh\n", 0o700);
    writeFile(envFile, "export OPENCLAW_SELF_IMPROVEMENT_BACKGROUND=1\n", 0o600);
    writeFile(
      plistPath,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0"><dict>',
        "<key>Label</key><string>ai.openclaw.gateway</string>",
        "<key>ProgramArguments</key><array>",
        "<string>/stale/openclaw</string><string>gateway</string><string>--port</string><string>18789</string>",
        "</array></dict></plist>",
        "",
      ].join("\n"),
    );
    writeFile(
      path.join(fakeBin, "launchctl"),
      '#!/bin/sh\ncase "${1:-}" in bootout|bootstrap) exit 0;; print) exit 1;; esac\nexit 1\n',
      0o700,
    );
    writeFile(path.join(fakeBin, "pgrep"), "#!/bin/sh\nexit 0\n", 0o700);
    writeFile(
      path.join(fakeBin, "curl"),
      [
        "#!/bin/sh",
        "header= write_out=false",
        "while [ $# -gt 0 ]; do",
        '  case "$1" in',
        "    --dump-header) header=$2; shift 2;;",
        "    --write-out) write_out=true; shift 2;;",
        "    *) shift;;",
        "  esac",
        "done",
        'if [ -n "$header" ]; then printf \'HTTP/1.1 101 Switching Protocols\\r\\n\\r\\n\' > "$header"; exit 0; fi',
        'if [ "$write_out" = true ]; then printf 200; else printf \'{"ok":true}\'; fi',
        "",
      ].join("\n"),
      0o700,
    );

    const result = spawnSync(
      promoteScript,
      ["--release", release, "--source-sha", sourceSha, "--port", "18789"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
          OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
          OPENCLAW_GATEWAY_ENV_FILE: envFile,
          OPENCLAW_GATEWAY_ENV_WRAPPER: envWrapper,
          OPENCLAW_GATEWAY_PLIST: plistPath,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("CUSTOM_RUNTIME_PROMOTED release=candidate");
    expect(fs.existsSync(sigRpcMarker)).toBe(true);
    expect(fs.readFileSync(sigRpcArgsMarker, "utf8")).not.toContain("--url");
    const serviceEnv = fs.readFileSync(envFile, "utf8");
    expect(serviceEnv).toContain("OPENCLAW_SELF_IMPROVEMENT_BACKGROUND=1");
    expect(serviceEnv).toContain(`export OPENCLAW_WRAPPER=${launcher}`);
    expect(serviceEnv).toContain(`export OPENCLAW_RUNTIME_SNAPSHOT_ROOT=${release}`);
    expect(serviceEnv).toContain(
      `export OPENCLAW_BUNDLED_PLUGINS_DIR=${release}/dist-runtime/extensions`,
    );
    expect(readPlistProgramArguments(plistPath)).toEqual([
      envWrapper,
      envFile,
      launcher,
      "gateway",
      "--port",
      "18789",
    ]);
    const pointer = JSON.parse(
      fs.readFileSync(path.join(runtimeHome, "active-runtime.json"), "utf8"),
    ) as {
      requiredCapabilities?: string[];
      requiredSurfaces?: string[];
      runtimeRoot?: string;
      sourceSha?: string;
    };
    expect(pointer).toMatchObject({ runtimeRoot: release, sourceSha });
    expect(pointer.requiredSurfaces).toEqual(["pcc"]);
    expect(pointer.requiredCapabilities).toEqual([
      "dashboard:pcc",
      "plugin:apps",
      "plugin:book-writer",
    ]);
  });

  it("restores the previous launcher before a failed promotion restart", () => {
    const root = createRoot("openclaw-custom-promote-rollback-");
    const home = path.join(root, "home");
    const runtimeHome = path.join(home, ".openclaw-custom-runtime");
    const releases = path.join(home, ".openclaw-runtime-releases");
    const release = path.join(releases, "candidate");
    const launcher = path.join(runtimeHome, "bin", "custom-runtime-launcher.sh");
    const rollbackLauncher = path.join(root, "previous-launcher.sh");
    const envWrapper = path.join(root, "service-env-wrapper.sh");
    const envFile = path.join(root, "gateway.env");
    const plistPath = path.join(root, "ai.openclaw.gateway.plist");
    const fakeBin = path.join(root, "bin");
    const bootstrapCount = path.join(root, "bootstrap-count");
    const sourceSha = "d".repeat(64);
    const previousPointer = { releaseId: "previous", runtimeRoot: "/previous/release" };
    const previousLauncherText = '#!/bin/sh\n[ "${1:-}" = --verify ]\n# previous\n';

    writeFile(path.join(release, "dist", "index.js"), "// candidate\n");
    writeCandidateContracts(release, sourceSha);
    writeFile(launcher, '#!/bin/sh\n[ "${1:-}" = --verify ]\n# candidate\n', 0o700);
    writeFile(rollbackLauncher, previousLauncherText, 0o700);
    writeFile(
      path.join(runtimeHome, "active-runtime.json"),
      `${JSON.stringify(previousPointer)}\n`,
    );
    writeFile(envWrapper, "#!/bin/sh\n", 0o700);
    writeFile(envFile, "export OPENCLAW_SELF_IMPROVEMENT_BACKGROUND=1\n", 0o600);
    writeFile(
      plistPath,
      '<?xml version="1.0"?><plist version="1.0"><dict><key>ProgramArguments</key><array><string>/previous</string></array></dict></plist>\n',
    );
    writeFile(
      path.join(fakeBin, "launchctl"),
      [
        "#!/bin/sh",
        'case "${1:-}" in',
        "  bootout) exit 0;;",
        "  print) exit 1;;",
        `  bootstrap) count=$(cat ${JSON.stringify(bootstrapCount)} 2>/dev/null || printf 0); count=$((count + 1)); printf '%s\\n' "$count" > ${JSON.stringify(bootstrapCount)}; exit 0;;`,
        "esac",
        "exit 1",
        "",
      ].join("\n"),
      0o700,
    );
    writeFile(
      path.join(fakeBin, "curl"),
      [
        "#!/bin/sh",
        `count=$(cat ${JSON.stringify(bootstrapCount)} 2>/dev/null || printf 0)`,
        '[ "$count" -ge 2 ] || exit 1',
        "printf '{\"ok\":true}'",
        "",
      ].join("\n"),
      0o700,
    );
    writeFile(path.join(fakeBin, "sleep"), "#!/bin/sh\nexit 0\n", 0o700);

    const result = spawnSync(
      promoteScript,
      ["--release", release, "--source-sha", sourceSha, "--port", "18789"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
          OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
          OPENCLAW_CUSTOM_RUNTIME_ROLLBACK_LAUNCHER: rollbackLauncher,
          OPENCLAW_GATEWAY_ENV_FILE: envFile,
          OPENCLAW_GATEWAY_ENV_WRAPPER: envWrapper,
          OPENCLAW_GATEWAY_PLIST: plistPath,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(1);
    expect(fs.readFileSync(launcher, "utf8")).toBe(previousLauncherText);
    expect(
      JSON.parse(fs.readFileSync(path.join(runtimeHome, "active-runtime.json"), "utf8")),
    ).toEqual(previousPointer);
    const receipt = fs
      .readdirSync(path.join(runtimeHome, "receipts"))
      .find((entry) => entry.startsWith("promotion-"));
    expect(receipt).toBeTruthy();
    expect(
      JSON.parse(fs.readFileSync(path.join(runtimeHome, "receipts", receipt!), "utf8")),
    ).toMatchObject({ result: "rolled_back_verified" });
  });

  it.each([
    { promoteExit: 0, expectedStatus: 0, expectedReceipt: "activated" },
    { promoteExit: 1, expectedStatus: 1, expectedReceipt: "rolled_back_verified" },
  ])(
    "transactional activation preserves a usable control plane when promotion exits $promoteExit",
    ({ promoteExit, expectedStatus, expectedReceipt }) => {
      const root = createRoot(`openclaw-custom-activate-${promoteExit}-`);
      const home = path.join(root, "home");
      const runtimeHome = path.join(home, ".openclaw-custom-runtime");
      const releases = path.join(home, ".openclaw-runtime-releases");
      const release = path.join(releases, "candidate");
      const controlSource = path.join(release, "scripts", "custom-runtime");
      const fakeBin = path.join(root, "bin");
      const sourceSha = "e".repeat(64);
      const previousFiles = new Map<string, string>();
      const candidateFiles = new Map<string, string>();

      writeFile(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);
      for (const file of controlPlaneFiles) {
        const oldText =
          file === "custom-runtime-launcher.sh"
            ? '#!/bin/sh\n[ "${1:-}" = --verify ]\n# previous\n'
            : file.endsWith(".py")
              ? "# previous python\n"
              : `#!/bin/sh\n# previous ${file}\n`;
        const candidateText =
          file === "custom-runtime-stage.sh"
            ? '#!/bin/sh\n[ -n "${OPENCLAW_CUSTOM_RUNTIME_LAUNCHER:-}" ]\nexit 0\n'
            : file === "custom-runtime-promote.sh"
              ? `#!/bin/sh\n[ -f "\${OPENCLAW_CUSTOM_RUNTIME_ROLLBACK_LAUNCHER:-}" ]\nexit ${promoteExit}\n`
              : file.endsWith(".py")
                ? "# candidate python\n"
                : `#!/bin/sh\n# candidate ${file}\nexit 0\n`;
        previousFiles.set(file, oldText);
        candidateFiles.set(file, candidateText);
        writeFile(path.join(runtimeHome, "bin", file), oldText, 0o700);
        writeFile(path.join(controlSource, file), candidateText, 0o700);
      }
      writeFile(
        path.join(fakeBin, "launchctl"),
        '#!/bin/sh\ncase "${1:-}" in bootout|bootstrap) exit 0;; print) exit 1;; esac\nexit 1\n',
        0o700,
      );
      writeFile(path.join(fakeBin, "curl"), "#!/bin/sh\nprintf '{\"ok\":true}'\n", 0o700);

      const result = spawnSync(
        activateScript,
        [
          "--release",
          release,
          "--source-sha",
          sourceSha,
          "--stage-port",
          "18790",
          "--port",
          "18789",
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: home,
            OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
            OPENCLAW_CUSTOM_RUNTIME_RELEASES: releases,
            OPENCLAW_GATEWAY_PLIST: path.join(root, "ai.openclaw.gateway.plist"),
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          },
        },
      );

      expect(result.status, result.stderr).toBe(expectedStatus);
      const expectedFiles = promoteExit === 0 ? candidateFiles : previousFiles;
      for (const [file, expected] of expectedFiles) {
        expect(fs.readFileSync(path.join(runtimeHome, "bin", file), "utf8")).toBe(expected);
      }
      expect(fs.existsSync(path.join(runtimeHome, "locks", "activation.lock"))).toBe(false);
      const receipt = fs
        .readdirSync(path.join(runtimeHome, "receipts"))
        .find((entry) => entry.startsWith("activation-"));
      expect(receipt).toBeTruthy();
      expect(
        JSON.parse(fs.readFileSync(path.join(runtimeHome, "receipts", receipt!), "utf8")),
      ).toMatchObject({ result: expectedReceipt, release: "candidate" });
    },
  );
});
