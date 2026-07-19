// Operations Room status and score derivation is pure and deterministic so UI,
// tests, and gateway handlers cannot disagree about operational truth.
import type { OperationsFinding, OperationsSeverity, OperationsStatus } from "./types.js";

const SEVERITY_DEDUCTION: Record<OperationsSeverity, number> = {
  info: 0,
  warning: 2,
  critical: 8,
};

const findingFirstObservedAt = new Map<string, number>();

export function operationsStatusForFindings(
  findings: readonly OperationsFinding[],
): OperationsStatus {
  if (findings.some((finding) => finding.severity === "critical")) {
    return "blocked";
  }
  if (findings.some((finding) => finding.severity === "warning")) {
    return "degraded";
  }
  return "healthy";
}

export function operationsStatusForTask(
  status: string,
  terminalOutcome?: string,
): OperationsStatus {
  if (terminalOutcome === "blocked") {
    return "blocked";
  }
  switch (status) {
    case "queued":
    case "running":
      return "working";
    case "succeeded":
      return "healthy";
    case "failed":
    case "timed_out":
    case "lost":
      return "failed";
    case "cancelled":
      return "disabled";
    default:
      return "unknown";
  }
}

export function scoreOperationsFindings(findings: readonly OperationsFinding[]): number {
  const unique = new Map(findings.map((finding) => [finding.id, finding]));
  const deduction = [...unique.values()].reduce(
    (sum, finding) => sum + SEVERITY_DEDUCTION[finding.severity],
    0,
  );
  return Math.max(0, Math.min(100, 100 - deduction));
}

export function capOperationsRows<T>(rows: readonly T[], max = 200): T[] {
  return rows.slice(0, Math.max(0, max));
}

export function stampOperationsFindingHistory(
  findings: readonly OperationsFinding[],
  now: number,
): OperationsFinding[] {
  const activeIds = new Set(findings.map((finding) => finding.id));
  for (const id of findingFirstObservedAt.keys()) {
    if (!activeIds.has(id)) {
      findingFirstObservedAt.delete(id);
    }
  }
  return findings.map((finding) => {
    const firstObservedAt = findingFirstObservedAt.get(finding.id) ?? now;
    findingFirstObservedAt.set(finding.id, firstObservedAt);
    return { ...finding, firstObservedAt, lastObservedAt: now };
  });
}

export function resetOperationsFindingHistoryForTests(): void {
  findingFirstObservedAt.clear();
}
