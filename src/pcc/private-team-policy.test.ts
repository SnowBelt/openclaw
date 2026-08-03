import { describe, expect, it } from "vitest";
import type { PccAttachment } from "../../packages/gateway-protocol/src/index.js";
import type { PccLedger } from "./domain/ledger.js";
import {
  DEFAULT_PCC_PRIVATE_TEAM_POLICY,
  attachmentCapacityError,
  normalizePccPrivateTeamPolicy,
  projectCapacityError,
  projectAttachmentUsage,
} from "./private-team-policy.js";

function ledgerWithProjects(count: number): PccLedger {
  return {
    version: 1,
    projects: Array.from({ length: count }, (_, index) => ({
      id: `project-${index}`,
      title: `Project ${index}`,
      status: "active" as const,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    })),
    milestones: [],
    subMilestones: [],
    permissions: [],
    evidence: [],
    receipts: [],
    decisions: [],
    lastKnownGood: [],
  };
}

function attachment(id: string, sizeBytes: number): PccAttachment {
  return {
    id,
    logicalId: id,
    version: 1,
    projectId: "project-1",
    originalName: `${id}.txt`,
    title: id,
    mimeType: "text/plain",
    sizeBytes,
    sha256: id.padEnd(64, "0").slice(0, 64),
    role: "reference",
    scope: "project",
    instructions: "",
    modelAccess: "project_policy",
    sensitivity: "normal",
    status: "ready",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("PCC private-team policy", () => {
  it("always falls back to the complete bounded policy", () => {
    expect(DEFAULT_PCC_PRIVATE_TEAM_POLICY.memberLimit).toBe(6);
    expect(normalizePccPrivateTeamPolicy(null)).toEqual(DEFAULT_PCC_PRIVATE_TEAM_POLICY);
    expect(
      normalizePccPrivateTeamPolicy({
        ...DEFAULT_PCC_PRIVATE_TEAM_POLICY,
        maxProjects: 10_000,
      }),
    ).toEqual(DEFAULT_PCC_PRIVATE_TEAM_POLICY);
  });

  it("enforces the private workspace project envelope", () => {
    const ledger = ledgerWithProjects(DEFAULT_PCC_PRIVATE_TEAM_POLICY.maxProjects);
    expect(projectCapacityError(ledger, undefined)).toContain("100 active projects");
    expect(projectCapacityError(ledger, ledger.projects[0])).toBeNull();
    expect(
      projectCapacityError(
        ledger,
        ledger.projects[0] && { ...ledger.projects[0], status: "archived" },
      ),
    ).toContain("100 active projects");
  });

  it("reports attachment count and storage limits without counting tombstones", () => {
    const attachments = [
      attachment("one", 10),
      { ...attachment("removed", 500), status: "tombstoned" as const },
    ];
    expect(projectAttachmentUsage(attachments, "project-1")).toEqual({ count: 1, bytes: 10 });
    expect(
      attachmentCapacityError(
        Array.from(
          { length: DEFAULT_PCC_PRIVATE_TEAM_POLICY.maxAttachmentsPerProject },
          (_, index) => attachment(`file-${index}`, 1),
        ),
        "project-1",
        1,
      ),
    ).toContain("limited to 200");
    expect(
      attachmentCapacityError(
        [attachment("large", DEFAULT_PCC_PRIVATE_TEAM_POLICY.maxAttachmentBytesPerProject)],
        "project-1",
        1,
      ),
    ).toContain("1 GiB");
  });
});
