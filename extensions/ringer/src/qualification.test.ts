import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Bytes } from "./crypto.js";
import { evaluateQualification, verifyQualificationReceipt } from "./qualification.js";
import type { ResolvedRingerConfig, RingerAdapterManifest } from "./types.js";

const digest = (value: string) => sha256Bytes(Buffer.from(value));
const SOURCE_DIGEST = digest("qualification-source");
const CHECK_DIGEST = digest("qualification-check");
const ENVIRONMENT_DIGEST = digest("qualification-environment");
const LOCAL_MODEL = "ollama/qwen3-coder-next:latest";

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    repository: "/repo",
    sourceDigest: SOURCE_DIGEST,
    checkDigest: CHECK_DIGEST,
    environmentDigest: ENVIRONMENT_DIGEST,
    codexModel: "codex/gpt-5.5",
    models: [LOCAL_MODEL],
    tasks: Array.from({ length: 30 }, (_, index) => ({
      key: `task-${index}`,
      eligible: true,
      adversarial: false,
      localModel: LOCAL_MODEL,
      codexDurationMs: 100,
      localDurationMs: 70,
      reviewDurationMs: 0,
      codexTokens: 100,
      localCodexTokens: 60,
      codexReceiptSha256: digest(`codex-receipt-${index}`),
      localReceiptSha256: digest(`local-receipt-${index}`),
      firstAttemptSuccess: index < 26,
      successWithinRetry: index < 29,
      receiptValid: true,
      reviewed: true,
      accepted: true,
      violations: [] as string[],
    })),
    canaries: Array.from({ length: 20 }, (_, index) => ({
      runId: `run-${"a".repeat(32)}${index.toString(16).padStart(4, "0")}`,
      receiptSha256: digest(`canary-receipt-${index}`),
      sourceDigest: SOURCE_DIGEST,
      model: LOCAL_MODEL,
      reconciled: true,
      cleanupVerified: true,
      violations: [] as string[],
    })),
    rollbackVerified: true,
    rollbackReceiptSha256: digest("rollback-receipt"),
    ...overrides,
  };
}

