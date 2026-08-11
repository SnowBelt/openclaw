import { describe, expect, it } from "vitest";
import {
  classifyPccLocalTask,
  describePccLocalModel,
  selectPccLocalModel,
} from "./model-routing.js";

describe("PCC local model routing", () => {
  it("classifies common project work deterministically", () => {
    expect(classifyPccLocalTask("Implement and debug the TypeScript controller")).toBe("coding");
    expect(classifyPccLocalTask("Run proof and regression tests")).toBe("verification");
    expect(classifyPccLocalTask("Create a visual screenshot review")).toBe("vision");
  });

  it("keeps unknown models routine-only instead of inventing capabilities", () => {
    expect(describePccLocalModel("ollama/unknown")).toMatchObject({
      taskClasses: ["routine"],
      qualityTier: "fast",
    });
  });

  it("routes code and coordination to configured specialized local models", () => {
    const models = ["ollama/qwen3.5:4b", "ollama/qwen3.6:27b-q8_0", "ollama/gemma4:31b-q8_0"];
    expect(
      selectPccLocalModel({ taskTitle: "Implement the fix", availableModelRefs: models }),
    ).toMatchObject({ modelRef: "ollama/qwen3.6:27b-q8_0", taskClass: "coding" });
    expect(
      selectPccLocalModel({ taskTitle: "Coordinate the fan-in", availableModelRefs: models }),
    ).toMatchObject({ modelRef: "ollama/gemma4:31b-q8_0", taskClass: "coordination" });
  });

  it("honors an explicit configured project model without hidden overrides", () => {
    expect(
      selectPccLocalModel({
        taskTitle: "Implement the fix",
        availableModelRefs: ["ollama/qwen3.6:27b", "ollama/custom"],
        preferredModelRef: "ollama/custom",
      }),
    ).toMatchObject({ modelRef: "ollama/custom" });
  });
});
