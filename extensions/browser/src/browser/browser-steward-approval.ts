import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  evaluateBrowserStewardRuntimeGuard,
  redactBrowserStewardCredentialMaterial,
  resolveBrowserStewardProxyAction,
  type BrowserStewardSessionBoundary,
} from "./browser-steward-runtime-guard.js";
import { normalizeBrowserRequestPath } from "./request-policy.js";

// Plugin discovery can load policy and tool modules through distinct runtime
// registries. A process-global symbol preserves the unforgeable JSON boundary
// while allowing an approval issued by one module instance to reach another.
const BROWSER_STEWARD_RUNTIME_APPROVAL = Symbol.for("openclaw.browser-steward-runtime-approval");
const BROWSER_STEWARD_RUNTIME_APPROVAL_STATE = Symbol.for(
  "openclaw.browser-steward-runtime-approval-state",
);
const BROWSER_STEWARD_GATEWAY_APPROVAL_TTL_MS = 30_000;
const consumedBrowserStewardGatewayAuthorities = new Map<string, number>();

type BrowserStewardRuntimeApproval = {
  approved: boolean;
  rawParams: Record<string, unknown>;
  publicParams: Record<string, unknown>;
  binding: BrowserStewardRuntimeApprovalBinding;
};

export type BrowserStewardRuntimeApprovalBinding = {
  backend: {
    kind: "host" | "sandbox" | "node";
    identity?: string;
  };
  browserNodeSessionLease?: string;
  origin?: string;
  targetRef?: string;
  profile?: string;
};

/** Gateway-issued approval facts carried to a separate browser node. */
export type BrowserStewardGatewayApproval = {
  issuer: "gateway.operator.admin";
  command: "browser.proxy" | "browser.proxy.upload.v1";
  action: string;
  profile: string;
  requestFingerprint: string;
  sessionBoundary: BrowserStewardSessionBoundary;
  authorityId: string;
  expiresAtMs: number;
  nodeId: string;
  pairingGeneration: string;
  invocationId: string;
};

function canonicalizeBrowserStewardApprovalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeBrowserStewardApprovalValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .toSorted()
      .map((key) => [key, canonicalizeBrowserStewardApprovalValue(record[key])]),
  );
}

function normalizeBrowserStewardApprovalPath(value: string | undefined): string {
  return normalizeBrowserRequestPath(value ?? "");
}

function createBrowserStewardRequestFingerprint(params: {
  command: string;
  method?: string;
  path?: string;
  query?: unknown;
  body?: unknown;
  upload?: unknown;
  profile?: string;
  agentSessionKey?: string;
  agentId?: string;
}): string {
  const canonical = JSON.stringify(
    canonicalizeBrowserStewardApprovalValue({
      command: params.command,
      method: params.method?.trim().toUpperCase() ?? "GET",
      path: normalizeBrowserStewardApprovalPath(params.path),
      query: params.query,
      body: params.body,
      upload: params.upload,
      profile: params.profile,
      agentSessionKey: params.agentSessionKey,
      agentId: params.agentId,
    }),
  );
  return createHash("sha256")
    .update(canonical ?? "undefined")
    .digest("hex");
}

function isBrowserStewardProxyCommand(
  command: string,
): command is BrowserStewardGatewayApproval["command"] {
  return command === "browser.proxy" || command === "browser.proxy.upload.v1";
}

