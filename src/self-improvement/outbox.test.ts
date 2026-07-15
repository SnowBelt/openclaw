import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { upsertSelfImprovementLedgerRows } from "./ledger.js";
import {
  enqueueSelfImprovementOutbox,
  listSelfImprovementOutbox,
  replaySelfImprovementOutbox,
} from "./outbox.js";

const temporaryDirectories: string[] = [];

async function temporaryStateDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sig-outbox-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe("Self-Improvement durable outbox", () => {
  it("replays a pending item exactly once and keeps a completion receipt", async () => {
    const stateDir = await temporaryStateDir();
    const handler = vi.fn(async () => undefined);
    const enqueued = await enqueueSelfImprovementOutbox({
      stateDir,
      kind: "signal_analysis",
      entityId: "sis_1",
      now: 10,
    });

    expect(enqueued.created).toBe(true);
    await expect(
      replaySelfImprovementOutbox({ stateDir, kind: "signal_analysis", handler, now: 20 }),
    ).resolves.toEqual({ attempted: 1, completed: 1, retried: 0, quarantined: 0, skipped: 0 });
    await expect(
      replaySelfImprovementOutbox({ stateDir, kind: "signal_analysis", handler, now: 30 }),
    ).resolves.toEqual({ attempted: 0, completed: 0, retried: 0, quarantined: 0, skipped: 0 });
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(listSelfImprovementOutbox({ stateDir })).resolves.toMatchObject([
      { entityId: "sis_1", status: "completed", attempts: 1, completedAt: 20 },
    ]);
  });

  it("retries with bounded backoff and quarantines after the attempt budget", async () => {
    const stateDir = await temporaryStateDir();
    const handler = vi.fn(async () => {
      throw new Error("bounded failure");
    });
    await enqueueSelfImprovementOutbox({
      stateDir,
      kind: "signal_analysis",
      entityId: "sis_retry",
      now: 100,
    });

    const first = await replaySelfImprovementOutbox({
      stateDir,
      handler,
      now: 100,
      maxAttempts: 2,
    });
    expect(first).toMatchObject({ attempted: 1, retried: 1, quarantined: 0 });
    const pending = await listSelfImprovementOutbox({ stateDir });
    expect(pending[0]).toMatchObject({ status: "pending", attempts: 1, availableAt: 2_100 });

    const second = await replaySelfImprovementOutbox({
      stateDir,
      handler,
      now: 2_100,
      maxAttempts: 2,
    });
    expect(second).toMatchObject({ attempted: 1, retried: 0, quarantined: 1 });
    await expect(listSelfImprovementOutbox({ stateDir })).resolves.toMatchObject([
      { status: "quarantined", attempts: 2, lastError: "bounded failure" },
    ]);
  });

  it("requeues a completed entity when new evidence arrives", async () => {
    const stateDir = await temporaryStateDir();
    await enqueueSelfImprovementOutbox({
      stateDir,
      kind: "signal_analysis",
      entityId: "sis_recurrence",
      now: 1,
    });
    await replaySelfImprovementOutbox({ stateDir, now: 2, handler: async () => undefined });

    const recurrence = await enqueueSelfImprovementOutbox({
      stateDir,
      kind: "signal_analysis",
      entityId: "sis_recurrence",
      now: 3,
    });

    expect(recurrence.created).toBe(false);
    expect(recurrence.item).toMatchObject({ status: "pending", attempts: 0, createdAt: 1 });
  });

  it("recovers an expired processing lease after a worker interruption", async () => {
    const stateDir = await temporaryStateDir();
    await upsertSelfImprovementLedgerRows({
      stateDir,
      collection: "outbox",
      rows: [
        {
          id: "sio_interrupted",
          kind: "signal_analysis" as const,
          entityId: "sis_interrupted",
          status: "processing" as const,
          createdAt: 1,
          updatedAt: 10,
          availableAt: 1,
          attempts: 1,
          leaseExpiresAt: 20,
        },
      ],
      id: (entry) => entry.id,
      createdAt: (entry) => entry.createdAt,
      updatedAt: (entry) => entry.updatedAt,
    });

    const handler = vi.fn(async () => undefined);
    await expect(
      replaySelfImprovementOutbox({
        stateDir,
        now: 21,
        leaseMs: 20,
        maxAttempts: 3,
        handler,
      }),
    ).resolves.toMatchObject({ attempted: 1, completed: 1 });
    expect(handler).toHaveBeenCalledOnce();
    await expect(listSelfImprovementOutbox({ stateDir })).resolves.toMatchObject([
      { status: "completed", attempts: 2, completedAt: 21 },
    ]);
  });
});
