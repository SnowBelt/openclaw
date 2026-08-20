// Verifies trusted browser policies stay attached when gateway tool resolution exposes core tools only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { PluginRegistry } from "../plugins/registry-types.js";
import { getTrustedPolicyRegistryForTool } from "../plugins/tools.js";

const hoisted = vi.hoisted(() => ({
  resolvePluginTools: vi.fn(),
}));

vi.mock("../plugins/tools.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../plugins/tools.js")>();
  return {
    ...actual,
    resolvePluginTools: (...args: unknown[]) => hoisted.resolvePluginTools(...args),
  };
});

const { createOpenClawTools } = await import("./openclaw-tools.js");

describe("createOpenClawTools trusted policy attachment", () => {
  beforeEach(() => {
    hoisted.resolvePluginTools.mockReset();
  });

  it("attaches the trusted registry to core tools when plugin tools are disabled", () => {
    const trustedPolicyRegistry = { trustedToolPolicies: [] } as unknown as PluginRegistry;
    hoisted.resolvePluginTools.mockImplementation((...args: unknown[]) => {
      const params = args[0] as {
        trustedPolicyRegistryRef?: { current?: PluginRegistry };
      };
      if (params.trustedPolicyRegistryRef) {
        params.trustedPolicyRegistryRef.current = trustedPolicyRegistry;
      }
      return [];
    });

    const tools = createOpenClawTools({
      config: {
        plugins: { allow: ["browser"] },
      } as OpenClawConfig,
      agentSessionKey: "agent:main:main",
      disablePluginTools: true,
      includeTrustedToolPolicies: true,
      wrapBeforeToolCallHook: false,
    });
    const nodes = tools.find((tool) => tool.name === "nodes");

    if (!nodes) {
      throw new Error("expected the core nodes tool");
    }
    expect(getTrustedPolicyRegistryForTool(nodes)).toBe(trustedPolicyRegistry);
    expect(hoisted.resolvePluginTools).toHaveBeenCalledTimes(1);
  });
});
