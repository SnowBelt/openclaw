/**
 * Browser-owned policy facts for model-mediated browser calls.
 *
 * This module deliberately returns metadata only. Browser input and output
 * can contain credentials, cookies, page content, and opaque user data, so the
 * policy never echoes those values into decisions or diagnostics.
 */

export type BrowserStewardSessionBoundaryKind =
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

export type BrowserStewardCredentialExposureKind =
  | "none"
  | "credential_like"
  | "credential_material";

export type BrowserStewardCredentialExposureReasonCode =
  | "no_credential_material"
  | "credential_like_label"
  | "credential_material_detected";

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

export type BrowserStewardRuntimeRequest = {
  action: string;
  profile?: string;
  agentSessionKey?: string;
  agentId?: string;
  approved?: boolean;
  delegated?: boolean;
  request?: unknown;
};

const BROWSER_STEWARD_AGENT_ID = "browser-session-credential-steward";
const NON_SECRET_READ_ACTIONS = new Set(["status", "profiles", "doctor"]);
const CREDENTIAL_CLASS_ORDER = Object.freeze([
  "api key",
  "password",
  "token",
  "cookie",
  "private key",
  "secret",
]);
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
  download: ["browser session", "local file"],
  upload: ["browser session", "local file"],
  dialog: ["browser session"],
  act: ["browser session", "profile mutation"],
  tabs: ["browser session", "tab metadata"],
  waitfordownload: ["browser session", "local file"],
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
const CREDENTIAL_LIKE_UPLOAD_PATH_RE =
  /(?:api[-_ ]?key|auth(?:entication)?|cookie|credential|id_rsa|password|private[-_ ]?key|secret|token|\.env(?:\.|$))/iu;
const VALID_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/iu;
const VALID_PROFILE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/iu;

function unknownSessionBoundary(): BrowserStewardSessionBoundary {
  return {
    kind: "unknown",
    ownerAgentId: "UNKNOWN",
    affectedSession: "UNKNOWN",
  };
}

/** Resolve session ownership without exposing the opaque session tail. */
export function resolveBrowserStewardSessionBoundary(
  sessionKey: string | undefined,
): BrowserStewardSessionBoundary {
  const normalized = sessionKey?.trim().toLowerCase();
  if (!normalized) {
    return unknownSessionBoundary();
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
  const hasEmptyTail = parts.slice(2).some((part) => part.trim().length === 0);
  if (!ownerAgentId || !VALID_AGENT_ID_RE.test(ownerAgentId) || hasEmptyTail) {
    return unknownSessionBoundary();
  }
  const kind = ownerAgentId === BROWSER_STEWARD_AGENT_ID ? "browser_steward" : "other_agent";
  return {
    kind,
    ownerAgentId,
    affectedSession: `agent:${ownerAgentId}:REDACTED`,
  };
}

export function isBrowserStewardSession(sessionKey: string | undefined): boolean {
  return resolveBrowserStewardSessionBoundary(sessionKey).kind === "browser_steward";
}

/** Kept for compatibility with existing Browser Steward callers. */
export function isBrowserStewardAgentId(agentId: string | undefined): boolean {
  return agentId?.trim().toLowerCase() === BROWSER_STEWARD_AGENT_ID;
}

/** The runtime policy is installed for every model-mediated Browser call. */
export function shouldApplyBrowserStewardRuntimeGuard(_params: {
  sessionKey?: string;
  agentId?: string;
}): boolean {
  return true;
}

function normalizeAction(value: string): string {
  return value.trim().toLowerCase();
}

function safeRequestedAction(action: string): string {
  return NON_SECRET_READ_ACTIONS.has(action) || ACTION_CREDENTIAL_CLASSES[action]
    ? action
    : "unknown";
}

function classifyCredentialLabel(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/gu, " ");
  if (!normalized) {
    return undefined;
  }
  if (/api key/iu.test(normalized)) {
    return "api key";
  }
  if (/password|passphrase|passwd/iu.test(normalized)) {
    return "password";
  }
  if (/authorization|bearer|access token|refresh token|\btoken\b/iu.test(normalized)) {
    return "token";
  }
  if (/cookie/iu.test(normalized)) {
    return "cookie";
  }
  if (/private key|wallet/iu.test(normalized)) {
    return "private key";
  }
  if (/secret|credential/iu.test(normalized)) {
    return "secret";
  }
  return undefined;
}

function classifySignedUrl(value: string): string | undefined {
  const candidates = value.match(/\bhttps?:\/\/[^\s"'<>]+/giu) ?? [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.replace(/[),.;]+$/gu, ""));
      if (url.username || url.password) {
        return "password";
      }
      for (const [key, queryValue] of url.searchParams) {
        if (!queryValue.trim()) {
          continue;
        }
        if (SIGNED_URL_QUERY_KEYS.has(key.toLowerCase())) {
          return "token";
        }
        const label = classifyCredentialLabel(key);
        if (label) {
          return label;
        }
      }
    } catch {
      // Ignore non-URL strings and continue scanning.
    }
  }
  return undefined;
}

