import { describe, expect, it } from "vitest";
import type { PccProject } from "../../packages/gateway-protocol/src/schema/types.js";
import {
  buildPccCapabilityContract,
  pccCapabilityInventoryFromAgents,
  pccCapabilityInventoryFromModelCatalog,
  PCC_OPERATIONAL_QUALITY_DIMENSIONS,
  PCC_OPERATIONAL_QUALITY_THRESHOLD,
  pccCapabilityContractMetadata,
  pccCapabilityInventoryFromSkillStatus,
  pccCapabilityRequirementIdsForPhase,
  resolvePccCapabilityContract,
  resolvePccProjectCapabilities,
  withPccCapabilityPreflight,
} from "./capability-contract.js";

describe("PCC capability contract", () => {
  it("requires the operational quality dimensions to score at least 93", () => {
    const contract = buildPccCapabilityContract("software-product");

    expect(PCC_OPERATIONAL_QUALITY_THRESHOLD).toBe(93);
    expect(contract.qualityThreshold).toBe(93);
    expect(contract.qualityDimensions).toEqual(PCC_OPERATIONAL_QUALITY_DIMENSIONS);
    expect(contract.qualityDimensions).toEqual(
      expect.arrayContaining([
        "speed",
        "accuracy",
        "first_pass_quality",
        "qa_coverage",
        "reliability",
        "durability",
        "cost_discipline",
        "recoverability",
      ]),
    );
  });

  it("adds workflow-specific requirements without dropping shared gates", () => {
    const dashboard = buildPccCapabilityContract("dashboard-data");
    const trading = buildPccCapabilityContract("trading-finance");
    const snes = buildPccCapabilityContract("snes-studio");

    expect(dashboard.requirements.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "capability-preflight",
        "permission-gate",
        "truth-gated-completion",
        "data-source-contract",
        "browser-accessibility-proof",
      ]),
    );
    expect(trading.requirements.map((item) => item.id)).toContain("no-live-action-guard");
    expect(snes.requirements.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "snes-change-gateway",
        "snes-game-creator:snes-change-gateway",
        "patch-only-delivery",
      ]),
    );
  });

  it("treats built-in processes as planned but fails closed on an unproven required skill", () => {
    const contract = buildPccCapabilityContract("software-product", {
      pccRequiredSkills: [" required-review-skill "],
    });
    const unresolved = resolvePccCapabilityContract({ contract });
    const ready = resolvePccCapabilityContract({
      contract,
      inventory: [{ id: "required-review-skill", kind: "skill", status: "ready" }],
    });

    expect(unresolved.ready).toBe(false);
    expect(unresolved.blockingRequirementIds).toEqual(["required-review-skill"]);
    expect(
      unresolved.entries.find((entry) => entry.requirement.id === "capability-preflight")?.status,
    ).toBe("planned");
    expect(ready.ready).toBe(true);
    expect(ready.selectedCapabilityIds).toContain("required-review-skill");
  });

  it("does not block when a preferred skill is unavailable", () => {
    const resolution = resolvePccCapabilityContract({
      contract: buildPccCapabilityContract("snes-studio"),
    });

    expect(resolution.ready).toBe(true);
    expect(
      resolution.entries.find(
        (entry) => entry.requirement.id === "snes-game-creator:snes-change-gateway",
      )?.status,
    ).toBe("unknown");
  });

  it("normalizes live skill status into deterministic capability inventory", () => {
    expect(
      pccCapabilityInventoryFromSkillStatus([
        { skillKey: "ready", name: "Ready", eligible: true, modelVisible: true },
        { skillKey: "disabled", eligible: false, disabled: true },
        { skillKey: "missing", eligible: false },
      ]),
    ).toEqual([
      { id: "ready", kind: "skill", status: "ready", title: "Ready" },
      {
        id: "disabled",
        kind: "skill",
        status: "blocked",
        reason: "The skill is installed but blocked, disabled, filtered, or platform-incompatible.",
      },
      {
        id: "missing",
        kind: "skill",
        status: "missing",
        reason: "The skill is not currently eligible for model use.",
      },
    ]);
  });

  it("normalizes configured agents and catalog models into exact ready or blocked inventory", () => {
    expect(
      pccCapabilityInventoryFromAgents([
        { id: "main", name: "Control Director" },
        { id: "research" },
      ]),
    ).toEqual([
      { id: "main", kind: "agent", status: "ready", title: "Control Director" },
      { id: "research", kind: "agent", status: "ready" },
    ]);
    expect(
      pccCapabilityInventoryFromModelCatalog([
        { provider: "ollama", id: "gemma", name: "Gemma", available: true },
        { provider: "local", id: "offline", available: false },
      ]),
    ).toEqual([
      { id: "ollama/gemma", kind: "model", status: "ready", title: "Gemma" },
      {
        id: "local/offline",
        kind: "model",
        status: "blocked",
        reason: "The model is present in the catalog but currently unavailable.",
      },
    ]);
  });

  it("selects only phase-relevant requirements for task prompts", () => {
    const contract = buildPccCapabilityContract("software-product");

    expect(pccCapabilityRequirementIdsForPhase(contract, "setup")).toEqual(
      expect.arrayContaining([
        "workflow-contract",
        "scope-and-success-criteria",
        "permission-gate",
      ]),
    );
    expect(pccCapabilityRequirementIdsForPhase(contract, "production-proof")).toEqual(
      expect.arrayContaining(["truth-gated-completion", "upgrade-preservation"]),
    );
  });

  it("records a redaction-safe preflight snapshot in project metadata", () => {
    const project: PccProject = {
      id: "project-1",
      title: "Operational excellence",
      status: "active",
      createdAt: "2026-07-13T00:00:00Z",
      updatedAt: "2026-07-13T00:00:00Z",
      metadata: {
        pccWorkflowTemplateId: "software-product",
        pccRequiredTools: ["git"],
      },
    };
    const resolution = resolvePccProjectCapabilities({
      project,
      inventory: [{ id: "git", kind: "tool", status: "ready" }],
    });
    const updated = withPccCapabilityPreflight(project, resolution, "2026-07-13T01:00:00Z");

    expect(updated.metadata?.pccCapabilityPreflight).toMatchObject({
      ready: true,
      qualityThreshold: 93,
      evaluatedAt: "2026-07-13T01:00:00Z",
    });
    expect(JSON.stringify(updated.metadata)).not.toContain("secret");
    expect(
      pccCapabilityContractMetadata(buildPccCapabilityContract("software-product")),
    ).toMatchObject({ qualityThreshold: 93, workflowTemplateId: "software-product" });
  });
});
