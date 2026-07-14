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
  const home = createRuntimeFixtureRoot("openclaw-custom-runtime-update-");
  roots.push(home);
  const runtimeHome = path.join(home, ".openclaw-custom-runtime");
  const releasesDir = path.join(home, ".openclaw-runtime-releases");
  const release = path.join(releasesDir, "release-new");
  const manifestPath = path.join(release, "dist", "control-ui", "dashboard-surfaces.json");
  const assetPath = path.join(release, "dist", "control-ui", "assets", "pcc.js");
  const capabilityManifestPath = path.join(release, "config", "custom-runtime-capabilities.json");
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
  writeFileSync(path.join(release, "package.json"), '{"version":"2026.6.11"}\n');
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
  const launcher = path.join(runtimeHome, "bin", "custom-runtime-launcher.sh");
  cpSync(
    path.join(process.cwd(), "scripts", "custom-runtime", "custom-runtime-launcher.sh"),
    launcher,
  );
  chmodSync(launcher, 0o755);
  return {
    capabilityManifestPath,
    entrypoint,
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
        plugins: { allow: ["apps"], entries: { apps: { enabled: true } } },
      })}\n`,
    );
    executable(
      provider,
      '#!/bin/sh\nprintf \'%s\\n\' \'{"values":{"discord/bot-token":"present"}}\'\n',
    );
    const originalPointer = `${JSON.stringify({
      requiredSurfaces: ["pcc"],
      requiredCapabilities: ["dashboard:pcc"],
    })}\n`;
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
        timeout: 30_000,
        env: {
          ...process.env,
          HOME: input.home,
          OPENCLAW_CONFIG_PATH: configPath,
          OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
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
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(input.runtimeHome, { recursive: true });
    writeFileSync(path.join(input.release, ".openclaw-production-sha"), `${input.sourceSha}\n`);
    const originalPointer =
      '{"releaseId":"release-old","requiredSurfaces":[],"requiredCapabilities":[]}\n';
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
    [ "$count" -gt 1 ]
    ;;
esac
`,
    );

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
          HOME: input.home,
          OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
          OPENCLAW_CUSTOM_RUNTIME_RELEASES: realpathSync(input.releasesDir),
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
  });
});
