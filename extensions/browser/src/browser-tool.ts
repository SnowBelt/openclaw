/**
 * Browser agent tool registration.
 *
 * Builds the model-facing browser tool, chooses sandbox/host/node routing, and
 * maps high-level actions onto browser control client calls.
 */
import crypto from "node:crypto";
import {
  executeActAction,
  executeConsoleAction,
  executeSnapshotAction,
  executeTabsAction,
} from "./browser-tool.actions.js";
import {
  type AnyAgentTool,
  type NodeListNode,
  BrowserToolSchema,
  applyBrowserProxyPaths,
  browserAct,
  browserArmDialog,
  browserArmFileChooser,
  browserCloseTab,
  browserDoctor,
  browserFocusTab,
  browserNavigate,
  browserOpenTab,
  browserPdfSave,
  browserProfiles,
  browserScreenshotAction,
  browserStart,
  browserStatus,
  browserStop,
  browserTabs,
  callGatewayTool,
  describeImageFile,
  getRuntimeConfig,
  getBrowserProfileCapabilities,
  imageResultFromFile,
  jsonResult,
  listNodes,
  normalizeOptionalString,
  persistBrowserProxyFiles,
  readPositiveIntegerParam,
  readStringParam,
  readStringValue,
  resolveBrowserConfig,
  resolveExistingUploadPaths,
  resolveRuntimeImageSanitization,
  resolveNodeIdFromList,
  resolveProfile,
  saveMediaBuffer,
  selectDefaultNodeFromList,
  touchSessionBrowserTab,
  trackSessionBrowserTab,
  untrackSessionBrowserTab,
} from "./browser-tool.runtime.js";
import {
  getBrowserStewardRuntimeApprovalBinding,
  isBrowserStewardRuntimeApproved,
  matchesBrowserStewardRuntimeApprovalBinding,
  resolveBrowserStewardRuntimeApprovedParams,
} from "./browser/browser-steward-approval.js";
import type { BrowserStewardRuntimeApprovalBinding } from "./browser/browser-steward-approval.js";
import {
  type BrowserStewardRuntimeDecision,
  assertBrowserStewardRuntimeAllowed,
  evaluateBrowserStewardRuntimeGuard,
  shouldApplyBrowserStewardRuntimeGuard,
} from "./browser/browser-steward-runtime-guard.js";
import {
  BROWSER_STEWARD_APPROVED_ORIGIN_NODE_COMMAND,
  matchesBrowserStewardApprovedUrl,
  resolveBrowserStewardUrlOrigin,
} from "./browser/browser-steward-transport.js";
import { DEFAULT_BROWSER_SCREENSHOT_TIMEOUT_MS } from "./browser/constants.js";
import { normalizeBrowserScreenshot } from "./browser/screenshot.js";
import { resolveTargetIdFromTabs } from "./browser/target-id.js";
import { describeBrowserScreenshot, neutralizeMediaDirectives } from "./browser/vision.js";
import { wrapExternalContent } from "./sdk-security-runtime.js";

const browserToolDeps = {
  browserAct,
  browserArmDialog,
  browserArmFileChooser,
  browserCloseTab,
  browserDoctor,
  browserFocusTab,
  browserNavigate,
  browserOpenTab,
  browserPdfSave,
  browserProfiles,
  browserScreenshotAction,
  browserStart,
  browserStatus,
  browserStop,
  browserTabs,
  describeImageFile,
  getRuntimeConfig,
  imageResultFromFile,
  listNodes,
  callGatewayTool,
  normalizeBrowserScreenshot,
  saveMediaBuffer,
  touchSessionBrowserTab,
  trackSessionBrowserTab,
  untrackSessionBrowserTab,
};

export const testing = {
  setDepsForTest(
    overrides: Partial<{
      browserAct: typeof browserAct;
      browserArmDialog: typeof browserArmDialog;
      browserArmFileChooser: typeof browserArmFileChooser;
      browserCloseTab: typeof browserCloseTab;
      browserDoctor: typeof browserDoctor;
      browserFocusTab: typeof browserFocusTab;
      browserNavigate: typeof browserNavigate;
      browserOpenTab: typeof browserOpenTab;
      browserPdfSave: typeof browserPdfSave;
      browserProfiles: typeof browserProfiles;
      browserScreenshotAction: typeof browserScreenshotAction;
      browserStart: typeof browserStart;
      browserStatus: typeof browserStatus;
      browserStop: typeof browserStop;
      browserTabs: typeof browserTabs;
      describeImageFile: typeof describeImageFile;
      imageResultFromFile: typeof imageResultFromFile;
      getRuntimeConfig: typeof getRuntimeConfig;
      listNodes: typeof listNodes;
      callGatewayTool: typeof callGatewayTool;
      normalizeBrowserScreenshot: typeof normalizeBrowserScreenshot;
      saveMediaBuffer: typeof saveMediaBuffer;
      touchSessionBrowserTab: typeof touchSessionBrowserTab;
      trackSessionBrowserTab: typeof trackSessionBrowserTab;
      untrackSessionBrowserTab: typeof untrackSessionBrowserTab;
    }> | null,
  ) {
    browserToolDeps.browserAct = overrides?.browserAct ?? browserAct;
    browserToolDeps.browserArmDialog = overrides?.browserArmDialog ?? browserArmDialog;
    browserToolDeps.browserArmFileChooser =
      overrides?.browserArmFileChooser ?? browserArmFileChooser;
    browserToolDeps.browserCloseTab = overrides?.browserCloseTab ?? browserCloseTab;
    browserToolDeps.browserDoctor = overrides?.browserDoctor ?? browserDoctor;
    browserToolDeps.browserFocusTab = overrides?.browserFocusTab ?? browserFocusTab;
    browserToolDeps.browserNavigate = overrides?.browserNavigate ?? browserNavigate;
    browserToolDeps.browserOpenTab = overrides?.browserOpenTab ?? browserOpenTab;
    browserToolDeps.browserPdfSave = overrides?.browserPdfSave ?? browserPdfSave;
    browserToolDeps.browserProfiles = overrides?.browserProfiles ?? browserProfiles;
    browserToolDeps.browserScreenshotAction =
      overrides?.browserScreenshotAction ?? browserScreenshotAction;
    browserToolDeps.browserStart = overrides?.browserStart ?? browserStart;
    browserToolDeps.browserStatus = overrides?.browserStatus ?? browserStatus;
    browserToolDeps.browserStop = overrides?.browserStop ?? browserStop;
    browserToolDeps.browserTabs = overrides?.browserTabs ?? browserTabs;
    browserToolDeps.describeImageFile = overrides?.describeImageFile ?? describeImageFile;
    browserToolDeps.imageResultFromFile = overrides?.imageResultFromFile ?? imageResultFromFile;
    browserToolDeps.getRuntimeConfig = overrides?.getRuntimeConfig ?? getRuntimeConfig;
    browserToolDeps.listNodes = overrides?.listNodes ?? listNodes;
    browserToolDeps.callGatewayTool = overrides?.callGatewayTool ?? callGatewayTool;
    browserToolDeps.normalizeBrowserScreenshot =
      overrides?.normalizeBrowserScreenshot ?? normalizeBrowserScreenshot;
    browserToolDeps.saveMediaBuffer = overrides?.saveMediaBuffer ?? saveMediaBuffer;
    browserToolDeps.touchSessionBrowserTab =
      overrides?.touchSessionBrowserTab ?? touchSessionBrowserTab;
    browserToolDeps.trackSessionBrowserTab =
      overrides?.trackSessionBrowserTab ?? trackSessionBrowserTab;
    browserToolDeps.untrackSessionBrowserTab =
      overrides?.untrackSessionBrowserTab ?? untrackSessionBrowserTab;
  },
};

