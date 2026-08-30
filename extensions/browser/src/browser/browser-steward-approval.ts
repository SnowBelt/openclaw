import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  redactBrowserStewardCredentialMaterial,
  resolveBrowserStewardSessionBoundary,
} from "./browser-steward-runtime-guard.js";

// The model-visible parameter object carries only the redacted snapshot. The
// approval state is process-local and the raw request lives only in this WeakMap.
const APPROVAL_STATE = Symbol.for("openclaw.browser-steward.approval-state");
/** Keep the private approval lease alive slightly longer than the user-facing wait. */
export const BROWSER_STEWARD_APPROVAL_TIMEOUT_MS = 45_000;
const APPROVAL_TTL_MS = BROWSER_STEWARD_APPROVAL_TIMEOUT_MS + 15_000;
const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/iu;
const SAFE_PROFILE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/iu;

export type BrowserStewardRuntimeTarget = "host" | "sandbox";
export type BrowserStewardRuntimeTargetKind = BrowserStewardRuntimeTarget | "runtime" | "invalid";

export type BrowserStewardRuntimeApprovalBinding = {
  action: string;
  target: BrowserStewardRuntimeTargetKind;
  profile: string;
  affectedSession: string;
  agentId: string;
  semanticDigest: string;
};

export type BrowserStewardRuntimePreparationFacts = {
  prepared: boolean;
  toolCallId?: string;
  target: string;
  targetKind: BrowserStewardRuntimeTargetKind;
  sandboxBridgeAvailable: boolean;
  allowHostControl: boolean;
  binding: BrowserStewardRuntimeApprovalBinding;
};

type ApprovalStatus = "pending" | "approved" | "consumed" | "denied";

type BrowserStewardRuntimeApprovalState = {
  status: ApprovalStatus;
  rawParams: Record<string, unknown>;
  publicParams: Record<string, unknown>;
  binding: BrowserStewardRuntimeApprovalBinding;
  sessionBoundaryDigest: string;
  target: string;
  targetKind: BrowserStewardRuntimeTargetKind;
  sandboxBridgeAvailable: boolean;
  allowHostControl: boolean;
  expiresAt: number;
  toolCallId?: string;
};

type BrowserStewardRuntimeGlobalState = {
  approvals: WeakMap<object, BrowserStewardRuntimeApprovalState>;
};

