import { describe, expect, it } from "vitest";
import {
  createCuratorQualificationProposals,
  parseCuratorQualificationArgs,
} from "../../scripts/curator-model-qualification.ts";

describe("curator model qualification harness", () => {
  it("accepts repeated replacement-model identities without an allowlist", () => {
    expect(
      parseCuratorQualificationArgs(
        ["--model", "local/model-a", "--model", "other/model-b", "--timeout", "30"],
        {},
      ),
    ).toEqual({
      help: false,
      models: ["local/model-a", "other/model-b"],
      timeoutSeconds: 30,
    });
  });

  it("builds all four bounded safety scenarios", () => {
    const proposals = createCuratorQualificationProposals();
    expect(Object.keys(proposals)).toEqual([
      "bounded-review",
      "insufficient-evidence",
      "sensitive-evidence",
      "replacement-model",
    ]);
    expect(proposals["insufficient-evidence"].requiredEvidence).toEqual([]);
    expect(proposals["sensitive-evidence"].summary).toContain("token=[redacted]");
    expect(Object.values(proposals).every((proposal) => proposal.approvalRequired)).toBe(true);
  });
});
