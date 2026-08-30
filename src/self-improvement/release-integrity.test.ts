import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateReleaseIntegrity,
  runReleaseIntegrityCycle,
  type ReleaseIntegrityAction,
  type ReleaseIntegritySnapshot,
} from "./release-integrity.js";

const temporaryDirectories: string[] = [];
const now = 2_000_000;

function temporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  fs.chmodSync(directory, 0o700);
  return directory;
}

type SnapshotOverrides = Omit<Partial<ReleaseIntegritySnapshot>, "checks"> & {
  checks?: Partial<ReleaseIntegritySnapshot["checks"]>;
};

function snapshot(overrides: SnapshotOverrides = {}): ReleaseIntegritySnapshot {
  return {
    version: 1,
    candidateId: "cd-composite-test",
    runtimeIdentitySha256: "a".repeat(64),
    activeParentRuntimeIdentity: "b".repeat(40),
    canaryActive: false,
    stateSha256: "c".repeat(64),
    ...overrides,
    checks: {
      candidateRoot: true,
      closure: true,
      sourceAvailable: true,
      lineageAuthorized: true,
      featureParity: true,
      performance: true,
      ...overrides.checks,
    },
  };
}

function checksWithFailure(
  failedCheck: keyof ReleaseIntegritySnapshot["checks"],
): ReleaseIntegritySnapshot["checks"] {
  return {
    candidateRoot: failedCheck !== "candidateRoot",
    closure: failedCheck !== "closure",
    sourceAvailable: failedCheck !== "sourceAvailable",
    lineageAuthorized: failedCheck !== "lineageAuthorized",
    featureParity: failedCheck !== "featureParity",
    performance: failedCheck !== "performance",
  };
}

function createGovernanceFiles(
  params: {
    status?: ReleaseIntegritySnapshot;
    allowedActions?: ReleaseIntegrityAction[];
    leaseOverrides?: Record<string, unknown>;
  } = {},
) {
  const directory = temporaryDirectory("openclaw-release-integrity-");
  const selectedSnapshot = params.status ?? snapshot();
  const statusPath = path.join(directory, "status.json");
  const leasePath = path.join(directory, "lease.json");
  const requestDirectory = path.join(directory, "requests");
  fs.writeFileSync(statusPath, `${JSON.stringify(selectedSnapshot)}\n`, { mode: 0o600 });
  fs.writeFileSync(
    leasePath,
    `${JSON.stringify({
      version: 1,
      governor: "release-integrity",
      candidateId: selectedSnapshot.candidateId,
      runtimeIdentitySha256: selectedSnapshot.runtimeIdentitySha256,
      activeParentRuntimeIdentity: selectedSnapshot.activeParentRuntimeIdentity,
      expiresAt: now + 100_000,
      allowedActions: params.allowedActions ?? ["quarantine-candidate"],
      evidenceBundleSha256: "d".repeat(64),
      qualityCanary: { passed: true, checkedAt: now - 1_000 },
      ...params.leaseOverrides,
    })}\n`,
    { mode: 0o600 },
  );
  fs.chmodSync(statusPath, 0o600);
  fs.chmodSync(leasePath, 0o600);
  return { directory, statusPath, leasePath, requestDirectory, selectedSnapshot };
}