function readOptionalTargetAndTimeout(params: Record<string, unknown>) {
  const targetId = normalizeOptionalString(params.targetId);
  const timeoutMs = readPositiveIntegerParam(params, "timeoutMs", {
    message: "timeoutMs must be a positive integer.",
  });
  return { targetId, timeoutMs };
}

function readTargetUrlParam(params: Record<string, unknown>) {
  return (
    readStringParam(params, "targetUrl") ??
    readStringParam(params, "url", { required: true, label: "targetUrl" })
  );
}

function assertBrowserStewardApprovedResultOrigin(
  value: unknown,
  approvedOrigin: string | undefined,
): void {
  if (!approvedOrigin) {
    return;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Browser Steward approved navigation origin could not be verified");
  }
  if (!matchesBrowserStewardApprovedUrl(value.trim(), approvedOrigin)) {
    throw new Error("Browser Steward approved navigation origin changed before completion");
  }
}

const LEGACY_BROWSER_ACT_REQUEST_KEYS = [
  "targetId",
  "ref",
  "doubleClick",
  "button",
  "modifiers",
  "x",
  "y",
  "text",
  "submit",
  "slowly",
  "key",
  "delayMs",
  "startRef",
  "endRef",
  "values",
  "fields",
  "width",
  "height",
  "timeMs",
  "textGone",
  "selector",
  "url",
  "loadState",
  "fn",
  "timeoutMs",
] as const;

function readActRequestParam(params: Record<string, unknown>) {
  const requestParam = params.request;
  if (requestParam && typeof requestParam === "object") {
    return requestParam as Parameters<typeof browserAct>[1];
  }

  const kind = readStringParam(params, "kind");
  if (!kind) {
    return undefined;
  }

  const request: Record<string, unknown> = { kind };
  for (const key of LEGACY_BROWSER_ACT_REQUEST_KEYS) {
    if (!Object.hasOwn(params, key)) {
      continue;
    }
    request[key] = params[key];
  }
  return request as Parameters<typeof browserAct>[1];
}

/** Resolves the exact act payload that execution sends to the browser backend. */
export function resolveBrowserStewardActRequest(params: Record<string, unknown>) {
  return readActRequestParam(params);
}

type BrowserProxyFile = {
  path: string;
  base64: string;
  mimeType?: string;
};

type BrowserProxyResult = {
  result: unknown;
  files?: BrowserProxyFile[];
};

const DEFAULT_BROWSER_PROXY_TIMEOUT_MS = 20_000;
const BROWSER_PROXY_GATEWAY_TIMEOUT_SLACK_MS = 5_000;

type BrowserNodeTarget = {
  nodeId: string;
  label?: string;
  supportsApprovedOrigin: boolean;
};

function browserNodeTarget(node: NodeListNode): BrowserNodeTarget {
  const commands = Array.isArray(node.commands) ? node.commands : [];
  return {
    nodeId: node.nodeId,
    label: node.displayName ?? node.remoteIp ?? node.nodeId,
    supportsApprovedOrigin: commands.includes(BROWSER_STEWARD_APPROVED_ORIGIN_NODE_COMMAND),
  };
}

function isBrowserNode(node: NodeListNode) {
  const caps = Array.isArray(node.caps) ? node.caps : [];
  const commands = Array.isArray(node.commands) ? node.commands : [];
  return caps.includes("browser") || commands.includes("browser.proxy");
}

async function resolveBrowserNodeTarget(params: {
  requestedNode?: string;
  target?: "sandbox" | "host" | "node";
  sandboxBridgeUrl?: string;
}): Promise<BrowserNodeTarget | null> {
  const cfg = browserToolDeps.getRuntimeConfig();
  const policy = cfg.gateway?.nodes?.browser;
  const mode = policy?.mode ?? "auto";
  if (mode === "off") {
    if (params.target === "node" || params.requestedNode) {
      throw new Error("Node browser proxy is disabled (gateway.nodes.browser.mode=off).");
    }
    return null;
  }
  if (params.sandboxBridgeUrl?.trim() && params.target !== "node" && !params.requestedNode) {
    return null;
  }
  if (params.target && params.target !== "node") {
    return null;
  }
  if (mode === "manual" && params.target !== "node" && !params.requestedNode) {
    return null;
  }

  const nodes = await browserToolDeps.listNodes({});
  const browserNodes = nodes.filter((node) => node.connected && isBrowserNode(node));
  if (browserNodes.length === 0) {
    if (params.target === "node" || params.requestedNode) {
      throw new Error("No connected browser-capable nodes.");
    }
    return null;
  }

  const requested = params.requestedNode?.trim() || policy?.node?.trim();
  if (requested) {
    const nodeId = resolveNodeIdFromList(browserNodes, requested, false);
    const node = browserNodes.find((entry) => entry.nodeId === nodeId);
    return node ? browserNodeTarget(node) : { nodeId, supportsApprovedOrigin: false };
  }

  const selected = selectDefaultNodeFromList(browserNodes, {
    preferLocalMac: false,
    fallback: "none",
  });

  if (params.target === "node") {
    if (selected) {
      return browserNodeTarget(selected);
    }
    throw new Error(
      `Multiple browser-capable nodes connected (${browserNodes.length}). Set gateway.nodes.browser.node or pass node=<id>.`,
    );
  }

  if (mode === "manual") {
    return null;
  }

  if (selected) {
    return browserNodeTarget(selected);
  }
  return null;
}

