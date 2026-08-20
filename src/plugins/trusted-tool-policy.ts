// Resolves trusted tool policy for plugins from runtime config.
import { isDeepStrictEqual } from "node:util";
import { getRuntimeConfig } from "../config/config.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { isPlainObject } from "../utils.js";
import type {
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
  PluginHookToolContext,
  PluginHookToolInputKind,
  PluginHookToolKind,
} from "./hook-types.js";
import { getPluginSessionExtensionStateSync } from "./host-hook-state.js";
import type { PluginJsonValue, PluginTrustedToolPolicyRegistration } from "./host-hooks.js";
import { isPluginRegistryRetired } from "./registry-lifecycle.js";
import type {
  PluginRegistry,
  PluginTrustedToolPolicyRegistryRegistration,
} from "./registry-types.js";
import { getActivePluginRegistry } from "./runtime.js";

type TrustedPolicyRegistration = PluginTrustedToolPolicyRegistryRegistration;
type TrustedPolicyApproval = NonNullable<PluginHookBeforeToolCallResult["requireApproval"]>;

export type TrustedToolPolicyRunResult = PluginHookBeforeToolCallResult & {
  additionalApprovals?: TrustedPolicyApproval[];
};

/** Diagnostic entry for an installed trusted tool policy. */
export type TrustedToolPolicyDiagnosticEntry = {
  id: string;
  pluginId: string;
  pluginName?: string;
};

/** True when the active plugin registry has trusted tool policies. */
export function hasTrustedToolPolicies(registry?: PluginRegistry): boolean {
  return resolveTrustedPolicyRegistrations(registry).length > 0;
}

function unreadableTrustedPolicyRegistration(): TrustedPolicyRegistration {
  return {
    pluginId: "unknown-plugin",
    source: "runtime",
    get policy(): PluginTrustedToolPolicyRegistration {
      throw new Error("trusted policy registration is unreadable");
    },
  };
}

function copyTrustedPolicyRegistrations(
  registry: PluginRegistry | null | undefined,
): TrustedPolicyRegistration[] {
  let policies: unknown;
  try {
    policies = registry?.trustedToolPolicies;
  } catch {
    return [unreadableTrustedPolicyRegistration()];
  }
  if (!policies) {
    return [];
  }

  try {
    if (!Array.isArray(policies)) {
      return [unreadableTrustedPolicyRegistration()];
    }
    return policies.map((policy) => policy);
  } catch {
    return [unreadableTrustedPolicyRegistration()];
  }
}

function readTrustedPolicyPluginId(registration: TrustedPolicyRegistration): string | undefined {
  try {
    const pluginId = registration.pluginId;
    return typeof pluginId === "string" && pluginId.trim() ? pluginId.trim() : undefined;
  } catch {
    return undefined;
  }
}

function trustedPolicyDiagnosticPluginId(registration: TrustedPolicyRegistration): string {
  return readTrustedPolicyPluginId(registration) ?? "unknown-plugin";
}

function readTrustedPolicyPluginName(registration: TrustedPolicyRegistration): string | undefined {
  try {
    const pluginName = registration.pluginName;
    return typeof pluginName === "string" && pluginName.trim() ? pluginName.trim() : undefined;
  } catch {
    return undefined;
  }
}

