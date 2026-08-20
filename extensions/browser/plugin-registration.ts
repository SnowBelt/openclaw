/**
 * Browser plugin registration helpers. This file keeps registration lazy while
 * advertising Browser tools, services, node-host commands, and audits.
 */
import { createHmac, randomBytes } from "node:crypto";
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginNodeHostCommand,
  OpenClawPluginSecurityAuditCollector,
  OpenClawPluginService,
  OpenClawPluginToolContext,
  OpenClawPluginToolFactory,
  PluginTrustedToolPolicyRegistration,
} from "openclaw/plugin-sdk/plugin-entry";
import {
  BROWSER_REQUEST_GATEWAY_METHOD,
  BROWSER_REQUEST_GATEWAY_SCOPE,
} from "./src/browser-gateway-contract.js";
import { BrowserToolSchema } from "./src/browser-tool.schema.js";
import {
  approveBrowserStewardRuntimeParams,
  markBrowserStewardRuntimeApprovalPending,
} from "./src/browser/browser-steward-approval.js";
import type { BrowserStewardRuntimeApprovalBinding } from "./src/browser/browser-steward-approval.js";
import {
  isBrowserStewardCredentialLikeUploadPath,
  redactBrowserStewardCredentialMaterial,
  redactBrowserStewardDiagnosticResult,
} from "./src/browser/browser-steward-runtime-guard.js";
import { BROWSER_STEWARD_APPROVED_ORIGIN_NODE_COMMAND } from "./src/browser/browser-steward-transport.js";

const EAGER_BROWSER_CONTROL_SERVICE_ENV = "OPENCLAW_EAGER_BROWSER_CONTROL_SERVER";
// Gateway protocol validation caps plugin approval descriptions at 256 characters.
const PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH = 256;
const APPROVAL_SUMMARY_VALUE_MAX_LENGTH = 48;
// A process-local key lets approval prompts distinguish exact operations,
// including different redacted secrets, without exposing a guessable raw-value hash.
const BROWSER_STEWARD_APPROVAL_FINGERPRINT_KEY = randomBytes(32);

let browserRegistrationRuntimeModulePromise: Promise<
  typeof import("./register.runtime.js")
> | null = null;

const loadBrowserRegistrationRuntimeModule = async () => {
  browserRegistrationRuntimeModulePromise ??= import("./register.runtime.js");
  return await browserRegistrationRuntimeModulePromise;
};

function isTruthyEnvValue(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/iu.test(value?.trim() ?? "");
}

function canonicalApprovalValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalApprovalValue(entry, seen));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalApprovalValue(entry, seen)]),
  );
}

function fingerprintBrowserStewardOperation(params: Record<string, unknown>): string {
  const serialized = JSON.stringify(canonicalApprovalValue(params)) ?? "null";
  return createHmac("sha256", BROWSER_STEWARD_APPROVAL_FINGERPRINT_KEY)
    .update(serialized)
    .digest("hex")
    .slice(0, 12);
}

function boundedApprovalSummaryValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length <= APPROVAL_SUMMARY_VALUE_MAX_LENGTH
    ? normalized
    : `${normalized.slice(0, APPROVAL_SUMMARY_VALUE_MAX_LENGTH - 3)}...`;
}

function boundedApprovalOriginValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized || normalized.length <= APPROVAL_SUMMARY_VALUE_MAX_LENGTH) {
    return normalized || undefined;
  }
  try {
    const parsed = new URL(normalized);
    const prefix = `${parsed.protocol}//`;
    const host = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    const suffixBudget = APPROVAL_SUMMARY_VALUE_MAX_LENGTH - prefix.length - 1;
    if (suffixBudget > 0) {
      return `${prefix}…${host.slice(-suffixBudget)}`;
    }
  } catch {
    // Fall through to a bounded opaque representation for malformed input.
  }
  return `${normalized.slice(0, APPROVAL_SUMMARY_VALUE_MAX_LENGTH - 4)}…`;
}

function browserApprovalUrlOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const url = value.trim();
  if (!url) {
    return undefined;
  }
  if (url === "REDACTED") {
    return url;
  }
  try {
    return boundedApprovalOriginValue(new URL(url).origin);
  } catch {
    return url === "REDACTED" ? url : "relative-or-invalid";
  }
}

