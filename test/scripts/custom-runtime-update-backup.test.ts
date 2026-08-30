import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureBackup,
  createBackup,
  validateArchiveEntries,
  verifyReceipt,
} from "../../scripts/custom-runtime/custom-runtime-update-backup.mjs";

const roots: string[] = [];

function root(prefix: string): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(value);
  return fs.realpathSync(value);
}

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writeGatewayPlist(
  filePath: string,
  wrapper: string,
  environmentFile: string,
  launcher: string,
): void {
  writeFile(
    filePath,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0"><dict>',
      "<key>Label</key><string>ai.openclaw.gateway</string>",
      `<key>ProgramArguments</key><array><string>${wrapper}</string><string>${environmentFile}</string><string>${launcher}</string><string>gateway</string></array>`,
      "</dict></plist>",
      "",
    ].join("\n"),
  );
}

function fixture(): {
  runtimeHome: string;
  externalRoot: string;
  sourceSha: string;
  homedir: string;
  payload: string;
  allowTestDirectory: true;
} {
  const base = root("openclaw-update-backup-");
  const homedir = path.join(base, "home");
  const runtimeHome = path.join(base, "runtime-home");
  const runtimeRoot = path.join(base, "release");
  const externalRoot = path.join(base, "external");
  const payload = path.join(base, "payload");
  const configFile = path.join(homedir, ".openclaw", "openclaw.director.json");
  const stateDir = path.join(homedir, ".openclaw-director-state");
  const sourceSha = "a".repeat(40);
  fs.mkdirSync(externalRoot, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  writeFile(configFile, "{}\n");
  writeFile(path.join(payload, "manifest.json"), '{"schema":"fixture"}\n');
  const entrypoint = path.join(runtimeRoot, "dist", "index.js");
  writeFile(
    entrypoint,
    `import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const outputIndex = process.argv.indexOf("--output") + 1;
const output = process.argv[outputIndex];
if (process.env.OPENCLAW_CONFIG_PATH !== ${JSON.stringify(configFile)} || process.env.OPENCLAW_STATE_DIR !== ${JSON.stringify(stateDir)}) {
  throw new Error("managed backup environment mismatch");
}
if (process.argv.includes("--dry-run")) {
  process.stdout.write(JSON.stringify({ assets: [{ kind: "state", sourcePath: ${JSON.stringify(payload)} }] }) + "\\n");
  process.exit(0);
}
fs.mkdirSync(output, { recursive: true });
const archivePath = path.join(output, "fixture-openclaw-backup.tar.gz");
execFileSync("tar", ["-czf", archivePath, "-C", ${JSON.stringify(payload)}, "."]);
process.stdout.write(JSON.stringify({ archivePath, verified: true }) + "\\n");
`,
  );
  writeFile(path.join(runtimeRoot, ".openclaw-production-sha"), `${sourceSha}\n`);
  writeFile(path.join(runtimeRoot, ".openclaw-runtime-provenance.json"), "{}\n");
  writeFile(path.join(runtimeRoot, "snapshot.json"), "{}\n");
  writeFile(path.join(runtimeRoot, "config", "custom-runtime-capabilities.json"), "{}\n");
  const provenanceRoot = path.join(runtimeHome, "source-provenance", sourceSha);
  const recordPath = path.join(provenanceRoot, "provenance.json");
  const bundlePath = path.join(provenanceRoot, "source.bundle");
  writeFile(recordPath, '{"schema":"fixture"}\n');
  writeFile(bundlePath, "fixture bundle\n");
  writeFile(path.join(runtimeHome, "active-rollback.json"), '{"rollbackReleaseId":"old"}\n');
  writeFile(path.join(runtimeHome, "last-known-good.json"), '{"releaseId":"old"}\n');
  writeFile(path.join(runtimeHome, "ai.openclaw.gateway.desired.plist"), "fixture plist\n");
  const launcher = path.join(runtimeHome, "bin", "custom-runtime-launcher.sh");
  const gatewayEnvWrapper = path.join(
    stateDir,
    "service-env",
    "ai.openclaw.gateway-env-wrapper.sh",
  );
  const gatewayEnvFile = path.join(stateDir, "service-env", "ai.openclaw.gateway.env");
  const gatewayPlist = path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.gateway.plist");
  writeFile(launcher, "#!/bin/sh\n");
  writeFile(gatewayEnvWrapper, "#!/bin/sh\n");
  writeFile(gatewayEnvFile, "export OPENCLAW_STATE_DIR=/fixture\n");
  writeGatewayPlist(gatewayPlist, gatewayEnvWrapper, gatewayEnvFile, launcher);
  writeFile(
    path.join(runtimeHome, "update-safety.json"),
    `${JSON.stringify({
      schema: "openclaw.custom-runtime-update-safety-config.v1",
      backupRoot: externalRoot,
    })}\n`,
  );
  writeFile(
    path.join(runtimeHome, "active-runtime.json"),
    `${JSON.stringify({
      releaseId: "release",
      previousRelease: "old",
      runtimeRoot,
      entrypoint,
      sourceSha,
      sourceProvenance: { recordPath, bundlePath },
    })}\n`,
  );
  return { runtimeHome, externalRoot, sourceSha, homedir, payload, allowTestDirectory: true };
}

afterEach(() => {
  for (const directory of roots.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("custom runtime update backup", () => {
  it("persists a verified one-time external backup destination", () => {
    const value = fixture();
    fs.rmSync(path.join(value.runtimeHome, "update-safety.json"));

    const result = configureBackup(value);

    expect(result).toEqual({
      result: "configured",
      configPath: path.join(value.runtimeHome, "update-safety.json"),
      backupRoot: value.externalRoot,
    });
    expect(JSON.parse(fs.readFileSync(result.configPath, "utf8"))).toEqual({
      schema: "openclaw.custom-runtime-update-safety-config.v1",
      backupRoot: value.externalRoot,
    });
  });

  it("creates matching local and external recovery points and verifies the receipt", async () => {
    const value = fixture();
    const result = await createBackup({ ...value, externalRoot: "" });

    expect(result).toMatchObject({
      schema: "openclaw.custom-runtime-update-backup.v2",
      result: "passed",
      sourceSha: value.sourceSha,
      backupVerified: true,
      restoreDrill: { result: "passed" },
      controlPlane: { fileCount: 15 },
    });
    expect(result.externalArchive.path).toContain(`${path.sep}external${path.sep}`);
    expect(result.localArchive.path).toContain(
      `${path.sep}runtime-home${path.sep}data-backups${path.sep}`,
    );
    expect(fs.readFileSync(result.externalArchive.path)).toEqual(
      fs.readFileSync(result.localArchive.path),
    );
    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        runtimeHome: value.runtimeHome,
        allowTestDirectory: true,
      }),
    ).not.toThrow();
  });

  it("allocates exclusive recovery points when timestamps collide", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
    const value = fixture();

    try {
      const first = await createBackup(value);
      const second = await createBackup(value);

      expect(second.receiptPath).not.toBe(first.receiptPath);
      expect(second.externalArchive.path).not.toBe(first.externalArchive.path);
      expect(second.localArchive.path).not.toBe(first.localArchive.path);
      expect(fs.existsSync(first.externalArchive.path)).toBe(true);
      expect(fs.existsSync(first.localArchive.path)).toBe(true);
      expect(() =>
        verifyReceipt({
          receiptPath: first.receiptPath,
          expectedSha: value.sourceSha,
          runtimeHome: value.runtimeHome,
          allowTestDirectory: true,
        }),
      ).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a changed external recovery copy", async () => {
    const value = fixture();
    const result = await createBackup(value);
    const receipt = JSON.parse(fs.readFileSync(result.receiptPath, "utf8")) as {
      externalArchive: { path: string };
    };
    fs.appendFileSync(receipt.externalArchive.path, "tampered\n");

    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        runtimeHome: value.runtimeHome,
        allowTestDirectory: true,
      }),
    ).toThrow(/externalArchive hash changed/u);
  });

  it("rejects a replacement volume mounted at the configured path", async () => {
    const value = fixture();
    const result = await createBackup(value);
    const originalRoot = `${value.externalRoot}-original`;
    fs.renameSync(value.externalRoot, originalRoot);
    fs.mkdirSync(value.externalRoot);
    fs.cpSync(originalRoot, value.externalRoot, { recursive: true });

    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        runtimeHome: value.runtimeHome,
        allowTestDirectory: true,
      }),
    ).toThrow(/external backup volume identity changed/u);
  });

  it("rejects symlinked external backup destination components", () => {
    const value = fixture();
    const escaped = path.join(path.dirname(value.externalRoot), "escaped-backups");
    fs.mkdirSync(escaped);
    fs.symlinkSync(escaped, path.join(value.externalRoot, "OpenClaw"));

    expect(() => createBackup(value)).toThrow(
      /backup destination component is not a regular directory: OpenClaw/u,
    );
    expect(fs.readdirSync(escaped)).toEqual([]);
  });

  it("preserves a configured non-default Gateway LaunchAgent", async () => {
    const value = fixture();
    const defaultPlist = path.join(
      value.homedir,
      "Library",
      "LaunchAgents",
      "ai.openclaw.gateway.plist",
    );
    const gatewayPlist = path.join(value.homedir, "custom", "gateway.plist");
    fs.mkdirSync(path.dirname(gatewayPlist), { recursive: true });
    fs.renameSync(defaultPlist, gatewayPlist);

    const result = await createBackup({ ...value, gatewayPlist });

    expect(result.controlPlane.fileCount).toBe(15);
  });

  it("preserves a configured non-default Gateway environment wrapper", async () => {
    const value = fixture();
    const defaultWrapper = path.join(
      value.homedir,
      ".openclaw-director-state",
      "service-env",
      "ai.openclaw.gateway-env-wrapper.sh",
    );
    const gatewayEnvWrapper = path.join(value.homedir, "custom", "gateway-env-wrapper.sh");
    fs.mkdirSync(path.dirname(gatewayEnvWrapper), { recursive: true });
    fs.renameSync(defaultWrapper, gatewayEnvWrapper);
    writeGatewayPlist(
      path.join(value.homedir, "Library", "LaunchAgents", "ai.openclaw.gateway.plist"),
      gatewayEnvWrapper,
      path.join(
        value.homedir,
        ".openclaw-director-state",
        "service-env",
        "ai.openclaw.gateway.env",
      ),
      path.join(value.runtimeHome, "bin", "custom-runtime-launcher.sh"),
    );

    const result = await createBackup({ ...value, gatewayEnvWrapper });

    expect(result.controlPlane.fileCount).toBe(15);
  });

  it("requires the Gateway LaunchAgent to execute the active runtime launcher", () => {
    const value = fixture();
    const alternateLauncher = path.join(value.homedir, "custom", "custom-runtime-launcher.sh");
    fs.mkdirSync(path.dirname(alternateLauncher), { recursive: true });
    writeFile(alternateLauncher, "#!/bin/sh\n");
    writeGatewayPlist(
      path.join(value.homedir, "Library", "LaunchAgents", "ai.openclaw.gateway.plist"),
      path.join(
        value.homedir,
        ".openclaw-director-state",
        "service-env",
        "ai.openclaw.gateway-env-wrapper.sh",
      ),
      path.join(
        value.homedir,
        ".openclaw-director-state",
        "service-env",
        "ai.openclaw.gateway.env",
      ),
      alternateLauncher,
    );

    expect(() => createBackup(value)).toThrow(
      /managed Gateway LaunchAgent environment contract is invalid/u,
    );
  });

  it("rejects an incomplete control-plane recovery bundle", async () => {
    const value = fixture();
    const pointer = JSON.parse(
      fs.readFileSync(path.join(value.runtimeHome, "active-runtime.json"), "utf8"),
    ) as { runtimeRoot: string };
    fs.rmSync(path.join(pointer.runtimeRoot, "snapshot.json"));

    expect(() => createBackup(value)).toThrow(
      /required control-plane recovery file is unavailable: snapshot\.json/u,
    );
  });

  it("requires the active launcher and Gateway environment wrapper", () => {
    const value = fixture();
    fs.rmSync(path.join(value.runtimeHome, "bin", "custom-runtime-launcher.sh"));

    expect(() => createBackup(value)).toThrow(/active custom runtime launcher is missing/u);
  });

  it("rejects archive entries that could escape the isolated restore root", () => {
    expect(() => validateArchiveEntries(["manifest.json", "../outside.json"])).toThrow(
      /archive contains an unsafe path/u,
    );
    expect(() => validateArchiveEntries(["/absolute/outside.json"])).toThrow(
      /archive contains an unsafe path/u,
    );
  });

  it("rejects preparation before the encrypted backup destination is configured", async () => {
    const value = fixture();
    fs.rmSync(path.join(value.runtimeHome, "update-safety.json"));

    expect(() => createBackup({ ...value, externalRoot: "" })).toThrow(
      /update safety configuration is missing or malformed/u,
    );
  });

  it("reuses an explicitly configured backup root during receipt verification", async () => {
    const value = fixture();
    const result = await createBackup({ ...value, externalRoot: value.externalRoot });
    fs.rmSync(path.join(value.runtimeHome, "update-safety.json"));

    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        runtimeHome: value.runtimeHome,
        externalRoot: value.externalRoot,
        allowTestDirectory: true,
      }),
    ).not.toThrow();
  });

  it("counts an external canonical SQLite symlink target before writing the archive", () => {
    const value = fixture();
    const externalDatabase = path.join(path.dirname(value.payload), "external-state.sqlite");
    writeFile(externalDatabase, "");
    fs.truncateSync(externalDatabase, 1024 ** 4);
    const canonicalDatabase = path.join(value.payload, "state", "openclaw.sqlite");
    fs.mkdirSync(path.dirname(canonicalDatabase), { recursive: true });
    fs.symlinkSync(externalDatabase, canonicalDatabase);

    expect(() => createBackup(value)).toThrow(/external backup volume.*enough free space/u);
  });

  it("rejects a receipt bound to another active source SHA", async () => {
    const value = fixture();
    const result = await createBackup(value);

    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: "b".repeat(40),
        runtimeHome: value.runtimeHome,
        allowTestDirectory: true,
      }),
    ).toThrow(/did not pass for the expected active SHA/u);
  });
});
