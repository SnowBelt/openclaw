import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
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

function createRuntimeFixtureRoot(prefix: string): string {
  // The production launcher intentionally rejects /tmp releases. Linux exposes
  // os.tmpdir() as /tmp, while macOS uses a per-user /private/var directory.
  const base = process.platform === "linux" ? os.homedir() : os.tmpdir();
  return mkdtempSync(path.join(base, prefix));
}

function executable(filePath: string, content: string): void {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function fixture() {
  const home = realpathSync(createRuntimeFixtureRoot("openclaw-custom-runtime-update-"));
  roots.push(home);
  const runtimeHome = path.join(home, ".openclaw-custom-runtime");
  const releasesDir = path.join(home, ".openclaw-runtime-releases");
  const release = path.join(releasesDir, "release-new");
  const manifestPath = path.join(release, "dist", "control-ui", "dashboard-surfaces.json");
  const assetPath = path.join(release, "dist", "control-ui", "assets", "pcc.js");
  const capabilityManifestPath = path.join(release, "config", "custom-runtime-capabilities.json");
  const evidenceRoot = path.join(release, ".test-release-governance");
  const pluginManifestPath = path.join(release, "extensions", "apps", "openclaw.plugin.json");
  const entrypoint = path.join(release, "dist", "index.js");
  const sourceSha = "abcdef1234567890abcdef1234567890abcdef12";
  for (const directory of [
    path.dirname(assetPath),
    path.dirname(capabilityManifestPath),
    path.dirname(pluginManifestPath),
    path.join(runtimeHome, "bin"),
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(assetPath, "// pcc\n");
  writeFileSync(pluginManifestPath, "{}\n");
  writeFileSync(path.join(release, "package.json"), '{"type":"module","version":"2026.6.11"}\n');
  writeFileSync(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);
  executable(
    path.join(release, "dist", "release-governor.js"),
    [
      "#!/usr/bin/env node",
      'import fs from "node:fs";',
      "const args = process.argv.slice(2);",
      "const value = (name) => args[args.indexOf(name) + 1];",
      'if (args[0] !== "verify") process.exit(64);',
      'const bundle = JSON.parse(fs.readFileSync(value("--bundle"), "utf8"));',
      'if (bundle.candidateSha !== value("--candidate-sha") || bundle.operation !== value("--operation") || bundle.decision !== "authorize") process.exit(1);',
      'if (!value("--release") || !fs.existsSync(value("--release"))) process.exit(1);',
      'if (!fs.existsSync(value("--policy"))) process.exit(1);',
      "process.exit(0);",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(release, "config", "release-governor-policy.json"),
    '{"schema":"openclaw.release-governor-policy.v1","version":1}\n',
  );
  for (const operation of ["stage", "promotion"]) {
    const evidencePath = path.join(evidenceRoot, sourceSha, `${operation}.json`);
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(
      evidencePath,
      `${JSON.stringify({ candidateSha: sourceSha, operation, decision: "authorize" })}\n`,
      { mode: 0o600 },
    );
  }
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      buildId: "fixture-build",
      surfaces: [{ id: "pcc", path: "/pcc", assets: ["assets/pcc.js"] }],
    })}\n`,
  );
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
        {
          id: "plugin:apps",
          kind: "plugin",
          pluginId: "apps",
          requiredPaths: ["extensions/apps/openclaw.plugin.json"],
        },
      ],
    })}\n`,
  );
  writeFileSync(
    entrypoint,
    `import http from "node:http";
const args = process.argv.slice(2);
if (args[0] === "self-improvement" && args[1] === "summary") {
  if (
    !process.env.OPENCLAW_GATEWAY_URL?.startsWith("ws://127.0.0.1:") ||
    process.env.OPENCLAW_GATEWAY_TOKEN !== "fixture-gateway-token"
  ) {
    process.stderr.write("missing explicit stage Gateway auth environment\\n");
    process.exit(2);
  }
  process.stdout.write('{"scorecard":{},"groups":[]}\\n');
  process.exit(0);
}
const port = Number(args[args.indexOf("--port") + 1]);
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(req.url === "/health" ? '{"ok":true}' : '{}');
});
server.on("upgrade", (_req, socket) => {
  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\n\\r\\n");
  socket.end();
});
server.listen(port, "127.0.0.1");
`,
  );
  const bundledPlugins = path.join(release, "dist-runtime", "extensions");
  mkdirSync(bundledPlugins, { recursive: true });
  writeFileSync(
    path.join(release, "snapshot.json"),
    `${JSON.stringify({
      version: 2,
      releaseId: "release-new",
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
      paths: { entrypoint, controlUi: path.dirname(manifestPath), bundledPlugins },
    })}\n`,
  );
  const launcher = path.join(runtimeHome, "bin", "custom-runtime-launcher.sh");
  cpSync(
    path.join(process.cwd(), "scripts", "custom-runtime", "custom-runtime-launcher.sh"),
    launcher,
  );
  chmodSync(launcher, 0o755);
  return {
    capabilityManifestPath,
    entrypoint,
    evidenceRoot,
    home,
    manifestPath,
    release,
    releasesDir,
    runtimeHome,
    sourceSha,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("custom runtime canary and rollback", () => {
  it("stages a candidate against copied state without changing the active pointer", () => {
    const input = fixture();
    const configPath = path.join(input.home, "openclaw.director.json");
    const stateDir = path.join(input.home, "state");
    const provider = path.join(input.home, "secret-provider");
    const activePointer = path.join(input.runtimeHome, "active-runtime.json");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      configPath,
      `${JSON.stringify({
        gateway: { auth: { mode: "token", token: "fixture-gateway-token" } },
        plugins: { allow: ["apps"], entries: { apps: { enabled: true } } },
      })}\n`,
    );
    executable(
      provider,
      '#!/bin/sh\nprintf \'%s\\n\' \'{"values":{"discord/bot-token":"present"}}\'\n',
    );
    // Models the previously deployed SIG pointer before capability fields were added.
    const originalPointer = `${JSON.stringify({ requiredSurfaces: ["pcc"] })}\n`;
    writeFileSync(activePointer, originalPointer);
    const port = 29_000 + Math.floor(Math.random() * 500);

    const result = spawnSync(
      "sh",
      [
        path.join(process.cwd(), "scripts", "custom-runtime", "custom-runtime-stage.sh"),
        "--release",
        input.release,
        "--source-sha",
        input.sourceSha,
        "--port",
        String(port),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 120_000,
        env: {
          ...process.env,
          HOME: input.home,
          OPENCLAW_CONFIG_PATH: configPath,
          OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
          OPENCLAW_RELEASE_GOVERNANCE_BUNDLE_DIR: input.evidenceRoot,
          OPENCLAW_NODE_BIN: process.execPath,
          OPENCLAW_SECRET_PROVIDER: provider,
          OPENCLAW_STATE_DIR: stateDir,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("CUSTOM_RUNTIME_STAGE_OK");
    expect(readFileSync(activePointer, "utf8")).toBe(originalPointer);
  });

  it("restores the previous pointer and service files when promotion bootstrap fails", () => {
    const input = fixture();
    const activePointer = path.join(input.runtimeHome, "active-runtime.json");
    const plist = path.join(input.home, "ai.openclaw.gateway.plist");
    const envFile = path.join(input.home, "gateway.env");
    const envWrapper = path.join(input.home, "gateway-wrapper.sh");
    const fakeBin = path.join(input.home, "bin");
    const launchctlState = path.join(input.home, "launchctl-count");
    const promotedPlist = path.join(input.home, "promoted-gateway.plist");
    const rollbackLauncher = path.join(input.home, "rollback-launcher.sh");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(input.runtimeHome, { recursive: true });
    const previousRuntimeRoot = path.join(input.releasesDir, "release-old");
    const originalPointer = `${JSON.stringify({
      releaseId: "release-old",
      runtimeRoot: previousRuntimeRoot,
      requiredSurfaces: [],
    })}\n`;
    writeFileSync(activePointer, originalPointer);
    writeFileSync(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>ai.openclaw.gateway</string><key>ProgramArguments</key><array><string>/usr/bin/true</string></array></dict></plist>
`,
    );
    writeFileSync(envFile, "export EXISTING_VALUE=1\n");
    executable(envWrapper, '#!/bin/sh\nexec "$@"\n');
    executable(rollbackLauncher, '#!/bin/sh\n[ "${1:-}" = --verify ]\n');
    executable(
      path.join(fakeBin, "launchctl"),
      `#!/bin/sh
case "$1" in
  bootout) exit 0 ;;
  print) exit 1 ;;
  bootstrap)
    count=0
    [ -f "$FAKE_LAUNCHCTL_STATE" ] && count=$(cat "$FAKE_LAUNCHCTL_STATE")
    count=$((count + 1))
    printf '%s\\n' "$count" > "$FAKE_LAUNCHCTL_STATE"
    [ "$count" -ne 1 ] || cp "$OPENCLAW_GATEWAY_PLIST" "$FAKE_PROMOTED_PLIST"
    [ "$count" -gt 1 ]
    ;;
esac
`,
    );
    // Keep rollback verification deterministic. Without a fake health response,
    // this test can accidentally pass against a developer's live Gateway while
    // timing out on an isolated CI runner.
    executable(path.join(fakeBin, "curl"), "#!/bin/sh\nprintf '%s\\n' '{\"ok\":true}'\n");

    const result = spawnSync(
      "sh",
      [
        path.join(process.cwd(), "scripts", "custom-runtime", "custom-runtime-promote.sh"),
        "--release",
        input.release,
        "--source-sha",
        input.sourceSha,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          FAKE_LAUNCHCTL_STATE: launchctlState,
          FAKE_PROMOTED_PLIST: promotedPlist,
          HOME: input.home,
          OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
          OPENCLAW_CUSTOM_RUNTIME_RELEASES: realpathSync(input.releasesDir),
          OPENCLAW_CUSTOM_RUNTIME_ROLLBACK_LAUNCHER: rollbackLauncher,
          OPENCLAW_RELEASE_GOVERNANCE_BUNDLE_DIR: input.evidenceRoot,
          OPENCLAW_GATEWAY_ENV_FILE: envFile,
          OPENCLAW_GATEWAY_ENV_WRAPPER: envWrapper,
          OPENCLAW_GATEWAY_PLIST: plist,
          OPENCLAW_NODE_BIN: process.execPath,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(readFileSync(activePointer, "utf8")).toBe(originalPointer);
    expect(readFileSync(envFile, "utf8")).toBe("export EXISTING_VALUE=1\n");
    expect(readFileSync(plist, "utf8")).toContain("/usr/bin/true");
    expect(readFileSync(launchctlState, "utf8").trim()).toBe("2");
    const promotedPlistContents = readFileSync(promotedPlist, "utf8");
    expect(promotedPlistContents).toContain(`<string>${envWrapper}</string>`);
    expect(promotedPlistContents).not.toContain("<string>/bin/sh</string>");
  });
});
