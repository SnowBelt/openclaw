import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { clarifyPccAttachmentInstructions } from "./attachment-instructions.js";

describe("PCC local attachment instruction clarification", () => {
  it("uses only a local model and returns visible provenance", async () => {
    const prepare = vi.fn(async () => ({
      selection: {
        provider: "ollama",
        modelId: "qwen3.6:30b",
        agentDir: "/tmp/agent",
      },
      model: {
        provider: "ollama",
        id: "qwen3.6:30b",
        name: "Qwen 3.6 30B",
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:11434",
      },
      auth: { mode: "none", apiKey: "local" },
    }));
    const complete = vi.fn(async () => ({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Use this image as the color reference for the selected milestone; preserve its palette and verify the final screen against it.",
        },
      ],
      usage: {
        input: 80,
        output: 30,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 110,
      },
      timestamp: Date.now(),
    }));

    const result = await clarifyPccAttachmentInstructions({
      cfg: {} as OpenClawConfig,
      originalName: "palette.png",
      role: "reference",
      instructions: "use colors for this step",
      prepare: prepare as never,
      complete: complete as never,
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });

    expect(result.clarifiedInstructions).toContain("color reference");
    expect(result.provenance).toEqual({
      provider: "ollama",
      model: "qwen3.6:30b",
      generatedAt: "2026-07-27T00:00:00.000Z",
    });
    expect(result.runId).toMatch(/^pcc-attachment-clarification-/u);
    expect(result.usage?.totalTokens).toBe(110);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("fails closed instead of silently using a cloud model", async () => {
    const prepare = vi.fn(async () => ({
      selection: {
        provider: "openai",
        modelId: "gpt-5.6-sol",
        agentDir: "/tmp/agent",
      },
      model: {
        provider: "openai",
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        api: "openai-responses",
      },
      auth: { mode: "api-key", apiKey: "redacted" },
    }));
    const complete = vi.fn();

    await expect(
      clarifyPccAttachmentInstructions({
        cfg: {} as OpenClawConfig,
        originalName: "brief.txt",
        role: "requirement",
        instructions: "follow this",
        prepare: prepare as never,
        complete: complete as never,
      }),
    ).rejects.toThrow("not local");
    expect(complete).not.toHaveBeenCalled();
  });
});
