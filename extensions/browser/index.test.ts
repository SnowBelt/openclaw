// Browser tests cover index plugin behavior.
import fs from "node:fs";
import path from "node:path";
import { wrapToolWithBeforeToolCallHook } from "openclaw/plugin-sdk/agent-harness-runtime";
import {
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
} from "openclaw/plugin-sdk/hook-runtime";
import type { PluginTrustedToolPolicyRegistration } from "openclaw/plugin-sdk/plugin-entry";
import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { createEmptyPluginRegistry } from "openclaw/plugin-sdk/plugin-test-runtime";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserPluginNodeHostCommands,
  browserPluginReload,
  browserSecurityAuditCollectors,
  registerBrowserPlugin,
} from "./plugin-registration.js";
import type { OpenClawPluginApi } from "./runtime-api.js";
import setupPlugin from "./setup-api.js";
import { approveBrowserStewardRuntimeParams } from "./src/browser/browser-steward-approval.js";

type BrowserAutoEnableProbe = Parameters<OpenClawPluginApi["registerAutoEnableProbe"]>[0];

const runtimeApiMocks = vi.hoisted(() => ({
  createBrowserPluginService: vi.fn(() => ({ id: "browser-control", start: vi.fn() })),
  createBrowserTool: vi.fn(() => ({
    name: "browser",
    description: "browser",
    parameters: { type: "object", properties: {} },
    execute: vi.fn(async () => ({ type: "json", value: { ok: true } })),
  })),
  collectBrowserSecurityAuditFindings: vi.fn(() => []),
  handleBrowserGatewayRequest: vi.fn(),
  registerBrowserCli: vi.fn(),
  runBrowserProxyCommand: vi.fn(async () => "ok"),
  stopBrowserControlService: vi.fn(async () => undefined),
}));

vi.mock("./register.runtime.js", async () => {
  const actual =
    await vi.importActual<typeof import("./register.runtime.js")>("./register.runtime.js");
  return {
    ...actual,
    collectBrowserSecurityAuditFindings: runtimeApiMocks.collectBrowserSecurityAuditFindings,
    createBrowserPluginService: runtimeApiMocks.createBrowserPluginService,
    createBrowserTool: runtimeApiMocks.createBrowserTool,
    handleBrowserGatewayRequest: runtimeApiMocks.handleBrowserGatewayRequest,
    runBrowserProxyCommand: runtimeApiMocks.runBrowserProxyCommand,
  };
});

vi.mock("./src/cli/browser-cli.js", () => ({
  registerBrowserCli: runtimeApiMocks.registerBrowserCli,
}));

vi.mock("./src/control-service.js", () => ({
  stopBrowserControlService: runtimeApiMocks.stopBrowserControlService,
}));

