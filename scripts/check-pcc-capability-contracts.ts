import fs from "node:fs";
import path from "node:path";
import {
  PCC_CAPABILITY_ADDITION_STANDARDS,
  PCC_CUSTOM_RUNTIME_ADDITION_STANDARD_IDS,
  PCC_WORKFLOW_ADDITION_STANDARD_IDS,
} from "../src/pcc/capability-addition-registry.js";
import { buildPccCapabilityContract } from "../src/pcc/capability-contract.js";
import {
  validatePccCapabilityAddition,
  validatePccCapabilityContract,
} from "../src/pcc/capability-standards.js";
import { parseCustomRuntimeCapabilityManifest } from "../src/pcc/custom-runtime-capabilities.js";
import {
  PCC_OPERATIONAL_EXCELLENCE_MILESTONES,
  validatePccOperationalExcellenceRoadmap,
} from "../src/pcc/operational-excellence-roadmap.js";
import { PCC_WORKFLOW_TEMPLATES } from "../src/pcc/project-workflows.js";

const errors = [
  ...validatePccOperationalExcellenceRoadmap(),
  ...PCC_CAPABILITY_ADDITION_STANDARDS.flatMap(validatePccCapabilityAddition),
  ...PCC_WORKFLOW_TEMPLATES.flatMap((template) =>
    validatePccCapabilityContract(buildPccCapabilityContract(template.id)),
  ),
];
const standardIds = PCC_CAPABILITY_ADDITION_STANDARDS.map((standard) => standard.id);
for (const id of [
  ...PCC_WORKFLOW_ADDITION_STANDARD_IDS,
  ...PCC_CUSTOM_RUNTIME_ADDITION_STANDARD_IDS,
]) {
  if (!standardIds.includes(id)) {
    errors.push(`PCC capability addition standards are missing ${id}.`);
  }
}
if (new Set(standardIds).size !== standardIds.length) {
  errors.push("PCC capability addition standards contain duplicate IDs.");
}
const customManifest = parseCustomRuntimeCapabilityManifest(
  JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "config", "custom-runtime-capabilities.json"), "utf8"),
  ) as unknown,
);
if (!customManifest) {
  errors.push("PCC capability standards could not parse the custom runtime manifest.");
} else {
  const manifestIds = new Set(customManifest.capabilities.map((capability) => capability.id));
  for (const capability of customManifest.capabilities) {
    if (!PCC_CUSTOM_RUNTIME_ADDITION_STANDARD_IDS.includes(capability.id)) {
      errors.push(`Custom runtime capability ${capability.id} has no PCC addition standard.`);
    }
  }
  for (const standardId of PCC_CUSTOM_RUNTIME_ADDITION_STANDARD_IDS) {
    if (!manifestIds.has(standardId)) {
      errors.push(`PCC addition standard ${standardId} has no custom runtime capability.`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`PCC capability standards: ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        schema: "openclaw.pcc.capability-standards-check.v1",
        qualityThreshold: 93,
        workflows: PCC_WORKFLOW_TEMPLATES.map((template) => template.id),
        milestones: PCC_OPERATIONAL_EXCELLENCE_MILESTONES.map((milestone) => milestone.id),
        additionStandards: standardIds,
        result: "passed",
      },
      null,
      2,
    ),
  );
}
