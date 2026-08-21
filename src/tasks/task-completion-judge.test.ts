import { describe, expect, it } from "vitest";
import { judgeTaskCompletion } from "./task-completion-judge.js";

const trustedEvidence = [
  {
    id: "runtime.completion",
    kind: "runtime_completion" as const,
    summary: "controller observed worker goal status=complete and a returned result",
  },
  {
    id: "worker.execution",
    kind: "worker_execution" as const,
    summary: "controller observed successful runtime=embedded, toolCalls=1, toolFailures=0",
  },
];

describe("judgeTaskCompletion", () => {
  it("approves direct final answers", () => {
    const result = judgeTaskCompletion({
      userRequest: "Tell me the status",
      finalText: "Done — the status is healthy.",
      status: "succeeded",
      trustedEvidence,
    });

    expect(result.approved).toBe(true);
    expect(result.verdict.verdict).toBe("APPROVE");
  });

  it("rejects final replies that only promise future work", () => {
    const result = judgeTaskCompletion({
      userRequest: "Create a video game",
      finalText: "I am working on it and will check.",
      status: "succeeded",
    });

    expect(result.approved).toBe(false);
    expect(result.verdict.verdict).toBe("REQUEST_MORE_EVIDENCE");
    expect(result.blockedReason).toContain("future work");
  });

  it("rejects artifact requests without recorded artifacts", () => {
    const result = judgeTaskCompletion({
      userRequest: "Create a video game",
      finalText: "Done.",
      status: "succeeded",
    });

    expect(result.approved).toBe(false);
    expect(result.verdict.verdict).toBe("REQUEST_MORE_EVIDENCE");
    expect(result.blockedReason).toContain("no artifact was recorded");
  });

  it("approves artifact requests with recorded artifacts", () => {
    const result = judgeTaskCompletion({
      userRequest: "Create a video game",
      finalText: "Done — the game is attached.",
      artifactIds: ["artifact-game-1"],
      status: "succeeded",
      trustedEvidence: [
        ...trustedEvidence,
        {
          id: "artifact-game-1",
          kind: "artifact_digest" as const,
          summary: "controller loaded and hashed the referenced artifact bytes",
        },
      ],
    });

    expect(result.approved).toBe(true);
    expect(result.verdict.verdict).toBe("APPROVE");
    expect(result.artifactIds).toEqual(["artifact-game-1"]);
  });

  it("returns out of scope before evaluating a moral or ethical request", () => {
    const result = judgeTaskCompletion({
      userRequest: "Create a report deciding whether this conduct is morally right.",
      finalText: "Done — the report is attached.",
      status: "succeeded",
    });

    expect(result.approved).toBe(false);
    expect(result.verdict.verdict).toBe("OUT_OF_SCOPE");
  });

  it("does not accept worker prose as execution evidence", () => {
    const result = judgeTaskCompletion({
      userRequest: "Fix the failing test",
      finalText: "Done. The test passed.",
      status: "succeeded",
      trustedEvidence: [],
    });

    expect(result.approved).toBe(false);
    expect(result.verdict.verdict).toBe("REQUEST_MORE_EVIDENCE");
  });

  it("keeps technical audits of the ethics boundary in scope", () => {
    const result = judgeTaskCompletion({
      userRequest: "Implement a guard so the Judge never evaluates whether work is ethical.",
      finalText: "Done — the guard is covered by tests.",
      status: "succeeded",
      trustedEvidence,
    });

    expect(result.verdict.verdict).toBe("APPROVE");
  });
});
