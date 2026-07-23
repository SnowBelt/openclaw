import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { isPathInside } from "../infra/path-guards.js";
import { resolveUserPath } from "../utils.js";

export const SUBAGENT_TASK_ROOT_RECEIPT_SCHEMA_VERSION = 1 as const;

export type SubagentTaskRootReceipt = {
  schemaVersion: typeof SUBAGENT_TASK_ROOT_RECEIPT_SCHEMA_VERSION;
  source: "inherited" | "requested";
  scope: "task_root" | "descendant";
  fingerprint: string;
};

export type SubagentTaskRootResolution =
  | {
      ok: true;
      effectiveCwd?: string;
      receipt?: SubagentTaskRootReceipt;
    }
  | {
      ok: false;
      code: "task_root_unavailable" | "task_root_mismatch";
      error: string;
      receipt?: SubagentTaskRootReceipt;
    };

function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function receipt(params: {
  canonicalRoot: string;
  canonicalCandidate: string;
  requested: boolean;
}): SubagentTaskRootReceipt {
  return {
    schemaVersion: SUBAGENT_TASK_ROOT_RECEIPT_SCHEMA_VERSION,
    source: params.requested ? "requested" : "inherited",
    scope: params.canonicalCandidate === params.canonicalRoot ? "task_root" : "descendant",
    fingerprint: fingerprint(params.canonicalCandidate),
  };
}

async function canonicalDirectory(value: string): Promise<string | undefined> {
  try {
    const canonical = await fs.realpath(resolveUserPath(value));
    const stats = await fs.stat(canonical);
    return stats.isDirectory() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the one effective cwd inherited by native and ACP workers.
 *
 * The approved root comes from trusted runtime context, never model input. An
 * explicit cwd may narrow that root but cannot replace or escape it, including
 * through a symlink. Receipts intentionally expose only a stable fingerprint.
 */
export async function resolveSubagentTaskRoot(params: {
  approvedRoot?: string;
  requestedCwd?: string;
}): Promise<SubagentTaskRootResolution> {
  const approvedRoot = params.approvedRoot?.trim();
  const requestedCwd = params.requestedCwd?.trim();
  if (!approvedRoot) {
    return {
      ok: true,
      ...(requestedCwd ? { effectiveCwd: resolveUserPath(requestedCwd) } : {}),
    };
  }

  const canonicalRoot = await canonicalDirectory(approvedRoot);
  if (!canonicalRoot) {
    return {
      ok: false,
      code: "task_root_unavailable",
      error:
        "The approved task root is unavailable. Retry from an active task session or create a new managed session/worktree before spawning a worker.",
    };
  }

  const canonicalCandidate = requestedCwd ? await canonicalDirectory(requestedCwd) : canonicalRoot;
  if (!canonicalCandidate) {
    return {
      ok: false,
      code: "task_root_unavailable",
      error:
        "The requested worker directory is unavailable. Retry without cwd to inherit the approved task root, or create that directory inside the approved task root first.",
      receipt: receipt({
        canonicalRoot,
        canonicalCandidate: canonicalRoot,
        requested: false,
      }),
    };
  }

  if (!isPathInside(canonicalRoot, canonicalCandidate)) {
    return {
      ok: false,
      code: "task_root_mismatch",
      error:
        "The requested worker directory is outside the approved task root. Retry without cwd to inherit the approved root, or create a separately approved managed session/worktree for that directory.",
      receipt: receipt({
        canonicalRoot,
        canonicalCandidate: canonicalRoot,
        requested: false,
      }),
    };
  }

  return {
    ok: true,
    effectiveCwd: canonicalCandidate,
    receipt: receipt({
      canonicalRoot,
      canonicalCandidate,
      requested: Boolean(requestedCwd),
    }),
  };
}
