/**
 * Narrow type-only contract for session metadata patches.
 *
 * The runtime validator remains `SessionsPatchParamsSchema`; the colocated type
 * test prevents this lightweight hook dependency from drifting from that schema.
 */
export type SessionsPatchParams = {
  key: string;
  agentId?: string;
  label?: string | null;
  category?: string | null;
  archived?: boolean;
  pinned?: boolean;
  unread?: boolean;
  thinkingLevel?: string | null;
  fastMode?: boolean | "auto" | null;
  verboseLevel?: string | null;
  traceLevel?: string | null;
  reasoningLevel?: string | null;
  responseUsage?: "off" | "tokens" | "full" | "on" | null;
  elevatedLevel?: string | null;
  execHost?: string | null;
  execSecurity?: string | null;
  execAsk?: string | null;
  execNode?: string | null;
  model?: string | null;
  expectedModelOverrideIsFallback?: true;
  projectId?: string | null;
  spawnedBy?: string | null;
  spawnedWorkspaceDir?: string | null;
  spawnedCwd?: string | null;
  spawnDepth?: number | null;
  subagentRole?: "orchestrator" | "leaf" | null;
  subagentControlScope?: "children" | "none" | null;
  inheritedToolAllow?: string[] | null;
  inheritedToolDeny?: string[] | null;
  sendPolicy?: "allow" | "deny" | null;
  groupActivation?: "mention" | "always" | null;
};
