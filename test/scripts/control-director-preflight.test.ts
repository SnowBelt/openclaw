import { describe, expect, it } from "vitest";
import { evaluateControlDirectorPreflight } from "../../scripts/control-director-preflight.mjs";

const sha = (character: string) => character.repeat(40);

function input() {
  return {
    headSha: sha("a"),
    expectedSha: sha("a"),
    sourceClean: true,
    progress: {
      milestoneCount: 86,
      implementedMilestones: 11,
      certifiedMilestones: 4,
      implementationPercent: 12.79,
      certificationPercent: 4.65,
    },
    roadmapError: undefined,
    packageScripts: [
      "control-director:preflight",
      "control-director:verify",
      "control-director:roadmap-proof",
      "control-director:readiness",
      "control-director:runtime-proof",
      "custom-runtime:update-survival",
    ],
    workflowAutomatic: true,
    lineage: {
      activeSha: sha("b"),
      candidateSha: sha("a"),
      rollbackSha: sha("b"),
      baseTipSha: sha("c"),
      reviewedBaseSha: sha("c"),
    },
    activeIsAncestor: true,
    acceptedHeads: [
      {
        name: "trust-bridge",
        sha: sha("d"),
        isAncestor: true,
        files: ["scripts/deadcode-unused-files.allowlist.mjs"],
      },
    ],
    classifications: [{ name: "trust-bridge", value: "required" }],
  };
}

describe("Control Director one-shot preflight", () => {
  it("returns one passing lineage, progress, and remediation contract", () => {
    expect(evaluateControlDirectorPreflight(input())).toMatchObject({
      schema: "openclaw.control-director-preflight.v1",
      passed: true,
      blockers: [],
      progress: {
        milestoneCount: 86,
        implementationPercent: 12.79,
        certificationPercent: 4.65,
      },
      remediationManifest: {
        approvalClass: "control-director-source-remediation",
        files: [],
      },
    });
  });

  it("enumerates all independent blockers instead of failing at the first one", () => {
    const broken = input();
    broken.headSha = sha("e");
    broken.sourceClean = false;
    broken.roadmapError = "roadmap mismatch";
    broken.packageScripts = [];
    broken.workflowAutomatic = false;
    broken.lineage.baseTipSha = sha("f");
    broken.activeIsAncestor = false;
    broken.acceptedHeads[0]!.isAncestor = false;
    broken.classifications = [];

    const result = evaluateControlDirectorPreflight(broken);
    expect(result.passed).toBe(false);
    expect(result.blockers.map((blocker) => blocker.id)).toEqual([
      "source-identity",
      "source-clean",
      "roadmap-schema",
      "command-contract",
      "automatic-ci",
      "base-tip",
      "active-lineage",
      "accepted-heads",
      "semantic-inventory",
    ]);
    expect(result.remediationManifest.files).toEqual([
      ".github/workflows/control-director-reliability.yml",
      "package.json",
      "scripts/deadcode-unused-files.allowlist.mjs",
      "work/control-director/reliability-v1/continuation.md",
      "work/control-director/reliability-v1/roadmap.json",
    ]);
  });

  it("rejects malformed lineage and invalid semantic classifications together", () => {
    const broken = input();
    broken.lineage.rollbackSha = "not-a-sha";
    broken.classifications[0]!.value = "maybe";
    const result = evaluateControlDirectorPreflight(broken);
    expect(result.blockers.map((blocker) => blocker.id)).toEqual([
      "lineage-identities",
      "semantic-inventory",
    ]);
  });
});