async function callBrowserProxy(params: {
  nodeId: string;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  profile?: string;
  approvedOrigin?: string;
  agentSessionKey?: string;
  agentId?: string;
}): Promise<BrowserProxyResult> {
  const proxyTimeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(1, Math.floor(params.timeoutMs))
      : DEFAULT_BROWSER_PROXY_TIMEOUT_MS;
  const gatewayTimeoutMs = proxyTimeoutMs + BROWSER_PROXY_GATEWAY_TIMEOUT_SLACK_MS;
  const payload = await browserToolDeps.callGatewayTool(
    "node.invoke",
    { timeoutMs: gatewayTimeoutMs },
    {
      nodeId: params.nodeId,
      command: "browser.proxy",
      params: {
        method: params.method,
        path: params.path,
        query: params.query,
        body: params.body,
        timeoutMs: proxyTimeoutMs,
        profile: params.profile,
        ...(params.approvedOrigin ? { approvedOrigin: params.approvedOrigin } : {}),
        ...(params.agentSessionKey ? { agentSessionKey: params.agentSessionKey } : {}),
        ...(params.agentId ? { agentId: params.agentId } : {}),
      },
      idempotencyKey: crypto.randomUUID(),
    },
  );
  const parsed = unwrapBrowserProxyPayload(payload);
  if (!parsed || typeof parsed !== "object" || !("result" in parsed)) {
    throw new Error("browser proxy failed");
  }
  return parsed;
}

function unwrapBrowserProxyPayload(payload: { payload?: unknown; payloadJSON?: unknown } | null) {
  if (payload?.payload !== undefined) {
    return payload.payload;
  }
  if (typeof payload?.payloadJSON !== "string" || !payload.payloadJSON.trim()) {
    return null;
  }
  try {
    return JSON.parse(payload.payloadJSON) as BrowserProxyResult;
  } catch {
    return null;
  }
}

async function persistProxyFiles(files: BrowserProxyFile[] | undefined) {
  return await persistBrowserProxyFiles(files);
}

function applyProxyPaths(result: unknown, mapping: Map<string, string>) {
  applyBrowserProxyPaths(result, mapping);
}

function resolveBrowserBaseUrl(params: {
  target?: "sandbox" | "host";
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
}): string | undefined {
  const cfg = getRuntimeConfig();
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  const normalizedSandbox = params.sandboxBridgeUrl?.trim() ?? "";
  const target = params.target ?? (normalizedSandbox ? "sandbox" : "host");

  if (target === "sandbox") {
    if (!normalizedSandbox) {
      throw new Error(
        'Sandbox browser is unavailable. Enable agents.defaults.sandbox.browser.enabled or use target="host" if allowed.',
      );
    }
    return normalizedSandbox.replace(/\/$/, "");
  }

  if (params.allowHostControl === false) {
    throw new Error("Host browser control is disabled by sandbox policy.");
  }
  if (!resolved.enabled) {
    throw new Error(
      "Browser control is disabled. Set browser.enabled=true in ~/.openclaw/openclaw.json.",
    );
  }
  return undefined;
}

function browserStewardTabOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return resolveBrowserStewardUrlOrigin(trimmed);
}

function browserTabTargetId(tab: unknown): string | undefined {
  if (!tab || typeof tab !== "object") {
    return undefined;
  }
  const record = tab as Record<string, unknown>;
  const targetId = record.targetId ?? record.tabId;
  return typeof targetId === "string" && targetId.trim() ? targetId.trim() : undefined;
}

function shouldPreferHostForProfile(profileName: string | undefined) {
  if (!profileName) {
    return false;
  }
  const cfg = browserToolDeps.getRuntimeConfig();
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  const profile = resolveProfile(resolved, profileName);
  if (!profile) {
    return false;
  }
  const capabilities = getBrowserProfileCapabilities(profile);
  return capabilities.usesChromeMcp;
}

type BrowserStewardExecutionResolution = {
  nodeTarget: BrowserNodeTarget | null;
  baseUrl: string | undefined;
  binding: BrowserStewardRuntimeApprovalBinding;
};

function readBrowserStewardTargetReference(params: Record<string, unknown>): string | undefined {
  const request =
    params.request && typeof params.request === "object" && !Array.isArray(params.request)
      ? (params.request as Record<string, unknown>)
      : undefined;
  const targetRef = request?.targetId ?? params.targetId;
  return typeof targetRef === "string" && targetRef.trim() ? targetRef.trim() : undefined;
}

function readBrowserStewardTarget(params: Record<string, unknown>) {
  const value = params.target;
  return value === "sandbox" || value === "host" || value === "node" ? value : undefined;
}

function readBrowserStewardProfile(params: Record<string, unknown>): string | undefined {
  return typeof params.profile === "string" && params.profile.trim()
    ? params.profile.trim()
    : undefined;
}

function browserStewardDirectOrigin(params: Record<string, unknown>): string | undefined {
  const action = typeof params.action === "string" ? params.action.trim().toLowerCase() : "";
  if (action !== "open" && action !== "navigate") {
    return undefined;
  }
  return browserStewardTabOrigin(params.targetUrl ?? params.url);
}

