import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_VIDEO_ID = "01";
export const PATTERN_LAB_MEDIA_ROUTE_PREFIX = "/__openclaw__/pattern-lab-media";
const PATTERN_LAB_YOUTUBE_ROOT_ENV = "OPENCLAW_PATTERN_LAB_YOUTUBE_ROOT";
const PATTERN_LAB_SYSTEM_CERTIFICATION_RELATIVE_PATH =
  "local-output/operations/system-certification-current.json";
const CUSTOM_RUNTIME_POINTER_ENV = "OPENCLAW_CUSTOM_RUNTIME_POINTER";
const MAX_SYSTEM_CERTIFICATION_BYTES = 16 * 1024 * 1024;
const FFMPEG_DURATION_EXTENSIONS = new Set([".mp3", ".mp4", ".mov", ".m4a"]);
const PUBLIC_MEDIA_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".mp3", ".mp4"]);
const FFPROBE_CANDIDATES = ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"];

export const PATTERN_LAB_ASSET_TYPES = [
  "image",
  "thumbnail",
  "voiceover",
  "proof_footage",
  "video",
  "short",
] as const;

export type PatternLabAssetType = (typeof PATTERN_LAB_ASSET_TYPES)[number];

export type PatternLabFileInfo = {
  path: string;
  repoPath: string;
  mediaPath: string;
  mediaUrl: string;
  exists: boolean;
  sizeBytes: number;
  durationSeconds: number | null;
};

export type PatternLabApprovalSummary = {
  total: number;
  approved: number;
  pending: number;
  complete: boolean;
};

export type PatternLabPerformanceCard = {
  label: string;
  value: string;
  why: string;
};

export type PatternLabPerformanceState = {
  path: string;
  repoPath: string;
  rows: Record<string, string>[];
  cards: PatternLabPerformanceCard[];
  decisionLabel: string;
  nextAction: string;
  commentsSignalSummary: string;
  requiredExports: string[];
  decisionLabels: string[];
};

export type PatternLabSystemCertification = {
  state: "certified" | "blocked" | "stale" | "missing";
  systemReady: boolean;
  operationalStatus: "awaiting_owner" | "blocked";
  generatedAt: string | null;
  receiptPath: string;
  receiptSha256: string | null;
  activeReleaseId: string | null;
  activeSourceSha: string | null;
  runtimeClosureSha256: string | null;
  drawThingsCertified: boolean;
  preservationCertified: boolean;
  failedChecks: string[];
  blockers: string[];
};

export type PatternLabReadinessStep = {
  label: string;
  complete: boolean;
  detail: string;
};

export type PatternLabAssetReviewAction =
  | "approve"
  | "approve_private_upload"
  | "approve_public_publish"
  | "reject"
  | "regenerate"
  | "repair"
  | "revise_hook"
  | "kill_topic"
  | "status";

export type PatternLabAssetReviewDecision = {
  action: PatternLabAssetReviewAction;
  assetType: PatternLabAssetType;
  videoId?: unknown;
  assetId?: string;
  filename?: string;
  reason?: string;
  source?: string;
};

export type PatternLabAssetReviewDecisionResult = {
  videoId: string;
  action: PatternLabAssetReviewAction;
  assetType: PatternLabAssetType;
  rowsMatched: number;
  statusWritten: string;
  queuePath?: string;
  repairResult?: Record<string, unknown>;
  snapshot: PatternLabDashboardSnapshot;
};

export type PatternLabDashboardSnapshot = {
  generatedAt: string;
  videoId: string;
  channelName: string;
  status: "owner-review-required" | "private-upload-ready";
  publicPublish: "blocked_until_explicit_owner_approval";
  outputRoot: string;
  approvals: Record<PatternLabAssetType, PatternLabApprovalSummary>;
  blockers: string[];
  readinessSteps: PatternLabReadinessStep[];
  media: {
    longForm: PatternLabFileInfo;
    voiceover: PatternLabFileInfo;
    shorts: PatternLabFileInfo[];
    thumbnails: PatternLabFileInfo[];
    reviewPacket: PatternLabFileInfo;
    readinessReport: PatternLabFileInfo;
  };
  performance: PatternLabPerformanceState;
  systemCertification: PatternLabSystemCertification;
  nextActions: string[];
};

type CsvTable = {
  headers: string[];
  rows: Record<string, string>[];
};