beforeAll(async () => {
  await import("./register.runtime.js");
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function createApi() {
  const registerCli = vi.fn();
  const registerGatewayMethod = vi.fn();
  const registerService = vi.fn();
  const registerTool = vi.fn();
  const registerTrustedToolPolicy = vi.fn();
  const api = createTestPluginApi({
    id: "browser",
    name: "Browser",
    source: "test",
    rootDir: "/plugins/browser",
    config: {},
    runtime: {} as OpenClawPluginApi["runtime"],
    registerCli,
    registerGatewayMethod,
    registerService,
    registerTool,
    registerTrustedToolPolicy,
  });
  return {
    api,
    registerCli,
    registerGatewayMethod,
    registerService,
    registerTool,
    registerTrustedToolPolicy,
  };
}

function mockCallArg(mock: { mock: { calls: unknown[][] } }, index = 0, argIndex = 0): unknown {
  const call = mock.mock.calls.at(index);
  if (!call) {
    throw new Error(`expected mock call ${index}`);
  }
  return call[argIndex];
}

function registerBrowserAutoEnableProbe(): BrowserAutoEnableProbe {
  const probes: BrowserAutoEnableProbe[] = [];
  setupPlugin.register(
    createTestPluginApi({
      registerAutoEnableProbe(probe) {
        probes.push(probe);
      },
    }),
  );
  const probe = probes[0];
  if (!probe) {
    throw new Error("expected browser setup plugin to register an auto-enable probe");
  }
  return probe;
}

describe("browser plugin", () => {
  it("registers the trusted model-call boundary policy", () => {
    const { api, registerTrustedToolPolicy } = createApi();
    registerBrowserPlugin(api);

    expect(registerTrustedToolPolicy).toHaveBeenCalledTimes(1);
    expect(registerTrustedToolPolicy.mock.calls[0]?.[0]).toMatchObject({
      id: "browser-steward-runtime",
    });
  });

  it("keeps Browser approval bound to redacted parameters", async () => {
    const { api, registerTool, registerTrustedToolPolicy } = createApi();
    registerBrowserPlugin(api);
    const factory = mockCallArg(registerTool) as Parameters<
      NonNullable<OpenClawPluginApi["registerTool"]>
    >[0];
    const tool =
      typeof factory === "function"
        ? factory({
            agentId: "main",
            sessionKey: "agent:main:direct:person-123",
            browser: { allowHostControl: true },
          })
        : undefined;
    if (!tool || Array.isArray(tool)) {
      throw new Error("expected browser plugin to return one tool");
    }
    const prepared = await tool.prepareBeforeToolCallParams?.(
      { action: "act", request: { kind: "type", text: "synthetic-secret-123456" } },
      { toolCallId: "call-browser-approval" },
    );
    if (!prepared || typeof prepared !== "object" || Array.isArray(prepared)) {
      throw new Error("expected prepared Browser parameters");
    }
    expect(JSON.stringify(prepared)).not.toContain("synthetic-secret-123456");
    const policy = mockCallArg(registerTrustedToolPolicy) as PluginTrustedToolPolicyRegistration;
    const decision = await policy.evaluate(
      {
        toolName: "browser",
        params: prepared as Record<string, unknown>,
        toolCallId: "call-browser-approval",
      },
      { toolName: "browser", agentId: "main", sessionKey: "agent:main:direct:person-123" },
    );
    expect(decision).toMatchObject({
      params: { action: "act", request: { text: "REDACTED" } },
      requireApproval: { allowedDecisions: ["allow-once", "deny"], timeoutMs: 45_000 },
    });
    expect(JSON.stringify(decision)).not.toContain("person-123");
    expect(JSON.stringify(decision)).not.toContain("synthetic-secret-123456");
    const approval =
      decision && "requireApproval" in decision ? decision.requireApproval : undefined;
    await approval?.onResolution?.("allow-once");
    const restored = tool.finalizeBeforeToolCallParams?.(prepared, prepared);
    expect(restored).toEqual({
      action: "act",
      request: { kind: "type", text: "synthetic-secret-123456" },
    });
  });

  it("does not trust model approval flags or raw browser node proxy calls", async () => {
    const { api, registerTool, registerTrustedToolPolicy } = createApi();
    registerBrowserPlugin(api);
    const factory = mockCallArg(registerTool) as Parameters<
      NonNullable<OpenClawPluginApi["registerTool"]>
    >[0];
    const tool =
      typeof factory === "function"
        ? factory({
            agentId: "main",
            sessionKey: "agent:main:direct:person-123",
            browser: { allowHostControl: true },
          })
        : undefined;
    if (!tool || Array.isArray(tool)) {
      throw new Error("expected browser plugin to return one tool");
    }
    const prepared = await tool.prepareBeforeToolCallParams?.(
      { action: "navigate", approved: true, target: "host", url: "https://example.test" },
      { toolCallId: "call-browser-self-approval" },
    );
    if (!prepared || typeof prepared !== "object" || Array.isArray(prepared)) {
      throw new Error("expected prepared Browser parameters");
    }
    const policy = mockCallArg(registerTrustedToolPolicy) as PluginTrustedToolPolicyRegistration;
    const decision = await policy.evaluate(
      {
        toolName: "browser",
        params: prepared as Record<string, unknown>,
        toolCallId: "call-browser-self-approval",
      },
      { toolName: "browser", agentId: "main", sessionKey: "agent:main:direct:person-123" },
    );
    expect(decision).toMatchObject({
      requireApproval: { allowedDecisions: ["allow-once", "deny"] },
    });

    const preparedNodeTarget = await tool.prepareBeforeToolCallParams?.(
      { action: "status", target: "node" },
      { toolCallId: "call-browser-node-target" },
    );
    const nodeTargetDecision = await policy.evaluate(
      {
        toolName: "browser",
        params: preparedNodeTarget as Record<string, unknown>,
        toolCallId: "call-browser-node-target",
      },
      { toolName: "browser", agentId: "main", sessionKey: "agent:main:direct:person-123" },
    );
    expect(nodeTargetDecision).toEqual({
      block: true,
      blockReason: "Browser Steward blocked an unsupported Browser target",
    });

    const nodeParameterDecision = await policy.evaluate(
      {
        toolName: "browser",
        params: (await tool.prepareBeforeToolCallParams?.(
          { action: "status", node: "node-123" },
          { toolCallId: "call-browser-node-parameter" },
        )) as Record<string, unknown>,
        toolCallId: "call-browser-node-parameter",
      },
      { toolName: "browser", agentId: "main", sessionKey: "agent:main:direct:person-123" },
    );
    expect(nodeParameterDecision).toEqual({
      block: true,
      blockReason: "Browser Steward blocked model Browser node routing",
    });
    expect(JSON.stringify(nodeParameterDecision)).not.toContain("node-123");

    const preparedDifferentSession = await tool.prepareBeforeToolCallParams?.(
      { action: "status" },
      { toolCallId: "call-browser-different-session" },
    );
    const differentSessionDecision = await policy.evaluate(
      {
        toolName: "browser",
        params: preparedDifferentSession as Record<string, unknown>,
        toolCallId: "call-browser-different-session",
      },
      { toolName: "browser", agentId: "main", sessionKey: "agent:main:direct:person-456" },
    );
    expect(differentSessionDecision).toEqual({
      block: true,
      blockReason: "Browser Steward blocked a changed Browser approval boundary",
    });
    expect(JSON.stringify(differentSessionDecision)).not.toContain("person-456");

    const rawNodeDecision = await policy.evaluate(
      {
        toolName: "nodes",
        params: { action: "invoke", invokeCommand: "browser.proxy" },
        toolCallId: "call-raw-node-proxy",
      },
      { toolName: "nodes", agentId: "main", sessionKey: "agent:main:direct:person-123" },
    );
    expect(rawNodeDecision).toEqual({
      block: true,
      blockReason: "Browser Steward blocked raw browser node proxy invocation",
    });
  });

  it("preserves the private approval marker through the generic tool wrapper", async () => {
    const { api, registerTool, registerTrustedToolPolicy } = createApi();
    registerBrowserPlugin(api);
    const factory = mockCallArg(registerTool) as Parameters<
      NonNullable<OpenClawPluginApi["registerTool"]>
    >[0];
    const tool =
      typeof factory === "function"
        ? factory({
            agentId: "main",
            sessionKey: "agent:main:direct:person-123",
            browser: { allowHostControl: true },
          })
        : undefined;
    if (!tool || Array.isArray(tool)) {
      throw new Error("expected browser plugin to return one tool");
    }
    const originalPrepare = tool.prepareBeforeToolCallParams;
    let preparedParams: unknown;
    tool.prepareBeforeToolCallParams = async (params, context) => {
      const prepared = await originalPrepare?.(params, context);
      preparedParams = prepared;
      return prepared;
    };
    const policy = mockCallArg(registerTrustedToolPolicy) as PluginTrustedToolPolicyRegistration;
    const registry = createEmptyPluginRegistry();
    registry.trustedToolPolicies = [{ pluginId: "browser", source: "test", policy }];
    initializeGlobalHookRunner(registry);
    try {
      const wrapped = wrapToolWithBeforeToolCallHook(tool, {
        agentId: "main",
        sessionKey: "agent:main:direct:person-123",
        runId: "run-browser-wrapper",
      });
      await wrapped.execute("call-browser-wrapper", { action: "status" }, undefined);
    } finally {
      resetGlobalHookRunner();
    }
    expect(preparedParams).toBeDefined();
    expect(approveBrowserStewardRuntimeParams(preparedParams)).toBe(false);
  });

  it("exposes static browser metadata on the plugin definition", () => {
    expect(browserPluginReload).toEqual({
      restartPrefixes: ["browser"],
      hotPrefixes: ["browser.profiles"],
    });
    expect(browserPluginNodeHostCommands).toHaveLength(1);
    expect(browserPluginNodeHostCommands[0]?.command).toBe("browser.proxy");
    expect(browserPluginNodeHostCommands[0]?.cap).toBe("browser");
    expect(typeof browserPluginNodeHostCommands[0]?.handle).toBe("function");
    expect(browserSecurityAuditCollectors).toHaveLength(1);
  });

  it("bundles the browser automation skill with the plugin", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, "openclaw.plugin.json"), "utf8"),
    ) as { skills?: string[] };
    const skillPath = path.join(__dirname, "skills", "browser-automation", "SKILL.md");

    expect(manifest.skills).toEqual(["./skills"]);
    expect(fs.readFileSync(skillPath, "utf8")).toContain("name: browser-automation");
  });

  it("keeps browser tool registration synchronous while loading runtime on execute", async () => {
    const { api, registerTool } = createApi();
    registerBrowserPlugin(api);

    const factory = mockCallArg(registerTool);
    if (typeof factory !== "function") {
      throw new Error("expected browser plugin to register a tool factory");
    }

    const tool = factory({
      sessionKey: "agent:main:webchat:direct:123",
      browser: {
        sandboxBridgeUrl: "http://127.0.0.1:9999",
        allowHostControl: true,
      },
    });
    if (!tool || Array.isArray(tool)) {
      throw new Error("expected browser plugin to return a single tool");
    }

    expect(tool.name).toBe("browser");
    expect(runtimeApiMocks.createBrowserTool).not.toHaveBeenCalled();
    await tool.execute("call-1", { action: "status" });
    expect(runtimeApiMocks.createBrowserTool).toHaveBeenCalledWith({
      sandboxBridgeUrl: "http://127.0.0.1:9999",
      allowHostControl: true,
      modelMediated: true,
      agentSessionKey: "agent:main:webchat:direct:123",
      mediaScope: {
        sessionKey: "agent:main:webchat:direct:123",
        chatType: "direct",
      },
    });
  });

  it("passes runtime context needed for screenshot image understanding", async () => {
    const { api, registerTool } = createApi();
    registerBrowserPlugin(api);

    const factory = mockCallArg(registerTool);
    if (typeof factory !== "function") {
      throw new Error("expected browser plugin to register a tool factory");
    }

    const tool = factory({
      sessionKey: "agent:main:webchat:direct:123",
      agentDir: "/tmp/agent",
      workspaceDir: "/tmp/workspace",
      activeModel: { provider: "openai", modelId: "gpt-5.5" },
      deliveryContext: { channel: "telegram" },
    });
    if (!tool || Array.isArray(tool)) {
      throw new Error("expected browser plugin to return a single tool");
    }

    await tool.execute("call-1", { action: "status" });
    expect(runtimeApiMocks.createBrowserTool).toHaveBeenCalledWith({
      modelMediated: true,
      agentSessionKey: "agent:main:webchat:direct:123",
      agentDir: "/tmp/agent",
      workspaceDir: "/tmp/workspace",
      activeModel: { provider: "openai", model: "gpt-5.5" },
      mediaScope: {
        sessionKey: "agent:main:webchat:direct:123",
        channel: "telegram",
        chatType: "direct",
      },
    });
  });

  it("derives group chat type for browser media scope", async () => {
    const { api, registerTool } = createApi();
    registerBrowserPlugin(api);

    const factory = mockCallArg(registerTool);
    if (typeof factory !== "function") {
      throw new Error("expected browser plugin to register a tool factory");
    }

    const tool = factory({
      sessionKey: "agent:main:telegram:group:chat-123",
      messageChannel: "telegram",
    });
    if (!tool || Array.isArray(tool)) {
      throw new Error("expected browser plugin to return a single tool");
    }

    await tool.execute("call-1", { action: "status" });
    expect(runtimeApiMocks.createBrowserTool).toHaveBeenCalledWith({
      modelMediated: true,
      agentSessionKey: "agent:main:telegram:group:chat-123",
      mediaScope: {
        sessionKey: "agent:main:telegram:group:chat-123",
        channel: "telegram",
        chatType: "group",
      },
    });
  });

  it("registers CLI descriptors and lazy-loads the lightweight browser CLI", async () => {
    const { api, registerCli } = createApi();
    registerBrowserPlugin(api);

    expect(registerCli).toHaveBeenCalledTimes(1);
    const registrar = mockCallArg(registerCli) as (params: { program: never }) => unknown;
    expect(typeof registrar).toBe("function");
    expect(mockCallArg(registerCli, 0, 1)).toEqual({
      commands: ["browser"],
      descriptors: [
        {
          name: "browser",
          description: "Manage OpenClaw's dedicated browser (Chrome/Chromium)",
          hasSubcommands: true,
        },
      ],
    });
    await registrar({ program: {} as never });
    expect(runtimeApiMocks.registerBrowserCli).toHaveBeenCalledWith(
      {},
      process.argv,
      "/plugins/browser",
    );
  });

  it("registers browser.request as an admin gateway method and lazy-loads handler", async () => {
    const { api, registerGatewayMethod } = createApi();
    registerBrowserPlugin(api);

    expect(registerGatewayMethod).toHaveBeenCalledTimes(1);
    expect(mockCallArg(registerGatewayMethod)).toBe("browser.request");
    const handler = mockCallArg(registerGatewayMethod, 0, 1) as (request: {
      method: string;
    }) => unknown;
    expect(typeof handler).toBe("function");
    expect(mockCallArg(registerGatewayMethod, 0, 2)).toEqual({
      scope: "operator.admin",
    });
    await handler({ method: "browser.request" });
    expect(runtimeApiMocks.handleBrowserGatewayRequest).toHaveBeenCalledWith({
      method: "browser.request",
    });
  });

  it("lazy-loads node host and audit runtime handlers", async () => {
    await expect(browserPluginNodeHostCommands[0]?.handle("{}")).resolves.toBe("ok");
    expect(runtimeApiMocks.runBrowserProxyCommand).toHaveBeenCalledWith("{}");

    await expect(browserSecurityAuditCollectors[0]?.({} as never)).resolves.toStrictEqual([]);
    expect(runtimeApiMocks.collectBrowserSecurityAuditFindings).toHaveBeenCalled();
  });

  it("registers a lazy browser control service", async () => {
    const { api, registerService } = createApi();
    registerBrowserPlugin(api);

    const service = mockCallArg(registerService) as {
      id: string;
      start: (...args: unknown[]) => unknown;
      stop: (...args: unknown[]) => unknown;
    };
    expect(service?.id).toBe("browser-control");
    expect(typeof service?.start).toBe("function");
    expect(typeof service?.stop).toBe("function");
    expect(runtimeApiMocks.createBrowserPluginService).not.toHaveBeenCalled();

    await service.start({ config: {}, stateDir: "/tmp/openclaw", logger: { warn: vi.fn() } });
    expect(runtimeApiMocks.createBrowserPluginService).not.toHaveBeenCalled();

    await service.stop({ config: {}, stateDir: "/tmp/openclaw", logger: { warn: vi.fn() } });
    expect(runtimeApiMocks.stopBrowserControlService).toHaveBeenCalledOnce();
  });

  it("eager-loads the browser control service when explicitly requested", async () => {
    vi.stubEnv("OPENCLAW_EAGER_BROWSER_CONTROL_SERVER", "1");
    const { api, registerService } = createApi();
    registerBrowserPlugin(api);

    const service = mockCallArg(registerService) as {
      id: string;
      start: (...args: unknown[]) => unknown;
    };

    await service.start({ config: {}, stateDir: "/tmp/openclaw", logger: { warn: vi.fn() } });
    expect(runtimeApiMocks.createBrowserPluginService).toHaveBeenCalledOnce();
  });

  for (const value of ["false", "", "disabled"]) {
    it(`keeps browser control service env value ${JSON.stringify(value)} lazy`, async () => {
      vi.stubEnv("OPENCLAW_EAGER_BROWSER_CONTROL_SERVER", value);
      const { api, registerService } = createApi();
      registerBrowserPlugin(api);

      const service = mockCallArg(registerService) as {
        id: string;
        start: (...args: unknown[]) => unknown;
      };

      await service.start({ config: {}, stateDir: "/tmp/openclaw", logger: { warn: vi.fn() } });
      expect(runtimeApiMocks.createBrowserPluginService).not.toHaveBeenCalled();
    });
  }

  it("declares setup auto-enable reasons for browser config surfaces", () => {
    const probe = registerBrowserAutoEnableProbe();

    expect(probe({ config: { browser: { defaultProfile: "openclaw" } }, env: {} })).toBe(
      "browser configured",
    );
    expect(probe({ config: { tools: { alsoAllow: ["browser"] } }, env: {} })).toBe(
      "browser tool referenced",
    );
    expect(
      probe({ config: { browser: { defaultProfile: "openclaw", enabled: false } }, env: {} }),
    ).toBeNull();
  });
});
