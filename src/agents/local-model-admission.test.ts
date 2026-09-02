import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { resolveOpenClawStateSqlitePath } from "../state/openclaw-state-db.paths.js";
import {
  acquireExclusiveLocalModelAdmission,
  acquireLocalModelAdmission,
  LOCAL_MODEL_ADMISSION_STATE_DIR_ENV,
  LOCAL_MODEL_ADMISSION_TOKEN_ENV,
} from "./local-model-admission.js";

const originalToken = process.env[LOCAL_MODEL_ADMISSION_TOKEN_ENV];
const roots: string[] = [];

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env[LOCAL_MODEL_ADMISSION_TOKEN_ENV];
  } else {
    process.env[LOCAL_MODEL_ADMISSION_TOKEN_ENV] = originalToken;
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function stateEnv(): NodeJS.ProcessEnv {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-local-model-test-"));
  roots.push(stateDir);
  return { [LOCAL_MODEL_ADMISSION_STATE_DIR_ENV]: stateDir };
}

function stateLeases(env: NodeJS.ProcessEnv): Array<{ leaseKey: string; expiresAt: number }> {
  const sqlite = requireNodeSqlite();
  const db = new sqlite.DatabaseSync(resolveOpenClawStateSqlitePath(env), { readOnly: true });
  try {
    return db
      .prepare(
        "SELECT lease_key AS leaseKey, expires_at AS expiresAt FROM state_leases WHERE scope = ?",
      )
      .all("local-model") as Array<{ leaseKey: string; expiresAt: number }>;
  } finally {
    db.close();
  }
}

function cleanSnapshot(observedAt: string) {
  return {
    observedAt,
    activeOpenClawWorkerCount: 0,
    activeOllamaClientCount: 0,
  };
}

describe("local model admission", () => {
  it("stores leases in the shared SQLite state database", async () => {
    const env = stateEnv();
    const lease = await acquireLocalModelAdmission({
      mode: "shared",
      owner: "first",
      env,
    });

    expect(stateLeases(env)).toHaveLength(1);
    expect(path.basename(resolveOpenClawStateSqlitePath(env))).toBe("openclaw.sqlite");
    expect(fs.existsSync(path.join(env.OPENCLAW_STATE_DIR!, "state.json"))).toBe(false);
    await lease.release();
    expect(stateLeases(env)).toEqual([]);
  });

  it("allows shared readers but blocks an exclusive admission", async () => {
    const env = stateEnv();
    const first = await acquireLocalModelAdmission({
      mode: "shared",
      owner: "first",
      env,
    });
    await expect(
      acquireExclusiveLocalModelAdmission({
        owner: "exclusive",
        env,
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
      env: stateEnv(),
      waitMs: 2_000,
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
    const env = stateEnv();
    const lease = await acquireExclusiveLocalModelAdmission({
      owner: "slow-quiescence",
      env,
      ttlMs: 5_000,
      waitMs: 10_000,
      sampleIntervalMs: 3_000,
      probe: () => cleanSnapshot(new Date().toISOString()),
    });
    const state = stateLeases(env);
    expect(lease.samples).toHaveLength(3);
    expect(state).toHaveLength(1);
    expect(state[0]?.leaseKey).toBe(lease.token);
    expect(state[0]?.expiresAt).toBeGreaterThan(Date.now());
    await lease.release();
  });

  it("cleans up its exclusive lease when quiescence times out", async () => {
    const env = stateEnv();
    await expect(
      acquireExclusiveLocalModelAdmission({
        owner: "blocked-smoke",
        env,
        waitMs: 0,
        sampleIntervalMs: 0,
        probe: () => ({ ...cleanSnapshot("busy"), activeOllamaClientCount: 1 }),
      }),
    ).rejects.toMatchObject({ code: "resource_contention" });
    expect(stateLeases(env)).toEqual([]);
  });

  it("prunes a live-TTL lease whose owner process has exited", async () => {
    const env = stateEnv();
    const first = await acquireLocalModelAdmission({
      mode: "shared",
      owner: "schema-bootstrap",
      env,
    });
    await first.release();

    const stalePid = 42_424_242;
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === stalePid) {
        throw Object.assign(new Error("process exited"), { code: "ESRCH" });
      }
      return true;
    });
    try {
      const sqlite = requireNodeSqlite();
      const db = new sqlite.DatabaseSync(resolveOpenClawStateSqlitePath(env));
      try {
        const nowMs = Date.now();
        db.prepare(
          `INSERT INTO state_leases
             (scope, lease_key, owner, expires_at, heartbeat_at, payload_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          "local-model",
          "stale-token",
          "stale-owner",
          nowMs + 60_000,
          nowMs,
          JSON.stringify({
            schema: "openclaw.local-model-admission.v1",
            mode: "exclusive",
            pid: stalePid,
          }),
          nowMs - 1_000,
          nowMs,
        );
      } finally {
        db.close();
      }

      const lease = await acquireExclusiveLocalModelAdmission({
        owner: "replacement",
        env,
        waitMs: 100,
        sampleIntervalMs: 0,
        probe: () => cleanSnapshot("replacement"),
      });
      expect(kill).toHaveBeenCalledWith(stalePid, 0);
      await lease.release();
    } finally {
      kill.mockRestore();
    }
  });

  it("borrows an inherited exclusive lease without releasing the parent", async () => {
    const parentEnv = stateEnv();
    const parent = await acquireExclusiveLocalModelAdmission({
      owner: "parent",
      env: parentEnv,
      waitMs: 2_000,
      sampleIntervalMs: 0,
      probe: () => cleanSnapshot("parent"),
    });
    const childEnv = { ...parentEnv, [LOCAL_MODEL_ADMISSION_TOKEN_ENV]: parent.token };
    const borrowed = await acquireLocalModelAdmission({
      mode: "shared",
      owner: "child",
      env: childEnv,
    });
    expect(borrowed.borrowed).toBe(true);
    await borrowed.release();
    expect(stateLeases(parentEnv)).toHaveLength(1);
    await parent.release();
  });
});
