/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPERATIONS_OWNER_ACCEPTANCE_SCHEMA,
  OperationsOwnerAcceptance,
  operationsOwnerAcceptanceConfigFromUrl,
  type OperationsOwnerAcceptanceFacts,
  type OperationsOwnerAcceptanceReceipt,
} from "./operations-owner-acceptance.ts";

const config = {
  campaignId: "or2-owner-ui",
  candidateSha: "a".repeat(40),
  fixtureSha256: "b".repeat(64),
  participantId: "c".repeat(64),
};

const facts: OperationsOwnerAcceptanceFacts = {
  localAiProcessCount: 2,
  openClawWorkingCount: 0,
  primaryIssueId: "finding-1",
  primaryIssueNextAction: "Review the recorded blocker.",
  primaryIssueOwner: "main",
  primaryStatus: "urgent",
  snapshotGeneratedAt: Date.parse("2026-07-29T19:00:00.000Z"),
};

function buttonWithText(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((entry) =>
    entry.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing button: ${text}`);
  }
  return button;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("Operations Room owner acceptance", () => {
  it("accepts only one exact, fully bound campaign query", () => {
    const url = new URL("https://control.example/operations");
    url.searchParams.set("ownerAcceptance", "1");
    for (const [key, value] of Object.entries(config)) {
      url.searchParams.set(key, value);
    }
    expect(operationsOwnerAcceptanceConfigFromUrl(url.href)).toEqual(config);

    url.searchParams.append("candidateSha", config.candidateSha);
    expect(operationsOwnerAcceptanceConfigFromUrl(url.href)).toBeNull();
    expect(operationsOwnerAcceptanceConfigFromUrl("https://control.example/operations")).toBeNull();
  });

  it("starts only on Begin and creates a bounded machine-readable receipt on Finish", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T19:00:01.000Z"));
    const element = document.createElement(
      "operations-owner-acceptance",
    ) as OperationsOwnerAcceptance;
    element.config = config;
    element.facts = facts;
    document.body.append(element);
    await element.updateComplete;

    expect(element.textContent).toContain("Begin 60-second check");
    expect(element.textContent).not.toContain("seconds left");

    buttonWithText(element, "Begin 60-second check").click();
    await element.updateComplete;
    expect(element.textContent).toContain("60");
    expect(element.textContent).toContain("seconds left");

    buttonWithText(element, "Overall: Urgent").click();
    buttonWithText(element, "OpenClaw: 0 · Local AI: 2").click();
    buttonWithText(element, "main — Review the recorded blocker.").click();
    globalThis.dispatchEvent(
      new CustomEvent("openclaw-operations-resolution-opened", {
        detail: { findingId: "finding-1" },
      }),
    );
    globalThis.dispatchEvent(
      new CustomEvent("openclaw-operations-resolution-deferred", {
        detail: { findingId: "finding-1" },
      }),
    );
    await element.updateComplete;

    vi.advanceTimersByTime(12_500);
    await element.updateComplete;
    const receiptPromise = new Promise<OperationsOwnerAcceptanceReceipt>((resolve) => {
      element.addEventListener(
        "operations-owner-acceptance-receipt",
        (event) => resolve((event as CustomEvent<OperationsOwnerAcceptanceReceipt>).detail),
        { once: true },
      );
    });
    buttonWithText(element, "Finish and create receipt").click();
    const receipt = await receiptPromise;

    expect(receipt).toMatchObject({
      schema: OPERATIONS_OWNER_ACCEPTANCE_SCHEMA,
      ...config,
      elapsedMs: 12_500,
      hintCount: 0,
      unsafeActionCount: 0,
      ownerAttested: true,
      result: "passed",
      outcomes: {
        issueDetailsAndOwnerOrNext: true,
        localAiDistinctionCorrect: true,
        overallStateCorrect: true,
        resolvePreviewAndSafeCancel: true,
        workingItemIdentified: true,
      },
    });
    expect(element.textContent).toContain("Owner check passed");
    expect(element.querySelector('a[download$=".json"]')).not.toBeNull();
  });

  it("records an incorrect answer as a failed attempt instead of allowing replacement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T19:00:01.000Z"));
    const element = document.createElement(
      "operations-owner-acceptance",
    ) as OperationsOwnerAcceptance;
    element.config = config;
    element.facts = facts;
    document.body.append(element);
    await element.updateComplete;

    buttonWithText(element, "Begin 60-second check").click();
    await element.updateComplete;
    buttonWithText(element, "Overall: Up to date").click();
    buttonWithText(element, "OpenClaw: 0 · Local AI: 2").click();
    buttonWithText(element, "main — Review the recorded blocker.").click();
    globalThis.dispatchEvent(
      new CustomEvent("openclaw-operations-resolution-deferred", {
        detail: { findingId: "finding-1" },
      }),
    );
    await element.updateComplete;
    buttonWithText(element, "Finish and create receipt").click();
    await element.updateComplete;

    expect(element.textContent).toContain("Owner check did not pass");
    expect(element.textContent).not.toContain("Begin 60-second check");
  });

  it("keeps Download available when one-click clipboard copy is unavailable", async () => {
    const element = document.createElement(
      "operations-owner-acceptance",
    ) as OperationsOwnerAcceptance;
    element.config = config;
    element.facts = facts;
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("unavailable");
        }),
      },
    });
    document.body.append(element);
    await element.updateComplete;
    buttonWithText(element, "Begin 60-second check").click();
    await element.updateComplete;
    buttonWithText(element, "Overall: Urgent").click();
    buttonWithText(element, "OpenClaw: 0 · Local AI: 2").click();
    buttonWithText(element, "main — Review the recorded blocker.").click();
    globalThis.dispatchEvent(
      new CustomEvent("openclaw-operations-resolution-deferred", {
        detail: { findingId: "finding-1" },
      }),
    );
    await element.updateComplete;
    buttonWithText(element, "Finish and create receipt").click();
    await element.updateComplete;
    buttonWithText(element, "Copy receipt").click();
    await vi.waitFor(() => expect(element.textContent).toContain("Copy was unavailable"));
    await element.updateComplete;
    expect(element.querySelector('a[download$=".json"]')).not.toBeNull();
  });
});
