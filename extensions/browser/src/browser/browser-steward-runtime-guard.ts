import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";
import { evaluateCredentialStewardExposure } from "./credential-steward-policy.js";
import { normalizeBrowserRequestPath } from "./request-policy.js";

export type BrowserStewardRuntimeDecision = {
  boundaryDecision: "allow" | "approval_required";
  requestedAction: string;
  affectedBrowserProfile: string;
  affectedSession: string;
  sessionBoundary: BrowserStewardSessionBoundary;
  credentialExposureKind: BrowserStewardCredentialExposureKind;
  credentialExposureReasonCode: BrowserStewardCredentialExposureReasonCode;
  credentialClassesInvolved: string[];
  dataSensitivity: "low" | "medium" | "high" | "critical";
  approvalRequired: boolean;
  safeNextAction: string;
  telemetryEvent: string;
};

type BrowserStewardRuntimeRequest = {
  action: string;
  profile?: string;
  agentSessionKey?: string;
  agentId?: string;
  approved?: boolean;
  delegated?: boolean;
  request?: unknown;
};

export const BROWSER_STEWARD_AGENT_ID = "browser-session-credential-steward";

type BrowserStewardSessionBoundaryKind =
  | "browser_steward"
  | "other_agent"
  | "global"
  | "unscoped"
  | "unknown";

export type BrowserStewardSessionBoundary = {
  kind: BrowserStewardSessionBoundaryKind;
  ownerAgentId: string;
  affectedSession: string;
};

type BrowserStewardCredentialExposureKind = "none" | "credential_like" | "credential_material";

type BrowserStewardCredentialExposureReasonCode =
  | "no_credential_material"
  | "credential_like_label"
  | "credential_material_detected";

type BrowserStewardCredentialExposure = {
  exposureKind: BrowserStewardCredentialExposureKind;
  reasonCode: BrowserStewardCredentialExposureReasonCode;
  classes: string[];
  blocked: boolean;
};

const SIGNED_URL_QUERY_KEYS = new Set([
  "sig",
  "signature",
  "se",
  "sp",
  "sr",
  "st",
  "sv",
  "skoid",
  "sktid",
  "skt",
  "ske",
  "sks",
  "skv",
  "x-amz-algorithm",
  "x-amz-credential",
  "x-amz-date",
  "x-amz-expires",
  "x-amz-security-token",
  "x-amz-signature",
  "x-goog-algorithm",
  "x-goog-credential",
  "x-goog-date",
  "x-goog-expires",
  "x-goog-signature",
]);
// OAuth callback codes and tokens are bearer-like credentials even before exchange.
const OAUTH_CREDENTIAL_QUERY_KEYS = new Set([
  "access_token",
  "auth_code",
  "authorization_code",
  "code_verifier",
  "id_token",
  "oauth_token",
  "oauth_verifier",
  "refresh_token",
]);
const OAUTH_CONTEXT_QUERY_KEYS = new Set([
  "client_id",
  "code_challenge",
  "code_challenge_method",
  "iss",
  "nonce",
  "redirect_uri",
  "response_type",
  "scope",
  "session_state",
  "state",
]);
const OAUTH_CALLBACK_PATH_RE =
  /(?:^|[\\/._-])(?:auth|authorize|authorization|callback|oidc|oauth2?|signin-oidc|sso)(?:[\\/._-]|$)/iu;

function hasOAuthContext(parsed: URL, parameterSets: URLSearchParams[]): boolean {
  return (
    OAUTH_CALLBACK_PATH_RE.test(parsed.pathname) ||
    parameterSets.some((params) =>
      [...params.keys()].some((key) => OAUTH_CONTEXT_QUERY_KEYS.has(key.toLowerCase())),
    )
  );
}

const NON_SECRET_READ_ACTIONS = new Set(["status", "profiles", "doctor"]);
const CREDENTIAL_CLASS_ORDER = Object.freeze([
  "api key",
  "password",
  "token",
  "cookie",
  "private key",
  "secret",
]);
const CREDENTIAL_LIKE_UPLOAD_PATH_RE =
  /(?:api[-_ ]?key|auth(?:entication)?|cookie|credential|id_rsa|password|private[-_ ]?key|secret|token|\.env(?:\.|$))/iu;

