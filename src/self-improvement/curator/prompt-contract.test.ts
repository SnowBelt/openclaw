import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CURATOR_PROMPT_BUDGET_CHARS } from "./contract.js";

async function readRepoFile(relativePath: string): Promise<string> {
  const url = new URL(`../../../${relativePath}`, import.meta.url);
  return await readFile(url, "utf8");
}

describe("curator prompt contract", () => {
  it("keeps the canonical instructions compact, model-neutral, and complete", async () => {
    const instructions = await readRepoFile("control/agents/memory-knowledge-curator/AGENTS.md");
    const combined = instructions;

    expect(combined.length).toBeLessThanOrEqual(CURATOR_PROMPT_BUDGET_CHARS);
    expect(combined).toContain("curator_get");
    expect(combined).toContain("curator_decide");
    expect(combined).toContain("exactly once");
    expect(combined).toContain("MEMORY.md");
    expect(combined).toContain("SKILL.md");
    expect(combined).toContain("model-neutral");
    expect(combined).not.toMatch(/gpt-|qwen|ollama|openai\//i);
  });
});
