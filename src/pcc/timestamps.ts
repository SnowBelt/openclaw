export type PccTimestampIssueCode = "receipt_completed_at_missing" | "receipt_completed_at_invalid";

const PCC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Returns one canonical ISO instant, or null when the stored value is unusable. */
export function normalizePccTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !PCC_TIMESTAMP_PATTERN.test(value)) {
    return null;
  }
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
}

export function pccTimestampIssueCode(value: unknown): PccTimestampIssueCode | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "receipt_completed_at_missing";
  }
  return normalizePccTimestamp(value) ? null : "receipt_completed_at_invalid";
}
