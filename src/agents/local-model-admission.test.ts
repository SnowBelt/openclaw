import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireExclusiveLocalModelAdmission,
  acquireLocalModelAdmission,
  LOCAL_MODEL_ADMISSION_TOKEN_ENV,
  LOCAL_MODEL_ADMISSION_ENV,
} from "./local-model-admission.js";

const originalToken = process.env[LOCAL_MODEL_ADMISSION_TOKEN_ENV];
const originalPath = process.env[LOCAL_MODEL_ADMISSION_ENV];

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env[LOCAL_MODEL_ADMISSION_TOKEN_ENV];
  } else {
    process.env[LOCAL_MODEL_ADMISSION_TOKEN_ENV] = originalToken;
  }
  if (originalPath === undefined) {
    delete process.env[LOCAL_MODEL_ADMISSION_ENV];
  } else {
    process.env[LOCAL_MODEL_ADMISSION_ENV] = originalPath;
  }
});

function statePath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-local-model-test-")),
    "state.json",
  );
}

function cleanSnapshot(observedAt: string) {
  return {
    observedAt,
    activeOpenClawWorkerCount: 0,
    activeOllamaClientCount: 0,
  };
}

describe("local model admission", () => {
  it("allows shared readers but blocks an exclusive admission", async () => {
    const first = await acquireLocalModelAdmission({
      mode: "shared",
      owner: "first",
      statePath: statePath(),
    });
    await expect(
      acquireExclusiveLocalModelAdmission({
        owner: "exclusive",
        statePath: first.statePath,
        waitMs: 0,
        sampleIntervalMs: 0,
        probe: async () => cleanSnapshot("never"),
      }),
    ).rejects.toMatchObject({ code: "resource_contention" });
    await first.release();
  });

  it("requires three clean samples and resets the sequence on activity", async () => {
    const observations = [
      cleanSnapshot("1"),
      { ...cleanSnapshot("2"), activeOpenClawWorkerCount: 1 },
      cleanSnapshot("3"),
      cleanSnapshot("4"),
      cleanSnapshot("5"),
    ];
    const lease = await acquireExclusiveLocalModelAdmission({
      owner: "smoke",
      statePath: statePath(),
      waitMs: 100,
      sampleIntervalMs: 0,
      probe: () => {
        const next = observations.shift();
        if (!next) {
          throw new Error("probe exhausted");
        }
        return next;
      },
    });
    expect(lease.samples.map((sample) => sample.observedAt)).toEqual(["3", "4", "5"]);
    await lease.release();
  });

  it("renews an exclusive lease while waiting longer than its base TTL for clean samples", async () => {
    const pathName = statePath();
    const lease = await acquireExclusiveLocalModelAdmission({
      owner: "slow-quiescence",
      statePath: pathName,
      ttlMs: 60,
      waitMs: 500,
      sampleIntervalMs: 40,
      probe: () => cleanSnapshot(new Date().toISOString()),
    });
    const state = JSON.parse(fs.readFileSync(pathName, "utf8")) as {
      leases: Array<{ expiresAt: number; token: string }>;
    };
    expect(lease.samples).toHaveLength(3);
    expect(state.leases).toHaveLength(1);
    expect(state.leases[0]?.token).toBe(lease.token);
    expect(state.leases[0]?.expiresAt).toBeGreaterThan(Date.now());
    await lease.release();
  });

  it("cleans up its exclusive lease when quiescence times out", async () => {
    const pathName = statePath();
    await expect(
      acquireExclusiveLocalModelAdmission({
        owner: "blocked-smoke",
        statePath: pathName,
        waitMs: 0,
        sampleIntervalMs: 0,
        probe: () => ({ ...cleanSnapshot("busy"), activeOllamaClientCount: 1 }),
      }),
    ).rejects.toMatchObject({ code: "resource_contention" });
    const state = JSON.parse(fs.readFileSync(pathName, "utf8")) as { leases: unknown[] };
    expect(state.leases).toEqual([]);
  });

  it("borrows an inherited exclusive lease without releasing the parent", async () => {
    const pathName = statePath();
    const parent = await acquireExclusiveLocalModelAdmission({
      owner: "parent",
      statePath: pathName,
      waitMs: 100,
      sampleIntervalMs: 0,
      probe: () => cleanSnapshot("parent"),
    });
    process.env[LOCAL_MODEL_ADMISSION_TOKEN_ENV] = parent.token;
    process.env[LOCAL_MODEL_ADMISSION_ENV] = pathName;
    const borrowed = await acquireLocalModelAdmission({
      mode: "shared",
      owner: "child",
      statePath: pathName,
    });
    expect(borrowed.borrowed).toBe(true);
    await borrowed.release();
    expect(
      (JSON.parse(fs.readFileSync(pathName, "utf8")) as { leases: unknown[] }).leases,
    ).toHaveLength(1);
    await parent.release();
  });
});
