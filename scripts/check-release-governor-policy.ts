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
const manifest = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "config", "custom-runtime-capabilities.json"), "utf8"),
) as { capabilities?: Array<{ id?: string }> };
if (!manifest.capabilities?.some((entry) => entry.id === "runtime:release-governor")) {
  throw new Error("Custom runtime capability contract is missing runtime:release-governor.");
}

process.stdout.write(
  `RELEASE_GOVERNOR_POLICY_OK version=${policy.version} rules=${policy.classificationRules.length} protected=${policy.protectedPaths.length}\n`,
);