const ACTION_CREDENTIAL_CLASSES: Record<string, string[]> = {
  start: ["browser profile"],
  stop: ["browser profile"],
  open: ["browser session"],
  focus: ["browser session"],
  close: ["browser session"],
  snapshot: ["browser session", "page content"],
  screenshot: ["browser session", "page image"],
  navigate: ["browser session"],
  console: ["browser session", "page content"],
  pdf: ["authenticated export"],
  upload: ["browser session", "local file"],
  dialog: ["browser session"],
  act: ["browser session", "profile mutation"],
  tabs: ["browser session", "tab metadata"],
};

const UNKNOWN_SESSION_BOUNDARY: BrowserStewardSessionBoundary = {
  kind: "unknown",
  ownerAgentId: "UNKNOWN",
  affectedSession: "UNKNOWN",
};
const UNKNOWN_AGENT_SESSION_BOUNDARY = "agent:UNKNOWN:REDACTED";

const VALID_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function resolveBrowserStewardSessionBoundary(
  sessionKey: string | undefined,
): BrowserStewardSessionBoundary {
  const normalized = sessionKey?.trim().toLowerCase();
  if (!normalized) {
    return UNKNOWN_SESSION_BOUNDARY;
  }
  if (normalized === "global") {
    return {
      kind: "global",
      ownerAgentId: "UNKNOWN",
      affectedSession: "GLOBAL",
    };
  }
  const parts = normalized.split(":");
  if (parts[0] !== "agent") {
    return {
      kind: "unscoped",
      ownerAgentId: "UNKNOWN",
      affectedSession: "UNSCOPED",
    };
  }
  const ownerAgentId = parts[1]?.trim();
  const hasMalformedEmptyTail =
    parts.length > 2 && !parts.slice(2).some((part) => part.trim().length > 0);
  if (!ownerAgentId || !VALID_AGENT_ID_RE.test(ownerAgentId) || hasMalformedEmptyTail) {
    return UNKNOWN_SESSION_BOUNDARY;
  }
  if (ownerAgentId === BROWSER_STEWARD_AGENT_ID) {
    return {
      kind: "browser_steward",
      ownerAgentId,
      affectedSession: `agent:${BROWSER_STEWARD_AGENT_ID}:REDACTED`,
    };
  }
  return {
    kind: "other_agent",
    ownerAgentId: "UNKNOWN",
    affectedSession: UNKNOWN_AGENT_SESSION_BOUNDARY,
  };
}

function isBrowserStewardSession(sessionKey: string | undefined): boolean {
  return resolveBrowserStewardSessionBoundary(sessionKey).kind === "browser_steward";
}

function isBrowserStewardAgentId(agentId: string | undefined): boolean {
  return agentId?.trim().toLowerCase() === BROWSER_STEWARD_AGENT_ID;
}

export function shouldApplyBrowserStewardRuntimeGuard(params: {
  sessionKey?: string;
  agentId?: string;
}): boolean {
  return isBrowserStewardSession(params.sessionKey) || isBrowserStewardAgentId(params.agentId);
}

function normalizeProxyPath(value: string): string {
  return normalizeBrowserRequestPath(value);
}

export function resolveBrowserStewardProxyAction(params: {
  method?: string;
  path?: string;
  body?: unknown;
}): string {
  const method = (params.method ?? "GET").trim().toUpperCase();
  const path = normalizeProxyPath(params.path ?? "");
  if (method === "GET" && path === "/") {
    return "status";
  }
  if (method === "GET" && path === "/profiles") {
    return "profiles";
  }
  if (method === "GET" && path === "/doctor") {
    return "doctor";
  }
  if (method === "GET" && path === "/tabs") {
    return "tabs";
  }
  if (method === "POST" && path === "/start") {
    return "start";
  }
  if (method === "POST" && path === "/stop") {
    return "stop";
  }
  if (method === "POST" && path === "/tabs/open") {
    return "open";
  }
  if (method === "POST" && path === "/tabs/focus") {
    return "focus";
  }
  if (method === "DELETE" && path.startsWith("/tabs/")) {
    return "close";
  }
  if (method === "POST" && path === "/act") {
    const kind = isRecord(params.body) ? params.body.kind : undefined;
    return kind === "close" ? "close" : "act";
  }
  if (method === "POST" && path === "/navigate") {
    return "navigate";
  }
  if (method === "POST" && path === "/snapshot") {
    return "snapshot";
  }
  if (method === "POST" && path === "/screenshot") {
    return "screenshot";
  }
  if (method === "POST" && path === "/pdf") {
    return "pdf";
  }
  if (method === "POST" && path === "/hooks/file-chooser") {
    return "upload";
  }
  if (method === "POST" && path === "/hooks/dialog") {
    return "dialog";
  }
  return "unknown";
}

