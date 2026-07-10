import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_OUTPUT = ".artifacts/control-ui-book-writer-handoff/latest.json";

const BOOK_WRITER_INTENDED_FILES = [
  "docs/cli/books.md",
  "extensions/book-writer/src/cohesion.ts",
  "extensions/book-writer/src/gateway.test.ts",
  "extensions/book-writer/src/gateway.ts",
  "extensions/book-writer/src/planning.test.ts",
  "extensions/book-writer/src/planning.ts",
  "extensions/book-writer/src/story-impact.ts",
  "extensions/book-writer/src/types.ts",
  "package.json",
  "scripts/dev/control-ui-book-writer-completion-audit.ts",
  "scripts/dev/control-ui-book-writer-handoff.ts",
  "scripts/dev/control-ui-book-writer-local-smoke.ts",
  "scripts/dev/control-ui-book-writer-smoke.ts",
  "scripts/dev/control-ui-dashboard-smoke-suite.ts",
  "test/scripts/control-ui-book-writer-completion-audit.test.ts",
  "test/scripts/control-ui-book-writer-handoff.test.ts",
  "test/scripts/control-ui-dashboard-smoke-suite.test.ts",
  "ui/src/ui/controllers/book-writer-dashboard.test.ts",
  "ui/src/ui/controllers/book-writer-dashboard.ts",
  "ui/src/ui/views/book-writer-dashboard.test.ts",
  "ui/src/ui/views/book-writer-dashboard.ts",
] as const;

const REQUIRED_PROOF_COMMANDS = [
  "pnpm exec oxfmt --check --threads=1 <Book Studio files>",
  "git diff --check -- <Book Studio files>",
  "node scripts/run-oxlint.mjs --tsconfig config/tsconfig/oxlint.core.json <Book Studio files>",
  "pnpm tsgo:core",
  "pnpm tsgo:test:ui",
  "pnpm test <Book Studio targeted tests> -- --reporter=verbose",
  "pnpm ui:smoke:book-writer",
  "pnpm ui:smoke:book-writer:audit -- --smoke-summary <summary.json>",
  "pnpm ui:smoke:book-writer:handoff -- --output <handoff.json> --markdown <handoff.md>",
] as const;

const ORIGIN_MAIN_PORT_REQUIRED_BASELINES = [
  "extensions/book-writer",
  "extensions/book-writer/src/files.ts",
  "extensions/book-writer/src/config.ts",
  "extensions/book-writer/src/model-adapter.ts",
  "extensions/book-writer/src/packaging.ts",
  "ui/src/ui",
  "ui/src/ui/gateway.ts",
  "ui/src/ui/icons.ts",
] as const;

type GitStatusEntry = {
  path: string;
  raw: string;
  status: string;
};

type OriginMainPortStatus = {
  ref: "origin/main";
  checked: boolean;
  status: "ready" | "blocked" | "unknown";
  missingRequiredBaselines: string[];
  addedIntendedFiles: string[];
  summary: string;
};

type HandoffArtifactSet = {
  completionAuditJson?: string;
  completionAuditMarkdown?: string;
  dashboardScreenshot?: string;
  dashboardAccessibility?: string;
  dashboardVisual?: string;
  smokeSummary?: string;
  smokeStdout?: string;
  bookWriterSummary?: string;
  uiBuildLog?: string;
  scopedPatch?: string;
  intendedManifest?: string;
};

type BookWriterHandoffReport = {
  schemaVersion: 1;
  generatedAt: string;
  status: "ready-for-review" | "needs-proof" | "mixed-worktree";
  intendedFiles: string[];
  dirtyState: {
    intended: GitStatusEntry[];
    unrelated: GitStatusEntry[];
  };
  proofCommands: string[];
  originMainPort: OriginMainPortStatus;
  latestArtifacts: HandoffArtifactSet;
  checklist: Array<{
    item: string;
    status: "done" | "blocked";
    evidence: string[];
  }>;
  blockers: string[];
};

function readArgValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function gitStatusEntries(): GitStatusEntry[] {
  const result = spawnSync("git", ["status", "--short"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git status failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim();
      const path = line.slice(3).replace(/^"|"$/g, "");
      return { path, raw: line, status };
    });
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function latestFile(paths: string[]): string | undefined {
  return paths
    .filter((path) => existsSync(path))
    .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
    .toSorted((left, right) => right.mtime - left.mtime)[0]?.path;
}

function latestSummaryWithSmokeReceipt(): string | undefined {
  return latestFile(
    walkFiles(".artifacts/dashboard-smoke-suite")
      .concat(walkFiles(".artifacts/control-ui-book-writer-local-smoke"))
      .filter((path) => path.endsWith("summary.json"))
      .filter((path) => {
        try {
          const summary = JSON.parse(readFileSync(path, "utf8")) as {
            smokeStdoutPath?: string;
            bookWriterSummaryPath?: string;
          };
          return Boolean(
            (summary.bookWriterSummaryPath && existsSync(summary.bookWriterSummaryPath)) ||
            (summary.smokeStdoutPath && existsSync(summary.smokeStdoutPath)),
          );
        } catch {
          return false;
        }
      }),
  );
}

function latestArtifacts(): HandoffArtifactSet {
  const smokeSummary = latestSummaryWithSmokeReceipt();
  const smokeSummaryValue = smokeSummary
    ? (JSON.parse(readFileSync(smokeSummary, "utf8")) as {
        smokeStdoutPath?: string;
        bookWriterSummaryPath?: string;
        uiBuildLogPath?: string;
      })
    : {};
  return {
    smokeSummary,
    smokeStdout: smokeSummaryValue.smokeStdoutPath,
    bookWriterSummary: smokeSummaryValue.bookWriterSummaryPath,
    uiBuildLog: smokeSummaryValue.uiBuildLogPath,
    completionAuditJson: latestFile(
      walkFiles(".artifacts/control-ui-book-writer-completion-audit").filter((path) =>
        path.endsWith("audit.json"),
      ),
    ),
    completionAuditMarkdown: latestFile(
      walkFiles(".artifacts/control-ui-book-writer-completion-audit").filter((path) =>
        path.endsWith("audit.md"),
      ),
    ),
    dashboardScreenshot: latestFile(
      walkFiles(".artifacts/control-ui-book-writer").filter((path) =>
        path.endsWith("book-publisher-dashboard.png"),
      ),
    ),
    dashboardAccessibility: latestFile(
      walkFiles(".artifacts/control-ui-book-writer").filter((path) =>
        path.endsWith("book-publisher-dashboard-accessibility.json"),
      ),
    ),
    dashboardVisual: latestFile(
      walkFiles(".artifacts/control-ui-book-writer").filter((path) =>
        path.endsWith("book-publisher-dashboard-visual.json"),
      ),
    ),
  };
}

function gitDiff(args: string[], allowDifferenceExit = false): string {
  const result = spawnSync("git", args, { encoding: "utf8" });
  const allowedStatus = allowDifferenceExit ? [0, 1] : [0];
  if (!allowedStatus.includes(result.status ?? 1)) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function gitPathExistsAtRef(ref: string, path: string): boolean | null {
  const result = spawnSync("git", ["cat-file", "-e", `${ref}:${path}`], {
    encoding: "utf8",
  });
  if (result.status === 0) {
    return true;
  }
  if (/Not a valid object name|invalid object name|unknown revision/i.test(result.stderr)) {
    return null;
  }
  return false;
}

function buildOriginMainPortStatus(): OriginMainPortStatus {
  const requiredStatuses = ORIGIN_MAIN_PORT_REQUIRED_BASELINES.map((path) => ({
    path,
    exists: gitPathExistsAtRef("origin/main", path),
  }));
  if (requiredStatuses.some((entry) => entry.exists === null)) {
    return {
      ref: "origin/main",
      checked: false,
      status: "unknown",
      missingRequiredBaselines: [],
      addedIntendedFiles: [],
      summary: "origin/main was not available locally, so direct-port readiness was not checked.",
    };
  }
  const missingRequiredBaselines = requiredStatuses
    .filter((entry) => entry.exists === false)
    .map((entry) => entry.path);
  const addedIntendedFiles = BOOK_WRITER_INTENDED_FILES.filter(
    (path) => gitPathExistsAtRef("origin/main", path) === false,
  );
  return {
    ref: "origin/main",
    checked: true,
    status: missingRequiredBaselines.length > 0 ? "blocked" : "ready",
    missingRequiredBaselines,
    addedIntendedFiles,
    summary:
      missingRequiredBaselines.length > 0
        ? "Direct dirty-file patching onto origin/main is blocked because origin/main lacks required Book Studio baseline directories/files."
        : "Required Book Studio baseline paths exist on origin/main; direct-port risk is limited to normal merge/test validation.",
  };
}

function isUntracked(entry: GitStatusEntry): boolean {
  return entry.status === "??";
}

export function buildBookWriterScopedPatch(report: BookWriterHandoffReport): string {
  const trackedIntendedFiles = report.dirtyState.intended
    .filter((entry) => !isUntracked(entry))
    .map((entry) => entry.path);
  const untrackedIntendedFiles = report.dirtyState.intended
    .filter(isUntracked)
    .map((entry) => entry.path);
  const parts: string[] = [];
  if (trackedIntendedFiles.length > 0) {
    parts.push(gitDiff(["diff", "--binary", "--unified=0", "--", ...trackedIntendedFiles]));
  }
  for (const file of untrackedIntendedFiles) {
    parts.push(gitDiff(["diff", "--binary", "--no-index", "--", "/dev/null", file], true));
  }
  return parts
    .map((part) => part.trimEnd())
    .filter(Boolean)
    .join("\n\n");
}

function patchMentionsUnrelatedPath(patch: string, unrelated: GitStatusEntry[]): boolean {
  return unrelated.some((entry) => patch.includes(entry.path));
}

function writeScopedReviewArtifacts(report: BookWriterHandoffReport, output: string): void {
  const patchPath = join(dirname(output), "book-studio-scoped.patch");
  const manifestPath = join(dirname(output), "book-studio-intended-files.json");
  const patch = buildBookWriterScopedPatch(report);
  writeFileSync(patchPath, patch ? `${patch}\n` : "");
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: report.generatedAt,
        intendedFiles: report.intendedFiles,
        dirtyIntendedFiles: report.dirtyState.intended.map((entry) => entry.path),
        unrelatedDirtyFiles: report.dirtyState.unrelated.map((entry) => entry.path),
      },
      null,
      2,
    )}\n`,
  );
  report.latestArtifacts.scopedPatch = patchPath;
  report.latestArtifacts.intendedManifest = manifestPath;
  report.checklist.splice(1, 0, {
    item: "Book Studio scoped patch excludes unrelated dirty files.",
    status:
      patch && !patchMentionsUnrelatedPath(patch, report.dirtyState.unrelated) ? "done" : "blocked",
    evidence: [patchPath],
  });
  if (!patch) {
    report.blockers.push("Book Studio scoped patch was empty.");
  }
  if (patchMentionsUnrelatedPath(patch, report.dirtyState.unrelated)) {
    report.blockers.push("Book Studio scoped patch appears to include unrelated dirty paths.");
  }
}

function renderMarkdown(report: BookWriterHandoffReport): string {
  const intended =
    report.dirtyState.intended.map((entry) => `- ${entry.raw}`).join("\n") || "- None";
  const unrelated =
    report.dirtyState.unrelated.map((entry) => `- ${entry.raw}`).join("\n") || "- None";
  const artifacts = Object.entries(report.latestArtifacts)
    .map(([key, value]) => `- ${key}: ${value ?? "missing"}`)
    .join("\n");
  const checklist = report.checklist
    .map((item) => `- ${item.status.toUpperCase()} ${item.item}: ${item.evidence.join("; ")}`)
    .join("\n");
  return [
    "# Book Studio Handoff",
    "",
    `Status: ${report.status}`,
    "",
    "## Intended Book Studio files",
    "",
    ...report.intendedFiles.map((file) => `- ${file}`),
    "",
    "## Dirty state in intended scope",
    "",
    intended,
    "",
    "## Dirty state outside Book Studio scope",
    "",
    unrelated,
    "",
    "## Proof commands",
    "",
    ...report.proofCommands.map((command) => `- ${command}`),
    "",
    "## Origin-main portability",
    "",
    `- Status: ${report.originMainPort.status}`,
    `- Summary: ${report.originMainPort.summary}`,
    `- Missing required baselines: ${
      report.originMainPort.missingRequiredBaselines.join(", ") || "none"
    }`,
    `- Intended files added relative to origin/main: ${
      report.originMainPort.addedIntendedFiles.join(", ") || "none"
    }`,
    "",
    "## Latest proof artifacts",
    "",
    artifacts,
    "",
    "## Checklist",
    "",
    checklist,
    "",
    "## Blockers",
    "",
    ...(report.blockers.length > 0 ? report.blockers.map((blocker) => `- ${blocker}`) : ["- None"]),
    "",
  ].join("\n");
}

export function buildBookWriterHandoffReport(now = new Date()): BookWriterHandoffReport {
  const intendedSet = new Set<string>(BOOK_WRITER_INTENDED_FILES);
  const entries = gitStatusEntries();
  const intended = entries.filter((entry) => intendedSet.has(entry.path));
  const unrelated = entries.filter((entry) => !intendedSet.has(entry.path));
  const artifacts = latestArtifacts();
  const hasCoreProof = Boolean(artifacts.smokeSummary && artifacts.completionAuditJson);
  const originMainPort = buildOriginMainPortStatus();
  const blockers = [
    "Real KDP final submit remains approval-gated and was not clicked.",
    ...(unrelated.length > 0
      ? ["Worktree contains unrelated dirty files; keep them out of Book Studio review/ship scope."]
      : []),
    ...(!hasCoreProof ? ["Latest Book Writer smoke or completion audit artifact is missing."] : []),
    ...(originMainPort.status === "blocked"
      ? [
          "origin/main direct patching is blocked; port the complete Book Writer and Control UI baselines before opening the ship PR.",
        ]
      : []),
  ];
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    status: !hasCoreProof
      ? "needs-proof"
      : unrelated.length > 0
        ? "mixed-worktree"
        : "ready-for-review",
    intendedFiles: [...BOOK_WRITER_INTENDED_FILES],
    dirtyState: { intended, unrelated },
    proofCommands: [...REQUIRED_PROOF_COMMANDS],
    originMainPort,
    latestArtifacts: artifacts,
    checklist: [
      {
        item: "Book Studio intended files isolated from unrelated dirty worktree state.",
        status: unrelated.length > 0 ? "blocked" : "done",
        evidence: [
          `${intended.length} intended dirty entries`,
          `${unrelated.length} unrelated dirty entries`,
        ],
      },
      {
        item: "Real dashboard smoke receipt is available.",
        status: artifacts.smokeSummary ? "done" : "blocked",
        evidence: [artifacts.smokeSummary ?? "missing"],
      },
      {
        item: "Completion audit receipt is available.",
        status: artifacts.completionAuditJson ? "done" : "blocked",
        evidence: [artifacts.completionAuditJson ?? "missing"],
      },
      {
        item: "Origin-main direct-port baseline is available.",
        status: originMainPort.status === "ready" ? "done" : "blocked",
        evidence: [
          originMainPort.summary,
          `missing=${originMainPort.missingRequiredBaselines.join(",") || "none"}`,
        ],
      },
      {
        item: "Final KDP submit remains approval-gated.",
        status: "blocked",
        evidence: ["No real KDP final submit is part of this handoff."],
      },
    ],
    blockers,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const output = readArgValue(args, "--output") ?? DEFAULT_OUTPUT;
  const markdown = readArgValue(args, "--markdown") ?? output.replace(/\.json$/, ".md");
  const report = buildBookWriterHandoffReport();
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(dirname(markdown), { recursive: true });
  writeScopedReviewArtifacts(report, output);
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdown, renderMarkdown(report));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "needs-proof" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
