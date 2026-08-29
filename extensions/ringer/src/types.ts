export const RINGER_COMMIT = "a1a91b8b384a90dcca379e1cb9ab91405275ac46";
export const RINGER_SCRIPT_SHA256 =
  "6cf07c6603a2ca36ea6061b0cf199c571a489b0032f3e6ee9d48227acb0fbb99";
export const RINGER_SCHEMA_VERSION = 1 as const;

export type RingerRole = "code" | "clerical" | "analysis" | "critic";

export type RingerModelPolicy = {
  ref: string;
  contextWindow: number;
  maxTokens: number;
  roles: RingerRole[];
  canaryApproved: boolean;
};

export type RingerRepositoryPolicy = {
  root: string;
  checkArgvPrefixes: string[][];
  models: RingerModelPolicy[];
};

export type ResolvedRingerConfig = {
  enabled: boolean;
  productionEnabled: boolean;
  ringerSourceDir?: string;
  expectedRingerCommit: string;
  expectedRingerSha256: string;
  ringerConfigPath?: string;
  expectedRingerConfigSha256?: string;
  openclawCliPath?: string;
  ollamaBaseUrl: string;
  dockerHost?: string;
  dockerImage: string;
  expectedDockerImageSha256?: string;
  expectedOpenclawCliSha256?: string;
  expectedOpenclawVersion?: string;
  expectedWorkerSha256?: string;
  expectedVerifierSha256?: string;
  qualificationReceiptPath?: string;
  expectedQualificationReceiptSha256?: string;
  expectedPolicySha256?: string;
  stateDir: string;
  callerSecret?: unknown;
  maxParallel: number;
  maxTasks: number;
  maxPatchBytes: number;
  maxSnapshotBytes: number;
  maxSnapshotStorageBytes: number;
  rawRetentionDays: number;
  receiptRetentionDays: number;
  minFreeMemoryBytesForTwoWorkers: number;
  allowedRepositories: RingerRepositoryPolicy[];
};

export type RingerCallerAuth = {
  nonce: string;
  expiresAt: string;
  digest: string;
  signature: string;
};

export type RingerPrepareRequest = {
  repo: string;
  expectedHeadSha: string;
  includeUntrackedPaths?: string[];
  auth: RingerCallerAuth;
};

export type RingerSnapshotReceipt = {
  snapshotId: string;
  repo: string;
  shadowRepo: string;
  baseSha: string;
  sourceSha: string;
  workspaceDigest: string;
  overlaySha256: string;
  includedUntrackedPaths: string[];
  excludedPaths: string[];
  createdAt: string;
  expiresAt: string;
};

type RingerBaselineExpectation = "pass" | "fail";

export type RingerTaskManifest = {
  key: string;
  spec: string;
  engine: "openclaw-local";
  model: string;
  task_type: RingerRole;
  allowed_paths: string[];
  expected_outputs: string[];
  check_argv: string[];
  baseline_expect: RingerBaselineExpectation;
  must_change: boolean;
  verified: string;
  timeout_s: number;
  max_attempts: 1 | 2;
  full_access: false;
  redact_spec: boolean;
};

export type RingerAdapterManifest = {
  schema_version: typeof RINGER_SCHEMA_VERSION;
  run_name: string;
  repo: string;
  snapshot_id: string;
  source_sha: string;
  source_digest: string;
  check_digest: string;
  environment_digest: string;
  workdir: string;
  worktrees: true;
  max_parallel: number;
  tasks: RingerTaskManifest[];
};

export type RingerRunAction = "lint" | "dry_run" | "baseline" | "start";

export type RingerRunRequest = {
  action: RingerRunAction;
  manifestPath: string;
  expectedManifestSha256: string;
  snapshotId: string;
  expectedSourceSha: string;
  /** Execute a bounded qualification canary while production routing remains disabled. */
  qualification?: boolean;
  auth: RingerCallerAuth;
};

export type RingerCancelRequest = {
  runId: string;
  auth: RingerCallerAuth;
};

export type RingerTaskReceipt = {
  key: string;
  status: "queued" | "running" | "pass" | "fail" | "interrupted";
  attempts: number;
  model: string;
  artifactDir: string;
  sessionAttempts?: number;
  modelCompletions?: number;
  sessionRetries?: number;
};

export type RingerRunReceipt = {
  runId: string;
  nativeRunId?: string;
  runName: string;
  manifestSha256: string;
  snapshotId: string;
  sourceSha: string;
  pid?: number;
  status: "queued" | "running" | "pass" | "fail" | "cancelled" | "interrupted";
  action: RingerRunAction;
  runKind?: "qualification-canary" | "production";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  logPath: string;
  tasks: RingerTaskReceipt[];
};

export type RingerPinStatus = {
  ok: boolean;
  errors: string[];
  actual: {
    ringerCommit?: string;
    ringerSha256?: string;
    configSha256?: string;
    dockerImageSha256?: string;
    openclawCliSha256?: string;
    openclawVersion?: string;
    workerSha256: string;
    verifierSha256: string;
    policySha256: string;
  };
};