function readTrustedPolicy(registration: TrustedPolicyRegistration):
  | {
      ok: true;
      policy: PluginTrustedToolPolicyRegistration;
    }
  | {
      ok: false;
    } {
  try {
    const policy = registration.policy;
    return policy && typeof policy.evaluate === "function" ? { ok: true, policy } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function readTrustedPolicyId(registration: TrustedPolicyRegistration): string {
  const fallback = trustedPolicyDiagnosticPluginId(registration);
  const policy = readTrustedPolicy(registration);
  if (!policy.ok) {
    return fallback;
  }
  try {
    const id = policy.policy.id;
    return typeof id === "string" && id.trim() ? id.trim() : fallback;
  } catch {
    return fallback;
  }
}

function trustedPolicyRegistrationKey(registration: TrustedPolicyRegistration): string | undefined {
  const pluginId = readTrustedPolicyPluginId(registration);
  const policy = readTrustedPolicy(registration);
  if (!pluginId || !policy.ok) {
    return undefined;
  }
  try {
    const policyId = policy.policy.id;
    return typeof policyId === "string" && policyId.trim()
      ? `${pluginId}\0${policyId.trim()}`
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveTrustedPolicyRegistrations(
  requestRegistry?: PluginRegistry,
): TrustedPolicyRegistration[] {
  const activeRegistry = getActivePluginRegistry();
  const requestRegistryIsRetired =
    requestRegistry &&
    requestRegistry !== activeRegistry &&
    isPluginRegistryRetired(requestRegistry);
  const registries =
    requestRegistry && requestRegistry !== activeRegistry
      ? requestRegistryIsRetired
        ? [activeRegistry, requestRegistry]
        : [requestRegistry]
      : [activeRegistry];
  const resolved: TrustedPolicyRegistration[] = [];
  const seen = new Set<string>();
  for (const registry of registries) {
    for (const registration of copyTrustedPolicyRegistrations(registry)) {
      const key = trustedPolicyRegistrationKey(registration);
      if (key && seen.has(key)) {
        continue;
      }
      if (key) {
        seen.add(key);
      }
      resolved.push(registration);
    }
  }
  return resolved;
}

function trustedPolicyDefaultBlockReason(registration: TrustedPolicyRegistration): string {
  return `blocked by ${readTrustedPolicyId(registration)}`;
}

function trustedPolicyFailureResult(
  registration: TrustedPolicyRegistration,
  detail: string,
): TrustedToolPolicyRunResult {
  return {
    block: true,
    blockReason: `${trustedPolicyDefaultBlockReason(registration)}: ${detail}`,
  };
}

/** Lists trusted tool policies for status and diagnostics. */
export function getTrustedToolPolicyDiagnosticEntries(): TrustedToolPolicyDiagnosticEntry[] {
  return copyTrustedPolicyRegistrations(getActivePluginRegistry()).map((registration) => {
    const entry: TrustedToolPolicyDiagnosticEntry = {
      id: readTrustedPolicyId(registration),
      pluginId: trustedPolicyDiagnosticPluginId(registration),
    };
    const pluginName = readTrustedPolicyPluginName(registration);
    if (pluginName) {
      entry.pluginName = pluginName;
    }
    return entry;
  });
}

function normalizeDerivedEventFields(
  value: Pick<PluginHookBeforeToolCallEvent, "derivedPaths"> | undefined,
): Pick<PluginHookBeforeToolCallEvent, "derivedPaths"> {
  return Array.isArray(value?.derivedPaths)
    ? { derivedPaths: Object.freeze([...value.derivedPaths]) }
    : {};
}

function normalizeToolIdentity(
  value:
    | Pick<PluginHookBeforeToolCallEvent, "toolKind" | "toolInputKind">
    | Pick<PluginHookToolContext, "toolKind" | "toolInputKind">
    | undefined,
): { toolKind?: PluginHookToolKind; toolInputKind?: PluginHookToolInputKind } {
  return {
    ...(value?.toolKind && { toolKind: value.toolKind }),
    ...(value?.toolInputKind && { toolInputKind: value.toolInputKind }),
  };
}

function copyTrustedPolicyPrivateMetadata(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): boolean {
  try {
    for (const key of Reflect.ownKeys(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor || (typeof key !== "symbol" && descriptor.enumerable)) {
        continue;
      }
      if (Object.hasOwn(target, key)) {
        continue;
      }
      Object.defineProperty(target, key, descriptor);
    }
    return true;
  } catch {
    return false;
  }
}

function cloneTrustedPolicyParams(params: Record<string, unknown>): Record<string, unknown> | null {
  const publicParams = Object.fromEntries(Object.entries(params));
  try {
    const cloned = structuredClone(publicParams) as Record<string, unknown>;
    return copyTrustedPolicyPrivateMetadata(params, cloned) ? cloned : null;
  } catch {
    return null;
  }
}

/** Runs trusted tool policies before a tool call and returns the first terminal decision. */
export async function runTrustedToolPolicies(
  event: PluginHookBeforeToolCallEvent,
  ctx: PluginHookToolContext,
  options?: {
    config?: OpenClawConfig;
    registry?: PluginRegistry;
    deriveEvent?: (
      params: Record<string, unknown>,
    ) => Pick<PluginHookBeforeToolCallEvent, "derivedPaths">;
    normalizeEvent?: (
      event: PluginHookBeforeToolCallEvent,
      ctx: PluginHookToolContext,
    ) =>
      | {
          params?: Record<string, unknown>;
          event?: Pick<PluginHookBeforeToolCallEvent, "toolKind" | "toolInputKind">;
          ctx?: Pick<PluginHookToolContext, "toolKind" | "toolInputKind">;
        }
      | undefined;
  },
): Promise<TrustedToolPolicyRunResult | undefined> {
  const policies = resolveTrustedPolicyRegistrations(options?.registry);
  let adjustedParams = event.params;
  let hasAdjustedParams = false;
  const approvals: TrustedPolicyApproval[] = [];
  const sessionExtensionStateCache = new Map<string, Record<string, PluginJsonValue> | undefined>();
  let resolvedSessionConfig: OpenClawConfig | undefined = options?.config;
  let didResolveSessionConfig = Boolean(options?.config);
  const resolveSessionConfig = (): OpenClawConfig | undefined => {
    if (!didResolveSessionConfig) {
      didResolveSessionConfig = true;
      try {
        resolvedSessionConfig = getRuntimeConfig();
      } catch {
        resolvedSessionConfig = undefined;
      }
    }
    return resolvedSessionConfig;
  };
  const { derivedPaths, toolKind, toolInputKind, ...eventWithoutDerivedPaths } = event;
  const { toolKind: ctxToolKind, toolInputKind: ctxToolInputKind, ...ctxWithoutToolIdentity } = ctx;
  let currentDerivedEvent = normalizeDerivedEventFields({ derivedPaths });
  let currentEventToolIdentity = normalizeToolIdentity({ toolKind, toolInputKind });
  let currentContextToolIdentity = normalizeToolIdentity({
    toolKind: ctxToolKind,
    toolInputKind: ctxToolInputKind,
  });
  const buildEvent = (params: Record<string, unknown>): PluginHookBeforeToolCallEvent => {
    return {
      ...eventWithoutDerivedPaths,
      params,
      ...currentEventToolIdentity,
      ...currentDerivedEvent,
    };
  };
  for (const registration of policies) {
    const pluginId = readTrustedPolicyPluginId(registration);
    if (!pluginId) {
      return trustedPolicyFailureResult(registration, "policy owner is unreadable");
    }
    const policyCtx: PluginHookToolContext = {
      ...ctxWithoutToolIdentity,
      ...currentContextToolIdentity,
      // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Plugin callers type JSON reads by namespace.
      getSessionExtension: <T extends PluginJsonValue = PluginJsonValue>(namespace: string) => {
        const normalizedNamespace = namespace.trim();
        const cacheKey = pluginId;
        if (!sessionExtensionStateCache.has(cacheKey)) {
          const config = ctx.sessionKey ? resolveSessionConfig() : undefined;
          sessionExtensionStateCache.set(
            cacheKey,
            config
              ? getPluginSessionExtensionStateSync({
                  cfg: config,
                  pluginId,
                  sessionKey: ctx.sessionKey,
                })
              : undefined,
          );
        }
        const pluginState = sessionExtensionStateCache.get(cacheKey);
        if (!normalizedNamespace || !pluginState) {
          return undefined;
        }
        return pluginState[normalizedNamespace] as T | undefined;
      },
    };
    const policy = readTrustedPolicy(registration);
    if (!policy.ok) {
      return trustedPolicyFailureResult(registration, "policy is unreadable");
    }

    const policyParams = cloneTrustedPolicyParams(adjustedParams);
    if (!policyParams) {
      return trustedPolicyFailureResult(registration, "tool parameters are not cloneable");
    }
    const policyParamsSnapshot = cloneTrustedPolicyParams(policyParams);
    if (!policyParamsSnapshot) {
      return trustedPolicyFailureResult(registration, "tool parameters are not cloneable");
    }
    let decision: Awaited<ReturnType<PluginTrustedToolPolicyRegistration["evaluate"]>>;
    try {
      decision = await policy.policy.evaluate(buildEvent(policyParams), policyCtx);
    } catch {
      return trustedPolicyFailureResult(registration, "policy evaluation failed");
    }
    if (!isDeepStrictEqual(policyParams, policyParamsSnapshot)) {
      return trustedPolicyFailureResult(registration, "policy mutated tool parameters in place");
    }
    if (!decision) {
      continue;
    }
    try {
      // Policies run in order; block decisions are terminal, mutations feed later policies.
      if ("allow" in decision && decision.allow === false) {
        return {
          block: true,
          blockReason: decision.reason ?? trustedPolicyDefaultBlockReason(registration),
        };
      }
      // `block: true` is terminal; normalize a missing blockReason to a deterministic
      // reason so downstream diagnostics match the `{ allow: false }` path above.
      if ("block" in decision && decision.block === true) {
        return {
          ...decision,
          blockReason: decision.blockReason ?? trustedPolicyDefaultBlockReason(registration),
        };
      }
      // `block: false` is a no-op (matches the regular `before_tool_call` hook
      // pipeline) — it does NOT short-circuit the policy chain. Params and
      // approvals are remembered so later trusted policies can still inspect or
      // block the final call.
      if ("params" in decision && isPlainObject(decision.params)) {
        const normalized = options?.normalizeEvent?.(
          {
            ...eventWithoutDerivedPaths,
            params: decision.params,
            ...currentEventToolIdentity,
            ...currentDerivedEvent,
          },
          policyCtx,
        );
        const nextParams = normalized?.params ?? decision.params;
        // An approval authorizes the exact parameter set shown to that policy.
        // A later rewrite would make the earlier approval ambiguous, so fail
        // closed rather than executing a value no operator approved end-to-end.
        if (approvals.length > 0) {
          const nextPublicParams = Object.fromEntries(Object.entries(nextParams));
          const approvedPublicParams = Object.fromEntries(Object.entries(adjustedParams));
          if (!isDeepStrictEqual(nextPublicParams, approvedPublicParams)) {
            return {
              block: true,
              blockReason: `${trustedPolicyDefaultBlockReason(registration)}: parameter rewrite conflicts with an earlier approval`,
            };
          }
          if (!copyTrustedPolicyPrivateMetadata(nextParams, adjustedParams)) {
            return trustedPolicyFailureResult(
              registration,
              "private approval metadata could not be preserved",
            );
          }
        } else {
          adjustedParams = nextParams;
          if (normalized?.event) {
            currentEventToolIdentity = normalizeToolIdentity(normalized.event);
          }
          if (normalized?.ctx) {
            currentContextToolIdentity = normalizeToolIdentity(normalized.ctx);
          } else if (normalized?.event) {
            currentContextToolIdentity = normalizeToolIdentity(normalized.event);
          }
          hasAdjustedParams = true;
          currentDerivedEvent = normalizeDerivedEventFields(options?.deriveEvent?.(adjustedParams));
        }
      }
      if ("requireApproval" in decision && decision.requireApproval) {
        approvals.push(decision.requireApproval);
      }
    } catch {
      return trustedPolicyFailureResult(registration, "policy decision is unreadable");
    }
  }
  const approval = approvals[0];
  if (!hasAdjustedParams && !approval) {
    return undefined;
  }
  return {
    ...(hasAdjustedParams ? { params: adjustedParams } : {}),
    ...(approval ? { requireApproval: approval } : {}),
    ...(approvals.length > 1 ? { additionalApprovals: approvals.slice(1) } : {}),
  };
}
