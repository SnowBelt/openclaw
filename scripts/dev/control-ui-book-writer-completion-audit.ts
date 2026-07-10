import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

type AuditStatus = "verified" | "blocked" | "failed" | "missing";

type AuditRequirement = {
  id: string;
  requirement: string;
  status: AuditStatus;
  evidence: string[];
  gap?: string;
};

type SmokeWrapperSummary = {
  ok?: boolean;
  artifactDir?: string;
  gatewayLogPath?: string;
  smokeStdoutPath?: string;
  smokeStderrPath?: string;
  bookWriterSummaryPath?: string;
  bookWriterSummaryParseError?: string;
  exitCode?: number | null;
  signal?: string | null;
};

type BookWriterSmokeSummary = {
  ok?: boolean;
  runId?: string;
  title?: string;
  status?: string;
  chapters?: number;
  paragraphs?: number;
  draftedParagraphs?: number;
  reviewPack?: string;
  publishPrep?: string;
  deleteVerified?: boolean;
  restoreVerified?: boolean;
  permanentDeleteVerified?: boolean;
  sentenceAdaptation?: {
    verified?: boolean;
    syncBefore?: string;
    syncAfter?: string;
    insertedSentenceSaved?: boolean;
    propagateButtonVisible?: boolean;
    adaptedParagraphChanged?: boolean;
    lockedTextPreserved?: boolean;
    rewrittenParagraphs?: number;
    cohesionReceiptVisible?: boolean;
    cohesionReceiptText?: string;
  };
  controlMatrix?: {
    verified?: boolean;
    editedControls?: string[];
    ideaDirectionSaved?: boolean;
    characterFactSaved?: boolean;
    timelineEventSaved?: boolean;
    toneRuleSaved?: boolean;
    plotDirectionSaved?: boolean;
    chapterTitleSaved?: boolean;
    chapterDescriptionSaved?: boolean;
    chapterStyleSaved?: boolean;
    chapterLockRoundTrip?: boolean;
    paragraphTitleSaved?: boolean;
    paragraphSummarySaved?: boolean;
    paragraphPurposeSaved?: boolean;
    paragraphStyleSaved?: boolean;
    paragraphFieldLockRoundTrip?: boolean;
    scopedRegenerationVisible?: boolean;
    rewriteVisible?: boolean;
    reloadPersistenceVerified?: boolean;
  };
  approvedPublish?: {
    verified?: boolean;
    reviewPack?: string;
    publishPrep?: string;
    kdpLinkVisible?: boolean;
    exactFilesVisible?: boolean;
    markPublishedEnabled?: boolean;
    finishedRunVisible?: boolean;
    landingTrophyRoomVisible?: boolean;
  };
  consoleErrors?: string[];
  pageErrors?: string[];
  accessibility?: {
    criticalIssues?: unknown[];
    warnings?: unknown[];
    keyboard?: {
      startButtonFocusable?: boolean;
      journeyTabFocusable?: boolean;
      happyPathBeforeLibraryTools?: boolean;
      helpStopsSkipped?: boolean;
    };
  };
  visual?: {
    healthStripVisible?: boolean;
    bookControlBarVisible?: boolean;
    trophyRoomHiddenOnBuildPages?: boolean;
    deletedListCollapsed?: boolean;
    activeDeleteBehindMore?: boolean;
    visibleJourneySteps?: string[];
  };
  screenshot?: string;
  accessibilityReport?: string;
  visualReport?: string;
};

type CompletionAudit = {
  schemaVersion: 1;
  generatedAt: string;
  overallStatus: AuditStatus;
  summary: string;
  smokeWrapper?: SmokeWrapperSummary;
  smokeSummary?: Pick<
    BookWriterSmokeSummary,
    | "ok"
    | "runId"
    | "title"
    | "status"
    | "chapters"
    | "paragraphs"
    | "draftedParagraphs"
    | "reviewPack"
    | "publishPrep"
  >;
  requirements: AuditRequirement[];
  artifacts: {
    auditJson: string;
    auditMarkdown: string;
    smokeWrapperSummary?: string;
    smokeStdout?: string;
    bookWriterSummary?: string;
    screenshot?: string;
    accessibilityReport?: string;
    visualReport?: string;
  };
};

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(path);
    }
    return [path];
  });
}

