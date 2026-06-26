/* @vitest-environment jsdom */

import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderPccDashboard, type PccDashboardProps } from "./pcc.ts";

function createProps(overrides: Partial<PccDashboardProps> = {}): PccDashboardProps {
  return {
    loading: false,
    error: null,
    updatedAt: 1_772_000_000_000,
    portfolio: {
      projectsTotal: 1,
      active: 1,
      blocked: 0,
      needsApproval: 1,
      complete: 0,
      archived: 0,
      averagePercentComplete: 42,
      nextActions: ["Run remote proof"],
    },
    projects: [
      {
        id: "project-1",
        title: "Project Command Center",
        status: "needs_approval",
        percentComplete: 42,
        milestoneCounts: {
          total: 5,
          complete: 2,
          blocked: 0,
          needsApproval: 1,
          deferred: 0,
          skipped: 0,
        },
        nextActions: ["Run remote proof"],
        proofGaps: ["Workflow Sanity proof"],
        updatedAt: "2026-06-26T00:00:00Z",
      },
    ],
    onRefresh: () => undefined,
    ...overrides,
  };
}

function renderView(props: PccDashboardProps): HTMLElement {
  const container = document.createElement("div");
  render(renderPccDashboard(props), container);
  return container;
}

afterEach(() => {
  render(html``, document.body);
});

describe("renderPccDashboard", () => {
  it("renders summary metrics and project cards", () => {
    const container = renderView(createProps());
    const text = container.textContent ?? "";

    expect(text).toContain("Project Command Center");
    expect(text).toContain("Total projects");
    expect(text).toContain("Average completion");
    expect(text).toContain("42% complete");
    expect(text).toContain("Run remote proof");
    expect(text).toContain("Workflow Sanity proof");
    expect(container.querySelectorAll("[data-pcc-project-card]")).toHaveLength(1);
  });

  it("renders an empty state", () => {
    const container = renderView(
      createProps({
        projects: [],
        portfolio: {
          projectsTotal: 0,
          active: 0,
          blocked: 0,
          needsApproval: 0,
          complete: 0,
          archived: 0,
          averagePercentComplete: 0,
          nextActions: [],
        },
      }),
    );

    expect(container.textContent).toContain("No projects yet");
    expect(container.querySelector("[data-pcc-empty]")).not.toBeNull();
  });

  it("renders an error state and keeps refresh usable", () => {
    const onRefresh = vi.fn();
    const container = renderView(createProps({ error: "gateway offline", onRefresh }));

    expect(container.textContent).toContain("Project Command Center unavailable");
    expect(container.textContent).toContain("gateway offline");
    container.querySelector<HTMLButtonElement>("button")?.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