function summarizeBrowserStewardOperation(
  params: Record<string, unknown>,
  exactParams: Record<string, unknown>,
  originOverride?: string,
): string {
  const request =
    params.request && typeof params.request === "object" && !Array.isArray(params.request)
      ? (params.request as Record<string, unknown>)
      : undefined;
  const action = boundedApprovalSummaryValue(params.action) ?? "unknown";
  const parts = [
    `Operation: ${action}`,
    `fingerprint=${fingerprintBrowserStewardOperation(exactParams)}`,
  ];
  const exactRequest =
    exactParams.request &&
    typeof exactParams.request === "object" &&
    !Array.isArray(exactParams.request)
      ? (exactParams.request as Record<string, unknown>)
      : undefined;
  const origin =
    boundedApprovalOriginValue(originOverride) ??
    browserApprovalUrlOrigin(exactParams.targetUrl ?? exactParams.url ?? exactRequest?.url);
  if (origin) {
    parts.push(`origin=${origin}`);
  }
  const requestKind = boundedApprovalSummaryValue(request?.kind);
  if (requestKind) {
    parts.push(`kind=${requestKind}`);
  }
  const target = boundedApprovalSummaryValue(
    request?.targetId ?? request?.ref ?? params.targetId ?? params.target,
  );
  if (target) {
    parts.push(`target=${target}`);
  }
  const tab = boundedApprovalSummaryValue(params.tabId);
  if (tab && tab !== target) {
    parts.push(`tab=${tab}`);
  }
  return `${parts.join("; ")}.`;
}

function summarizeBrowserStewardUploadPaths(params: Record<string, unknown>): string {
  const paths = Array.isArray(params.paths)
    ? params.paths.filter((path): path is string => typeof path === "string" && path.trim())
    : [];
  if (paths.length === 0) {
    return "Uploads: file count unavailable; sensitivity=unknown.";
  }
  const credentialLikePath = paths.some(isBrowserStewardCredentialLikeUploadPath);
  const extensions = new Set(
    paths
      .map(
        (path) =>
          path
            .trim()
            .split(/[\\/]/u)
            .at(-1)
            ?.match(/\.([a-z0-9]{1,8})$/iu)?.[1],
      )
      .filter((extension): extension is string => Boolean(extension))
      .map((extension) => extension.toLowerCase()),
  );
  const fileTypes = credentialLikePath
    ? "redacted"
    : extensions.size > 0
      ? [...extensions].toSorted().join(",")
      : "unknown";
  const sensitivity = credentialLikePath ? "credential-like" : "non-credential filename pattern";
  return `Uploads: ${paths.length} file(s); fileTypes=${fileTypes}; sensitivity=${sensitivity}.`;
}

function requiresBrowserStewardOrigin(action: string, request: unknown): boolean {
  const normalizedAction = action.trim().toLowerCase();
  if (normalizedAction !== "act") {
    return new Set([
      "close",
      "console",
      "dialog",
      "focus",
      "navigate",
      "open",
      "pdf",
      "screenshot",
      "snapshot",
      "upload",
    ]).has(normalizedAction);
  }
  // An approved act may contain any side-effecting kind, including click,
  // press, drag, resize, and nested batch actions. Bind the whole act to the
  // current origin so a tab navigation cannot retarget the approved operation.
  void request;
  return true;
}

