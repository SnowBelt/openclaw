import { describe, expect, it } from "vitest";
import { issueChatKey, issueChatLabel, issueChatPrompt } from "./issue-chat.ts";

const descriptor = {
  source: "pcc" as const,
  sourceId: "project-1:blocker-0",
  title: "Missing approval · Project Command Center",
  detail: "A remote proof permission is still needed.",
  impact: "PCC cannot start the next work item safely.",
  owner: "Control Director",
  recommendedAction: "Review Permission",
  projectId: "project-1",
};

describe("issue chat handoff", () => {
  it("uses a stable source-qualified identity and concise title", () => {
    expect(issueChatKey(descriptor)).toBe("pcc:project-1:blocker-0");
    expect(issueChatLabel(descriptor)).toBe("PCC · Missing approval · Project Command Center");
  });

  it("sends enough context for the first chat turn to act on the issue", () => {
    const prompt = issueChatPrompt(descriptor);
    expect(prompt).toContain("Issue ID: project-1:blocker-0");
    expect(prompt).toContain("Impact: PCC cannot start the next work item safely.");
    expect(prompt).toContain("Recommended next step: Review Permission");
    expect(prompt).toContain("Start with a read-only diagnosis");
  });
});