/** Creates redacted approval facts after a trusted Gateway/admin decision. */
export function createBrowserStewardGatewayApproval(params: {
  command: string;
  method?: string;
  path?: string;
  query?: unknown;
  body?: unknown;
  upload?: unknown;
  profile?: string;
  agentSessionKey?: string;
  agentId?: string;
  nodeId: string;
  pairingGeneration: string;
  invocationId: string;
  nowMs?: number;
}): BrowserStewardGatewayApproval {
  if (!isBrowserStewardProxyCommand(params.command)) {
    throw new Error("unsupported Browser Steward gateway approval command");
  }
  if (!params.nodeId.trim() || !params.pairingGeneration.trim() || !params.invocationId.trim()) {
    throw new Error("incomplete Browser Steward gateway approval authority");
  }
  const decision = evaluateBrowserStewardRuntimeGuard({
    action: resolveBrowserStewardProxyAction({
      method: params.method,
      path: params.path,
      body: params.body,
    }),
    profile: params.profile,
    agentSessionKey: params.agentSessionKey,
    agentId: params.agentId,
    approved: true,
    request: params.body,
  });
  const nowMs = params.nowMs ?? Date.now();
  return {
    issuer: "gateway.operator.admin",
    command: params.command,
    action: decision.requestedAction,
    profile: decision.affectedBrowserProfile,
    requestFingerprint: createBrowserStewardRequestFingerprint(params),
    sessionBoundary: decision.sessionBoundary,
    authorityId: randomUUID(),
    expiresAtMs: nowMs + BROWSER_STEWARD_GATEWAY_APPROVAL_TTL_MS,
    nodeId: params.nodeId,
    pairingGeneration: params.pairingGeneration,
    invocationId: params.invocationId,
  };
}

type BrowserStewardGatewayApprovalValidationParams = {
  approval: unknown;
  command: string;
  method?: string;
  path?: string;
  query?: unknown;
  body?: unknown;
  upload?: unknown;
  profile?: string;
  agentSessionKey?: string;
  agentId?: string;
  nodeId?: string;
  pairingGeneration?: string;
  invocationId?: string;
  nowMs?: number;
};

function readBrowserStewardGatewayApproval(
  value: unknown,
): BrowserStewardGatewayApproval | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const approval = value as Partial<BrowserStewardGatewayApproval>;
  if (
    approval.issuer !== "gateway.operator.admin" ||
    !isBrowserStewardProxyCommand(approval.command ?? "") ||
    typeof approval.action !== "string" ||
    typeof approval.profile !== "string" ||
    typeof approval.requestFingerprint !== "string" ||
    typeof approval.authorityId !== "string" ||
    !approval.authorityId.trim() ||
    typeof approval.expiresAtMs !== "number" ||
    !Number.isSafeInteger(approval.expiresAtMs) ||
    typeof approval.nodeId !== "string" ||
    !approval.nodeId.trim() ||
    typeof approval.pairingGeneration !== "string" ||
    !approval.pairingGeneration.trim() ||
    typeof approval.invocationId !== "string" ||
    !approval.invocationId.trim() ||
    !approval.sessionBoundary ||
    typeof approval.sessionBoundary !== "object"
  ) {
    return undefined;
  }
  return approval as BrowserStewardGatewayApproval;
}

/** Validates that node-host approval facts match this exact browser request. */
export function isBrowserStewardGatewayApprovalValid(
  params: BrowserStewardGatewayApprovalValidationParams,
): boolean {
  if (!isBrowserStewardProxyCommand(params.command)) {
    return false;
  }
  try {
    const approval = readBrowserStewardGatewayApproval(params.approval);
    if (!approval || approval.command !== params.command) {
      return false;
    }
    const decision = evaluateBrowserStewardRuntimeGuard({
      action: resolveBrowserStewardProxyAction({
        method: params.method,
        path: params.path,
        body: params.body,
      }),
      profile: params.profile,
      agentSessionKey: params.agentSessionKey,
      agentId: params.agentId,
      approved: true,
      request: params.body,
    });
    const expectedFingerprint = createBrowserStewardRequestFingerprint(params);
    if (
      approval.action !== decision.requestedAction ||
      approval.profile !== decision.affectedBrowserProfile ||
      approval.requestFingerprint !== expectedFingerprint ||
      !isDeepStrictEqual(approval.sessionBoundary, decision.sessionBoundary)
    ) {
      return false;
    }
    const nowMs = params.nowMs ?? Date.now();
    if (approval.expiresAtMs <= nowMs) {
      return false;
    }
    for (const [authorityId, expiresAtMs] of consumedBrowserStewardGatewayAuthorities) {
      if (expiresAtMs <= nowMs) {
        consumedBrowserStewardGatewayAuthorities.delete(authorityId);
      }
    }
    if (
      !params.nodeId ||
      !params.pairingGeneration ||
      !params.invocationId ||
      !isDeepStrictEqual(
        [approval.nodeId, approval.pairingGeneration, approval.invocationId],
        [params.nodeId, params.pairingGeneration, params.invocationId],
      )
    ) {
      return false;
    }
    return !consumedBrowserStewardGatewayAuthorities.has(approval.authorityId);
  } catch {
    return false;
  }
}