async function resolveBrowserExecutionTarget(params: {
  target?: "sandbox" | "host" | "node";
  requestedNode?: string;
  profile?: string;
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
}): Promise<{
  nodeTarget: BrowserNodeTarget | null;
  baseUrl: string | undefined;
}> {
  const configuredNode = browserToolDeps.getRuntimeConfig().gateway?.nodes?.browser?.node?.trim();
  const isUserBrowserProfile = shouldPreferHostForProfile(params.profile);
  if (params.requestedNode && params.target && params.target !== "node") {
    throw new Error('node is only supported with target="node".');
  }
  if (isUserBrowserProfile && params.target === "sandbox") {
    throw new Error(
      `profile="${params.profile}" cannot use the sandbox browser; use target="host" or omit target.`,
    );
  }

  let nodeTarget: BrowserNodeTarget | null = null;
  try {
    nodeTarget = await resolveBrowserNodeTarget({
      requestedNode: params.requestedNode,
      target: params.target,
      sandboxBridgeUrl: params.sandboxBridgeUrl,
    });
  } catch (error) {
    // Keep the logged-in user browser usable on the host when auto-discovery
    // of browser nodes fails transiently. Explicit node requests still fail.
    if (!(isUserBrowserProfile && !params.target && !params.requestedNode && !configuredNode)) {
      throw error;
    }
  }
  const effectiveTarget =
    isUserBrowserProfile && !params.target && !params.requestedNode && !nodeTarget
      ? "host"
      : params.target;
  const baseUrl = nodeTarget
    ? undefined
    : resolveBrowserBaseUrl({
        target: effectiveTarget,
        sandboxBridgeUrl: params.sandboxBridgeUrl,
        allowHostControl: params.allowHostControl,
      });
  return { nodeTarget, baseUrl };
}

async function listBrowserStewardTabs(
  resolution: { nodeTarget: BrowserNodeTarget | null; baseUrl: string | undefined },
  profile: string | undefined,
): Promise<unknown[]> {
  if (!resolution.nodeTarget) {
    return await browserToolDeps.browserTabs(resolution.baseUrl, { profile });
  }
  const proxy = await callBrowserProxy({
    nodeId: resolution.nodeTarget.nodeId,
    method: "GET",
    path: "/tabs",
    profile,
  });
  const result = proxy.result;
  if (Array.isArray(result)) {
    return result;
  }
  if (result && typeof result === "object" && Array.isArray((result as { tabs?: unknown }).tabs)) {
    return (result as { tabs: unknown[] }).tabs;
  }
  return [];
}

/** Resolves the same browser backend used by execution and, when requested, its current tab origin. */
export async function resolveBrowserStewardExecution(params: {
  toolParams: Record<string, unknown>;
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
  requireOrigin?: boolean;
  requireTarget?: boolean;
  expectedOrigin?: string;
}): Promise<BrowserStewardExecutionResolution> {
  const target = readBrowserStewardTarget(params.toolParams);
  const requestedNode =
    typeof params.toolParams.node === "string" && params.toolParams.node.trim()
      ? params.toolParams.node.trim()
      : undefined;
  const profile = readBrowserStewardProfile(params.toolParams);
  const requestedTargetRef = readBrowserStewardTargetReference(params.toolParams);
  const resolution = await resolveBrowserExecutionTarget({
    target,
    requestedNode,
    profile,
    sandboxBridgeUrl: params.sandboxBridgeUrl,
    allowHostControl: params.allowHostControl,
  });
  const action =
    typeof params.toolParams.action === "string"
      ? params.toolParams.action.trim().toLowerCase()
      : "";
  const isDestinationAction = action === "open" || action === "navigate";
  let origin = browserStewardDirectOrigin(params.toolParams);
  if (!origin && isDestinationAction && params.expectedOrigin) {
    // Credential-bearing URLs are redacted before execution. The immutable
    // approval marker supplies their already-approved origin; backend identity
    // is still re-resolved here before private parameters are restored.
    origin = params.expectedOrigin;
  }
  let targetRef = requestedTargetRef;
  if (params.requireTarget || (params.requireOrigin && !origin)) {
    const tabs = await listBrowserStewardTabs(resolution, profile);
    const candidates = tabs.filter((candidate) => browserTabTargetId(candidate));
    const tab = requestedTargetRef
      ? (() => {
          const resolution = resolveTargetIdFromTabs(
            requestedTargetRef,
            candidates.map((candidate) => {
              const record = candidate as Record<string, unknown>;
              return {
                targetId: browserTabTargetId(candidate)!,
                ...(typeof record.suggestedTargetId === "string"
                  ? { suggestedTargetId: record.suggestedTargetId }
                  : {}),
                ...(typeof record.tabId === "string" ? { tabId: record.tabId } : {}),
                ...(typeof record.label === "string" ? { label: record.label } : {}),
              };
            }),
          );
          if (!resolution.ok) {
            return undefined;
          }
          return candidates.find(
            (candidate) => browserTabTargetId(candidate) === resolution.targetId,
          );
        })()
      : (() => {
          const pageCandidates = candidates.filter((candidate) => {
            const type = (candidate as Record<string, unknown>).type;
            return type === undefined || type === "page";
          });
          const defaultCandidates = pageCandidates.length > 0 ? pageCandidates : candidates;
          return defaultCandidates.length === 1 ? defaultCandidates[0] : undefined;
        })();
    const resolvedTargetRef = browserTabTargetId(tab);
    if (params.requireTarget && !resolvedTargetRef) {
      throw new Error("Browser Steward approved destination tab could not be verified");
    }
    targetRef = resolvedTargetRef ?? targetRef;
    if (params.requireOrigin && !origin) {
      origin = browserStewardTabOrigin((tab as { url?: unknown } | undefined)?.url);
    }
  }
  const backend = resolution.nodeTarget
    ? { kind: "node" as const, identity: resolution.nodeTarget.nodeId }
    : resolution.baseUrl
      ? { kind: "sandbox" as const, identity: resolution.baseUrl }
      : { kind: "host" as const };
  return {
    ...resolution,
    binding: {
      backend,
      ...(origin ? { origin } : {}),
      ...(targetRef ? { targetRef } : {}),
    },
  };
}

