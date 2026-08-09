import { describe, expect, it } from "vitest";
import {
  assertCodexModelPolicy,
  CODEX_DEFAULT_MODEL_ID,
  CODEX_DEFAULT_THINKING_LEVEL,
  readCodexUpgradeReason,
  resolveCodexMaxReasoningEffort,
  resolveCodexModelPolicy,
} from "./codex-model-policy.js";

describe("Codex model policy", () => {
  it("uses Luna with max as the only implicit baseline", () => {
    expect(resolveCodexModelPolicy({ modelId: CODEX_DEFAULT_MODEL_ID })).toEqual({
      status: "baseline",
      modelId: CODEX_DEFAULT_MODEL_ID,
      requiredThinkingLevel: CODEX_DEFAULT_THINKING_LEVEL,
    });
    expect(resolveCodexMaxReasoningEffort(CODEX_DEFAULT_MODEL_ID)).toBe("max");
  });

  it("requires a concrete reason for an approved upgrade candidate", () => {
    expect(resolveCodexModelPolicy({ modelId: "gpt-5.6-sol" }).status).toBe("blocked");
    expect(
      resolveCodexModelPolicy({
        modelId: "gpt-5.6-sol",
        upgradeReason: "critical architecture review",
      }),
    ).toMatchObject({
      status: "upgrade",
      requiredThinkingLevel: "max",
      upgradeReason: "critical architecture review",
    });
    expect(resolveCodexMaxReasoningEffort("gpt-5.6-terra")).toBe("ultra");
  });

  it("blocks lower or unknown models and lower effort", () => {
    expect(resolveCodexModelPolicy({ modelId: "gpt-5.5" })).toMatchObject({
      status: "blocked",
    });
    expect(resolveCodexModelPolicy({ modelId: "gpt-5.6-luna-mini" })).toMatchObject({
      status: "blocked",
    });
    expect(resolveCodexModelPolicy({ modelId: "gpt-5.6-sol-preview" })).toMatchObject({
      status: "blocked",
    });
    expect(() =>
      assertCodexModelPolicy({
        modelId: CODEX_DEFAULT_MODEL_ID,
        thinkLevel: "high",
      }),
    ).toThrow(/requires max effort/u);
    expect(() =>
      assertCodexModelPolicy({
        modelId: "gpt-5.6-sol",
        thinkLevel: "max",
      }),
    ).toThrow(/no concrete reason/u);
  });

  it("reads only the configured upgrade-reason field", () => {
    expect(readCodexUpgradeReason({ codexUpgradeReason: "  security review  " })).toBe(
      "security review",
    );
    expect(readCodexUpgradeReason({ reason: "security review" })).toBeUndefined();
  });
});
