export type SelfImprovementAutonomyTier =
  | "observe"
  | "recommend"
  | "approved_administrative"
  | "bounded_sandbox";

export type SelfImprovementAutonomyOperation =
  | "read_health"
  | "record_signal"
  | "create_recommendation"
  | "draft_proof"
  | "attach_proof"
  | "update_record_status"
  | "retention_maintenance"
  | "write_local_artifact"
  | "run_bounded_test"
  | "modify_source"
  | "modify_config"
  | "write_memory_or_skill"
  | "access_credentials"
  | "release_or_github"
  | "external_write"
  | "funds_or_trading";

export type SelfImprovementAutonomyDecision = {
  allowed: boolean;
  tier: SelfImprovementAutonomyTier;
  operation: SelfImprovementAutonomyOperation;
  reason: string;
  requiresExplicitApproval: boolean;
  requiresSandbox: boolean;
};

const ALWAYS_BLOCKED = new Set<SelfImprovementAutonomyOperation>([
  "modify_source",
  "modify_config",
  "write_memory_or_skill",
  "access_credentials",
  "release_or_github",
  "external_write",
  "funds_or_trading",
]);

const TIER_OPERATIONS: Record<
  SelfImprovementAutonomyTier,
  ReadonlySet<SelfImprovementAutonomyOperation>
> = {
  observe: new Set(["read_health"]),
  recommend: new Set(["read_health", "record_signal", "create_recommendation", "draft_proof"]),
  approved_administrative: new Set([
    "read_health",
    "record_signal",
    "create_recommendation",
    "draft_proof",
    "attach_proof",
    "update_record_status",
    "retention_maintenance",
  ]),
  bounded_sandbox: new Set([
    "read_health",
    "record_signal",
    "create_recommendation",
    "draft_proof",
    "write_local_artifact",
    "run_bounded_test",
  ]),
};

export function evaluateSelfImprovementAutonomy(params: {
  tier?: SelfImprovementAutonomyTier;
  operation: SelfImprovementAutonomyOperation;
  explicitApproval?: boolean;
  sandboxed?: boolean;
}): SelfImprovementAutonomyDecision {
  const tier = params.tier ?? "recommend";
  const requiresExplicitApproval = tier === "approved_administrative" || tier === "bounded_sandbox";
  const requiresSandbox = tier === "bounded_sandbox";
  if (ALWAYS_BLOCKED.has(params.operation)) {
    return {
      allowed: false,
      tier,
      operation: params.operation,
      reason: "SIG is not a control authority for this operation.",
      requiresExplicitApproval: true,
      requiresSandbox: params.operation === "modify_source" || requiresSandbox,
    };
  }
  if (!TIER_OPERATIONS[tier].has(params.operation)) {
    return {
      allowed: false,
      tier,
      operation: params.operation,
      reason: `Operation is outside the ${tier} autonomy tier.`,
      requiresExplicitApproval,
      requiresSandbox,
    };
  }
  if (requiresExplicitApproval && params.explicitApproval !== true) {
    return {
      allowed: false,
      tier,
      operation: params.operation,
      reason: "This tier requires explicit scoped operator approval.",
      requiresExplicitApproval: true,
      requiresSandbox,
    };
  }
  if (requiresSandbox && params.sandboxed !== true) {
    return {
      allowed: false,
      tier,
      operation: params.operation,
      reason: "Bounded execution requires an isolated sandbox.",
      requiresExplicitApproval: true,
      requiresSandbox: true,
    };
  }
  return {
    allowed: true,
    tier,
    operation: params.operation,
    reason: `Operation is allowed within the ${tier} tier.`,
    requiresExplicitApproval,
    requiresSandbox,
  };
}

export function assertSelfImprovementAutonomy(
  params: Parameters<typeof evaluateSelfImprovementAutonomy>[0],
): void {
  const decision = evaluateSelfImprovementAutonomy(params);
  if (!decision.allowed) {
    throw new Error(`Self-Improvement autonomy denied ${params.operation}: ${decision.reason}`);
  }
}
