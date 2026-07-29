import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadOperationsRemediationRecords,
  saveOperationsRemediationRecords,
} from "./remediation-store.js";
import type { OperationsRemediationRecord } from "./types.js";

const temporaryDirectories: string[] = [];

function temporaryPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "operations-remediation-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "receipts.json");
}

function record(id: string, updatedAt: number): OperationsRemediationRecord {
  return {
    id,
    findingId: `finding-${id}`,
    findingTitle: "Finding",
    findingCategory: "cron",
    impact: "Future runs may fail.",
    recipeId: "recipe.v1",
    risk: "low",
    status: "completed",
    ownerId: "OpenClaw",
    exactRepair: "Repair",
    progress: "Done",
    result: "Verified",
    evidence: ["Verified"],
    rollback: "Undo",
    undoAvailable: false,
    automatic: true,
    startedAt: updatedAt,
    updatedAt,
    completedAt: updatedAt,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Operations remediation receipt store", () => {
  it("persists a bounded newest-first store with private permissions", () => {
    const target = temporaryPath();
    saveOperationsRemediationRecords(
      Array.from({ length: 105 }, (_, index) => record(String(index), index)),
      { path: target },
    );
    const loaded = loadOperationsRemediationRecords({ path: target });
    expect(loaded).toHaveLength(100);
    expect(loaded[0]?.updatedAt).toBe(104);
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  it("rejects symlinks and malformed evidence", () => {
    const target = temporaryPath();
    const real = `${target}.real`;
    fs.writeFileSync(real, "{}");
    fs.symlinkSync(real, target);
    expect(() => loadOperationsRemediationRecords({ path: target })).toThrow(/regular file/);
    fs.unlinkSync(target);
    fs.writeFileSync(target, '{"schema":"wrong","records":[]}');
    expect(() => loadOperationsRemediationRecords({ path: target })).toThrow(/malformed/);
  });

  it("rejects malformed writes and refuses to replace a symlink target", () => {
    const target = temporaryPath();
    expect(() =>
      saveOperationsRemediationRecords([{ ...record("bad", 1), evidence: ["x".repeat(4_001)] }], {
        path: target,
      }),
    ).toThrow(/malformed/);

    const real = `${target}.real`;
    fs.writeFileSync(real, "{}");
    fs.symlinkSync(real, target);
    expect(() => saveOperationsRemediationRecords([record("safe", 2)], { path: target })).toThrow(
      /regular file/,
    );
  });

  it("rejects terminal receipts with inconsistent timestamps or missing results", () => {
    const target = temporaryPath();
    expect(() =>
      saveOperationsRemediationRecords([{ ...record("time", 2), completedAt: 3, updatedAt: 2 }], {
        path: target,
      }),
    ).toThrow(/malformed/);
    expect(() =>
      saveOperationsRemediationRecords([{ ...record("result", 2), result: undefined }], {
        path: target,
      }),
    ).toThrow(/malformed/);
  });
});
