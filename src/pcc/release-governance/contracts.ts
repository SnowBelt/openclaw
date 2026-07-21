export const RELEASE_GOVERNOR_POLICY_SCHEMA = "openclaw.release-governor-policy.v1" as const;
export const RELEASE_EVIDENCE_SCHEMA = "openclaw.release-evidence.v1" as const;
export const RELEASE_GOVERNANCE_STATUS_SCHEMA = "openclaw.release-governance-status.v1" as const;

export type ReleaseRiskLevel = "P0" | "P1" | "P2" | "P3";
export type ReleaseOperation = "stage" | "promotion" | "restart" | "rollback" | "finalize";
export type ReleaseDecision = "authorize" | "deny" | "escalate";
export type ReleaseApprovalMode = "automatic" | "exact" | "bounded_grant" | "none";
export type ReleaseCheckStatus = "passed" | "failed" | "pending" | "blocked" | "not_applicable";
export type ReleaseCapabilityChange =
  | "unchanged"
  | "added"
  | "removed"
  | "modified"
  | "weakened"
  | "unknown";
export type ReleaseReviewRole =
  | "release_governor"
  | "judge"
  | "control_director"
  | "telemetry_evaluation_analyst"
  | "program_manager";
export type ReleaseReviewDecision = "approve" | "deny" | "escalate";

export type ReleaseClassificationRule = {
  pattern: string;
  category: string;
  risk: ReleaseRiskLevel;
};

export type ReleaseProtectedPathRule = {
  pattern: string;
  reason: string;
};

export type ReleaseGovernorPolicy = {
  schema: typeof RELEASE_GOVERNOR_POLICY_SCHEMA;
  version: number;
  confidenceThreshold: number;
  reviewConfidenceThreshold: number;
  classificationRules: ReleaseClassificationRule[];
  protectedPaths: ReleaseProtectedPathRule[];
  requiredChecks: Record<ReleaseOperation, string[]>;
  healthThresholds: {
    maxRouteLatencyMs: number;
    maxErrorRate: number;
    maxStartupFailures: number;
    maxBrowserErrors: number;
  };
};

export type ReleaseProtectedPathFinding = {
  path: string;
  pattern: string;
  reason: string;
};

export type ReleaseCapabilityDiffEntry = {
  id: string;
  change: ReleaseCapabilityChange;
  required: boolean;
  reason: string;
};

export type ReleaseChangeClassification = {
  candidateSha: string;
  parentSha: string;
  changedFiles: string[];
  semanticCategories: string[];
  protectedPaths: ReleaseProtectedPathFinding[];
  capabilityDiff: ReleaseCapabilityDiffEntry[];
  riskLevel: ReleaseRiskLevel;
  externalDisclosure: boolean;
  externalDestination: string | null;
  requiredChecks: string[];
  approvalRequired: boolean;
  ambiguous: boolean;
  explanation: string[];
  confidence: number;
  policyVersion: number;
};

export type ReleaseCheck = {
  id: string;
  status: ReleaseCheckStatus;
  summary: string;
  command?: string;
  count?: number;
  url?: string;
  artifact?: string;
  recordedAt: string;
};

export type ReleaseReview = {
  role: ReleaseReviewRole;
  reviewerId: string;
  decision: ReleaseReviewDecision;
  confidence: number;
  summary: string;
  evidenceIds: string[];
  reviewedAt: string;
};

export type ReleaseExactApproval = {
  id: string;
  approvingUser: string;
  repository: string;
  branch: string;
  candidateSha: string;
  destination: string;
  operations: ReleaseOperation[];
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
};

export type ReleaseApprovalGrant = {
  id: string;
  approvingUser: string;
  project: string;
  repository: string;
  branch: string;
  approvedBaseSha: string;
  destination: string;
  allowedChangeClasses: string[];
  forbiddenPaths: string[];
  maximumRisk: "P2" | "P3";
  expiresAt: string;
  maximumDescendantDepth: number;
  maximumCommitCount: number;
  receiptId: string;
  grantedAt: string;
  revokedAt?: string;
};

export type ReleaseCandidateFacts = {
  project: string;
  candidateSha: string;
  parentSha: string;
  branch: string;
  repository: string;
  destination: string | null;
  changedFiles: string[];
  externalDisclosure: boolean;
  ancestorShas: string[];
  descendantDepth: number;
  commitCount: number;
  scopeCoordinationMaterial: boolean;
};

