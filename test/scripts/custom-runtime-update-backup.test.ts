import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureBackup,
  createBackup,
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
  payload: string;
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
  writeFile(
    path.join(runtimeRoot, "snapshot.json"),
    '{"gateway":{"auth":{"token":"fixture-secret-token"}},"environment":["OPENCLAW_GATEWAY_TOKEN=fixture-secret-token"]}\n',
  );
  writeFile(path.join(runtimeRoot, "config", "custom-runtime-capabilities.json"), "{}\n");
  const provenanceRoot = path.join(runtimeHome, "source-provenance", sourceSha);
  const recordPath = path.join(provenanceRoot, "provenance.json");
  const bundlePath = path.join(provenanceRoot, "source.bundle");
  writeFile(recordPath, '{"schema":"fixture"}\n');
  writeFile(bundlePath, "fixture bundle\n");
  writeFile(path.join(runtimeHome, "active-rollback.json"), '{"rollbackReleaseId":"old"}\n');
  writeFile(path.join(runtimeHome, "last-known-good.json"), '{"releaseId":"old"}\n');
  writeFile(
    path.join(runtimeHome, "ai.openclaw.gateway.desired.plist"),
    "<key>OPENCLAW_GATEWAY_TOKEN</key><string>fixture-secret-token</string>\n",
  );
  writeFile(
    path.join(homedir, "Library", "LaunchAgents", "ai.openclaw.gateway.plist"),
    "<key>OPENCLAW_GATEWAY_TOKEN</key><string>fixture-secret-token</string>\n",
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
  return { runtimeHome, externalRoot, payload, sourceSha, homedir, allowTestDirectory: true };
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

  it("creates matching local and external recovery points and verifies the receipt", () => {
    const value = fixture();
    const result = createBackup({ ...value, externalRoot: "" });

    expect(result).toMatchObject({
      schema: "openclaw.custom-runtime-update-backup.v1",
      result: "passed",
      sourceSha: value.sourceSha,
      backupVerified: true,
      restoreDrill: { result: "passed" },
      controlPlane: { fileCount: 12 },
    });
    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        allowTestDirectory: true,
      }),
    ).not.toThrow();
  });

  it("does not copy credential-bearing control-plane content into the recovery bundle", () => {
    const value = fixture();
    const result = createBackup(value);
    const receipt = result.controlPlane as { path: string };
    const entries = execFileSync("tar", ["-tzf", receipt.path], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((entry) => entry && entry !== "./" && !entry.endsWith("manifest.json"));
    const contents = entries
      .map((entry) => execFileSync("tar", ["-xOf", receipt.path, entry], { encoding: "utf8" }))
      .join("\n");

    expect(contents).not.toContain("fixture-secret-token");
    expect(contents).toContain("openclaw.custom-runtime-redacted-control-plane-file.v1");
    expect(contents).toContain("redacted");
  });

  it("preserves the exact source provenance bundle for disaster recovery", () => {
    const value = fixture();
    const result = createBackup(value);
    const controlPlane = result.controlPlane as { path: string };
    const sourceBundleEntry = execFileSync("tar", ["-tzf", controlPlane.path], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .find((entry) => entry.endsWith("-source.bundle"));

    expect(sourceBundleEntry).toBeDefined();
    expect(
      execFileSync("tar", ["-xOf", controlPlane.path, sourceBundleEntry!], {
        encoding: "utf8",
      }),
    ).toBe("fixture bundle\n");
  });

  it("rejects a changed external recovery copy", () => {
    const value = fixture();
    const result = createBackup(value);
    const receipt = JSON.parse(fs.readFileSync(result.receiptPath, "utf8")) as {
      externalArchive: { path: string };
    };
    fs.appendFileSync(receipt.externalArchive.path, "tampered\n");

    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        allowTestDirectory: true,
      }),
    ).toThrow(/externalArchive hash changed/u);
  });

  it("does not execute an entrypoint outside the active runtime", () => {
    const value = fixture();
    const pointerPath = path.join(value.runtimeHome, "active-runtime.json");
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as {
      entrypoint: string;
    };
    pointer.entrypoint = path.join(value.runtimeHome, "unexpected-entrypoint.js");
    writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);
    expect(() => createBackup(value)).toThrow(
      /active runtime entrypoint is not the managed runtime entrypoint/u,
    );
  });

  it("rejects symlinked recovery bindings", () => {
    const value = fixture();
    const result = createBackup(value);
    const receipt = JSON.parse(fs.readFileSync(result.receiptPath, "utf8")) as {
      externalArchive: { path: string };
    };
    const original = receipt.externalArchive.path;
    fs.rmSync(original);
    fs.symlinkSync(result.localArchive.path, original);

    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        allowTestDirectory: true,
      }),
    ).toThrow(/externalArchive is not a regular file/u);
  });

  it("rejects a backup archive link that escapes the restore drill", () => {
    if (process.platform === "win32") {
      return;
    }
    const value = fixture();
    const outside = path.join(path.dirname(value.payload), "outside.txt");
    writeFile(outside, "outside\n");
    fs.symlinkSync(outside, path.join(value.payload, "escape.txt"));

    expect(() => createBackup(value)).toThrow(
      /backup archive link target escapes the restore directory/u,
    );
  });

  it("rejects an incomplete control-plane recovery bundle", () => {
    const value = fixture();
    const pointer = JSON.parse(
      fs.readFileSync(path.join(value.runtimeHome, "active-runtime.json"), "utf8"),
    ) as { runtimeRoot: string };
    fs.rmSync(path.join(pointer.runtimeRoot, "snapshot.json"));

    expect(() => createBackup(value)).toThrow(
      /required control-plane recovery file is unavailable: snapshot\.json/u,
    );
    const backupRoot = path.join(value.externalRoot, "OpenClaw", "verified-updates");
    expect(fs.existsSync(backupRoot)).toBe(true);
    expect(fs.readdirSync(backupRoot).filter((name) => name.startsWith(".")).length).toBe(0);
  });

  it("rejects preparation before the encrypted backup destination is configured", () => {
    const value = fixture();
    fs.rmSync(path.join(value.runtimeHome, "update-safety.json"));

    expect(() => createBackup({ ...value, externalRoot: "" })).toThrow(
      /update safety configuration is missing or malformed/u,
    );
  });

  it("rejects a receipt bound to another active source SHA", () => {
    const value = fixture();
    const result = createBackup(value);

    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: "b".repeat(40),
        allowTestDirectory: true,
      }),
    ).toThrow(/did not pass for the expected active SHA/u);
  });

  it("rejects a backup destination override that differs from canonical configuration", () => {
    const value = fixture();
    const conflictingRoot = path.join(value.runtimeHome, "other-backup");
    fs.mkdirSync(conflictingRoot);

    expect(() => createBackup({ ...value, externalRoot: conflictingRoot })).toThrow(
      /explicit backup destination conflicts with canonical configuration/u,
    );
  });
});
