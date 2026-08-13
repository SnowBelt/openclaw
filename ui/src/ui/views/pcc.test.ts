/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { EMPTY_PCC_STATE } from "../pcc/application/model.ts";
import { renderPcc, type PccProps } from "./pcc.ts";

function createProps(overrides: Partial<PccProps> = {}): PccProps {
  return {
    state: {
      ...EMPTY_PCC_STATE,
      projects: [],
      milestones: [],
    },
    connected: true,
    canWrite: true,
    onRefresh: vi.fn(),
    onSelectProject: vi.fn(),
    onCreateProject: vi.fn(),
    onStartPlan: vi.fn(),
    onGoalAction: vi.fn(),
    onStartOwnerAcceptance: vi.fn(),
    onFinishOwnerAcceptance: vi.fn(),
    onCancelOwnerAcceptance: vi.fn(),
    ...overrides,
  };
}

describe("renderPcc", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await i18n.setLocale("en");
  });

  it("shows a useful empty state and connection affordance", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(renderPcc(createProps({ connected: false })), container);

    expect(container.querySelector(".pcc-page")?.getAttribute("aria-label")).toBe(
      "Project Command Center",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Connect");
    expect(container.querySelector(".pcc-empty h2")?.textContent).toBe("Start your first project");
  });

  it("renders milestones, progress, and planning status without hiding blockers", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderPcc(
        createProps({
          state: {
            ...EMPTY_PCC_STATE,
            projects: [
              {
                id: "p1",
                title: "MVP",
                status: "active",
                percentComplete: 50,
                milestoneCounts: {
                  total: 2,
                  complete: 1,
                  blocked: 1,
                  needsApproval: 0,
                  deferred: 0,
                  skipped: 0,
                },
                nextActions: [],
                proofGaps: [],
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ],
            selectedProjectId: "p1",
            project: {
              id: "p1",
              title: "MVP",
              goal: "Ship it",
              status: "active",
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
            milestones: [
              {
                id: "m1",
                projectId: "p1",
                title: "Verify",
                status: "blocked",
                blocker: "Needs a receipt",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ],
            summary: {
              id: "p1",
              title: "MVP",
              status: "active",
              percentComplete: 50,
              milestoneCounts: {
                total: 2,
                complete: 1,
                blocked: 1,
                needsApproval: 0,
                deferred: 0,
                skipped: 0,
              },
              nextActions: [],
              proofGaps: [],
              updatedAt: "2026-01-01T00:00:00Z",
            },
            planningRun: {
              schemaVersion: 1,
              id: "run-1",
              requestFingerprint: "fp",
              surface: "project_creation",
              status: "running",
              stage: "planner_running",
              model: "local",
              effort: "medium",
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".pcc-progress strong")?.textContent).toBe("50%");
    expect(container.querySelector(".pcc-milestone__blocker")?.textContent).toContain(
      "Needs a receipt",
    );
    expect(container.querySelector(".pcc-run")?.textContent).toContain("run-1");
    expect(container.querySelector("#pcc-proof-title")?.textContent).toContain(
      "Evidence and next steps",
    );
    expect(container.querySelector("#pcc-goal-controls-title")?.textContent).toContain(
      "Guided work loop",
    );
    expect(container.querySelector(".pcc-goal-controls .btn.primary")?.textContent).toContain(
      "Pause",
    );
  });

  it("renders an explicit owner-acceptance timer when the final milestone needs the owner", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderPcc(
        createProps({
          state: {
            ...EMPTY_PCC_STATE,
            project: {
              id: "p1",
              title: "MVP",
              goal: "Ship it",
              status: "active",
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
            selectedProjectId: "p1",
            milestones: [
              {
                id: "owner",
                projectId: "p1",
                title: "Anonymous owner acceptance",
                status: "needs_approval",
                blocker: "Owner must complete one zero-hint 60-second protocol.",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ],
            ownerAcceptance: { ...EMPTY_PCC_STATE.ownerAcceptance },
          },
        }),
      ),
      container,
    );

    const card = container.querySelector(".pcc-owner-acceptance");
    expect(card?.textContent).toContain("Owner acceptance");
    expect(card?.textContent).toContain("Begin 60-second acceptance");
    expect(card?.querySelector("button")?.textContent).toContain("Begin");
  });

  it("keeps recording disabled until the full owner timer has elapsed", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderPcc(
        createProps({
          state: {
            ...EMPTY_PCC_STATE,
            project: {
              id: "p1",
              title: "MVP",
              goal: "Ship it",
              status: "active",
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
            milestones: [
              {
                id: "owner",
                projectId: "p1",
                title: "Owner usability",
                status: "needs_approval",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ],
            ownerAcceptance: {
              ...EMPTY_PCC_STATE.ownerAcceptance,
              state: "running",
              startedAt: Date.now(),
              elapsedMs: 30_000,
              participantHash: "a".repeat(64),
              attempt: 1,
            },
          },
        }),
      ),
      container,
    );

    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>(".pcc-owner-acceptance button"),
    ];
    expect(buttons.some((button) => button.textContent?.includes("Record acceptance"))).toBe(true);
    expect(
      buttons.find((button) => button.textContent?.includes("Record acceptance"))?.disabled,
    ).toBe(true);
    expect(container.querySelector('[role="timer"]')?.textContent).toContain("30");
  });
});
