import { spawnSync } from "node:child_process";
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
import {
  hashBuildArtifactTree,
  hashRuntimeClosure,
  listRuntimeClosurePaths,
} from "../../scripts/custom-runtime/runtime-package-integrity.mjs";

const roots: string[] = [];

function root(prefix: string): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(value);
  return fs.realpathSync(value);
}

function writeFile(filePath: string, contents = `${filePath}\n`): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function makeReadOnlyTree(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      makeReadOnlyTree(entryPath);
      fs.chmodSync(entryPath, 0o500);
    } else {
      fs.chmodSync(
        entryPath,
        entry.name.endsWith(".sh") || entry.name === "index.js" ? 0o500 : 0o400,
      );
    }
  }
  fs.chmodSync(directory, 0o500);
}

function makeWritableTree(directory: string): void {
  fs.chmodSync(directory, 0o700);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      makeWritableTree(entryPath);
    } else {
      fs.chmodSync(entryPath, 0o600);
    }
  }
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
  runtimeRoot: string;
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
  return {
    runtimeHome,
    runtimeRoot,
    externalRoot,
    sourceSha,
    homedir,
    payload,
    allowTestDirectory: true,
  };
}

function bootstrapFixture(): ReturnType<typeof fixture> & {
  releasesRoot: string;
  bootstrapEntrypoint: string;
  bootstrapSourceSha: string;
  candidateVerifierMarker: string;
} {
  const value = fixture();
  const releasesRoot = path.join(value.homedir, ".openclaw-runtime-releases");
  const bootstrapRoot = path.join(releasesRoot, "candidate");
  const bootstrapEntrypoint = path.join(bootstrapRoot, "dist", "index.js");
  const bootstrapSourceSha = "b".repeat(40);
  const candidateVerifierMarker = path.join(value.homedir, "candidate-verifier-ran");
  fs.mkdirSync(path.dirname(bootstrapEntrypoint), { recursive: true });
  fs.copyFileSync(path.join(value.runtimeRoot, "dist", "index.js"), bootstrapEntrypoint);
  writeFile(path.join(bootstrapRoot, ".openclaw-production-sha"), `${bootstrapSourceSha}\n`);
  writeFile(path.join(bootstrapRoot, "dist", "entry.js"));
  writeFile(path.join(bootstrapRoot, "dist", "control-ui", "index.html"));
  writeFile(path.join(bootstrapRoot, "dist-runtime", "extensions", "research-manager", "index.js"));
  writeFile(path.join(bootstrapRoot, "package.json"), '{"name":"openclaw","type":"module"}\n');
  writeFile(path.join(bootstrapRoot, "config", "release-governor-policy.json"), "{}\n");
  writeFile(path.join(bootstrapRoot, "src", "pcc", "capability-addition-registry.ts"));
  writeFile(
    path.join(bootstrapRoot, "config", "custom-runtime-capabilities.json"),
    `${JSON.stringify({
      preservation: { standardsRegistry: "src/pcc/capability-addition-registry.ts" },
      capabilities: [
        {
          id: "plugin:research-manager",
          requiredPaths: [
            "extensions/research-manager/index.ts",
            "extensions/research-manager/openclaw.plugin.json",
            "extensions/research-manager/package.json",
            "extensions/research-manager/src/tool-descriptor.ts",
          ],
        },
      ],
    })}\n`,
  );
  writeFile(path.join(bootstrapRoot, "extensions", "research-manager", "index.ts"));
  writeFile(
    path.join(bootstrapRoot, "extensions", "research-manager", "openclaw.plugin.json"),
    "{}\n",
  );
  writeFile(
    path.join(bootstrapRoot, "extensions", "research-manager", "package.json"),
    '{"dependencies":{}}\n',
  );
  writeFile(
    path.join(bootstrapRoot, "extensions", "research-manager", "src", "tool-descriptor.ts"),
  );
  writeFile(
    path.join(bootstrapRoot, "scripts", "custom-runtime", "custom-runtime-seal.sh"),
    `#!/bin/sh\ntouch ${candidateVerifierMarker}\nexit 97\n`,
  );
  fs.mkdirSync(path.join(value.runtimeRoot, "scripts", "custom-runtime"), { recursive: true });
  fs.copyFileSync(
    path.resolve("scripts/custom-runtime/runtime-package-integrity.mjs"),
    path.join(value.runtimeRoot, "scripts", "custom-runtime", "runtime-package-integrity.mjs"),
  );
  makeReadOnlyTree(bootstrapRoot);
  const runtimeClosurePaths = listRuntimeClosurePaths(bootstrapRoot);
  const runtimeClosureHash = hashRuntimeClosure(bootstrapRoot, runtimeClosurePaths);
  makeWritableTree(bootstrapRoot);
  writeFile(
    path.join(bootstrapRoot, "snapshot.json"),
    `${JSON.stringify({
      version: 2,
      releaseId: "candidate",
      root: bootstrapRoot,
      artifactHash: hashBuildArtifactTree(bootstrapRoot),
      runtimeClosureVersion: 1,
      runtimeClosurePaths,
      runtimeClosureHash,
      source: { commit: bootstrapSourceSha },
    })}\n`,
  );
  writeFile(
    path.join(bootstrapRoot, ".openclaw-runtime-sealed"),
    `${bootstrapSourceSha} ${runtimeClosureHash}\n`,
  );
  makeReadOnlyTree(bootstrapRoot);
  return {
    ...value,
    releasesRoot,
    bootstrapEntrypoint,
    bootstrapSourceSha,
    candidateVerifierMarker,
  };
}

