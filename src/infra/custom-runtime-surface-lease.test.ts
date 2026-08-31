import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import {
  acquireCustomRuntimeSurfaceLease,
  assertCustomRuntimeSurfaceLeaseIdentity,
  CustomRuntimeSurfaceLeaseError,
  readCustomRuntimeSurfaceLease,
  recoverExpiredCustomRuntimeSurfaceLease,
} from "./custom-runtime-surface-lease.js";

const ACTIVE_SHA = "a".repeat(40);
const CANDIDATE_SHA = "b".repeat(40);
const roots: string[] = [];

function createOptions() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-surface-lease-"));
  roots.push(root);
  return { path: path.join(root, "state", "openclaw.sqlite") };
}

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("custom runtime surface leases", () => {
  it("serializes a surface and preserves the exact runtime identities", () => {
    const options = createOptions();
    const lease = acquireCustomRuntimeSurfaceLease({
      ...options,
      key: "candidate-preparation",
      owner: "test-preparer",
      operation: "prepare",
      activeSha: ACTIVE_SHA,
      candidateSha: CANDIDATE_SHA,
      nowMs: 1_000,
      ttlMs: 10_000,
    });

    expect(readCustomRuntimeSurfaceLease("candidate-preparation", options)).toMatchObject({
      ownerLabel: "test-preparer",
      activeSha: ACTIVE_SHA,
      candidateSha: CANDIDATE_SHA,
      operation: "prepare",
      expiresAt: 11_000,
    });
    expect(() =>
      acquireCustomRuntimeSurfaceLease({
        ...options,
        key: "candidate-preparation",
        owner: "another-preparer",
        operation: "prepare",
        activeSha: ACTIVE_SHA,
        candidateSha: CANDIDATE_SHA,
        nowMs: 2_000,
      }),
    ).toThrowError(CustomRuntimeSurfaceLeaseError);

    lease.heartbeat(5_000);
    expect(readCustomRuntimeSurfaceLease("candidate-preparation", options)?.expiresAt).toBe(15_000);
    lease.release();
    expect(readCustomRuntimeSurfaceLease("candidate-preparation", options)).toBeNull();
  });

  it("recovers only an expired lease before admitting the next operation", () => {
    const options = createOptions();
    acquireCustomRuntimeSurfaceLease({
      ...options,
      key: "gateway-runtime",
      owner: "stale-operation",
      operation: "stage",
      nowMs: 1_000,
      ttlMs: 100,
    });
    expect(
      recoverExpiredCustomRuntimeSurfaceLease({ ...options, key: "gateway-runtime", nowMs: 1_099 }),
    ).toBe(false);
    expect(
      recoverExpiredCustomRuntimeSurfaceLease({ ...options, key: "gateway-runtime", nowMs: 1_100 }),
    ).toBe(true);
    const replacement = acquireCustomRuntimeSurfaceLease({
      ...options,
      key: "gateway-runtime",
      owner: "replacement",
      operation: "stage",
      nowMs: 1_101,
    });
    replacement.release();
  });

  it("fails closed when a lease identity is reused for another SHA", () => {
    const options = createOptions();
    const lease = acquireCustomRuntimeSurfaceLease({
      ...options,
      key: "dashboard-browser-proof",
      owner: "browser-proof",
      operation: "verify",
      activeSha: ACTIVE_SHA,
      candidateSha: CANDIDATE_SHA,
    });
    expect(() =>
      assertCustomRuntimeSurfaceLeaseIdentity(lease, { activeSha: "c".repeat(40) }),
    ).toThrow(/active SHA changed/u);
    expect(() =>
      assertCustomRuntimeSurfaceLeaseIdentity(lease, { candidateSha: "d".repeat(40) }),
    ).toThrow(/candidate SHA changed/u);
    lease.release();
  });
});