function normalizeAction(value: string): string {
  return value.trim().toLowerCase();
}

function safeRequestedAction(action: string): string {
  if (NON_SECRET_READ_ACTIONS.has(action) || ACTION_CREDENTIAL_CLASSES[action]) {
    return action;
  }
  return "unknown";
}

function classifyCredentialLabel(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!normalized) {
    return undefined;
  }
  if (/api[-_ ]?key/.test(normalized)) {
    return "api key";
  }
  if (/password|passphrase|passwd/.test(normalized)) {
    return "password";
  }
  if (/authorization|bearer|access[-_ ]?token|refresh[-_ ]?token|\btoken\b/.test(normalized)) {
    return "token";
  }
  if (/cookie|session[-_ ]?cookie/.test(normalized)) {
    return "cookie";
  }
  if (/private[-_ ]?key|wallet/.test(normalized)) {
    return "private key";
  }
  if (/secret|credential/.test(normalized)) {
    return "secret";
  }
  return undefined;
}

function classifySignedUrl(value: string): string | undefined {
  const candidates = value.match(/\bhttps?:\/\/[^\s"'<>]+/gi) ?? [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.replace(/[),.;]+$/g, ""));
      const parameterSets = [
        url.searchParams,
        ...(url.hash ? [new URLSearchParams(url.hash.slice(1))] : []),
      ];
      const oauthContext = hasOAuthContext(url, parameterSets);
      for (const params of parameterSets) {
        for (const [key, queryValue] of params) {
          if (!queryValue.trim()) {
            continue;
          }
          const normalizedKey = key.toLowerCase();
          if (normalizedKey === "client_secret") {
            return "secret";
          }
          if (
            SIGNED_URL_QUERY_KEYS.has(normalizedKey) ||
            OAUTH_CREDENTIAL_QUERY_KEYS.has(normalizedKey) ||
            (normalizedKey === "code" && oauthContext)
          ) {
            return "token";
          }
          const credentialClass = classifyCredentialLabel(key);
          if (credentialClass) {
            return credentialClass;
          }
        }
      }
    } catch {
      // Continue scanning other URL-like values.
    }
  }
  return undefined;
}

