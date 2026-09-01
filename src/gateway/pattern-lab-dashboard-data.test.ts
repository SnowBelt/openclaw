import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  onInternalDiagnosticEvent,
  resetDiagnosticEventsForTest,
  waitForDiagnosticEventsDrained,
  type DiagnosticEventPayload,
} from "../infra/diagnostic-events.js";
import {
  patternLabDashboardDataTesting,
  normalizePatternLabVideoId,
  reportPatternLabWorkflowIssue,
  resolvePatternLabYoutubeRoot,
} from "./pattern-lab-dashboard-data.js";

describe("Pattern Lab dashboard data helpers", () => {
  it("requires an explicit path-safe video id", () => {
    expect(() => normalizePatternLabVideoId(undefined)).toThrow(/required/);
    expect(() => normalizePatternLabVideoId("01\n")).toThrow(/control bytes/);
    expect(() => normalizePatternLabVideoId("video-04")).not.toThrow();
  });

  it("reports dashboard boundary failures through the trusted SIG event path", async () => {
    const events: DiagnosticEventPayload[] = [];
    resetDiagnosticEventsForTest();
    const unsubscribe = onInternalDiagnosticEvent((event) => events.push(event));
    try {
      reportPatternLabWorkflowIssue({
        stage: "dashboard_snapshot",
        issueCode: "dashboard_snapshot_failed",
        summary: "Pattern Lab dashboard snapshot failed.",
      });
      await waitForDiagnosticEventsDrained();

      expect(events.at(-1)).toMatchObject({
        type: "improvement.signal",
        source: { component: "pattern-lab", subsystem: "workflow:dashboard_snapshot" },
        errorCode: "dashboard_snapshot_failed",
        severity: "high",
        idempotencyKey: "pattern-lab-boundary:dashboard_snapshot:dashboard_snapshot_failed",
      });

      reportPatternLabWorkflowIssue({
        stage: "dashboard_snapshot",
        issueCode: "dashboard_snapshot_failed",
        summary: "Pattern Lab dashboard snapshot failed again.",
      });
      await waitForDiagnosticEventsDrained();
      const signals = events.filter(
        (event): event is Extract<DiagnosticEventPayload, { type: "improvement.signal" }> =>
          event.type === "improvement.signal",
      );
      expect(signals.at(-1)?.idempotencyKey).toBe(signals.at(-2)?.idempotencyKey);
    } finally {
      unsubscribe();
      resetDiagnosticEventsForTest();
    }
  });

  it("resolves an explicitly configured youtube-v1 command center", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-pattern-lab-test-"));
    const youtubeRoot = path.join(root, "youtube-v1");
    const previous = process.env.OPENCLAW_PATTERN_LAB_YOUTUBE_ROOT;
    mkdirSync(path.join(youtubeRoot, "local-output", "operations"), { recursive: true });
    process.env.OPENCLAW_PATTERN_LAB_YOUTUBE_ROOT = youtubeRoot;
    patternLabDashboardDataTesting.resetPatternLabYoutubeRootCacheForTests();
    try {
      expect(resolvePatternLabYoutubeRoot()).toBe(realpathSync(youtubeRoot));
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCLAW_PATTERN_LAB_YOUTUBE_ROOT;
      } else {
        process.env.OPENCLAW_PATTERN_LAB_YOUTUBE_ROOT = previous;
      }
      patternLabDashboardDataTesting.resetPatternLabYoutubeRootCacheForTests();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("checks ancestor layouts so promoted gateway snapshots can find repo-local Pattern Lab files", () => {
    expect(patternLabDashboardDataTesting.collectPatternLabYoutubeRootCandidates()).toContain(
      path.resolve(process.cwd(), "youtube-v1"),
    );
  });

  it("rejects lookalike roots and prefers a complete known workspace layout", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-pattern-lab-layout-"));
    const lookalikeRoot = path.join(root, "youtube-v1");
    const validRoot = path.join(root, "OpenClaw", "youtube-v1");
    mkdirSync(path.join(lookalikeRoot, "local-output", "oauth-backups"), { recursive: true });
    mkdirSync(path.join(validRoot, "local-output", "operations"), { recursive: true });
    try {
      expect(patternLabDashboardDataTesting.usablePatternLabYoutubeRoot(lookalikeRoot)).toBeNull();
      expect(patternLabDashboardDataTesting.usablePatternLabYoutubeRoot(validRoot)).toBe(
        realpathSync(validRoot),
      );
      expect(
        patternLabDashboardDataTesting.resolvePatternLabYoutubeRoot({
          env: {},
          homeDirectory: root,
          moduleDirectory: path.join(root, "runtime", "dist"),
          currentDirectory: path.join(root, "runtime"),
        }),
      ).toBe(realpathSync(validRoot));
      expect(() =>
        patternLabDashboardDataTesting.resolvePatternLabYoutubeRoot({
          env: { OPENCLAW_PATTERN_LAB_YOUTUBE_ROOT: lookalikeRoot },
          homeDirectory: root,
          moduleDirectory: path.join(root, "runtime", "dist"),
          currentDirectory: path.join(root, "runtime"),
        }),
      ).toThrow(/Configured Pattern Lab youtube-v1 root is unavailable/);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("keeps missing-root errors actionable without leaking checked absolute paths", () => {
    const message = patternLabDashboardDataTesting.patternLabYoutubeRootMissingMessage();

    expect(message).toContain("OPENCLAW_PATTERN_LAB_YOUTUBE_ROOT");
    expect(message).toContain("OpenClaw repo root");
    expect(message).not.toContain("/Users/");
  });

  it("accepts only a passing system certification bound to the active runtime", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-pattern-lab-cert-"));
    const youtubeRoot = path.join(root, "youtube-v1");
    const operations = path.join(youtubeRoot, "local-output", "operations");
    const pointer = path.join(root, "active-runtime.json");
    const previousPointer = process.env.OPENCLAW_CUSTOM_RUNTIME_POINTER;
    mkdirSync(operations, { recursive: true });
    writeFileSync(
      pointer,
      `${JSON.stringify({ releaseId: "release-r2", sourceSha: "a".repeat(40) })}\n`,
    );
    writeFileSync(
      path.join(operations, "system-certification-current.json"),
      `${JSON.stringify({
        schema: "patternlab.system-certification.v1",
        generated_at: "2026-08-30T18:00:00Z",
        status: "pass",
        system_ready: true,
        operational_status: "awaiting_owner",
        active_runtime: {
          release_id: "release-r2",
          source_sha: "a".repeat(40),
          runtime_closure_sha256: "b".repeat(64),
        },
        checks: [
          { name: "draw_things_generation_certification", status: "pass" },
          { name: "unrelated_dirty_state_exact_preservation", status: "pass" },
        ],
        failed_checks: [],
      })}\n`,
    );
    process.env.OPENCLAW_CUSTOM_RUNTIME_POINTER = pointer;
    try {
      expect(
        patternLabDashboardDataTesting.readPatternLabSystemCertification(youtubeRoot),
      ).toMatchObject({
        state: "certified",
        systemReady: true,
        operationalStatus: "awaiting_owner",
        activeReleaseId: "release-r2",
        drawThingsCertified: true,
        preservationCertified: true,
        blockers: [],
      });
    } finally {
      if (previousPointer === undefined) {
        delete process.env.OPENCLAW_CUSTOM_RUNTIME_POINTER;
      } else {
        process.env.OPENCLAW_CUSTOM_RUNTIME_POINTER = previousPointer;
      }
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("marks a passing receipt stale after active runtime drift", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-pattern-lab-stale-cert-"));
    const youtubeRoot = path.join(root, "youtube-v1");
    const operations = path.join(youtubeRoot, "local-output", "operations");
    const pointer = path.join(root, "active-runtime.json");
    const previousPointer = process.env.OPENCLAW_CUSTOM_RUNTIME_POINTER;
    mkdirSync(operations, { recursive: true });
    writeFileSync(
      pointer,
      `${JSON.stringify({ releaseId: "release-r3", sourceSha: "c".repeat(40) })}\n`,
    );
    writeFileSync(
      path.join(operations, "system-certification-current.json"),
      `${JSON.stringify({
        schema: "patternlab.system-certification.v1",
        generated_at: "2026-08-30T18:00:00Z",
        status: "pass",
        system_ready: true,
        operational_status: "awaiting_owner",
        active_runtime: {
          release_id: "release-r2",
          source_sha: "a".repeat(40),
          runtime_closure_sha256: "b".repeat(64),
        },
        checks: [
          { name: "draw_things_generation_certification", status: "pass" },
          { name: "unrelated_dirty_state_exact_preservation", status: "pass" },
        ],
        failed_checks: [],
      })}\n`,
    );
    process.env.OPENCLAW_CUSTOM_RUNTIME_POINTER = pointer;
    try {
      const result = patternLabDashboardDataTesting.readPatternLabSystemCertification(youtubeRoot);
      expect(result.state).toBe("stale");
      expect(result.systemReady).toBe(false);
      expect(result.blockers).toContain("System certification does not match the active runtime.");
    } finally {
      if (previousPointer === undefined) {
        delete process.env.OPENCLAW_CUSTOM_RUNTIME_POINTER;
      } else {
        process.env.OPENCLAW_CUSTOM_RUNTIME_POINTER = previousPointer;
      }
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("parses quoted CSV rows for rights-ledger values", () => {
    expect(
      patternLabDashboardDataTesting.parseCsv(
        [
          "asset_id,asset_type,notes,human_review_status",
          'image_001,image,"specific, artifact-backed visual",approved',
        ].join("\n"),
      ),
    ).toEqual({
      headers: ["asset_id", "asset_type", "notes", "human_review_status"],
      rows: [
        {
          asset_id: "image_001",
          asset_type: "image",
          notes: "specific, artifact-backed visual",
          human_review_status: "approved",
        },
      ],
    });
  });

  it("summarizes approval state by asset group", () => {
    const summary = patternLabDashboardDataTesting.approvalSummary([
      { asset_type: "thumbnail", human_review_status: "approved" },
      { asset_type: "thumbnail", human_review_status: "pending" },
      { asset_type: "short", human_review_status: "approved" },
    ]);

    expect(summary.thumbnail).toEqual({
      total: 2,
      approved: 1,
      pending: 1,
      complete: false,
    });
    expect(summary.short).toEqual({
      total: 1,
      approved: 1,
      pending: 0,
      complete: true,
    });
    expect(summary.voiceover.complete).toBe(false);
  });

  it("matches item-level review decisions by asset id and filename", () => {
    const row = {
      asset_id: "video-01-short-01",
      asset_type: "short",
      filename: "shorts/pattern-lab-video-01-short-01.mp4",
    };

    expect(
      patternLabDashboardDataTesting.rowMatchesAssetDecision(row, {
        action: "approve",
        assetType: "short",
        assetId: "video-01-short-01",
      }),
    ).toBe(true);
    expect(
      patternLabDashboardDataTesting.rowMatchesAssetDecision(row, {
        action: "approve",
        assetType: "short",
        filename: "shorts/pattern-lab-video-01-short-01.mp4",
      }),
    ).toBe(true);
    expect(
      patternLabDashboardDataTesting.rowMatchesAssetDecision(row, {
        action: "approve",
        assetType: "short",
        assetId: "video-01-short-02",
      }),
    ).toBe(false);
  });

  it("maps review actions to durable ledger statuses", () => {
    expect(patternLabDashboardDataTesting.reviewStatusForAction("approve")).toBe("approved");
    expect(patternLabDashboardDataTesting.reviewStatusForAction("reject")).toBe("rejected");
    expect(patternLabDashboardDataTesting.reviewStatusForAction("regenerate")).toBe(
      "regeneration_requested",
    );
    expect(patternLabDashboardDataTesting.reviewStatusForAction("repair")).toBe("repair_requested");
  });

  it("normalizes only local Pattern Lab media paths", () => {
    expect(
      patternLabDashboardDataTesting.normalizeMediaPath(
        "local-output/video-01/images/thumbnail_candidate_a.png",
      ),
    ).toBe("local-output/video-01/images/thumbnail_candidate_a.png");
    expect(
      patternLabDashboardDataTesting.normalizeMediaPath(
        "local-output/video-01/video/pattern-lab-video-01-draft.mp4",
      ),
    ).toBe("local-output/video-01/video/pattern-lab-video-01-draft.mp4");

    expect(
      patternLabDashboardDataTesting.normalizeMediaPath(
        "../youtube-v1/local-output/video-01/x.png",
      ),
    ).toBeNull();
    expect(
      patternLabDashboardDataTesting.normalizeMediaPath("/local-output/video-01/x.png"),
    ).toBeNull();
    expect(
      patternLabDashboardDataTesting.normalizeMediaPath("launch/video-01/final-script.md"),
    ).toBeNull();
  });
});
