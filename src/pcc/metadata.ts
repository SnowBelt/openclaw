import type {
  PccMilestone,
  PccSubMilestone,
} from "../../packages/gateway-protocol/src/schema/types.js";

type PccWorkItem = PccMilestone | PccSubMilestone;

export function pccMetadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizePccResponsibility(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) {
    return "";
  }
  if (raw.includes("local") && raw.includes("model")) {
    return "local_model";
  }
  if (raw.includes("codex") && (raw.includes("high") || raw.includes("reasoning"))) {
    return "high_reasoning_codex";
  }
  if (raw.includes("codex")) {
    return "codex";
  }
  if (raw.includes("remote")) {
    return "remote_proof";
  }
  if (raw.includes("user")) {
    return "user";
  }
  return "local_openclaw_agent";
}

export function pccResponsibilityForItem(item: PccWorkItem): string {
  const metadata = pccMetadataObject(item.metadata);
  return (
    normalizePccResponsibility(metadata.pccResponsibility) ||
    normalizePccResponsibility(metadata.recommendedWorker) ||
    normalizePccResponsibility(metadata.pccRecommendedWorker) ||
    normalizePccResponsibility(item.owner) ||
    ""
  );
}
