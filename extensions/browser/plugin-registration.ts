/**
 * Browser plugin registration helpers. This file keeps registration lazy while
 * advertising Browser tools, services, node-host commands, and audits.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginNodeHostCommand,
  OpenClawPluginSecurityAuditCollector,
  OpenClawPluginService,
  OpenClawPluginToolContext,
  OpenClawPluginToolFactory,
} from "openclaw/plugin-sdk/plugin-entry";
import type { PluginTrustedToolPolicyRegistration } from "openclaw/plugin-sdk/plugin-entry";
import {
  BROWSER_REQUEST_GATEWAY_METHOD,
  BROWSER_REQUEST_GATEWAY_SCOPE,
} from "./src/browser-gateway-contract.js";
import { BrowserToolSchema } from "./src/browser-tool.schema.js";
import {
  approveBrowserStewardRuntimeParams,
  BROWSER_STEWARD_APPROVAL_TIMEOUT_MS,
  denyBrowserStewardRuntimeParams,
  finalizeBrowserStewardRuntimeParams,
  getBrowserStewardRuntimePreparationFacts,
  matchesBrowserStewardRuntimePreparationContext,
  prepareBrowserStewardRuntimeParams,
} from "./src/browser/browser-steward-approval.js";
import {
  evaluateBrowserStewardRuntimeGuard,
  redactBrowserStewardCredentialMaterial,
  redactBrowserStewardDiagnosticResult,
} from "./src/browser/browser-steward-runtime-guard.js";

const EAGER_BROWSER_CONTROL_SERVICE_ENV = "OPENCLAW_EAGER_BROWSER_CONTROL_SERVER";

const loadBrowserRegistrationRuntimeModule = createLazyRuntimeModule(
  () => import("./register.runtime.js"),
);

function isTruthyEnvValue(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/iu.test(value?.trim() ?? "");
}

function deriveChatTypeFromSessionKey(
  sessionKey: string | undefined,
): "direct" | "group" | "channel" | undefined {
  const tokens = new Set(sessionKey?.toLowerCase().split(":").filter(Boolean) ?? []);
  if (tokens.has("group")) {
    return "group";
  }
  if (tokens.has("channel")) {
    return "channel";
  }
  if (tokens.has("direct") || tokens.has("dm")) {
    return "direct";
  }
  return undefined;
}

const BROWSER_CLI_DESCRIPTOR = {
  name: "browser",
  description: "Manage OpenClaw's dedicated browser (Chrome/Chromium)",
  hasSubcommands: true,
};

function createLazyBrowserTool(opts?: {
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
  agentSessionKey?: string;
  agentId?: string;
  agentDir?: string;
  workspaceDir?: string;
  activeModel?: {
    provider?: string;
    model?: string;
  };
  mediaScope?: {
    sessionKey?: string;
    channel?: string;
    chatType?: string;
  };
}): AnyAgentTool {
  const targetDefault = opts?.sandboxBridgeUrl ? "sandbox" : "host";
  const hostHint =
    opts?.allowHostControl === false ? "Host target blocked by policy." : "Host target allowed.";
  return {
    label: "Browser",
    name: "browser",
    description: [
      "Control the browser via OpenClaw's browser control server (status/start/stop/profiles/tabs/open/snapshot/screenshot/download/actions).",
      "Browser choice: omit profile by default for the isolated OpenClaw-managed browser (`openclaw`).",
      'For the logged-in user browser, use profile="user". A supported Chromium-based browser (v144+) must be running on the selected host. Use only when existing logins/cookies matter and the user is present.',
      'For profile="user" or other existing-session profiles, omit timeoutMs on act:type, evaluate, hover, scrollIntoView, drag, select, and fill; that driver rejects per-call timeout overrides for those actions.',
      "When using refs from snapshot (e.g. e12), keep the same tab: prefer passing targetId from the snapshot response into subsequent actions (act/click/type/etc). For tab operations, targetId also accepts tabId handles (t1) and labels from action=tabs.",
      "For multi-step browser work, login checks, stale refs, duplicate tabs, or Google Meet flows, use the bundled browser-automation skill when it is available.",
      'For stable, self-resolving refs across calls, use snapshot with refs="aria" (Playwright aria-ref ids). Default refs="role" are role+name-based.',
      "Use snapshot+act for UI automation. Avoid act:wait by default; use only in exceptional cases when no reliable UI state exists.",
      `target selects browser location (sandbox|host). Default: ${targetDefault}; node routing is unavailable to model calls.`,
      hostHint,
    ].join(" "),
    parameters: BrowserToolSchema,
    prepareBeforeToolCallParams: (params, context) =>
      prepareBrowserStewardRuntimeParams(params, {
        ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
        ...(opts?.agentId ? { agentId: opts.agentId } : {}),
        ...(opts?.agentSessionKey ? { sessionKey: opts.agentSessionKey } : {}),
        ...(opts?.sandboxBridgeUrl ? { sandboxBridgeAvailable: true } : {}),
        ...(opts?.allowHostControl !== undefined
          ? { allowHostControl: opts.allowHostControl }
          : {}),
      }),
    finalizeBeforeToolCallParams: finalizeBrowserStewardRuntimeParams,
    redactBeforeToolCallDiagnosticParams: redactBrowserStewardCredentialMaterial,
    redactBeforeToolCallDiagnosticResult: redactBrowserStewardDiagnosticResult,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const { createBrowserTool } = await loadBrowserRegistrationRuntimeModule();
      const tool = createBrowserTool({ ...opts, modelMediated: true });
      return await tool.execute(toolCallId, args, signal, onUpdate);
    },
  };
}

function isRawBrowserProxyNodeInvocation(
  toolName: string,
  params: Record<string, unknown>,
): boolean {
  const invokeCommand =
    typeof params.invokeCommand === "string" ? params.invokeCommand.trim().toLowerCase() : "";
  return (
    toolName.trim().toLowerCase() === "nodes" &&
    typeof params.action === "string" &&
    params.action.trim().toLowerCase() === "invoke" &&
    invokeCommand === "browser.proxy"
  );
}

function readBrowserAction(params: Record<string, unknown>): string {
  return typeof params.action === "string" ? params.action.trim().toLowerCase() : "unknown";
}

function readBrowserProfile(params: Record<string, unknown>): string | undefined {
  return typeof params.profile === "string" ? params.profile : undefined;
}

function browserStewardApprovalDescription(params: {
  action: string;
  target: string;
  profile: string;
  affectedSession: string;
  credentialClasses: string[];
}): string {
  const classes = params.credentialClasses.join(", ") || "none";
  return [
    `Approve Browser ${params.action} on ${params.target}.`,
    `Profile: ${params.profile}.`,
    `Session: ${params.affectedSession}.`,
    `Credential classes: ${classes}.`,
    "Raw session and credential values are omitted.",
  ].join(" ");
}

const evaluateBrowserStewardToolPolicy: PluginTrustedToolPolicyRegistration["evaluate"] = (
  event,
  ctx,
) => {
  if (isRawBrowserProxyNodeInvocation(event.toolName, event.params)) {
    return {
      block: true,
      blockReason: "Browser Steward blocked raw browser node proxy invocation",
    };
  }
  if (event.toolName.trim().toLowerCase() !== "browser") {
    return undefined;
  }
  const preparation = getBrowserStewardRuntimePreparationFacts(event.params);
  if (!preparation) {
    return {
      block: true,
      blockReason: "Browser Steward blocked an unprepared Browser call",
    };
  }
  if (
    !matchesBrowserStewardRuntimePreparationContext(event.params, {
      ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
      ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
      ...(ctx.sessionKey ? { sessionKey: ctx.sessionKey } : {}),
    })
  ) {
    return {
      block: true,
      blockReason: "Browser Steward blocked a changed Browser approval boundary",
    };
  }
  if (preparation.targetKind === "invalid") {
    return {
      block: true,
      blockReason: "Browser Steward blocked an unsupported Browser target",
    };
  }
  if (preparation.targetKind === "host" && !preparation.allowHostControl) {
    return {
      block: true,
      blockReason: "Browser Steward blocked Host Browser control by policy",
    };
  }
  if (preparation.targetKind === "sandbox" && !preparation.sandboxBridgeAvailable) {
    return {
      block: true,
      blockReason: "Browser Steward blocked Sandbox Browser control without a bridge",
    };
  }
  if (Object.hasOwn(event.params, "node")) {
    return {
      block: true,
      blockReason: "Browser Steward blocked model Browser node routing",
    };
  }
  const action = readBrowserAction(event.params);
  const policyRequest = { ...event.params };
  delete policyRequest.approved;
  delete policyRequest.delegated;
  const decision = evaluateBrowserStewardRuntimeGuard({
    action,
    profile: readBrowserProfile(event.params),
    agentSessionKey: ctx.sessionKey,
    agentId: ctx.agentId,
    request: policyRequest,
  });
  if (decision.affectedBrowserProfile === "REDACTED") {
    return {
      block: true,
      blockReason: "Browser Steward blocked a credential-like Browser profile identifier",
    };
  }
  if (!decision.approvalRequired) {
    return approveBrowserStewardRuntimeParams(event.params)
      ? { params: event.params }
      : {
          block: true,
          blockReason: "Browser Steward could not establish a safe Browser approval boundary",
        };
  }
  if (!event.toolCallId) {
    return {
      block: true,
      blockReason: "Browser Steward requires a tool call id for approval",
    };
  }
  return {
    params: event.params,
    requireApproval: {
      pluginId: "browser",
      title: `Approve Browser ${decision.requestedAction}`,
      description: browserStewardApprovalDescription({
        action: decision.requestedAction,
        target: preparation.target,
        profile: decision.affectedBrowserProfile,
        affectedSession: decision.affectedSession,
        credentialClasses: decision.credentialClassesInvolved,
      }),
      severity: decision.credentialExposureKind === "credential_material" ? "critical" : "warning",
      timeoutMs: BROWSER_STEWARD_APPROVAL_TIMEOUT_MS,
      timeoutBehavior: "deny",
      allowedDecisions: ["allow-once", "deny"],
      onResolution: (resolution) => {
        if (resolution === "allow-once") {
          approveBrowserStewardRuntimeParams(event.params);
        } else {
          denyBrowserStewardRuntimeParams(event.params);
        }
      },
    },
  };
};

function createBrowserToolOptions(ctx: OpenClawPluginToolContext): {
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
  agentSessionKey?: string;
  agentId?: string;
  agentDir?: string;
  workspaceDir?: string;
  activeModel?: {
    provider?: string;
    model?: string;
  };
  mediaScope?: {
    sessionKey?: string;
    channel?: string;
    chatType?: string;
  };
} {
  const mediaChannel = ctx.deliveryContext?.channel ?? ctx.messageChannel;
  const mediaChatType = deriveChatTypeFromSessionKey(ctx.sessionKey);
  return {
    ...(ctx.browser?.sandboxBridgeUrl ? { sandboxBridgeUrl: ctx.browser.sandboxBridgeUrl } : {}),
    ...(ctx.browser?.allowHostControl !== undefined
      ? { allowHostControl: ctx.browser.allowHostControl }
      : {}),
    ...(ctx.sessionKey ? { agentSessionKey: ctx.sessionKey } : {}),
    ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
    ...(ctx.agentDir ? { agentDir: ctx.agentDir } : {}),
    ...(ctx.workspaceDir ? { workspaceDir: ctx.workspaceDir } : {}),
    ...(ctx.activeModel?.provider || ctx.activeModel?.modelId
      ? {
          activeModel: {
            provider: ctx.activeModel.provider,
            model: ctx.activeModel.modelId,
          },
        }
      : {}),
    ...(ctx.sessionKey || mediaChannel
      ? {
          mediaScope: {
            ...(ctx.sessionKey ? { sessionKey: ctx.sessionKey } : {}),
            ...(mediaChannel ? { channel: mediaChannel } : {}),
            ...(mediaChatType ? { chatType: mediaChatType } : {}),
          },
        }
      : {}),
  };
}

/** Browser plugin reload policy. */
export const browserPluginReload = {
  restartPrefixes: ["browser"],
  hotPrefixes: ["browser.profiles"],
};

