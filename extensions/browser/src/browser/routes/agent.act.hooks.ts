/**
 * Browser agent action hook routes.
 *
 * Handles file chooser and dialog interception for both Playwright-backed
 * OpenClaw profiles and Chrome MCP existing-session profiles.
 */
import { formatErrorMessage } from "../../infra/errors.js";
import { readBrowserStewardApprovedOrigin } from "../browser-steward-transport.js";
import {
  evaluateChromeMcpScript,
  type ChromeMcpProfileOptions,
  uploadChromeMcpFile,
} from "../chrome-mcp.js";
import { resolveExistingUploadPaths } from "../paths.js";
import { getBrowserProfileCapabilities } from "../profile-capabilities.js";
import type { BrowserRouteContext } from "../server-context.js";
import {
  readBody,
  requirePwAi,
  resolveTargetIdFromBody,
  withRouteTabContext,
} from "./agent.shared.js";
import { EXISTING_SESSION_LIMITS } from "./existing-session-limits.js";
import { readRouteTimerTimeoutMs } from "./route-numeric.js";
import type { BrowserRouteRegistrar } from "./types.js";
import {
  asyncBrowserRoute,
  jsonError,
  toBoolean,
  toStringArray,
  toStringOrEmpty,
} from "./utils.js";

async function assertExistingSessionApprovedOrigin(params: {
  profileName: string;
  profile?: ChromeMcpProfileOptions;
  targetId: string;
  approvedOrigin: string;
}): Promise<void> {
  const currentUrl = await evaluateChromeMcpScript({
    profileName: params.profileName,
    profile: params.profile,
    targetId: params.targetId,
    fn: "() => window.location.href",
  });
  if (typeof currentUrl !== "string") {
    throw new Error("Location probe returned a non-string result");
  }
  let currentOrigin: string;
  try {
    currentOrigin = new URL(currentUrl.trim()).origin;
  } catch {
    throw new Error("Browser Steward approved origin could not be verified");
  }
  if (currentOrigin !== params.approvedOrigin) {
    throw new Error("Browser Steward approved origin changed before execution");
  }
}

async function assertExistingSessionApprovedElementOrigin(params: {
  profileName: string;
  profile?: ChromeMcpProfileOptions;
  targetId: string;
  uid: string;
  approvedOrigin: string;
}): Promise<void> {
  await assertExistingSessionApprovedOrigin(params);
  const targetOrigin = await evaluateChromeMcpScript({
    profileName: params.profileName,
    profile: params.profile,
    targetId: params.targetId,
    fn: "(el) => el?.ownerDocument?.location?.origin ?? null",
    args: [params.uid],
  });
  if (targetOrigin !== params.approvedOrigin) {
    throw new Error(
      "Browser Steward approved destination element frame origin could not be verified",
    );
  }
}