function requiresBrowserStewardTarget(action: string): boolean {
  return new Set([
    "act",
    "close",
    "console",
    "dialog",
    "focus",
    "navigate",
    "pdf",
    "screenshot",
    "snapshot",
    "upload",
  ]).has(action.trim().toLowerCase());
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
    (invokeCommand === "browser.proxy" ||
      invokeCommand === BROWSER_STEWARD_APPROVED_ORIGIN_NODE_COMMAND)
  );
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
  const lazyTool: AnyAgentTool & {
    redactBeforeToolCallDiagnosticParams: (params: unknown) => unknown;
    redactBeforeToolCallDiagnosticResult: (result: unknown) => unknown;
  } = {
    label: "Browser",
    name: "browser",
    description: [
      "Control the browser via OpenClaw's browser control server (status/start/stop/profiles/tabs/open/snapshot/screenshot/actions).",
      "Browser choice: omit profile by default for the isolated OpenClaw-managed browser (`openclaw`).",
      'For the logged-in user browser, use profile="user". A supported Chromium-based browser (v144+) must be running on the selected host or browser node. Use only when existing logins/cookies matter and the user is present.',
      'For profile="user" or other existing-session profiles, omit timeoutMs on act:type, evaluate, hover, scrollIntoView, drag, select, and fill; that driver rejects per-call timeout overrides for those actions.',
      'When a node-hosted browser proxy is available, the tool may auto-route to it. Pin a node with node=<id|name> or target="node".',
      "When using refs from snapshot (e.g. e12), keep the same tab: prefer passing targetId from the snapshot response into subsequent actions (act/click/type/etc). For tab operations, targetId also accepts tabId handles (t1) and labels from action=tabs.",
      "For multi-step browser work, login checks, stale refs, duplicate tabs, or Google Meet flows, use the bundled browser-automation skill when it is available.",
      'For stable, self-resolving refs across calls, use snapshot with refs="aria" (Playwright aria-ref ids). Default refs="role" are role+name-based.',
      "Use snapshot+act for UI automation. Avoid act:wait by default; use only in exceptional cases when no reliable UI state exists.",
      `target selects browser location (sandbox|host|node). Default: ${targetDefault}.`,
      hostHint,
    ].join(" "),
    parameters: BrowserToolSchema,
    // Browser inputs may contain credentials that must reach the driver after
    // approval but must never ride diagnostic content capture unredacted.
    redactBeforeToolCallDiagnosticParams: redactBrowserStewardCredentialMaterial,
    redactBeforeToolCallDiagnosticResult: redactBrowserStewardDiagnosticResult,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const { createBrowserTool } = await loadBrowserRegistrationRuntimeModule();
      const tool = createBrowserTool(opts);
      return await tool.execute(toolCallId, args, signal, onUpdate);
    },
  };
  return lazyTool;
}

