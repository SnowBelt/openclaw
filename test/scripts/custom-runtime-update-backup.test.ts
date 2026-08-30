import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  writeFile(
    path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.gateway.plist"),
    "active fixture plist\n",
  );
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
      schema: "openclaw.custom-runtime-update-backup.v1",
      result: "passed",
      sourceSha: value.sourceSha,
      backupVerified: true,
      restoreDrill: { result: "passed" },
      controlPlane: { fileCount: 12 },
    });
    expect(result.externalArchive.path).toContain(`${path.sep}external${path.sep}`);
    expect(result.localArchive.path).toContain(
      `${path.sep}runtime-home${path.sep}data-backups${path.sep}`,
    );
    expect(fs.readFileSync(result.externalArchive.path)).toEqual(
      fs.readFileSync(result.localArchive.path),
    );
    expect(() =>
      verifyReceipt({ receiptPath: result.receiptPath, expectedSha: value.sourceSha }),
    ).not.toThrow();
  });

  it("rejects a changed external recovery copy", async () => {
    const value = fixture();
    const result = await createBackup(value);
    const receipt = JSON.parse(fs.readFileSync(result.receiptPath, "utf8")) as {
      externalArchive: { path: string };
    };
    fs.appendFileSync(receipt.externalArchive.path, "tampered\n");

    expect(() =>
      verifyReceipt({ receiptPath: result.receiptPath, expectedSha: value.sourceSha }),
    ).toThrow(/externalArchive hash changed/u);
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

    expect(result.controlPlane.fileCount).toBe(12);
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
      verifyReceipt({ receiptPath: result.receiptPath, expectedSha: "b".repeat(40) }),
    ).toThrow(/did not pass for the expected active SHA/u);
  });
});
