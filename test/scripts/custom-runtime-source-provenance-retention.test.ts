import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SOURCE_PROVENANCE_MAX_BYTES,
  DEFAULT_SOURCE_PROVENANCE_MAX_SNAPSHOTS,
  applySourceProvenanceRetentionReceipt,
  createSourceProvenanceRetentionReceipt,
  importSourceProvenance,
  planSourceProvenanceRetention,
} from "../../scripts/custom-runtime/custom-runtime-source-provenance.mjs";

const roots: string[] = [];

function isolatedStorageAdmission(runtimeHome: string) {
  return {
    registryPath: path.join(runtimeHome, "temp-workspace-registry.json"),
    expectedBytes: 0,
    floorBytes: 0,
    targetBytes: 0,
    availableBytesProvider: () => 1,
  };
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "OpenClaw Test",
      GIT_AUTHOR_EMAIL: "openclaw-test@local",
      GIT_COMMITTER_NAME: "OpenClaw Test",
      GIT_COMMITTER_EMAIL: "openclaw-test@local",
    },
  }).trim();
}

function makeRepository(): { root: string; commits: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-provenance-retention-source-"));
  roots.push(root);
  git(root, ["init", "-q"]);
  fs.writeFileSync(path.join(root, "tracked.txt"), "one\n");
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "-qm", "one"]);
  const first = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "tracked.txt"), "two\n");
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "-qm", "two"]);
  const second = git(root, ["rev-parse", "HEAD"]);
  return { root, commits: [first, second] };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("source provenance retention", () => {
  it("keeps bounded multi-year headroom for managed update provenance", () => {
    expect(DEFAULT_SOURCE_PROVENANCE_MAX_SNAPSHOTS).toBe(32);
    expect(DEFAULT_SOURCE_PROVENANCE_MAX_BYTES).toBe(128 * 1024 ** 3);
  });

  it("admits only the exact pending candidate reference without hiding retireable history", () => {
    const source = makeRepository();
    const runtimeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-provenance-retention-pending-home-"),
    );
    roots.push(runtimeHome);
    for (const sourceSha of source.commits) {
      git(source.root, ["checkout", "-q", sourceSha]);
      importSourceProvenance({
        sourceRoot: source.root,
        sourceSha,
        runtimeHome,
        storageAdmission: isolatedStorageAdmission(runtimeHome),
      });
    }
    const pendingSourceSha = "c".repeat(40);
    const candidateRegistryPath = path.join(runtimeHome, "candidate-registry.json");
    fs.writeFileSync(
      candidateRegistryPath,
      JSON.stringify({
        schema: "openclaw.custom-runtime-candidate-registry.v1",
        candidates: {
          pending: { sourceSha: pendingSourceSha, state: "staged" },
        },
      }),
      "utf8",
    );
    fs.chmodSync(candidateRegistryPath, 0o600);

    const plan = planSourceProvenanceRetention({
      runtimeHome,
      candidateRegistryPath,
      allowedMissingReferenceSourceSha: pendingSourceSha,
      deepVerify: false,
    });

    expect(plan.errors).toEqual([]);
    expect(plan.allowedMissingReferences).toEqual([pendingSourceSha]);
    expect(plan.entries.find((entry) => entry.sourceSha === source.commits[0])).toMatchObject({
      decision: "retire",
    });
    expect(plan.entries.find((entry) => entry.sourceSha === source.commits[1])).toMatchObject({
      decision: "retain",
    });
  });

  it("keeps unrelated missing candidate references fail-closed", () => {
    const source = makeRepository();
    const runtimeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-provenance-retention-missing-home-"),
    );
    roots.push(runtimeHome);
    git(source.root, ["checkout", "-q", source.commits[0]]);
    importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[0],
      runtimeHome,
      storageAdmission: isolatedStorageAdmission(runtimeHome),
    });
    const pendingSourceSha = "d".repeat(40);
    const candidateRegistryPath = path.join(runtimeHome, "candidate-registry.json");
    fs.writeFileSync(
      candidateRegistryPath,
      JSON.stringify({
        schema: "openclaw.custom-runtime-candidate-registry.v1",
        candidates: {
          pending: { sourceSha: pendingSourceSha, state: "staged" },
        },
      }),
      "utf8",
    );
    fs.chmodSync(candidateRegistryPath, 0o600);

    const plan = planSourceProvenanceRetention({
      runtimeHome,
      candidateRegistryPath,
      allowedMissingReferenceSourceSha: "e".repeat(40),
      deepVerify: false,
    });

    expect(plan.errors).toContain(
      `referenced source provenance record is missing: ${pendingSourceSha}`,
    );
    expect(plan.admissionBlocked).toBe(true);
    expect(plan.entries.every((entry) => entry.decision === "retain")).toBe(true);
  });

  it("retains the newest verified snapshot and retires older unreferenced history", () => {
    const source = makeRepository();
    const runtimeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-provenance-retention-home-"),
    );
    roots.push(runtimeHome);
    git(source.root, ["checkout", "-q", source.commits[0]]);
    importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[0],
      runtimeHome,
      storageAdmission: isolatedStorageAdmission(runtimeHome),
    });
    git(source.root, ["checkout", "-q", source.commits[1]]);
    importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[1],
      runtimeHome,
      storageAdmission: isolatedStorageAdmission(runtimeHome),
    });

    const plan = planSourceProvenanceRetention({
      runtimeHome,
      maxSnapshots: 8,
      maxBytes: 32 * 1024 ** 3,
      deepVerify: true,
    });

    expect(plan.errors).toEqual([]);
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries.find((entry) => entry.sourceSha === source.commits[1])).toMatchObject({
      decision: "retain",
      protectedReasons: ["newest_deep_verified_per_lineage"],
    });
    expect(plan.entries.find((entry) => entry.sourceSha === source.commits[0])).toMatchObject({
      decision: "retire",
    });
  });

  it("records the actual repository HEAD when importing a non-HEAD Git object", () => {
    const source = makeRepository();
    const runtimeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-provenance-non-head-home-"),
    );
    roots.push(runtimeHome);
    git(source.root, ["checkout", "-q", source.commits[1]]);
    const record = importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[0],
      runtimeHome,
      storageAdmission: isolatedStorageAdmission(runtimeHome),
      allowNonHeadSourceSha: true,
    });
    expect(record.sourceSha).toBe(source.commits[0]);
    expect(record.sourceHead).toBe(source.commits[1]);
    expect(record.treeSha).toBe(git(source.root, ["rev-parse", `${source.commits[0]}^{tree}`]));
  });

  it("governs valid records in the legacy nested provenance namespace", () => {
    const source = makeRepository();
    const runtimeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-provenance-legacy-namespace-home-"),
    );
    roots.push(runtimeHome);
    const legacyRuntimeHome = path.join(runtimeHome, "source-provenance");
    fs.mkdirSync(legacyRuntimeHome, { recursive: true, mode: 0o700 });
    fs.chmodSync(legacyRuntimeHome, 0o700);

    git(source.root, ["checkout", "-q", source.commits[0]]);
    importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[0],
      runtimeHome: legacyRuntimeHome,
      storageAdmission: isolatedStorageAdmission(path.join(runtimeHome, "storage-admission")),
    });
    const reused = importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[0],
      runtimeHome: legacyRuntimeHome,
      storageAdmission: isolatedStorageAdmission(path.join(runtimeHome, "storage-admission")),
    });
    expect(reused.recordPath).toContain(
      path.join("source-provenance", "source-provenance", source.commits[0], "provenance.json"),
    );

    const plan = planSourceProvenanceRetention({
      runtimeHome,
      deepVerify: true,
    });

    expect(plan.errors).toEqual([]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({
      sourceSha: source.commits[0],
      decision: "retain",
      protectedReasons: ["newest_deep_verified_per_lineage"],
    });
  });

  it("retires a legacy nested record using its relative path", () => {
    const source = makeRepository();
    const runtimeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-provenance-legacy-retire-home-"),
    );
    roots.push(runtimeHome);
    const legacyRuntimeHome = path.join(runtimeHome, "source-provenance");
    fs.mkdirSync(legacyRuntimeHome, { recursive: true, mode: 0o700 });
    fs.chmodSync(legacyRuntimeHome, 0o700);
    const storageRegistryRoot = path.join(runtimeHome, "storage-admission");

    for (const sourceSha of source.commits) {
      git(source.root, ["checkout", "-q", sourceSha]);
      importSourceProvenance({
        sourceRoot: source.root,
        sourceSha,
        runtimeHome: legacyRuntimeHome,
        storageAdmission: isolatedStorageAdmission(storageRegistryRoot),
      });
    }

    const plan = planSourceProvenanceRetention({
      runtimeHome,
      maxSnapshots: 1,
      maxBytes: 32 * 1024 ** 3,
      deepVerify: false,
    });
    const target = plan.entries.find((entry) => entry.sourceSha === source.commits[0]);
    expect(plan.errors).toEqual([]);
    expect(target?.decision).toBe("retire");

    const receiptPath = path.join(runtimeHome, "legacy-retire-receipt.json");
    const receipt = createSourceProvenanceRetentionReceipt({
      plan,
      sourceSha: source.commits[0],
      receiptPath,
    });
    expect(receipt.target.relativePath).toBe(path.join("source-provenance", source.commits[0]));

    const applied = applySourceProvenanceRetentionReceipt({
      receiptPath,
      expectedReceiptSha256: receipt.receiptSha256,
    });
    expect(applied.sourceSha).toBe(source.commits[0]);
    const legacyRecordDirectory = path.join(
      fs.realpathSync(runtimeHome),
      "source-provenance",
      "source-provenance",
      source.commits[0],
    );
    expect(applied.removedPath).toBe(legacyRecordDirectory);
    expect(fs.existsSync(legacyRecordDirectory)).toBe(false);
  });

  it("rejects an incomplete canonical directory before reusing a legacy record", () => {
    const source = makeRepository();
    const runtimeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-provenance-legacy-conflict-home-"),
    );
    roots.push(runtimeHome);
    const legacyRuntimeHome = path.join(runtimeHome, "source-provenance");
    fs.mkdirSync(legacyRuntimeHome, { recursive: true, mode: 0o700 });
    fs.chmodSync(legacyRuntimeHome, 0o700);
    const storageRegistryRoot = path.join(runtimeHome, "storage-admission");

    git(source.root, ["checkout", "-q", source.commits[0]]);
    const legacyRecord = importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[0],
      runtimeHome: legacyRuntimeHome,
      storageAdmission: isolatedStorageAdmission(storageRegistryRoot),
    });
    fs.mkdirSync(path.join(runtimeHome, "source-provenance", source.commits[0]), {
      recursive: true,
      mode: 0o700,
    });

    expect(() =>
      importSourceProvenance({
        sourceRoot: source.root,
        sourceSha: source.commits[0],
        runtimeHome,
        storageAdmission: isolatedStorageAdmission(storageRegistryRoot),
      }),
    ).toThrow(/incomplete existing directory/u);
    expect(fs.existsSync(legacyRecord.recordPath)).toBe(true);
  });

  it("blocks rather than pruning when protected lineages exceed the cap", () => {
    const source = makeRepository();
    const runtimeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-provenance-retention-home-"),
    );
    roots.push(runtimeHome);
    git(source.root, ["checkout", "-q", source.commits[0]]);
    importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[0],
      runtimeHome,
      storageAdmission: isolatedStorageAdmission(runtimeHome),
      historicalSourceSha: "a".repeat(40),
    });
    git(source.root, ["checkout", "-q", source.commits[1]]);
    importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[1],
      runtimeHome,
      storageAdmission: isolatedStorageAdmission(runtimeHome),
      historicalSourceSha: "b".repeat(40),
    });

    const plan = planSourceProvenanceRetention({
      runtimeHome,
      maxSnapshots: 1,
      maxBytes: 32 * 1024 ** 3,
      deepVerify: false,
    });

    expect(plan.admissionBlocked).toBe(true);
    expect(plan.errors.join("\n")).toMatch(/exceeds retention cap/u);
    expect(plan.entries.every((entry) => entry.decision === "retain")).toBe(true);
  });

  it("requires an unchanged hash-bound receipt before retiring one snapshot", () => {
    const source = makeRepository();
    const runtimeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-provenance-retention-home-"),
    );
    roots.push(runtimeHome);
    git(source.root, ["checkout", "-q", source.commits[0]]);
    importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[0],
      runtimeHome,
      storageAdmission: isolatedStorageAdmission(runtimeHome),
    });
    git(source.root, ["checkout", "-q", source.commits[1]]);
    importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[1],
      runtimeHome,
      storageAdmission: isolatedStorageAdmission(runtimeHome),
    });
    const plan = planSourceProvenanceRetention({ runtimeHome, deepVerify: false });
    const target = plan.entries.find((entry) => entry.sourceSha === source.commits[0]);
    expect(target?.decision).toBe("retire");
    const receiptPath = path.join(runtimeHome, "retention-receipt.json");
    const receipt = createSourceProvenanceRetentionReceipt({
      plan,
      sourceSha: source.commits[0],
      receiptPath,
    });
    const applied = applySourceProvenanceRetentionReceipt({
      receiptPath,
      expectedReceiptSha256: receipt.receiptSha256,
    });
    expect(applied.sourceSha).toBe(source.commits[0]);
    expect(fs.existsSync(path.join(runtimeHome, "source-provenance", source.commits[0]))).toBe(
      false,
    );
  });

  it("re-audits references immediately before applying a receipt", () => {
    const source = makeRepository();
    const runtimeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-provenance-reference-race-home-"),
    );
    roots.push(runtimeHome);
    git(source.root, ["checkout", "-q", source.commits[0]]);
    importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[0],
      runtimeHome,
      storageAdmission: isolatedStorageAdmission(runtimeHome),
    });
    git(source.root, ["checkout", "-q", source.commits[1]]);
    importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[1],
      runtimeHome,
      storageAdmission: isolatedStorageAdmission(runtimeHome),
    });
    const plan = planSourceProvenanceRetention({ runtimeHome, deepVerify: false });
    const targetSha = source.commits[0];
    const receiptPath = path.join(runtimeHome, "reference-race-receipt.json");
    const receipt = createSourceProvenanceRetentionReceipt({
      plan,
      sourceSha: targetSha,
      receiptPath,
    });
    fs.writeFileSync(
      path.join(runtimeHome, "active-runtime.json"),
      JSON.stringify({ sourceSha: targetSha }),
      "utf8",
    );
    expect(() =>
      applySourceProvenanceRetentionReceipt({
        receiptPath,
        expectedReceiptSha256: receipt.receiptSha256,
      }),
    ).toThrow(/no longer unreferenced/u);
    expect(fs.existsSync(path.join(runtimeHome, "source-provenance", targetSha))).toBe(true);
  });

  it("blocks a new import while the configured count cap is full", () => {
    const source = makeRepository();
    const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-provenance-cap-home-"));
    roots.push(runtimeHome);
    git(source.root, ["checkout", "-q", source.commits[0]]);
    importSourceProvenance({
      sourceRoot: source.root,
      sourceSha: source.commits[0],
      runtimeHome,
      storageAdmission: isolatedStorageAdmission(runtimeHome),
      sourceProvenanceRetention: { maxSnapshots: 1, maxBytes: 32 * 1024 ** 3 },
    });
    git(source.root, ["checkout", "-q", source.commits[1]]);
    expect(() =>
      importSourceProvenance({
        sourceRoot: source.root,
        sourceSha: source.commits[1],
        runtimeHome,
        storageAdmission: isolatedStorageAdmission(runtimeHome),
        sourceProvenanceRetention: { maxSnapshots: 1, maxBytes: 32 * 1024 ** 3 },
      }),
    ).toThrow(/retention cap is full/u);
  });
});
