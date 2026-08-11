import { describe, expect, it } from "vitest";
import { isCoreGatewayMethodClassified } from "./core-descriptors.js";

const PCC_METHODS = [
  "pcc.projects.list",
  "pcc.projects.get",
  "pcc.plans.generate",
  "pcc.plans.start",
  "pcc.plans.get",
  "pcc.plans.cancel",
  "pcc.attachments.upload.begin",
  "pcc.attachments.upload.chunk",
  "pcc.attachments.upload.commit",
  "pcc.attachments.list",
  "pcc.attachments.read",
  "pcc.attachments.update",
  "pcc.attachments.clarify",
  "pcc.attachments.usage.record",
  "pcc.attachments.usage.list",
  "pcc.planningPolicy.get",
  "pcc.planningPolicy.upsert",
  "pcc.ledger.repairCanonicalMetadata",
  "pcc.projects.upsert",
  "pcc.milestones.upsert",
  "pcc.subMilestones.list",
  "pcc.subMilestones.upsert",
  "pcc.permissions.upsert",
  "pcc.evidence.add",
  "pcc.decisions.add",
  "pcc.receipts.add",
  "pcc.lastKnownGood.upsert",
  "pcc.summary.get",
] as const;

describe("PCC gateway descriptors", () => {
  it("classifies every registered PCC handler before Gateway startup", () => {
    for (const method of PCC_METHODS) {
      expect(isCoreGatewayMethodClassified(method), method).toBe(true);
    }
  });
});
