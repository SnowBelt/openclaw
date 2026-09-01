import type { GatewayBrowserClient } from "../gateway.ts";

export type PatternLabAssetType =
  | "image"
  | "thumbnail"
  | "voiceover"
  | "proof_footage"
  | "video"
  | "short";

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

export type PatternLabDashboardSnapshot = {
  generatedAt: string;
  videoId: string;
  channelName: string;
  status: "owner-review-required" | "private-upload-ready";
  publicPublish: "blocked_until_explicit_owner_approval";
  outputRoot: string;
  approvals: Record<PatternLabAssetType, PatternLabApprovalSummary>;
  blockers: string[];
  readinessSteps: Array<{
    label: string;
    complete: boolean;
    detail: string;
  }>;
  media: {
    longForm: PatternLabFileInfo;
    voiceover: PatternLabFileInfo;
    shorts: PatternLabFileInfo[];
    thumbnails: PatternLabFileInfo[];
    reviewPacket: PatternLabFileInfo;
    readinessReport: PatternLabFileInfo;
  };
  performance: {
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
  systemCertification: PatternLabSystemCertification;
  nextActions: string[];
};

export type PatternLabDashboardState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  patternLabVideoId: string;
  patternLabDashboardLoading: boolean;
  patternLabDashboardError: string | null;
  patternLabDashboard: PatternLabDashboardSnapshot | null;
  patternLabDashboardLastFetchAt: number | null;
  patternLabApprovalBusy: PatternLabAssetType | null;
  requestUpdate?: () => void;
};

const latestDashboardLoadByState = new WeakMap<object, number>();

function nextDashboardLoad(state: PatternLabDashboardState): number {
  const next = (latestDashboardLoadByState.get(state) ?? 0) + 1;
  latestDashboardLoadByState.set(state, next);
  return next;
}

function isLatestDashboardLoad(state: PatternLabDashboardState, requestId: number): boolean {
  return latestDashboardLoadByState.get(state) === requestId;
}

export function selectPatternLabVideo(state: PatternLabDashboardState, videoId: string): void {
  nextDashboardLoad(state);
  state.patternLabVideoId = videoId;
  state.patternLabDashboard = null;
  state.patternLabDashboardLastFetchAt = null;
  state.patternLabDashboardError = null;
  state.requestUpdate?.();
}

export async function loadPatternLabDashboard(
  state: PatternLabDashboardState,
  opts?: { quiet?: boolean },
) {
  const requestId = nextDashboardLoad(state);
  if (!state.client || !state.connected) {
    state.patternLabDashboard = null;
    state.patternLabDashboardLastFetchAt = null;
    state.patternLabDashboardLoading = false;
    state.patternLabDashboardError = null;
    state.requestUpdate?.();
    return;
  }
  const videoId = state.patternLabVideoId.trim();
  if (!videoId) {
    state.patternLabDashboard = null;
    state.patternLabDashboardLastFetchAt = null;
    state.patternLabDashboardLoading = false;
    if (!opts?.quiet) {
      state.patternLabDashboardError =
        "Enter an exact Pattern Lab video ID before loading the dashboard.";
    }
    state.requestUpdate?.();
    return;
  }
  if (!opts?.quiet) {
    state.patternLabDashboardLoading = true;
  }
  state.patternLabDashboardError = null;
  state.requestUpdate?.();
  try {
    const snapshot = await state.client.request<PatternLabDashboardSnapshot>(
      "patternLab.dashboard.snapshot",
      { videoId },
    );
    if (!isLatestDashboardLoad(state, requestId)) {
      return;
    }
    state.patternLabDashboard = snapshot;
    state.patternLabVideoId = snapshot.videoId;
    state.patternLabDashboardLastFetchAt = Date.now();
  } catch (error) {
    if (!isLatestDashboardLoad(state, requestId)) {
      return;
    }
    state.patternLabDashboardError = error instanceof Error ? error.message : String(error);
  } finally {
    if (isLatestDashboardLoad(state, requestId)) {
      state.patternLabDashboardLoading = false;
      state.requestUpdate?.();
    }
  }
}

export async function approvePatternLabAssetType(
  state: PatternLabDashboardState,
  assetType: PatternLabAssetType,
) {
  if (!state.client || !state.connected || state.patternLabApprovalBusy) {
    return;
  }
  const videoId = state.patternLabVideoId.trim();
  if (!videoId) {
    state.patternLabDashboardError =
      "Enter an exact Pattern Lab video ID before approving an asset group.";
    state.requestUpdate?.();
    return;
  }
  state.patternLabApprovalBusy = assetType;
  state.patternLabDashboardError = null;
  state.requestUpdate?.();
  try {
    const snapshot = await state.client.request<PatternLabDashboardSnapshot>(
      "patternLab.assets.approve",
      { videoId, assetType },
    );
    if (state.patternLabVideoId.trim() !== videoId) {
      return;
    }
    state.patternLabDashboard = snapshot;
    state.patternLabVideoId = snapshot.videoId;
    state.patternLabDashboardLastFetchAt = Date.now();
  } catch (error) {
    state.patternLabDashboardError = error instanceof Error ? error.message : String(error);
  } finally {
    state.patternLabApprovalBusy = null;
    state.requestUpdate?.();
  }
}