/** Resolves a redacted approval binding for the trusted Browser Steward policy. */
export async function resolveBrowserStewardApprovalBinding(params: {
  toolParams: Record<string, unknown>;
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
  requireOrigin?: boolean;
  requireTarget?: boolean;
}): Promise<BrowserStewardRuntimeApprovalBinding> {
  const resolution = await resolveBrowserStewardExecution(params);
  return resolution.binding;
}

/** Resolves only the current origin for an existing tab used by a credential approval. */
export async function resolveBrowserStewardTargetOrigin(params: {
  targetRef?: string;
  target?: "sandbox" | "host" | "node";
  node?: string;
  profile?: string;
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
}): Promise<string | undefined> {
  const targetRef = params.targetRef?.trim();
  const resolution = await resolveBrowserStewardExecution({
    toolParams: {
      ...(params.target ? { target: params.target } : {}),
      ...(params.node ? { node: params.node } : {}),
      ...(params.profile ? { profile: params.profile } : {}),
      ...(targetRef ? { targetId: targetRef } : {}),
    },
    sandboxBridgeUrl: params.sandboxBridgeUrl,
    allowHostControl: params.allowHostControl,
    requireOrigin: true,
    requireTarget: true,
  });
  return resolution.binding.origin;
}

const DEFAULT_EXISTING_SESSION_MANAGE_TIMEOUT_MS = 45_000;
const EXISTING_SESSION_MANAGE_ACTIONS = new Set([
  "status",
  "start",
  "stop",
  "profiles",
  "tabs",
  "open",
  "focus",
  "close",
]);

function usesExistingSessionManageFlow(params: { action: string; profileName?: string }) {
  if (!EXISTING_SESSION_MANAGE_ACTIONS.has(params.action)) {
    return false;
  }
  const cfg = browserToolDeps.getRuntimeConfig();
  const resolved = resolveBrowserConfig(cfg.browser, cfg);
  const profile = resolveProfile(resolved, params.profileName ?? resolved.defaultProfile);
  if (profile && getBrowserProfileCapabilities(profile).usesChromeMcp) {
    return true;
  }
  if (params.action !== "profiles") {
    return false;
  }
  return Object.keys(resolved.profiles).some((name) => {
    const candidate = resolveProfile(resolved, name);
    return candidate ? getBrowserProfileCapabilities(candidate).usesChromeMcp : false;
  });
}

function readToolTimeoutMs(params: Record<string, unknown>) {
  return readPositiveIntegerParam(params, "timeoutMs", {
    message: "timeoutMs must be a positive integer.",
  });
}

