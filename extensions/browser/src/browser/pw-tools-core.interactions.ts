/**
 * Playwright-backed browser interaction tools, including clicks, form input,
 * screenshots, batch actions, and SSRF-aware post-interaction navigation checks.
 */
import { resolveNonNegativeIntegerOption } from "openclaw/plugin-sdk/number-runtime";
import { normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import type { ElementHandle, Frame, Locator, Page } from "playwright-core";
import { formatErrorMessage } from "../infra/errors.js";
import type { SsrFPolicy } from "../infra/net/ssrf.js";
import {
  ACT_MAX_BATCH_ACTIONS,
  ACT_MAX_BATCH_DEPTH,
  ACT_MAX_CLICK_DELAY_MS,
  ACT_MAX_WAIT_TIME_MS,
  resolveActInteractionTimeoutMs,
  resolveActWaitTimeoutMs,
} from "./act-policy.js";
import type { BrowserActRequest, BrowserFormField } from "./client-actions.types.js";
import { normalizeBrowserEvaluateFunctionSource } from "./evaluate-source.js";
import { DEFAULT_FILL_FIELD_TYPE } from "./form-fields.js";
import {
  assertBrowserNavigationResultAllowed,
  withBrowserNavigationPolicy,
} from "./navigation-guard.js";
import { resolveStrictExistingUploadPaths } from "./paths.js";
import {
  assertBrowserFrameOrigin,
  assertBrowserPageFramesOrigin,
  assertBrowserTargetOrigin,
  assertPageNavigationCompletedSafely,
  createObservedDialogAbortSignalForPage,
  ensurePageState,
  forceDisconnectPlaywrightForTarget,
  getPageForTargetId,
  isBrowserObservedDialogBlockedError,
  markObservedDialogsHandledRemotelyForPage,
  refLocator,
  restoreRoleRefsForTarget,
} from "./pw-session.js";
import {
  normalizeTimeoutMs,
  requireRef,
  requireRefOrSelector,
  toAIFriendlyError,
} from "./pw-tools-core.shared.js";
import { closePageViaPlaywright, resizeViewportViaPlaywright } from "./pw-tools-core.snapshot.js";
import {
  ANNOTATION_MAX_LABELS_DEFAULT,
  type AnnotationItem,
  buildOverlayClearScript,
  buildOverlayInjectionScript,
  type CoordinateSpace,
  planAnnotations,
  type RawAnnotationInput,
} from "./screenshot-annotate.js";

type TargetOpts = {
  cdpUrl: string;
  targetId?: string;
};

const INTERACTION_NAVIGATION_GRACE_MS = 250;

type NavigationObservablePage = Pick<Page, "url"> & {
  mainFrame?: () => Frame;
  on?: (event: "framenavigated", listener: (frame: Frame) => void) => unknown;
  off?: (event: "framenavigated", listener: (frame: Frame) => void) => unknown;
};

const pendingInteractionNavigationGuardCleanup = new WeakMap<Page, () => void>();

function resolveBoundedDelayMs(value: number | undefined, label: string, maxMs: number): number {
  const normalized = Math.floor(value ?? 0);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${label} must be >= 0`);
  }
  if (normalized > maxMs) {
    throw new Error(`${label} exceeds maximum of ${maxMs}ms`);
  }
  return normalized;
}

async function getRestoredPageForTarget(opts: TargetOpts) {
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  return page;
}

function toFriendlyInteractionError(err: unknown, label: string): Error {
  return isBrowserObservedDialogBlockedError(err) ? err : toAIFriendlyError(err, label);
}

function reconcileRemoteDialogAfterActionSettled(page: Page, signal?: AbortSignal): void {
  if (isBrowserObservedDialogBlockedError(signal?.reason)) {
    markObservedDialogsHandledRemotelyForPage(page);
  }
}

function assertApprovedPageOrigin(page: Page, approvedOrigin?: string): void {
  if (!approvedOrigin) {
    return;
  }
  let currentOrigin: string;
  try {
    currentOrigin = new URL(page.url()).origin;
  } catch {
    throw new Error("Browser Steward approved origin could not be verified");
  }
  if (currentOrigin !== approvedOrigin) {
    throw new Error("Browser Steward approved origin changed before execution");
  }
}

/** Verifies the frame containing keyboard focus without rejecting unrelated iframes. */
async function assertApprovedFocusedFrameOrigin(
  page: Page,
  approvedOrigin?: string,
): Promise<void> {
  if (!approvedOrigin) {
    return;
  }
  assertApprovedPageOrigin(page, approvedOrigin);
  const focusedOrigin = await page.evaluate(() => {
    const active = document.activeElement;
    if (active && (active.tagName === "IFRAME" || active.tagName === "FRAME")) {
      try {
        return active.contentWindow?.location?.origin ?? null;
      } catch {
        return null;
      }
    }
    return location.origin;
  });
  if (focusedOrigin !== approvedOrigin) {
    throw new Error("Browser Steward approved focused frame origin could not be verified");
  }
}

/** Verifies the frame receiving an approved coordinate click before dispatch. */
async function assertApprovedCoordinateOrigin(
  page: Page,
  x: number,
  y: number,
  approvedOrigin?: string,
): Promise<void> {
  if (!approvedOrigin) {
    return;
  }
  const targetTagName = await page.evaluate(
    ({ x: pointX, y: pointY }) =>
      document.elementFromPoint(pointX, pointY)?.tagName.toLowerCase() ?? null,
    { x, y },
  );
  if (targetTagName === null) {
    throw new Error("Browser Steward approved coordinate frame origin could not be verified");
  }
  let targetFrame = page.mainFrame();
  if (targetTagName === "iframe" || targetTagName === "frame") {
    let smallestArea = Number.POSITIVE_INFINITY;
    for (const frame of page.frames()) {
      if (frame === targetFrame) {
        continue;
      }
      const frameElement = await frame.frameElement().catch(() => null);
      const box = await frameElement?.boundingBox().catch(() => null);
      if (!box || x < box.x || y < box.y || x > box.x + box.width || y > box.y + box.height) {
        continue;
      }
      const area = box.width * box.height;
      if (area < smallestArea) {
        smallestArea = area;
        targetFrame = frame;
      }
    }
  }
  const targetOrigin = resolveLiveFrameOrigin(targetFrame);
  if (targetOrigin !== approvedOrigin) {
    throw new Error("Browser Steward approved coordinate frame origin could not be verified");
  }
}

function resolveLiveFrameOrigin(frame: Frame): string | undefined {
  const frameUrl = frame.url();
  if (frameUrl === "about:blank" || frameUrl === "about:srcdoc") {
    const parent = frame.parentFrame();
    return parent ? resolveLiveFrameOrigin(parent) : undefined;
  }
  try {
    const origin = new URL(frameUrl).origin;
    return origin && origin !== "null" ? origin : undefined;
  } catch {
    return undefined;
  }
}

/** Verifies the frame owning a locator before an approved native Playwright action. */
async function assertApprovedElementOrigin(
  handle: ElementHandle,
  approvedOrigin: string | undefined,
): Promise<void> {
  if (!approvedOrigin) {
    return;
  }
  const currentOrigin = await handle.evaluate(() => location.origin);
  if (currentOrigin !== approvedOrigin) {
    throw new Error("Browser Steward approved origin changed before execution");
  }
}

/** Re-check the page and, when applicable, the element frame around a capture. */
async function assertApprovedCaptureOrigin(params: {
  page: Page;
  locator?: Locator;
  approvedOrigin?: string;
}): Promise<void> {
  if (!params.approvedOrigin) {
    return;
  }
  await assertBrowserPageFramesOrigin(params.page, params.approvedOrigin);
  if (!params.locator) {
    return;
  }
  const handle = await params.locator.elementHandle({ timeout: 1000 });
  if (!handle) {
    throw new Error("Browser Steward approved capture element could not be verified");
  }
  try {
    await assertBrowserFrameOrigin(await handle.ownerFrame(), params.approvedOrigin);
  } finally {
    await handle.dispose().catch(() => {});
  }
}

/** Pins an approved action to the exact DOM element before sending values. */
async function withApprovedElementHandle<T>(params: {
  locator: Locator;
  approvedOrigin?: string;
  timeout: number;
  action: (handle: ElementHandle) => Promise<T>;
}): Promise<{ approved: boolean; value?: T }> {
  if (!params.approvedOrigin) {
    return { approved: false };
  }
  const handle = await params.locator.elementHandle({ timeout: params.timeout });
  if (!handle) {
    throw new Error("Browser Steward approved element could not be resolved");
  }
  try {
    await assertApprovedElementOrigin(handle, params.approvedOrigin);
    return { approved: true, value: await params.action(handle) };
  } finally {
    await handle.dispose().catch(() => {});
  }
}

/** Verifies the live frame owning a locator immediately before a frame-targeted action. */
async function assertApprovedLocatorFrameOrigin(params: {
  locator: Locator;
  approvedOrigin?: string;
  timeout: number;
}): Promise<void> {
  if (!params.approvedOrigin) {
    return;
  }
  const handle = await params.locator.elementHandle({ timeout: params.timeout });
  if (!handle) {
    throw new Error("Browser Steward approved element could not be resolved");
  }
  try {
    await assertBrowserFrameOrigin(await handle.ownerFrame(), params.approvedOrigin);
  } finally {
    await handle.dispose().catch(() => {});
  }
}

function guardApprovedWaitFunction(fn: string, approvedOrigin?: string): string {
  if (!approvedOrigin) {
    return fn;
  }
  return `(...args) => {
    if (location.origin !== ${JSON.stringify(approvedOrigin)}) {
      throw new Error("Browser Steward approved origin changed before execution");
    }
    const predicate = (${fn});
    const result =
      typeof predicate === "function" ? predicate(...args) : predicate;
    if (location.origin !== ${JSON.stringify(approvedOrigin)}) {
      throw new Error("Browser Steward approved origin changed during execution");
    }
    return result;
  }`;
}

const resolveInteractionTimeoutMs = resolveActInteractionTimeoutMs;

// Returns true only when the URL change indicates a cross-document navigation
// (i.e., a real network fetch occurred). Same-document hash-only mutations —
// anchor clicks and history.pushState/replaceState that change only the
// fragment — do not cause a network request and must not trigger SSRF checks.
function didCrossDocumentUrlChange(page: { url(): string }, previousUrl: string): boolean {
  const currentUrl = page.url();
  if (currentUrl === previousUrl) {
    return false;
  }
  try {
    const prev = new URL(previousUrl);
    const curr = new URL(currentUrl);
    if (
      prev.origin === curr.origin &&
      prev.pathname === curr.pathname &&
      prev.search === curr.search
    ) {
      // Only the fragment changed — same-document navigation, no fetch.
      return false;
    }
  } catch {
    // Non-parseable URL; fall through to string comparison.
  }
  return true;
}

// Returns true when a framenavigated event represents only a hash-only
// same-document mutation (no network request). Used in event-driven checks
// where the event itself is the navigation signal — unlike URL polling, we
// cannot use identical URLs as a "no navigation" sentinel because same-URL
// reloads and form submits also fire framenavigated with an unchanged URL.
function isHashOnlyNavigation(currentUrl: string, previousUrl: string): boolean {
  if (currentUrl === previousUrl) {
    // Exact same URL + framenavigated firing = reload or form submit, not a
    // fragment hop. Must run SSRF checks.
    return false;
  }
  try {
    const prev = new URL(previousUrl);
    const curr = new URL(currentUrl);
    return (
      prev.origin === curr.origin && prev.pathname === curr.pathname && prev.search === curr.search
    );
  } catch {
    return false;
  }
}

function isMainFrameNavigation(page: NavigationObservablePage, frame: Frame): boolean {
  if (typeof page.mainFrame !== "function") {
    return true;
  }
  return frame === page.mainFrame();
}

async function assertSubframeNavigationAllowed(
  frameUrl: string,
  ssrfPolicy?: SsrFPolicy,
): Promise<void> {
  if (!ssrfPolicy || (!frameUrl.startsWith("http://") && !frameUrl.startsWith("https://"))) {
    // Non-network frame URLs like about:blank and about:srcdoc do not cross the
    // browser SSRF boundary, so they should not trigger the navigation policy.
    return;
  }

  await assertBrowserNavigationResultAllowed({
    url: frameUrl,
    ...withBrowserNavigationPolicy(ssrfPolicy),
  });
}

type ObservedDelayedNavigations = {
  mainFrameNavigated: boolean;
  subframes: string[];
};

function snapshotNetworkFrameUrl(frame: Frame): string | null {
  try {
    const frameUrl = frame.url();
    return frameUrl.startsWith("http://") || frameUrl.startsWith("https://") ? frameUrl : null;
  } catch {
    return null;
  }
}

async function assertObservedDelayedNavigations(opts: {
  cdpUrl: string;
  page: Page;
  ssrfPolicy?: SsrFPolicy;
  targetId?: string;
  observed: ObservedDelayedNavigations;
}): Promise<void> {
  let subframeError: unknown;
  try {
    for (const frameUrl of opts.observed.subframes) {
      await assertSubframeNavigationAllowed(frameUrl, opts.ssrfPolicy);
    }
  } catch (err) {
    subframeError = err;
  }
  if (opts.observed.mainFrameNavigated) {
    await assertPageNavigationCompletedSafely({
      cdpUrl: opts.cdpUrl,
      page: opts.page,
      response: null,
      ssrfPolicy: opts.ssrfPolicy,
      targetId: opts.targetId,
    });
  }
  if (subframeError) {
    throw toLintErrorObject(subframeError, "Non-Error thrown");
  }
}

function observeDelayedInteractionNavigation(
  page: NavigationObservablePage,
  previousUrl: string,
): Promise<ObservedDelayedNavigations> {
  if (didCrossDocumentUrlChange(page, previousUrl)) {
    return Promise.resolve({ mainFrameNavigated: true, subframes: [] });
  }
  if (typeof page.on !== "function" || typeof page.off !== "function") {
    return Promise.resolve({ mainFrameNavigated: false, subframes: [] });
  }

  return new Promise<ObservedDelayedNavigations>((resolve) => {
    const subframes: string[] = [];
    const onFrameNavigated = (frame: Frame) => {
      if (!isMainFrameNavigation(page, frame)) {
        const frameUrl = snapshotNetworkFrameUrl(frame);
        if (frameUrl) {
          subframes.push(frameUrl);
        }
        return;
      }
      // Use isHashOnlyNavigation rather than !didCrossDocumentUrlChange: the
      // event firing is itself the navigation signal, so a same-URL reload must
      // not be treated as "no navigation" the way URL polling would.
      if (isHashOnlyNavigation(page.url(), previousUrl)) {
        return;
      }
      cleanup();
      resolve({ mainFrameNavigated: true, subframes });
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve({
        mainFrameNavigated: didCrossDocumentUrlChange(page, previousUrl),
        subframes,
      });
    }, INTERACTION_NAVIGATION_GRACE_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      // Call off directly on page (not via a cached reference) to preserve
      // Playwright's EventEmitter `this` binding.
      page.off!("framenavigated", onFrameNavigated);
    };

    // Call on directly on page (not via a cached reference) to preserve
    // Playwright's EventEmitter `this` binding.
    page.on!("framenavigated", onFrameNavigated);
  });
}

function scheduleDelayedInteractionNavigationGuard(opts: {
  cdpUrl: string;
  page: Page;
  previousUrl: string;
  ssrfPolicy?: SsrFPolicy;
  targetId?: string;
}): Promise<void> {
  if (!opts.ssrfPolicy) {
    return Promise.resolve();
  }
  const page = opts.page as unknown as NavigationObservablePage;
  if (didCrossDocumentUrlChange(page, opts.previousUrl)) {
    return assertPageNavigationCompletedSafely({
      cdpUrl: opts.cdpUrl,
      page: opts.page,
      response: null,
      ssrfPolicy: opts.ssrfPolicy,
      targetId: opts.targetId,
    });
  }
  if (typeof page.on !== "function" || typeof page.off !== "function") {
    return Promise.resolve();
  }

  pendingInteractionNavigationGuardCleanup.get(opts.page)?.();

  return new Promise<void>((resolve, reject) => {
    const settle = (err?: unknown) => {
      cleanup();
      if (err) {
        reject(toLintErrorObject(err, "Non-Error rejection"));
        return;
      }
      resolve();
    };
    const subframes: string[] = [];
    const onFrameNavigated = (frame: Frame) => {
      if (!isMainFrameNavigation(page, frame)) {
        const frameUrl = snapshotNetworkFrameUrl(frame);
        if (frameUrl) {
          subframes.push(frameUrl);
        }
        return;
      }
      // Use isHashOnlyNavigation rather than !didCrossDocumentUrlChange: the
      // event firing is itself the navigation signal, so a same-URL reload must
      // not be treated as "no navigation" the way URL polling would.
      if (isHashOnlyNavigation(page.url(), opts.previousUrl)) {
        return;
      }
      cleanup();
      void assertObservedDelayedNavigations({
        cdpUrl: opts.cdpUrl,
        page: opts.page,
        ssrfPolicy: opts.ssrfPolicy,
        targetId: opts.targetId,
        observed: { mainFrameNavigated: true, subframes },
      }).then(() => settle(), settle);
    };
    const timeout = setTimeout(() => {
      cleanup();
      void assertObservedDelayedNavigations({
        cdpUrl: opts.cdpUrl,
        page: opts.page,
        ssrfPolicy: opts.ssrfPolicy,
        targetId: opts.targetId,
        observed: {
          mainFrameNavigated: didCrossDocumentUrlChange(page, opts.previousUrl),
          subframes,
        },
      }).then(() => settle(), settle);
    }, INTERACTION_NAVIGATION_GRACE_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      page.off!("framenavigated", onFrameNavigated);
      if (pendingInteractionNavigationGuardCleanup.get(opts.page) === settle) {
        pendingInteractionNavigationGuardCleanup.delete(opts.page);
      }
    };

    pendingInteractionNavigationGuardCleanup.set(opts.page, settle);
    page.on!("framenavigated", onFrameNavigated);
  });
}

async function assertInteractionNavigationCompletedSafely<T>(opts: {
  action: () => Promise<T>;
  cdpUrl: string;
  page: Page;
  previousUrl: string;
  ssrfPolicy?: SsrFPolicy;
  targetId?: string;
}): Promise<T> {
  if (!opts.ssrfPolicy) {
    return await opts.action();
  }
  // Phase 1: keep a framenavigated listener alive for the entire duration of the
  // action so navigations triggered mid-click or mid-evaluate are not missed.
  // Using a fixed pre-action timer would expire before the action finishes for
  // slow interactions, silently bypassing the SSRF guard.
  const navPage = opts.page as unknown as NavigationObservablePage;
  let navigatedDuringAction = false;
  const subframeNavigationsDuringAction: string[] = [];
  const onFrameNavigated = (frame: Frame) => {
    if (!isMainFrameNavigation(navPage, frame)) {
      const frameUrl = snapshotNetworkFrameUrl(frame);
      if (frameUrl) {
        subframeNavigationsDuringAction.push(frameUrl);
      }
      return;
    }
    // Use isHashOnlyNavigation rather than didCrossDocumentUrlChange: the event
    // firing is the navigation signal, so a same-URL reload must not be skipped
    // the way it would be by URL-equality polling.
    if (!isHashOnlyNavigation(opts.page.url(), opts.previousUrl)) {
      navigatedDuringAction = true;
    }
  };
  if (typeof navPage.on === "function") {
    navPage.on("framenavigated", onFrameNavigated);
  }

  let result: T | undefined;
  let actionError: unknown = null;
  try {
    result = await opts.action();
  } catch (err) {
    actionError = err;
  } finally {
    if (typeof navPage.off === "function") {
      navPage.off("framenavigated", onFrameNavigated);
    }
  }

  const navigationObserved =
    navigatedDuringAction || didCrossDocumentUrlChange(opts.page, opts.previousUrl);

  let subframeError: unknown;
  try {
    for (const frameUrl of subframeNavigationsDuringAction) {
      await assertSubframeNavigationAllowed(frameUrl, opts.ssrfPolicy);
    }
  } catch (err) {
    subframeError = err;
  }

  if (navigationObserved) {
    await assertPageNavigationCompletedSafely({
      cdpUrl: opts.cdpUrl,
      page: opts.page,
      response: null,
      ssrfPolicy: opts.ssrfPolicy,
      targetId: opts.targetId,
    });
  } else if (actionError) {
    // Preserve the action-error path semantics: if a rejected click/evaluate still
    // triggers a delayed navigation, the SSRF block must win over the original
    // action error instead of surfacing a stale interaction failure.
    const observed = await observeDelayedInteractionNavigation(opts.page, opts.previousUrl);
    if (observed.mainFrameNavigated || observed.subframes.length > 0) {
      await assertObservedDelayedNavigations({
        cdpUrl: opts.cdpUrl,
        page: opts.page,
        ssrfPolicy: opts.ssrfPolicy,
        targetId: opts.targetId,
        observed,
      });
    }
  } else {
    // Successful interactions still need a short grace window: a click can resolve
    // before the navigation event fires, and a blocked late hop must be observable
    // to the current caller instead of only quarantining the page in the background.
    await scheduleDelayedInteractionNavigationGuard({
      cdpUrl: opts.cdpUrl,
      page: opts.page,
      previousUrl: opts.previousUrl,
      ssrfPolicy: opts.ssrfPolicy,
      targetId: opts.targetId,
    });
  }

  if (subframeError) {
    throw toLintErrorObject(subframeError, "Non-Error thrown");
  }

  if (actionError) {
    throw toLintErrorObject(actionError, "Non-Error thrown");
  }
  return result as T;
}

async function awaitActionWithAbort<T>(
  actionPromise: Promise<T>,
  abortPromise?: Promise<never>,
  onActionResolvedAfterAbort?: () => void,
): Promise<T> {
  if (!abortPromise) {
    return await actionPromise;
  }
  try {
    return await Promise.race([actionPromise, abortPromise]);
  } catch (err) {
    // If abort wins the race, the action may reject later; avoid unhandled rejections.
    void actionPromise.then(
      () => onActionResolvedAfterAbort?.(),
      () => {},
    );
    throw err;
  }
}

function createAbortPromise(signal?: AbortSignal): {
  abortPromise?: Promise<never>;
  cleanup: () => void;
} {
  return createAbortPromiseWithListener(signal);
}

function createAbortPromiseWithListener(
  signal?: AbortSignal,
  onAbort?: (reason: unknown) => void,
): {
  abortPromise?: Promise<never>;
  cleanup: () => void;
} {
  if (!signal) {
    return { cleanup: () => {} };
  }
  let abortListener: (() => void) | undefined;
  const abortPromise: Promise<never> = signal.aborted
    ? (() => {
        onAbort?.(signal.reason);
        return Promise.reject(
          toLintErrorObject(signal.reason ?? new Error("aborted"), "Non-Error rejection"),
        );
      })()
    : new Promise((_, reject) => {
        abortListener = () => {
          onAbort?.(signal.reason);
          reject(toLintErrorObject(signal.reason ?? new Error("aborted"), "Non-Error rejection"));
        };
        signal.addEventListener("abort", abortListener, { once: true });
      });
  // Avoid unhandled rejections on early returns.
  void abortPromise.catch(() => {});
  return {
    abortPromise,
    cleanup: () => {
      if (abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
    },
  };
}
/** Highlights a role ref in the target page for visual inspection. */
export async function highlightViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref: string;
}): Promise<void> {
  const page = await getRestoredPageForTarget(opts);
  const ref = requireRef(opts.ref);
  try {
    await refLocator(page, ref).highlight();
  } catch (err) {
    throw toFriendlyInteractionError(err, ref);
  }
}

/** Clicks or double-clicks a role ref or selector with dialog and navigation guards. */
export async function clickViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref?: string;
  selector?: string;
  doubleClick?: boolean;
  button?: "left" | "right" | "middle";
  modifiers?: Array<"Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift">;
  delayMs?: number;
  timeoutMs?: number;
  ssrfPolicy?: SsrFPolicy;
  signal?: AbortSignal;
  approvedOrigin?: string;
}): Promise<void> {
  const resolved = requireRefOrSelector(opts.ref, opts.selector);
  const page = await getRestoredPageForTarget(opts);
  const label = resolved.ref ?? resolved.selector!;
  const locator = resolved.ref
    ? refLocator(page, requireRef(resolved.ref))
    : page.locator(resolved.selector!);
  const timeout = resolveInteractionTimeoutMs(opts.timeoutMs);
  const previousUrl = page.url();
  const signal = opts.signal;
  let abortListener: (() => void) | undefined;
  let abortReject: ((reason: unknown) => void) | undefined;
  let abortPromise: Promise<never> | undefined;
  if (signal) {
    abortPromise = new Promise((_, reject) => {
      abortReject = reject;
    });
    void abortPromise.catch(() => {});
    const disconnect = () => {
      if (isBrowserObservedDialogBlockedError(signal.reason)) {
        return;
      }
      void forceDisconnectPlaywrightForTarget({
        cdpUrl: opts.cdpUrl,
        targetId: opts.targetId,
        ssrfPolicy: opts.ssrfPolicy,
        reason: "click aborted",
      }).catch(() => {});
    };
    if (signal.aborted) {
      disconnect();
      throw signal.reason ?? new Error("aborted");
    }
    abortListener = () => {
      disconnect();
      abortReject?.(signal.reason ?? new Error("aborted"));
    };
    signal.addEventListener("abort", abortListener, { once: true });
    if (signal.aborted) {
      abortListener();
      throw signal.reason ?? new Error("aborted");
    }
  }
  const reconcileRemoteDialog = () => reconcileRemoteDialogAfterActionSettled(page, signal);
  try {
    assertApprovedPageOrigin(page, opts.approvedOrigin);
    await assertInteractionNavigationCompletedSafely({
      action: async () => {
        const delayMs = resolveBoundedDelayMs(
          opts.delayMs,
          "click delayMs",
          ACT_MAX_CLICK_DELAY_MS,
        );
        if (delayMs > 0) {
          await awaitActionWithAbort(
            locator.hover({ timeout }),
            abortPromise,
            reconcileRemoteDialog,
          );
          await new Promise((resolve) => {
            setTimeout(resolve, delayMs);
          });
        }
        const approvedOperation = await withApprovedElementHandle({
          locator,
          approvedOrigin: opts.approvedOrigin,
          timeout,
          action: (handle) =>
            awaitActionWithAbort(
              opts.doubleClick
                ? handle.dblclick({
                    timeout,
                    button: opts.button,
                    modifiers: opts.modifiers,
                  })
                : handle.click({
                    timeout,
                    button: opts.button,
                    modifiers: opts.modifiers,
                  }),
              abortPromise,
              reconcileRemoteDialog,
            ),
        });
        if (approvedOperation.approved) {
          return;
        }
        await awaitActionWithAbort(
          opts.doubleClick
            ? locator.dblclick({
                timeout,
                button: opts.button,
                modifiers: opts.modifiers,
              })
            : locator.click({
                timeout,
                button: opts.button,
                modifiers: opts.modifiers,
              }),
          abortPromise,
          reconcileRemoteDialog,
        );
      },
      cdpUrl: opts.cdpUrl,
      page,
      previousUrl,
      ssrfPolicy: opts.ssrfPolicy,
      targetId: opts.targetId,
    });
    assertApprovedPageOrigin(page, opts.approvedOrigin);
  } catch (err) {
    throw toFriendlyInteractionError(err, label);
  } finally {
    if (signal && abortListener) {
      signal.removeEventListener("abort", abortListener);
    }
  }
}

/** Clicks absolute page coordinates with optional double-click and navigation guard. */
export async function clickCoordsViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  x: number;
  y: number;
  doubleClick?: boolean;
  button?: "left" | "right" | "middle";
  delayMs?: number;
  timeoutMs?: number;
  ssrfPolicy?: SsrFPolicy;
  signal?: AbortSignal;
  approvedOrigin?: string;
}): Promise<void> {
  const page = await getRestoredPageForTarget(opts);
  const previousUrl = page.url();
  const { abortPromise, cleanup } = createAbortPromise(opts.signal);
  const reconcileRemoteDialog = () => reconcileRemoteDialogAfterActionSettled(page, opts.signal);
  try {
    await assertBrowserPageFramesOrigin(page, opts.approvedOrigin);
    await assertInteractionNavigationCompletedSafely({
      action: async () => {
        await assertApprovedCoordinateOrigin(page, opts.x, opts.y, opts.approvedOrigin);
        await awaitActionWithAbort(
          page.mouse.click(opts.x, opts.y, {
            button: opts.button,
            clickCount: opts.doubleClick ? 2 : 1,
            delay: resolveBoundedDelayMs(
              opts.delayMs,
              "clickCoords delayMs",
              ACT_MAX_CLICK_DELAY_MS,
            ),
          }),
          abortPromise,
          reconcileRemoteDialog,
        );
      },
      cdpUrl: opts.cdpUrl,
      page,
      previousUrl,
      ssrfPolicy: opts.ssrfPolicy,
      targetId: opts.targetId,
    });
    await assertBrowserPageFramesOrigin(page, opts.approvedOrigin);
  } finally {
    cleanup();
  }
}

/** Hovers a role ref or selector on the target page. */
export async function hoverViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref?: string;
  selector?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  approvedOrigin?: string;
}): Promise<void> {
  const resolved = requireRefOrSelector(opts.ref, opts.selector);
  const page = await getRestoredPageForTarget(opts);
  const label = resolved.ref ?? resolved.selector!;
  const locator = resolved.ref
    ? refLocator(page, requireRef(resolved.ref))
    : page.locator(resolved.selector!);
  const timeout = resolveInteractionTimeoutMs(opts.timeoutMs);
  const { abortPromise, cleanup } = createAbortPromise(opts.signal);
  const reconcileRemoteDialog = () => reconcileRemoteDialogAfterActionSettled(page, opts.signal);
  try {
    assertApprovedPageOrigin(page, opts.approvedOrigin);
    await assertApprovedLocatorFrameOrigin({
      locator,
      approvedOrigin: opts.approvedOrigin,
      timeout,
    });
    await awaitActionWithAbort(locator.hover({ timeout }), abortPromise, reconcileRemoteDialog);
    assertApprovedPageOrigin(page, opts.approvedOrigin);
  } catch (err) {
    throw toFriendlyInteractionError(err, label);
  } finally {
    cleanup();
  }
}

/** Drags from one role ref or selector to another. */
export async function dragViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  startRef?: string;
  startSelector?: string;
  endRef?: string;
  endSelector?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  approvedOrigin?: string;
}): Promise<void> {
  const resolvedStart = requireRefOrSelector(opts.startRef, opts.startSelector);
  const resolvedEnd = requireRefOrSelector(opts.endRef, opts.endSelector);
  const page = await getRestoredPageForTarget(opts);
  const startLocator = resolvedStart.ref
    ? refLocator(page, requireRef(resolvedStart.ref))
    : page.locator(resolvedStart.selector!);
  const endLocator = resolvedEnd.ref
    ? refLocator(page, requireRef(resolvedEnd.ref))
    : page.locator(resolvedEnd.selector!);
  const startLabel = resolvedStart.ref ?? resolvedStart.selector!;
  const endLabel = resolvedEnd.ref ?? resolvedEnd.selector!;
  const timeout = resolveInteractionTimeoutMs(opts.timeoutMs);
  const { abortPromise, cleanup } = createAbortPromise(opts.signal);
  const reconcileRemoteDialog = () => reconcileRemoteDialogAfterActionSettled(page, opts.signal);
  try {
    assertApprovedPageOrigin(page, opts.approvedOrigin);
    await assertApprovedLocatorFrameOrigin({
      locator: startLocator,
      approvedOrigin: opts.approvedOrigin,
      timeout,
    });
    await assertApprovedLocatorFrameOrigin({
      locator: endLocator,
      approvedOrigin: opts.approvedOrigin,
      timeout,
    });
    await awaitActionWithAbort(
      startLocator.dragTo(endLocator, {
        timeout,
      }),
      abortPromise,
      reconcileRemoteDialog,
    );
    assertApprovedPageOrigin(page, opts.approvedOrigin);
  } catch (err) {
    throw toFriendlyInteractionError(err, `${startLabel} -> ${endLabel}`);
  } finally {
    cleanup();
  }
}

/** Selects one or more option values on a select-like element. */
export async function selectOptionViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref?: string;
  selector?: string;
  values: string[];
  timeoutMs?: number;
  ssrfPolicy?: SsrFPolicy;
  signal?: AbortSignal;
  approvedOrigin?: string;
}): Promise<void> {
  const resolved = requireRefOrSelector(opts.ref, opts.selector);
  if (!opts.values?.length) {
    throw new Error("values are required");
  }
  const page = await getRestoredPageForTarget(opts);
  const label = resolved.ref ?? resolved.selector!;
  const locator = resolved.ref
    ? refLocator(page, requireRef(resolved.ref))
    : page.locator(resolved.selector!);
  const previousUrl = page.url();
  const { abortPromise, cleanup } = createAbortPromise(opts.signal);
  const reconcileRemoteDialog = () => reconcileRemoteDialogAfterActionSettled(page, opts.signal);
  try {
    assertApprovedPageOrigin(page, opts.approvedOrigin);
    await assertInteractionNavigationCompletedSafely({
      action: async () => {
        const timeout = resolveInteractionTimeoutMs(opts.timeoutMs);
        const approvedOperation = await withApprovedElementHandle({
          locator,
          approvedOrigin: opts.approvedOrigin,
          timeout,
          action: (handle) =>
            awaitActionWithAbort(
              handle.selectOption(opts.values, { timeout }),
              abortPromise,
              reconcileRemoteDialog,
            ),
        });
        if (!approvedOperation.approved) {
          await awaitActionWithAbort(
            locator.selectOption(opts.values, {
              timeout,
            }),
            abortPromise,
            reconcileRemoteDialog,
          );
        }
      },
      cdpUrl: opts.cdpUrl,
      page,
      previousUrl,
      ssrfPolicy: opts.ssrfPolicy,
      targetId: opts.targetId,
    });
    assertApprovedPageOrigin(page, opts.approvedOrigin);
  } catch (err) {
    throw toFriendlyInteractionError(err, label);
  } finally {
    cleanup();
  }
}

/** Presses a keyboard key against a ref, selector, or focused page. */
export async function pressKeyViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  key: string;
  delayMs?: number;
  ssrfPolicy?: SsrFPolicy;
  signal?: AbortSignal;
  approvedOrigin?: string;
}): Promise<void> {
  const key = normalizeOptionalString(opts.key) ?? "";
  if (!key) {
    throw new Error("key is required");
  }
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  const previousUrl = page.url();
  const { abortPromise, cleanup } = createAbortPromise(opts.signal);
  const reconcileRemoteDialog = () => reconcileRemoteDialogAfterActionSettled(page, opts.signal);
  try {
    await assertApprovedFocusedFrameOrigin(page, opts.approvedOrigin);
    await assertInteractionNavigationCompletedSafely({
      action: async () => {
        await awaitActionWithAbort(
          page.keyboard.press(key, {
            delay: resolveNonNegativeIntegerOption(opts.delayMs, 0),
          }),
          abortPromise,
          reconcileRemoteDialog,
        );
      },
      cdpUrl: opts.cdpUrl,
      page,
      previousUrl,
      ssrfPolicy: opts.ssrfPolicy,
      targetId: opts.targetId,
    });
    await assertApprovedFocusedFrameOrigin(page, opts.approvedOrigin);
  } finally {
    cleanup();
  }
}

/** Types text into a ref, selector, or focused page. */
export async function typeViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref?: string;
  selector?: string;
  text: string;
  submit?: boolean;
  slowly?: boolean;
  timeoutMs?: number;
  ssrfPolicy?: SsrFPolicy;
  signal?: AbortSignal;
  approvedOrigin?: string;
}): Promise<void> {
  const resolved = requireRefOrSelector(opts.ref, opts.selector);
  const text = opts.text ?? "";
  const page = await getRestoredPageForTarget(opts);
  const label = resolved.ref ?? resolved.selector!;
  const locator = resolved.ref
    ? refLocator(page, requireRef(resolved.ref))
    : page.locator(resolved.selector!);
  const timeout = resolveInteractionTimeoutMs(opts.timeoutMs);
  const { abortPromise, cleanup } = createAbortPromise(opts.signal);
  const reconcileRemoteDialog = () => reconcileRemoteDialogAfterActionSettled(page, opts.signal);
  const assertApprovedOrigin = () => assertApprovedPageOrigin(page, opts.approvedOrigin);
  try {
    const previousUrl = page.url();
    if (opts.slowly) {
      await assertInteractionNavigationCompletedSafely({
        action: async () => {
          if (opts.approvedOrigin) {
            await withApprovedElementHandle({
              locator,
              approvedOrigin: opts.approvedOrigin,
              timeout,
              action: async (handle) => {
                await awaitActionWithAbort(
                  handle.click({ timeout }),
                  abortPromise,
                  reconcileRemoteDialog,
                );
                assertApprovedOrigin();
                await awaitActionWithAbort(
                  handle.type(text, { timeout, delay: 75 }),
                  abortPromise,
                  reconcileRemoteDialog,
                );
                assertApprovedOrigin();
                if (opts.submit) {
                  await awaitActionWithAbort(
                    handle.press("Enter", { timeout }),
                    abortPromise,
                    reconcileRemoteDialog,
                  );
                  assertApprovedOrigin();
                }
              },
            });
            return;
          }
          assertApprovedOrigin();
          await awaitActionWithAbort(
            locator.click({ timeout }),
            abortPromise,
            reconcileRemoteDialog,
          );
          assertApprovedOrigin();
          await awaitActionWithAbort(
            locator.type(text, { timeout, delay: 75 }),
            abortPromise,
            reconcileRemoteDialog,
          );
          assertApprovedOrigin();
          if (opts.submit) {
            await awaitActionWithAbort(
              locator.press("Enter", { timeout }),
              abortPromise,
              reconcileRemoteDialog,
            );
            assertApprovedOrigin();
          }
        },
        cdpUrl: opts.cdpUrl,
        page,
        previousUrl,
        ssrfPolicy: opts.ssrfPolicy,
        targetId: opts.targetId,
      });
    } else {
      await assertInteractionNavigationCompletedSafely({
        action: async () => {
          if (opts.approvedOrigin) {
            await withApprovedElementHandle({
              locator,
              approvedOrigin: opts.approvedOrigin,
              timeout,
              action: async (handle) => {
                await awaitActionWithAbort(
                  handle.fill(text, { timeout }),
                  abortPromise,
                  reconcileRemoteDialog,
                );
                assertApprovedOrigin();
                if (opts.submit) {
                  await awaitActionWithAbort(
                    handle.press("Enter", { timeout }),
                    abortPromise,
                    reconcileRemoteDialog,
                  );
                  assertApprovedOrigin();
                }
              },
            });
            return;
          }
          assertApprovedOrigin();
          await awaitActionWithAbort(
            locator.fill(text, { timeout }),
            abortPromise,
            reconcileRemoteDialog,
          );
          assertApprovedOrigin();
          if (opts.submit) {
            await awaitActionWithAbort(
              locator.press("Enter", { timeout }),
              abortPromise,
              reconcileRemoteDialog,
            );
            assertApprovedOrigin();
          }
        },
        cdpUrl: opts.cdpUrl,
        page,
        previousUrl,
        ssrfPolicy: opts.ssrfPolicy,
        targetId: opts.targetId,
      });
    }
  } catch (err) {
    throw toFriendlyInteractionError(err, label);
  } finally {
    cleanup();
  }
}

/** Fills multiple form fields with per-field selector/ref/type support. */
export async function fillFormViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  fields: BrowserFormField[];
  timeoutMs?: number;
  ssrfPolicy?: SsrFPolicy;
  signal?: AbortSignal;
  approvedOrigin?: string;
}): Promise<void> {
  const page = await getRestoredPageForTarget(opts);
  const timeout = resolveInteractionTimeoutMs(opts.timeoutMs);
  const { abortPromise, cleanup } = createAbortPromise(opts.signal);
  const reconcileRemoteDialog = () => reconcileRemoteDialogAfterActionSettled(page, opts.signal);
  try {
    for (const field of opts.fields) {
      const ref = field.ref.trim();
      const type = (field.type || DEFAULT_FILL_FIELD_TYPE).trim() || DEFAULT_FILL_FIELD_TYPE;
      const rawValue = field.value;
      const value =
        typeof rawValue === "string"
          ? rawValue
          : typeof rawValue === "number" || typeof rawValue === "boolean"
            ? String(rawValue)
            : "";
      if (!ref) {
        continue;
      }
      assertApprovedPageOrigin(page, opts.approvedOrigin);
      const locator = refLocator(page, ref);
      if (type === "checkbox" || type === "radio") {
        const checked =
          rawValue === true || rawValue === 1 || rawValue === "1" || rawValue === "true";
        try {
          const previousUrl = page.url();
          await assertInteractionNavigationCompletedSafely({
            action: async () => {
              const approvedOperation = await withApprovedElementHandle({
                locator,
                approvedOrigin: opts.approvedOrigin,
                timeout,
                action: (handle) =>
                  awaitActionWithAbort(
                    handle.setChecked(checked, { timeout }),
                    abortPromise,
                    reconcileRemoteDialog,
                  ),
              });
              if (!approvedOperation.approved) {
                await awaitActionWithAbort(
                  locator.setChecked(checked, { timeout }),
                  abortPromise,
                  reconcileRemoteDialog,
                );
              }
            },
            cdpUrl: opts.cdpUrl,
            page,
            previousUrl,
            ssrfPolicy: opts.ssrfPolicy,
            targetId: opts.targetId,
          });
          assertApprovedPageOrigin(page, opts.approvedOrigin);
        } catch (err) {
          throw toFriendlyInteractionError(err, ref);
        }
        continue;
      }
      try {
        const previousUrl = page.url();
        await assertInteractionNavigationCompletedSafely({
          action: async () => {
            const approvedOperation = await withApprovedElementHandle({
              locator,
              approvedOrigin: opts.approvedOrigin,
              timeout,
              action: (handle) =>
                awaitActionWithAbort(
                  handle.fill(value, { timeout }),
                  abortPromise,
                  reconcileRemoteDialog,
                ),
            });
            if (!approvedOperation.approved) {
              await awaitActionWithAbort(
                locator.fill(value, { timeout }),
                abortPromise,
                reconcileRemoteDialog,
              );
            }
          },
          cdpUrl: opts.cdpUrl,
          page,
          previousUrl,
          ssrfPolicy: opts.ssrfPolicy,
          targetId: opts.targetId,
        });
        assertApprovedPageOrigin(page, opts.approvedOrigin);
      } catch (err) {
        throw toFriendlyInteractionError(err, ref);
      }
    }
  } finally {
    cleanup();
  }
}

/** Evaluates JavaScript in the page after browser action policy validation. */
export async function evaluateViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ssrfPolicy?: SsrFPolicy;
  fn: string;
  ref?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  approvedOrigin?: string;
}): Promise<unknown> {
  const fnText = normalizeOptionalString(opts.fn) ?? "";
  if (!fnText) {
    throw new Error("function is required");
  }
  const fnSource = normalizeBrowserEvaluateFunctionSource(
    fnText,
    opts.ref ? { argumentName: "el" } : undefined,
  );
  const page = await getRestoredPageForTarget(opts);
  // Clamp evaluate timeout to prevent permanently blocking Playwright's command queue.
  // Without this, a long-running async evaluate blocks all subsequent page operations
  // because Playwright serializes CDP commands per page.
  //
  // NOTE: Playwright's { timeout } on evaluate only applies to installing the function,
  // NOT to its execution time. We must inject a Promise.race timeout into the browser
  // context itself so async functions are bounded.
  const outerTimeout = normalizeTimeoutMs(opts.timeoutMs, 20_000);
  // Leave headroom for routing/serialization overhead so the outer request timeout
  // doesn't fire first and strand a long-running evaluate.
  let evaluateTimeout = Math.max(1000, Math.min(120_000, outerTimeout - 500));
  evaluateTimeout = Math.min(evaluateTimeout, outerTimeout);

  const signal = opts.signal;
  const { abortPromise, cleanup } = createAbortPromiseWithListener(signal, (reason) => {
    if (isBrowserObservedDialogBlockedError(reason)) {
      return;
    }
    void forceDisconnectPlaywrightForTarget({
      cdpUrl: opts.cdpUrl,
      targetId: opts.targetId,
      ssrfPolicy: opts.ssrfPolicy,
      reason: "evaluate aborted",
    }).catch(() => {});
  });
  if (signal?.aborted) {
    throw signal.reason ?? new Error("aborted");
  }

  try {
    const previousUrl = page.url();
    if (opts.ssrfPolicy) {
      await assertPageNavigationCompletedSafely({
        cdpUrl: opts.cdpUrl,
        page,
        response: null,
        ssrfPolicy: opts.ssrfPolicy,
        targetId: opts.targetId,
      });
    }

    if (opts.ref) {
      const locator = refLocator(page, opts.ref);
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- required for browser-context eval
      const elementEvaluator = new Function(
        "el",
        "args",
        `
        "use strict";
        var fnSource = args.fnSource, timeoutMs = args.timeoutMs, approvedOrigin = args.approvedOrigin;
        try {
          if (approvedOrigin && location.origin !== approvedOrigin) {
            throw new Error("Browser Steward approved origin changed before execution");
          }
          var candidate = eval("(" + fnSource + ")");
          if (typeof candidate !== "function") {
            throw new Error("evaluate source did not produce a function");
          }
          var result = candidate(el);
          if (result && typeof result.then === "function") {
            return Promise.race([
              result,
              new Promise(function(_, reject) {
                setTimeout(function() { reject(new Error("evaluate timed out after " + timeoutMs + "ms")); }, timeoutMs);
              })
            ]).then(function(value) {
              if (approvedOrigin && location.origin !== approvedOrigin) {
                throw new Error("Browser Steward approved origin changed before execution");
              }
              return value;
            });
          }
          if (approvedOrigin && location.origin !== approvedOrigin) {
            throw new Error("Browser Steward approved origin changed before execution");
          }
          return result;
        } catch (err) {
          throw new Error("Invalid evaluate function: " + (err && err.message ? err.message : String(err)));
        }
        `,
      ) as (
        el: Element,
        args: { fnSource: string; timeoutMs: number; approvedOrigin?: string },
      ) => unknown;
      const evalPromise = locator.evaluate(elementEvaluator, {
        fnSource,
        timeoutMs: evaluateTimeout,
        ...(opts.approvedOrigin ? { approvedOrigin: opts.approvedOrigin } : {}),
      });
      const reconcileRemoteDialog = () => reconcileRemoteDialogAfterActionSettled(page, signal);
      const result = await assertInteractionNavigationCompletedSafely({
        action: () => awaitActionWithAbort(evalPromise, abortPromise, reconcileRemoteDialog),
        cdpUrl: opts.cdpUrl,
        page,
        previousUrl,
        ssrfPolicy: opts.ssrfPolicy,
        targetId: opts.targetId,
      });
      assertApprovedPageOrigin(page, opts.approvedOrigin);
      return result;
    }

    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- required for browser-context eval
    const browserEvaluator = new Function(
      "args",
      `
        "use strict";
        var fnSource = args.fnSource, timeoutMs = args.timeoutMs, approvedOrigin = args.approvedOrigin;
        try {
          if (approvedOrigin && location.origin !== approvedOrigin) {
            throw new Error("Browser Steward approved origin changed before execution");
          }
          var candidate = eval("(" + fnSource + ")");
          if (typeof candidate !== "function") {
            throw new Error("evaluate source did not produce a function");
          }
          var result = candidate();
          if (result && typeof result.then === "function") {
            return Promise.race([
              result,
              new Promise(function(_, reject) {
                setTimeout(function() { reject(new Error("evaluate timed out after " + timeoutMs + "ms")); }, timeoutMs);
              })
            ]).then(function(value) {
              if (approvedOrigin && location.origin !== approvedOrigin) {
                throw new Error("Browser Steward approved origin changed before execution");
              }
              return value;
            });
          }
          if (approvedOrigin && location.origin !== approvedOrigin) {
            throw new Error("Browser Steward approved origin changed before execution");
          }
          return result;
        } catch (err) {
          throw new Error("Invalid evaluate function: " + (err && err.message ? err.message : String(err)));
        }
      `,
    ) as (args: { fnSource: string; timeoutMs: number; approvedOrigin?: string }) => unknown;
    const evalPromise = page.evaluate(browserEvaluator, {
      fnSource,
      timeoutMs: evaluateTimeout,
      ...(opts.approvedOrigin ? { approvedOrigin: opts.approvedOrigin } : {}),
    });
    const reconcileRemoteDialog = () => reconcileRemoteDialogAfterActionSettled(page, signal);
    const result = await assertInteractionNavigationCompletedSafely({
      action: () => awaitActionWithAbort(evalPromise, abortPromise, reconcileRemoteDialog),
      cdpUrl: opts.cdpUrl,
      page,
      previousUrl,
      ssrfPolicy: opts.ssrfPolicy,
      targetId: opts.targetId,
    });
    assertApprovedPageOrigin(page, opts.approvedOrigin);
    return result;
  } finally {
    cleanup();
  }
}

/** Scrolls a role ref or selector into view. */
export async function scrollIntoViewViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref?: string;
  selector?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  approvedOrigin?: string;
}): Promise<void> {
  const resolved = requireRefOrSelector(opts.ref, opts.selector);
  const page = await getRestoredPageForTarget(opts);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 20_000);

  const label = resolved.ref ?? resolved.selector!;
  const locator = resolved.ref
    ? refLocator(page, requireRef(resolved.ref))
    : page.locator(resolved.selector!);
  const { abortPromise, cleanup } = createAbortPromise(opts.signal);
  const reconcileRemoteDialog = () => reconcileRemoteDialogAfterActionSettled(page, opts.signal);
  try {
    assertApprovedPageOrigin(page, opts.approvedOrigin);
    await assertApprovedLocatorFrameOrigin({
      locator,
      approvedOrigin: opts.approvedOrigin,
      timeout,
    });
    await awaitActionWithAbort(
      locator.scrollIntoViewIfNeeded({ timeout }),
      abortPromise,
      reconcileRemoteDialog,
    );
    assertApprovedPageOrigin(page, opts.approvedOrigin);
  } catch (err) {
    throw toFriendlyInteractionError(err, label);
  } finally {
    cleanup();
  }
}

/** Waits for load state, timeout, URL, text, ref, or selector conditions. */
export async function waitForViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  timeMs?: number;
  text?: string;
  textGone?: string;
  selector?: string;
  url?: string;
  loadState?: "load" | "domcontentloaded" | "networkidle";
  fn?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  approvedOrigin?: string;
}): Promise<void> {
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  const timeout = resolveActWaitTimeoutMs(opts.timeoutMs);
  const { abortPromise, cleanup } = createAbortPromise(opts.signal);
  const reconcileRemoteDialog = () => reconcileRemoteDialogAfterActionSettled(page, opts.signal);
  const waitForStep = async <T>(step: () => Promise<T>) => {
    assertApprovedPageOrigin(page, opts.approvedOrigin);
    await awaitActionWithAbort(step(), abortPromise, reconcileRemoteDialog);
    assertApprovedPageOrigin(page, opts.approvedOrigin);
  };

  try {
    if (typeof opts.timeMs === "number" && Number.isFinite(opts.timeMs)) {
      await waitForStep(() =>
        page.waitForTimeout(
          resolveBoundedDelayMs(opts.timeMs, "wait timeMs", ACT_MAX_WAIT_TIME_MS),
        ),
      );
    }
    if (opts.text) {
      await waitForStep(() =>
        page.getByText(opts.text).first().waitFor({
          state: "visible",
          timeout,
        }),
      );
    }
    if (opts.textGone) {
      await waitForStep(() =>
        page.getByText(opts.textGone).first().waitFor({
          state: "hidden",
          timeout,
        }),
      );
    }
    if (opts.selector) {
      const selector = normalizeOptionalString(opts.selector) ?? "";
      if (selector) {
        await waitForStep(() =>
          page.locator(selector).first().waitFor({ state: "visible", timeout }),
        );
      }
    }
    if (opts.url) {
      const url = normalizeOptionalString(opts.url) ?? "";
      if (url) {
        await waitForStep(() => page.waitForURL(url, { timeout }));
      }
    }
    if (opts.loadState) {
      await waitForStep(() => page.waitForLoadState(opts.loadState, { timeout }));
    }
    if (opts.fn) {
      const fn = normalizeOptionalString(opts.fn) ?? "";
      if (fn) {
        await waitForStep(() =>
          page.waitForFunction(guardApprovedWaitFunction(fn, opts.approvedOrigin), { timeout }),
        );
      }
    }
  } finally {
    cleanup();
  }
}

/** Captures a screenshot from the target page or element. */
export async function takeScreenshotViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  ref?: string;
  element?: string;
  fullPage?: boolean;
  type?: "png" | "jpeg";
  timeoutMs?: number;
  approvedOrigin?: string;
}): Promise<{ buffer: Buffer }> {
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  await assertApprovedCaptureOrigin({ page, approvedOrigin: opts.approvedOrigin });
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  const type = opts.type ?? "png";
  if (opts.ref) {
    if (opts.fullPage) {
      throw new Error("fullPage is not supported for element screenshots");
    }
    const locator = refLocator(page, opts.ref);
    await assertApprovedCaptureOrigin({
      page,
      locator,
      approvedOrigin: opts.approvedOrigin,
    });
    const buffer = await locator.screenshot({ type, timeout: opts.timeoutMs });
    await assertApprovedCaptureOrigin({
      page,
      locator,
      approvedOrigin: opts.approvedOrigin,
    });
    return { buffer };
  }
  if (opts.element) {
    if (opts.fullPage) {
      throw new Error("fullPage is not supported for element screenshots");
    }
    const locator = page.locator(opts.element).first();
    await assertApprovedCaptureOrigin({
      page,
      locator,
      approvedOrigin: opts.approvedOrigin,
    });
    const buffer = await locator.screenshot({ type, timeout: opts.timeoutMs });
    await assertApprovedCaptureOrigin({
      page,
      locator,
      approvedOrigin: opts.approvedOrigin,
    });
    return { buffer };
  }
  const buffer = await page.screenshot({
    type,
    fullPage: Boolean(opts.fullPage),
    timeout: opts.timeoutMs,
  });
  await assertApprovedCaptureOrigin({ page, approvedOrigin: opts.approvedOrigin });
  return { buffer };
}

/** Captures a screenshot with Browser plugin labels over interactive elements. */
export async function screenshotWithLabelsViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  refs: Record<string, { role: string; name?: string; nth?: number }>;
  maxLabels?: number;
  type?: "png" | "jpeg";
  timeoutMs?: number;
  fullPage?: boolean;
  ref?: string;
  element?: string;
  approvedOrigin?: string;
}): Promise<{
  buffer: Buffer;
  labels: number;
  skipped: number;
  annotations: AnnotationItem[];
}> {
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  await assertApprovedCaptureOrigin({ page, approvedOrigin: opts.approvedOrigin });
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  const type = opts.type ?? "png";
  const maxLabels =
    typeof opts.maxLabels === "number" && Number.isFinite(opts.maxLabels)
      ? Math.max(1, Math.floor(opts.maxLabels))
      : ANNOTATION_MAX_LABELS_DEFAULT;

  const refKey = normalizeOptionalString(opts.ref) ?? undefined;
  const elementSelector = normalizeOptionalString(opts.element) ?? undefined;
  const captureLocator = refKey
    ? refLocator(page, refKey)
    : elementSelector
      ? page.locator(elementSelector).first()
      : undefined;
  if (captureLocator) {
    await assertApprovedCaptureOrigin({
      page,
      locator: captureLocator,
      approvedOrigin: opts.approvedOrigin,
    });
  }
  const space: CoordinateSpace = opts.fullPage
    ? "fullpage"
    : refKey || elementSelector
      ? "element"
      : "viewport";

  // Read scroll + viewport size. Scroll converts Playwright's viewport-space
  // boundingBoxes into document-space inputs; the viewport size lets the helper
  // restore the shipped `labelsSkipped` semantics by counting off-viewport refs
  // as skipped (in viewport capture mode).
  const view = await page.evaluate(() => ({
    x: window.scrollX || 0,
    y: window.scrollY || 0,
    width: window.innerWidth || 0,
    height: window.innerHeight || 0,
  }));
  const scroll = { x: view.x, y: view.y };

  let elementRect: { x: number; y: number; width: number; height: number } | undefined;
  if (space === "element") {
    const box = await resolveElementBoundingBoxForLabels(page, refKey, elementSelector);
    if (!box) {
      throw new Error(
        `screenshotWithLabelsViaPlaywright: element not found for ${
          refKey ? `ref="${refKey}"` : `selector="${elementSelector ?? ""}"`
        }`,
      );
    }
    // Convert viewport-space bbox to document space.
    elementRect = {
      x: box.x + scroll.x,
      y: box.y + scroll.y,
      width: box.width,
      height: box.height,
    };
  }

  const refKeys = Object.keys(opts.refs ?? {});
  const inputs: RawAnnotationInput[] = [];
  let bboxFailures = 0;
  for (const ref of refKeys) {
    const box = await refLocator(page, ref)
      .boundingBox()
      .catch(() => null);
    if (!box) {
      bboxFailures += 1;
      continue;
    }
    inputs.push({
      ref,
      role: opts.refs[ref].role,
      name: opts.refs[ref].name,
      doc: {
        x: box.x + scroll.x,
        y: box.y + scroll.y,
        width: box.width,
        height: box.height,
      },
    });
  }

  const plan = planAnnotations({
    inputs,
    space,
    scroll,
    viewport: { width: view.width, height: view.height },
    elementRect,
    maxLabels,
  });

  try {
    if (plan.overlayItems.length > 0) {
      const captureY = space === "element" ? elementRect?.y : space === "viewport" ? scroll.y : 0;
      await page.evaluate(buildOverlayInjectionScript({ items: plan.overlayItems, captureY }));
    }
    const buffer =
      space === "element"
        ? await captureElementScreenshotForLabels(
            page,
            refKey,
            elementSelector,
            type,
            opts.timeoutMs,
          )
        : await page.screenshot({
            type,
            fullPage: Boolean(opts.fullPage),
            timeout: opts.timeoutMs,
          });
    await assertApprovedCaptureOrigin({
      page,
      locator: captureLocator,
      approvedOrigin: opts.approvedOrigin,
    });
    return {
      // `labels` reports overlay boxes actually drawn on the captured image
      // (in-viewport, within budget); off-viewport refs are surfaced via
      // `annotations` but not drawn, and are reflected in `skipped`.
      buffer,
      labels: plan.overlayItems.length,
      skipped: plan.skipped + bboxFailures,
      annotations: plan.annotations,
    };
  } finally {
    await page.evaluate(buildOverlayClearScript()).catch(() => {});
  }
}

async function resolveElementBoundingBoxForLabels(
  page: Page,
  refKey: string | undefined,
  cssSelector: string | undefined,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  if (refKey) {
    try {
      return await refLocator(page, refKey).boundingBox();
    } catch {
      return null;
    }
  }
  if (cssSelector) {
    try {
      return await page.locator(cssSelector).first().boundingBox();
    } catch {
      return null;
    }
  }
  return null;
}

async function captureElementScreenshotForLabels(
  page: Page,
  refKey: string | undefined,
  cssSelector: string | undefined,
  type: "png" | "jpeg",
  timeoutMs: number | undefined,
): Promise<Buffer> {
  if (refKey) {
    return await refLocator(page, refKey).screenshot({ type, timeout: timeoutMs });
  }
  if (cssSelector) {
    return await page.locator(cssSelector).first().screenshot({ type, timeout: timeoutMs });
  }
  throw new Error("captureElementScreenshotForLabels: requires refKey or cssSelector");
}

/** Sets file inputs for a role ref or selector with strict existing-path checks. */
export async function setInputFilesViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  inputRef?: string;
  element?: string;
  paths: string[];
  approvedOrigin?: string;
}): Promise<void> {
  const page = await getPageForTargetId(opts);
  ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  if (!opts.paths.length) {
    throw new Error("paths are required");
  }
  const inputRef = normalizeOptionalString(opts.inputRef) ?? "";
  const element = normalizeOptionalString(opts.element) ?? "";
  if (inputRef && element) {
    throw new Error("inputRef and element are mutually exclusive");
  }
  if (!inputRef && !element) {
    throw new Error("inputRef or element is required");
  }

  const locator = inputRef ? refLocator(page, inputRef) : page.locator(element).first();
  const resolvedResult = await resolveStrictExistingUploadPaths({ requestedPaths: opts.paths });
  if (!resolvedResult.ok) {
    throw new Error(resolvedResult.error);
  }
  const resolvedPaths = resolvedResult.paths;

  try {
    assertApprovedPageOrigin(page, opts.approvedOrigin);
    await assertBrowserTargetOrigin(page, opts.approvedOrigin);
    if (opts.approvedOrigin) {
      const handle = await locator.elementHandle();
      const ownerFrame = handle ? await handle.ownerFrame() : null;
      await assertBrowserFrameOrigin(ownerFrame, opts.approvedOrigin);
      await handle!.setInputFiles(resolvedPaths);
    } else {
      await locator.setInputFiles(resolvedPaths);
    }
    assertApprovedPageOrigin(page, opts.approvedOrigin);
    await assertBrowserTargetOrigin(page, opts.approvedOrigin);
  } catch (err) {
    throw toFriendlyInteractionError(err, inputRef || element);
  }
  try {
    const handle = await locator.elementHandle();
    if (handle) {
      await handle.evaluate((el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
  } catch {
    // Best-effort for sites that don't react to setInputFiles alone.
  }
}

async function executeSingleAction(
  action: BrowserActRequest,
  cdpUrl: string,
  targetId?: string,
  evaluateEnabled?: boolean,
  ssrfPolicy?: SsrFPolicy,
  depth = 0,
  signal?: AbortSignal,
  approvedOrigin?: string,
): Promise<unknown> {
  if (depth > ACT_MAX_BATCH_DEPTH) {
    throw new Error(`Batch nesting depth exceeds maximum of ${ACT_MAX_BATCH_DEPTH}`);
  }
  const effectiveTargetId = action.targetId ?? targetId;
  const approvedPage = approvedOrigin
    ? await getPageForTargetId({
        cdpUrl,
        targetId: effectiveTargetId,
        ssrfPolicy,
      })
    : undefined;
  if (approvedOrigin) {
    await assertBrowserTargetOrigin(approvedPage!, approvedOrigin);
  }
  switch (action.kind) {
    case "click":
      await clickViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        ref: action.ref,
        selector: action.selector,
        doubleClick: action.doubleClick,
        button: action.button as "left" | "right" | "middle" | undefined,
        modifiers: action.modifiers as Array<
          "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift"
        >,
        delayMs: action.delayMs,
        timeoutMs: action.timeoutMs,
        ssrfPolicy,
        signal,
        approvedOrigin,
      });
      break;
    case "clickCoords":
      await clickCoordsViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        x: action.x,
        y: action.y,
        doubleClick: action.doubleClick,
        button: action.button as "left" | "right" | "middle" | undefined,
        delayMs: action.delayMs,
        timeoutMs: action.timeoutMs,
        ssrfPolicy,
        signal,
        approvedOrigin,
      });
      break;
    case "type":
      await typeViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        ref: action.ref,
        selector: action.selector,
        text: action.text,
        submit: action.submit,
        slowly: action.slowly,
        timeoutMs: action.timeoutMs,
        ssrfPolicy,
        signal,
        approvedOrigin,
      });
      break;
    case "press":
      await pressKeyViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        key: action.key,
        delayMs: action.delayMs,
        ssrfPolicy,
        signal,
        approvedOrigin,
      });
      break;
    case "hover":
      await hoverViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        ref: action.ref,
        selector: action.selector,
        timeoutMs: action.timeoutMs,
        signal,
        approvedOrigin,
      });
      break;
    case "scrollIntoView":
      await scrollIntoViewViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        ref: action.ref,
        selector: action.selector,
        timeoutMs: action.timeoutMs,
        signal,
        approvedOrigin,
      });
      break;
    case "drag":
      await dragViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        startRef: action.startRef,
        startSelector: action.startSelector,
        endRef: action.endRef,
        endSelector: action.endSelector,
        timeoutMs: action.timeoutMs,
        signal,
        approvedOrigin,
      });
      break;
    case "select":
      await selectOptionViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        ref: action.ref,
        selector: action.selector,
        values: action.values,
        timeoutMs: action.timeoutMs,
        ssrfPolicy,
        signal,
        approvedOrigin,
      });
      break;
    case "fill":
      await fillFormViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        fields: action.fields,
        timeoutMs: action.timeoutMs,
        ssrfPolicy,
        signal,
        approvedOrigin,
      });
      break;
    case "resize":
      await resizeViewportViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        width: action.width,
        height: action.height,
      });
      break;
    case "wait":
      if (action.fn && !evaluateEnabled) {
        throw new Error("wait --fn is disabled by config (browser.evaluateEnabled=false)");
      }
      await waitForViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        timeMs: action.timeMs,
        text: action.text,
        textGone: action.textGone,
        selector: action.selector,
        url: action.url,
        loadState: action.loadState,
        fn: action.fn,
        timeoutMs: action.timeoutMs,
        signal,
        approvedOrigin,
      });
      break;
    case "evaluate":
      if (!evaluateEnabled) {
        throw new Error("act:evaluate is disabled by config (browser.evaluateEnabled=false)");
      }
      return await evaluateViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        ssrfPolicy,
        fn: action.fn,
        ref: action.ref,
        timeoutMs: action.timeoutMs,
        signal,
        approvedOrigin,
      });
    case "close":
      await closePageViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        approvedOrigin,
      });
      break;
    case "batch":
      await batchViaPlaywright({
        cdpUrl,
        targetId: effectiveTargetId,
        ssrfPolicy,
        actions: action.actions,
        stopOnError: action.stopOnError,
        evaluateEnabled,
        depth: depth + 1,
        signal,
        approvedOrigin,
      });
      break;
    default:
      throw new Error(`Unsupported batch action kind: ${(action as { kind: string }).kind}`);
  }
  if (approvedOrigin) {
    await assertBrowserTargetOrigin(approvedPage!, approvedOrigin);
  }
  return undefined;
}

/** Executes one high-level browser act request with bounded recursive actions. */
export async function executeActViaPlaywright(opts: {
  cdpUrl: string;
  action: BrowserActRequest;
  targetId?: string;
  evaluateEnabled?: boolean;
  ssrfPolicy?: SsrFPolicy;
  approvedOrigin?: string;
  signal?: AbortSignal;
}): Promise<{
  result?: unknown;
  results?: Array<{ ok: boolean; error?: string }>;
  blockedByDialog?: boolean;
  browserState?: unknown;
}> {
  const page = await getPageForTargetId({
    cdpUrl: opts.cdpUrl,
    targetId: opts.targetId,
    ssrfPolicy: opts.ssrfPolicy,
  });
  const dialogAbort = createObservedDialogAbortSignalForPage({
    page,
    parentSignal: opts.signal,
    approvedOrigin: opts.approvedOrigin,
  });
  try {
    if (opts.action.kind === "batch") {
      const batch = await batchViaPlaywright({
        cdpUrl: opts.cdpUrl,
        targetId: opts.targetId,
        ssrfPolicy: opts.ssrfPolicy,
        actions: opts.action.actions,
        stopOnError: opts.action.stopOnError,
        evaluateEnabled: opts.evaluateEnabled,
        signal: dialogAbort.signal,
        approvedOrigin: opts.approvedOrigin,
      });
      return { results: batch.results };
    }
    const result = await executeSingleAction(
      opts.action,
      opts.cdpUrl,
      opts.targetId,
      opts.evaluateEnabled,
      opts.ssrfPolicy,
      0,
      dialogAbort.signal,
      opts.approvedOrigin,
    );
    if (opts.action.kind === "evaluate") {
      return { result };
    }
    return {};
  } catch (err) {
    if (isBrowserObservedDialogBlockedError(err)) {
      return { blockedByDialog: true, browserState: err.browserState };
    }
    throw err;
  } finally {
    dialogAbort.cleanup();
  }
}

/** Executes a bounded sequence of browser actions and returns per-step results. */
export async function batchViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  actions: BrowserActRequest[];
  stopOnError?: boolean;
  evaluateEnabled?: boolean;
  ssrfPolicy?: SsrFPolicy;
  approvedOrigin?: string;
  depth?: number;
  signal?: AbortSignal;
}): Promise<{ results: Array<{ ok: boolean; error?: string }> }> {
  const depth = opts.depth ?? 0;
  if (depth > ACT_MAX_BATCH_DEPTH) {
    throw new Error(`Batch nesting depth exceeds maximum of ${ACT_MAX_BATCH_DEPTH}`);
  }
  if (opts.actions.length > ACT_MAX_BATCH_ACTIONS) {
    throw new Error(`Batch exceeds maximum of ${ACT_MAX_BATCH_ACTIONS} actions`);
  }
  const results: Array<{ ok: boolean; error?: string }> = [];
  for (const action of opts.actions) {
    if (opts.signal?.aborted) {
      throw opts.signal.reason ?? new Error("aborted");
    }
    try {
      await executeSingleAction(
        action,
        opts.cdpUrl,
        opts.targetId,
        opts.evaluateEnabled,
        opts.ssrfPolicy,
        depth,
        opts.signal,
        opts.approvedOrigin,
      );
      results.push({ ok: true });
    } catch (err) {
      if (isBrowserObservedDialogBlockedError(err)) {
        throw err;
      }
      const message = opts.approvedOrigin
        ? "Browser Steward approved batch step failed"
        : formatErrorMessage(err);
      results.push({ ok: false, error: message });
      if (opts.stopOnError !== false) {
        break;
      }
    }
  }
  return { results };
}

function toLintErrorObject(value: unknown, fallbackMessage: string): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  const error = new Error(fallbackMessage, { cause: value });
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    Object.assign(error, value);
  }
  return error;
}
