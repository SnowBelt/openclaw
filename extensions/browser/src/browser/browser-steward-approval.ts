import { isDeepStrictEqual } from "node:util";

// Plugin discovery can load policy and tool modules through distinct runtime
// registries. A process-global symbol preserves the unforgeable JSON boundary
// while allowing an approval issued by one module instance to reach another.
const BROWSER_STEWARD_RUNTIME_APPROVAL = Symbol.for("openclaw.browser-steward-runtime-approval");
const BROWSER_STEWARD_RUNTIME_APPROVAL_STATE = Symbol.for(
  "openclaw.browser-steward-runtime-approval-state",
);

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
  origin?: string;
  targetRef?: string;
};

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
  publicParams: Record<string, unknown> = rawParams,
  binding: BrowserStewardRuntimeApprovalBinding,
): Record<string, unknown> {
  return attachBrowserStewardRuntimeApproval(rawParams, publicParams, true, binding);
}

/** Attach a marker that remains unusable until this policy's approval resolves. */
export function markBrowserStewardRuntimeApprovalPending(
  rawParams: Record<string, unknown>,
  publicParams: Record<string, unknown> = rawParams,
  binding: BrowserStewardRuntimeApprovalBinding,
): Record<string, unknown> {
  return attachBrowserStewardRuntimeApproval(rawParams, publicParams, false, binding);
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
