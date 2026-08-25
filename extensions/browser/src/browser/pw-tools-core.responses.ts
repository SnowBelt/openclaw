/**
 * Response-body retrieval for Playwright-backed browser tools.
 */
import { normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import { truncateUtf16Safe } from "openclaw/plugin-sdk/text-utility-runtime";
import { redactBrowserNavigationUrl } from "./navigation-guard.js";
import { ensurePageState, getPageForTargetId } from "./pw-session.js";
import { normalizeTimeoutMs } from "./pw-tools-core.shared.js";
import { matchBrowserUrlPattern } from "./url-pattern.js";

const URL_RESPONSE_HEADER_NAMES = new Set(["content-location", "link", "location", "refresh"]);

function redactResponseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  const direct = redactBrowserNavigationUrl(trimmed);
  if (direct !== "[redacted invalid browser URL]") {
    return direct;
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(trimmed)) {
    return direct;
  }
  try {
    const parsed = new URL(trimmed, "https://openclaw.invalid");
    const redacted = redactBrowserNavigationUrl(parsed.toString());
    if (redacted === "[redacted invalid browser URL]" || redacted === parsed.toString()) {
      return value;
    }
    const redactedUrl = new URL(redacted);
    if (trimmed.startsWith("#")) {
      return redactedUrl.hash;
    }
    if (trimmed.startsWith("?")) {
      return `${redactedUrl.search}${redactedUrl.hash}`;
    }
    if (trimmed.startsWith("//")) {
      return `//${redactedUrl.host}${redactedUrl.pathname}${redactedUrl.search}${redactedUrl.hash}`;
    }
    const pathname = trimmed.startsWith("/")
      ? redactedUrl.pathname
      : redactedUrl.pathname.replace(/^\//u, "");
    return `${pathname}${redactedUrl.search}${redactedUrl.hash}`;
  } catch {
    return value;
  }
}

function redactResponseHeaderValue(name: string, value: string): string {
  switch (name.toLowerCase()) {
    case "location":
    case "content-location":
      return redactResponseUrl(value);
    case "refresh":
      return value.replace(
        /(\burl\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^;,]*))/giu,
        (
          _match,
          prefix: string,
          doubleQuotedUrl: string | undefined,
          singleQuotedUrl: string | undefined,
          unquotedUrl: string | undefined,
        ) => {
          const quote =
            doubleQuotedUrl !== undefined ? '"' : singleQuotedUrl !== undefined ? "'" : "";
          const url = doubleQuotedUrl ?? singleQuotedUrl ?? unquotedUrl ?? "";
          return `${prefix}${quote}${redactResponseUrl(url)}${quote}`;
        },
      );
    case "link":
      return value.replace(/<([^>]+)>/gu, (_match, url: string) => `<${redactResponseUrl(url)}>`);
    default:
      return value;
  }
}

function redactResponseHeaders(
  headers?: Record<string, string>,
): Record<string, string> | undefined {
  if (!headers) {
    return headers;
  }
  let changed = false;
  const redacted = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      if (!URL_RESPONSE_HEADER_NAMES.has(name.toLowerCase())) {
        return [name, value];
      }
      const redactedValue = redactResponseHeaderValue(name, value);
      changed ||= redactedValue !== value;
      return [name, redactedValue];
    }),
  );
  return changed ? redacted : headers;
}

/** Waits for a response URL pattern and returns a bounded text body. */
export async function responseBodyViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  url: string;
  timeoutMs?: number;
  maxChars?: number;
}): Promise<{
  url: string;
  status?: number;
  headers?: Record<string, string>;
  body: string;
  truncated?: boolean;
}> {
  const pattern = normalizeOptionalString(opts.url) ?? "";
  if (!pattern) {
    throw new Error("url is required");
  }
  const maxChars =
    typeof opts.maxChars === "number" && Number.isFinite(opts.maxChars)
      ? Math.max(1, Math.min(5_000_000, Math.floor(opts.maxChars)))
      : 200_000;
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 20_000);
  const maxBytes = maxChars * 4;

  const page = await getPageForTargetId(opts);
  ensurePageState(page);

  const promise = new Promise<unknown>((resolve, reject) => {
    let done = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = undefined;
      if (handler) {
        page.off("response", handler as never);
      }
    };

    const handler: ((resp: unknown) => void) | undefined = (resp: unknown) => {
      if (done) {
        return;
      }
      const r = resp as { url?: () => string };
      const u = r.url?.() || "";
      if (!matchBrowserUrlPattern(pattern, u)) {
        return;
      }
      done = true;
      cleanup();
      resolve(resp);
    };

    page.on("response", handler as never);
    timer = setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      cleanup();
      reject(
        new Error(
          `Response not found for url pattern "${pattern}". Run 'openclaw browser requests' to inspect recent network activity.`,
        ),
      );
    }, timeout);
  });

  const resp = (await promise) as {
    url?: () => string;
    status?: () => number;
    headers?: () => Record<string, string>;
    body?: () => Promise<Buffer>;
    text?: () => Promise<string>;
  };

  const url = resp.url?.() || "";
  const status = resp.status?.();
  const headers = resp.headers?.();

  let bodyText = "";
  let bodyByteLength = 0;
  try {
    if (typeof resp.body === "function") {
      const buf = await resp.body();
      bodyByteLength = buf.byteLength;
      // Playwright exposes only a full-body Buffer. Bound the second allocation
      // while preserving the existing response-prefix contract.
      bodyText = new TextDecoder("utf-8").decode(buf.subarray(0, maxBytes));
    }
  } catch (err) {
    throw new Error(`Failed to read response body for "${url}": ${String(err)}`, { cause: err });
  }

  const trimmed = bodyText.length > maxChars ? truncateUtf16Safe(bodyText, maxChars) : bodyText;
  return {
    url: redactBrowserNavigationUrl(url),
    status,
    headers: redactResponseHeaders(headers),
    body: trimmed,
    truncated: bodyByteLength > maxBytes || bodyText.length > maxChars ? true : undefined,
  };
}
