import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PCC_EXECUTION_QUALITY_REQUIREMENTS,
  buildPccExecutionStandard,
  buildPccExecutionStandardPrompt,
  canonicalPccExecutionStandardMetadata,
  evaluatePccExecutionQuality,
  validatePccExecutionCapabilityRegistry,
  type PccExecutionSkillDescriptor,
} from "../../src/pcc/execution-standard.ts";

function readySkill(skillKey: string, description: string): PccExecutionSkillDescriptor {
  return {
    skillKey,
    name: skillKey,
    description,
    eligible: true,
    modelVisible: true,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const registryErrors = validatePccExecutionCapabilityRegistry();
assert(
  registryErrors.length === 0,
  `invalid execution capability registry: ${registryErrors.join("; ")}`,
);

const standard = buildPccExecutionStandard({
  scope: "pcc_product",
  title: "Repair and verify the PCC mobile dashboard",
  goal: "Debug overlapping UI, improve performance, update the canonical docs, and run browser QA.",
  currentWorkTitle: "Fix layout and prove every button",
  availableSkills: [
    readySkill("openclaw-debugging", "Debug OpenClaw failures and prove the root cause."),
    readySkill("openclaw-testing", "Run targeted OpenClaw tests and verification."),
    readySkill("control-ui-e2e", "Run live browser UI interaction proof."),
    readySkill("openclaw-test-performance", "Measure OpenClaw test performance."),
    readySkill("technical-documentation", "Maintain canonical technical documentation."),
  ],
});
assert(standard.status === "ready", standard.blockers.join("; "));
assert(standard.workflow.length === 8, "execution workflow must contain all eight phases");
assert(standard.selectedSkillKeys.includes("openclaw-debugging"), "debug skill was not selected");
assert(standard.selectedSkillKeys.includes("control-ui-e2e"), "browser skill was not selected");
assert(
  standard.selectedSkillKeys.includes("technical-documentation"),
  "documentation skill was not selected",
);

const unavailable = buildPccExecutionStandard({
  scope: "project_work",
  title: "Debug a project failure",
  availableSkills: null,
});
assert(unavailable.status === "blocked", "missing live skill catalog must fail closed");

const evidenceIds = PCC_EXECUTION_QUALITY_REQUIREMENTS.map((requirement) => requirement.id);
const quality = evaluatePccExecutionQuality({ provenEvidenceIds: evidenceIds, judgePassed: true });
assert(quality.passed && quality.minimumScore === 100, "complete quality evidence must pass");
const incompleteQuality = evaluatePccExecutionQuality({
  provenEvidenceIds: evidenceIds.filter((id) => id !== "tests_passed"),
  judgePassed: true,
});
assert(!incompleteQuality.passed, "missing QA evidence must block completion");

const coordinatorContract = buildPccExecutionStandardPrompt(standard);
assert(coordinatorContract.includes("at least 93/100"), "coordinator contract lost quality target");
assert(coordinatorContract.includes("separate judge"), "coordinator contract lost judge gate");
assert(
  coordinatorContract.includes("no more than 2 targeted repair passes"),
  "coordinator contract lost repair ceiling",
);

const artifactDir = join(
  ".artifacts",
  "control-ui-pcc-execution-standard-smoke",
  new Date().toISOString().replace(/[:.]/gu, "-"),
);
mkdirSync(artifactDir, { recursive: true });
writeFileSync(
  join(artifactDir, "result.json"),
  `${JSON.stringify(
    {
      ok: true,
      metadata: canonicalPccExecutionStandardMetadata(),
      workKinds: standard.workKinds,
      workflow: standard.workflow,
      selectedSkillKeys: standard.selectedSkillKeys,
      quality,
    },
    null,
    2,
  )}\n`,
);
console.log(`PCC_EXECUTION_STANDARD_SMOKE_OK ${artifactDir}`);
