import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve("scripts/custom-runtime/custom-runtime-tailscale-primary.sh");
const runtimeGuardScript = path.resolve("scripts/custom-runtime/custom-runtime-guard.sh");
const roots: string[] = [];
const servers: net.Server[] = [];
const sockets: string[] = [];

function writeFile(filePath: string, contents: string, mode?: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  if (mode !== undefined) {
    fs.chmodSync(filePath, mode);
  }
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-tailscale-primary-"));
  roots.push(root);
  const home = path.join(root, "home");
  const runtimeHome = path.join(root, "runtime");
  const stateDir = path.join(root, "state");
  const fakeBin = path.join(root, "bin");
  const plist = path.join(home, "Library", "LaunchAgents", "primary.plist");
  const daemon = path.join(fakeBin, "tailscaled");
  const cli = path.join(fakeBin, "tailscale");
  const launchctl = path.join(fakeBin, "launchctl");
  const provider = path.join(root, "secret-provider");
  const launchMarker = path.join(root, "launched");
  const launchLog = path.join(root, "launch.log");
  const serveMarker = path.join(root, "serve-configured");
  const socket = path.join(
    "/tmp",
    `openclaw-ts-${process.pid}-${Math.random().toString(16).slice(2)}.sock`,
  );
  sockets.push(socket);

  writeFile(path.join(stateDir, "tailscaled.state"), "configured\n");
  writeFile(daemon, "#!/bin/sh\nexit 0\n", 0o755);
  writeFile(
    cli,
    [
      "#!/bin/sh",
      "shift 2 # --socket PATH",
      'if [ "${1:-}" = status ]; then',
      `  if [ -f ${JSON.stringify(launchMarker)} ]; then`,
      '    printf \'%s\\n\' \'{"BackendState":"Running","Self":{"Online":true,"DNSName":"primary.example.ts.net."}}\'',
      "    exit 0",
      "  fi",
      '  printf \'%s\\n\' \'{"BackendState":"Stopped","Self":{"Online":false}}\'',
      "  exit 1",
      "fi",
      'if [ "${1:-}" = serve ] && [ "${2:-}" = status ]; then',
      `  [ -f ${JSON.stringify(serveMarker)} ] || exit 1`,
      '  printf \'%s\\n\' \'{"Web":{"primary":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:18789"}}}}}\'',
      "  exit 0",
      "fi",
      'if [ "${1:-}" = serve ] && [ "${2:-}" = --bg ]; then',
      `  : > ${JSON.stringify(serveMarker)}`,
      "  exit 0",
      "fi",
      "exit 2",
      "",
    ].join("\n"),
    0o755,
  );
  writeFile(
    launchctl,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> ${JSON.stringify(launchLog)}`,
      'if [ "${1:-}" = bootstrap ]; then',
      `  : > ${JSON.stringify(launchMarker)}`,
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    0o755,
  );
  writeFile(
    provider,
    '#!/bin/sh\nprintf \'%s\\n\' \'{"values":{"discord/bot-token":"test-only"}}\'\n',
    0o755,
  );

  const env = {
    ...process.env,
    HOME: home,
    OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
    OPENCLAW_SECRET_PROVIDER: provider,
    OPENCLAW_GATEWAY_PORT: "18789",
    OPENCLAW_TAILSCALE_PRIMARY_CLI: cli,
    OPENCLAW_TAILSCALE_PRIMARY_DAEMON: daemon,
    OPENCLAW_TAILSCALE_PRIMARY_EXPECTED_DNS: "PRIMARY.EXAMPLE.TS.NET",
    OPENCLAW_TAILSCALE_PRIMARY_LAUNCHCTL: launchctl,
    OPENCLAW_TAILSCALE_PRIMARY_PLIST: plist,
    OPENCLAW_TAILSCALE_PRIMARY_SOCKET: socket,
    OPENCLAW_TAILSCALE_PRIMARY_STATE_DIR: stateDir,
    OPENCLAW_TAILSCALE_PRIMARY_WAIT_ATTEMPTS: "2",
  };

  return {
    env,
    home,
    launchLog,
    plist,
    root,
    runtimeHome,
    socket,
  };
}

async function listenOnSocket(socket: string): Promise<void> {
  const server = net.createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
}

function run(operation: "guard" | "status", env: NodeJS.ProcessEnv) {
  return spawnSync("sh", [script, operation], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
}

function parsePlist(filePath: string): unknown {
  const result = spawnSync(
    "python3",
    [
      "-c",
      "import json, plistlib, sys; print(json.dumps(plistlib.load(open(sys.argv[1], 'rb')), sort_keys=True))",
      filePath,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as unknown;
}

function writeGatewayPlist(
  filePath: string,
  programArguments: string[],
  workingDirectory: string,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const result = spawnSync(
    "python3",
    [
      "-c",
      "import plistlib, sys; plistlib.dump({'Label': 'test.gateway', 'ProgramArguments': sys.argv[3:], 'WorkingDirectory': sys.argv[2]}, open(sys.argv[1], 'wb'))",
      filePath,
      workingDirectory,
      ...programArguments,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
}

function receipts(runtimeHome: string): Array<Record<string, unknown>> {
  return fs
    .readdirSync(path.join(runtimeHome, "receipts"))
    .filter((name) => name.startsWith("tailscale-primary-"))
    .toSorted()
    .map((name) =>
      JSON.parse(fs.readFileSync(path.join(runtimeHome, "receipts", name), "utf8")),
    ) as Array<Record<string, unknown>>;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  for (const socket of sockets.splice(0)) {
    fs.rmSync(socket, { force: true });
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("custom runtime primary Tailscale continuity guard", () => {
  it("atomically repairs a corrupt LaunchAgent and restores the persistent Serve route", async () => {
    const fixture = createFixture();
    await listenOnSocket(fixture.socket);
    writeFile(fixture.plist, '["/opt/homebrew/bin/tailscaled","--tun=userspace-networking"]\n');

    const first = run("guard", fixture.env);

    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("TAILSCALE_PRIMARY_OK dns=primary.example.ts.net.");
    expect(parsePlist(fixture.plist)).toEqual(
      parsePlist(path.join(fixture.runtimeHome, "tailscale-userspace.desired.plist")),
    );
    const backups = fs.readdirSync(path.join(fixture.runtimeHome, "backups"));
    expect(backups).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(fixture.runtimeHome, "backups", backups[0]!), "utf8"),
    ).toContain("userspace-networking");
    expect(fs.readFileSync(fixture.launchLog, "utf8")).toContain("bootstrap");
    expect(receipts(fixture.runtimeHome)).toEqual([
      expect.objectContaining({
        backend: "Running",
        configRepaired: true,
        dnsName: "primary.example.ts.net.",
        result: "healthy",
        serveConfigured: true,
      }),
    ]);

    const launchLogBefore = fs.readFileSync(fixture.launchLog, "utf8");
    const second = run("guard", fixture.env);

    expect(second.status, second.stderr).toBe(0);
    expect(fs.readFileSync(fixture.launchLog, "utf8")).toBe(launchLogBefore);
    expect(fs.readdirSync(path.join(fixture.runtimeHome, "backups"))).toHaveLength(1);
    expect(receipts(fixture.runtimeHome).at(-1)).toEqual(
      expect.objectContaining({ configRepaired: false, result: "healthy" }),
    );

    const status = run("status", fixture.env);
    expect(status.status, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual({
      configured: true,
      healthy: true,
      plistMatches: true,
      serveConfigured: true,
    });
  });

  it("treats an absent userspace state as intentionally unconfigured", () => {
    const fixture = createFixture();
    fs.rmSync(path.join(fixture.root, "state", "tailscaled.state"));

    const result = run("status", fixture.env);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ configured: false, result: "not_configured" });
    expect(fs.existsSync(fixture.plist)).toBe(false);
  });

  it("fails closed with a redaction-safe receipt when a configured binary is missing", () => {
    const fixture = createFixture();
    fixture.env.OPENCLAW_TAILSCALE_PRIMARY_CLI = path.join(fixture.root, "missing-tailscale");

    const result = run("guard", fixture.env);

    expect(result.status).toBe(1);
    expect(receipts(fixture.runtimeHome)).toEqual([
      expect.objectContaining({
        backend: null,
        configRepaired: false,
        dnsName: null,
        result: "required_binary_missing",
        serveConfigured: false,
      }),
    ]);
  });

  it("does not let a healthy Gateway mask a failed configured primary route", () => {
    const fixture = createFixture();
    const launcher = path.join(fixture.runtimeHome, "bin", "custom-runtime-launcher.sh");
    const primaryGuard = path.join(
      fixture.runtimeHome,
      "bin",
      "custom-runtime-tailscale-primary.sh",
    );
    const fakeBin = path.join(fixture.root, "guard-bin");
    const gatewayPlist = path.join(fixture.root, "gateway.plist");
    const runtimeRoot = path.join(fixture.root, "runtime-release");
    const sourceSha = "a".repeat(40);
    const provenanceRecord = path.join(
      fixture.runtimeHome,
      "source-provenance",
      sourceSha,
      "provenance.json",
    );
    const ownerPid = "424242";
    writeFile(launcher, '#!/bin/sh\n[ "${1:-}" = --verify ]\n', 0o755);
    writeFile(primaryGuard, "#!/bin/sh\nexit 1\n", 0o755);
    writeFile(path.join(fakeBin, "pgrep"), "#!/bin/sh\nexit 0\n", 0o755);
    writeFile(path.join(fakeBin, "lsof"), `#!/bin/sh\nprintf '%s\\n' '${ownerPid}'\n`, 0o755);
    writeFile(
      path.join(fakeBin, "ps"),
      `#!/bin/sh\nprintf '%s\\n' '${runtimeRoot}/dist/index.js gateway --port 18789'\n`,
      0o755,
    );
    writeFile(path.join(runtimeRoot, "dist", "index.js"), "// test runtime\n", 0o600);
    writeFile(provenanceRecord, "{}\n", 0o600);
    fs.chmodSync(fixture.runtimeHome, 0o700);
    fs.chmodSync(path.join(fixture.runtimeHome, "source-provenance"), 0o700);
    writeFile(
      path.join(runtimeRoot, ".openclaw-runtime-provenance.json"),
      `${JSON.stringify({
        recordPath: provenanceRecord,
        recordSha256: createHash("sha256").update("{}\n").digest("hex"),
        schema: "openclaw.custom-runtime-runtime-provenance.v1",
        sourceSha,
        treeSha: "b".repeat(40),
      })}\n`,
      0o600,
    );
    writeFile(
      path.join(fixture.runtimeHome, "active-runtime.json"),
      `${JSON.stringify({ runtimeRoot, sourceSha })}\n`,
    );
    writeGatewayPlist(gatewayPlist, [launcher, "gateway"], runtimeRoot);
    const env = {
      ...process.env,
      HOME: fixture.home,
      OPENCLAW_CUSTOM_RUNTIME_HOME: fixture.runtimeHome,
      OPENCLAW_GATEWAY_PLIST: gatewayPlist,
      OPENCLAW_SECRET_PROVIDER: fixture.env.OPENCLAW_SECRET_PROVIDER,
      OPENCLAW_LSOF_BIN: path.join(fakeBin, "lsof"),
      OPENCLAW_PS_BIN: path.join(fakeBin, "ps"),
      OPENCLAW_PGREP_BIN: path.join(fakeBin, "pgrep"),
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    };

    const failed = spawnSync("sh", [runtimeGuardScript], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
    expect(failed.status, failed.stderr).toBe(1);

    writeFile(primaryGuard, "#!/bin/sh\nexit 0\n", 0o755);
    const healthy = spawnSync("sh", [runtimeGuardScript], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
    expect(healthy.status, healthy.stderr).toBe(0);
  });
});
