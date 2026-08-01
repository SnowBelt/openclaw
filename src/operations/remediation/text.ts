import { redactSensitiveText } from "../../logging/redact.js";

export function boundedRemediationText(
  value: unknown,
  maxLength: number,
  fallback: string,
): string {
  const text = typeof value === "string" ? value : String(value);
  return (
    redactSensitiveText(text, { mode: "tools" }).replace(/\s+/gu, " ").trim().slice(0, maxLength) ||
    fallback
  );
}

export function boundedRemediationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return boundedRemediationText(
    message,
    2_000,
    "Automatic repair failed without a safe error message.",
  );
}
