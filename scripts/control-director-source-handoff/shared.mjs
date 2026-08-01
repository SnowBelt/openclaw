import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT = path.resolve(MODULE_DIR, "../..");
export const CONTROL_DIRECTOR_SOURCE_HANDOFF_POLICY_PATH = path.join(
  CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT,
  "work",
  "control-director",
  "reliability-v1",
  "source-handoff-policy.json",
);
export const SOURCE_HANDOFF_SCHEMA = "openclaw.control-director.source-handoff.v1";
export const SOURCE_HANDOFF_STATES = Object.freeze([
  "ready_local",
  "destination_approval_required",
  "pushing",
  "pushed",
  "draft_pr_ready",
  "blocked",
]);

export const SHA_PATTERN = /^[a-f0-9]{40}$/u;
export const BRANCH_PATTERN = /^codex\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
export const SOURCE_HANDOFF_POLICY_SCHEMA = "openclaw.control-director.source-handoff-policy.v1";

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function redactSensitiveText(value) {
  return normalizeText(value)
    .replace(/(https?:\/\/)[^\s/@]+@/giu, "$1<redacted>@")
    .replace(
      /([?&](?:token|secret|password|apikey|api_key|authorization)=)[^&\s]+/giu,
      "$1<redacted>",
    );
}

export function normalizeRemoteUrl(value) {
  return normalizeText(value)
    .replace(/\/+$/u, "")
    .replace(/\.git$/u, "")
    .toLowerCase();
}

export function immutableSha(value, label) {
  const normalized = normalizeText(value).toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be an immutable 40-character SHA.`);
  }
  return normalized;
}

export function validateSourceHandoffBranch(value, label = "branch") {
  const branch = normalizeText(value);
  if (
    !BRANCH_PATTERN.test(branch) ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.endsWith("/") ||
    branch.endsWith(".")
  ) {
    throw new Error(`${label} must be a safe codex/* branch name.`);
  }
  return branch;
}