let cachedPatternLabYoutubeRoot: string | null = null;
let cachedFfprobeExecutable: string | null = null;
const ffprobeDurationCache = new Map<
  string,
  { durationSeconds: number | null; mtimeMs: number; size: number }
>();

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function sha256File(filePath: string): string {
  const digest = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY);
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      digest.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return digest.digest("hex");
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : [];
}

function defaultSystemCertification(
  receiptPath: string,
  state: PatternLabSystemCertification["state"],
  blocker: string,
): PatternLabSystemCertification {
  return {
    state,
    systemReady: false,
    operationalStatus: "blocked",
    generatedAt: null,
    receiptPath,
    receiptSha256: null,
    activeReleaseId: null,
    activeSourceSha: null,
    runtimeClosureSha256: null,
    drawThingsCertified: false,
    preservationCertified: false,
    failedChecks: [],
    blockers: [blocker],
  };
}

function readPatternLabSystemCertification(youtubeRoot: string): PatternLabSystemCertification {
  const receiptPath = path.join(youtubeRoot, PATTERN_LAB_SYSTEM_CERTIFICATION_RELATIVE_PATH);
  if (!fs.existsSync(receiptPath)) {
    return defaultSystemCertification(
      receiptPath,
      "missing",
      "Current system certification is missing.",
    );
  }
  try {
    const receiptInfo = fs.lstatSync(receiptPath);
    if (
      !receiptInfo.isFile() ||
      receiptInfo.isSymbolicLink() ||
      receiptInfo.size <= 0 ||
      receiptInfo.size > MAX_SYSTEM_CERTIFICATION_BYTES
    ) {
      return defaultSystemCertification(
        receiptPath,
        "blocked",
        "Current system certification receipt is unsafe.",
      );
    }
    const receipt = jsonRecord(JSON.parse(fs.readFileSync(receiptPath, "utf8")));
    if (!receipt || receipt.schema !== "patternlab.system-certification.v1") {
      return defaultSystemCertification(
        receiptPath,
        "blocked",
        "Current system certification schema is invalid.",
      );
    }
    const identity = jsonRecord(receipt.active_runtime) ?? {};
    const checks = Array.isArray(receipt.checks)
      ? receipt.checks.map(jsonRecord).filter((row): row is Record<string, unknown> => row !== null)
      : [];
    const checkPassed = (name: string) =>
      checks.some((row) => row.name === name && row.status === "pass");
    const pointerPath = path.resolve(
      process.env[CUSTOM_RUNTIME_POINTER_ENV]?.trim() ||
        path.join(process.env.HOME || "", ".openclaw-custom-runtime", "active-runtime.json"),
    );
    const pointerInfo = fs.lstatSync(pointerPath);
    if (!pointerInfo.isFile() || pointerInfo.isSymbolicLink()) {
      return defaultSystemCertification(
        receiptPath,
        "stale",
        "Active runtime pointer is unavailable for certification verification.",
      );
    }
    const pointer = jsonRecord(JSON.parse(fs.readFileSync(pointerPath, "utf8")));
    const activeReleaseId = typeof identity.release_id === "string" ? identity.release_id : null;
    const activeSourceSha = typeof identity.source_sha === "string" ? identity.source_sha : null;
    const runtimeClosureSha256 =
      typeof identity.runtime_closure_sha256 === "string" ? identity.runtime_closure_sha256 : null;
    const currentIdentity =
      pointer?.releaseId === activeReleaseId && pointer?.sourceSha === activeSourceSha;
    const failedChecks = stringArray(receipt.failed_checks);
    const contractPassed =
      receipt.status === "pass" &&
      receipt.system_ready === true &&
      receipt.operational_status === "awaiting_owner" &&
      failedChecks.length === 0 &&
      checks.length > 0 &&
      checks.every((row) => row.status === "pass");
    const drawThingsCertified = checkPassed("draw_things_generation_certification");
    const preservationCertified = checkPassed("unrelated_dirty_state_exact_preservation");
    const blockers: string[] = [];
    if (!currentIdentity) {
      blockers.push("System certification does not match the active runtime.");
    }
    if (!contractPassed) {
      blockers.push("System certification has one or more failed checks.");
    }
    if (!drawThingsCertified) {
      blockers.push("Draw Things candidate certification is not current.");
    }
    if (!preservationCertified) {
      blockers.push("Unrelated-state preservation proof is not current.");
    }
    const certified =
      currentIdentity && contractPassed && drawThingsCertified && preservationCertified;
    return {
      state: certified ? "certified" : currentIdentity ? "blocked" : "stale",
      systemReady: certified,
      operationalStatus: certified ? "awaiting_owner" : "blocked",
      generatedAt: typeof receipt.generated_at === "string" ? receipt.generated_at : null,
      receiptPath,
      receiptSha256: sha256File(receiptPath),
      activeReleaseId,
      activeSourceSha,
      runtimeClosureSha256,
      drawThingsCertified,
      preservationCertified,
      failedChecks,
      blockers,
    };
  } catch {
    return defaultSystemCertification(
      receiptPath,
      "blocked",
      "Current system certification could not be verified.",
    );
  }
}

