import { describe, expect, it } from "vitest";
import {
  PCC_PRODUCTION_EXCELLENCE_MILESTONES,
  validatePccProductionExcellenceRoadmap,
} from "./production-excellence-roadmap.js";

describe("PCC production excellence roadmap", () => {
  it("is a dependency-valid 100-point completion program", () => {
    expect(validatePccProductionExcellenceRoadmap()).toEqual([]);
    expect(PCC_PRODUCTION_EXCELLENCE_MILESTONES.reduce((sum, item) => sum + item.weight, 0)).toBe(
      100,
    );
  });

  it("prioritizes update durability before feature and optimization work", () => {
    expect(PCC_PRODUCTION_EXCELLENCE_MILESTONES.slice(0, 6).map((item) => item.id)).toEqual([
      "PE-00",
      "PE-01",
      "PE-02",
      "PE-03",
      "PE-04",
      "PE-05",
    ]);
    expect(PCC_PRODUCTION_EXCELLENCE_MILESTONES.find((item) => item.id === "PE-01")?.title).toBe(
      "Durable source provenance",
    );
  });

  it("keeps destructive, paid, live, and reboot authority explicit", () => {
    const retention = PCC_PRODUCTION_EXCELLENCE_MILESTONES.find((item) => item.id === "PE-04");
    const routing = PCC_PRODUCTION_EXCELLENCE_MILESTONES.find((item) => item.id === "PE-11");
    const closure = PCC_PRODUCTION_EXCELLENCE_MILESTONES.find((item) => item.id === "PE-18");

    expect(retention?.permissionGate).toContain("explicit destructive-action approval");
    expect(routing?.acceptance.join(" ")).toContain("No automatic paid request");
    expect(closure?.permissionGate).toContain("reboot");
    expect(closure?.vetoGate).toBe(true);
    expect(closure?.dependsOn).not.toContain("PE-17");
  });

  it("rejects unknown and forward dependencies", () => {
    expect(
      validatePccProductionExcellenceRoadmap([
        {
          id: "PE-00",
          title: "Bad",
          weight: 100,
          dependsOn: ["PE-01", "PE-99"],
          scope: ["scope"],
          acceptance: ["proof"],
        },
      ]),
    ).toEqual([
      "Milestone PE-00 has unknown dependency: PE-01",
      "Milestone PE-00 has a non-prior dependency: PE-01",
      "Milestone PE-00 has unknown dependency: PE-99",
      "Milestone PE-00 has a non-prior dependency: PE-99",
    ]);
  });
});