describe("Local AI Assist qualification gates", () => {
  it("promotes only when every quantitative and safety gate passes", () => {
    const input = evidence();
    const bytes = Buffer.from(JSON.stringify(input));
    const receipt = evaluateQualification(input, bytes, new Date("2026-08-23T12:00:00Z"));
    expect(receipt.promotionEligible).toBe(true);
    expect(receipt.gates).toEqual({
      corpus: true,
      receipts: true,
      safety: true,
      firstAttempt: true,
      retry: true,
      speed: true,
      codexUsage: true,
      canaries: true,
      rollback: true,
    });
  });

  it("fails closed on one violation or insufficient canaries", () => {
    const input = evidence();
    input.tasks[0].violations.push("network access");
    input.canaries.pop();
    const receipt = evaluateQualification(input, Buffer.from(JSON.stringify(input)));
    expect(receipt.promotionEligible).toBe(false);
    expect(receipt.gates.safety).toBe(false);
    expect(receipt.gates.canaries).toBe(false);
  });

  it("rejects unknown fields and mismatched evidence bindings", () => {
    expect(() =>
      evaluateQualification({ ...evidence(), unexpected: true }, Buffer.from("{}")),
    ).toThrow(/unknown field/u);

    const mismatched = evidence();
    mismatched.canaries[0].sourceDigest = digest("other-source");
    expect(() => evaluateQualification(mismatched, Buffer.from("{}"))).toThrow(/invalid/u);
  });

  it("requires reviewed accepted receipts and includes review time in speed", () => {
    const input = evidence();
    input.tasks[0].reviewed = false;
    for (const task of input.tasks) {
      task.reviewDurationMs = 100;
    }
    const receipt = evaluateQualification(input, Buffer.from(JSON.stringify(input)));
    expect(receipt.gates.receipts).toBe(false);
    expect(receipt.gates.speed).toBe(false);
  });

  it("requires cleanup proof for the consecutive-canary gate", () => {
    const input = evidence();
    input.canaries.at(-1)!.cleanupVerified = false;
    const receipt = evaluateQualification(input, Buffer.from(JSON.stringify(input)));
    expect(receipt.metrics.consecutiveCleanCanaries).toBe(0);
    expect(receipt.gates.canaries).toBe(false);
  });

  it("rejects a receipt whose reported gates contradict its metrics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-qualification-test-"));
    try {
      const receipt = {
        schemaVersion: 1,
        sourceSha256: "a".repeat(64),
        generatedAt: new Date().toISOString(),
        repository: path.join(root, "repo"),
        sourceDigest: digest("manifest-source"),
        checkDigest: CHECK_DIGEST,
        environmentDigest: ENVIRONMENT_DIGEST,
        codexModel: "codex/gpt-5.5",
        models: [LOCAL_MODEL],
        rollbackReceiptSha256: digest("rollback-receipt"),
        corpusSize: 30,
        metrics: {
          receiptValidityRate: 1,
          safetyViolations: 0,
          firstAttemptSuccessRate: 0.9,
          successWithinRetryRate: 1,
          medianSpeedImprovement: 0,
          codexUsageReduction: 0.4,
          consecutiveCleanCanaries: 20,
          rollbackVerified: true,
        },
        gates: {
          corpus: true,
          receipts: true,
          safety: true,
          firstAttempt: true,
          retry: true,
          speed: true,
          codexUsage: true,
          canaries: true,
          rollback: true,
        },
        promotionEligible: true,
      };
      const receiptPath = path.join(root, "receipt.json");
      const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`);
      await fs.writeFile(receiptPath, bytes, { mode: 0o600 });
      await expect(
        verifyQualificationReceipt({
          config: {
            qualificationReceiptPath: receiptPath,
            expectedQualificationReceiptSha256: sha256Bytes(bytes),
          } as unknown as ResolvedRingerConfig,
          manifest: {
            repo: path.join(root, "repo"),
            tasks: [{ model: "ollama/qwen3-coder-next:latest" }],
            source_digest: digest("manifest-source"),
            check_digest: CHECK_DIGEST,
            environment_digest: ENVIRONMENT_DIGEST,
          } as unknown as RingerAdapterManifest,
        }),
      ).rejects.toThrow(/authorize/u);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a receipt whose check or environment binding drifts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-qualification-binding-test-"));
    try {
      const input = evidence();
      const receipt = evaluateQualification(input, Buffer.from(JSON.stringify(input)));
      const receiptPath = path.join(root, "receipt.json");
      const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`);
      await fs.writeFile(receiptPath, bytes, { mode: 0o600 });
      const manifest = {
        repo: "/repo",
        tasks: [{ model: LOCAL_MODEL }],
        source_digest: SOURCE_DIGEST,
        check_digest: digest("different-check"),
        environment_digest: ENVIRONMENT_DIGEST,
      } as unknown as RingerAdapterManifest;
      await expect(
        verifyQualificationReceipt({
          config: {
            qualificationReceiptPath: receiptPath,
            expectedQualificationReceiptSha256: sha256Bytes(bytes),
          } as unknown as ResolvedRingerConfig,
          manifest,
        }),
      ).rejects.toThrow(/authorize/u);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects impossible speed and Codex-usage reductions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-qualification-metrics-test-"));
    try {
      const input = evidence();
      const receipt = evaluateQualification(input, Buffer.from(JSON.stringify(input)));
      const receiptPath = path.join(root, "receipt.json");
      for (const metric of ["medianSpeedImprovement", "codexUsageReduction"] as const) {
        const forged = {
          ...receipt,
          metrics: { ...receipt.metrics, [metric]: 1.01 },
        };
        const bytes = Buffer.from(`${JSON.stringify(forged)}\n`);
        await fs.writeFile(receiptPath, bytes, { mode: 0o600 });
        await expect(
          verifyQualificationReceipt({
            config: {
              qualificationReceiptPath: receiptPath,
              expectedQualificationReceiptSha256: sha256Bytes(bytes),
            } as unknown as ResolvedRingerConfig,
            manifest: {
              repo: "/repo",
              tasks: [{ model: LOCAL_MODEL }],
              source_digest: SOURCE_DIGEST,
              check_digest: CHECK_DIGEST,
              environment_digest: ENVIRONMENT_DIGEST,
            } as unknown as RingerAdapterManifest,
          }),
        ).rejects.toThrow(/metrics are invalid/u);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
