// Two-step action guard prevents accidental runtime mutations from the
// Operations Room. Tokens are process-local, single-use, and short-lived.
import crypto from "node:crypto";
import type { OperationsActionKind, OperationsActionPreview } from "./types.js";

const PREVIEW_TTL_MS = 60_000;
const MAX_PENDING_PREVIEWS = 200;

const pending = new Map<string, OperationsActionPreview>();

function prune(now = Date.now()): void {
  for (const [token, preview] of pending) {
    if (preview.expiresAt <= now) {
      pending.delete(token);
    }
  }
  if (pending.size <= MAX_PENDING_PREVIEWS) {
    return;
  }
  for (const token of [...pending.keys()].slice(0, pending.size - MAX_PENDING_PREVIEWS)) {
    pending.delete(token);
  }
}

function actionSummary(action: OperationsActionKind, targetId: string): string {
  switch (action) {
    case "cron.run":
      return `Run scheduled workflow ${targetId} now.`;
    case "cron.enable":
      return `Enable scheduled workflow ${targetId}.`;
    case "cron.disable":
      return `Pause scheduled workflow ${targetId}.`;
    case "remediation.investigate":
      return `Investigate Operations Room issue ${targetId} with local AI and an independent safety review.`;
    case "remediation.apply":
      return `Apply the independently reviewed Operations Room repair ${targetId}.`;
    case "task.cancel":
      return `Cancel task ${targetId}.`;
    case "flow.cancel":
      return `Cancel workflow ${targetId}.`;
  }
  return assertNeverAction(action);
}

function assertNeverAction(action: never): never {
  throw new Error(`Unsupported Operations Room action: ${String(action)}`);
}

export function createOperationsActionPreview(params: {
  action: OperationsActionKind;
  targetId: string;
  summary?: string;
  risk?: OperationsActionPreview["risk"];
  now?: number;
}): OperationsActionPreview {
  const now = params.now ?? Date.now();
  prune(now);
  const preview: OperationsActionPreview = {
    token: crypto.randomUUID(),
    action: params.action,
    targetId: params.targetId,
    summary: params.summary ?? actionSummary(params.action, params.targetId),
    risk:
      params.risk ??
      (params.action === "cron.run" || params.action === "remediation.apply" ? "medium" : "high"),
    expiresAt: now + PREVIEW_TTL_MS,
    requiresConfirmation: true,
  };
  pending.set(preview.token, preview);
  return preview;
}

export function consumeOperationsActionPreview(params: {
  token: string;
  action: OperationsActionKind;
  targetId: string;
  now?: number;
}): OperationsActionPreview | null {
  const now = params.now ?? Date.now();
  prune(now);
  const preview = pending.get(params.token);
  pending.delete(params.token);
  if (
    !preview ||
    preview.expiresAt <= now ||
    preview.action !== params.action ||
    preview.targetId !== params.targetId
  ) {
    return null;
  }
  return preview;
}

export function resetOperationsActionPreviewsForTests(): void {
  pending.clear();
}
