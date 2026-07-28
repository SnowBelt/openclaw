import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  auditControlDirectorMilestones,
  MILESTONE_EVIDENCE_CONTRACTS,
  validateMilestoneEvidenceContracts,
} from "../../scripts/control-director-milestone-audit.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function createAuditFixtureRoot(contracts = MILESTONE_EVIDENCE_CONTRACTS) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-control-director-audit-"));
  const roadmapPath = path.join(rootDir, "work/control-director/reliability-v1/roadmap.json");
  fs.mkdirSync(path.dirname(roadmapPath), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT_DIR, "work/control-director/reliability-v1/roadmap.json"),
    roadmapPath,
  );

  for (const contract of contracts) {
    for (const evidencePath of [...contract.implementationPaths, ...contract.corroborationPaths]) {
      const absolutePath = path.join(rootDir, evidencePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, "fixture evidence\n");
    }
  }

  return rootDir;
}

function copyContracts() {
  return MILESTONE_EVIDENCE_CONTRACTS.map((contract) => ({
    id: contract.id,
    implementationPaths: [...contract.implementationPaths],
    corroborationPaths: [...contract.corroborationPaths],
  }));
}

describe("Control Director M01-M106 milestone audit", () => {
  it("maintains and audits the complete ordered reliability inventory", () => {
    const result = auditControlDirectorMilestones({ rootDir: ROOT_DIR });

    expect(result.auditScope).toEqual({
      firstMilestone: "M01",
      lastMilestone: "M106",
      milestoneCount: 106,
    });
    expect(result.milestones.map((milestone) => milestone.id)).toEqual(
      Array.from({ length: 106 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`),
    );
    expect(
      result.milestones.every(
        (milestone) =>
          milestone.implementation.evidence.some(
            (evidence) => evidence.kind === "implementation",
          ) &&
          milestone.implementation.evidence.some((evidence) => evidence.kind === "corroboration"),
      ),
    ).toBe(true);
  });

  it("enumerates multiple missing implementation and corroboration paths", () => {
    const contracts = copyContracts();
    const fixtureRoot = createAuditFixtureRoot(contracts);
    contracts[0]!.implementationPaths = [
      "src/agents/does-not-exist-a.ts",
      "src/agents/does-not-exist-b.ts",
    ];
    contracts[1]!.corroborationPaths = ["test/scripts/does-not-exist.test.ts"];

    try {
      const result = auditControlDirectorMilestones({ rootDir: fixtureRoot, contracts });
      const missingPaths = result.milestones
        .flatMap((milestone) => milestone.missingEvidence)
        .flatMap((evidence) => ("path" in evidence ? [evidence.path] : []));

      expect(missingPaths).toEqual([
        "src/agents/does-not-exist-a.ts",
        "src/agents/does-not-exist-b.ts",
        "test/scripts/does-not-exist.test.ts",
      ]);
      expect(result.milestones[0]!.implementation.status).toBe("blocked");
      expect(result.milestones[1]!.implementation.status).toBe("unassessed");
      expect(result.summary).toMatchObject({ blocked: 1, unassessed: 1 });
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("never promotes path evidence into exact-SHA certification", () => {
    const result = auditControlDirectorMilestones({ rootDir: ROOT_DIR });

    expect(result.source.certificationInferred).toBe(false);
    expect(result.summary).toMatchObject({
      certificationPending: 106,
      certificationPassed: 0,
    });
    expect(
      result.milestones.every(
        (milestone) =>
          milestone.certification.status === "pending" &&
          milestone.certification.requiresExactShaEvidence &&
          !milestone.certification.pathPresenceIsCertification,
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('"certificationStatus":"passed"');
  });

  it("rejects duplicate and unknown evidence-contract milestone IDs together", () => {
    const contracts = copyContracts();
    contracts.push({ ...contracts[0]!, id: "M01" });
    contracts.push({ ...contracts[1]!, id: "M107" });

    expect(() => validateMilestoneEvidenceContracts(contracts)).toThrow(
      /contracts\[106\]\.id is duplicated: M01[\s\S]*contracts\[107\]\.id is unknown: M107/u,
    );
  });
});