function classifyCredentialMaterial(value: string): string | undefined {
  const signedUrlClass = classifySignedUrl(value);
  if (signedUrlClass) {
    return signedUrlClass;
  }
  if (/\b[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(value)) {
    return "password";
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
    return "private key";
  }
  if (/\bbearer\s+[a-z0-9._~+/=-]{4,}/i.test(value)) {
    return "token";
  }
  if (
    /\b(?:authorization|access[-_ ]?token|refresh[-_ ]?token|token)\s*[:=]\s*["']?[^\s"']{4,}/i.test(
      value,
    )
  ) {
    return "token";
  }
  if (/\bpassword\s*[:=]\s*["']?[^\s"']{4,}/i.test(value)) {
    return "password";
  }
  if (/\bcookie\s*[:=]\s*["']?[^\s"']{4,}/i.test(value)) {
    return "cookie";
  }
  if (/\bapi[-_ ]?key\s*[:=]\s*["']?[^\s"']{4,}/i.test(value)) {
    return "api key";
  }
  if (/\bsecret\s*[:=]\s*["']?[^\s"']{4,}/i.test(value)) {
    return "secret";
  }
  if (/\b(?:sk|pk)-[a-z0-9][a-z0-9._-]{8,}/i.test(value)) {
    return "api key";
  }
  if (/\b(?:xox[baprs]-|gh[pousr]_|glpat-)[a-z0-9_-]{8,}/i.test(value)) {
    return "token";
  }
  return undefined;
}

/** Identifies upload filenames that may themselves disclose or carry credentials. */
function isBrowserStewardCredentialLikeUploadPath(value: string): boolean {
  return CREDENTIAL_LIKE_UPLOAD_PATH_RE.test(value);
}

function hasCredentialLabel(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some((entry) => typeof entry === "string" && classifyCredentialLabel(entry) !== undefined)
  );
}

function credentialFieldType(record: Record<string, unknown>): string | undefined {
  return typeof record.type === "string" ? classifyCredentialLabel(record.type) : undefined;
}

function fillFieldsHaveCredentialHint(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some((field) => {
      if (!field || typeof field !== "object" || Array.isArray(field)) {
        return false;
      }
      const record = isRecord(field) ? field : undefined;
      if (!record) {
        return false;
      }
      return (
        credentialFieldType(record) !== undefined ||
        hasCredentialLabel(record.labels) ||
        Object.keys(record).some((key) => classifyCredentialLabel(key) !== undefined)
      );
    })
  );
}

function isSensitiveBrowserInputField(record: Record<string, unknown>, key: string): boolean {
  const kind = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
  // Typed, selected, and dialog-prompt values can be opaque secrets even when
  // neither the value nor its key has a recognizable credential pattern.
  return (
    (kind === "type" && key === "text") ||
    (kind === "select" && key === "values") ||
    key === "promptText"
  );
}

function redactBrowserFillFields(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return "REDACTED";
  }
  const seen = new WeakMap<object, unknown>();
  const redactFieldPart = (candidate: unknown): unknown => {
    if (typeof candidate === "string") {
      return classifyCredentialMaterial(candidate) ? "REDACTED" : candidate;
    }
    if (!candidate || typeof candidate !== "object") {
      return candidate;
    }
    const cached = seen.get(candidate);
    if (cached !== undefined) {
      return cached;
    }
    if (Array.isArray(candidate)) {
      const result: unknown[] = [];
      seen.set(candidate, result);
      for (const entry of candidate) {
        result.push(redactFieldPart(entry));
      }
      return result;
    }
    const result: Record<string, unknown> = {};
    seen.set(candidate, result);
    for (const [key, entry] of Object.entries(candidate)) {
      result[key] = key === "value" ? "REDACTED" : redactFieldPart(entry);
    }
    return result;
  };
  return redactFieldPart(value);
}

/**
 * Preserve non-secret Browser request structure for downstream policy hooks
 * while replacing credential fields and credential-bearing strings.
 */
export function redactBrowserStewardCredentialMaterial(value: unknown): unknown {
  const seen = new WeakMap<object, unknown>();
  const redact = (candidate: unknown): unknown => {
    if (typeof candidate === "string") {
      return classifyCredentialMaterial(candidate) ? "REDACTED" : candidate;
    }
    if (!candidate || typeof candidate !== "object") {
      return candidate;
    }
    const cached = seen.get(candidate);
    if (cached !== undefined) {
      return cached;
    }
    if (Array.isArray(candidate)) {
      const result: unknown[] = [];
      seen.set(candidate, result);
      for (const entry of candidate) {
        result.push(redact(entry));
      }
      return result;
    }
    if (!isRecord(candidate)) {
      return candidate;
    }
    const record = candidate;
    const result: Record<string, unknown> = {};
    seen.set(candidate, result);
    const kind = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
    const operationKind =
      kind || (typeof record.action === "string" ? record.action.trim().toLowerCase() : "");
    const labelsCredentialMaterial = hasCredentialLabel(record.labels);
    const typedCredentialMaterial = credentialFieldType(record) !== undefined;
    for (const [key, entry] of Object.entries(record)) {
      if (operationKind === "upload" && key === "paths") {
        result[key] = Array.isArray(entry) ? entry.map(() => "REDACTED") : "REDACTED";
        continue;
      }
      result[key] =
        ((kind === "evaluate" || kind === "wait") && key === "fn") ||
        classifyCredentialLabel(key) ||
        isSensitiveBrowserInputField(record, key) ||
        (key === "value" && (labelsCredentialMaterial || typedCredentialMaterial))
          ? kind === "select" && key === "values" && Array.isArray(entry)
            ? entry.map(() => "REDACTED")
            : "REDACTED"
          : kind === "fill" && key === "fields"
            ? redactBrowserFillFields(entry)
            : redact(entry);
    }
    return result;
  };
  return redact(value);
}

/** Browser output can contain opaque page data, so diagnostic copies are metadata-only. */
function hasConcreteCredentialValue(value: unknown): boolean {
  const pending = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const entry = pending.pop();
    if (typeof entry === "string" && entry.trim().length > 0) {
      return true;
    }
    if (typeof entry === "number" && Number.isFinite(entry)) {
      return true;
    }
    if (!entry || typeof entry !== "object" || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    pending.push(...(Array.isArray(entry) ? entry : Object.values(entry)));
  }
  return false;
}

function evaluateBrowserCredentialExposure(value: unknown): BrowserStewardCredentialExposure {
  const canonical = evaluateCredentialStewardExposure({ value });
  const classes = new Set(canonical.credentialClassesInvolved);
  let credentialLike = canonical.exposureKind === "credential_like";
  let material = canonical.exposureKind === "credential_material";
  const pending = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const entry = pending.pop();
    if (typeof entry === "string") {
      const materialClass = classifyCredentialMaterial(entry);
      if (materialClass) {
        classes.add(materialClass);
        material = true;
      }
      continue;
    }
    if (!entry || typeof entry !== "object" || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    if (Array.isArray(entry)) {
      pending.push(...entry);
      continue;
    }
    if (!isRecord(entry)) {
      continue;
    }
    const record = entry;
    const kind = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
    const operationKind =
      kind || (typeof record.action === "string" ? record.action.trim().toLowerCase() : "");
    if (
      operationKind === "upload" &&
      Array.isArray(record.paths) &&
      record.paths.some(
        (path): path is string =>
          typeof path === "string" && isBrowserStewardCredentialLikeUploadPath(path),
      )
    ) {
      classes.add("secret");
      credentialLike = true;
      material = true;
    }
    if (
      (kind === "evaluate" || kind === "wait") &&
      typeof record.fn === "string" &&
      record.fn.trim()
    ) {
      classes.add("secret");
      credentialLike = true;
      material = true;
    }
    if (
      kind === "fill" &&
      hasConcreteCredentialValue(record.fields) &&
      !fillFieldsHaveCredentialHint(record.fields)
    ) {
      classes.add("secret");
      credentialLike = true;
      material = true;
    }
    if (kind === "select" && hasConcreteCredentialValue(record.values)) {
      classes.add("secret");
      credentialLike = true;
      material = true;
    }
    const labels = Array.isArray(record.labels) ? record.labels : [];
    for (const label of labels) {
      if (typeof label !== "string") {
        continue;
      }
      const labelClass = classifyCredentialLabel(label);
      if (!labelClass) {
        continue;
      }
      classes.add(labelClass);
      credentialLike = true;
      if (hasConcreteCredentialValue(record.value)) {
        material = true;
      }
    }
    const fieldTypeClass = credentialFieldType(record);
    if (fieldTypeClass) {
      classes.add(fieldTypeClass);
      credentialLike = true;
      if (hasConcreteCredentialValue(record.value)) {
        material = true;
      }
    }
    for (const [key, nested] of Object.entries(entry)) {
      if (isSensitiveBrowserInputField(record, key)) {
        classes.add("secret");
        credentialLike = true;
        if (hasConcreteCredentialValue(nested)) {
          material = true;
        }
      }
      const labelClass = classifyCredentialLabel(key);
      if (labelClass) {
        classes.add(labelClass);
        credentialLike = true;
        if (hasConcreteCredentialValue(nested)) {
          material = true;
        }
      }
      pending.push(nested);
    }
  }
  const sortedClasses = CREDENTIAL_CLASS_ORDER.filter((entry) => classes.has(entry));
  if (material) {
    return {
      exposureKind: "credential_material",
      reasonCode: "credential_material_detected",
      classes: sortedClasses,
      blocked: true,
    };
  }
  if (credentialLike) {
    return {
      exposureKind: "credential_like",
      reasonCode: "credential_like_label",
      classes: sortedClasses,
      blocked: false,
    };
  }
  return {
    exposureKind: "none",
    reasonCode: "no_credential_material",
    classes: [],
    blocked: false,
  };
}

function uniqueCredentialClasses(values: string[]): string[] {
  const unique = new Set(values);
  return values.filter((value) => {
    if (!unique.has(value)) {
      return false;
    }
    unique.delete(value);
    return true;
  });
}

function redactedBrowserProfile(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "UNKNOWN";
  }
  return VALID_AGENT_ID_RE.test(trimmed) && !classifyCredentialMaterial(trimmed)
    ? trimmed
    : "REDACTED";
}

function hasBrowserStewardIdentityMismatch(params: {
  sessionBoundary: BrowserStewardSessionBoundary;
  agentId?: string;
}): boolean {
  const agentId = params.agentId?.trim().toLowerCase() || undefined;
  if (params.sessionBoundary.kind === "browser_steward") {
    return agentId !== undefined && agentId !== BROWSER_STEWARD_AGENT_ID;
  }
  return params.sessionBoundary.kind === "other_agent" && agentId === BROWSER_STEWARD_AGENT_ID;
}

export function evaluateBrowserStewardRuntimeGuard(
  request: BrowserStewardRuntimeRequest,
): BrowserStewardRuntimeDecision {
  const action = normalizeAction(request.action);
  const requestedAction = safeRequestedAction(action);
  const profile = redactedBrowserProfile(request.profile);
  const sessionBoundary = resolveBrowserStewardSessionBoundary(request.agentSessionKey);
  const credentialExposure = evaluateBrowserCredentialExposure(request);
  const identityMismatch = hasBrowserStewardIdentityMismatch({
    sessionBoundary,
    agentId: request.agentId,
  });
  const credentialClasses = uniqueCredentialClasses([
    ...(ACTION_CREDENTIAL_CLASSES[action] ?? ["browser session"]),
    ...credentialExposure.classes,
  ]);
  const readOnlyAllowed = NON_SECRET_READ_ACTIONS.has(action) && !credentialExposure.blocked;
  const approved = request.approved === true || request.delegated === true;
  const allow = !identityMismatch && (readOnlyAllowed || approved);
  return {
    boundaryDecision: allow ? "allow" : "approval_required",
    requestedAction,
    affectedBrowserProfile: profile,
    affectedSession: sessionBoundary.affectedSession,
    sessionBoundary,
    credentialExposureKind: credentialExposure.exposureKind,
    credentialExposureReasonCode: credentialExposure.reasonCode,
    credentialClassesInvolved: credentialClasses,
    dataSensitivity: readOnlyAllowed ? "low" : credentialExposure.blocked ? "critical" : "high",
    approvalRequired: identityMismatch || !allow,
    safeNextAction: identityMismatch
      ? "reject the mismatched Browser Steward session and agent identity"
      : allow
        ? "proceed with redacted Browser Steward runtime guard metadata"
        : credentialExposure.blocked
          ? "block credential exposure and hand off to Control Director for explicit approval or delegation"
          : "block and hand off to Control Director for explicit approval or delegation",
    telemetryEvent: allow
      ? "browser_steward.boundary_decision"
      : credentialExposure.blocked
        ? "browser_steward.blocked_credential_exposure"
        : "browser_steward.approval_gate",
  };
}

export function assertBrowserStewardRuntimeAllowed(
  request: BrowserStewardRuntimeRequest,
): BrowserStewardRuntimeDecision {
  const decision = evaluateBrowserStewardRuntimeGuard(request);
  if (decision.approvalRequired) {
    throw new Error(
      `Browser Steward runtime guard blocked ${decision.requestedAction}: approval_required; telemetry=${decision.telemetryEvent}; safe_next_action=${decision.safeNextAction}`,
    );
  }
  return decision;
}
