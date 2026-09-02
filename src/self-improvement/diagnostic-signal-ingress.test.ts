import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  stageDiagnosticSignalInput,
  startDiagnosticSignalIngress,
} from "./diagnostic-signal-ingress.js";
import type { SelfImprovementSignalInput } from "./signals.js";

const roots: string[] = [];

function input(summary = "Pattern Lab workflow failed"): SelfImprovementSignalInput {
  return {
    version: 1,
    idempotencyKey: "workflow:patternlab:run-85:failed",
    source: { component: "patternlab", subsystem: "production" },
    kind: "failure",
    severity: "high",
    summary,
    privacy: "internal",
    trusted: true,
  };
}

async function createStateDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "diagnostic-signal-ingress-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("diagnostic signal ingress", () => {
  it("replays a signal durably staged before process restart", async () => {
    const stateDir = await createStateDir();
    stageDiagnosticSignalInput({ stateDir, input: input() });
    const recordSignal = vi.fn(
      async (_params: { input: SelfImprovementSignalInput }) => ({}) as never,
    );
    const ingress = startDiagnosticSignalIngress({ stateDir, recordSignal, intervalMs: 60_000 });

    await ingress.drain();
    ingress.stop();

    expect(recordSignal).toHaveBeenCalledTimes(1);
    expect(recordSignal.mock.calls[0]?.[0].input.summary).toBe("Pattern Lab workflow failed");
    const entries = await fs.readdir(
      path.join(stateDir, "self-improvement", "diagnostic-signal-ingress"),
    );
    expect(entries.filter((entry) => entry.endsWith(".json"))).toEqual([]);
  });

  it("retains a staged signal when delivery fails and retries it", async () => {
    const stateDir = await createStateDir();
    stageDiagnosticSignalInput({ stateDir, input: input() });
    const recordSignal = vi
      .fn()
      .mockRejectedValueOnce(new Error("store unavailable"))
      .mockResolvedValue({});
    const ingress = startDiagnosticSignalIngress({ stateDir, recordSignal, intervalMs: 60_000 });

    await ingress.drain();
    expect(recordSignal).toHaveBeenCalledTimes(1);
    await ingress.drain();
    ingress.stop();

    expect(recordSignal).toHaveBeenCalledTimes(2);
    const entries = await fs.readdir(
      path.join(stateDir, "self-improvement", "diagnostic-signal-ingress"),
    );
    expect(entries.filter((entry) => entry.endsWith(".json"))).toEqual([]);
  });

  it("quarantines corrupt evidence instead of discarding or delivering it", async () => {
    const stateDir = await createStateDir();
    const filePath = stageDiagnosticSignalInput({ stateDir, input: input() });
    const raw = await fs.readFile(filePath, "utf8");
    await fs.writeFile(filePath, raw.replace("Pattern Lab workflow failed", "tampered"));
    const recordSignal = vi.fn(
      async (_params: { input: SelfImprovementSignalInput }) => ({}) as never,
    );
    const ingress = startDiagnosticSignalIngress({ stateDir, recordSignal, intervalMs: 60_000 });

    await ingress.drain();
    ingress.stop();

    expect(recordSignal).not.toHaveBeenCalled();
    const entries = await fs.readdir(path.dirname(filePath));
    expect(entries.some((entry) => entry.includes(".quarantine-"))).toBe(true);
  });

  it("redacts secrets before writing the durable ingress record", async () => {
    const stateDir = await createStateDir();
    const filePath = stageDiagnosticSignalInput({
      stateDir,
      input: input("failed with token=super-secret-token"),
    });

    const raw = await fs.readFile(filePath, "utf8");
    expect(raw).not.toContain("super-secret-token");
  });

  it("drains a hash-bound event staged by an external workflow producer", async () => {
    const stateDir = await createStateDir();
    const externalWorkflowDir = await createStateDir();
    stageDiagnosticSignalInput({ stateDir: externalWorkflowDir, input: input() });
    const stagedDirectory = path.join(
      externalWorkflowDir,
      "self-improvement",
      "diagnostic-signal-ingress",
    );
    const [entry] = await fs.readdir(stagedDirectory);
    await fs.rename(path.join(stagedDirectory, entry), path.join(externalWorkflowDir, entry));
    const recordSignal = vi.fn(
      async (_params: { input: SelfImprovementSignalInput }) => ({}) as never,
    );
    const ingress = startDiagnosticSignalIngress({
      stateDir,
      externalWorkflowDir,
      recordSignal,
      intervalMs: 60_000,
    });

    await ingress.drain();
    ingress.stop();

    expect(recordSignal).toHaveBeenCalledTimes(1);
    expect(recordSignal.mock.calls[0]?.[0].input.source.component).toBe("patternlab");
    expect(
      (await fs.readdir(externalWorkflowDir)).filter((name) => name.endsWith(".json")),
    ).toEqual([]);
  });
});
