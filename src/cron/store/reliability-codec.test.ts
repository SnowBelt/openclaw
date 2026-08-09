import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../../test/helpers/temp-dir.js";
import { openOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import type { CronJob } from "../types.js";
import { loadedCronStoreFromRows, loadCronRows, replaceCronRows } from "./row-codec.js";

const temporaryDirectories: string[] = [];
afterEach(() => cleanupTempDirs(temporaryDirectories));

describe("cron reliability contract SQLite codec", () => {
  it("round-trips the contract through the immutable job JSON sidecar", () => {
    const job = {
      id: "job-1",
      name: "program",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 2,
      schedule: { kind: "every", everyMs: 30_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "work" },
      reliability: {
        version: 1,
        programId: "program.daily",
        ownerAgentId: "program-manager",
        criticality: "high",
        maxLatenessMs: 60_000,
        catchUpPolicy: "run_latest",
        idempotencyScope: "schedule_window",
        resourceClaims: [{ resource: "local-model", mode: "exclusive" }],
        sideEffectClass: "owned_state",
        approvalClass: "automatic",
        preflight: ["model_ready"],
        completionProof: ["task_terminal"],
      },
      state: {},
    } satisfies CronJob;
    const fixtureRoot = makeTempDir(temporaryDirectories, "cron-reliability-codec-");
    const handle = openOpenClawStateDatabase({ path: path.join(fixtureRoot, "state.sqlite") });
    try {
      replaceCronRows(handle.db, "test", { version: 1, jobs: [job] });
      const [decoded] = loadedCronStoreFromRows(loadCronRows(handle.db, "test")).store.jobs;
      expect(decoded?.reliability).toEqual(job.reliability);

      handle.db
        .prepare("UPDATE cron_jobs SET job_json = ? WHERE store_key = ? AND job_id = ?")
        .run(
          JSON.stringify({ ...job, reliability: { ...job.reliability, version: 2 } }),
          "test",
          job.id,
        );
      expect(loadedCronStoreFromRows(loadCronRows(handle.db, "test")).store.jobs).toEqual([]);
    } finally {
      handle.walMaintenance.close();
      handle.db.close();
    }
  });
});
