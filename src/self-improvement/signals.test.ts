import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
} from "../infra/diagnostic-events.js";
import { resolveSelfImprovementLedgerPath } from "./ledger.js";
import { listSelfImprovementOutbox, replaySelfImprovementOutbox } from "./outbox.js";
import {
  adaptDiagnosticEventToSelfImprovementSignal,
  listSelfImprovementSignals,
  recordSelfImprovementSignal,
} from "./signals.js";

const temporaryDirectories: string[] = [];
const trusted: DiagnosticEventMetadata = { trusted: true, internal: true };

async function temporaryStateDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sig-signals-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe("Self-Improvement typed signals", () => {
  it("keeps an empty signal listing side-effect free", async () => {
    const stateDir = await temporaryStateDir();

    await expect(listSelfImprovementSignals({ stateDir })).resolves.toEqual([]);
    await expect(fs.stat(resolveSelfImprovementLedgerPath(stateDir))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("sanitizes, caps untrusted severity, and idempotently records recurrence", async () => {
    const stateDir = await temporaryStateDir();
    const input = {
      version: 1 as const,
      idempotencyKey: "dashboard-render-failed",
      source: { component: "example-plugin", owner: "plugin-owner" },
      kind: "regression" as const,
      severity: "critical" as const,
      summary: "Dashboard failed with token=secret-value",
      observed: "api_key=secret-value",
      privacy: "sensitive" as const,
      evidenceRefs: ["artifact://dashboard-smoke"],
      trusted: false,
    };

    const first = await recordSelfImprovementSignal({ stateDir, input, now: 10 });
    const second = await recordSelfImprovementSignal({ stateDir, input, now: 20 });

    expect(first.created).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.budgeted).toBe(false);
    expect(second.created).toBe(false);
    expect(second.signal).toMatchObject({
      severity: "medium",
      firstSeenAt: 10,
      lastSeenAt: 20,
      occurrences: 2,
      evidenceRefs: ["artifact://dashboard-smoke"],
    });
    expect(JSON.stringify(second.signal)).not.toContain("secret-value");
    await expect(listSelfImprovementSignals({ stateDir })).resolves.toHaveLength(1);
    await expect(listSelfImprovementOutbox({ stateDir })).resolves.toMatchObject([
      { entityId: second.signal.id, status: "pending" },
    ]);
  });

  it("drops an exact replay without incrementing recurrence or requeueing work", async () => {
    const stateDir = await temporaryStateDir();
    const input = {
      version: 1 as const,
      idempotencyKey: "same-event",
      source: { component: "component" },
      kind: "failure" as const,
      severity: "medium" as const,
      summary: "Same failure event.",
      occurredAt: 10,
      runId: "run-1",
      privacy: "internal" as const,
      trusted: true,
    };
    await recordSelfImprovementSignal({ stateDir, input, now: 20 });
    await replaySelfImprovementOutbox({ stateDir, now: 21, handler: async () => undefined });

    const replayed = await recordSelfImprovementSignal({ stateDir, input, now: 30 });

    expect(replayed).toMatchObject({ created: false, duplicate: true });
    expect(replayed.signal.occurrences).toBe(1);
    await expect(listSelfImprovementOutbox({ stateDir })).resolves.toMatchObject([
      { status: "completed" },
    ]);
  });

  it("coalesces low-severity distinct signal floods without suppressing trusted high severity", async () => {
    const stateDir = await temporaryStateDir();
    for (let index = 0; index < 20; index += 1) {
      await recordSelfImprovementSignal({
        stateDir,
        now: 10_000 + index,
        input: {
          version: 1,
          idempotencyKey: `distinct-${index}`,
          source: { component: "noisy-component" },
          kind: "inefficiency",
          severity: "low",
          summary: `Bounded signal ${index}.`,
          occurredAt: 10_000 + index,
          privacy: "internal",
          trusted: true,
        },
      });
    }

    const overflowOne = await recordSelfImprovementSignal({
      stateDir,
      now: 10_100,
      input: {
        version: 1,
        idempotencyKey: "overflow-one",
        source: { component: "noisy-component" },
        kind: "failure",
        severity: "medium",
        summary: "Overflow one.",
        occurredAt: 10_100,
        privacy: "internal",
        trusted: true,
      },
    });
    const overflowTwo = await recordSelfImprovementSignal({
      stateDir,
      now: 10_200,
      input: {
        version: 1,
        idempotencyKey: "overflow-two",
        source: { component: "noisy-component" },
        kind: "failure",
        severity: "medium",
        summary: "Overflow two.",
        occurredAt: 10_200,
        privacy: "internal",
        trusted: true,
      },
    });
    const urgent = await recordSelfImprovementSignal({
      stateDir,
      now: 10_300,
      input: {
        version: 1,
        idempotencyKey: "urgent",
        source: { component: "noisy-component" },
        kind: "failure",
        severity: "high",
        summary: "Urgent failure.",
        occurredAt: 10_300,
        privacy: "internal",
        trusted: true,
      },
    });

    expect(overflowOne).toMatchObject({ created: true, budgeted: true });
    expect(overflowTwo).toMatchObject({ created: false, budgeted: true });
    expect(overflowTwo.signal).toMatchObject({
      idempotencyKey: "noise-budget:0",
      occurrences: 2,
      severity: "low",
    });
    expect(urgent).toMatchObject({ created: true, budgeted: false });
    const signals = await listSelfImprovementSignals({ stateDir });
    expect(signals).toHaveLength(22);
    expect(signals.some((entry) => entry.idempotencyKey === "overflow-one")).toBe(false);
    expect(signals.some((entry) => entry.idempotencyKey === "urgent")).toBe(true);
  });

  it("adapts actionable trusted failures and ignores healthy lifecycle evidence", () => {
    const failed: DiagnosticEventPayload = {
      type: "tool.execution.error",
      seq: 1,
      ts: 10,
      runId: "run-1",
      toolName: "browser-smoke",
      toolSource: "core",
      durationMs: 5_000,
      errorCategory: "timeout",
      terminalReason: "timed_out",
    };
    const healthy: DiagnosticEventPayload = {
      type: "tool.execution.completed",
      seq: 2,
      ts: 20,
      runId: "run-1",
      toolName: "browser-smoke",
      toolSource: "core",
      durationMs: 1_000,
    };
    const safelyChunked: DiagnosticEventPayload = {
      type: "payload.large",
      seq: 3,
      ts: 30,
      surface: "dashboard",
      action: "chunked",
    };

    expect(adaptDiagnosticEventToSelfImprovementSignal(failed, trusted)).toMatchObject({
      kind: "failure",
      severity: "high",
      runId: "run-1",
    });
    expect(adaptDiagnosticEventToSelfImprovementSignal(healthy, trusted)).toBeNull();
    expect(adaptDiagnosticEventToSelfImprovementSignal(safelyChunked, trusted)).toBeNull();
  });

  it("accepts the public versioned signal contract but does not trust its severity", () => {
    const event: DiagnosticEventPayload = {
      type: "improvement.signal",
      seq: 1,
      ts: 100,
      version: 1,
      idempotencyKey: "workflow-regression",
      source: { component: "example-plugin" },
      kind: "regression",
      severity: "high",
      summary: "A bounded workflow regression was observed.",
      privacy: "internal",
    };

    expect(adaptDiagnosticEventToSelfImprovementSignal(event, { trusted: false })).toMatchObject({
      version: 1,
      idempotencyKey: "workflow-regression",
      trusted: false,
    });
  });
});