function classifyCredentialMaterial(value: string): string | undefined {
  const signedUrlClass = classifySignedUrl(value);
  if (signedUrlClass) {
    return signedUrlClass;
  }
  if (/\b[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/iu.test(value)) {
    return "password";
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value)) {
    return "private key";
  }
  if (/\bbearer\s+[a-z0-9._~+/=-]{4,}/iu.test(value)) {
    return "token";
  }
  if (
    /\b(?:authorization|access[-_ ]?token|refresh[-_ ]?token|token)\s*[:=]\s*["']?[^\s"']{4,}/iu.test(
      value,
    )
  ) {
    return "token";
  }
  if (/\bpassword\s*[:=]\s*["']?[^\s"']{4,}/iu.test(value)) {
    return "password";
  }
  if (/\bcookie\s*[:=]\s*["']?[^\s"']{4,}/iu.test(value)) {
    return "cookie";
  }
  if (/\bapi[-_ ]?key\s*[:=]\s*["']?[^\s"']{4,}/iu.test(value)) {
    return "api key";
  }
  if (/\bsecret\s*[:=]\s*["']?[^\s"']{4,}/iu.test(value)) {
    return "secret";
  }
  if (/\b(?:sk|pk)-[a-z0-9][a-z0-9._-]{8,}/iu.test(value)) {
    return "api key";
  }
  if (/\b(?:xox[baprs]-|gh[pousr]_|glpat-)[a-z0-9_-]{8,}/iu.test(value)) {
    return "token";
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasConcreteValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  return Array.isArray(value) ? value.length > 0 : isRecord(value) && Object.keys(value).length > 0;
}

function isCredentialInputField(record: Record<string, unknown>, key: string): boolean {
  const kind = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
  return (
    (kind === "type" && key === "text") ||
    (kind === "select" && key === "values") ||
    ((kind === "dialog" || kind === "wait") && key === "promptText") ||
    ((kind === "evaluate" || kind === "wait") && key === "fn")
  );
}

function credentialClassesFromLabels(record: Record<string, unknown>): string[] {
  const classes = new Set<string>();
  const labels = Array.isArray(record.labels) ? record.labels : [];
  for (const label of labels) {
    if (typeof label === "string") {
      const classified = classifyCredentialLabel(label);
      if (classified) {
        classes.add(classified);
      }
    }
  }
  for (const key of Object.keys(record)) {
    const classified = classifyCredentialLabel(key);
    if (classified) {
      classes.add(classified);
    }
  }
  if (typeof record.type === "string") {
    const classified = classifyCredentialLabel(record.type);
    if (classified) {
      classes.add(classified);
    }
  }
  return [...classes];
}

function isBrowserStewardPrivateRoutingKey(key: string): boolean {
  const normalized = key.replace(/[-_]/gu, "").toLowerCase();
  return (
    normalized === "node" ||
    normalized === "nodeid" ||
    normalized === "sessionkey" ||
    normalized === "agentsessionkey" ||
    normalized === "sessionid"
  );
}

type BrowserStewardCredentialExposure = {
  exposureKind: BrowserStewardCredentialExposureKind;
  reasonCode: BrowserStewardCredentialExposureReasonCode;
  classes: string[];
  blocked: boolean;
};

function evaluateBrowserCredentialExposure(value: unknown): BrowserStewardCredentialExposure {
  const classes = new Set<string>();
  let credentialLike = false;
  let material = false;
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const entry = pending.pop();
    if (typeof entry === "string") {
      const classified = classifyCredentialMaterial(entry);
      if (classified) {
        classes.add(classified);
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
    const record = entry as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
    if (kind === "upload" && Array.isArray(record.paths)) {
      const uploadHasCredentialName = record.paths.some(
        (path): path is string =>
          typeof path === "string" && isBrowserStewardCredentialLikeUploadPath(path),
      );
      if (uploadHasCredentialName) {
        classes.add("secret");
        credentialLike = true;
        material = true;
      }
    }
    if ((kind === "evaluate" || kind === "wait") && typeof record.fn === "string") {
      classes.add("secret");
      credentialLike = true;
      if (record.fn.trim()) {
        material = true;
      }
    }
    if (kind === "type" && hasConcreteValue(record.text)) {
      classes.add("secret");
      credentialLike = true;
      material = true;
    }
    if (kind === "select" && hasConcreteValue(record.values)) {
      classes.add("secret");
      credentialLike = true;
      material = true;
    }
    if (kind === "fill" && Array.isArray(record.fields) && record.fields.length > 0) {
      classes.add("secret");
      credentialLike = true;
      material = true;
    }
    for (const classified of credentialClassesFromLabels(record)) {
      classes.add(classified);
      credentialLike = true;
      const valueCandidate = record.value ?? record.text ?? record.token ?? record.secret;
      if (hasConcreteValue(valueCandidate)) {
        material = true;
      }
    }
    for (const [key, nested] of Object.entries(record)) {
      if (isCredentialInputField(record, key)) {
        classes.add("secret");
        credentialLike = true;
        if (hasConcreteValue(nested)) {
          material = true;
        }
      }
      const classified = classifyCredentialLabel(key);
      if (classified) {
        classes.add(classified);
        credentialLike = true;
        if (hasConcreteValue(nested)) {
          material = true;
        }
      }
      pending.push(nested);
    }
  }
  const orderedClasses = CREDENTIAL_CLASS_ORDER.filter((entry) => classes.has(entry));
  if (material) {
    return {
      exposureKind: "credential_material",
      reasonCode: "credential_material_detected",
      classes: orderedClasses,
      blocked: true,
    };
  }
  if (credentialLike) {
    return {
      exposureKind: "credential_like",
      reasonCode: "credential_like_label",
      classes: orderedClasses,
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

function redactedProfile(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "UNKNOWN";
  }
  return VALID_PROFILE_RE.test(trimmed) && !classifyCredentialMaterial(trimmed)
    ? trimmed
    : "REDACTED";
}

function normalizeUrlForDiagnostics(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "REDACTED";
  } catch {
    return undefined;
  }
}

/** Identifies upload filenames that can carry or disclose credentials. */
export function isBrowserStewardCredentialLikeUploadPath(value: string): boolean {
  return CREDENTIAL_LIKE_UPLOAD_PATH_RE.test(value);
}

/** Return a structure-preserving copy with credential-bearing values removed. */
export function redactBrowserStewardCredentialMaterial(value: unknown): unknown {
  const seen = new WeakMap<object, unknown>();
  const redact = (candidate: unknown): unknown => {
    if (typeof candidate === "string") {
      const safeUrl = normalizeUrlForDiagnostics(candidate);
      if (safeUrl) {
        return safeUrl;
      }
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
    const record = candidate as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    seen.set(candidate, result);
    const kind = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
    for (const [key, nested] of Object.entries(record)) {
      const labelClass = classifyCredentialLabel(key);
      const uploadPaths = kind === "upload" && key === "paths";
      const profileLabel =
        key === "profile" && typeof nested === "string" && classifyCredentialLabel(nested);
      const privateRoutingKey = isBrowserStewardPrivateRoutingKey(key);
      const interactionSecret =
        isCredentialInputField(record, key) ||
        (kind === "fill" && key === "fields") ||
        (key === "value" && credentialClassesFromLabels(record).length > 0);
      if (uploadPaths) {
        result[key] = Array.isArray(nested) ? nested.map(() => "REDACTED") : "REDACTED";
      } else if (privateRoutingKey || labelClass || profileLabel || interactionSecret) {
        result[key] =
          kind === "select" && key === "values" && Array.isArray(nested)
            ? nested.map(() => "REDACTED")
            : "REDACTED";
      } else {
        result[key] = redact(nested);
      }
    }
    return result;
  };
  return redact(value);
}

/** Page output is opaque and therefore metadata-only in diagnostic capture. */
export function redactBrowserStewardDiagnosticResult(_value: unknown): unknown {
  return { redacted: true };
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

export function evaluateBrowserStewardRuntimeGuard(
  request: BrowserStewardRuntimeRequest,
): BrowserStewardRuntimeDecision {
  const action = normalizeAction(request.action);
  const requestedAction = safeRequestedAction(action);
  const sessionBoundary = resolveBrowserStewardSessionBoundary(request.agentSessionKey);
  const credentialExposure = evaluateBrowserCredentialExposure(request.request ?? request);
  const credentialClasses = uniqueValues([
    ...(ACTION_CREDENTIAL_CLASSES[action] ?? ["browser session"]),
    ...credentialExposure.classes,
  ]);
  const readOnlyAllowed = NON_SECRET_READ_ACTIONS.has(action) && !credentialExposure.blocked;
  const approved = request.approved === true || request.delegated === true;
  const allow = readOnlyAllowed || approved;
  return {
    boundaryDecision: allow ? "allow" : "approval_required",
    requestedAction,
    affectedBrowserProfile: redactedProfile(request.profile),
    affectedSession: sessionBoundary.affectedSession,
    sessionBoundary,
    credentialExposureKind: credentialExposure.exposureKind,
    credentialExposureReasonCode: credentialExposure.reasonCode,
    credentialClassesInvolved: credentialClasses,
    dataSensitivity: readOnlyAllowed ? "low" : credentialExposure.blocked ? "critical" : "high",
    approvalRequired: !allow,
    safeNextAction: allow
      ? "proceed with redacted Browser Steward runtime guard metadata"
      : credentialExposure.blocked
        ? "request explicit approval for credential-bearing Browser input"
        : "request explicit approval before Browser mutation",
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
      `Browser Steward runtime guard blocked ${decision.requestedAction}: approval_required; telemetry=${decision.telemetryEvent}`,
    );
  }
  return decision;
}