function toSafeBrowserStewardExecutionError(
  error: unknown,
  approved: boolean,
  decision: BrowserStewardRuntimeDecision | undefined,
): Error {
  if (approved && decision?.credentialExposureKind === "credential_material") {
    return new Error("Browser Steward approved credential operation failed safely");
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Create the Browser tool exposed to agents. */
export function createBrowserTool(opts?: {
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
  agentId?: string;
}): AnyAgentTool {
  const targetDefault = opts?.sandboxBridgeUrl ? "sandbox" : "host";
  const hostHint =
    opts?.allowHostControl === false ? "Host target blocked by policy." : "Host target allowed.";
  return {
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
    execute: async (_toolCallId, args) => {
      const publicParams = args as Record<string, unknown>;
      const approved = isBrowserStewardRuntimeApproved(publicParams);
      const approvalBinding = getBrowserStewardRuntimeApprovalBinding(publicParams);
      const publicAction = readStringParam(publicParams, "action", { required: true });
      const publicProfile = readStringParam(publicParams, "profile");
      let browserStewardRuntimeDecision: BrowserStewardRuntimeDecision | undefined;
      const appliesBrowserStewardRuntimeGuard = shouldApplyBrowserStewardRuntimeGuard({
        sessionKey: opts?.agentSessionKey,
        agentId: opts?.agentId,
      });
      if (appliesBrowserStewardRuntimeGuard) {
        browserStewardRuntimeDecision = assertBrowserStewardRuntimeAllowed({
          action: publicAction,
          profile: publicProfile,
          agentSessionKey: opts?.agentSessionKey,
          agentId: opts?.agentId,
          approved,
          request: publicParams.request ?? publicParams,
        });
      }
      // Keep model-visible parameters redacted until the exact backend and tab
      // binding is checked; restore private values only for the final execution.
      const restoredParams = approved
        ? resolveBrowserStewardRuntimeApprovedParams(publicParams)
        : publicParams;
      const action = readStringParam(restoredParams, "action", { required: true });
      const profile = readStringParam(restoredParams, "profile");
      if (appliesBrowserStewardRuntimeGuard && approved) {
        browserStewardRuntimeDecision = evaluateBrowserStewardRuntimeGuard({
          action,
          profile,
          agentSessionKey: opts?.agentSessionKey,
          agentId: opts?.agentId,
          approved: true,
          request: restoredParams.request ?? restoredParams,
        });
      }
      const execution = await resolveBrowserStewardExecution({
        toolParams: restoredParams,
        sandboxBridgeUrl: opts?.sandboxBridgeUrl,
        allowHostControl: opts?.allowHostControl,
        requireOrigin: Boolean(approvalBinding?.origin),
        requireTarget: Boolean(approvalBinding?.targetRef),
        expectedOrigin: approvalBinding?.origin,
      }).catch((error: unknown) => {
        throw toSafeBrowserStewardExecutionError(error, approved, browserStewardRuntimeDecision);
      });
      if (appliesBrowserStewardRuntimeGuard && approved) {
        if (
          !approvalBinding ||
          !matchesBrowserStewardRuntimeApprovalBinding(publicParams, execution.binding)
        ) {
          throw new Error(
            "Browser Steward runtime approval invalidated: browser destination changed before execution",
          );
        }
      }
      const executionParams =
        approved && execution.binding.targetRef
          ? (() => {
              const request =
                restoredParams.request &&
                typeof restoredParams.request === "object" &&
                !Array.isArray(restoredParams.request)
                  ? (restoredParams.request as Record<string, unknown>)
                  : undefined;
              return request
                ? {
                    ...restoredParams,
                    request: { ...request, targetId: execution.binding.targetRef },
                  }
                : { ...restoredParams, targetId: execution.binding.targetRef };
            })()
          : restoredParams;
      const params = executionParams;
      const requestedTimeoutMs = readToolTimeoutMs(params);
      const nodeTarget = execution.nodeTarget;
      const baseUrl = execution.baseUrl;

      const proxyRequest = nodeTarget
        ? async (proxyOpts: {
            method: string;
            path: string;
            query?: Record<string, string | number | boolean | undefined>;
            body?: unknown;
            timeoutMs?: number;
            profile?: string;
            approvedOrigin?: string;
          }) => {
            if (approved && browserStewardRuntimeDecision && !nodeTarget.supportsApprovedOrigin) {
              throw new Error(
                "Browser Steward approved node action requires a compatible browser node",
              );
            }
            const proxy = await callBrowserProxy({
              nodeId: nodeTarget.nodeId,
              method: proxyOpts.method,
              path: proxyOpts.path,
              query: proxyOpts.query,
              body: proxyOpts.body,
              timeoutMs: proxyOpts.timeoutMs,
              profile: proxyOpts.profile,
              approvedOrigin: proxyOpts.approvedOrigin,
              agentSessionKey: browserStewardRuntimeDecision ? undefined : opts?.agentSessionKey,
              agentId: browserStewardRuntimeDecision ? undefined : opts?.agentId,
            });
            const mapping = await persistProxyFiles(proxy.files);
            applyProxyPaths(proxy.result, mapping);
            return proxy.result;
          }
        : null;
      const toolTimeoutMs =
        requestedTimeoutMs ??
        (usesExistingSessionManageFlow({ action, profileName: profile })
          ? DEFAULT_EXISTING_SESSION_MANAGE_TIMEOUT_MS
          : undefined);
      const touchTrackedTab = (targetId: string | undefined) => {
        if (proxyRequest || !targetId) {
          return;
        }
        browserToolDeps.touchSessionBrowserTab({
          sessionKey: opts?.agentSessionKey,
          ...(opts?.agentId ? { agentId: opts.agentId } : {}),
          targetId,
          baseUrl,
          profile,
          browserStewardRuntimeDecision,
        });
      };
      const revalidateApprovedClose = async () => {
        if (!appliesBrowserStewardRuntimeGuard || !approved || !approvalBinding?.origin) {
          return;
        }
        const closeExecution = await resolveBrowserStewardExecution({
          toolParams: restoredParams,
          sandboxBridgeUrl: opts?.sandboxBridgeUrl,
          allowHostControl: opts?.allowHostControl,
          requireOrigin: true,
          requireTarget: true,
          expectedOrigin: approvalBinding.origin,
        });
        if (!matchesBrowserStewardRuntimeApprovalBinding(publicParams, closeExecution.binding)) {
          throw new Error(
            "Browser Steward runtime approval invalidated: browser destination changed before close",
          );
        }
      };

      try {
        switch (action) {
          case "doctor":
            if (proxyRequest) {
              return jsonResult(
                await proxyRequest({
                  method: "GET",
                  path: "/doctor",
                  profile,
                }),
              );
            }
            return jsonResult(await browserToolDeps.browserDoctor(baseUrl, { profile }));
          case "status":
            if (proxyRequest) {
              return jsonResult(
                await proxyRequest({
                  method: "GET",
                  path: "/",
                  profile,
                  timeoutMs: toolTimeoutMs,
                }),
              );
            }
            return jsonResult(
              await browserToolDeps.browserStatus(baseUrl, { profile, timeoutMs: toolTimeoutMs }),
            );
          case "start":
            if (proxyRequest) {
              await proxyRequest({
                method: "POST",
                path: "/start",
                profile,
                timeoutMs: toolTimeoutMs,
              });
              return jsonResult(
                await proxyRequest({
                  method: "GET",
                  path: "/",
                  profile,
                  timeoutMs: toolTimeoutMs,
                }),
              );
            }
            await browserToolDeps.browserStart(baseUrl, { profile, timeoutMs: toolTimeoutMs });
            return jsonResult(
              await browserToolDeps.browserStatus(baseUrl, { profile, timeoutMs: toolTimeoutMs }),
            );
          case "stop":
            if (proxyRequest) {
              await proxyRequest({
                method: "POST",
                path: "/stop",
                profile,
                timeoutMs: toolTimeoutMs,
              });
              return jsonResult(
                await proxyRequest({
                  method: "GET",
                  path: "/",
                  profile,
                  timeoutMs: toolTimeoutMs,
                }),
              );
            }
            await browserToolDeps.browserStop(baseUrl, { profile, timeoutMs: toolTimeoutMs });
            return jsonResult(
              await browserToolDeps.browserStatus(baseUrl, { profile, timeoutMs: toolTimeoutMs }),
            );
          case "profiles":
            if (proxyRequest) {
              const result = await proxyRequest({
                method: "GET",
                path: "/profiles",
                timeoutMs: toolTimeoutMs,
              });
              return jsonResult(result);
            }
            return jsonResult({
              profiles: await browserToolDeps.browserProfiles(baseUrl, {
                timeoutMs: toolTimeoutMs,
              }),
            });
          case "tabs":
            return await executeTabsAction({
              baseUrl,
              profile,
              timeoutMs: toolTimeoutMs,
              proxyRequest,
            });
          case "open": {
            const targetUrl = readTargetUrlParam(params);
            const label = normalizeOptionalString(params.label);
            if (proxyRequest) {
              const result = await proxyRequest({
                method: "POST",
                path: "/tabs/open",
                profile,
                approvedOrigin: approvalBinding?.origin,
                body: { url: targetUrl, ...(label ? { label } : {}) },
                timeoutMs: toolTimeoutMs,
              });
              assertBrowserStewardApprovedResultOrigin(
                (result as { url?: unknown }).url,
                approvalBinding?.origin,
              );
              return jsonResult(result);
            }
            const opened = await browserToolDeps.browserOpenTab(baseUrl, targetUrl, {
              profile,
              label,
              timeoutMs: toolTimeoutMs,
              ...(approvalBinding?.origin ? { approvedOrigin: approvalBinding.origin } : {}),
            });
            assertBrowserStewardApprovedResultOrigin(opened.url, approvalBinding?.origin);
            browserToolDeps.trackSessionBrowserTab({
              sessionKey: opts?.agentSessionKey,
              ...(opts?.agentId ? { agentId: opts.agentId } : {}),
              targetId: opened.targetId,
              baseUrl,
              profile,
              browserStewardRuntimeDecision,
            });
            return jsonResult(opened);
          }
          case "focus": {
            const targetId = readStringParam(params, "targetId", {
              required: true,
            });
            if (proxyRequest) {
              const result = await proxyRequest({
                method: "POST",
                path: "/tabs/focus",
                profile,
                approvedOrigin: approvalBinding?.origin,
                body: { targetId },
                timeoutMs: toolTimeoutMs,
              });
              return jsonResult(result);
            }
            await browserToolDeps.browserFocusTab(baseUrl, targetId, {
              profile,
              timeoutMs: toolTimeoutMs,
              ...(approvalBinding?.origin ? { approvedOrigin: approvalBinding.origin } : {}),
            });
            touchTrackedTab(targetId);
            return jsonResult({ ok: true });
          }
          case "close": {
            const targetId = readStringParam(params, "targetId");
            await revalidateApprovedClose();
            if (proxyRequest) {
              const result = targetId
                ? await proxyRequest({
                    method: "DELETE",
                    path: `/tabs/${encodeURIComponent(targetId)}`,
                    profile,
                    timeoutMs: toolTimeoutMs,
                    approvedOrigin: approvalBinding?.origin,
                  })
                : await proxyRequest({
                    method: "POST",
                    path: "/act",
                    profile,
                    body: { kind: "close" },
                    timeoutMs: toolTimeoutMs,
                    approvedOrigin: approvalBinding?.origin,
                  });
              return jsonResult(result);
            }
            if (targetId) {
              await browserToolDeps.browserCloseTab(baseUrl, targetId, {
                profile,
                timeoutMs: toolTimeoutMs,
                ...(approvalBinding?.origin ? { approvedOrigin: approvalBinding.origin } : {}),
              });
              browserToolDeps.untrackSessionBrowserTab({
                sessionKey: opts?.agentSessionKey,
                ...(opts?.agentId ? { agentId: opts.agentId } : {}),
                targetId,
                baseUrl,
                profile,
              });
            } else {
              await browserToolDeps.browserAct(
                baseUrl,
                { kind: "close" },
                {
                  profile,
                  timeoutMs: toolTimeoutMs,
                  ...(approvalBinding?.origin ? { approvedOrigin: approvalBinding.origin } : {}),
                },
              );
            }
            return jsonResult({ ok: true });
          }
          case "snapshot":
            return await executeSnapshotAction({
              input: params,
              baseUrl,
              profile,
              proxyRequest,
              approvedOrigin: approvalBinding?.origin,
              onTabActivity: touchTrackedTab,
            });
          case "screenshot": {
            const targetId = readStringParam(params, "targetId");
            const fullPage = Boolean(params.fullPage);
            const ref = readStringParam(params, "ref");
            const element = readStringParam(params, "element");
            const labels = typeof params.labels === "boolean" ? params.labels : undefined;
            const type = params.type === "jpeg" ? "jpeg" : "png";
            const effectiveTimeoutMs = requestedTimeoutMs ?? DEFAULT_BROWSER_SCREENSHOT_TIMEOUT_MS;
            const result = proxyRequest
              ? ((await proxyRequest({
                  method: "POST",
                  path: "/screenshot",
                  profile,
                  timeoutMs: effectiveTimeoutMs,
                  ...(approvalBinding?.origin ? { approvedOrigin: approvalBinding.origin } : {}),
                  body: {
                    targetId,
                    fullPage,
                    ref,
                    element,
                    type,
                    labels,
                    timeoutMs: effectiveTimeoutMs,
                  },
                })) as Awaited<ReturnType<typeof browserScreenshotAction>>)
              : await browserToolDeps.browserScreenshotAction(baseUrl, {
                  targetId,
                  fullPage,
                  ref,
                  element,
                  type,
                  labels,
                  timeoutMs: effectiveTimeoutMs,
                  profile,
                  ...(approvalBinding?.origin ? { approvedOrigin: approvalBinding.origin } : {}),
                });
            touchTrackedTab(readStringValue(result.targetId) ?? targetId);
            const screenshotPath = result.path;
            const screenshotCfg = browserToolDeps.getRuntimeConfig();
            const imageSanitization = resolveRuntimeImageSanitization();
            try {
              const described = await describeBrowserScreenshot(
                {
                  cfg: screenshotCfg,
                  filePath: screenshotPath,
                  agentDir: opts?.agentDir,
                  workspaceDir: opts?.workspaceDir,
                  activeModel: opts?.activeModel,
                  mediaScope: opts?.mediaScope,
                  imageSanitization,
                },
                {
                  describeImageFile: browserToolDeps.describeImageFile,
                  normalizeBrowserScreenshot: browserToolDeps.normalizeBrowserScreenshot,
                  saveMediaBuffer: browserToolDeps.saveMediaBuffer,
                },
              );
              if (described) {
                const analyzedBy =
                  described.provider && described.model
                    ? `${described.provider}/${described.model}`
                    : "media image understanding";
                const headerLines = [`[analyzed by ${analyzedBy}]`];
                // Vision model descriptions contain web page content which is
                // untrusted external input — wrap it the same way snapshot and
                // tabs results are wrapped to mitigate prompt injection.
                const wrappedDescription = wrapExternalContent(
                  neutralizeMediaDirectives(described.text.trim()),
                  {
                    source: "browser",
                    includeWarning: true,
                  },
                );
                const text = `${headerLines.join("\n")}\n${wrappedDescription}`;
                return {
                  content: [{ type: "text", text }],
                  details: {
                    ...(result as Record<string, unknown>),
                    // Do NOT include details.media here — the vision path returns
                    // a text description as the deliverable output. Exposing the raw
                    // screenshot as media would cause channel delivery to auto-send
                    // potentially sensitive page content. The local screenshot file
                    // is still referenced in result.path for diagnostic purposes.
                    vision: {
                      provider: described.provider,
                      model: described.model,
                      decision: described.decision,
                    },
                  },
                };
              }
            } catch (err) {
              // Fall back to returning the raw image block so the agent loop can
              // still recover. Provider/runtime error messages are untrusted
              // input too, so defang line-start final-reply media directives.
              const rawReason = err instanceof Error ? err.message : String(err);
              const reason = neutralizeMediaDirectives(rawReason);
              const extraText = `[browser screenshot vision failed: ${reason}]`;
              return await browserToolDeps.imageResultFromFile({
                label: "browser:screenshot",
                path: screenshotPath,
                extraText,
                details: result,
                imageSanitization,
              });
            }
            return await browserToolDeps.imageResultFromFile({
              label: "browser:screenshot",
              path: screenshotPath,
              details: result,
              imageSanitization,
            });
          }
          case "navigate": {
            const targetUrl = readTargetUrlParam(params);
            const targetId = readStringParam(params, "targetId");
            if (proxyRequest) {
              const result = await proxyRequest({
                method: "POST",
                path: "/navigate",
                profile,
                approvedOrigin: approvalBinding?.origin,
                body: {
                  url: targetUrl,
                  targetId,
                },
              });
              assertBrowserStewardApprovedResultOrigin(
                (result as { url?: unknown }).url,
                approvalBinding?.origin,
              );
              return jsonResult(result);
            }
            const result = await browserToolDeps.browserNavigate(baseUrl, {
              url: targetUrl,
              targetId,
              profile,
              ...(approvalBinding?.origin ? { approvedOrigin: approvalBinding.origin } : {}),
            });
            assertBrowserStewardApprovedResultOrigin(result.url, approvalBinding?.origin);
            touchTrackedTab(readStringValue(result.targetId) ?? targetId);
            return jsonResult(result);
          }
          case "console":
            return await executeConsoleAction({
              input: params,
              baseUrl,
              profile,
              proxyRequest,
              approvedOrigin: approvalBinding?.origin,
            });
          case "pdf": {
            const targetId = normalizeOptionalString(params.targetId);
            const result = proxyRequest
              ? ((await proxyRequest({
                  method: "POST",
                  path: "/pdf",
                  profile,
                  approvedOrigin: approvalBinding?.origin,
                  body: { targetId },
                })) as Awaited<ReturnType<typeof browserPdfSave>>)
              : await browserToolDeps.browserPdfSave(baseUrl, {
                  targetId,
                  profile,
                  ...(approvalBinding?.origin ? { approvedOrigin: approvalBinding.origin } : {}),
                });
            touchTrackedTab(readStringValue(result.targetId) ?? targetId);
            return {
              content: [{ type: "text" as const, text: `FILE:${result.path}` }],
              details: result,
            };
          }
          case "upload": {
            const paths = Array.isArray(params.paths) ? params.paths.map((p) => String(p)) : [];
            if (paths.length === 0) {
              throw new Error("paths required");
            }
            const resolvedResult = await resolveExistingUploadPaths({ requestedPaths: paths });
            if (!resolvedResult.ok) {
              throw new Error(resolvedResult.error);
            }
            const normalizedPaths = resolvedResult.paths;
            const ref = readStringParam(params, "ref");
            const inputRef = readStringParam(params, "inputRef");
            const element = readStringParam(params, "element");
            const { targetId, timeoutMs } = readOptionalTargetAndTimeout(params);
            if (proxyRequest) {
              const result = await proxyRequest({
                method: "POST",
                path: "/hooks/file-chooser",
                profile,
                approvedOrigin: approvalBinding?.origin,
                body: {
                  paths: normalizedPaths,
                  ref,
                  inputRef,
                  element,
                  targetId,
                  timeoutMs,
                },
              });
              return jsonResult(result);
            }
            const result = await browserToolDeps.browserArmFileChooser(baseUrl, {
              paths: normalizedPaths,
              ref,
              inputRef,
              element,
              targetId,
              timeoutMs,
              profile,
              approvedOrigin: approvalBinding?.origin,
            });
            touchTrackedTab(
              readStringValue((result as { targetId?: unknown }).targetId) ?? targetId,
            );
            return jsonResult(result);
          }
          case "dialog": {
            const accept = Boolean(params.accept);
            const promptText = readStringValue(params.promptText);
            const dialogId = readStringValue(params.dialogId);
            const { targetId, timeoutMs } = readOptionalTargetAndTimeout(params);
            if (proxyRequest) {
              const result = await proxyRequest({
                method: "POST",
                path: "/hooks/dialog",
                profile,
                approvedOrigin: approvalBinding?.origin,
                body: {
                  accept,
                  promptText,
                  dialogId,
                  targetId,
                  timeoutMs,
                },
              });
              return jsonResult(result);
            }
            const result = await browserToolDeps.browserArmDialog(baseUrl, {
              accept,
              promptText,
              dialogId,
              targetId,
              timeoutMs,
              profile,
              approvedOrigin: approvalBinding?.origin,
            });
            touchTrackedTab(
              readStringValue((result as { targetId?: unknown }).targetId) ?? targetId,
            );
            return jsonResult(result);
          }
          case "act": {
            const request = resolveBrowserStewardActRequest(executionParams);
            if (!request) {
              throw new Error("request required");
            }
            return await executeActAction({
              request,
              baseUrl,
              profile,
              proxyRequest,
              approvedOrigin: approvalBinding?.origin,
              onTabActivity: touchTrackedTab,
            });
          }
          default:
            throw new Error(`Unknown action: ${action}`);
        }
      } catch (error) {
        throw toSafeBrowserStewardExecutionError(error, approved, browserStewardRuntimeDecision);
      }
    },
  };
}
export { testing as __testing };