function pushUniquePath(candidates: string[], candidate: string) {
  const normalized = path.resolve(candidate);
  if (!candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

function addAncestorYoutubeRootCandidates(candidates: string[], anchor: string, maxDepth = 8) {
  let current = path.resolve(anchor);
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    pushUniquePath(candidates, path.join(current, "youtube-v1"));
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

const PATTERN_LAB_WORKSPACE_LAYOUTS = ["OpenClaw", "PatternLabRuntime"] as const;

type PatternLabYoutubeRootResolutionOptions = {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  moduleDirectory?: string;
  currentDirectory?: string;
};

function collectPatternLabYoutubeRootCandidates(
  options: PatternLabYoutubeRootResolutionOptions = {},
): string[] {
  const candidates: string[] = [];
  const env = options.env ?? process.env;
  const configuredRoot = env[PATTERN_LAB_YOUTUBE_ROOT_ENV]?.trim();
  if (configuredRoot) {
    pushUniquePath(candidates, configuredRoot);
  }
  const homeDirectory = options.homeDirectory ?? os.homedir();
  for (const workspaceDirectory of PATTERN_LAB_WORKSPACE_LAYOUTS) {
    pushUniquePath(candidates, path.join(homeDirectory, workspaceDirectory, "youtube-v1"));
  }
  addAncestorYoutubeRootCandidates(candidates, options.moduleDirectory ?? MODULE_DIR);
  addAncestorYoutubeRootCandidates(candidates, options.currentDirectory ?? process.cwd());
  return candidates;
}

function usablePatternLabYoutubeRoot(candidate: string): string | null {
  try {
    const rootInfo = fs.lstatSync(candidate);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      return null;
    }
    const real = fs.realpathSync(candidate);
    fs.accessSync(real, fs.constants.R_OK);
    const localOutput = path.join(real, "local-output");
    const operations = path.join(localOutput, "operations");
    if (!fs.statSync(localOutput).isDirectory() || !fs.statSync(operations).isDirectory()) {
      return null;
    }
    return real;
  } catch {
    return null;
  }
}

function patternLabYoutubeRootMissingMessage(): string {
  return `Pattern Lab youtube-v1 root not found. Set ${PATTERN_LAB_YOUTUBE_ROOT_ENV} to the YouTube workspace, or keep youtube-v1 under the OpenClaw repo root.`;
}

function resetPatternLabYoutubeRootCacheForTests(): void {
  cachedPatternLabYoutubeRoot = null;
}

export function normalizePatternLabVideoId(videoId: unknown = DEFAULT_VIDEO_ID): string {
  const normalized =
    typeof videoId === "string" && videoId.trim() ? videoId.trim() : DEFAULT_VIDEO_ID;
  if (!/^[0-9][0-9a-z_-]{0,31}$/i.test(normalized)) {
    throw new Error(`Invalid Pattern Lab video id: ${String(videoId)}`);
  }
  return normalized;
}

export function isPatternLabAssetType(value: unknown): value is PatternLabAssetType {
  return PATTERN_LAB_ASSET_TYPES.includes(value as PatternLabAssetType);
}

export function normalizePatternLabAssetType(value: unknown): PatternLabAssetType {
  if (!isPatternLabAssetType(value)) {
    throw new Error(`Unsupported Pattern Lab asset type: ${String(value)}`);
  }
  return value;
}

export function resolvePatternLabYoutubeRoot(
  options: PatternLabYoutubeRootResolutionOptions = {},
): string {
  const useCache = Object.keys(options).length === 0;
  if (useCache && cachedPatternLabYoutubeRoot) {
    return cachedPatternLabYoutubeRoot;
  }
  const env = options.env ?? process.env;
  const configuredRoot = env[PATTERN_LAB_YOUTUBE_ROOT_ENV]?.trim();
  if (configuredRoot) {
    const configuredReal = usablePatternLabYoutubeRoot(configuredRoot);
    if (configuredReal) {
      if (useCache) {
        cachedPatternLabYoutubeRoot = configuredReal;
      }
      return configuredReal;
    }
    throw new Error(
      `Configured Pattern Lab youtube-v1 root is unavailable or missing its local-output/operations layout.`,
    );
  }
  const candidates = collectPatternLabYoutubeRootCandidates(options);
  for (const candidate of candidates) {
    const real = usablePatternLabYoutubeRoot(candidate);
    if (real) {
      if (useCache) {
        cachedPatternLabYoutubeRoot = real;
      }
      return real;
    }
  }
  throw new Error(patternLabYoutubeRootMissingMessage());
}

export function resolvePatternLabOutputRoot(videoId: unknown = DEFAULT_VIDEO_ID): string {
  const normalizedVideoId = normalizePatternLabVideoId(videoId);
  return path.join(resolvePatternLabYoutubeRoot(), "local-output", `video-${normalizedVideoId}`);
}

function toRepoPath(youtubeRoot: string, absolutePath: string): string {
  return path.posix.join(
    "youtube-v1",
    path.relative(youtubeRoot, absolutePath).split(path.sep).join("/"),
  );
}

function patternLabPythonExecutable(youtubeRoot: string): string {
  const venvPython = path.join(youtubeRoot, ".venv-youtube", "bin", "python");
  return fs.existsSync(venvPython) ? venvPython : "python3";
}

async function processPatternLabRepairQueue(params: {
  videoId: string;
  eventId: string;
}): Promise<Record<string, unknown>> {
  const youtubeRoot = resolvePatternLabYoutubeRoot();
  const script = path.join(youtubeRoot, "scripts", "process_repair_queue.py");
  const { stdout } = await execFileAsync(
    patternLabPythonExecutable(youtubeRoot),
    [script, "--video-id", params.videoId, "--limit", "1", "--event-id", params.eventId],
    {
      cwd: path.dirname(youtubeRoot),
      timeout: 15 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  try {
    return JSON.parse(stdout);
  } catch {
    return { rawOutput: stdout.trim() };
  }
}

function toYoutubeRelativePath(youtubeRoot: string, absolutePath: string): string {
  return path.relative(youtubeRoot, absolutePath).split(path.sep).join("/");
}

function mediaUrlForPath(mediaPath: string): string {
  return `${PATTERN_LAB_MEDIA_ROUTE_PREFIX}?path=${encodeURIComponent(mediaPath)}`;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function parseCsv(raw: string): CsvTable {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = parseCsvLine(lines[0] ?? "");
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
  return { headers, rows };
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function writeCsv(filePath: string, table: CsvTable) {
  const lines = [
    table.headers.map(escapeCsvCell).join(","),
    ...table.rows.map((row) =>
      table.headers.map((header) => escapeCsvCell(row[header] ?? "")).join(","),
    ),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function readCsvTable(filePath: string): CsvTable {
  if (!fs.existsSync(filePath)) {
    return { headers: [], rows: [] };
  }
  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

function readLedger(outputRoot: string): CsvTable {
  return readCsvTable(path.join(outputRoot, "rights-ledger.csv"));
}

function ensureLedgerReviewColumns(table: CsvTable) {
  if (!table.headers.includes("human_review_status")) {
    throw new Error("Pattern Lab rights ledger is missing human_review_status column");
  }
}

function appendJsonl(filePath: string, entry: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

function compactOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

function rowMatchesAssetDecision(
  row: Record<string, string>,
  decision: PatternLabAssetReviewDecision,
) {
  if (row.asset_type !== decision.assetType) {
    return false;
  }
  const assetId = compactOptionalText(decision.assetId);
  const filename = compactOptionalText(decision.filename);
  if (assetId && row.asset_id !== assetId) {
    return false;
  }
  if (filename && row.filename !== filename) {
    return false;
  }
  return true;
}

function reviewStatusForAction(action: PatternLabAssetReviewAction): string {
  if (action === "approve") {
    return "approved";
  }
  if (action === "reject") {
    return "rejected";
  }
  if (action === "regenerate") {
    return "regeneration_requested";
  }
  if (action === "repair") {
    return "repair_requested";
  }
  return "pending";
}

async function ffprobeDurationSeconds(filePath: string, stat?: fs.Stats): Promise<number | null> {
  const fileStat =
    stat ??
    (() => {
      try {
        return fs.statSync(filePath);
      } catch {
        return null;
      }
    })();
  if (!fileStat) {
    return null;
  }
  const cached = ffprobeDurationCache.get(filePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.durationSeconds;
  }
  const candidates = cachedFfprobeExecutable
    ? [
        cachedFfprobeExecutable,
        ...FFPROBE_CANDIDATES.filter((candidate) => candidate !== cachedFfprobeExecutable),
      ]
    : FFPROBE_CANDIDATES;
  for (const ffprobe of candidates) {
    try {
      const { stdout } = await execFileAsync(
        ffprobe,
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          filePath,
        ],
        { timeout: 5000 },
      );
      const value = Number(stdout.trim());
      const durationSeconds = Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
      cachedFfprobeExecutable = ffprobe;
      ffprobeDurationCache.set(filePath, {
        durationSeconds,
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
      });
      return durationSeconds;
    } catch {
      // Try the next ffprobe candidate.
    }
  }
  ffprobeDurationCache.set(filePath, {
    durationSeconds: null,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
  });
  return null;
}

async function fileInfo(params: {
  youtubeRoot: string;
  outputRoot: string;
  relativeToOutput: string;
}): Promise<PatternLabFileInfo> {
  const absolutePath = path.join(params.outputRoot, params.relativeToOutput);
  let stat: fs.Stats | null;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    stat = null;
  }
  const exists = Boolean(stat);
  const mediaPath = toYoutubeRelativePath(params.youtubeRoot, absolutePath);
  const durationSeconds =
    FFMPEG_DURATION_EXTENSIONS.has(path.extname(absolutePath).toLowerCase()) && exists
      ? await ffprobeDurationSeconds(absolutePath, stat ?? undefined)
      : null;
  return {
    path: path.posix.join(
      "local-output",
      path.basename(params.outputRoot),
      params.relativeToOutput,
    ),
    repoPath: toRepoPath(params.youtubeRoot, absolutePath),
    mediaPath,
    mediaUrl: mediaUrlForPath(mediaPath),
    exists,
    sizeBytes: stat?.size ?? 0,
    durationSeconds,
  };
}

function approvalSummary(
  rows: Record<string, string>[],
): Record<PatternLabAssetType, PatternLabApprovalSummary> {
  const summary = {} as Record<PatternLabAssetType, PatternLabApprovalSummary>;
  for (const assetType of PATTERN_LAB_ASSET_TYPES) {
    const typed = rows.filter((row) => row.asset_type === assetType);
    const approved = typed.filter((row) => row.human_review_status === "approved").length;
    summary[assetType] = {
      total: typed.length,
      approved,
      pending: Math.max(0, typed.length - approved),
      complete: typed.length > 0 && approved === typed.length,
    };
  }
  return summary;
}

function parseReadinessBlockers(outputRoot: string): string[] {
  const report = path.join(outputRoot, "approval", "private-upload-readiness.md");
  if (!fs.existsSync(report)) {
    return [];
  }
  const lines = fs.readFileSync(report, "utf8").split(/\r?\n/);
  const start = lines.indexOf("## Blockers");
  if (start < 0) {
    return [];
  }
  const blockers: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    if (line.startsWith("- ")) {
      const blocker = line.slice(2).trim();
      if (!/^Human review approval is missing for asset type:/i.test(blocker)) {
        blockers.push(blocker);
      }
    }
  }
  return blockers;
}

function computedApprovalBlockers(
  approvals: Record<PatternLabAssetType, PatternLabApprovalSummary>,
): string[] {
  return PATTERN_LAB_ASSET_TYPES.filter((assetType) => !approvals[assetType].complete).map(
    (assetType) => `Human review approval is missing for asset type: ${assetType}.`,
  );
}

function metricValue(row: Record<string, string> | undefined, key: string, suffix = ""): string {
  const value = row?.[key]?.trim();
  return value ? `${value}${suffix}` : "pending";
}

function buildPerformanceState(
  youtubeRoot: string,
  outputRoot: string,
  videoId: string,
): PatternLabPerformanceState {
  const metricsPath = path.join(outputRoot, "metrics", `video-${videoId}-performance.csv`);
  const table = readCsvTable(metricsPath);
  const longForm = table.rows.find((row) => row.surface === "long-form") ?? table.rows[0];
  const short = table.rows.find((row) => row.surface === "short");
  return {
    path: toYoutubeRelativePath(youtubeRoot, metricsPath),
    repoPath: toRepoPath(youtubeRoot, metricsPath),
    rows: table.rows,
    cards: [
      { label: "Views", value: metricValue(longForm, "views"), why: "Top-of-funnel demand." },
      {
        label: "CTR",
        value: metricValue(longForm, "ctr_percent", "%"),
        why: "Title-thumbnail promise strength.",
      },
      {
        label: "30s retention",
        value: metricValue(longForm, "retention_30s_percent", "%"),
        why: "Hook and proof speed.",
      },
      {
        label: "Avg viewed",
        value: metricValue(longForm, "average_percentage_viewed", "%"),
        why: "Overall pacing and payoff.",
      },
      {
        label: "Subs",
        value: metricValue(longForm, "subscribers_gained"),
        why: "Audience-channel fit.",
      },
      {
        label: "RPM",
        value: metricValue(longForm, "rpm_usd"),
        why: "Monetization quality.",
      },
      {
        label: "Shorts viewed",
        value: metricValue(short, "shorts_viewed_percent", "%"),
        why: "First-frame and swipe resistance.",
      },
      {
        label: "Related clicks",
        value: metricValue(short, "related_video_clicks"),
        why: "Short-to-long conversion.",
      },
    ],
    decisionLabel: longForm?.decision_label || "pending_publish",
    nextAction: longForm?.next_action || "Record first performance metrics.",
    commentsSignalSummary: longForm?.comments_signal_summary || "",
    requiredExports: [
      "24h long-form overview: views, impressions, CTR, average view duration, retention.",
      "24h Shorts overview: viewed vs swiped, average percentage viewed, related-video clicks.",
      "7d long-form and Shorts comparison.",
      "Revenue/RPM once monetization data exists.",
    ],
    decisionLabels: ["double_down", "repackage", "revise_hook", "retire_topic"],
  };
}

function readinessSteps(snapshot: {
  approvals: Record<PatternLabAssetType, PatternLabApprovalSummary>;
  media: PatternLabDashboardSnapshot["media"];
  blockers: string[];
}): PatternLabReadinessStep[] {
  const shortsReady = snapshot.media.shorts.filter((item) => item.exists).length;
  const thumbnailsReady = snapshot.media.thumbnails.filter((item) => item.exists).length;
  return [
    {
      label: "Long-form",
      complete: snapshot.media.longForm.exists,
      detail: snapshot.media.longForm.exists
        ? "Draft video is present."
        : "Draft video is missing.",
    },
    {
      label: "Voice",
      complete: snapshot.media.voiceover.exists,
      detail: snapshot.media.voiceover.exists
        ? "Normalized voiceover is present."
        : "Voiceover is missing.",
    },
    {
      label: "Shorts",
      complete: shortsReady >= 3,
      detail: `${shortsReady}/3 Shorts present.`,
    },
    {
      label: "Thumbnails",
      complete: thumbnailsReady >= 2,
      detail: `${thumbnailsReady}/2 thumbnail candidates present.`,
    },
    {
      label: "Approvals",
      complete: PATTERN_LAB_ASSET_TYPES.every((type) => snapshot.approvals[type].complete),
      detail: `${PATTERN_LAB_ASSET_TYPES.filter((type) => snapshot.approvals[type].complete).length}/${PATTERN_LAB_ASSET_TYPES.length} asset groups approved.`,
    },
    {
      label: "Blockers",
      complete: snapshot.blockers.length === 0,
      detail: `${snapshot.blockers.length} blocker${snapshot.blockers.length === 1 ? "" : "s"} open.`,
    },
  ];
}

export async function loadPatternLabDashboardSnapshot(params?: {
  videoId?: unknown;
}): Promise<PatternLabDashboardSnapshot> {
  const videoId = normalizePatternLabVideoId(params?.videoId);
  const youtubeRoot = resolvePatternLabYoutubeRoot();
  const outputRoot = path.join(youtubeRoot, "local-output", `video-${videoId}`);
  const ledger = readLedger(outputRoot);
  const approvals = approvalSummary(ledger.rows);
  const media = {
    longForm: await fileInfo({
      youtubeRoot,
      outputRoot,
      relativeToOutput: `video/pattern-lab-video-${videoId}-draft.mp4`,
    }),
    voiceover: await fileInfo({
      youtubeRoot,
      outputRoot,
      relativeToOutput: "audio/voiceover_full_normalized.mp3",
    }),
    shorts: await Promise.all(
      [1, 2, 3].map((index) =>
        fileInfo({
          youtubeRoot,
          outputRoot,
          relativeToOutput: `shorts/pattern-lab-video-${videoId}-short-${String(index).padStart(2, "0")}.mp4`,
        }),
      ),
    ),
    thumbnails: await Promise.all(
      ["thumbnail_candidate_a.png", "thumbnail_candidate_b.png"].map((filename) =>
        fileInfo({
          youtubeRoot,
          outputRoot,
          relativeToOutput: `images/${filename}`,
        }),
      ),
    ),
    reviewPacket: await fileInfo({
      youtubeRoot,
      outputRoot,
      relativeToOutput: "review/owner-review-packet.md",
    }),
    readinessReport: await fileInfo({
      youtubeRoot,
      outputRoot,
      relativeToOutput: "approval/private-upload-readiness.md",
    }),
  };
  const blockers = [...computedApprovalBlockers(approvals), ...parseReadinessBlockers(outputRoot)];
  const partial = { approvals, media, blockers };
  const steps = readinessSteps(partial);
  const readyForPrivate = blockers.length === 0 && steps.every((step) => step.complete);
  return {
    generatedAt: utcNow(),
    videoId,
    channelName: "Pattern Lab",
    status: readyForPrivate ? "private-upload-ready" : "owner-review-required",
    publicPublish: "blocked_until_explicit_owner_approval",
    outputRoot: `youtube-v1/local-output/video-${videoId}`,
    approvals,
    blockers,
    readinessSteps: steps,
    media,
    performance: buildPerformanceState(youtubeRoot, outputRoot, videoId),
    systemCertification: readPatternLabSystemCertification(youtubeRoot),
    nextActions: [
      "Review long-form draft on phone speaker.",
      "Review all three Shorts for hook strength and crop quality.",
      "Approve asset groups only after media review.",
      "Run private upload readiness after approvals.",
      "Upload private or unlisted before any public publish decision.",
    ],
  };
}

export async function approvePatternLabAssetType(params: {
  assetType: PatternLabAssetType;
  videoId?: unknown;
}): Promise<PatternLabDashboardSnapshot> {
  const videoId = normalizePatternLabVideoId(params.videoId);
  const outputRoot = resolvePatternLabOutputRoot(videoId);
  const ledgerPath = path.join(outputRoot, "rights-ledger.csv");
  const ledger = readCsvTable(ledgerPath);
  ensureLedgerReviewColumns(ledger);
  const matchingRows = ledger.rows.filter((row) => row.asset_type === params.assetType);
  if (matchingRows.length === 0) {
    throw new Error(`No rights-ledger rows found for asset type: ${params.assetType}`);
  }
  for (const row of matchingRows) {
    row.human_review_status = "approved";
  }
  writeCsv(ledgerPath, ledger);

  const approvalLog = path.join(outputRoot, "approval", "approval-log.jsonl");
  fs.mkdirSync(path.dirname(approvalLog), { recursive: true });
  fs.appendFileSync(
    approvalLog,
    `${JSON.stringify({
      created_at: utcNow(),
      action: "approve",
      asset_type: params.assetType,
      rows: matchingRows.length,
      source: "openclaw-control-ui",
    })}\n`,
    "utf8",
  );
  return loadPatternLabDashboardSnapshot({ videoId });
}

export async function recordPatternLabAssetReviewDecision(
  decision: PatternLabAssetReviewDecision,
): Promise<PatternLabAssetReviewDecisionResult> {
  const videoId = normalizePatternLabVideoId(decision.videoId);
  const outputRoot = resolvePatternLabOutputRoot(videoId);
  const ledgerPath = path.join(outputRoot, "rights-ledger.csv");
  const ledger = readCsvTable(ledgerPath);
  ensureLedgerReviewColumns(ledger);
  const matchingRows = ledger.rows.filter((row) => rowMatchesAssetDecision(row, decision));
  if (matchingRows.length === 0) {
    throw new Error(
      `No rights-ledger rows found for asset type ${decision.assetType} with the requested asset selector`,
    );
  }

  const status = reviewStatusForAction(decision.action);
  if (decision.action !== "status") {
    for (const row of matchingRows) {
      row.human_review_status = status;
    }
    writeCsv(ledgerPath, ledger);
  }

  const commonEntry = {
    event_id: crypto.randomUUID(),
    created_at: utcNow(),
    action: decision.action,
    asset_type: decision.assetType,
    asset_id: compactOptionalText(decision.assetId),
    filename: compactOptionalText(decision.filename),
    reason: compactOptionalText(decision.reason),
    rows: matchingRows.length,
    source: compactOptionalText(decision.source) ?? "pattern-lab-review",
    public_publish: "blocked_until_explicit_owner_approval",
  };
  const approvalLog = path.join(outputRoot, "approval", "approval-log.jsonl");
  appendJsonl(approvalLog, commonEntry);

  let queuePath: string | undefined;
  let repairResult: Record<string, unknown> | undefined;
  if (
    decision.action === "regenerate" ||
    decision.action === "repair" ||
    decision.action === "reject" ||
    decision.action === "revise_hook" ||
    decision.action === "kill_topic"
  ) {
    queuePath = path.join(
      outputRoot,
      "approval",
      decision.action === "regenerate" ? "regeneration-queue.jsonl" : "repair-queue.jsonl",
    );
    appendJsonl(queuePath, {
      ...commonEntry,
      status: "queued",
      matched_assets: matchingRows.map((row) => ({
        asset_id: row.asset_id,
        asset_type: row.asset_type,
        filename: row.filename,
        notes: row.notes,
      })),
    });
    repairResult = await processPatternLabRepairQueue({
      videoId,
      eventId: commonEntry.event_id,
    });
  }

  return {
    videoId,
    action: decision.action,
    assetType: decision.assetType,
    rowsMatched: matchingRows.length,
    statusWritten: status,
    ...(queuePath ? { queuePath: toRepoPath(resolvePatternLabYoutubeRoot(), queuePath) } : {}),
    ...(repairResult ? { repairResult } : {}),
    snapshot: await loadPatternLabDashboardSnapshot({ videoId }),
  };
}

function normalizeMediaPath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes("\0")) {
    return null;
  }
  const normalized = path.posix.normalize(trimmed.replaceAll("\\", "/"));
  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) {
    return null;
  }
  if (!/^local-output\/video-[0-9][0-9a-z_-]{0,31}\//i.test(normalized)) {
    return null;
  }
  if (!PUBLIC_MEDIA_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) {
    return null;
  }
  return normalized;
}

export function resolvePatternLabMediaFile(mediaPath: string): string | null {
  const normalized = normalizeMediaPath(mediaPath);
  if (!normalized) {
    return null;
  }
  const youtubeRoot = resolvePatternLabYoutubeRoot();
  const absolutePath = path.resolve(youtubeRoot, ...normalized.split("/"));
  const rootWithSep = youtubeRoot.endsWith(path.sep) ? youtubeRoot : `${youtubeRoot}${path.sep}`;
  const resolved = fs.existsSync(absolutePath) ? fs.realpathSync(absolutePath) : absolutePath;
  if (resolved !== youtubeRoot && !resolved.startsWith(rootWithSep)) {
    return null;
  }
  try {
    const stat = fs.statSync(resolved);
    return stat.isFile() ? resolved : null;
  } catch {
    return null;
  }
}

export const patternLabDashboardDataTesting = {
  parseCsv,
  parseCsvLine,
  approvalSummary,
  computedApprovalBlockers,
  rowMatchesAssetDecision,
  reviewStatusForAction,
  normalizeMediaPath,
  collectPatternLabYoutubeRootCandidates,
  usablePatternLabYoutubeRoot,
  resolvePatternLabYoutubeRoot,
  readPatternLabSystemCertification,
  patternLabYoutubeRootMissingMessage,
  resetPatternLabYoutubeRootCacheForTests,
};
