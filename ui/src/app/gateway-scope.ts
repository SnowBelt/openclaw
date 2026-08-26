// Control UI module normalizes gateway URLs used to scope browser auth state.
import { normalizeOptionalString } from "../lib/string-coerce.ts";

function normalizeGatewayScope(gatewayUrl: string, includeSearch: boolean): string {
  const trimmed = normalizeOptionalString(gatewayUrl) ?? "";
  if (!trimmed) {
    return "default";
  }
  try {
    const base =
      typeof location !== "undefined"
        ? `${location.protocol}//${location.host}${location.pathname || "/"}`
        : undefined;
    const parsed = base ? new URL(trimmed, base) : new URL(trimmed);
    const pathname =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "") || parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${pathname}${includeSearch ? parsed.search : ""}`;
  } catch {
    return trimmed;
  }
}

export function normalizeGatewayTokenScope(gatewayUrl: string): string {
  return normalizeGatewayScope(gatewayUrl, false);
}

export function normalizeGatewayCredentialScope(gatewayUrl: string): string {
  return normalizeGatewayScope(gatewayUrl, true);
}

function stableFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x01000193);
  }
  return `credential-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function credentialFingerprint(credential: string | null | undefined): string {
  const normalized = credential?.trim();
  return normalized ? stableFingerprint(normalized) : "anonymous";
}

/**
 * Scopes draft and queue storage to both the endpoint and authenticated principal.
 * The credential is represented only by a non-secret fingerprint so a same-URL
 * credential switch cannot restore or execute another principal's pending work.
 */
export function normalizeGatewayComposerScope(
  gatewayUrl: string | null | undefined,
  credential?: string | null,
): string {
  const gatewayScope = normalizeGatewayCredentialScope(gatewayUrl ?? "");
  return `${stableFingerprint(gatewayScope)}\u0000${credentialFingerprint(credential)}`;
}
