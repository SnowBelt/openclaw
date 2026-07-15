import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendSelfImprovementAuditEvent } from "./audit-events.js";
import { runSelfImprovementProductionCheck } from "./production-readiness.js";
import { recordSelfImprovementSignal } from "./signals.js";

const tempDirs: string[] = [];
const now = Date.parse("2026-05-07T12:00:00.000Z");

async function tempStateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-self-improvement-readiness-"));
  tempDirs.push(dir);
  return dir;
}

async function appendBackgroundReady(stateDir: string) {
  await appendSelfImprovementAuditEvent({
    stateDir,
    event: {
      createdAt: now,
      actor: "governor",
      kind: "background_cycle",
      targetId: "self-improvement-background",
      summary: "Completed Self-Improvement background cycle.",
      metadata: { success: true, analysisLimit: 25 },
    },
  });
}

describe("self-improvement production readiness", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it("blocks required model and reviewer proof when proof events are missing", async () => {
    const stateDir = await tempStateDir();
    await appendBackgroundReady(stateDir);

    const result = await runSelfImprovementProductionCheck({
      stateDir,
      now,
      requireModelReady: true,
      requireEvalsReady: true,
    });

    expect(result.status).toBe("blocked");
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "Model readiness proof is required, but no model preflight event exists.",
        "Reviewer eval proof is required, but no reviewer eval event exists.",
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("api_key=");
  });

  it("returns ready when health, model readiness, reviewer evals, and maintenance proof are ready", async () => {
    const stateDir = await tempStateDir();
    await appendBackgroundReady(stateDir);
    await appendSelfImprovementAuditEvent({
      stateDir,
      event: {
        createdAt: now,
        actor: "gateway",
        kind: "model_preflight",
        targetId: "self-improvement-models",
        summary: "Checked Self-Improvement model readiness: ready.",
        metadata: { readiness: "ready", ready: true },
      },
    });
    await appendSelfImprovementAuditEvent({
      stateDir,
      event: {
        createdAt: now,
        actor: "governor",
        kind: "reviewer_eval_run",
        targetId: "self-improvement-reviewer",
        summary: "Ran Self-Improvement reviewer evals: ready.",
        metadata: { readiness: "ready", ready: true, passRate: 1 },
      },
    });
    await appendSelfImprovementAuditEvent({
      stateDir,
      event: {
        createdAt: now,
        actor: "cli",
        kind: "retention_maintenance",
        targetId: "self-improvement-stores",
        summary: "Applied Self-Improvement retention maintenance.",
        metadata: { totalBefore: 1, totalAfter: 1, totalPruned: 0 },
      },
    });

    const result = await runSelfImprovementProductionCheck({
      stateDir,
      now,
      requireModelReady: true,
      requireEvalsReady: true,
    });

    expect(result.status).toBe("ready");
    expect(result.ready).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(93);
    expect(result.portfolioReady).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.evidence.map((entry) => entry.key)).toContain("maintenance");
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ key: "quality-target", status: "ready" }),
    );
  });

  it("reports downstream proposal pressure separately from SIG service readiness", async () => {
    const stateDir = await tempStateDir();
    await appendBackgroundReady(stateDir);
    await writeFile(
      join(stateDir, "self-improvement", "proposals.json"),
      `${JSON.stringify({
        version: 1,
        proposals: Array.from({ length: 4 }, (_, index) => ({
          id: `sip_${index}`,
          kind: "implementation",
          status: "pending",
          groupKey: `group-${index}`,
          route: { role: "builder", targetAgentId: "builder", targetAgentLabel: "Builder" },
          createdAt: now,
          updatedAt: now,
        })),
      })}\n`,
      "utf8",
    );

    const result = await runSelfImprovementProductionCheck({
      stateDir,
      now,
      minimumQualityScore: 100,
    });

    expect(result).toMatchObject({ status: "ready", ready: true, score: 100 });
    expect(result.portfolioScore).toBeLessThan(100);
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ key: "portfolio-health", status: result.portfolioStatus }),
    );
  });

  it("does not report the SIG service ready below the executable effectiveness target", async () => {
    const stateDir = await tempStateDir();
    await appendBackgroundReady(stateDir);
    await recordSelfImprovementSignal({
      stateDir,
      now,
      input: {
        version: 1,
        idempotencyKey: "unprocessed-signal",
        source: { component: "production-readiness-test", owner: "qa" },
        kind: "failure",
        severity: "medium",
        summary: "Signal has not reached analysis yet.",
        privacy: "internal",
        trusted: true,
      },
    });

    const result = await runSelfImprovementProductionCheck({ stateDir, now });

    expect(result.score).toBeLessThan(93);
    expect(result).toMatchObject({ status: "degraded", ready: false });
    expect(result.blockers).toContain(
      `SIG effectiveness score ${result.score} is below the 93 target.`,
    );
  });

  it("requires immutable runtime and SIG schema provenance when requested", async () => {
    const stateDir = await tempStateDir();
    await appendBackgroundReady(stateDir);

    const blocked = await runSelfImprovementProductionCheck({
      stateDir,
      now,
      requireRuntimeProvenance: true,
    });
    expect(blocked).toMatchObject({ ready: false, status: "blocked" });
    expect(blocked.blockers).toContain(
      "Managed runtime provenance is missing or does not match SIG schemas.",
    );

    const ready = await runSelfImprovementProductionCheck({
      stateDir,
      now,
      requireRuntimeProvenance: true,
      runtimeProvenance: {
        releaseId: "20260713T123456Z-abcdef123456",
        builtAt: "2026-07-13T12:34:56.000Z",
        packageVersion: "2026.7.13",
        sourceCommit: "a".repeat(40),
        artifactHash: "b".repeat(64),
        snapshotSchemaVersion: 2,
        ledgerSchemaVersion: 1,
        recommendationSchemaVersion: 3,
        signalSchemaVersion: 1,
      },
    });
    expect(ready.status).toBe("ready");
    expect(ready.evidence).toContainEqual(
      expect.objectContaining({ key: "runtime-provenance", status: "ready" }),
    );
  });
});