function getGlobalApprovalState(): BrowserStewardRuntimeGlobalState {
  const globalState = globalThis as typeof globalThis &
    Record<symbol, BrowserStewardRuntimeGlobalState | undefined>;
  const existing = globalState[APPROVAL_STATE];
  if (existing) {
    return existing;
  }
  const created = { approvals: new WeakMap<object, BrowserStewardRuntimeApprovalState>() };
  globalState[APPROVAL_STATE] = created;
  return created;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> | undefined {
  try {
    return structuredClone(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function publicParamsOf(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value));
}

function readApprovalState(value: unknown): BrowserStewardRuntimeApprovalState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return getGlobalApprovalState().approvals.get(value);
}

function expireIfNeeded(state: BrowserStewardRuntimeApprovalState): void {
  if (state.status !== "consumed" && state.status !== "denied" && Date.now() >= state.expiresAt) {
    state.status = "denied";
  }
}

function matchesPublicParams(value: unknown, state: BrowserStewardRuntimeApprovalState): boolean {
  const publicParams = publicParamsOf(value);
  return publicParams !== undefined && isDeepStrictEqual(publicParams, state.publicParams);
}

function normalizedAgentId(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return SAFE_AGENT_ID.test(normalized) ? normalized : "UNKNOWN";
}

function readTarget(params: Record<string, unknown>): {
  target: string;
  targetKind: BrowserStewardRuntimeTargetKind;
} {
  const value = params.target;
  if (value === undefined) {
    return { target: "runtime-selected", targetKind: "runtime" };
  }
  if (typeof value !== "string") {
    return { target: "REDACTED", targetKind: "invalid" };
  }
  const target = value.trim().toLowerCase();
  if (target === "host" || target === "sandbox") {
    return { target, targetKind: target };
  }
  return { target: target || "REDACTED", targetKind: "invalid" };
}

function readAction(params: Record<string, unknown>): string {
  return typeof params.action === "string" ? params.action.trim().toLowerCase() : "unknown";
}

function readProfile(params: Record<string, unknown>): string {
  const value = params.profile;
  if (value === undefined) {
    return "UNKNOWN";
  }
  if (typeof value !== "string") {
    return "REDACTED";
  }
  const profile = value.trim();
  return profile && SAFE_PROFILE_ID.test(profile) ? profile : "REDACTED";
}

function semanticDigest(value: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  const serialize = (nested: unknown): string => {
    if (nested === null || typeof nested !== "object") {
      return JSON.stringify(nested) ?? "null";
    }
    if (seen.has(nested)) {
      return '"[Circular]"';
    }
    seen.add(nested);
    if (Array.isArray(nested)) {
      return `[${nested.map(serialize).join(",")}]`;
    }
    const entries = Object.entries(nested).toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${serialize(entry)}`).join(",")}}`;
  };
  return createHash("sha256").update(serialize(value)).digest("hex").slice(0, 32);
}

function sessionBoundaryDigest(value: string | undefined): string {
  return createHash("sha256")
    .update("openclaw.browser-steward.session-boundary\0")
    .update(value === undefined ? "<undefined>" : value)
    .digest("hex");
}

function attachApprovalMarker(
  publicParams: Record<string, unknown>,
  state: BrowserStewardRuntimeApprovalState,
): Record<string, unknown> {
  getGlobalApprovalState().approvals.set(publicParams, state);
  return publicParams;
}

function publicBinding(
  value: BrowserStewardRuntimeApprovalState,
): BrowserStewardRuntimeApprovalBinding {
  return structuredClone(value.binding);
}

/** Prepare a Browser model call with a private raw snapshot and redacted public params. */
export function prepareBrowserStewardRuntimeParams(
  params: unknown,
  context: {
    toolCallId?: string;
    agentId?: string;
    sessionKey?: string;
    sandboxBridgeAvailable?: boolean;
    allowHostControl?: boolean;
  },
): unknown {
  if (!isRecord(params)) {
    return params;
  }
  const rawParams = cloneRecord(params);
  if (!rawParams) {
    const redactedFallback = redactBrowserStewardCredentialMaterial(params);
    return isRecord(redactedFallback) ? redactedFallback : { redacted: true };
  }
  const sandboxBridgeAvailable = context.sandboxBridgeAvailable === true;
  const target = readTarget(rawParams);
  const redacted = redactBrowserStewardCredentialMaterial(rawParams);
  if (!isRecord(redacted)) {
    return params;
  }
  const publicParams = cloneRecord(redacted);
  if (!publicParams) {
    return params;
  }
  const statePublicParams = cloneRecord(publicParams);
  if (!statePublicParams) {
    return params;
  }
  const sessionBoundary = resolveBrowserStewardSessionBoundary(context.sessionKey);
  const binding: BrowserStewardRuntimeApprovalBinding = {
    action: readAction(publicParams),
    target: target.targetKind,
    profile: readProfile(publicParams),
    affectedSession: sessionBoundary.affectedSession,
    agentId: normalizedAgentId(context.agentId),
    semanticDigest: semanticDigest(publicParams),
  };
  const state: BrowserStewardRuntimeApprovalState = {
    status: "pending",
    rawParams,
    publicParams: statePublicParams,
    binding,
    sessionBoundaryDigest: sessionBoundaryDigest(context.sessionKey),
    target: target.target,
    targetKind: target.targetKind,
    sandboxBridgeAvailable,
    allowHostControl: context.allowHostControl !== false,
    expiresAt: Date.now() + APPROVAL_TTL_MS,
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
  };
  return attachApprovalMarker(publicParams, state);
}

/** Confirm that a prepared call is still bound to the exact private context. */
export function matchesBrowserStewardRuntimePreparationContext(
  params: unknown,
  context: { toolCallId?: string; agentId?: string; sessionKey?: string },
): boolean {
  const state = readApprovalState(params);
  if (!state) {
    return false;
  }
  expireIfNeeded(state);
  return (
    state.status === "pending" &&
    matchesPublicParams(params, state) &&
    state.toolCallId === context.toolCallId &&
    state.sessionBoundaryDigest === sessionBoundaryDigest(context.sessionKey) &&
    state.binding.agentId === normalizedAgentId(context.agentId)
  );
}

/** Read only redacted preparation facts for the trusted Browser policy. */
export function getBrowserStewardRuntimePreparationFacts(
  params: unknown,
): BrowserStewardRuntimePreparationFacts | undefined {
  const state = readApprovalState(params);
  if (!state) {
    return undefined;
  }
  expireIfNeeded(state);
  if (state.status !== "pending" || !matchesPublicParams(params, state)) {
    return undefined;
  }
  return {
    prepared: true,
    ...(state.toolCallId ? { toolCallId: state.toolCallId } : {}),
    target: state.target,
    targetKind: state.targetKind,
    sandboxBridgeAvailable: state.sandboxBridgeAvailable,
    allowHostControl: state.allowHostControl,
    binding: publicBinding(state),
  };
}

/** Approve one prepared call and nothing that is later rewritten or replayed. */
export function approveBrowserStewardRuntimeParams(params: unknown): boolean {
  const state = readApprovalState(params);
  if (!state) {
    return false;
  }
  expireIfNeeded(state);
  if (state.status !== "pending" || !matchesPublicParams(params, state)) {
    return false;
  }
  state.status = "approved";
  return true;
}

export function denyBrowserStewardRuntimeParams(params: unknown): void {
  const state = readApprovalState(params);
  if (state && state.status === "pending") {
    state.status = "denied";
  }
}

export function isBrowserStewardRuntimeApproved(params: unknown): boolean {
  const state = readApprovalState(params);
  if (!state) {
    return false;
  }
  expireIfNeeded(state);
  return state.status === "approved" && matchesPublicParams(params, state);
}

export function getBrowserStewardRuntimeApprovalBinding(
  params: unknown,
): BrowserStewardRuntimeApprovalBinding | undefined {
  return isBrowserStewardRuntimeApproved(params)
    ? publicBinding(readApprovalState(params)!)
    : undefined;
}

export function matchesBrowserStewardRuntimeApprovalBinding(
  params: unknown,
  binding: BrowserStewardRuntimeApprovalBinding,
): boolean {
  const approvedBinding = getBrowserStewardRuntimeApprovalBinding(params);
  return approvedBinding !== undefined && isDeepStrictEqual(approvedBinding, binding);
}

/** Restore the private snapshot exactly once at the execution boundary. */
export function finalizeBrowserStewardRuntimeParams(
  params: unknown,
  preparedParams: unknown,
): unknown {
  const state = readApprovalState(preparedParams);
  if (!state) {
    return params;
  }
  expireIfNeeded(state);
  if (
    state.status !== "approved" ||
    !matchesPublicParams(params, state) ||
    !matchesPublicParams(preparedParams, state)
  ) {
    throw new Error("Browser Steward approval expired or did not match this call");
  }
  state.status = "consumed";
  const rawParams = cloneRecord(state.rawParams);
  if (!rawParams) {
    throw new Error("Browser Steward approved parameters could not be restored safely");
  }
  return rawParams;
}

/** Compatibility helper for direct Browser tool tests; the generic wrapper consumes markers. */
export function resolveBrowserStewardRuntimeApprovedParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const state = readApprovalState(params);
  if (!state || !isBrowserStewardRuntimeApproved(params)) {
    return params;
  }
  const rawParams = cloneRecord(state.rawParams);
  return rawParams ?? params;
}
