import { describe, expect, it } from "vitest";
import {
  PCC_EXECUTION_QUALITY_REQUIREMENTS,
  buildPccExecutionStandard,
  buildPccExecutionStandardPrompt,
  canonicalPccExecutionStandardMetadata,
  evaluatePccExecutionQuality,
  readPccExecutionStandardSnapshot,
  validatePccExecutionCapabilityRegistry,
  type PccExecutionSkillDescriptor,
} from "./execution-standard.js";

const skill = (
  skillKey: string,
  patch: Partial<PccExecutionSkillDescriptor> = {},
): PccExecutionSkillDescriptor => ({
  skillKey,
  name: skillKey,
  description: `${skillKey} workflow`,
  eligible: true,
  modelVisible: true,
  ...patch,
});

describe("PCC execution standard", () => {
  it("selects relevant live skills and the complete workflow automatically", () => {
    const standard = buildPccExecutionStandard({
      scope: "pcc_product",
      title: "Debug the PCC mobile dashboard",
      goal: "Fix overlapping UI, run browser E2E tests, improve performance, and update docs.",
      availableSkills: [
        skill("openclaw-debugging"),
        skill("openclaw-testing"),
        skill("control-ui-e2e"),
        skill("openclaw-test-performance"),
        skill("technical-documentation"),
      ],
    });

    expect(standard.status).toBe("ready");
    expect(standard.workKinds).toEqual(
      expect.arrayContaining(["debugging", "ui_ux", "testing", "performance", "documentation"]),
    );
    expect(standard.selectedSkillKeys).toEqual([
      "control-ui-e2e",
      "openclaw-debugging",
      "openclaw-test-performance",
      "openclaw-testing",
      "technical-documentation",
    ]);
    expect(standard.workflow).toEqual([
      "understand",
      "preflight",
      "plan",
      "execute",
      "verify",
      "judge",
      "repair",
      "record",
    ]);
  });

  it("blocks when the skill catalog is unavailable or an exact installed skill is ineligible", () => {
    const unavailable = buildPccExecutionStandard({
      scope: "pcc_product",
      title: "Generic project",
      availableSkills: null,
    });
    expect(unavailable.status).toBe("blocked");
    expect(unavailable.blockers[0]).toContain("Live skill catalog could not be loaded");

    const disabled = buildPccExecutionStandard({
      scope: "pcc_product",
      title: "Fix a dashboard bug",
      availableSkills: [skill("openclaw-debugging", { eligible: false, disabled: true })],
    });
    expect(disabled.status).toBe("blocked");
    expect(disabled.blockers.join(" ")).toMatch(/disabled/iu);
  });

  it("uses explicit fallback guidance when a specialized skill is not installed", () => {
    const standard = buildPccExecutionStandard({
      scope: "project_work",
      title: "Document the project workflow",
      availableSkills: [],
    });
    expect(standard.status).toBe("ready");
    expect(standard.warnings.join(" ")).toMatch(/not installed/iu);
    expect(standard.selectedSkillKeys).toEqual([]);
  });

  it("discovers eligible domain skills from the live catalog without hardcoding projects", () => {
    const standard = buildPccExecutionStandard({
      scope: "project_work",
      title: "Create a bookkeeping tax reconciliation report",
      availableSkills: [
        skill("bookkeeping-reconciliation", {
          description: "Reconcile bookkeeping tax records and create evidence-backed reports.",
        }),
      ],
    });
    expect(standard.selectedSkillKeys).toContain("bookkeeping-reconciliation");
    expect(standard.selectionTrace.join(" ")).toMatch(/live description matches/iu);
  });

  it("requires all six quality dimensions, all evidence, and a separate judge at 93 or higher", () => {
    const allEvidence = PCC_EXECUTION_QUALITY_REQUIREMENTS.map((item) => item.id);
    const noJudge = evaluatePccExecutionQuality({
      provenEvidenceIds: allEvidence,
      judgePassed: false,
    });
    expect(noJudge.minimumScore).toBe(93);
    expect(noJudge.passed).toBe(false);

    const missingQa = evaluatePccExecutionQuality({
      provenEvidenceIds: allEvidence.filter((id) => id !== "manual_or_browser_verified"),
      judgePassed: true,
    });
    expect(missingQa.scores.qa).toBe(69);
    expect(missingQa.passed).toBe(false);

    const passed = evaluatePccExecutionQuality({
      provenEvidenceIds: allEvidence,
      judgePassed: true,
    });
    expect(passed.minimumScore).toBe(100);
    expect(passed.passed).toBe(true);
  });

  it("keeps one canonical metadata contract and validates future registry contributions", () => {
    expect(canonicalPccExecutionStandardMetadata()).toEqual({
      schemaVersion: 1,
      policy: "automatic_local_first",
      qualityTarget: 93,
      learningPromotionTarget: 93,
      maxRepairPasses: 2,
      contributionContract: "manifest_and_contract_tests_required",
    });
    expect(validatePccExecutionCapabilityRegistry()).toEqual([]);
    expect(
      validatePccExecutionCapabilityRegistry([
        {
          id: "broken",
          title: "Broken",
          phase: "execute",
          appliesTo: ["generic"],
          preferredSkillKeys: [],
          fallback: "",
          why: "",
          evidenceIds: ["missing"],
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        "broken is missing fallback guidance.",
        "broken is missing selection rationale.",
        "broken references unknown evidence missing.",
        "No capability covers workflow phase understand.",
      ]),
    );
  });

  it("builds a deterministic coordinator contract with no unbounded self-repair", () => {
    const standard = buildPccExecutionStandard({
      scope: "pcc_product",
      title: "Test the PCC dashboard",
      availableSkills: [skill("openclaw-testing"), skill("control-ui-e2e")],
    });
    const prompt = buildPccExecutionStandardPrompt(standard);
    expect(prompt).toContain("at least 93/100");
    expect(prompt).toContain("openclaw-testing");
    expect(prompt).toContain("no more than 2 targeted repair passes");
    expect(prompt).toContain("separate judge");
  });

  it("reads only complete canonical snapshots for durable handoffs", () => {
    const standard = buildPccExecutionStandard({
      scope: "pcc_product",
      title: "Test the PCC dashboard",
      availableSkills: [skill("openclaw-testing"), skill("control-ui-e2e")],
    });

    expect(readPccExecutionStandardSnapshot(structuredClone(standard))).toEqual(standard);
    expect(
      readPccExecutionStandardSnapshot({
        ...standard,
        qualityTarget: 92,
      }),
    ).toBeNull();
    expect(
      readPccExecutionStandardSnapshot({
        ...standard,
        capabilities: [{ ...standard.capabilities[0], phase: "unknown" }],
      }),
    ).toBeNull();
  });
});
