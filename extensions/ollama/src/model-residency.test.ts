import { describe, expect, it } from "vitest";
import { parseOllamaModelResidencyPayload } from "./model-residency.js";

describe("parseOllamaModelResidencyPayload", () => {
  it("normalizes loaded model ids and bounded memory facts", () => {
    expect(
      parseOllamaModelResidencyPayload({
        models: [
          { name: "gemma4:31b-q8_0", size: 34_000_000_000, size_vram: 33_000_000_000 },
          { model: "qwen3.6:27b-q8_0", size: 29_000_000_000 },
          { name: " " },
        ],
      }),
    ).toMatchObject({
      observedProcessCount: 2,
      residentModels: [
        {
          modelId: "gemma4:31b-q8_0",
          state: "idle",
          estimatedMemoryBytes: 33_000_000_000,
        },
        {
          modelId: "qwen3.6:27b-q8_0",
          state: "idle",
          estimatedMemoryBytes: 29_000_000_000,
        },
      ],
    });
  });

  it("fails closed to an empty observation for malformed payloads", () => {
    expect(parseOllamaModelResidencyPayload({ models: "not-an-array" })).toEqual({
      residentModels: [],
      observedProcessCount: 0,
      warnings: [],
    });
  });
});