/** Register file chooser and dialog hook endpoints on the browser control server. */
export function registerBrowserAgentActHookRoutes(
  app: BrowserRouteRegistrar,
  ctx: BrowserRouteContext,
) {
  app.post(
    "/hooks/file-chooser",
    asyncBrowserRoute(async (req, res) => {
      const approvedOriginHeader = readBrowserStewardApprovedOrigin(req.headers);
      if (approvedOriginHeader.present && !approvedOriginHeader.origin) {
        return jsonError(res, 403, "Browser Steward approved origin is invalid");
      }
      const body = readBody(req);
      const targetId = resolveTargetIdFromBody(body);
      const ref = toStringOrEmpty(body.ref) || undefined;
      const inputRef = toStringOrEmpty(body.inputRef) || undefined;
      const element = toStringOrEmpty(body.element) || undefined;
      const paths = toStringArray(body.paths) ?? [];
      let timeoutMs: number | undefined;
      try {
        timeoutMs = readRouteTimerTimeoutMs(body.timeoutMs);
      } catch (err) {
        return jsonError(res, 400, formatErrorMessage(err));
      }
      if (!paths.length) {
        return jsonError(res, 400, "paths are required");
      }

      await withRouteTabContext({
        req,
        res,
        ctx,
        targetId,
        run: async ({ profileCtx, cdpUrl, tab }) => {
          const resolvedResult = await resolveExistingUploadPaths({ requestedPaths: paths });
          if (!resolvedResult.ok) {
            res.status(400).json({ error: resolvedResult.error });
            return;
          }
          const resolvedPaths = resolvedResult.paths;

          if (getBrowserProfileCapabilities(profileCtx.profile).usesChromeMcp) {
            if (element) {
              return jsonError(res, 501, EXISTING_SESSION_LIMITS.hooks.uploadElement);
            }
            if (resolvedPaths.length !== 1) {
              return jsonError(res, 501, EXISTING_SESSION_LIMITS.hooks.uploadSingleFile);
            }
            const uid = inputRef || ref;
            if (!uid) {
              return jsonError(res, 501, EXISTING_SESSION_LIMITS.hooks.uploadRefRequired);
            }
            if (approvedOriginHeader.origin) {
              await assertExistingSessionApprovedElementOrigin({
                profileName: profileCtx.profile.name,
                profile: profileCtx.profile,
                targetId: tab.targetId,
                uid,
                approvedOrigin: approvedOriginHeader.origin,
              });
            }
            await uploadChromeMcpFile({
              profileName: profileCtx.profile.name,
              profile: profileCtx.profile,
              targetId: tab.targetId,
              uid,
              filePath: resolvedPaths[0] ?? "",
            });
            return res.json({ ok: true });
          }

          const pw = await requirePwAi(res, "file chooser hook");
          if (!pw) {
            return;
          }

          if (inputRef || element) {
            if (ref) {
              return jsonError(res, 400, "ref cannot be combined with inputRef/element");
            }
            await pw.setInputFilesViaPlaywright({
              cdpUrl,
              targetId: tab.targetId,
              inputRef,
              element,
              paths: resolvedPaths,
              approvedOrigin: approvedOriginHeader.origin,
            });
          } else {
            await pw.armFileUploadViaPlaywright({
              cdpUrl,
              targetId: tab.targetId,
              paths: resolvedPaths,
              timeoutMs: timeoutMs ?? undefined,
              approvedOrigin: approvedOriginHeader.origin,
            });
            if (ref) {
              await pw.clickViaPlaywright({
                cdpUrl,
                targetId: tab.targetId,
                ssrfPolicy: ctx.state().resolved.ssrfPolicy,
                ref,
                approvedOrigin: approvedOriginHeader.origin,
              });
            }
          }
          res.json({ ok: true });
        },
      });
    }),
  );

  app.post(
    "/hooks/dialog",
    asyncBrowserRoute(async (req, res) => {
      const approvedOriginHeader = readBrowserStewardApprovedOrigin(req.headers);
      if (approvedOriginHeader.present && !approvedOriginHeader.origin) {
        return jsonError(res, 403, "Browser Steward approved origin is invalid");
      }
      const body = readBody(req);
      const targetId = resolveTargetIdFromBody(body);
      const accept = toBoolean(body.accept);
      const promptText = toStringOrEmpty(body.promptText) || undefined;
      let timeoutMs: number | undefined;
      try {
        timeoutMs = readRouteTimerTimeoutMs(body.timeoutMs);
      } catch (err) {
        return jsonError(res, 400, formatErrorMessage(err));
      }
      const dialogId = toStringOrEmpty(body.dialogId) || undefined;
      if (accept === undefined) {
        return jsonError(res, 400, "accept is required");
      }

      await withRouteTabContext({
        req,
        res,
        ctx,
        targetId,
        run: async ({ profileCtx, cdpUrl, tab }) => {
          if (getBrowserProfileCapabilities(profileCtx.profile).usesChromeMcp) {
            if (dialogId) {
              return jsonError(res, 501, EXISTING_SESSION_LIMITS.hooks.dialogId);
            }
            if (timeoutMs) {
              return jsonError(res, 501, EXISTING_SESSION_LIMITS.hooks.dialogTimeout);
            }
            if (approvedOriginHeader.origin) {
              await assertExistingSessionApprovedOrigin({
                profileName: profileCtx.profile.name,
                profile: profileCtx.profile,
                targetId: tab.targetId,
                approvedOrigin: approvedOriginHeader.origin,
              });
            }
            await evaluateChromeMcpScript({
              profileName: profileCtx.profile.name,
              profile: profileCtx.profile,
              targetId: tab.targetId,
              // Existing-session Chrome MCP has no dialog hook primitive. Patch
              // one-shot window dialog functions in-page, then restore them.
              fn: `() => {
              const approvedOrigin = ${JSON.stringify(approvedOriginHeader.origin ?? null)};
              const isApprovedOrigin = () =>
                !approvedOrigin || location.origin === approvedOrigin;
              const state = (window.__openclawDialogHook ??= {});
              if (!state.originals) {
                state.originals = {
                  alert: window.alert.bind(window),
                  confirm: window.confirm.bind(window),
                  prompt: window.prompt.bind(window),
                };
              }
              const originals = state.originals;
              const restore = () => {
                window.alert = originals.alert;
                window.confirm = originals.confirm;
                window.prompt = originals.prompt;
                delete window.__openclawDialogHook;
              };
              window.alert = (...args) => {
                try {
                  if (!isApprovedOrigin()) {
                    return undefined;
                  }
                  return undefined;
                } finally {
                  restore();
                }
              };
              window.confirm = (...args) => {
                try {
                  if (!isApprovedOrigin()) {
                    return false;
                  }
                  return ${accept ? "true" : "false"};
                } finally {
                  restore();
                }
              };
              window.prompt = (...args) => {
                try {
                  if (!isApprovedOrigin()) {
                    return null;
                  }
                  return ${accept ? JSON.stringify(promptText ?? "") : "null"};
                } finally {
                  restore();
                }
              };
              return true;
            }`,
            });
            return res.json({ ok: true });
          }
          const pw = await requirePwAi(res, "dialog hook");
          if (!pw) {
            return;
          }
          await pw.armDialogViaPlaywright({
            cdpUrl,
            targetId: tab.targetId,
            dialogId,
            accept,
            promptText,
            timeoutMs: timeoutMs ?? undefined,
            approvedOrigin: approvedOriginHeader.origin,
          });
          res.json({ ok: true });
        },
      });
    }),
  );
}
