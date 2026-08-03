import { describe, expect, it } from "vitest";
import {
  PCC_ATTACHMENTS_CLARIFY_LEGACY_VERSION,
  PCC_ATTACHMENTS_CLARIFY_PROJECT_SCOPED_VERSION,
  migratePccAttachmentsClarifyParams,
  migratePccAttachmentsClarifyResult,
} from "./pcc-attachments-clarify-migration.js";

const baseParams = {
  originalName: "brief.pdf",
  role: "requirement" as const,
  instructions: "Extract the acceptance criteria.",
};

const baseResult = {
  runId: "clarification-run-1",
  clarifiedInstructions: "Extract and list the acceptance criteria.",
  usage: { totalTokens: 10 },
  provenance: {
    provider: "ollama",
    model: "qwen3.6:27b-q8_0",
    generatedAt: "2026-08-03T18:00:00.000Z",
  },
};

describe("PCC attachment clarification wire migration", () => {
  it("keeps the legacy v1 shape unscoped", () => {
    const migrated = migratePccAttachmentsClarifyParams(baseParams);

    expect(migrated).toMatchObject({
      version: PCC_ATTACHMENTS_CLARIFY_LEGACY_VERSION,
      projectId: undefined,
    });
    expect(migratePccAttachmentsClarifyResult(baseResult, migrated.version)).toEqual({
      clarifiedInstructions: baseResult.clarifiedInstructions,
      provenance: baseResult.provenance,
    });
  });

  it("keeps project-scoped v2 identity and receipt fields", () => {
    const migrated = migratePccAttachmentsClarifyParams({
      ...baseParams,
      projectId: "project-pcc",
    });

    expect(migrated).toMatchObject({
      version: PCC_ATTACHMENTS_CLARIFY_PROJECT_SCOPED_VERSION,
      projectId: "project-pcc",
    });
    expect(migratePccAttachmentsClarifyResult(baseResult, migrated.version)).toEqual(baseResult);
  });

  it("does not downgrade a present but invalid project identity", () => {
    const migrated = migratePccAttachmentsClarifyParams({
      ...baseParams,
      projectId: "",
    });

    expect(migrated.version).toBe(PCC_ATTACHMENTS_CLARIFY_PROJECT_SCOPED_VERSION);
    expect(migrated.projectId).toBe("");
  });

  it("fails closed when a project-scoped result loses its run id", () => {
    expect(() =>
      migratePccAttachmentsClarifyResult(
        { ...baseResult, runId: undefined },
        PCC_ATTACHMENTS_CLARIFY_PROJECT_SCOPED_VERSION,
      ),
    ).toThrow("project-scoped attachment clarification must include runId");
  });
});
