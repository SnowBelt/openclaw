export type SubagentSpawnRecommendedAction = {
  code:
    | "inherit_task_root"
    | "retry_allowed_agent"
    | "wait_or_cancel_child"
    | "delegate_from_parent"
    | "correct_and_retry"
    | "report_blocker";
  instruction: string;
};

/** Return one action that never depends on a tool the failed caller may not have. */
export function resolveSubagentSpawnRecommendedAction(
  error: string | undefined,
): SubagentSpawnRecommendedAction {
  const normalized = error?.toLowerCase() ?? "";
  if (normalized.includes("task root") || normalized.includes("cwd")) {
    return {
      code: "inherit_task_root",
      instruction:
        "Retry sessions_spawn without cwd to inherit the approved task root, or request a separately approved managed session/worktree.",
    };
  }
  if (
    normalized.includes("agentid") ||
    normalized.includes("agent id") ||
    normalized.includes("configured agent registry") ||
    normalized.includes("cannot delegate") ||
    normalized.includes("allowed configured role")
  ) {
    return {
      code: "retry_allowed_agent",
      instruction:
        "Retry sessions_spawn with one of the allowed agent ids named in the error; if none are listed, report the configuration blocker to the parent.",
    };
  }
  if (normalized.includes("max active children")) {
    return {
      code: "wait_or_cancel_child",
      instruction:
        "Wait for an active child to finish or cancel one through the parent, then retry sessions_spawn once.",
    };
  }
  if (normalized.includes("not allowed at this depth")) {
    return {
      code: "delegate_from_parent",
      instruction: "Return the assignment to the parent so it can spawn the next worker directly.",
    };
  }
  if (
    normalized.includes("handoff") ||
    normalized.includes("cannot accept") ||
    normalized.includes("mutation-requiring")
  ) {
    return {
      code: "correct_and_retry",
      instruction:
        "Correct the handoff kind or mutation requirement named in the error, then retry sessions_spawn once with the same scope.",
    };
  }
  if (
    normalized.includes("requires") ||
    normalized.includes("invalid") ||
    normalized.includes("unsupported")
  ) {
    return {
      code: "correct_and_retry",
      instruction:
        "Correct the reported input, then retry sessions_spawn once without changing scope.",
    };
  }
  return {
    code: "report_blocker",
    instruction:
      "Report this exact sanitized error to the parent as a blocker; do not retry the unchanged request.",
  };
}

export function addSubagentSpawnRecommendedAction<T extends { status: string; error?: string }>(
  result: T,
): T | (T & { recommendedAction: SubagentSpawnRecommendedAction }) {
  if (result.status !== "error" && result.status !== "forbidden") {
    return result;
  }
  return {
    ...result,
    recommendedAction: resolveSubagentSpawnRecommendedAction(result.error),
  };
}