/** Node-host command descriptors exposed by the Browser plugin. */
export const browserPluginNodeHostCommands: OpenClawPluginNodeHostCommand[] = [
  {
    command: "browser.proxy",
    cap: "browser",
    handle: async (paramsJSON) => {
      const { runBrowserProxyCommand } = await loadBrowserRegistrationRuntimeModule();
      return await runBrowserProxyCommand(paramsJSON);
    },
  },
];

/** Security audit collectors contributed by the Browser plugin. */
export const browserSecurityAuditCollectors: OpenClawPluginSecurityAuditCollector[] = [
  async (ctx) => {
    const { collectBrowserSecurityAuditFindings } = await loadBrowserRegistrationRuntimeModule();
    return collectBrowserSecurityAuditFindings(ctx);
  },
];

function createLazyBrowserPluginService(): OpenClawPluginService {
  let service: OpenClawPluginService | null = null;
  const loadService = async () => {
    if (!service) {
      const { createBrowserPluginService } = await loadBrowserRegistrationRuntimeModule();
      service = createBrowserPluginService();
    }
    return service;
  };
  return {
    id: "browser-control",
    start: async (ctx) => {
      if (!isTruthyEnvValue(process.env[EAGER_BROWSER_CONTROL_SERVICE_ENV])) {
        return;
      }
      const loaded = await loadService();
      await loaded.start(ctx);
    },
    stop: async (ctx) => {
      if (!service) {
        const { stopBrowserControlService } = await import("./src/control-service.js");
        await stopBrowserControlService().catch(() => {});
        return;
      }
      await service.stop?.(ctx);
    },
  };
}

