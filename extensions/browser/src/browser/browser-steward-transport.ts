/** Internal transport metadata for approved Browser Steward actions. */
export const BROWSER_STEWARD_APPROVED_ORIGIN_HEADER = "x-openclaw-browser-steward-approved-origin";
/** Node-host command advertised by runtimes that understand approved-origin bindings. */
export const BROWSER_STEWARD_APPROVED_ORIGIN_NODE_COMMAND = "browser.proxy.approved-origin";
/** Internal binding value for the intentionally opaque browser bootstrap page. */
export const BROWSER_STEWARD_ABOUT_BLANK_ORIGIN = "about:blank";

function isBrowserStewardAboutBlankUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "about:" && url.pathname === "blank";
  } catch {
    return false;
  }
}

/** Resolve a URL to a transport-safe approval binding without returning opaque `null`. */
export function resolveBrowserStewardUrlOrigin(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (isBrowserStewardAboutBlankUrl(trimmed)) {
    return BROWSER_STEWARD_ABOUT_BLANK_ORIGIN;
  }
  try {
    const origin = new URL(trimmed).origin;
    return origin && origin !== "null" ? origin : undefined;
  } catch {
    return undefined;
  }
}

/** Match a live URL against a previously approved origin or opaque bootstrap binding. */
export function matchesBrowserStewardApprovedUrl(value: string, approvedOrigin: string): boolean {
  return resolveBrowserStewardUrlOrigin(value) === approvedOrigin;
}

/** Normalize an approval origin without echoing the supplied value. */
export function normalizeBrowserStewardApprovedOrigin(value: unknown): string | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return undefined;
  }
  return resolveBrowserStewardUrlOrigin(rawValue);
}

/** Read internal approval metadata while distinguishing absent from invalid input. */
export function readBrowserStewardApprovedOrigin(headers: unknown): {
  present: boolean;
  origin?: string;
} {
  if (!headers || typeof headers !== "object") {
    return { present: false };
  }
  const value = (headers as Record<string, unknown>)[BROWSER_STEWARD_APPROVED_ORIGIN_HEADER];
  if (value === undefined) {
    return { present: false };
  }
  const origin = normalizeBrowserStewardApprovedOrigin(value);
  return origin ? { present: true, origin } : { present: true };
}