afterEach(() => {
  for (const directory of roots.splice(0)) {
    makeWritableTree(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("custom runtime update backup", () => {
  it("starts from the installed control-plane directory without colocated dependencies", () => {
    const base = root("openclaw-update-backup-installed-");
    const runtimeHome = path.join(base, "runtime-home");
    const installed = path.join(runtimeHome, "bin", "custom-runtime-update-backup.mjs");
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    fs.copyFileSync(
      path.resolve("scripts/custom-runtime/custom-runtime-update-backup.mjs"),
      installed,
    );

    const result = spawnSync(process.execPath, [installed], {
      cwd: base,
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: "" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("command must be configure, create, or verify");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("loads tar from the active immutable runtime when installed", () => {
    const value = fixture();
    const installed = path.join(value.runtimeHome, "bin", "custom-runtime-update-backup.mjs");
    fs.copyFileSync(
      path.resolve("scripts/custom-runtime/custom-runtime-update-backup.mjs"),
      installed,
    );
    writeFile(path.join(value.runtimeRoot, "package.json"), '{"type":"module"}\n');
    writeFile(
      path.join(value.runtimeRoot, "node_modules", "tar", "package.json"),
      '{"main":"index.cjs"}\n',
    );
    writeFile(
      path.join(value.runtimeRoot, "node_modules", "tar", "index.cjs"),
      [
        'const { execFileSync } = require("node:child_process");',
        "exports.t = ({ file, onReadEntry }) => {",
        '  const output = execFileSync("tar", ["-tzf", file], { encoding: "utf8" });',
        '  for (const entry of output.split("\\n").filter(Boolean)) onReadEntry({ path: entry });',
        "};",
        "exports.x = ({ file, cwd }) => {",
        '  execFileSync("tar", ["-xzf", file, "-C", cwd]);',
        "};",
        "",
      ].join("\n"),
    );
    const options = JSON.stringify({
      runtimeHome: value.runtimeHome,
      externalRoot: value.externalRoot,
      homedir: value.homedir,
      allowTestDirectory: true,
    });
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const module = await import(process.argv[1]); const value = await module.createBackup(JSON.parse(process.argv[2])); process.stdout.write(JSON.stringify(value));",
        `file://${installed}`,
        options,
      ],
      {
        cwd: path.dirname(value.runtimeHome),
        encoding: "utf8",
        env: { ...process.env, NODE_PATH: "" },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      result: "passed",
      backupVerified: true,
      restoreDrill: { result: "passed" },
    });
  });

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

  it("uses a sealed candidate entrypoint for bootstrap backup while binding the receipt to the active SHA", async () => {
    const value = bootstrapFixture();
    const result = await createBackup({
      ...value,
      externalRoot: "",
      releasesRoot: value.releasesRoot,
      bootstrapEntrypoint: value.bootstrapEntrypoint,
      bootstrapSourceSha: value.bootstrapSourceSha,
    });

    expect(result).toMatchObject({
      sourceSha: value.sourceSha,
      backupRuntime: {
        entrypoint: value.bootstrapEntrypoint,
        releaseRoot: path.dirname(path.dirname(value.bootstrapEntrypoint)),
        sourceSha: value.bootstrapSourceSha,
      },
    });
    expect(fs.existsSync(value.candidateVerifierMarker)).toBe(false);
    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        runtimeHome: value.runtimeHome,
        homedir: value.homedir,
        releasesRoot: value.releasesRoot,
        allowTestDirectory: true,
      }),
    ).not.toThrow();
  });

  it("requires both bootstrap identity arguments", () => {
    const value = fixture();

    expect(() =>
      createBackup({
        ...value,
        bootstrapEntrypoint: value.runtimeRoot,
      }),
    ).toThrow(/bootstrap runtime entrypoint and source SHA must be provided together/u);
  });

  it("rejects a bootstrap entrypoint outside the immutable releases root", () => {
    const value = fixture();

    expect(() =>
      createBackup({
        ...value,
        releasesRoot: value.homedir,
        bootstrapEntrypoint: path.join(value.runtimeRoot, "dist", "index.js"),
        bootstrapSourceSha: value.sourceSha,
      }),
    ).toThrow(/bootstrap runtime is outside the immutable releases root/u);
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