/** Register Browser tool factories, CLI, gateway methods, services, and audits. */
export function registerBrowserPlugin(api: OpenClawPluginApi) {
  api.registerTrustedToolPolicy({
    id: "browser-steward-runtime",
    description: "Approval and redaction boundary for model-mediated Browser calls",
    evaluate: evaluateBrowserStewardToolPolicy,
  });
  api.registerTool(((ctx: OpenClawPluginToolContext) =>
    createLazyBrowserTool(createBrowserToolOptions(ctx))) as OpenClawPluginToolFactory);
  api.registerCli(
    async ({ program }) => {
      const { registerBrowserCli } = await import("./src/cli/browser-cli.js");
      registerBrowserCli(program, process.argv, api.rootDir);
    },
    { commands: ["browser"], descriptors: [BROWSER_CLI_DESCRIPTOR] },
  );
  api.registerGatewayMethod(
    BROWSER_REQUEST_GATEWAY_METHOD,
    async (opts) => {
      const { handleBrowserGatewayRequest } = await loadBrowserRegistrationRuntimeModule();
      return await handleBrowserGatewayRequest(opts);
    },
    {
      scope: BROWSER_REQUEST_GATEWAY_SCOPE,
    },
  );
  // Remote extension relay: lets the Chrome extension connect directly to this
  // gateway over wss:// (no node host on the browser machine). auth:"plugin"
  // with no nodeCapability means the gateway does not pre-enforce token auth;
  // the handler self-validates the host-local relay secret. Path kept in sync
  // with GATEWAY_EXTENSION_RELAY_PATH (hardcoded here to stay lazy).
  api.registerHttpRoute({
    path: "/browser/extension",
    auth: "plugin",
    match: "exact",
    handler: (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(426, { "Content-Type": "text/plain" });
      res.end("Upgrade Required: connect the OpenClaw Chrome extension over WebSocket.");
    },
    handleUpgrade: async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const { handleGatewayExtensionUpgrade } =
        await import("./src/browser/extension-relay/gateway-relay-route.js");
      return await handleGatewayExtensionUpgrade(req, socket, head);
    },
  });
  api.registerService(createLazyBrowserPluginService());
}
