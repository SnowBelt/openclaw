import { createHash } from "node:crypto";
import type {
  PccModelRunReceipt,
  PccProjectAiUsageSummary,
} from "../../packages/gateway-protocol/src/schema/types.js";
import type { PccLedger } from "./domain/ledger.js";

const PURPOSE_ORDER: PccModelRunReceipt["purpose"][] = [
  "planning",
  "replan",
  "problem_solving",
  "implementation",
  "qa",
  "final_review",
  "attachment_instruction_clarification",
];

export function pccModelRunReceiptId(projectId: string, sourceRunId: string): string {
  const digest = createHash("sha256").update(`${projectId}:${sourceRunId}`).digest("hex");
  return `model-run-${digest.slice(0, 24)}`;
}

export function recordPccModelRunReceipt(
  ledger: PccLedger,
  receipt: Omit<PccModelRunReceipt, "id"> & { id?: string },
): PccModelRunReceipt {
  if (!ledger.projects.some((project) => project.id === receipt.projectId)) {
    throw new Error(`project not found: ${receipt.projectId}`);
  }
  ledger.modelRunReceipts ??= [];
  const existing = ledger.modelRunReceipts.find(
    (item) => item.projectId === receipt.projectId && item.sourceRunId === receipt.sourceRunId,
  );
  if (existing) {
    return existing;
  }
  const recorded: PccModelRunReceipt = {
    ...receipt,
    id: receipt.id ?? pccModelRunReceiptId(receipt.projectId, receipt.sourceRunId),
  };
  ledger.modelRunReceipts.push(recorded);
  return recorded;
}

function receiptTokens(receipt: PccModelRunReceipt): number | null {
  if (!receipt.usage || receipt.usageSource !== "provider_reported") {
    return null;
  }
  const total = receipt.usage.totalTokens;
  if (typeof total === "number") {
    return total;
  }
  const input = receipt.usage.input;
  const output = receipt.usage.output;
  return typeof input === "number" || typeof output === "number"
    ? (input ?? 0) + (output ?? 0)
    : null;
}

export function summarizePccProjectAiUsage(
  ledger: PccLedger,
  projectId: string,
): PccProjectAiUsageSummary {
  const receipts = (ledger.modelRunReceipts ?? []).filter(
    (receipt) => receipt.projectId === projectId,
  );
  const succeededRuns = receipts.filter((receipt) => receipt.status === "succeeded").length;
  const failedRuns = receipts.filter((receipt) => receipt.status === "failed").length;
  const cancelledRuns = receipts.filter((receipt) => receipt.status === "cancelled").length;
  const codexRuns = receipts.filter((receipt) => receipt.executor === "codex").length;
  const localRuns = receipts.length - codexRuns;
  let totalTokens = 0;
  let codexTokens = 0;
  let localTokens = 0;
  let missingUsageRuns = 0;
  const purposeTotals = new Map<
    PccModelRunReceipt["purpose"],
    { runs: number; codexRuns: number; reportedTokens: number }
  >();
  for (const receipt of receipts) {
    const tokens = receiptTokens(receipt);
    if (tokens === null) {
      missingUsageRuns += 1;
    } else {
      totalTokens += tokens;
      if (receipt.executor === "codex") {
        codexTokens += tokens;
      } else {
        localTokens += tokens;
      }
    }
    const current = purposeTotals.get(receipt.purpose) ?? {
      runs: 0,
      codexRuns: 0,
      reportedTokens: 0,
    };
    current.runs += 1;
    current.codexRuns += receipt.executor === "codex" ? 1 : 0;
    current.reportedTokens += tokens ?? 0;
    purposeTotals.set(receipt.purpose, current);
  }
  const recordingStartedAt = receipts.map((receipt) => receipt.startedAt).toSorted()[0];
  return {
    attemptedRuns: receipts.length,
    succeededRuns,
    failedRuns,
    cancelledRuns,
    // Retain the legacy field as the successful-run count for older consumers.
    completedRuns: succeededRuns,
    codexRuns,
    localRuns,
    ...(receipts.length > 0
      ? { codexSharePercent: Math.round((codexRuns / receipts.length) * 1000) / 10 }
      : {}),
    reportedTokens: { total: totalTokens, codex: codexTokens, local: localTokens },
    missingUsageRuns,
    tokenCoverage:
      receipts.length === 0 || missingUsageRuns === receipts.length
        ? "none"
        : missingUsageRuns > 0
          ? "partial"
          : "complete",
    ...(recordingStartedAt ? { recordingStartedAt } : {}),
    byPurpose: PURPOSE_ORDER.flatMap((purpose) => {
      const totals = purposeTotals.get(purpose);
      return totals ? [{ purpose, ...totals }] : [];
    }),
  };
}
