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
      userRequest: "Create a video",
      finalText: "I am working on it and will check.",
      status: "succeeded",
    });

    expect(result.approved).toBe(false);
    expect(result.verdict.verdict).toBe("REQUEST_MORE_EVIDENCE");
    expect(result.blockedReason).toContain("future work");
  });

  it("rejects artifact requests without recorded artifacts", () => {
    const result = judgeTaskCompletion({
      userRequest: "Create a video",
      finalText: "Done.",
      status: "succeeded",
    });

    expect(result.approved).toBe(false);
    expect(result.verdict.verdict).toBe("REQUEST_MORE_EVIDENCE");
    expect(result.blockedReason).toContain("no artifact was recorded");
  });

  it("approves artifact requests with recorded artifacts", () => {
    const result = judgeTaskCompletion({
      userRequest: "Create a video",
      finalText: "Done — the video is attached.",
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

  it("does not treat read-only observations as concrete implementation evidence", () => {
    const result = judgeTaskCompletion({
      userRequest: "Fix the failing test",
      finalText: "Done.",
      status: "succeeded",
      trustedEvidence: [
        ...trustedEvidence,
        {
          id: "source.read:controller",
          kind: "source_observation" as const,
          summary: "controller observed source read path=src/tasks/pursue-goal-controller.ts",
        },
      ],
    });

    expect(result.approved).toBe(false);
    expect(result.verdict.verdict).toBe("REQUEST_MORE_EVIDENCE");
  });

  it("does not let an unrelated artifact satisfy a source repair", () => {
    const result = judgeTaskCompletion({
      userRequest: "Fix the app login bug",
      finalText: "Done — the app is fixed.",
      artifactIds: ["unrelated-file"],
      status: "succeeded",
      trustedEvidence: [
        ...trustedEvidence,
        {
          id: "artifact-unrelated",
          kind: "artifact_digest" as const,
          summary: "controller loaded and hashed unrelated bytes",
        },
      ],
    });

    expect(result.approved).toBe(false);
    expect(result.verdict.verdict).toBe("REQUEST_MORE_EVIDENCE");
  });

  it("requires mutation and verification for software files, apps, and projects", () => {
    const result = judgeTaskCompletion({
      userRequest: "Create src/tasks/fixed.ts",
      finalText: "Done — the file is ready.",
      artifactIds: ["unrelated-file"],
      status: "succeeded",
      trustedEvidence: [
        ...trustedEvidence,
        {
          id: "artifact-unrelated",
          kind: "artifact_digest" as const,
          summary: "controller loaded and hashed unrelated bytes",
        },
      ],
    });
    expect(result.approved).toBe(false);
    expect(result.verdict.verdict).toBe("REQUEST_MORE_EVIDENCE");
  });

  it("accepts a pure technical audit with bound read evidence", () => {
    const result = judgeTaskCompletion({
      userRequest: "Audit src/tasks/fixed.ts",
      finalText: "The file was reviewed and the contract is satisfied.",
      status: "succeeded",
      trustedEvidence: [
        ...trustedEvidence,
        {
          id: "source.read:fixed",
          kind: "source_observation" as const,
          summary: "controller observed source read path=src/tasks/fixed.ts",
        },
      ],
    });
    expect(result.approved).toBe(true);
  });

  it("does not accept an audit claim from worker prose alone", () => {
    const result = judgeTaskCompletion({
      userRequest: "Audit src/tasks/fixed.ts",
      finalText: "The file was reviewed and is healthy.",
      status: "succeeded",
      trustedEvidence,
    });
    expect(result.approved).toBe(false);
    expect(result.verdict.verdict).toBe("REQUEST_MORE_EVIDENCE");
  });

  it("requires a verified effect and verification for fix-and-verify claims", () => {
    const mutation = {
      id: "source.mutation:controller",
      kind: "source_mutation" as const,
      summary: "controller observed successful source mutation path=src/tasks/foo.ts",
      resultDigest: "a".repeat(64),
      postStateDigest: "b".repeat(64),
    };
    const verification = {
      id: "test.execution:unit",
      kind: "test_execution" as const,
      summary: "controller observed successful test command=pnpm test src/tasks/foo.test.ts",
      resultDigest: "c".repeat(64),
    };
    expect(
      judgeTaskCompletion({
        userRequest: "Fix and verify the failing test",
        finalText: "Done — the fix is verified.",
        status: "succeeded",
        trustedEvidence: [...trustedEvidence, mutation, verification],
      }).approved,
    ).toBe(true);
    expect(
      judgeTaskCompletion({
        userRequest: "Fix and verify the failing test",
        finalText: "Done — the fix is verified.",
        status: "succeeded",
        trustedEvidence: [...trustedEvidence, mutation],
      }).approved,
    ).toBe(false);
  });

  it("keeps technical audits of the ethics boundary in scope", () => {
    const result = judgeTaskCompletion({
      userRequest: "Implement a guard so the Judge never evaluates whether work is ethical.",
      finalText: "Done — the guard is covered by tests.",
      status: "succeeded",
      trustedEvidence: [
        ...trustedEvidence,
        {
          id: "source.mutation:judge-ethics-guard",
          kind: "source_mutation" as const,
          summary:
            "controller observed successful source mutation path=src/agents/judge-contract.ts",
          resultDigest: "b".repeat(64),
          postStateDigest: "c".repeat(64),
        },
        {
          id: "source.judge-ethics-guard",
          kind: "test_execution" as const,
          summary:
            "controller verified the Judge technical-only guard and its tests resultDigest=sha256:" +
            "a".repeat(64),
          resultDigest: "a".repeat(64),
        },
      ],
    });

    expect(result.verdict.verdict).toBe("APPROVE");
  });
});
