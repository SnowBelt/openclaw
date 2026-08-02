export type ResearchMode = "certified" | "best-effort";

export type ResearchModelRole =
  | "planner"
  | "scout"
  | "researcher"
  | "verifier"
  | "critic"
  | "finalizer";

export type ResearchThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ResearchModelSpec = {
  id: string;
  provider: string;
  model: string;
  authProfileId?: string;
  roles: ResearchModelRole[];
  remote: boolean;
  memoryGb: number;
  contextTokens: number;
  maxParallel: number;
  thinking?: ResearchThinkingLevel;
  qualificationScore: number;
  enabled: boolean;
  exclusive: boolean;
};

export type ResearchRunStatus =
  | "queued"
  | "planning"
  | "retrieving"
  | "researching"
  | "verifying"
  | "finalizing"
  | "certifying"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type ResearchPlan = {
  objective: string;
  questions: Array<{
    id: string;
    question: string;
    priority: "required" | "important" | "optional";
  }>;
  queries: Array<{
    query: string;
    questionIds: string[];
    freshnessDays?: number;
    preferredSourceTypes: string[];
  }>;
  sourceRequirements: string[];
  riskLevel: "normal" | "high";
  stopConditions: string[];
};

export type ResearchSource = {
  id: string;
  query: string;
  matchedQueries?: string[];
  url: string;
  finalUrl?: string;
  domain: string;
  title: string;
  snippet: string;
  content?: string;
  publishedAt?: string;
  retrievedAt: string;
  searchProvider: string;
  sourceType: "primary" | "secondary" | "unknown";
  contentType?: string;
  fetchStatus: "search-only" | "fetched" | "rejected" | "failed";
  contentSha256?: string;
  promptInjectionSignals?: string[];
  rejectionReason?: string;
};

export type ResearchClaim = {
  id: string;
  questionId: string;
  text: string;
  sourceIds: string[];
  evidence: Array<{
    sourceId: string;
    quote: string;
    supports: boolean;
  }>;
  confidence: number;
  material: boolean;
  status: "proposed" | "verified" | "disputed" | "unsupported";
  contradiction?: string;
};

export type ResearchFinding = {
  workerId: string;
  role: ResearchModelRole;
  questionIds: string[];
  summary: string;
  claims: ResearchClaim[];
  gaps: string[];
};

export type ResearchModelAttempt = {
  id: string;
  role: ResearchModelRole;
  modelId: string;
  provider: string;
  model: string;
  startedAt: string;
  endedAt: string;
  status: "succeeded" | "failed" | "timed-out" | "cancelled" | "skipped";
  fallbackReason?: string;
  error?: string;
  local: boolean;
  reservedMemoryGb: number;
  durationMs?: number;
  thinkingRequested?: ResearchModelSpec["thinking"];
  thinkingUsed?: ResearchModelSpec["thinking"];
  outputRepair?: "closed-containers" | "empty-arrays" | "closed-containers+empty-arrays";
  tokenUsage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  costUsd?: number;
};

export type ResearchPlanProvenance = {
  modelId: string;
  provider: string;
  model: string;
  generatedAt: string;
  planSha256: string;
  sourceRunId?: string;
};

export type ResearchRunMetrics = {
  wallTimeMs: number;
  localCallShare: number;
  fallbackCount: number;
  tokenUsage: {
    local: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    remote: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
  costCoverage: "not-applicable" | "unavailable" | "partial" | "complete";
  reportedCostUsd?: number;
};

export type CertificationDimension = {
  id:
    | "correctness"
    | "completeness"
    | "sourceQuality"
    | "citationEntailment"
    | "freshness"
    | "contradictionHandling"
    | "calibration";
  score: number;
  weight: number;
  notes: string[];
};

export type ResearchCertification = {
  threshold: number;
  score: number;
  certified: boolean;
  hardGateFailures: string[];
  dimensions: CertificationDimension[];
  evaluatedAt: string;
};

export type ResearchRunReport = {
  runId: string;
  replayedFromRunId?: string;
  query: string;
  mode: ResearchMode;
  status: ResearchRunStatus;
  answer?: string;
  usedClaimIds?: string[];
  limitations?: string[];
  plan?: ResearchPlan;
  planProvenance?: ResearchPlanProvenance;
  sources: ResearchSource[];
  claims: ResearchClaim[];
  findings: ResearchFinding[];
  researchUnitFindings?: ResearchFinding[];
  certification?: ResearchCertification;
  attempts: ResearchModelAttempt[];
  gaps: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  blockedReason?: string;
  failure?: string;
  repairPasses: number;
  localModelCalls: number;
  remoteModelCalls: number;
  stageStartedAt?: string;
  stageTimingsMs?: Partial<Record<ResearchRunStatus, number>>;
  metrics?: ResearchRunMetrics;
};

export type ResearchRunRequest = {
  query: string;
  mode?: ResearchMode;
  highStakes?: boolean;
  maxSources?: number;
  deadlineMs?: number;
  runId?: string;
};
