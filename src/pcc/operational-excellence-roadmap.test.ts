import { describe, expect, it } from "vitest";
import {
  PCC_OPERATIONAL_EXCELLENCE_MILESTONES,
  validatePccOperationalExcellenceRoadmap,
} from "./operational-excellence-roadmap.js";

describe("PCC operational excellence roadmap", () => {
  it("is a dependency-valid 100-point completion program", () => {
    expect(validatePccOperationalExcellenceRoadmap()).toEqual([]);
    expect(PCC_OPERATIONAL_EXCELLENCE_MILESTONES.reduce((sum, item) => sum + item.weight, 0)).toBe(
      100,
    );
  });

  it("keeps upgrade preservation and paid-model approval as explicit gates", () => {
    const modelMilestone = PCC_OPERATIONAL_EXCELLENCE_MILESTONES.find(
      (item) => item.id === "OE-06",
    );
    const preservationMilestone = PCC_OPERATIONAL_EXCELLENCE_MILESTONES.find(
      (item) => item.id === "OE-07",
    );
    const productionMilestone = PCC_OPERATIONAL_EXCELLENCE_MILESTONES.find(
      (item) => item.id === "OE-09",
    );

    expect(modelMilestone?.acceptance.join(" ")).toContain("No OpenAI API request");
    expect(preservationMilestone?.acceptance.join(" ")).toContain("fails before promotion");
    expect(productionMilestone?.permissionGate).toContain("explicit permission");
  });

  it("rejects unknown and forward dependencies", () => {
    expect(
      validatePccOperationalExcellenceRoadmap([
        {
          id: "OE-00",
          title: "Bad",
          weight: 100,
          dependsOn: ["OE-01", "OE-99"],
          scope: ["scope"],
          acceptance: ["proof"],
        },
      ]),
    ).toEqual([
      "Milestone OE-00 has unknown dependency: OE-01",
      "Milestone OE-00 has a non-prior dependency: OE-01",
      "Milestone OE-00 has unknown dependency: OE-99",
      "Milestone OE-00 has a non-prior dependency: OE-99",
    ]);
  });
});
