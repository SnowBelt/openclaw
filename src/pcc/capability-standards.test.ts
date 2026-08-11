import { describe, expect, it } from "vitest";
import { buildPccCapabilityContract } from "./capability-contract.js";
import {
  validatePccCapabilityAddition,
  validatePccCapabilityContract,
  type PccCapabilityAdditionDefinition,
} from "./capability-standards.js";
import { PCC_WORKFLOW_TEMPLATES } from "./project-workflows.js";

const validAddition: PccCapabilityAdditionDefinition = {
  id: "example-browser-proof",
  kind: "proof",
  version: "1.0.0",
  owner: "control-ui",
  trigger: "A dashboard surface changes.",
  requiredInputs: ["Built Control UI", "Authenticated local URL"],
  permissionClass: "local_write",
  costClass: "local",
  localFirstRoute: "Use local Chrome and the maintained Control UI smoke.",
  fallback: "Stop with the missing browser or credential blocker.",
  tests: ["pnpm test ui/src/ui/views/pcc.test.ts"],
  proofSurfaces: ["Browser DOM", "Screenshot"],
  qualityDimensions: ["accuracy", "qa_coverage", "reliability"],
  observability: ["Exit code", "Screenshot path", "Source SHA"],
  upgradeImpact: "The dashboard surface manifest must retain the route and assets.",
  rollback: "Restore the last-known-good immutable runtime pointer.",
  docs: ["docs/automation/pcc-operational-excellence.md"],
};

describe("PCC capability standards", () => {
  it("keeps every standard workflow contract valid", () => {
    expect(
      PCC_WORKFLOW_TEMPLATES.flatMap((template) =>
        validatePccCapabilityContract(buildPccCapabilityContract(template.id)),
      ),
    ).toEqual([]);
  });

  it("accepts a complete future capability definition", () => {
    expect(validatePccCapabilityAddition(validAddition)).toEqual([]);
  });

  it("rejects additions that omit owner, proof, observability, fallback, or paid permission", () => {
    expect(
      validatePccCapabilityAddition({
        ...validAddition,
        id: "paid-model",
        owner: "",
        costClass: "metered",
        permissionClass: "none",
        fallback: "",
        tests: [],
        proofSurfaces: [],
        observability: [],
      }),
    ).toEqual([
      "paid-model is missing owner.",
      "paid-model is missing fallback.",
      "paid-model is missing tests.",
      "paid-model is missing proofSurfaces.",
      "paid-model is missing observability.",
      "paid-model has metered cost without a paid or credentialed permission gate.",
    ]);
  });

  it("requires a fallback or stop rule for required external capabilities", () => {
    const contract = buildPccCapabilityContract("software-product", {
      pccRequiredModels: ["local/model"],
    });
    const requirement = contract.requirements.find((item) => item.id === "local/model");
    if (!requirement) {
      throw new Error("expected explicit required model");
    }
    const invalid = {
      ...contract,
      requirements: contract.requirements.map((item) =>
        item.id === requirement.id ? Object.assign({}, item, { fallback: "" }) : item,
      ),
    };

    expect(validatePccCapabilityContract(invalid)).toContain(
      "Required external capability local/model must declare an approved fallback or stop rule.",
    );
  });
});
