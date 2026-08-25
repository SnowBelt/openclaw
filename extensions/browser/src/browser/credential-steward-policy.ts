import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";

type CredentialStewardExposureKind = "none" | "credential_like" | "credential_material";

type CredentialStewardReasonCode =
  | "no_credential_material"
  | "credential_like_label"
  | "credential_material_detected";

export type CredentialStewardDecision = {
  exposureKind: CredentialStewardExposureKind;
  credentialClassesInvolved: string[];
  dataSensitivity: "low" | "medium" | "critical";
  blocked: boolean;
  reasonCode: CredentialStewardReasonCode;
  redactedSummary: string;
};

type EvaluateCredentialStewardExposureParams = {
  value?: unknown;
  labels?: readonly string[];
};

const CREDENTIAL_CLASS_ORDER = Object.freeze([
  "api key",
  "password",
  "token",
  "cookie",
  "private key",
  "secret",
]);

const NO_CREDENTIAL_DECISION: CredentialStewardDecision = Object.freeze({
  exposureKind: "none",
  credentialClassesInvolved: [],
  dataSensitivity: "low",
  blocked: false,
  reasonCode: "no_credential_material",
  redactedSummary: "no credential material detected",
});

type CredentialScanState = {
  classes: Set<string>;
  credentialLike: boolean;
  material: boolean;
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
const OPAQUE_CREDENTIAL_PATH_RE =
  /(?:^|\/)(?:password[-_]?reset|reset|magic[-_]?login|verify|verification|invite|invitation)\/[^/?#]+(?:\/|$)/iu;

function hasOAuthContext(parsed: URL, parameterSets: URLSearchParams[]): boolean {
  return (
    OAUTH_CALLBACK_PATH_RE.test(parsed.pathname) ||
    parameterSets.some((params) =>
      [...params.keys()].some((key) => OAUTH_CONTEXT_QUERY_KEYS.has(key.toLowerCase())),
    )
  );
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
      if (OPAQUE_CREDENTIAL_PATH_RE.test(url.pathname)) {
        return "token";
      }
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

function isSensitiveInputField(record: Record<string, unknown>, key: string): boolean {
  const kind = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
  return (kind === "type" && key === "text") || key === "promptText";
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
      const typeClass =
        typeof record.type === "string" ? classifyCredentialLabel(record.type) : undefined;
      return (
        typeClass !== undefined ||
        Object.keys(record).some((key) => classifyCredentialLabel(key) !== undefined)
      );
    })
  );
}

function scanCredentialValue(value: unknown, state: CredentialScanState): void {
  const pending = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (typeof candidate === "string") {
      const materialClass = classifyCredentialMaterial(candidate);
      if (materialClass) {
        state.classes.add(materialClass);
        state.material = true;
      }
      continue;
    }
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      pending.push(...candidate);
      continue;
    }
    if (!isRecord(candidate)) {
      continue;
    }
    const record = candidate;
    const kind = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
    if (
      kind === "fill" &&
      hasConcreteCredentialValue(record.fields) &&
      !fillFieldsHaveCredentialHint(record.fields)
    ) {
      state.classes.add("secret");
      state.credentialLike = true;
      state.material = true;
    }
    const fieldTypeClass =
      typeof record.type === "string" ? classifyCredentialLabel(record.type) : undefined;
    if (fieldTypeClass) {
      state.classes.add(fieldTypeClass);
      state.credentialLike = true;
      if (hasConcreteCredentialValue(record.value)) {
        state.material = true;
      }
    }
    for (const [key, entry] of Object.entries(record)) {
      if (isSensitiveInputField(record, key)) {
        state.classes.add("secret");
        state.credentialLike = true;
        if (hasConcreteCredentialValue(entry)) {
          state.material = true;
        }
      }
      const labelClass = classifyCredentialLabel(key);
      if (labelClass) {
        state.classes.add(labelClass);
        state.credentialLike = true;
        if (hasConcreteCredentialValue(entry)) {
          state.material = true;
        }
      }
      pending.push(entry);
    }
  }
}

function sortedCredentialClasses(classes: Set<string>): string[] {
  return CREDENTIAL_CLASS_ORDER.filter((entry) => classes.has(entry));
}

export function evaluateCredentialStewardExposure(
  params: EvaluateCredentialStewardExposureParams,
): CredentialStewardDecision {
  const state: CredentialScanState = {
    classes: new Set(),
    credentialLike: false,
    material: false,
  };
  for (const label of params.labels ?? []) {
    const labelClass = classifyCredentialLabel(label);
    if (labelClass) {
      state.classes.add(labelClass);
      state.credentialLike = true;
      if (hasConcreteCredentialValue(params.value)) {
        state.material = true;
      }
    }
  }
  scanCredentialValue(params.value, state);

  const credentialClassesInvolved = sortedCredentialClasses(state.classes);
  if (state.material) {
    return {
      exposureKind: "credential_material",
      credentialClassesInvolved,
      dataSensitivity: "critical",
      blocked: true,
      reasonCode: "credential_material_detected",
      redactedSummary: "credential material redacted",
    };
  }
  if (state.credentialLike) {
    return {
      exposureKind: "credential_like",
      credentialClassesInvolved,
      dataSensitivity: "medium",
      blocked: false,
      reasonCode: "credential_like_label",
      redactedSummary: "credential label detected without material",
    };
  }
  return NO_CREDENTIAL_DECISION;
}