function createBrowserToolOptions(ctx: OpenClawPluginToolContext): {
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
  agentSessionKey?: string;
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

const evaluateBrowserStewardToolPolicy: PluginTrustedToolPolicyRegistration["evaluate"] = async (
  event,
  ctx,
) => {
  const rawBrowserProxyNodeInvocation = isRawBrowserProxyNodeInvocation(
    event.toolName,
    event.params,
  );
  if (event.toolName !== "browser" && !rawBrowserProxyNodeInvocation) {
    return undefined;
  }
  const {
    evaluateBrowserStewardRuntimeGuard,
    resolveBrowserStewardActRequest,
    shouldApplyBrowserStewardRuntimeGuard,
  } = await loadBrowserRegistrationRuntimeModule();
  if (rawBrowserProxyNodeInvocation) {
    if (
      !shouldApplyBrowserStewardRuntimeGuard({
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
      })
    ) {
      return undefined;
    }
    return {
      block: true,
      blockReason:
        "Browser Steward blocked raw nodes browser.proxy invocation; use the browser tool",
    };
  }
  if (event.toolName !== "browser") {
    return undefined;
  }
  if (
    !shouldApplyBrowserStewardRuntimeGuard({
      sessionKey: ctx.sessionKey,
      agentId: ctx.agentId,
    })
  ) {
    return undefined;
  }
  const action = typeof event.params.action === "string" ? event.params.action : "unknown";
  const profile = typeof event.params.profile === "string" ? event.params.profile : undefined;
  const actRequest =
    action.trim().toLowerCase() === "act"
      ? resolveBrowserStewardActRequest(event.params)
      : undefined;
  const decision = evaluateBrowserStewardRuntimeGuard({
    action,
    profile,
    agentSessionKey: ctx.sessionKey,
    agentId: ctx.agentId,
    request: actRequest ?? event.params.request ?? event.params,
  });
  if (!decision.approvalRequired) {
    return undefined;
  }
  if (profile && redactBrowserStewardCredentialMaterial(profile) === "REDACTED") {
    return {
      block: true,
      blockReason:
        "Browser Steward blocked the operation: credential-like browser profile identifier",
    };
  }
  const { resolveBrowserStewardApprovalBinding } = await loadBrowserRegistrationRuntimeModule();
  let approvalBinding: BrowserStewardRuntimeApprovalBinding | undefined;
  const requiresApprovalOrigin =
    requiresBrowserStewardOrigin(action, actRequest ?? event.params.request ?? event.params) ||
    requiresBrowserStewardTarget(action);
  const requiresApprovalTarget = requiresBrowserStewardTarget(action);
  try {
    approvalBinding = await resolveBrowserStewardApprovalBinding({
      toolParams: event.params,
      sandboxBridgeUrl: ctx.browser?.sandboxBridgeUrl,
      allowHostControl: ctx.browser?.allowHostControl,
      requireOrigin: requiresApprovalOrigin,
      requireTarget: requiresApprovalTarget,
    });
  } catch {
    return {
      block: true,
      blockReason:
        "Browser Steward blocked the operation: execution backend unavailable for approval",
    };
  }
  if (!approvalBinding) {
    return {
      block: true,
      blockReason:
        "Browser Steward blocked the operation: execution backend unavailable for approval",
    };
  }
  const approvalOrigin = approvalBinding.origin;
  if (requiresApprovalOrigin && !approvalOrigin) {
    return {
      block: true,
      blockReason:
        "Browser Steward blocked the operation: destination origin unavailable for safe approval",
    };
  }
  const policyParams = redactBrowserStewardCredentialMaterial(event.params) as Record<
    string,
    unknown
  >;
  const credentialClasses = decision.credentialClassesInvolved.join(", ") || "none";
  const approvalDetail = [
    summarizeBrowserStewardOperation(policyParams, event.params, approvalOrigin),
    ...(action.trim().toLowerCase() === "upload"
      ? [summarizeBrowserStewardUploadPaths(event.params)]
      : []),
    `Allow ${decision.requestedAction} for ${decision.affectedSession}.`,
    `Browser profile: ${decision.affectedBrowserProfile}.`,
    `Credential classes: ${credentialClasses}.`,
  ].join(" ");
  const omissionNotice = "Raw session and credential values are omitted.";
  const approvalDescription = `${approvalDetail.slice(
    0,
    PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH - omissionNotice.length - 1,
  )} ${omissionNotice}`;
  const pendingParams = markBrowserStewardRuntimeApprovalPending(
    event.params,
    policyParams,
    approvalBinding,
  );
  return {
    params: pendingParams,
    requireApproval: {
      pluginId: "browser",
      title: `Approve Browser Steward ${decision.requestedAction}`,
      description: approvalDescription,
      severity: decision.credentialExposureKind === "credential_material" ? "critical" : "warning",
      timeoutBehavior: "deny",
      allowedDecisions: ["allow-once", "deny"],
      onResolution: (resolution) => {
        if (resolution === "allow-once") {
          approveBrowserStewardRuntimeParams(pendingParams);
        }
      },
    },
  };
};

/** Browser plugin reload policy. */
export const browserPluginReload = { restartPrefixes: ["browser"] };

/** Node-host command descriptors exposed by the Browser plugin. */
const handleBrowserProxyNodeHostCommand: OpenClawPluginNodeHostCommand["handle"] = async (
  paramsJSON,
) => {
  const { runBrowserProxyCommand } = await loadBrowserRegistrationRuntimeModule();
  return await runBrowserProxyCommand(paramsJSON);
};

export const browserPluginNodeHostCommands: OpenClawPluginNodeHostCommand[] = [
  {
    command: "browser.proxy",
    cap: "browser",
    handle: handleBrowserProxyNodeHostCommand,
  },
  {
    // Presence in the node command list is the compatibility advertisement.
    // Approved requests still use browser.proxy so the existing allowlist applies.
    command: BROWSER_STEWARD_APPROVED_ORIGIN_NODE_COMMAND,
    cap: "browser",
    handle: handleBrowserProxyNodeHostCommand,
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
    description: "Approval gate for Browser Steward mutations and credential handling",
    evaluate: evaluateBrowserStewardToolPolicy,
  });
  api.registerTool(((ctx: OpenClawPluginToolContext) =>
    createLazyBrowserTool(createBrowserToolOptions(ctx))) as OpenClawPluginToolFactory);
  api.registerCli(
    async ({ program }) => {
      const { registerBrowserCli } = await import("./src/cli/browser-cli.js");
      registerBrowserCli(program);
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
  api.registerService(createLazyBrowserPluginService());
}
