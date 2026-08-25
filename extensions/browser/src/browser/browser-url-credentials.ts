/** Shared URL credential classification for Browser Steward redaction paths. */

const BROWSER_SIGNED_URL_QUERY_KEYS = new Set([
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

export const BROWSER_OAUTH_CREDENTIAL_QUERY_KEYS = new Set([
  "access_token",
  "auth_code",
  "authorization_code",
  "code_verifier",
  "id_token",
  "oauth_token",
  "oauth_verifier",
  "refresh_token",
]);

const BROWSER_OAUTH_CONTEXT_QUERY_KEYS = new Set([
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

export const BROWSER_OAUTH_CALLBACK_PATH_RE =
  /(?:^|[\\/._-])(?:auth|authorize|authorization|callback|oidc|oauth2?|signin-oidc|sso)(?:[\\/._-]|$)/iu;
export const BROWSER_OPAQUE_CREDENTIAL_PATH_RE =
  /((?:^|\/)(?:password[-_]?reset|reset|magic[-_]?login|verify|verification|invite|invitation)\/)([^/?#]+)(?=\/|$)/iu;

export function getBrowserUrlParameterSets(parsed: URL): URLSearchParams[] {
  const sets = [parsed.searchParams];
  const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const queryIndex = fragment.indexOf("?");
  const query = queryIndex >= 0 ? fragment.slice(queryIndex + 1) : fragment;
  if (query.includes("=")) {
    sets.push(new URLSearchParams(query));
  }
  return sets;
}

export function hasBrowserOAuthContext(
  parsed: URL,
  parameterSets: URLSearchParams[] = getBrowserUrlParameterSets(parsed),
): boolean {
  return (
    BROWSER_OAUTH_CALLBACK_PATH_RE.test(parsed.pathname) ||
    parameterSets.some((params) =>
      [...params.keys()].some((key) => BROWSER_OAUTH_CONTEXT_QUERY_KEYS.has(key.toLowerCase())),
    )
  );
}

export function isBrowserCredentialQueryKey(key: string, oauthContext: boolean): boolean {
  const normalizedKey = key.toLowerCase();
  return (
    normalizedKey === "client_secret" ||
    BROWSER_SIGNED_URL_QUERY_KEYS.has(normalizedKey) ||
    BROWSER_OAUTH_CREDENTIAL_QUERY_KEYS.has(normalizedKey) ||
    (normalizedKey === "code" && oauthContext)
  );
}

export function classifyBrowserUrlCredential(
  value: string,
  classifyLabel: (label: string) => string | undefined,
): string | undefined {
  const candidates = value.match(/\bhttps?:\/\/[^\s"'<>]+/gi) ?? [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.replace(/[),.;]+$/g, ""));
      if (url.username || url.password || BROWSER_OPAQUE_CREDENTIAL_PATH_RE.test(url.pathname)) {
        return url.username || url.password ? "password" : "token";
      }
      const parameterSets = getBrowserUrlParameterSets(url);
      const oauthContext = hasBrowserOAuthContext(url, parameterSets);
      for (const params of parameterSets) {
        for (const [key, queryValue] of params) {
          if (!queryValue.trim()) {
            continue;
          }
          const normalizedKey = key.toLowerCase();
          if (normalizedKey === "client_secret") {
            return "secret";
          }
          if (isBrowserCredentialQueryKey(key, oauthContext)) {
            return "token";
          }
          const credentialClass = classifyLabel(key);
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
