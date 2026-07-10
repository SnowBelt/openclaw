import { describe, expect, it } from "vitest";
import {
  buildBookWriterHandoffReport,
  buildBookWriterScopedPatch,
} from "../../scripts/dev/control-ui-book-writer-handoff.ts";

describe("control-ui-book-writer-handoff", () => {
  it("separates Book Studio scope from unrelated dirty state and lists proof surfaces", () => {
    const report = buildBookWriterHandoffReport(new Date("2026-07-07T17:10:00.000Z"));

    expect(report.generatedAt).toBe("2026-07-07T17:10:00.000Z");
    expect(report.intendedFiles).toContain("ui/src/ui/views/book-writer-dashboard.ts");
    expect(report.intendedFiles).toContain("scripts/dev/control-ui-book-writer-local-smoke.ts");
    expect(report.proofCommands).toEqual(
      expect.arrayContaining([
        "pnpm ui:smoke:book-writer",
        "pnpm ui:smoke:book-writer:audit -- --smoke-summary <summary.json>",
      ]),
    );
    expect(report.checklist.map((item) => item.item)).toContain(
      "Book Studio intended files isolated from unrelated dirty worktree state.",
    );
    expect(report.checklist.map((item) => item.item)).toContain(
      "Origin-main direct-port baseline is available.",
    );
    expect(report.originMainPort.ref).toBe("origin/main");
    expect(report.originMainPort.summary).toMatch(/origin\/main|Book Studio/);
    expect(report.blockers).toContain(
      "Real KDP final submit remains approval-gated and was not clicked.",
    );
    expect(
      report.dirtyState.intended.every((entry) => report.intendedFiles.includes(entry.path)),
    ).toBe(true);
    expect(
      report.dirtyState.unrelated.every((entry) => !report.intendedFiles.includes(entry.path)),
    ).toBe(true);
  });

  it("builds a scoped patch that excludes unrelated dirty paths", () => {
    const report = buildBookWriterHandoffReport(new Date("2026-07-07T17:10:00.000Z"));
    const patch = buildBookWriterScopedPatch(report);

    expect(patch).toContain("ui/src/ui/views/book-writer-dashboard.ts");
    for (const unrelated of report.dirtyState.unrelated) {
      expect(patch).not.toContain(unrelated.path);
    }
  });
});
