/**
 * Activity inspection helpers that expose observed page errors, network
 * requests, and console messages from Playwright page state.
 */
import type {
  BrowserConsoleMessage,
  BrowserNetworkRequest,
  BrowserPageError,
} from "./pw-session.js";
import {
  assertBrowserPageOrigin,
  ensurePageState,
  getPageForTargetId,
  waitForPendingConsoleOrigins,
} from "./pw-session.js";

function stripObservedOrigin<T extends { observedOrigin?: string }>(
  entry: T,
): Omit<T, "observedOrigin"> {
  const publicEntry = { ...entry } as Omit<T, "observedOrigin"> & {
    observedOrigin?: string;
  };
  delete publicEntry.observedOrigin;
  return publicEntry;
}

function matchesApprovedOrigin(
  entry: { observedOrigin?: string },
  approvedOrigin?: string,
): boolean {
  return !approvedOrigin || entry.observedOrigin === approvedOrigin;
}

/** Returns captured page errors, optionally clearing the per-page buffer. */
export async function getPageErrorsViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  clear?: boolean;
  approvedOrigin?: string;
}): Promise<{ errors: BrowserPageError[] }> {
  const page = await getPageForTargetId(opts);
  assertBrowserPageOrigin(page, opts.approvedOrigin);
  const state = ensurePageState(page);
  const errors = state.errors
    .filter((entry) => matchesApprovedOrigin(entry, opts.approvedOrigin))
    .map(stripObservedOrigin);
  if (opts.clear) {
    state.errors = [];
  }
  return { errors };
}

/** Returns captured network requests, with optional URL substring filtering and clearing. */
export async function getNetworkRequestsViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  filter?: string;
  clear?: boolean;
  approvedOrigin?: string;
}): Promise<{ requests: BrowserNetworkRequest[] }> {
  const page = await getPageForTargetId(opts);
  assertBrowserPageOrigin(page, opts.approvedOrigin);
  const state = ensurePageState(page);
  const raw = state.requests.filter((entry) => matchesApprovedOrigin(entry, opts.approvedOrigin));
  const filter = typeof opts.filter === "string" ? opts.filter.trim() : "";
  const requests = (filter ? raw.filter((r) => r.url.includes(filter)) : raw).map(
    stripObservedOrigin,
  );
  if (opts.clear) {
    state.requests = [];
    state.requestIds = new WeakMap();
  }
  return { requests };
}

function consolePriority(level: string) {
  switch (level) {
    case "error":
      return 3;
    case "warning":
      return 2;
    case "info":
    case "log":
      return 1;
    case "debug":
      return 0;
    default:
      return 1;
  }
}

/** Returns captured console messages at or above the requested priority level. */
export async function getConsoleMessagesViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  level?: string;
  approvedOrigin?: string;
}): Promise<BrowserConsoleMessage[]> {
  const page = await getPageForTargetId(opts);
  assertBrowserPageOrigin(page, opts.approvedOrigin);
  const state = ensurePageState(page);
  await waitForPendingConsoleOrigins(page);
  if (!opts.level) {
    return state.console
      .filter((entry) => matchesApprovedOrigin(entry, opts.approvedOrigin))
      .map(stripObservedOrigin);
  }
  const min = consolePriority(opts.level);
  return state.console
    .filter(
      (entry) =>
        matchesApprovedOrigin(entry, opts.approvedOrigin) && consolePriority(entry.type) >= min,
    )
    .map(stripObservedOrigin);
}
