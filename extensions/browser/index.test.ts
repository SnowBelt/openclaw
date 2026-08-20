// Browser tests cover index plugin behavior.
import fs from "node:fs";
import path from "node:path";
import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserPluginNodeHostCommands,
  browserPluginReload,
  browserSecurityAuditCollectors,
  registerBrowserPlugin,
} from "./plugin-registration.js";
import type { OpenClawPluginApi } from "./runtime-api.js";
import setupPlugin from "./setup-api.js";
import {
  isBrowserStewardRuntimeApproved,
  resolveBrowserStewardRuntimeApprovedParams,
} from "./src/browser/browser-steward-approval.js";

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
  resolveBrowserStewardApprovalBinding: vi.fn(
    async (params: { toolParams?: Record<string, unknown> }) => {
      const toolParams = params.toolParams ?? {};
      const request =
        toolParams.request && typeof toolParams.request === "object"
          ? (toolParams.request as Record<string, unknown>)
          : undefined;
      const targetRef = request?.targetId ?? toolParams.targetId;
      const directUrl = toolParams.targetUrl ?? toolParams.url ?? request?.url;
      const origin =
        typeof directUrl === "string" && directUrl !== "REDACTED"
          ? (() => {
              try {
                return new URL(directUrl).origin;
              } catch {
                return "https://example.com";
              }
            })()
          : "https://example.com";
      return {
        backend: { kind: "host" as const },
        origin,
        ...(typeof targetRef === "string" ? { targetRef } : {}),
      };
    },
  ),
  resolveBrowserStewardTargetOrigin: vi.fn(async () => "https://example.com"),
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
    resolveBrowserStewardApprovalBinding: runtimeApiMocks.resolveBrowserStewardApprovalBinding,
    resolveBrowserStewardTargetOrigin: runtimeApiMocks.resolveBrowserStewardTargetOrigin,
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
  it("blocks raw nodes browser.proxy invocations for Browser Steward sessions", async () => {
    const { api, registerTrustedToolPolicy } = createApi();
    registerBrowserPlugin(api);

    const policy = mockCallArg(registerTrustedToolPolicy) as {
      evaluate: (
        event: { toolName: string; params: Record<string, unknown> },
        ctx: { toolName: string; sessionKey?: string },
      ) => Promise<unknown>;
    };
    for (const invokeCommand of ["browser.proxy", "browser.proxy.approved-origin"]) {
      const result = await policy.evaluate(
        {
          toolName: "nodes",
          params: {
            action: "invoke",
            invokeCommand,
            invokeParamsJson: JSON.stringify({
              method: "POST",
              path: "/act",
              body: { kind: "type", text: "opaque-secret" },
            }),
          },
        },
        {
          toolName: "nodes",
          sessionKey: "agent:browser-session-credential-steward:runtime-check",
        },
      );

      expect(result).toEqual({
        block: true,
        blockReason:
          "Browser Steward blocked raw nodes browser.proxy invocation; use the browser tool",
      });
      expect(JSON.stringify(result)).not.toContain("opaque-secret");
    }
  });

  it("registers a trusted runtime approval policy for Browser Steward mutations", async () => {
    const { api, registerTrustedToolPolicy } = createApi();
    registerBrowserPlugin(api);

    expect(registerTrustedToolPolicy).toHaveBeenCalledTimes(1);
    const policy = mockCallArg(registerTrustedToolPolicy) as {
      id: string;
      evaluate: (
        event: { toolName: string; params: Record<string, unknown> },
        ctx: {
          agentId?: string;
          sessionKey?: string;
          toolName: string;
          browser?: { sandboxBridgeUrl?: string; allowHostControl?: boolean };
        },
      ) => Promise<unknown>;
    };
    expect(policy.id).toBe("browser-steward-runtime");
    const result = await policy.evaluate(
      { toolName: "browser", params: { action: "open", url: "https://example.com" } },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    expect(result).toMatchObject({
      requireApproval: {
        pluginId: "browser",
        severity: "warning",
        timeoutBehavior: "deny",
      },
    });
    const openDescription = (result as { requireApproval?: { description?: string } } | undefined)
      ?.requireApproval?.description;
    expect(openDescription).toContain("Operation: open");
    expect(openDescription).toContain("origin=https://example.com");
    expect(openDescription).toMatch(/fingerprint=[a-f0-9]{12}/u);
    await policy.evaluate(
      { toolName: "browser", params: { action: "open", url: "https://sandbox.example" } },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
        browser: { sandboxBridgeUrl: "http://127.0.0.1:9999", allowHostControl: false },
      },
    );
    expect(runtimeApiMocks.resolveBrowserStewardApprovalBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxBridgeUrl: "http://127.0.0.1:9999",
        allowHostControl: false,
      }),
    );
    const alternateOpen = await policy.evaluate(
      { toolName: "browser", params: { action: "open", url: "https://example.com/admin" } },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    const alternateOpenDescription = (
      alternateOpen as { requireApproval?: { description?: string } } | undefined
    )?.requireApproval?.description;
    expect(alternateOpenDescription).not.toBe(openDescription);
    const conflictingOpen = await policy.evaluate(
      {
        toolName: "browser",
        params: {
          action: "open",
          url: "https://trusted.example",
          targetUrl: "https://executed.example/path",
        },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    const conflictingOpenDescription = (
      conflictingOpen as { requireApproval?: { description?: string } } | undefined
    )?.requireApproval?.description;
    expect(conflictingOpenDescription).toContain("origin=https://executed.example");
    expect(conflictingOpenDescription).not.toContain("trusted.example");

    const credentialUrlOpen = await policy.evaluate(
      {
        toolName: "browser",
        params: {
          action: "open",
          targetUrl: "https://user:password@evil.example/login?token=hidden",
        },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    const credentialUrlDescription = (
      credentialUrlOpen as { requireApproval?: { description?: string } } | undefined
    )?.requireApproval?.description;
    expect(credentialUrlDescription).toContain("origin=https://evil.example");
    expect(credentialUrlDescription).not.toContain("user:password");
    expect(credentialUrlDescription).not.toContain("token=hidden");

    const evaluateFirst = await policy.evaluate(
      {
        toolName: "browser",
        params: {
          action: "act",
          request: { kind: "evaluate", targetId: "tab-1", fn: "return 1" },
        },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    const evaluateSecond = await policy.evaluate(
      {
        toolName: "browser",
        params: {
          action: "act",
          request: { kind: "evaluate", targetId: "tab-1", fn: "return 2" },
        },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    const firstEvaluateDescription = (
      evaluateFirst as { requireApproval?: { description?: string } } | undefined
    )?.requireApproval?.description;
    const secondEvaluateDescription = (
      evaluateSecond as { requireApproval?: { description?: string } } | undefined
    )?.requireApproval?.description;
    expect(firstEvaluateDescription).toContain("kind=evaluate");
    expect(firstEvaluateDescription).toContain("target=tab-1");
    expect(firstEvaluateDescription).not.toContain("return 1");
    expect(secondEvaluateDescription).not.toContain("return 2");
    expect(secondEvaluateDescription).not.toBe(firstEvaluateDescription);
    expect(runtimeApiMocks.resolveBrowserStewardApprovalBinding).toHaveBeenLastCalledWith(
      expect.objectContaining({ requireOrigin: true, requireTarget: true }),
    );
    expect(structuredClone((evaluateFirst as { params?: unknown } | undefined)?.params)).toEqual({
      action: "act",
      request: { kind: "evaluate", targetId: "tab-1", fn: "REDACTED" },
    });
    const mutationResult = result as
      | {
          params?: Record<string, unknown>;
          requireApproval?: { onResolution?: (resolution: string) => void };
        }
      | undefined;
    expect(isBrowserStewardRuntimeApproved(mutationResult?.params)).toBe(false);
    mutationResult?.requireApproval?.onResolution?.("allow-once");
    expect(isBrowserStewardRuntimeApproved(mutationResult?.params)).toBe(true);

    await expect(
      policy.evaluate(
        { toolName: "browser", params: { action: "status" } },
        {
          toolName: "browser",
          sessionKey: "agent:browser-session-credential-steward:runtime-check",
        },
      ),
    ).resolves.toBeUndefined();

    const approvalBindingCallsBeforeCredentialProfile =
      runtimeApiMocks.resolveBrowserStewardApprovalBinding.mock.calls.length;
    const profileOnlyCredential = await policy.evaluate(
      {
        toolName: "browser",
        params: { action: "start", profile: "sk-abcdefghijk" },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    expect(profileOnlyCredential).toEqual({
      block: true,
      blockReason:
        "Browser Steward blocked the operation: credential-like browser profile identifier",
    });
    expect(runtimeApiMocks.resolveBrowserStewardApprovalBinding).toHaveBeenCalledTimes(
      approvalBindingCallsBeforeCredentialProfile,
    );

    const uploadResult = await policy.evaluate(
      {
        toolName: "browser",
        params: { action: "upload", targetId: "tab-1", paths: ["report.pdf"] },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    expect(uploadResult).toMatchObject({
      requireApproval: { pluginId: "browser" },
    });
    const uploadDescription = (uploadResult as { requireApproval?: { description?: string } })
      .requireApproval?.description;
    expect(uploadDescription).toContain(
      "Uploads: 1 file(s); fileTypes=pdf; sensitivity=non-credential filename pattern.",
    );
    expect(uploadDescription).not.toContain("report.pdf");
    const uploadParams = (uploadResult as { params?: Record<string, unknown> }).params;
    expect(uploadParams).toMatchObject({
      action: "upload",
      paths: ["REDACTED"],
    });
    expect(JSON.stringify(uploadResult)).not.toContain("report.pdf");
    expect(isBrowserStewardRuntimeApproved(uploadParams)).toBe(false);
    (
      uploadResult as { requireApproval?: { onResolution?: (resolution: string) => void } }
    ).requireApproval?.onResolution?.("allow-once");
    expect(resolveBrowserStewardRuntimeApprovedParams(uploadParams ?? {})).toMatchObject({
      paths: ["report.pdf"],
    });
    expect(runtimeApiMocks.resolveBrowserStewardApprovalBinding).toHaveBeenLastCalledWith(
      expect.objectContaining({ requireOrigin: true }),
    );

    const credentialUploadResult = await policy.evaluate(
      {
        toolName: "browser",
        params: { action: "upload", targetId: "tab-1", paths: ["private-key.pem"] },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    const credentialUploadDescription = (
      credentialUploadResult as { requireApproval?: { description?: string } }
    ).requireApproval?.description;
    expect(credentialUploadDescription).toContain(
      "Uploads: 1 file(s); fileTypes=redacted; sensitivity=credential-like.",
    );
    expect(credentialUploadDescription).not.toContain("private-key.pem");
    const credentialUploadParams = (credentialUploadResult as { params?: Record<string, unknown> })
      .params;
    expect(credentialUploadParams).toMatchObject({
      action: "upload",
      paths: ["REDACTED"],
    });
    expect(JSON.stringify(credentialUploadResult)).not.toContain("private-key.pem");

    const rawSecret = "raw-browser-secret-123456";
    const credentialResult = await policy.evaluate(
      {
        toolName: "browser",
        params: {
          action: "act",
          request: { kind: "type", targetId: "tab-1", text: rawSecret },
        },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    expect(credentialResult).toMatchObject({
      requireApproval: {
        pluginId: "browser",
        severity: "critical",
        timeoutBehavior: "deny",
        allowedDecisions: ["allow-once", "deny"],
      },
    });
    const credentialParams = (credentialResult as { params?: Record<string, unknown> } | undefined)
      ?.params;
    expect(isBrowserStewardRuntimeApproved(credentialParams)).toBe(false);
    (
      credentialResult as
        | { requireApproval?: { onResolution?: (resolution: string) => void } }
        | undefined
    )?.requireApproval?.onResolution?.("allow-once");
    expect(isBrowserStewardRuntimeApproved(credentialParams)).toBe(true);
    expect(resolveBrowserStewardRuntimeApprovedParams(credentialParams ?? {})).toMatchObject({
      request: { text: rawSecret },
    });
    const serializedApproval = JSON.stringify(credentialResult);
    expect(serializedApproval).not.toContain(rawSecret);
    expect(serializedApproval).not.toContain("runtime-check");
    expect(structuredClone(credentialParams)).toEqual({
      action: "act",
      request: { kind: "type", targetId: "tab-1", text: "REDACTED" },
    });

    const boundedResult = await policy.evaluate(
      {
        toolName: "browser",
        params: {
          action: "act",
          profile: "p".repeat(64),
          request: {
            targetId: "tab-1",
            apiKey: "synthetic-api-key",
            password: "synthetic-password",
            token: "synthetic-token",
            cookie: "synthetic-cookie",
            privateKey: "synthetic-private-key",
            secret: "synthetic-secret",
          },
        },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    const boundedDescription = (
      boundedResult as { requireApproval?: { description?: string } } | undefined
    )?.requireApproval?.description;
    expect(boundedDescription?.length).toBeLessThanOrEqual(256);
    expect(boundedDescription).toMatch(/fingerprint=[a-f0-9]{12}/u);

    const longOrigin = `https://${"a".repeat(180)}.example.com`;
    runtimeApiMocks.resolveBrowserStewardApprovalBinding.mockResolvedValueOnce({
      backend: { kind: "host" },
      origin: longOrigin,
      targetRef: "tab-1",
    });
    const longOriginResult = await policy.evaluate(
      {
        toolName: "browser",
        params: {
          action: "act",
          request: { kind: "type", targetId: "tab-1", text: "long-origin-secret" },
        },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    const longOriginDescription = (
      longOriginResult as { requireApproval?: { description?: string } } | undefined
    )?.requireApproval?.description;
    expect(longOriginDescription?.length).toBeLessThanOrEqual(256);
    expect(longOriginDescription).toContain(".example.com");

    const fillSecret = "opaque-password-value";
    const fillResult = await policy.evaluate(
      {
        toolName: "browser",
        params: {
          action: "act",
          request: {
            kind: "fill",
            targetId: "tab-1",
            fields: [{ ref: "password-field", type: "password", value: fillSecret }],
          },
        },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    expect(fillResult).toMatchObject({ requireApproval: { severity: "critical" } });
    expect(structuredClone((fillResult as { params?: unknown } | undefined)?.params)).toEqual({
      action: "act",
      request: {
        kind: "fill",
        targetId: "tab-1",
        fields: [{ ref: "password-field", type: "password", value: "REDACTED" }],
      },
    });
    expect(JSON.stringify(fillResult)).not.toContain(fillSecret);

    const selectSecret = "sk-abcdefghijk";
    const selectResult = await policy.evaluate(
      {
        toolName: "browser",
        params: {
          action: "act",
          request: { kind: "select", targetId: "tab-1", values: [selectSecret] },
        },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    expect(selectResult).toMatchObject({ requireApproval: { severity: "critical" } });
    expect(runtimeApiMocks.resolveBrowserStewardApprovalBinding).toHaveBeenLastCalledWith(
      expect.objectContaining({ requireOrigin: true }),
    );
    expect(JSON.stringify(selectResult)).not.toContain(selectSecret);

    const legacySecret = "legacy-opaque-password-value";
    const legacyActResult = await policy.evaluate(
      {
        toolName: "browser",
        params: {
          action: "act",
          request: "ignored-by-legacy-fallback",
          kind: "type",
          targetId: "tab-1",
          text: legacySecret,
        },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    expect(legacyActResult).toMatchObject({ requireApproval: { severity: "critical" } });
    expect(structuredClone((legacyActResult as { params?: unknown } | undefined)?.params)).toEqual({
      action: "act",
      request: "ignored-by-legacy-fallback",
      kind: "type",
      targetId: "tab-1",
      text: "REDACTED",
    });
    expect(JSON.stringify(legacyActResult)).not.toContain(legacySecret);

    runtimeApiMocks.resolveBrowserStewardApprovalBinding.mockResolvedValueOnce({
      backend: { kind: "host" },
      targetRef: "missing-tab",
    });
    const unknownDestination = await policy.evaluate(
      {
        toolName: "browser",
        params: {
          action: "act",
          request: { kind: "type", targetId: "missing-tab", text: "opaque-secret" },
        },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    expect(unknownDestination).toEqual({
      block: true,
      blockReason:
        "Browser Steward blocked the operation: destination origin unavailable for safe approval",
    });

    const secondFillSecret = "different-opaque-password-value";
    const secondFillResult = await policy.evaluate(
      {
        toolName: "browser",
        params: {
          action: "act",
          request: {
            kind: "fill",
            targetId: "tab-1",
            fields: [{ ref: "password-field", type: "password", value: secondFillSecret }],
          },
        },
      },
      {
        toolName: "browser",
        sessionKey: "agent:browser-session-credential-steward:runtime-check",
      },
    );
    const fillDescription = (
      fillResult as { requireApproval?: { description?: string } } | undefined
    )?.requireApproval?.description;
    const secondFillDescription = (
      secondFillResult as { requireApproval?: { description?: string } } | undefined
    )?.requireApproval?.description;
    expect(secondFillDescription).not.toBe(fillDescription);
    expect(secondFillDescription).not.toContain(secondFillSecret);
  });

  it("exposes static browser metadata on the plugin definition", () => {
    expect(browserPluginReload).toEqual({ restartPrefixes: ["browser"] });
    expect(browserPluginNodeHostCommands).toHaveLength(2);
    expect(browserPluginNodeHostCommands[0]?.command).toBe("browser.proxy");
    expect(browserPluginNodeHostCommands[0]?.cap).toBe("browser");
    expect(typeof browserPluginNodeHostCommands[0]?.handle).toBe("function");
    expect(browserPluginNodeHostCommands[1]?.command).toBe("browser.proxy.approved-origin");
    expect(browserPluginNodeHostCommands[1]?.cap).toBe("browser");
    expect(typeof browserPluginNodeHostCommands[1]?.handle).toBe("function");
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

  it("passes trusted agent id to the browser runtime tool", async () => {
    const { api, registerTool } = createApi();
    registerBrowserPlugin(api);

    const factory = mockCallArg(registerTool);
    if (typeof factory !== "function") {
      throw new Error("expected browser plugin to register a tool factory");
    }

    const tool = factory({
      agentId: "browser-session-credential-steward",
      sessionKey: "global",
    });
    if (!tool || Array.isArray(tool)) {
      throw new Error("expected browser plugin to return a single tool");
    }

    await tool.execute("call-1", { action: "status" });
    expect(runtimeApiMocks.createBrowserTool).toHaveBeenCalledWith({
      agentId: "browser-session-credential-steward",
      agentSessionKey: "global",
      mediaScope: {
        sessionKey: "global",
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
    expect(runtimeApiMocks.registerBrowserCli).toHaveBeenCalledWith({});
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
