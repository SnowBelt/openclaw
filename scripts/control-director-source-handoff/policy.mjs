import { normalizeText, SOURCE_HANDOFF_POLICY_SCHEMA } from "./shared.mjs";

export function normalizeSourceHandoffPolicy(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Source handoff policy must be a JSON object.");
  }
  const policy = raw;
  if (policy.schema !== SOURCE_HANDOFF_POLICY_SCHEMA || policy.version !== 1) {
    throw new Error("Source handoff policy identity is invalid.");
  }
  const canonicalRemoteName = normalizeText(policy.canonicalRemoteName);
  const canonicalRemoteUrl = normalizeText(policy.canonicalRemoteUrl);
  const canonicalRepository = normalizeText(policy.canonicalRepository);
  const headOwner = normalizeText(policy.headOwner);
  const baseBranch = normalizeText(policy.baseBranch);
  if (!canonicalRemoteName || !canonicalRemoteUrl || !canonicalRepository || !headOwner) {
    throw new Error("Source handoff policy is missing canonical remote or repository identity.");
  }
  if (!/^[A-Za-z0-9_.-]+$/u.test(canonicalRemoteName)) {
    throw new Error("Source handoff policy remote name is invalid.");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(canonicalRepository)) {
    throw new Error("Source handoff policy repository must be owner/name.");
  }
  if (!/^[A-Za-z0-9_.-]+$/u.test(headOwner)) {
    throw new Error("Source handoff policy head owner is invalid.");
  }
  if (!/^[A-Za-z0-9._/-]+$/u.test(baseBranch) || baseBranch.includes("..")) {
    throw new Error("Source handoff policy base branch is invalid.");
  }
  const canonicalRemoteMatch = canonicalRemoteUrl.match(
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\.git$/u,
  );
  if (!canonicalRemoteMatch || canonicalRemoteMatch[1] !== headOwner) {
    throw new Error(
      "Source handoff policy must use the canonical HTTPS GitHub remote for its head owner.",
    );
  }
  if (policy.prMode !== "draft" || policy.proofMode !== "local-only") {
    throw new Error("Source handoff policy must require draft PRs and local-only proof.");
  }
  if (policy.requireExplicitDestinationApproval !== true) {
    throw new Error("Source handoff policy must require explicit destination approval.");
  }
  return Object.freeze({
    schema: SOURCE_HANDOFF_POLICY_SCHEMA,
    version: 1,
    canonicalRemoteName,
    canonicalRemoteUrl,
    canonicalRepository,
    headOwner,
    baseBranch,
    prMode: "draft",
    proofMode: "local-only",
    requireExplicitDestinationApproval: true,
  });
}
