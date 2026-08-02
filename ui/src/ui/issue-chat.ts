import type { AppViewState } from "./app-view-state.ts";
import { createSessionAndRefresh } from "./controllers/sessions.ts";

export type IssueChatSource = "operations" | "pcc";

export type IssueChatDescriptor = {
  source: IssueChatSource;
  sourceId: string;
  title: string;
  detail: string;
  impact: string;
  owner: string;
  recommendedAction: string;
  projectId?: string;
};

export function issueChatKey(descriptor: Pick<IssueChatDescriptor, "source" | "sourceId">): string {
  return `${descriptor.source}:${descriptor.sourceId}`;
}

function compactLabel(value: string, max = 72): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function issueChatLabel(descriptor: IssueChatDescriptor): string {
  const prefix = descriptor.source === "pcc" ? "PCC" : "Operations";
  return `${prefix} · ${compactLabel(descriptor.title, 64)}`;
}

export function issueChatPrompt(descriptor: IssueChatDescriptor): string {
  const sourceLabel = descriptor.source === "pcc" ? "PCC" : "Operations Room";
  return [
    `You are handling a ${sourceLabel} issue. This chat is the canonical linked workspace for this issue.`,
    "",
    `Issue: ${descriptor.title}`,
    `Issue ID: ${descriptor.sourceId}`,
    `What happened: ${descriptor.detail}`,
    `Impact: ${descriptor.impact}`,
    `Owner: ${descriptor.owner}`,
    `Recommended next step: ${descriptor.recommendedAction}`,
    "",
    "Start with a read-only diagnosis. State the root cause, exact proposed change, risk, verification plan, and rollback plan before any consequential mutation.",
    "Use deterministic checks first, local AI for investigation when appropriate, and an independent local Judge review for any proposed repair. Do not claim a fix until verification evidence is recorded.",
  ].join("\n");
}

/** Creates one named, context-rich issue chat and sends its first prompt immediately. */
export async function startIssueChat(
  state: AppViewState,
  descriptor: IssueChatDescriptor,
): Promise<string | null> {
  return createSessionAndRefresh(
    state as unknown as Parameters<typeof createSessionAndRefresh>[0],
    {
      label: issueChatLabel(descriptor),
      ...(descriptor.projectId ? { projectId: descriptor.projectId } : {}),
      message: issueChatPrompt(descriptor),
    },
  );
}