/** Redeems a node-bound Gateway approval exactly once at the node effect boundary. */
export function consumeBrowserStewardGatewayApproval(
  params: BrowserStewardGatewayApprovalValidationParams,
): boolean {
  const approval = readBrowserStewardGatewayApproval(params.approval);
  if (
    !approval ||
    !params.nodeId ||
    !params.pairingGeneration ||
    !params.invocationId ||
    !isBrowserStewardGatewayApprovalValid(params)
  ) {
    return false;
  }
  consumedBrowserStewardGatewayAuthorities.set(approval.authorityId, approval.expiresAtMs);
  return true;
}

type BrowserStewardRuntimeApprovalState = {
  approvals: WeakMap<object, BrowserStewardRuntimeApproval>;
};

function runtimeApprovalState(): BrowserStewardRuntimeApprovalState {
  const globalState = globalThis as typeof globalThis & {
    [BROWSER_STEWARD_RUNTIME_APPROVAL_STATE]?: BrowserStewardRuntimeApprovalState;
  };
  globalState[BROWSER_STEWARD_RUNTIME_APPROVAL_STATE] ??= {
    approvals: new WeakMap(),
  };
  return globalState[BROWSER_STEWARD_RUNTIME_APPROVAL_STATE];
}

function readBrowserStewardRuntimeApproval(
  params: unknown,
): BrowserStewardRuntimeApproval | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const token = (params as Record<symbol, unknown>)[BROWSER_STEWARD_RUNTIME_APPROVAL];
  return token && typeof token === "object"
    ? runtimeApprovalState().approvals.get(token)
    : undefined;
}

function matchesApprovedPublicParams(
  params: Record<string | symbol, unknown>,
  approval: BrowserStewardRuntimeApproval,
): boolean {
  const candidate = Object.fromEntries(Object.entries(params));
  return isDeepStrictEqual(candidate, approval.publicParams);
}

function cloneBrowserStewardApprovalParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  return structuredClone(Object.fromEntries(Object.entries(params))) as Record<string, unknown>;
}

