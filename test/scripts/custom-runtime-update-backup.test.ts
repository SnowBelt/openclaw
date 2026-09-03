import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSealedCandidate } from "../../scripts/custom-runtime/candidate-registry.mjs";
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

function registerCandidate(candidateRoot: string, sourceSha: string): void {
  const runtimeClosureSha256 = "b".repeat(64);
  writeFile(path.join(candidateRoot, ".openclaw-production-sha"), `${sourceSha}\n`);
  writeFile(
    path.join(candidateRoot, ".openclaw-runtime-sealed"),
    `${sourceSha} ${runtimeClosureSha256}\n`,
  );
  writeFile(path.join(candidateRoot, "config", "custom-runtime-capabilities.json"), "{}\n");
  writeFile(
    path.join(candidateRoot, "snapshot.json"),
    `${JSON.stringify({
      releaseId: path.basename(candidateRoot),
      root: candidateRoot,
      source: { commit: sourceSha },
      artifactHash: "a".repeat(64),
      runtimeClosureHash: runtimeClosureSha256,
    })}\n`,
  );
  registerSealedCandidate({
    registryPath: path.join(path.dirname(candidateRoot), ".candidate-registry.json"),
    releaseRoot: candidateRoot,
  });
}

function fixture(): {
  runtimeHome: string;
  runtimeRoot: string;
  externalRoot: string;
  payload: string;
  sourceSha: string;
  sourceBundlePath: string;
  homedir: string;
  allowTestDirectory: true;
} {
  const base = root("openclaw-update-backup-");
  const homedir = path.join(base, "home");
  const runtimeHome = path.join(base, "runtime-home");
  const runtimeRoot = path.join(base, "release");
  const externalRoot = path.join(base, "external");
  const payload = path.join(base, "payload");
  const sourceRoot = path.join(base, "source");
  fs.mkdirSync(externalRoot, { recursive: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  const runGit = (args: string[]): string =>
    execFileSync("git", args, {
      cwd: sourceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: "backup-fixture@localhost",
        GIT_AUTHOR_NAME: "OpenClaw Backup Fixture",
        GIT_COMMITTER_EMAIL: "backup-fixture@localhost",
        GIT_COMMITTER_NAME: "OpenClaw Backup Fixture",
      },
    }).trim();
  runGit(["init", "-q"]);
  runGit(["config", "user.email", "backup-fixture@localhost"]);
  runGit(["config", "user.name", "OpenClaw Backup Fixture"]);
  writeFile(path.join(sourceRoot, "README.md"), "fixture source\n");
  runGit(["add", "."]);
  runGit(["commit", "-qm", "fixture source"]);
  const sourceSha = runGit(["rev-parse", "HEAD"]);
  const treeSha = runGit(["rev-parse", `${sourceSha}^{tree}`]);
  const objectFormat = runGit(["rev-parse", "--show-object-format"]);
  runGit(["update-ref", `refs/provenance/${sourceSha}`, sourceSha]);
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
  const sealVerifier = path.join(
    runtimeRoot,
    "scripts",
    "custom-runtime",
    "custom-runtime-seal.sh",
  );
  writeFile(sealVerifier, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(sealVerifier, 0o700);
  writeFile(path.join(runtimeRoot, ".openclaw-runtime-provenance.json"), "{}\n");
  writeFile(
    path.join(runtimeRoot, "snapshot.json"),
    '{"gateway":{"auth":{"token":"fixture-secret-token"}},"environment":["OPENCLAW_GATEWAY_TOKEN=fixture-secret-token"]}\n',
  );
  writeFile(path.join(runtimeRoot, "config", "custom-runtime-capabilities.json"), "{}\n");
  const provenanceRoot = path.join(runtimeHome, "source-provenance", sourceSha);
  fs.mkdirSync(provenanceRoot, { recursive: true });
  const recordPath = path.join(provenanceRoot, "provenance.json");
  const bundlePath = path.join(provenanceRoot, "source.bundle");
  runGit(["bundle", "create", bundlePath, `refs/provenance/${sourceSha}`]);
  fs.chmodSync(bundlePath, 0o600);
  writeFile(
    recordPath,
    `${JSON.stringify({
      schema: "openclaw.custom-runtime-source-provenance.v1",
      version: 1,
      sourceSha,
      treeSha,
      objectFormat,
      storePath: path.join(sourceRoot, ".git"),
      recordPath,
      bundlePath,
      bundleSha256: createHash("sha256").update(fs.readFileSync(bundlePath)).digest("hex"),
    })}\n`,
  );
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
      schema: "openclaw.custom-runtime-update-safety-config.v2",
      mode: "external_encrypted",
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
    payload,
    sourceSha,
    sourceBundlePath: bundlePath,
    homedir,
    allowTestDirectory: true,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of roots.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("custom runtime update backup", () => {
  it("persists a verified one-time external backup destination", () => {
    const value = fixture();
    fs.rmSync(path.join(value.runtimeHome, "update-safety.json"));

    const result = configureBackup({ ...value, mode: "external_encrypted" });

    expect(result).toEqual({
      result: "configured",
      configPath: path.join(value.runtimeHome, "update-safety.json"),
      mode: "external_encrypted",
      backupRoot: value.externalRoot,
    });
    expect(JSON.parse(fs.readFileSync(result.configPath, "utf8"))).toEqual({
      schema: "openclaw.custom-runtime-update-safety-config.v2",
      mode: "external_encrypted",
      backupRoot: value.externalRoot,
    });
  });

  it("fails before backup creation when local free space is insufficient", () => {
    const value = fixture();
    configureBackup({ runtimeHome: value.runtimeHome, mode: "local_verified" });
    const actual = fs.statfsSync(value.runtimeHome);
    actual.bavail = 1;
    vi.spyOn(fs, "statfsSync").mockReturnValue(actual);

    expect(() =>
      createBackup({
        runtimeHome: value.runtimeHome,
        homedir: value.homedir,
        allowTestDirectory: true,
      }),
    ).toThrow(/does not have enough free space/u);
    const receiptsRoot = path.join(value.runtimeHome, "receipts");
    const receipts = fs.existsSync(receiptsRoot) ? fs.readdirSync(receiptsRoot) : [];
    expect(receipts.some((name) => name.startsWith("update-backup-"))).toBe(false);
  });

  it("creates and verifies local recovery without requiring external storage", () => {
    const value = fixture();
    const configured = configureBackup({
      runtimeHome: value.runtimeHome,
      mode: "local_verified",
    });

    expect(configured).toEqual({
      result: "configured",
      configPath: path.join(value.runtimeHome, "update-safety.json"),
      mode: "local_verified",
    });
    const result = createBackup({
      runtimeHome: value.runtimeHome,
      homedir: value.homedir,
      allowTestDirectory: true,
    });
    expect(result).toMatchObject({
      schema: "openclaw.custom-runtime-update-backup.v2",
      mode: "local_verified",
      releaseId: "release",
      result: "passed",
      backupVerified: true,
      restoreDrill: { result: "passed" },
    });
    expect(result).not.toHaveProperty("externalArchive");
    expect(result).not.toHaveProperty("externalControlPlane");
    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        runtimeHome: value.runtimeHome,
        allowTestDirectory: true,
      }),
    ).not.toThrow();
  });

  it("streams archive hashing instead of reading the complete backup into memory", () => {
    const value = fixture();
    configureBackup({ runtimeHome: value.runtimeHome, mode: "local_verified" });
    const originalReadFileSync = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((
      filePath: fs.PathOrFileDescriptor,
      ...args: unknown[]
    ) => {
      if (String(filePath).endsWith("fixture-openclaw-backup.tar.gz")) {
        throw new Error("backup archive must not be hashed with readFileSync");
      }
      return Reflect.apply(originalReadFileSync, fs, [filePath, ...args]);
    }) as typeof fs.readFileSync);

    expect(() =>
      createBackup({
        runtimeHome: value.runtimeHome,
        homedir: value.homedir,
        allowTestDirectory: true,
      }),
    ).not.toThrow();
  });

  it("uses a separately sealed candidate when the active backup command is broken", () => {
    const value = fixture();
    configureBackup({ runtimeHome: value.runtimeHome, mode: "local_verified" });
    const candidateSha = "a".repeat(40);
    const candidateRoot = path.join(path.dirname(value.runtimeRoot), "candidate-release");
    const activeEntrypoint = path.join(value.runtimeRoot, "dist", "index.js");
    writeFile(
      path.join(candidateRoot, "dist", "index.js"),
      fs.readFileSync(activeEntrypoint, "utf8"),
    );
    registerCandidate(candidateRoot, candidateSha);

    const result = createBackup({
      runtimeHome: value.runtimeHome,
      backupRelease: candidateRoot,
      homedir: value.homedir,
      allowTestDirectory: true,
    });

    expect(result.backupProducer).toMatchObject({
      kind: "sealed_candidate",
      releaseId: "candidate-release",
      releaseRoot: candidateRoot,
      sourceSha: candidateSha,
    });
    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        runtimeHome: value.runtimeHome,
        allowTestDirectory: true,
      }),
    ).not.toThrow();
    fs.appendFileSync(path.join(candidateRoot, "dist", "index.js"), "// changed\n");
    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        runtimeHome: value.runtimeHome,
        allowTestDirectory: true,
      }),
    ).toThrow(/backup producer identity changed/u);
  });

  it("rejects an unsealed candidate backup producer", () => {
    const value = fixture();
    configureBackup({ runtimeHome: value.runtimeHome, mode: "local_verified" });
    const candidateRoot = path.join(path.dirname(value.runtimeRoot), "candidate-release");
    writeFile(path.join(candidateRoot, "dist", "index.js"), "process.exit(0);\n");
    writeFile(path.join(candidateRoot, ".openclaw-production-sha"), `${"a".repeat(40)}\n`);
    writeFile(
      path.join(candidateRoot, "snapshot.json"),
      `${JSON.stringify({
        releaseId: "candidate-release",
        source: { commit: "a".repeat(40) },
      })}\n`,
    );

    expect(() =>
      createBackup({
        runtimeHome: value.runtimeHome,
        backupRelease: candidateRoot,
        homedir: value.homedir,
        allowTestDirectory: true,
      }),
    ).toThrow(/seal marker is missing/u);
  });

  it("rejects a sealed backup producer that is absent from the candidate registry", () => {
    const value = fixture();
    configureBackup({ runtimeHome: value.runtimeHome, mode: "local_verified" });
    const candidateSha = "a".repeat(40);
    const candidateRoot = path.join(path.dirname(value.runtimeRoot), "candidate-release");
    writeFile(
      path.join(candidateRoot, "dist", "index.js"),
      fs.readFileSync(path.join(value.runtimeRoot, "dist", "index.js"), "utf8"),
    );
    registerCandidate(candidateRoot, candidateSha);
    fs.rmSync(path.join(path.dirname(candidateRoot), ".candidate-registry.json"));

    expect(() =>
      createBackup({
        runtimeHome: value.runtimeHome,
        backupRelease: candidateRoot,
        homedir: value.homedir,
        allowTestDirectory: true,
      }),
    ).toThrow(/not registered/u);
  });

  it("rejects a changed local recovery archive", () => {
    const value = fixture();
    configureBackup({ runtimeHome: value.runtimeHome, mode: "local_verified" });
    const result = createBackup({
      runtimeHome: value.runtimeHome,
      homedir: value.homedir,
      allowTestDirectory: true,
    });
    fs.appendFileSync(result.localArchive.path, "tampered\n");

    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        runtimeHome: value.runtimeHome,
        allowTestDirectory: true,
      }),
    ).toThrow(/localArchive hash changed/u);
  });

  it("rejects a backup receipt from another active runtime release", () => {
    const value = fixture();
    configureBackup({ runtimeHome: value.runtimeHome, mode: "local_verified" });
    const result = createBackup({
      runtimeHome: value.runtimeHome,
      homedir: value.homedir,
      allowTestDirectory: true,
    });
    const pointerPath = path.join(value.runtimeHome, "active-runtime.json");
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
    pointer.releaseId = "replacement-release";
    writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);

    expect(() =>
      verifyReceipt({
        receiptPath: result.receiptPath,
        expectedSha: value.sourceSha,
        runtimeHome: value.runtimeHome,
        allowTestDirectory: true,
      }),
    ).toThrow(/runtime release/u);
  });

  it("rejects a symlinked local backup destination", () => {
    const value = fixture();
    configureBackup({ runtimeHome: value.runtimeHome, mode: "local_verified" });
    const localRoot = path.join(value.runtimeHome, "data-backups");
    const redirectedRoot = path.join(path.dirname(value.runtimeHome), "redirected-backups");
    fs.rmSync(localRoot, { recursive: true, force: true });
    fs.mkdirSync(redirectedRoot);
    fs.symlinkSync(redirectedRoot, localRoot);

    expect(() =>
      createBackup({
        runtimeHome: value.runtimeHome,
        homedir: value.homedir,
        allowTestDirectory: true,
      }),
    ).toThrow(/local backup root is not a regular directory/u);
  });

  it("creates matching local and external recovery points and verifies the receipt", () => {
    const value = fixture();
    const result = createBackup({ ...value, externalRoot: "" });

    expect(result).toMatchObject({
      schema: "openclaw.custom-runtime-update-backup.v2",
      mode: "external_encrypted",
      result: "passed",
      sourceSha: value.sourceSha,
      releaseId: "release",
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
    ).toBe(fs.readFileSync(value.sourceBundlePath, "utf8"));
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

  it("derives legacy runtime provenance from a bound snapshot without mutating the release", () => {
    const value = fixture();
    const runtimeRoot = path.join(path.dirname(value.runtimeHome), "release");
    const pointerPath = path.join(value.runtimeHome, "active-runtime.json");
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
    pointer.entrypoint = `${runtimeRoot}/dist/../dist/index.js`;
    writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);
    writeFile(
      path.join(runtimeRoot, "snapshot.json"),
      `${JSON.stringify({
        version: 2,
        releaseId: "release",
        root: runtimeRoot,
        paths: { entrypoint: path.join(runtimeRoot, "dist", "index.js") },
        source: { commit: value.sourceSha },
      })}\n`,
    );
    fs.rmSync(path.join(runtimeRoot, ".openclaw-runtime-provenance.json"));

    const result = createBackup(value);

    expect(result).toMatchObject({
      result: "passed",
      controlPlane: { fileCount: 12 },
    });
    const controlPlane = result.controlPlane as { path: string };
    const entries = execFileSync("tar", ["-tzf", controlPlane.path], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((entry) => entry.includes("runtime-provenance"));
    expect(entries).toHaveLength(1);
    expect(
      execFileSync("tar", ["-xOf", controlPlane.path, entries[0]!], { encoding: "utf8" }),
    ).toContain("openclaw.custom-runtime-legacy-runtime-provenance.v1");
    expect(fs.existsSync(path.join(runtimeRoot, ".openclaw-runtime-provenance.json"))).toBe(false);
  });

  it("uses canonical exact-SHA provenance for a legacy pointer without sourceProvenance", () => {
    const value = fixture();
    const pointerPath = path.join(value.runtimeHome, "active-runtime.json");
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
    delete pointer.sourceProvenance;
    writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);

    const result = createBackup(value);

    expect(result).toMatchObject({
      result: "passed",
      sourceSha: value.sourceSha,
      controlPlane: { fileCount: 12 },
    });
  });

  it("rejects a legacy provenance record with an unsupported version", () => {
    const value = fixture();
    const pointerPath = path.join(value.runtimeHome, "active-runtime.json");
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
    delete pointer.sourceProvenance;
    writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);
    const recordPath = path.join(
      value.runtimeHome,
      "source-provenance",
      value.sourceSha,
      "provenance.json",
    );
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Record<string, unknown>;
    record.version = 2;
    writeFile(recordPath, `${JSON.stringify(record)}\n`);

    expect(() => createBackup(value)).toThrow(/legacy source provenance record is not bound/u);
  });

  it("rejects a legacy provenance bundle from another SHA directory", () => {
    const value = fixture();
    const pointerPath = path.join(value.runtimeHome, "active-runtime.json");
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
    delete pointer.sourceProvenance;
    writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);
    const recordPath = path.join(
      value.runtimeHome,
      "source-provenance",
      value.sourceSha,
      "provenance.json",
    );
    const otherRoot = path.join(value.runtimeHome, "source-provenance", "b".repeat(40));
    const otherBundlePath = path.join(otherRoot, "source.bundle");
    writeFile(otherBundlePath, "other bundle\n");
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Record<string, unknown>;
    record.bundlePath = otherBundlePath;
    record.bundleSha256 = createHash("sha256").update("other bundle\n").digest("hex");
    writeFile(recordPath, `${JSON.stringify(record)}\n`);

    expect(() => createBackup(value)).toThrow(/outside its managed root/u);
  });

  it("rejects a noncanonical bundle file within the active SHA directory", () => {
    const value = fixture();
    const pointerPath = path.join(value.runtimeHome, "active-runtime.json");
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
    delete pointer.sourceProvenance;
    writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);
    const legacyRoot = path.join(value.runtimeHome, "source-provenance", value.sourceSha);
    const recordPath = path.join(legacyRoot, "provenance.json");
    const alternateBundlePath = path.join(legacyRoot, "recovery.bundle");
    fs.copyFileSync(path.join(legacyRoot, "source.bundle"), alternateBundlePath);
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Record<string, unknown>;
    record.bundlePath = alternateBundlePath;
    record.bundleSha256 = createHash("sha256")
      .update(fs.readFileSync(alternateBundlePath))
      .digest("hex");
    writeFile(recordPath, `${JSON.stringify(record)}\n`);

    expect(() => createBackup(value)).toThrow(/bundle is not canonical/u);
  });

  it("rejects a canonical provenance file that is not a Git bundle", () => {
    const value = fixture();
    const pointerPath = path.join(value.runtimeHome, "active-runtime.json");
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
    delete pointer.sourceProvenance;
    writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);
    const legacyRoot = path.join(value.runtimeHome, "source-provenance", value.sourceSha);
    const recordPath = path.join(legacyRoot, "provenance.json");
    const bundlePath = path.join(legacyRoot, "source.bundle");
    writeFile(bundlePath, "not a Git bundle\n");
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Record<string, unknown>;
    record.bundleSha256 = createHash("sha256").update("not a Git bundle\n").digest("hex");
    writeFile(recordPath, `${JSON.stringify(record)}\n`);

    expect(() => createBackup(value)).toThrow(/bundle validation failed/u);
  });

  it("rejects a legacy pointer without canonical exact-SHA provenance", () => {
    const value = fixture();
    const pointerPath = path.join(value.runtimeHome, "active-runtime.json");
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
    delete pointer.sourceProvenance;
    writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);
    fs.rmSync(path.join(value.runtimeHome, "source-provenance", value.sourceSha), {
      recursive: true,
    });

    expect(() => createBackup(value)).toThrow(/legacy source provenance record/u);
  });

  it("rejects legacy runtime provenance when the snapshot commit is not the active SHA", () => {
    const value = fixture();
    const runtimeRoot = path.join(path.dirname(value.runtimeHome), "release");
    writeFile(
      path.join(runtimeRoot, "snapshot.json"),
      `${JSON.stringify({
        version: 2,
        releaseId: "release",
        root: runtimeRoot,
        paths: { entrypoint: path.join(runtimeRoot, "dist", "index.js") },
        source: { commit: "b".repeat(40) },
      })}\n`,
    );
    fs.rmSync(path.join(runtimeRoot, ".openclaw-runtime-provenance.json"));

    expect(() => createBackup(value)).toThrow(/legacy runtime snapshot is not bound/u);
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
    const backupRoot = path.join(value.runtimeHome, "data-backups", "recovery");
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
    ).toThrow(/active runtime identity changed/u);
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
