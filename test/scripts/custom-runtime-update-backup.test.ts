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
  allowTestDirectory: true;
} {
  const base = root("openclaw-update-backup-");
  const homedir = path.join(base, "home");
  const runtimeHome = path.join(base, "runtime-home");
  const runtimeRoot = path.join(base, "release");
  const externalRoot = path.join(base, "external");
  const payload = path.join(base, "payload");
  const sourceSha = "a".repeat(40);
  fs.mkdirSync(externalRoot, { recursive: true });
  writeFile(path.join(payload, "manifest.json"), '{"schema":"fixture"}\n');
  const entrypoint = path.join(runtimeRoot, "dist", "index.js");
  writeFile(
    entrypoint,
    `import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const outputIndex = process.argv.indexOf("--output") + 1;
const output = process.argv[outputIndex];
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
  return { runtimeHome, externalRoot, sourceSha, homedir, allowTestDirectory: true };
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

  it("rejects a receipt bound to another active source SHA", async () => {
    const value = fixture();
    const result = await createBackup(value);

    expect(() =>
      verifyReceipt({ receiptPath: result.receiptPath, expectedSha: "b".repeat(40) }),
    ).toThrow(/did not pass for the expected active SHA/u);
  });
});
