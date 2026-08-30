import { describe, expect, it } from "vitest";
import {
  buildCuratorReviewSessionKey,
  createCuratorReviewTask,
  CURATOR_REVIEW_TIMEOUT_MS,
} from "./review-task.js";

describe("curator review task contract", () => {
  it("builds a bounded, model-neutral review task", () => {
    const task = createCuratorReviewTask("sip_review");

    expect(task).toEqual({
      message: expect.stringContaining("curator_get"),
      extraSystemPrompt: expect.stringContaining("curator_decide"),
      timeoutMs: CURATOR_REVIEW_TIMEOUT_MS,
    });
    expect(`${task.message} ${task.extraSystemPrompt}`).not.toMatch(/gpt-|qwen|ollama|openai\//i);
    expect(task.message).toContain("exactly once");
    expect(task.message).toContain("Do not promote");
  });

  it("isolates retries with an attempt and run identity", () => {
    const first = buildCuratorReviewSessionKey("sip_review", 1, "run-a");
    const retry = buildCuratorReviewSessionKey("sip_review", 2, "run-b");

    expect(first).toBe("agent:memory-knowledge-curator:curator-review:sip_review:attempt-1:run-a");
    expect(retry).not.toBe(first);
  });
});