function latestSmokeWrapperSummary(): string | null {
  const candidates = [
    ...walkFiles(".artifacts/dashboard-smoke-suite"),
    ...walkFiles(".artifacts/control-ui-book-writer-local-smoke"),
  ].filter((path) => path.endsWith("summary.json"));
  const valid = candidates
    .map((path) => {
      try {
        const summary = readJsonFile(path) as SmokeWrapperSummary;
        const stdout = summary.smokeStdoutPath;
        const bookWriterSummary = summary.bookWriterSummaryPath;
        return summary.ok &&
          ((stdout && existsSync(stdout)) || (bookWriterSummary && existsSync(bookWriterSummary)))
          ? { mtime: statSync(path).mtimeMs, path }
          : null;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { mtime: number; path: string } => entry !== null)
    .toSorted((left, right) => right.mtime - left.mtime);
  return valid[0]?.path ?? null;
}

export function parseBookWriterSmokeStdout(stdout: string): BookWriterSmokeSummary {
  const marker = "control-ui-book-writer-smoke: ok";
  const markerIndex = stdout.indexOf(marker);
  const start = stdout.indexOf("{", Math.max(markerIndex, 0));
  if (start < 0) {
    throw new Error("Book Writer smoke stdout did not include a JSON summary.");
  }
  return JSON.parse(stdout.slice(start)) as BookWriterSmokeSummary;
}

function requirement(
  id: string,
  requirementText: string,
  passed: boolean,
  evidence: string[],
  gap: string,
): AuditRequirement {
  return {
    id,
    requirement: requirementText,
    status: passed ? "verified" : "failed",
    evidence,
    ...(passed ? {} : { gap }),
  };
}

export function buildBookWriterCompletionAudit(params: {
  auditJsonPath: string;
  auditMarkdownPath: string;
  bookWriterSummaryPath?: string;
  smokeStdoutPath?: string;
  smokeWrapper?: SmokeWrapperSummary;
  smokeWrapperSummaryPath?: string;
  now?: Date;
}): CompletionAudit {
  if (!params.bookWriterSummaryPath && !params.smokeStdoutPath) {
    throw new Error("Book Writer completion audit requires a smoke summary or stdout path.");
  }
  const smoke = params.bookWriterSummaryPath
    ? (readJsonFile(params.bookWriterSummaryPath) as BookWriterSmokeSummary)
    : parseBookWriterSmokeStdout(readFileSync(params.smokeStdoutPath ?? "", "utf8"));
  const sentence = smoke.sentenceAdaptation;
  const controls = smoke.controlMatrix;
  const approved = smoke.approvedPublish;
  const noBrowserErrors =
    (smoke.consoleErrors?.length ?? 0) === 0 && (smoke.pageErrors?.length ?? 0) === 0;
  const accessibility = smoke.accessibility;
  const visual = smoke.visual;
  const allParagraphsDrafted =
    Boolean(smoke.paragraphs && smoke.draftedParagraphs) &&
    smoke.paragraphs === smoke.draftedParagraphs;

  const requirements: AuditRequirement[] = [
    requirement(
      "plan-created",
      "Create a book plan from a topic or sentence.",
      Boolean(smoke.ok && smoke.runId && (smoke.chapters ?? 0) >= 3),
      [`runId=${smoke.runId ?? "missing"}`, `chapters=${smoke.chapters ?? 0}`],
      "Run the Book Writer smoke and verify a new plan with chapters is created.",
    ),
    requirement(
      "editable-structure",
      "Generate editable chapters and paragraph-level structure.",
      Boolean((smoke.chapters ?? 0) > 0 && (smoke.paragraphs ?? 0) > 0 && controls?.verified),
      [
        `paragraphs=${smoke.paragraphs ?? 0}`,
        `controlMatrix=${controls?.verified ? "verified" : "missing"}`,
      ],
      "Verify dashboard chapter and paragraph controls can edit and persist structure.",
    ),
    requirement(
      "user-edit-control",
      "Let the user edit sentence, paragraph, chapter, title, character fact, timeline event, tone, and plot-direction controls.",
      Boolean(
        sentence?.insertedSentenceSaved &&
        controls?.ideaDirectionSaved &&
        controls.characterFactSaved &&
        controls.timelineEventSaved &&
        controls.toneRuleSaved &&
        controls.plotDirectionSaved &&
        controls.chapterTitleSaved &&
        controls.chapterDescriptionSaved &&
        controls.chapterStyleSaved &&
        controls.paragraphTitleSaved &&
        controls.paragraphSummarySaved &&
        controls.paragraphPurposeSaved &&
        controls.paragraphStyleSaved,
      ),
      [
        `insertedSentenceSaved=${String(sentence?.insertedSentenceSaved)}`,
        `editedControls=${controls?.editedControls?.join(",") ?? "missing"}`,
      ],
      "Run the control matrix smoke and confirm all edited fields persist.",
    ),
    requirement(
      "save-load-persistence",
      "Save and reload edited book controls without losing user changes.",
      Boolean(controls?.verified && controls.reloadPersistenceVerified),
      [
        `controlMatrix=${controls?.verified ? "verified" : "missing"}`,
        `reloadPersistenceVerified=${String(controls?.reloadPersistenceVerified)}`,
      ],
      "Reload the real dashboard after edits and verify the Gateway-backed plan still contains the saved controls.",
    ),
    requirement(
      "story-adaptation",
      "Automatically adapt the surrounding story around an edit without breaking continuity.",
      Boolean(
        sentence?.verified &&
        sentence.syncBefore === "needs-propagation" &&
        sentence.syncAfter === "fully-updated" &&
        sentence.adaptedParagraphChanged &&
        (sentence.rewrittenParagraphs ?? 0) > 0,
      ),
      [
        `syncBefore=${sentence?.syncBefore ?? "missing"}`,
        `syncAfter=${sentence?.syncAfter ?? "missing"}`,
        `rewrittenParagraphs=${sentence?.rewrittenParagraphs ?? 0}`,
      ],
      "Verify the propagation action rewrites affected surrounding paragraphs.",
    ),
    requirement(
      "locked-text",
      "Locked text remains unchanged while surrounding content adapts.",
      Boolean(sentence?.lockedTextPreserved && controls?.chapterLockRoundTrip),
      [
        `lockedTextPreserved=${String(sentence?.lockedTextPreserved)}`,
        `chapterLockRoundTrip=${String(controls?.chapterLockRoundTrip)}`,
      ],
      "Verify locked text preservation and lock/unlock round-trip behavior.",
    ),
    requirement(
      "context-aware-rewrites",
      "Rewrite paragraphs and chapters with context, purpose, tone, and future consequence awareness.",
      Boolean(
        sentence?.cohesionReceiptVisible &&
        /Locked text remains protected/i.test(sentence.cohesionReceiptText ?? "") &&
        Boolean(controls?.scopedRegenerationVisible && controls.rewriteVisible),
      ),
      [
        `cohesionReceiptVisible=${String(sentence?.cohesionReceiptVisible)}`,
        `scopedRegenerationVisible=${String(controls?.scopedRegenerationVisible)}`,
        `rewriteVisible=${String(controls?.rewriteVisible)}`,
      ],
      "Verify cohesion receipts and scoped rewrite/regeneration controls are visible.",
    ),
    requirement(
      "cohesive-manuscript",
      "Stitch the book into a cohesive manuscript with no isolated-fragment regression.",
      Boolean(allParagraphsDrafted && smoke.status === "packaged" && smoke.reviewPack),
      [
        `status=${smoke.status ?? "missing"}`,
        `draftedParagraphs=${smoke.draftedParagraphs ?? 0}/${smoke.paragraphs ?? 0}`,
        `reviewPack=${smoke.reviewPack ?? "missing"}`,
      ],
      "Verify all paragraphs are drafted and packaged through the real dashboard flow.",
    ),
    requirement(
      "review-gates",
      "Run cohesion, quality, formatting, publishing-readiness, and safety review gates.",
      Boolean(noBrowserErrors && smoke.reviewPack && smoke.publishPrep),
      [
        `consoleErrors=${smoke.consoleErrors?.length ?? 0}`,
        `pageErrors=${smoke.pageErrors?.length ?? 0}`,
        `reviewPack=${smoke.reviewPack ?? "missing"}`,
        `publishPrep=${smoke.publishPrep ?? "missing"}`,
      ],
      "Run the dashboard smoke without browser errors and with review outputs present.",
    ),
    requirement(
      "kdp-ready-artifacts",
      "Generate package artifacts and KDP-ready publish-prep outputs.",
      Boolean(
        approved?.verified &&
        approved.reviewPack === "approve" &&
        approved.publishPrep === "ready" &&
        approved.kdpLinkVisible &&
        approved.exactFilesVisible,
      ),
      [
        `approvedReviewPack=${approved?.reviewPack ?? "missing"}`,
        `approvedPublishPrep=${approved?.publishPrep ?? "missing"}`,
        `kdpLinkVisible=${String(approved?.kdpLinkVisible)}`,
        `exactFilesVisible=${String(approved?.exactFilesVisible)}`,
      ],
      "Verify an approved fixture reaches publish-prep ready with exact KDP files visible.",
    ),
    requirement(
      "dashboard-intuitive-safe",
      "Keep the dashboard intuitive, keyboard-safe, visually clear, and low-confusion.",
      Boolean(
        noBrowserErrors &&
        (accessibility?.criticalIssues?.length ?? 0) === 0 &&
        accessibility?.keyboard?.startButtonFocusable &&
        accessibility?.keyboard?.journeyTabFocusable &&
        accessibility?.keyboard?.happyPathBeforeLibraryTools &&
        accessibility?.keyboard?.helpStopsSkipped &&
        visual?.healthStripVisible &&
        visual?.bookControlBarVisible &&
        visual?.trophyRoomHiddenOnBuildPages &&
        visual?.deletedListCollapsed &&
        visual?.activeDeleteBehindMore &&
        (visual.visibleJourneySteps?.length ?? 0) >= 6,
      ),
      [
        `criticalAccessibilityIssues=${accessibility?.criticalIssues?.length ?? "missing"}`,
        `keyboardHappyPathFirst=${String(accessibility?.keyboard?.happyPathBeforeLibraryTools)}`,
        `bookControlBarVisible=${String(visual?.bookControlBarVisible)}`,
        `visibleJourneySteps=${visual?.visibleJourneySteps?.join(" > ") ?? "missing"}`,
      ],
      "Run the dashboard smoke accessibility and visual audits and fix any critical or journey-order issue.",
    ),
    requirement(
      "book-recovery-controls",
      "Verify destructive/recovery controls are explicit and recoverable.",
      Boolean(smoke.deleteVerified && smoke.restoreVerified && smoke.permanentDeleteVerified),
      [
        `deleteVerified=${String(smoke.deleteVerified)}`,
        `restoreVerified=${String(smoke.restoreVerified)}`,
        `permanentDeleteVerified=${String(smoke.permanentDeleteVerified)}`,
      ],
      "Run the dashboard smoke book-management flow and verify delete, restore, and final-delete controls.",
    ),
    {
      id: "final-submit-approval",
      requirement: "Keep final real publishing approval-gated and never click final submit.",
      status: approved?.markPublishedEnabled ? "blocked" : "missing",
      evidence: [
        `markPublishedEnabled=${String(approved?.markPublishedEnabled)}`,
        "Real KDP submit is intentionally outside the smoke and requires explicit operator approval.",
      ],
      gap: "Obtain explicit user approval and live KDP account access before any real final submit.",
    },
  ];

  const failed = requirements.filter(
    (item) => item.status === "failed" || item.status === "missing",
  );
  const blocked = requirements.filter((item) => item.status === "blocked");
  const overallStatus: AuditStatus =
    failed.length > 0 ? "failed" : blocked.length > 0 ? "blocked" : "verified";

  return {
    schemaVersion: 1,
    generatedAt: (params.now ?? new Date()).toISOString(),
    overallStatus,
    summary:
      overallStatus === "blocked"
        ? "Book Studio workflow is verified through publish-prep; real final publishing remains approval-gated."
        : overallStatus === "verified"
          ? "Book Studio workflow is fully verified."
          : "Book Studio workflow has missing or failed verification items.",
    smokeWrapper: params.smokeWrapper,
    smokeSummary: {
      ok: smoke.ok,
      runId: smoke.runId,
      title: smoke.title,
      status: smoke.status,
      chapters: smoke.chapters,
      paragraphs: smoke.paragraphs,
      draftedParagraphs: smoke.draftedParagraphs,
      reviewPack: smoke.reviewPack,
      publishPrep: smoke.publishPrep,
    },
    requirements,
    artifacts: {
      auditJson: params.auditJsonPath,
      auditMarkdown: params.auditMarkdownPath,
      smokeWrapperSummary: params.smokeWrapperSummaryPath,
      smokeStdout: params.smokeStdoutPath,
      bookWriterSummary: params.bookWriterSummaryPath,
      screenshot: smoke.screenshot,
      accessibilityReport: smoke.accessibilityReport,
      visualReport: smoke.visualReport,
    },
  };
}

function renderMarkdown(audit: CompletionAudit): string {
  const statusIcon: Record<AuditStatus, string> = {
    verified: "PASS",
    blocked: "BLOCKED",
    failed: "FAIL",
    missing: "MISSING",
  };
  return [
    "# Book Studio Completion Audit",
    "",
    `Overall status: ${statusIcon[audit.overallStatus]}`,
    "",
    audit.summary,
    "",
    "## Requirements",
    "",
    ...audit.requirements.flatMap((item) => [
      `- ${statusIcon[item.status]} ${item.id}: ${item.requirement}`,
      `  - Evidence: ${item.evidence.join("; ")}`,
      ...(item.gap ? [`  - Gap: ${item.gap}`] : []),
    ]),
    "",
    "## Artifacts",
    "",
    `- Audit JSON: ${audit.artifacts.auditJson}`,
    `- Book Writer summary: ${audit.artifacts.bookWriterSummary ?? "missing"}`,
    `- Smoke stdout: ${audit.artifacts.smokeStdout ?? "missing"}`,
    `- Screenshot: ${audit.artifacts.screenshot ?? "missing"}`,
    `- Accessibility report: ${audit.artifacts.accessibilityReport ?? "missing"}`,
    `- Visual report: ${audit.artifacts.visualReport ?? "missing"}`,
    "",
  ].join("\n");
}

function readArgValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function main(): void {
  const args = process.argv.slice(2);
  const wrapperSummaryPath = readArgValue(args, "--smoke-summary") ?? latestSmokeWrapperSummary();
  const wrapper = wrapperSummaryPath
    ? (readJsonFile(wrapperSummaryPath) as SmokeWrapperSummary)
    : undefined;
  const bookWriterSummaryPath =
    readArgValue(args, "--book-writer-summary") ?? wrapper?.bookWriterSummaryPath;
  const smokeStdoutPath = readArgValue(args, "--smoke-stdout") ?? wrapper?.smokeStdoutPath;
  const outputPath =
    readArgValue(args, "--output") ??
    join(
      ".artifacts",
      "control-ui-book-writer-completion-audit",
      new Date().toISOString().replace(/[:.]/g, "-"),
      "audit.json",
    );
  const markdownPath = readArgValue(args, "--markdown") ?? join(dirname(outputPath), "audit.md");
  const audit = buildBookWriterCompletionAudit({
    auditJsonPath: outputPath,
    auditMarkdownPath: markdownPath,
    bookWriterSummaryPath,
    smokeStdoutPath,
    smokeWrapper: wrapper,
    smokeWrapperSummaryPath: wrapperSummaryPath ?? undefined,
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(audit));
  console.log(JSON.stringify(audit, null, 2));
  process.exitCode = audit.overallStatus === "failed" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
