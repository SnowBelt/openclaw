import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

describe("Local AI Assist plugin registration", () => {
  it("exposes only operator CLI, Gateway methods, supervision, and security audit", () => {
    const registerGatewayMethod = vi.fn();
    const registerCli = vi.fn();
    const registerService = vi.fn();
    const registerSecurityAuditCollector = vi.fn();
    const registerTool = vi.fn();
    const on = vi.fn();
    plugin.register(
      createTestPluginApi({
        id: "ringer",
        name: "Local AI Assist",
        pluginConfig: { enabled: false },
        registerGatewayMethod,
        registerCli,
        registerService,
        registerSecurityAuditCollector,
        registerTool,
        on,
      }),
    );
    expect(
      registerGatewayMethod.mock.calls.map(([method, _handler, options]) => [method, options]),
    ).toEqual([
      ["ringer.snapshot", { scope: "operator.read" }],
      ["ringer.prepare", { scope: "operator.approvals" }],
      ["ringer.run", { scope: "operator.approvals" }],
      ["ringer.cancel", { scope: "operator.approvals" }],
    ]);
    expect(registerCli).toHaveBeenCalledOnce();
    expect(registerService).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ringer-supervisor" }),
    );
    expect(registerSecurityAuditCollector).toHaveBeenCalledOnce();
    expect(registerTool).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
  });
});