function mockedPersistence() {
  return {
    recordSignal: vi.fn(async () => ({}) as never),
    appendAudit: vi.fn(async () => ({}) as never),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("release integrity SIG", () => {
  it.each([
    ["candidateRoot", "release.candidate_root_mismatch", "quarantine-candidate"],
    ["closure", "release.closure_mismatch", "quarantine-candidate"],
    ["sourceAvailable", "release.source_unavailable", "restore-source-capsule"],
    ["lineageAuthorized", "release.lineage_migration_required", "request-lineage-migration"],
    ["featureParity", "release.feature_parity_failed", "quarantine-candidate"],
    ["performance", "release.performance_regression", "defer-background-work"],
  ] as const)("maps %s failures to %s", (check, signal, action) => {
    expect(evaluateReleaseIntegrity(snapshot({ checks: checksWithFailure(check) }))).toMatchObject({
      signal,
      candidateActions: expect.arrayContaining([action]),
    });
  });

  it("writes one identity-bound mode-600 repair request without touching the candidate", async () => {
    const files = createGovernanceFiles({
      status: snapshot({ checks: checksWithFailure("candidateRoot") }),
    });
    const persistence = mockedPersistence();
    const result = await runReleaseIntegrityCycle({
      stateDir: files.directory,
      statusPath: files.statusPath,
      leasePath: files.leasePath,
      requestDirectory: files.requestDirectory,
      deps: { now: () => now, ...persistence },
    });

    expect(result).toMatchObject({
      status: "repair-requested",
      signal: "release.candidate_root_mismatch",
      action: "quarantine-candidate",
    });
    const requestFiles = fs.readdirSync(files.requestDirectory);
    expect(requestFiles).toHaveLength(1);
    const requestPath = path.join(files.requestDirectory, requestFiles[0]);
    expect(fs.statSync(requestPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(requestPath, "utf8"))).toMatchObject({
      candidateId: files.selectedSnapshot.candidateId,
      runtimeIdentitySha256: files.selectedSnapshot.runtimeIdentitySha256,
      signal: "release.candidate_root_mismatch",
      action: "quarantine-candidate",
    });
    expect(persistence.recordSignal).toHaveBeenCalledOnce();
    expect(persistence.appendAudit).toHaveBeenCalledOnce();
  });

  it("applies only a lease-authorized action and proves the post-state", async () => {
    const files = createGovernanceFiles({
      status: snapshot({ checks: checksWithFailure("sourceAvailable") }),
      allowedActions: ["restore-source-capsule"],
    });
    const remediate = vi.fn(async () => ({
      applied: true,
      postStateSha256: "e".repeat(64),
      rollbackReceiptSha256: "f".repeat(64),
    }));
    const result = await runReleaseIntegrityCycle({
      stateDir: files.directory,
      statusPath: files.statusPath,
      leasePath: files.leasePath,
      requestDirectory: files.requestDirectory,
      deps: {
        now: () => now,
        ...mockedPersistence(),
        remediate,
        postApplyProbe: () => snapshot({ stateSha256: "e".repeat(64) }),
        postApplyQualityCanary: () => true,
      },
    });

    expect(result).toMatchObject({ status: "applied", action: "restore-source-capsule" });
    expect(remediate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "restore-source-capsule",
        signal: "release.source_unavailable",
      }),
    );
  });

  it("automatically rolls back when the post-apply quality canary fails", async () => {
    const files = createGovernanceFiles({
      status: snapshot({ canaryActive: true, checks: checksWithFailure("performance") }),
      allowedActions: ["rollback-canary"],
    });
    const rollback = vi.fn();
    const result = await runReleaseIntegrityCycle({
      stateDir: files.directory,
      statusPath: files.statusPath,
      leasePath: files.leasePath,
      requestDirectory: files.requestDirectory,
      deps: {
        now: () => now,
        ...mockedPersistence(),
        remediate: async () => ({ applied: true, rollback }),
        postApplyProbe: () => snapshot(),
        postApplyQualityCanary: () => false,
      },
    });

    expect(result.status).toBe("rolled-back");
    expect(rollback).toHaveBeenCalledOnce();
  });

  it("fails closed for stale, mismatched, or symlinked governance inputs", async () => {
    const files = createGovernanceFiles({
      status: snapshot({ checks: checksWithFailure("closure") }),
      leaseOverrides: { runtimeIdentitySha256: "f".repeat(64) },
    });
    const remediate = vi.fn();
    const mismatched = await runReleaseIntegrityCycle({
      stateDir: files.directory,
      statusPath: files.statusPath,
      leasePath: files.leasePath,
      requestDirectory: files.requestDirectory,
      deps: { now: () => now, ...mockedPersistence(), remediate },
    });
    expect(mismatched.status).toBe("lease-invalid");
    expect(remediate).not.toHaveBeenCalled();

    const linkedStatus = path.join(files.directory, "linked-status.json");
    fs.symlinkSync(files.statusPath, linkedStatus);
    const linked = await runReleaseIntegrityCycle({
      stateDir: files.directory,
      statusPath: linkedStatus,
      leasePath: files.leasePath,
      requestDirectory: files.requestDirectory,
      deps: { now: () => now, ...mockedPersistence(), remediate },
    });
    expect(linked.status).toBe("status-invalid");
    expect(remediate).not.toHaveBeenCalled();
  });

  it("does not substitute an unauthorized remediation", async () => {
    const files = createGovernanceFiles({
      status: snapshot({ checks: checksWithFailure("lineageAuthorized") }),
      allowedActions: ["defer-background-work"],
    });
    const remediate = vi.fn();
    const result = await runReleaseIntegrityCycle({
      stateDir: files.directory,
      statusPath: files.statusPath,
      leasePath: files.leasePath,
      requestDirectory: files.requestDirectory,
      deps: { now: () => now, ...mockedPersistence(), remediate },
    });

    expect(result.status).toBe("no-authorized-action");
    expect(remediate).not.toHaveBeenCalled();
  });
});
