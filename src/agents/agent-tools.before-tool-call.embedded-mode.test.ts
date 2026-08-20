/**
 * Tests before_tool_call approval behavior in embedded mode.
 * Ensures gateway approval requests use non-blocking semantics and preserve
 * plugin hook decisions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEmbeddedMode } from "../infra/embedded-mode.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import type { HookRunner } from "../plugins/hooks.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import { markPluginRegistryRetired } from "../plugins/registry-lifecycle.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { setPluginToolMeta } from "../plugins/tools.js";
import { PluginApprovalResolutions } from "../plugins/types.js";
import {
  runBeforeToolCallHook,
  wrapToolWithBeforeToolCallHook,
} from "./agent-tools.before-tool-call.js";
import { callGatewayTool } from "./tools/gateway.js";

vi.mock("../plugins/hook-runner-global.js", async () => {
  const actual = await vi.importActual<typeof import("../plugins/hook-runner-global.js")>(
    "../plugins/hook-runner-global.js",
  );
  return {
    ...actual,
    getGlobalHookRunner: vi.fn(),
  };
});
vi.mock("./tools/gateway.js", () => ({
  callGatewayTool: vi.fn(),
}));

const mockGetGlobalHookRunner = vi.mocked(getGlobalHookRunner);
const mockCallGatewayTool = vi.mocked(callGatewayTool);

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected ${label}`);
  }
  return value as Record<string, unknown>;
}

function requireApprovalRequestCall(label: string): {
  timeoutParams: Record<string, unknown>;
  request: Record<string, unknown>;
  options: Record<string, unknown>;
} {
  const call = mockCallGatewayTool.mock.calls[0];
  if (!call) {
    throw new Error(`expected ${label}`);
  }
  expect(call[0]).toBe("plugin.approval.request");
  return {
    timeoutParams: requireRecord(call[1], `${label} timeout params`),
    request: requireRecord(call[2], `${label} request`),
    options: requireRecord(call[3], `${label} options`),
  };
}

function requireBeforeToolCall(
  mock: ReturnType<typeof vi.fn<HookRunner["runBeforeToolCall"]>>,
  label: string,
): Parameters<HookRunner["runBeforeToolCall"]> {
  const call = mock.mock.calls[0];
  if (!call) {
    throw new Error(`expected ${label}`);
  }
  return call;
}

describe("runBeforeToolCallHook — embedded mode approvals", () => {
  let hookRunner: Pick<HookRunner, "hasHooks" | "runBeforeToolCall">;
  let runBeforeToolCallMock: ReturnType<typeof vi.fn<HookRunner["runBeforeToolCall"]>>;

  beforeEach(() => {
    runBeforeToolCallMock = vi.fn<HookRunner["runBeforeToolCall"]>();
    hookRunner = {
      hasHooks: vi.fn<HookRunner["hasHooks"]>().mockReturnValue(true),
      runBeforeToolCall: runBeforeToolCallMock,
    };
    mockGetGlobalHookRunner.mockReturnValue(hookRunner as HookRunner);
    mockCallGatewayTool.mockReset();
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  afterEach(() => {
    setEmbeddedMode(false);
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  it("blocks approval-required tools in embedded mode when no gateway approval route exists", async () => {
    setEmbeddedMode(true);
    const onResolution = vi.fn();

    runBeforeToolCallMock.mockResolvedValue({
      requireApproval: {
        pluginId: "test-plugin",
        title: "Needs approval",
        description: "Test approval request",
        severity: "info",
        onResolution,
      },
      params: { adjusted: true },
    });
    mockCallGatewayTool.mockRejectedValueOnce(new Error("gateway unavailable"));

    const result = await runBeforeToolCallHook({
      toolName: "exec",
      params: { command: "ls" },
      toolCallId: "call-1",
    });

    expect(result).toEqual({
      blocked: true,
      kind: "failure",
      deniedReason: "plugin-approval",
      reason: "Plugin approval required (gateway unavailable)",
      params: { command: "ls" },
    });
    expect(mockCallGatewayTool).toHaveBeenCalledWith(
      "plugin.approval.request",
      {
        timeoutMs: 130_000,
      },
      {
        agentId: undefined,
        allowedDecisions: undefined,
        description: "Test approval request",
        pluginId: "test-plugin",
        sessionKey: undefined,
        severity: "info",
        timeoutMs: 120_000,
        title: "Needs approval",
        toolCallId: "call-1",
        toolName: "exec",
        twoPhase: true,
      },
      { expectFinal: false },
    );
    expect(onResolution).toHaveBeenCalledTimes(1);
    expect(onResolution).toHaveBeenCalledWith(PluginApprovalResolutions.CANCELLED);
  });

  it("reports approval-required tools without opening an approval request", async () => {
    runBeforeToolCallMock.mockResolvedValue({
      requireApproval: {
        pluginId: "test-plugin",
        title: "Needs approval",
        description: "Review before running",
        severity: "info",
      },
      params: { adjusted: true },
    });

    const result = await runBeforeToolCallHook({
      toolName: "exec",
      params: { command: "ls" },
      toolCallId: "call-report",
      approvalMode: "report",
    });

    expect(result).toEqual({
      blocked: true,
      kind: "failure",
      deniedReason: "plugin-approval",
      reason: "Review before running",
      params: { command: "ls" },
    });
    expect(mockCallGatewayTool).not.toHaveBeenCalled();
  });

  it("defers approval-required tools without opening an approval request", async () => {
    runBeforeToolCallMock.mockResolvedValue({
      requireApproval: {
        pluginId: "test-plugin",
        title: "Needs approval",
        description: "Review before running",
        severity: "info",
      },
      params: { adjusted: true },
    });

    const result = await runBeforeToolCallHook({
      toolName: "exec",
      params: { command: "ls" },
      toolCallId: "call-defer",
      approvalMode: "defer",
    });

    expect(result).toMatchObject({
      blocked: false,
      params: { command: "ls" },
      deferredApproval: {
        toolName: "exec",
        toolCallId: "call-defer",
        baseParams: { command: "ls" },
        overrideParams: { adjusted: true },
      },
    });
    expect(mockCallGatewayTool).not.toHaveBeenCalled();
  });

  it("sends approval to gateway when NOT in embedded mode", async () => {
    setEmbeddedMode(false);

    runBeforeToolCallMock.mockResolvedValue({
      requireApproval: {
        pluginId: "test-plugin",
        title: "Needs approval",
        description: "Test approval request",
        severity: "info",
        timeoutMs: 5_000,
      },
    });

    mockCallGatewayTool.mockResolvedValue({});

    const result = await runBeforeToolCallHook({
      toolName: "exec",
      params: { command: "ls" },
      toolCallId: "call-2",
    });

    expect(result.blocked).toBe(true);
    const approvalCall = requireApprovalRequestCall("non-embedded approval request");
    expect(approvalCall.timeoutParams.timeoutMs).toBe(15_000);
    expect(approvalCall.request.pluginId).toBe("test-plugin");
    expect(approvalCall.request.title).toBe("Needs approval");
    expect(approvalCall.request.description).toBe("Test approval request");
    expect(approvalCall.request.severity).toBe("info");
    expect(approvalCall.request.toolName).toBe("exec");
    expect(approvalCall.request.toolCallId).toBe("call-2");
    expect(approvalCall.request.timeoutMs).toBe(5_000);
    expect(approvalCall.request.twoPhase).toBe(true);
    expect(approvalCall.options.expectFinal).toBe(false);
  });

  it("preserves hook params override after an approval allow decision", async () => {
    setEmbeddedMode(true);

    runBeforeToolCallMock.mockResolvedValue({
      requireApproval: {
        pluginId: "test-plugin",
        title: "Approval",
        description: "desc",
        severity: "info",
      },
      params: { extraField: "injected" },
    });
    mockCallGatewayTool.mockResolvedValueOnce({
      id: "approval-3",
      decision: PluginApprovalResolutions.ALLOW_ONCE,
    });

    const result = await runBeforeToolCallHook({
      toolName: "write",
      params: { path: "/tmp/test.txt", content: "hello" },
      toolCallId: "call-3",
    });

    expect(result.blocked).toBe(false);
    if (!result.blocked) {
      expect(result.params).toEqual({
        path: "/tmp/test.txt",
        content: "hello",
        extraField: "injected",
      });
    }
  });

  it("routes trusted policy approval through the same approval gate as before_tool_call hooks", async () => {
    setEmbeddedMode(true);
    const registry = createEmptyPluginRegistry();
    registry.trustedToolPolicies = [
      {
        pluginId: "trusted-policy",
        pluginName: "Trusted Policy",
        source: "test",
        policy: {
          id: "approval-policy",
          description: "Approval policy",
          evaluate: () => ({
            requireApproval: {
              pluginId: "trusted-policy",
              title: "Policy approval",
              description: "Policy requested approval",
            },
          }),
        },
      },
    ];
    setActivePluginRegistry(registry);
    (hookRunner.hasHooks as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockCallGatewayTool.mockResolvedValueOnce({
      id: "approval-policy",
      decision: PluginApprovalResolutions.ALLOW_ONCE,
    });

    const result = await runBeforeToolCallHook({
      toolName: "bash",
      params: { command: "deploy" },
      toolCallId: "call-policy",
      ctx: { agentId: "main", sessionKey: "main" },
    });

    expect(result).toEqual({
      blocked: false,
      params: { command: "deploy" },
      approvalResolution: PluginApprovalResolutions.ALLOW_ONCE,
    });
    const approvalCall = requireApprovalRequestCall("trusted policy approval request");
    expect(approvalCall.timeoutParams.timeoutMs).toBe(130_000);
    expect(approvalCall.request.pluginId).toBe("trusted-policy");
    expect(approvalCall.request.title).toBe("Policy approval");
    expect(approvalCall.request.description).toBe("Policy requested approval");
    expect(approvalCall.request.toolName).toBe("exec");
    expect(approvalCall.request.toolCallId).toBe("call-policy");
    expect(approvalCall.request.agentId).toBe("main");
    expect(approvalCall.request.sessionKey).toBe("main");
    expect(approvalCall.request.twoPhase).toBe(true);
    expect(approvalCall.options.expectFinal).toBe(false);
    expect(runBeforeToolCallMock).not.toHaveBeenCalled();
  });

  it("requires every trusted policy approval for the same final params", async () => {
    setEmbeddedMode(true);
    const firstResolution = vi.fn();
    const secondResolution = vi.fn();
    const registry = createEmptyPluginRegistry();
    registry.trustedToolPolicies = [
      {
        pluginId: "trusted-a",
        pluginName: "Trusted A",
        source: "test",
        policy: {
          id: "approval-a",
          description: "Approval A",
          evaluate: () => ({
            params: { command: "approved-snapshot" },
            requireApproval: {
              pluginId: "trusted-a",
              title: "First approval",
              description: "Approve the frozen operation",
              onResolution: firstResolution,
            },
          }),
        },
      },
      {
        pluginId: "trusted-b",
        pluginName: "Trusted B",
        source: "test",
        policy: {
          id: "approval-b",
          description: "Approval B",
          evaluate: (event) => ({
            params: event.params,
            requireApproval: {
              pluginId: "trusted-b",
              title: "Second approval",
              description: "Approve the same frozen operation",
              onResolution: secondResolution,
            },
          }),
        },
      },
    ];
    setActivePluginRegistry(registry);
    (hookRunner.hasHooks as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockCallGatewayTool
      .mockResolvedValueOnce({ id: "approval-a", decision: PluginApprovalResolutions.ALLOW_ONCE })
      .mockResolvedValueOnce({ id: "approval-b", decision: PluginApprovalResolutions.ALLOW_ONCE });

    const result = await runBeforeToolCallHook({
      toolName: "bash",
      params: { command: "original" },
      toolCallId: "call-two-policies",
    });

    expect(result).toEqual({
      blocked: false,
      params: { command: "approved-snapshot" },
      approvalResolution: PluginApprovalResolutions.ALLOW_ONCE,
    });
    expect(mockCallGatewayTool).toHaveBeenCalledTimes(2);
    expect(firstResolution).toHaveBeenCalledWith(PluginApprovalResolutions.ALLOW_ONCE);
    expect(secondResolution).toHaveBeenCalledWith(PluginApprovalResolutions.ALLOW_ONCE);
  });

  it("uses the trusted policy registry carried by a plugin tool", async () => {
    setEmbeddedMode(true);
    const requestRegistry = createEmptyPluginRegistry();
    requestRegistry.trustedToolPolicies = [
      {
        pluginId: "browser",
        source: "test",
        policy: {
          id: "request-browser-policy",
          description: "request browser approval",
          evaluate: () => ({
            requireApproval: {
              pluginId: "browser",
              title: "Approve browser operation",
              description: "Approve request-scoped browser operation",
            },
          }),
        },
      },
    ];
    setActivePluginRegistry(createEmptyPluginRegistry());
    (hookRunner.hasHooks as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const execute = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const sourceTool = {
      name: "browser",
      description: "browser",
      parameters: { type: "object", properties: {} },
      execute,
    } as never;
    setPluginToolMeta(sourceTool, {
      pluginId: "browser",
      optional: false,
      trustedPolicyRegistry: requestRegistry,
    });
    const tool = wrapToolWithBeforeToolCallHook(sourceTool, {
      agentId: "main",
      sessionKey: "main",
      loopDetection: { enabled: false },
    });
    mockCallGatewayTool.mockResolvedValueOnce({
      id: "request-browser-policy",
      decision: PluginApprovalResolutions.ALLOW_ONCE,
    });

    await tool.execute("call-request-registry", { action: "open" });

    expect(mockCallGatewayTool).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      "call-request-registry",
      { action: "open" },
      undefined,
      undefined,
    );
  });

  it("isolates a carried request registry from unrelated active trusted policies", async () => {
    const requestPolicy = vi.fn(() => undefined);
    const activePolicy = vi.fn(() => undefined);
    const requestRegistry = createEmptyPluginRegistry();
    requestRegistry.trustedToolPolicies = [
      {
        pluginId: "request-policy",
        source: "test",
        policy: {
          id: "request-guard",
          description: "request guard",
          evaluate: requestPolicy,
        },
      },
    ];
    const activeRegistry = createEmptyPluginRegistry();
    activeRegistry.trustedToolPolicies = [
      {
        pluginId: "active-policy",
        source: "test",
        policy: {
          id: "active-guard",
          description: "active guard",
          evaluate: activePolicy,
        },
      },
    ];
    setActivePluginRegistry(activeRegistry);
    (hookRunner.hasHooks as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = await runBeforeToolCallHook({
      toolName: "browser",
      params: { action: "status" },
      trustedPolicyRegistry: requestRegistry,
    });

    expect(result).toMatchObject({ blocked: false, params: { action: "status" } });
    expect(requestPolicy).toHaveBeenCalledTimes(1);
    expect(activePolicy).not.toHaveBeenCalled();
  });

  it("prefers the active trusted policy over a stale carried duplicate", async () => {
    const stalePolicy = vi.fn(() => undefined);
    const requestRegistry = createEmptyPluginRegistry();
    requestRegistry.trustedToolPolicies = [
      {
        pluginId: "shared-policy",
        source: "stale-request",
        policy: {
          id: "shared-guard",
          description: "stale request guard",
          evaluate: stalePolicy,
        },
      },
    ];
    const activeRegistry = createEmptyPluginRegistry();
    activeRegistry.trustedToolPolicies = [
      {
        pluginId: "shared-policy",
        source: "active",
        policy: {
          id: "shared-guard",
          description: "active guard",
          evaluate: () => ({ block: true, blockReason: "active policy blocked the operation" }),
        },
      },
    ];
    markPluginRegistryRetired(requestRegistry);
    setActivePluginRegistry(activeRegistry);
    (hookRunner.hasHooks as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = await runBeforeToolCallHook({
      toolName: "browser",
      params: { action: "status" },
      trustedPolicyRegistry: requestRegistry,
    });

    expect(result).toMatchObject({
      blocked: true,
      kind: "veto",
      reason: "active policy blocked the operation",
    });
    expect(stalePolicy).not.toHaveBeenCalled();
  });

  it("blocks hook rewrites after a trusted policy approval", async () => {
    setEmbeddedMode(true);
    const registry = createEmptyPluginRegistry();
    registry.trustedToolPolicies = [
      {
        pluginId: "trusted-policy",
        pluginName: "Trusted Policy",
        source: "test",
        policy: {
          id: "freeze-after-approval",
          description: "Freeze approved params",
          evaluate: () => ({
            params: { action: "open", url: "https://example.com" },
            requireApproval: {
              pluginId: "trusted-policy",
              title: "Approve open",
              description: "Approve the open operation",
            },
          }),
        },
      },
    ];
    setActivePluginRegistry(registry);
    (hookRunner.hasHooks as ReturnType<typeof vi.fn>).mockReturnValue(true);
    runBeforeToolCallMock.mockResolvedValueOnce({
      params: { action: "act", request: { kind: "evaluate", fn: "dangerous()" } },
    });
    mockCallGatewayTool.mockResolvedValueOnce({
      id: "approval-freeze",
      decision: PluginApprovalResolutions.ALLOW_ONCE,
    });

    const result = await runBeforeToolCallHook({
      toolName: "browser",
      params: { action: "open", url: "https://example.com" },
      toolCallId: "call-freeze-after-approval",
    });

    expect(result).toEqual({
      blocked: true,
      kind: "veto",
      deniedReason: "plugin-before-tool-call",
      reason: "Tool call blocked because parameters changed after trusted approval",
      params: { action: "open", url: "https://example.com" },
    });
  });

  it("blocks in-place hook mutation after a trusted policy approval", async () => {
    setEmbeddedMode(true);
    const registry = createEmptyPluginRegistry();
    registry.trustedToolPolicies = [
      {
        pluginId: "trusted-policy",
        source: "test",
        policy: {
          id: "approval-before-mutation",
          description: "approve immutable params",
          evaluate: () => ({
            params: { action: "open", url: "https://example.com" },
            requireApproval: {
              pluginId: "trusted-policy",
              title: "Approve open",
              description: "Approve the original URL",
            },
          }),
        },
      },
    ];
    setActivePluginRegistry(registry);
    (hookRunner.hasHooks as ReturnType<typeof vi.fn>).mockReturnValue(true);
    runBeforeToolCallMock.mockImplementationOnce((event: { params: Record<string, unknown> }) => {
      event.params.url = "https://different.example";
      return undefined;
    });
    mockCallGatewayTool.mockResolvedValueOnce({
      id: "approval-before-mutation",
      decision: PluginApprovalResolutions.ALLOW_ONCE,
    });

    const result = await runBeforeToolCallHook({
      toolName: "browser",
      params: { action: "open", url: "https://example.com" },
      toolCallId: "call-in-place-mutation",
    });

    expect(result).toEqual({
      blocked: true,
      kind: "veto",
      deniedReason: "plugin-before-tool-call",
      reason: "Tool call blocked because parameters changed after trusted approval",
      params: { action: "open", url: "https://example.com" },
    });
  });

  it("preserves a non-serializable trusted policy marker only after approval", async () => {
    setEmbeddedMode(true);
    const trustedMarker = Symbol("trusted-policy-marker");
    const registry = createEmptyPluginRegistry();
    registry.trustedToolPolicies = [
      {
        pluginId: "trusted-policy",
        pluginName: "Trusted Policy",
        source: "test",
        policy: {
          id: "marker-policy",
          description: "Marker policy",
          evaluate: (event) => ({
            params: Object.assign({ ...event.params }, { [trustedMarker]: true }),
            requireApproval: {
              pluginId: "trusted-policy",
              title: "Marker approval",
              description: "Attach the trusted marker after approval",
            },
          }),
        },
      },
    ];
    setActivePluginRegistry(registry);
    (hookRunner.hasHooks as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockCallGatewayTool.mockResolvedValueOnce({
      id: "marker-policy",
      decision: PluginApprovalResolutions.ALLOW_ONCE,
    });

    const result = await runBeforeToolCallHook({
      toolName: "bash",
      params: { command: "approved" },
      toolCallId: "call-marker-policy",
      ctx: { agentId: "main", sessionKey: "main" },
    });

    expect(result.blocked).toBe(false);
    if (!result.blocked) {
      expect((result.params as Record<symbol, unknown>)[trustedMarker]).toBe(true);
      expect(JSON.stringify(result.params)).toBe('{"command":"approved"}');
    }
  });

  it("does not restore keys removed by trusted policy params after approval", async () => {
    setEmbeddedMode(true);
    const registry = createEmptyPluginRegistry();
    registry.trustedToolPolicies = [
      {
        pluginId: "trusted-policy",
        pluginName: "Trusted Policy",
        source: "test",
        policy: {
          id: "redacting-policy",
          description: "Redacting policy",
          evaluate: () => ({
            params: { command: "redacted" },
            requireApproval: {
              pluginId: "trusted-policy",
              title: "Redacted approval",
              description: "Approve without restoring removed input",
            },
          }),
        },
      },
    ];
    setActivePluginRegistry(registry);
    (hookRunner.hasHooks as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockCallGatewayTool.mockResolvedValueOnce({
      id: "redacting-policy",
      decision: PluginApprovalResolutions.ALLOW_ONCE,
    });

    const result = await runBeforeToolCallHook({
      toolName: "bash",
      params: { command: "original", secret: "raw-secret-value-123456" },
      toolCallId: "call-redacting-policy",
      ctx: { agentId: "main", sessionKey: "main" },
    });

    expect(result).toEqual({
      blocked: false,
      params: { command: "redacted" },
      approvalResolution: PluginApprovalResolutions.ALLOW_ONCE,
    });
    expect(JSON.stringify(result)).not.toContain("raw-secret-value-123456");
  });

  it("requires approval before skill_workshop applies a proposal", async () => {
    mockCallGatewayTool.mockResolvedValueOnce({
      id: "skill-workshop-approval",
      decision: PluginApprovalResolutions.ALLOW_ONCE,
    });

    const result = await runBeforeToolCallHook({
      toolName: "skill_workshop",
      params: { action: "apply", proposal_id: "weather-20260530-a1b2c3d4e5" },
      toolCallId: "call-skill-apply",
      ctx: {
        agentId: "main",
        sessionKey: "main",
        config: {
          skills: {
            workshop: {
              approvalPolicy: "pending",
            },
          },
        },
      },
    });

    expect(result).toEqual({
      blocked: false,
      params: { action: "apply", proposal_id: "weather-20260530-a1b2c3d4e5" },
      approvalResolution: PluginApprovalResolutions.ALLOW_ONCE,
    });
    const approvalCall = requireApprovalRequestCall("skill_workshop approval request");
    expect(approvalCall.request.pluginId).toBeUndefined();
    expect(approvalCall.request.title).toBe("Apply workspace skill proposal");
    expect(approvalCall.request.description).toBe(
      "Apply a pending workspace skill proposal into live workspace skills.",
    );
    expect(approvalCall.request.severity).toBe("warning");
    expect(approvalCall.request.allowedDecisions).toEqual(["allow-once", "deny"]);
    expect(approvalCall.request.toolName).toBe("skill_workshop");
    expect(approvalCall.request.toolCallId).toBe("call-skill-apply");
    expect(runBeforeToolCallMock).toHaveBeenCalledTimes(1);

    {
      mockCallGatewayTool.mockReset();
      runBeforeToolCallMock.mockReset();
      runBeforeToolCallMock.mockResolvedValue({
        params: { action: "apply", proposal_id: "weather-20260530-a1b2c3d4e5" },
      });
      mockCallGatewayTool.mockResolvedValueOnce({
        id: "skill-workshop-approval",
        decision: PluginApprovalResolutions.ALLOW_ONCE,
      });

      const adjustedResult = await runBeforeToolCallHook({
        toolName: "skill_workshop",
        params: { action: "inspect", proposal_id: "weather-20260530-a1b2c3d4e5" },
        toolCallId: "call-skill-hook-apply",
        ctx: {
          config: {
            skills: {
              workshop: {
                approvalPolicy: "pending",
              },
            },
          },
        },
      });

      expect(adjustedResult).toEqual({
        blocked: false,
        params: { action: "apply", proposal_id: "weather-20260530-a1b2c3d4e5" },
        approvalResolution: PluginApprovalResolutions.ALLOW_ONCE,
      });
      const adjustedApprovalCall = requireApprovalRequestCall(
        "skill_workshop adjusted approval request",
      );
      expect(adjustedApprovalCall.request.title).toBe("Apply workspace skill proposal");
      expect(adjustedApprovalCall.request.toolName).toBe("skill_workshop");
      expect(adjustedApprovalCall.request.toolCallId).toBe("call-skill-hook-apply");
      expect(runBeforeToolCallMock).toHaveBeenCalledTimes(1);
    }
  });

  it("runs trusted policies before skill_workshop lifecycle approval", async () => {
    const registry = createEmptyPluginRegistry();
    registry.trustedToolPolicies = [
      {
        pluginId: "trusted-policy",
        pluginName: "Trusted Policy",
        source: "test",
        policy: {
          id: "block-skill-workshop",
          description: "Block skill workshop lifecycle",
          evaluate: () => ({
            block: true,
            blockReason: "trusted policy blocked skill workshop",
          }),
        },
      },
    ];
    setActivePluginRegistry(registry);
    (hookRunner.hasHooks as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = await runBeforeToolCallHook({
      toolName: "skill_workshop",
      params: { action: "apply", proposal_id: "weather-20260530-a1b2c3d4e5" },
      toolCallId: "call-skill-apply",
      ctx: {
        config: {
          skills: {
            workshop: {
              approvalPolicy: "pending",
            },
          },
        },
      },
    });

    expect(result).toEqual({
      blocked: true,
      kind: "veto",
      deniedReason: "plugin-before-tool-call",
      reason: "trusted policy blocked skill workshop",
      params: { action: "apply", proposal_id: "weather-20260530-a1b2c3d4e5" },
    });
    expect(mockCallGatewayTool).not.toHaveBeenCalled();
    expect(runBeforeToolCallMock).not.toHaveBeenCalled();
  });

  it("does not require skill_workshop lifecycle approval in auto mode", async () => {
    (hookRunner.hasHooks as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = await runBeforeToolCallHook({
      toolName: "skill_workshop",
      params: { action: "reject", proposal_id: "weather-20260530-a1b2c3d4e5" },
      ctx: {
        config: {
          skills: {
            workshop: {
              approvalPolicy: "auto",
            },
          },
        },
      },
    });

    expect(result).toEqual({
      blocked: false,
      params: { action: "reject", proposal_id: "weather-20260530-a1b2c3d4e5" },
    });
    expect(mockCallGatewayTool).not.toHaveBeenCalled();
    expect(runBeforeToolCallMock).not.toHaveBeenCalled();
  });

  it("preserves trusted policy params when before_tool_call hooks leave params unchanged", async () => {
    const registry = createEmptyPluginRegistry();
    registry.trustedToolPolicies = [
      {
        pluginId: "trusted-policy",
        pluginName: "Trusted Policy",
        source: "test",
        policy: {
          id: "param-policy",
          description: "Param policy",
          evaluate: () => ({ params: { command: "patched" } }),
        },
      },
    ];
    setActivePluginRegistry(registry);
    runBeforeToolCallMock.mockResolvedValue(undefined);

    const result = await runBeforeToolCallHook({
      toolName: "bash",
      params: { command: "original", cwd: "/tmp" },
      toolCallId: "call-policy-params",
      ctx: { agentId: "main", sessionKey: "main" },
    });

    expect(result).toEqual({ blocked: false, params: { command: "patched" } });
    const [hookParams, hookContext] = requireBeforeToolCall(
      runBeforeToolCallMock,
      "before_tool_call invocation",
    );
    expect(hookParams.params).toEqual({ command: "patched" });
    expect(hookParams.toolName).toBe("exec");
    expect(hookParams.toolCallId).toBe("call-policy-params");
    expect(typeof hookContext).toBe("object");
  });

  it("keeps original params after an approval allow decision without overrides", async () => {
    setEmbeddedMode(true);

    runBeforeToolCallMock.mockResolvedValue({
      requireApproval: {
        pluginId: "test-plugin",
        title: "Approval",
        description: "desc",
        severity: "info",
      },
    });
    mockCallGatewayTool.mockResolvedValueOnce({
      id: "approval-4",
      decision: PluginApprovalResolutions.ALLOW_ONCE,
    });

    const result = await runBeforeToolCallHook({
      toolName: "read",
      params: { file: "/etc/hosts" },
      toolCallId: "call-4",
    });

    expect(result.blocked).toBe(false);
    if (!result.blocked) {
      expect(result.params).toEqual({ file: "/etc/hosts" });
    }
  });
});
