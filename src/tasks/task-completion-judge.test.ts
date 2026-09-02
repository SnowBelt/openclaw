import { describe, expect, it } from "vitest";
import { judgeTaskCompletion } from "./task-completion-judge.js";

describe("judgeTaskCompletion", () => {
  it("approves direct final answers", () => {
    const result = judgeTaskCompletion({
      userRequest: "Tell me the status",
      finalText: "Done — the status is healthy.",
      status: "succeeded",
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

  it("rejects internal silent markers as user-visible completion", () => {
    const result = judgeTaskCompletion({
      userRequest: "Tell me when the task is finished",
      finalText: "NO_REPLY",
      status: "succeeded",
    });

    expect(result.approved).toBe(false);
    expect(result.verdict.verdict).toBe("REQUEST_MORE_EVIDENCE");
    expect(result.blockedReason).toContain("silent marker");
  });

  it.each([
    "Status: blocked\nThe runtime is waiting on an unavailable dependency.",
    "Status: complete\nThe implementation is not finished yet; I will continue.",
  ])("rejects non-terminal completion claims", (finalText) => {
    const result = judgeTaskCompletion({
      userRequest: "Implement the requested change",
      finalText,
      status: "succeeded",
    });

    expect(result.approved).toBe(false);
    expect(result.verdict.verdict).toBe("REQUEST_MORE_EVIDENCE");
    expect(result.blockedReason).toContain("blocked or incomplete");
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
    });

    expect(result.approved).toBe(true);
    expect(result.verdict.verdict).toBe("APPROVE");
    expect(result.artifactIds).toEqual(["artifact-game-1"]);
  });
});
