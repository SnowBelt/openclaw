import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_STORAGE_FLOOR_BYTES,
  DEFAULT_STORAGE_TARGET_BYTES,
  GIB,
  acquireStorageReservation,
  applyCleanupReceipt,
  createCleanupReceipt,
  defaultStorageVolumePath,
  defaultRegistryPath,
  registerWorkspacePath,
  releaseStorageReservation,
} from "../../scripts/custom-runtime/storage-admission.mjs";

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function admissionOptions(root: string) {
  return {
    owner: "storage-test",
    taskId: "storage-test-task",
    purpose: "test-temporary-workspace",
    allowedRoots: [root],
    registryPath: path.join(root, "registry.json"),
    expectedBytes: 10,
    floorBytes: 75,
    targetBytes: 90,
    maxConcurrent: 1,
    availableBytesProvider: () => 100,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("temporary-workspace storage admission", () => {
  it("uses the production 150 GiB hard floor and 200 GiB recovery target", () => {
    expect(DEFAULT_STORAGE_FLOOR_BYTES).toBe(150 * GIB);
    expect(DEFAULT_STORAGE_TARGET_BYTES).toBe(200 * GIB);
  });

  it("exposes the canonical shared workspace registry path", () => {
    expect(defaultRegistryPath()).toBe(
      path.join(os.homedir(), ".openclaw-custom-runtime", "temp-workspace-registry.json"),
    );
  });

  it("derives the default storage volume from the allowed workspace root", () => {
    const root = temporaryRoot("openclaw-storage-volume-");
    const expectedVolume =
      process.platform === "darwin" && fs.existsSync("/System/Volumes/Data")
        ? "/System/Volumes/Data"
        : root;
    expect(defaultStorageVolumePath([root])).toBe(expectedVolume);

    let observedVolume: string | undefined;
    const reservation = acquireStorageReservation({
      ...admissionOptions(root),
      availableBytesProvider: (volumePath: string) => {
        observedVolume = volumePath;
        return 100;
      },
    });
    expect(observedVolume).toBe(expectedVolume);
    expect(reservation.volumePath).toBe(expectedVolume);
    releaseStorageReservation({ reservation });
  });

  it("fails closed when the requested operation would cross the free-space floor", () => {
    const root = temporaryRoot("openclaw-storage-floor-");
    expect(() =>
      acquireStorageReservation({
        ...admissionOptions(root),
        availableBytesProvider: () => 84,
      }),
    ).toThrow(/Storage admission denied/u);
    expect(fs.existsSync(path.join(root, "registry.json"))).toBe(false);
  });

  it("records whether projected free space meets the recovery target", () => {
    const root = temporaryRoot("openclaw-storage-target-");
    const reservation = acquireStorageReservation({
      ...admissionOptions(root),
      targetBytes: 95,
    });

    expect(reservation.projectedFreeBytes).toBe(90);
    expect(reservation.targetMetAtAdmission).toBe(false);
    releaseStorageReservation({ reservation });
  });

  it("registers exact contained paths and enforces one concurrent large operation", () => {
    const root = temporaryRoot("openclaw-storage-concurrency-");
    const reservation = acquireStorageReservation(admissionOptions(root));
    const workspace = path.join(root, "candidate-a");
    registerWorkspacePath({ reservation, workspacePath: workspace });
    expect(() =>
      registerWorkspacePath({
        reservation,
        workspacePath: path.join(root, "..", "escaped-candidate"),
      }),
    ).toThrow(/escapes its registered roots/u);
    expect(() => acquireStorageReservation(admissionOptions(root))).toThrow(/limit is 1/u);

    releaseStorageReservation({ reservation });
    expect(() => acquireStorageReservation(admissionOptions(root))).not.toThrow();
  });

  it("does not bypass a shared cleanup-pending operation when a local owner projection expires", () => {
    const root = temporaryRoot("openclaw-storage-expiry-");
    acquireStorageReservation(admissionOptions(root));
    const registryPath = path.join(root, "registry.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    const [reservation] = Object.values(registry.reservations) as Array<Record<string, unknown>>;
    reservation.pid = 999_999;
    fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
    expect(() =>
      acquireStorageReservation({
        ...admissionOptions(root),
        pidIsAlive: () => false,
        operationWaitMs: 0,
      }),
    ).toThrow(/Shared operation admission failed/u);
  });
});

describe("identity-bound disposable cleanup", () => {
  it("removes an unchanged closed tree after receipt verification", () => {
    const root = temporaryRoot("openclaw-cleanup-root-");
    const target = path.join(root, "superseded-artifact");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "artifact.txt"), "disposable\n");
    const receiptPath = path.join(root, "cleanup-receipt.json");
    const receipt = createCleanupReceipt({
      paths: [target],
      allowedRoots: [root],
      reason: "superseded test artifact",
      receiptPath,
    });

    const result = applyCleanupReceipt({
      receiptPath,
      expectedReceiptSha256: receipt.receiptSha256,
    });
    expect(result.removedPaths).toEqual([receipt.targets[0].path]);
    expect(result.logicalBytes).toBeGreaterThan(0);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("fingerprints and removes a contained dangling symlink", () => {
    const root = temporaryRoot("openclaw-cleanup-dangling-link-");
    const target = path.join(root, "superseded-artifact");
    fs.mkdirSync(path.join(target, ".bin"), { recursive: true });
    fs.symlinkSync("missing-tool", path.join(target, ".bin", "tool"));
    const receiptPath = path.join(root, "cleanup-receipt.json");
    const receipt = createCleanupReceipt({
      paths: [target],
      allowedRoots: [root],
      reason: "superseded incomplete test artifact",
      receiptPath,
    });

    const result = applyCleanupReceipt({
      receiptPath,
      expectedReceiptSha256: receipt.receiptSha256,
    });
    expect(result.removedPaths).toEqual([receipt.targets[0].path]);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("stops when target bytes drift after the receipt is sealed", () => {
    const root = temporaryRoot("openclaw-cleanup-drift-");
    const target = path.join(root, "superseded-artifact");
    fs.mkdirSync(target);
    const artifactPath = path.join(target, "artifact.txt");
    fs.writeFileSync(artifactPath, "before\n");
    const receiptPath = path.join(root, "cleanup-receipt.json");
    const receipt = createCleanupReceipt({
      paths: [target],
      allowedRoots: [root],
      reason: "superseded test artifact",
      receiptPath,
    });
    fs.writeFileSync(artifactPath, "after\n");

    expect(() =>
      applyCleanupReceipt({
        receiptPath,
        expectedReceiptSha256: receipt.receiptSha256,
      }),
    ).toThrow(/changed after approval/u);
    expect(fs.existsSync(target)).toBe(true);
  });

  it("rejects a receipt digest that was not explicitly approved", () => {
    const root = temporaryRoot("openclaw-cleanup-digest-");
    const target = path.join(root, "superseded-artifact");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "artifact.txt"), "disposable\n");
    const receiptPath = path.join(root, "cleanup-receipt.json");
    createCleanupReceipt({
      paths: [target],
      allowedRoots: [root],
      reason: "superseded test artifact",
      receiptPath,
    });

    expect(() =>
      applyCleanupReceipt({ receiptPath, expectedReceiptSha256: "0".repeat(64) }),
    ).toThrow(/does not match/u);
    expect(fs.existsSync(target)).toBe(true);
  });
});