function attachBrowserStewardRuntimeApproval(
  rawParams: Record<string, unknown>,
  publicParams: Record<string, unknown>,
  approved: boolean,
  binding: BrowserStewardRuntimeApprovalBinding,
): Record<string, unknown> {
  const approvedParams = cloneBrowserStewardApprovalParams(publicParams);
  const token = {};
  runtimeApprovalState().approvals.set(token, {
    approved,
    rawParams: cloneBrowserStewardApprovalParams(rawParams),
    publicParams: cloneBrowserStewardApprovalParams(publicParams),
    binding: structuredClone(binding),
  });
  Object.defineProperty(approvedParams, BROWSER_STEWARD_RUNTIME_APPROVAL, {
    value: token,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return approvedParams;
}

/**
 * Adds an in-process approval marker that model JSON cannot construct.
 * The marker remains non-serializable so diagnostics never expose it.
 */
export function markBrowserStewardRuntimeApproved(
  rawParams: Record<string, unknown>,
  binding: BrowserStewardRuntimeApprovalBinding,
): Record<string, unknown>;
export function markBrowserStewardRuntimeApproved(
  rawParams: Record<string, unknown>,
  publicParams: Record<string, unknown>,
  binding: BrowserStewardRuntimeApprovalBinding,
): Record<string, unknown>;
export function markBrowserStewardRuntimeApproved(
  rawParams: Record<string, unknown>,
  publicParamsOrBinding: Record<string, unknown> | BrowserStewardRuntimeApprovalBinding,
  binding?: BrowserStewardRuntimeApprovalBinding,
): Record<string, unknown> {
  const publicParams = binding ? (publicParamsOrBinding as Record<string, unknown>) : rawParams;
  const resolvedBinding =
    binding ?? (publicParamsOrBinding as BrowserStewardRuntimeApprovalBinding);
  return attachBrowserStewardRuntimeApproval(rawParams, publicParams, true, resolvedBinding);
}

/** Attach a marker that remains unusable until this policy's approval resolves. */
export function markBrowserStewardRuntimeApprovalPending(
  rawParams: Record<string, unknown>,
  binding: BrowserStewardRuntimeApprovalBinding,
): Record<string, unknown>;
export function markBrowserStewardRuntimeApprovalPending(
  rawParams: Record<string, unknown>,
  publicParams: Record<string, unknown>,
  binding: BrowserStewardRuntimeApprovalBinding,
): Record<string, unknown>;
export function markBrowserStewardRuntimeApprovalPending(
  rawParams: Record<string, unknown>,
  publicParamsOrBinding: Record<string, unknown> | BrowserStewardRuntimeApprovalBinding,
  binding?: BrowserStewardRuntimeApprovalBinding,
): Record<string, unknown> {
  const publicParams = binding ? (publicParamsOrBinding as Record<string, unknown>) : rawParams;
  const resolvedBinding =
    binding ?? (publicParamsOrBinding as BrowserStewardRuntimeApprovalBinding);
  return attachBrowserStewardRuntimeApproval(rawParams, publicParams, false, resolvedBinding);
}

/** Activate only the pending marker attached by the Browser Steward policy. */
export function approveBrowserStewardRuntimeParams(params: unknown): void {
  const approval = readBrowserStewardRuntimeApproval(params);
  if (approval) {
    approval.approved = true;
  }
}

/** True only for params marked by the trusted Browser plugin policy. */
export function isBrowserStewardRuntimeApproved(params: unknown): boolean {
  const approval = readBrowserStewardRuntimeApproval(params);
  return Boolean(
    approval?.approved &&
    params &&
    typeof params === "object" &&
    matchesApprovedPublicParams(params as Record<string | symbol, unknown>, approval),
  );
}

/** Reads the private destination binding without exposing it through JSON. */
export function getBrowserStewardRuntimeApprovalBinding(
  params: unknown,
): BrowserStewardRuntimeApprovalBinding | undefined {
  const approval = readBrowserStewardRuntimeApproval(params);
  if (
    !approval?.approved ||
    !params ||
    typeof params !== "object" ||
    !matchesApprovedPublicParams(params as Record<string | symbol, unknown>, approval)
  ) {
    return undefined;
  }
  return structuredClone(approval.binding);
}

/** Reads the prepared destination binding while approval is still pending. */
export function getBrowserStewardRuntimeApprovalPromptBinding(
  params: unknown,
): BrowserStewardRuntimeApprovalBinding | undefined {
  const approval = readBrowserStewardRuntimeApproval(params);
  if (
    !approval ||
    !params ||
    typeof params !== "object" ||
    !matchesApprovedPublicParams(params as Record<string | symbol, unknown>, approval)
  ) {
    return undefined;
  }
  return structuredClone(approval.binding);
}

/** Confirms that approval still targets the exact backend and tab origin. */
export function matchesBrowserStewardRuntimeApprovalBinding(
  params: unknown,
  binding: BrowserStewardRuntimeApprovalBinding,
): boolean {
  const approvedBinding = getBrowserStewardRuntimeApprovalBinding(params);
  return approvedBinding !== undefined && isDeepStrictEqual(approvedBinding, binding);
}

/** Restores private params after the generic diagnostic wrapper has captured only redacted input. */
export function resolveBrowserStewardRuntimeApprovedParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const approval = readBrowserStewardRuntimeApproval(params);
  if (!approval?.approved || !matchesApprovedPublicParams(params, approval)) {
    return params;
  }
  return cloneBrowserStewardApprovalParams(approval.rawParams);
}

/** Reads raw params only for the trusted Browser policy/guard, never for diagnostics or hooks. */
export function resolveBrowserStewardRuntimePolicyParams(params: unknown): Record<string, unknown> {
  const approval = readBrowserStewardRuntimeApproval(params);
  return approval
    ? cloneBrowserStewardApprovalParams(approval.rawParams)
    : (params as Record<string, unknown>);
}

export function resolveBrowserStewardRuntimeApprovalBinding(
  params: Record<string, unknown>,
): BrowserStewardRuntimeApprovalBinding {
  const target = typeof params.target === "string" ? params.target.trim().toLowerCase() : "";
  const requestedNode = typeof params.node === "string" ? params.node.trim() : "";
  const backendKind =
    target === "sandbox" ? "sandbox" : target === "node" || requestedNode ? "node" : "host";
  return {
    backend: {
      kind: backendKind,
      ...(backendKind === "node" && requestedNode ? { identity: requestedNode } : {}),
    },
    ...(typeof params.browserNodeSessionLease === "string" && params.browserNodeSessionLease.trim()
      ? { browserNodeSessionLease: params.browserNodeSessionLease.trim() }
      : {}),
    ...(typeof params.origin === "string" && params.origin.trim()
      ? { origin: params.origin.trim() }
      : {}),
    ...(typeof params.targetRef === "string" && params.targetRef.trim()
      ? { targetRef: params.targetRef.trim() }
      : {}),
    ...(typeof params.profile === "string" && params.profile.trim()
      ? { profile: params.profile.trim() }
      : {}),
  };
}

/** Checks every destination fact that the approval captured; omitted facts stay unknown. */
export function matchesBrowserStewardRuntimeApprovalBindingAtExecution(
  approved: BrowserStewardRuntimeApprovalBinding,
  actual: BrowserStewardRuntimeApprovalBinding,
): boolean {
  return (
    approved.backend.kind === actual.backend.kind &&
    (approved.backend.identity === undefined ||
      approved.backend.identity === actual.backend.identity) &&
    (approved.origin === undefined || approved.origin === actual.origin) &&
    (approved.browserNodeSessionLease === undefined ||
      approved.browserNodeSessionLease === actual.browserNodeSessionLease) &&
    (approved.targetRef === undefined || approved.targetRef === actual.targetRef) &&
    (approved.profile === undefined || approved.profile === actual.profile)
  );
}

/** Prepare a Browser call with an unforgeable, exact-argument approval slot. */
export function prepareBrowserStewardRuntimeParams(
  params: unknown,
  binding?: BrowserStewardRuntimeApprovalBinding,
): unknown {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return params;
  }
  const record = params as Record<string, unknown>;
  const publicParams = redactBrowserStewardCredentialMaterial(record);
  return markBrowserStewardRuntimeApprovalPending(
    record,
    publicParams as Record<string, unknown>,
    binding ?? resolveBrowserStewardRuntimeApprovalBinding(record),
  );
}

/** Transfer a resolved approval only when the final hook output is unchanged. */
export function finalizeBrowserStewardRuntimeParams(
  params: unknown,
  preparedParams: unknown,
): unknown {
  const approval = readBrowserStewardRuntimeApproval(preparedParams);
  if (
    !approval?.approved ||
    !params ||
    typeof params !== "object" ||
    Array.isArray(params) ||
    !matchesApprovedPublicParams(params as Record<string | symbol, unknown>, approval)
  ) {
    return params;
  }
  return attachBrowserStewardRuntimeApproval(
    approval.rawParams,
    params as Record<string, unknown>,
    true,
    approval.binding,
  );
}
