import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "./api.js";
import plugin, { createLazyResearchManagerTool } from "./index.js";

describe("research-manager plugin registration", () => {
  it("loads the complete tool runtime once on first execution", async () => {
    const execute = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const loadRuntime = vi.fn(async () => ({
      createResearchManagerTool: () => ({
        name: "research-manager",
        label: "Research Manager",
        description: "runtime",
        parameters: { type: "object" },
        execute,
      }),
    }));
    const tool = createLazyResearchManagerTool(
      { api: {} as OpenClawPluginApi, ctx: {} as never },
      loadRuntime as never,
    );

    expect(loadRuntime).not.toHaveBeenCalled();
    await tool.execute("call-1", { action: "doctor" });
    await tool.execute("call-2", { action: "doctor" });

    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("maps the research CLI root to the allowlisted plugin ID", () => {
    const manifest = JSON.parse(
      fs.readFileSync(new URL("./openclaw.plugin.json", import.meta.url), "utf8"),
    ) as { commandAliases?: Array<{ name?: string }> };
    expect(manifest.commandAliases).toEqual([{ name: "research" }]);
  });

  it("registers an optional tool, CLI, and restart-recovery service", () => {
    const registerTool = vi.fn();
    const registerCli = vi.fn();
    const registerService = vi.fn();
    plugin.register?.({
      registerTool,
      registerCli,
      registerService,
    } as unknown as OpenClawPluginApi);

    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool.mock.calls[0]?.[1]).toMatchObject({
      name: "research-manager",
      optional: true,
    });
    expect(registerCli).toHaveBeenCalledOnce();
    expect(registerCli.mock.calls[0]?.[1]).toMatchObject({
      descriptors: [
        {
          name: "research",
          description: expect.any(String),
          hasSubcommands: true,
        },
      ],
    });
    expect(registerService).toHaveBeenCalledOnce();
    expect(registerService.mock.calls[0]?.[0]).toMatchObject({
      id: "research-manager-recovery",
      start: expect.any(Function),
    });
  });
});
