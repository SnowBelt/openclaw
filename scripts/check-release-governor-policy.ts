import fs from "node:fs";
import path from "node:path";
import { releasePathMatches } from "../src/pcc/release-governance/classifier.js";
import { readReleaseGovernorPolicy } from "../src/pcc/release-governance/policy.js";

const policyPath = path.join(process.cwd(), "config", "release-governor-policy.json");
const policy = readReleaseGovernorPolicy(policyPath);
const requiredProtectedExamples = [
  "AGENTS.md",
  "src/agents/control-director.ts",
  "src/security/policy.ts",
  "src/pcc/release-governance/policy.ts",
  "config/custom-runtime-capabilities.json",
  "scripts/custom-runtime/custom-runtime-promote.sh",
  "src/agents/prompts/system.ts",
  ".agents/skills/release/SKILL.md",
  "src/memory/store.ts",
  "src/integrations/outbound-webhook.ts",
  "src/trading/live-orders.ts",
];

for (const example of requiredProtectedExamples) {
  if (!policy.protectedPaths.some((rule) => releasePathMatches(rule.pattern, example))) {
    throw new Error(`Release Governor policy does not protect ${example}.`);
  }
}
for (const [operation, checks] of Object.entries(policy.requiredChecks)) {
  if (checks.length === 0) {
    throw new Error(`Release Governor operation ${operation} has no required checks.`);
  }
}
if (policy.version !== 3) {
  throw new Error("Release Governor policy must use the phase-aware proof contract version 3.");
}
const localProfile = policy.proofProfiles.mac_studio_control_director;
if (!localProfile) {
  throw new Error("Release Governor policy is missing mac_studio_control_director.");
}
if (
  localProfile.version !== 2 ||
  localProfile.project !== "project-command-center" ||
  localProfile.destination !== "local-only" ||
  localProfile.externalDisclosure
) {
  throw new Error("Mac Studio Control Director proof scope is not fail-closed.");
}
for (const operation of ["stage", "promotion", "restart", "rollback", "finalize"] as const) {
  const checks = localProfile.requiredChecks[operation];
  for (const required of [
    "local_tests",
    "source_typecheck",
    "test_typecheck",
    "policy_checks",
    "capability_checks",
    "immutable_build",
    "immutable_candidate",
  ]) {
    if (!checks.includes(required)) {
      throw new Error(`Mac Studio ${operation} is missing required local proof ${required}.`);
    }
  }
  for (const prohibited of localProfile.prohibitedChecks) {
    if (checks.includes(prohibited)) {
      throw new Error(`Mac Studio ${operation} includes prohibited proof ${prohibited}.`);
    }
  }
  if (operation !== "stage") {
    for (const required of [
      "gateway_readiness",
      "rpc_health",
      "authenticated_local_candidate_control_director_pcc_browser",
      "local_disposable_pcc_e2e",
      "ledger_ready",
    ]) {
      if (!checks.includes(required)) {
        throw new Error(`Mac Studio ${operation} is missing required local proof ${required}.`);
      }
    }
  }
  if (
    operation === "finalize" &&
    !checks.includes("authenticated_local_active_runtime_control_director_pcc_browser")
  ) {
    throw new Error("Mac Studio finalize is missing active-runtime browser proof.");
  }
  if (operation === "finalize" && !checks.includes("post_deployment_health")) {
    throw new Error("Mac Studio finalize is missing post-deployment health proof.");
  }
}
const manifest = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "config", "custom-runtime-capabilities.json"), "utf8"),
) as { capabilities?: Array<{ id?: string }> };
if (!manifest.capabilities?.some((entry) => entry.id === "runtime:release-governor")) {
  throw new Error("Custom runtime capability contract is missing runtime:release-governor.");
}

process.stdout.write(
  `RELEASE_GOVERNOR_POLICY_OK version=${policy.version} rules=${policy.classificationRules.length} protected=${policy.protectedPaths.length}\n`,
);
