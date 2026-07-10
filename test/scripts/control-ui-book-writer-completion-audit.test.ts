import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBookWriterCompletionAudit,
  parseBookWriterSmokeStdout,
} from "../../scripts/dev/control-ui-book-writer-completion-audit.ts";

const verifiedSmoke = {
  ok: true,
  runId: "run-1",
  title: "Clean Mystery",
  status: "packaged",
  chapters: 8,
  paragraphs: 40,
  draftedParagraphs: 40,
  reviewPack: "reject",
  publishPrep: "blocked-by-review",
  deleteVerified: true,
  restoreVerified: true,
  permanentDeleteVerified: true,
  sentenceAdaptation: {
    verified: true,
    syncBefore: "needs-propagation",
    syncAfter: "fully-updated",
    insertedSentenceSaved: true,
    propagateButtonVisible: true,
    adaptedParagraphChanged: true,
    lockedTextPreserved: true,
    rewrittenParagraphs: 5,
    cohesionReceiptVisible: true,
    cohesionReceiptText:
      "Cohesion checked. Locked text remains protected. Rewrote affected paragraphs.",
  },
  controlMatrix: {
    verified: true,
    editedControls: [
      "idea.direction",
      "continuity.characterFacts",
      "continuity.timelineEvents",
      "continuity.toneRules",
      "continuity.plotDirections",
      "chapter.title",
      "chapter.description",
      "chapter.styleDirection",
      "paragraph.title",
      "paragraph.summary",
      "paragraph.purpose",
      "paragraph.styleDirection",
    ],
    ideaDirectionSaved: true,
    characterFactSaved: true,
    timelineEventSaved: true,
    toneRuleSaved: true,
    plotDirectionSaved: true,
    chapterTitleSaved: true,
    chapterDescriptionSaved: true,
    chapterStyleSaved: true,
    chapterLockRoundTrip: true,
    paragraphTitleSaved: true,
    paragraphSummarySaved: true,
    paragraphPurposeSaved: true,
    paragraphStyleSaved: true,
    paragraphFieldLockRoundTrip: true,
    scopedRegenerationVisible: true,
    rewriteVisible: true,
    reloadPersistenceVerified: true,
  },
  approvedPublish: {
    verified: true,
    reviewPack: "approve",
    publishPrep: "ready",
    kdpLinkVisible: true,
    exactFilesVisible: true,
    markPublishedEnabled: true,
    finishedRunVisible: true,
    landingTrophyRoomVisible: true,
  },
  consoleErrors: [],
  pageErrors: [],
  accessibility: {
    criticalIssues: [],
    warnings: [],
    keyboard: {
      startButtonFocusable: true,
      journeyTabFocusable: true,
      happyPathBeforeLibraryTools: true,
      helpStopsSkipped: true,
    },
  },
  visual: {
    healthStripVisible: true,
    bookControlBarVisible: true,
    trophyRoomHiddenOnBuildPages: true,
    deletedListCollapsed: true,
    activeDeleteBehindMore: true,
    visibleJourneySteps: ["1 Idea", "2 Chapters", "3 Plan", "4 Write", "5 Read", "6 Publish"],
  },
  screenshot: ".artifacts/control-ui-book-writer/screenshot.png",
  accessibilityReport: ".artifacts/control-ui-book-writer/accessibility.json",
  visualReport: ".artifacts/control-ui-book-writer/visual.json",
};

describe("control-ui-book-writer-completion-audit", () => {
  it("parses the Book Writer smoke JSON summary from stdout", () => {
    const parsed = parseBookWriterSmokeStdout(
      `noise\ncontrol-ui-book-writer-smoke: ok ${JSON.stringify(verifiedSmoke, null, 2)}`,
    );

    expect(parsed.runId).toBe("run-1");
    expect(parsed.sentenceAdaptation?.lockedTextPreserved).toBe(true);
  });

  it("builds the audit from a first-class Book Writer summary JSON receipt", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-book-writer-audit-test-"));
    try {
      const summaryPath = join(dir, "book-writer-summary.json");
      writeFileSync(summaryPath, `${JSON.stringify(verifiedSmoke, null, 2)}\n`);
      const audit = buildBookWriterCompletionAudit({
        auditJsonPath: join(dir, "audit.json"),
        auditMarkdownPath: join(dir, "audit.md"),
        bookWriterSummaryPath: summaryPath,
        now: new Date("2026-07-07T16:00:00.000Z"),
      });

      expect(audit.overallStatus).toBe("blocked");
      expect(audit.artifacts.bookWriterSummary).toBe(summaryPath);
      expect(audit.artifacts.smokeStdout).toBeUndefined();
      expect(audit.requirements.find((item) => item.id === "story-adaptation")?.status).toBe(
        "verified",
      );
      expect(audit.requirements.find((item) => item.id === "save-load-persistence")?.status).toBe(
        "verified",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("maps verified smoke evidence to requirements while keeping final submit blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "openclaw-book-writer-audit-test-"));
    try {
      const stdoutPath = join(dir, "smoke.stdout.log");
      writeFileSync(
        stdoutPath,
        `control-ui-book-writer-smoke: ok ${JSON.stringify(verifiedSmoke, null, 2)}`,
      );
      const audit = buildBookWriterCompletionAudit({
        auditJsonPath: join(dir, "audit.json"),
        auditMarkdownPath: join(dir, "audit.md"),
        smokeStdoutPath: stdoutPath,
        now: new Date("2026-07-07T16:00:00.000Z"),
      });

      expect(audit.overallStatus).toBe("blocked");
      expect(audit.requirements.filter((item) => item.status === "failed")).toEqual([]);
      expect(audit.requirements.find((item) => item.id === "locked-text")?.status).toBe("verified");
      expect(
        audit.requirements.find((item) => item.id === "dashboard-intuitive-safe")?.status,
      ).toBe("verified");
      expect(audit.requirements.find((item) => item.id === "book-recovery-controls")?.status).toBe(
        "verified",
      );
      expect(audit.requirements.find((item) => item.id === "final-submit-approval")?.status).toBe(
        "blocked",
      );
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
