import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  approvePatternLabAssetType,
  loadPatternLabDashboard,
  selectPatternLabVideo,
  type PatternLabDashboardSnapshot,
  type PatternLabDashboardState,
} from "./pattern-lab-dashboard.ts";

function snapshot(videoId: string): PatternLabDashboardSnapshot {
  return { videoId } as PatternLabDashboardSnapshot;
}

type GatewayRequest = <T = unknown>(
  method: string,
  params?: unknown,
  options?: unknown,
) => Promise<T>;

function makeState(request: GatewayRequest): PatternLabDashboardState {
  return {
    client: { request } as unknown as GatewayBrowserClient,
    connected: true,
    patternLabVideoId: "04",
    patternLabDashboardLoading: false,
    patternLabDashboardError: null,
    patternLabDashboard: null,
    patternLabDashboardLastFetchAt: null,
    patternLabApprovalBusy: null,
    requestUpdate: vi.fn(),
  };
}

describe("Pattern Lab dashboard controller", () => {
  it("does not load an implicit video", async () => {
    const request = vi.fn();
    const state = makeState(request);
    state.patternLabVideoId = "";

    await loadPatternLabDashboard(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.patternLabDashboardError).toContain("exact Pattern Lab video ID");
  });

  it("forwards the selection and ignores an older response", async () => {
    let resolveFirst: ((value: PatternLabDashboardSnapshot) => void) | undefined;
    const first = new Promise<PatternLabDashboardSnapshot>((resolve) => {
      resolveFirst = resolve;
    });
    const request = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(snapshot("05"));
    const state = makeState(request);

    const firstLoad = loadPatternLabDashboard(state);
    selectPatternLabVideo(state, "05");
    await loadPatternLabDashboard(state);
    resolveFirst?.(snapshot("04"));
    await firstLoad;

    expect(request).toHaveBeenNthCalledWith(1, "patternLab.dashboard.snapshot", { videoId: "04" });
    expect(request).toHaveBeenNthCalledWith(2, "patternLab.dashboard.snapshot", { videoId: "05" });
    expect(state.patternLabDashboard?.videoId).toBe("05");
  });

  it("requires an explicit selection before approval", async () => {
    const request = vi.fn();
    const state = makeState(request);
    state.patternLabVideoId = "";

    await approvePatternLabAssetType(state, "thumbnail");

    expect(request).not.toHaveBeenCalled();
    expect(state.patternLabDashboardError).toContain("exact Pattern Lab video ID");
  });
});