export type ReleaseApprovalEvaluation = {
  mode: ReleaseApprovalMode;
  approvalId: string | null;
  approvalScope: string | null;
  reason: string;
};

export type ReleaseHealthSample = {
  gatewayConnected: boolean;
  routes: Array<{ path: string; status: number; latencyMs: number }>;
  errorRate: number;
  startupFailures: number;
  missingCapabilities: string[];
  desktopBrowserErrors: number;
  mobileBrowserErrors: number;
  activeRunsReconciled: boolean;
  serviceWorkerIntegrity: "passed" | "failed" | "not_applicable";
};

export type ReleaseHealthDecision = {
  passed: boolean;
  deterministicRollbackTrigger: boolean;
  blockers: string[];
};

export type ReleasePolicyDecision = {
  operation: ReleaseOperation;
  decision: ReleaseDecision;
  approvalMode: ReleaseApprovalMode;
  requiredReviewRoles: ReleaseReviewRole[];
  blockers: string[];
  warnings: string[];
  exactApprovalWording: string | null;
  confidence: number;
  policyVersion: number;
};

export type ReleaseGovernorInput = {
  operation: ReleaseOperation;
  facts: ReleaseCandidateFacts;
  activeCapabilityManifest: unknown;
  candidateCapabilityManifest: unknown;
  requiredCapabilityIds: string[];
  checks: ReleaseCheck[];
  reviews: ReleaseReview[];
  exactApprovals: ReleaseExactApproval[];
  approvalGrants: ReleaseApprovalGrant[];
  health?: ReleaseHealthSample;
  rollbackAuthorized: boolean;
  now: string;
};

export type ReleaseGovernorEvaluation = {
  classification: ReleaseChangeClassification;
  capabilityDiff: ReleaseCapabilityDiffEntry[];
  health: ReleaseHealthDecision | null;
  decision: ReleasePolicyDecision;
};

export type ReleaseEvidenceBundleInput = {
  evaluation: ReleaseGovernorEvaluation;
  facts: ReleaseCandidateFacts;
  branch: string;
  sourceRepository: string;
  destination: string | null;
  diffSummary: string;
  checks: ReleaseCheck[];
  reviews: ReleaseReview[];
  approvals: Array<ReleaseExactApproval | ReleaseApprovalGrant>;
  healthSample: ReleaseHealthSample | null;
  rollbackAuthorized: boolean;
  workflowSanity: Array<{ runId: string; url: string; headSha: string; conclusion: string }>;
  build: {
    buildInfoPath: string;
    buildStamp: string;
    artifactHashes: Record<string, string>;
  };
  runtime: {
    openclawVersion: string;
    gatewayVersion: string;
    activeRuntimeSha: string | null;
    candidateRuntimeSha: string;
  };
  deployment: {
    deployedAt: string | null;
    rollbackTarget: string | null;
    stageResult: string | null;
    promotionResult: string | null;
    restartResult: string | null;
    postDeploymentHealth: ReleaseHealthDecision | null;
  };
  browserProof: {
    desktop: string | null;
    mobile: string | null;
    consoleErrors: number;
  };
  ledger: {
    projectId: string;
    milestoneId: string;
    ready: boolean;
  };
  createdAt: string;
};

export type ReleaseEvidenceBundle = ReleaseEvidenceBundleInput & {
  schema: typeof RELEASE_EVIDENCE_SCHEMA;
  receiptHash: string;
};

export type ReleaseGovernanceStatus = {
  schema: typeof RELEASE_GOVERNANCE_STATUS_SCHEMA;
  policyVersion: number;
  candidateSha: string | null;
  activeRuntimeSha: string | null;
  riskLevel: ReleaseRiskLevel | null;
  protectedPaths: ReleaseProtectedPathFinding[];
  capabilityDiff: ReleaseCapabilityDiffEntry[];
  checks: ReleaseCheck[];
  approvalStatus: ReleaseApprovalMode;
  approvalScope: string | null;
  reviews: ReleaseReview[];
  rollbackTarget: string | null;
  decision: ReleaseDecision | "none";
  evidenceReceiptHash: string | null;
  evidencePath: string | null;
  exactBlocker: string | null;
  approvalWording: string | null;
  updatedAt: string;
};
