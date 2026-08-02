import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerResearchManagerCli } from "./cli.js";

const replay = vi.hoisted(() => vi.fn());

vi.mock("./runtime.js", () => ({
  getResearchManagerRuntime: () => ({ replay }),
}));

afterEach(() => {
  replay.mockReset();
  vi.restoreAllMocks();
});

describe("Research Manager CLI", () => {
  it("keeps the replay model profile distinct from OpenClaw's global config profile", async () => {
    replay.mockResolvedValue({
      runId: "replay-run",
      query: "Question",
      mode: "certified",
      status: "completed",
      answer: "Answer",
      sources: [],
      claims: [],
      findings: [],
      attempts: [],
      gaps: [],
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
      completedAt: "2026-07-17T00:00:00.000Z",
      repairPasses: 0,
      localModelCalls: 0,
      remoteModelCalls: 1,
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const program = new Command();
    program.option("--profile <name>", "Global config profile");
    registerResearchManagerCli({ api: {} as never, program: program as never });

    await program.parseAsync([
      "node",
      "openclaw",
      "--profile",
      "isolated",
      "research",
      "replay",
      "source-run",
      "--model-profile",
      "sol-only",
    ]);

    expect(program.opts().profile).toBe("isolated");
    expect(replay).toHaveBeenCalledWith("source-run", {
      profile: "sol-only",
      signal: expect.any(AbortSignal),
    });
  });
});
