/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomRuntimeUpdatePolicy, UpdateAvailable } from "../api/types.ts";
import { i18n } from "../i18n/index.ts";
import "./update-banner.ts";

const localStorageValues = vi.hoisted(() => new Map<string, string>());

vi.mock("../local-storage.ts", () => ({
  getSafeLocalStorage: () => ({
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    removeItem: (key: string) => localStorageValues.delete(key),
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
  }),
}));

type UpdateBannerElement = HTMLElement & {
  props: {
    statusBanner: null;
    updateAvailable: UpdateAvailable | null;
    updateRunning: boolean;
    updateSafety: CustomRuntimeUpdatePolicy;
    connected: boolean;
    onUpdate: (approvalSha?: string) => void;
    onDismiss: () => void;
  };
  updateComplete: Promise<boolean>;
};

const candidateSha = "c".repeat(40);

function readyPolicy(): CustomRuntimeUpdatePolicy {
  return {
    managedRuntime: true,
    standardUpdateBlocked: true,
    sourceDurable: true,
    sourceDurabilityReason: "durable",
    backupConfigured: true,
    backupStatus: "ready",
    backupStatusReason: "verified",
    approvalPending: true,
    pendingCandidateSha: candidateSha,
    preparationRunning: false,
    preparationStatus: "ready",
    preparationReason: "ready-for-approval",
    sourceSha: "a".repeat(40),
    sourceRepo: "/source.git",
    sourceBranch: `refs/provenance/${"a".repeat(40)}`,
    runtimeRoot: "/release",
    pointerPath: "/runtime-home/active-runtime.json",
    reason: "managed",
  };
}

async function renderBanner(updateAvailable: UpdateAvailable | null) {
  const onUpdate = vi.fn();
  const onDismiss = vi.fn();
  const element = document.createElement("openclaw-update-banner") as UpdateBannerElement;
  element.props = {
    statusBanner: null,
    updateAvailable,
    updateRunning: false,
    updateSafety: readyPolicy(),
    connected: true,
    onUpdate,
    onDismiss,
  };
  document.body.append(element);
  await element.updateComplete;
  return { element, onDismiss, onUpdate };
}

beforeEach(async () => {
  await i18n.setLocale("en");
  localStorageValues.clear();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("update banner", () => {
  it("keeps an exact prepared candidate installable without generic update metadata", async () => {
    const { element, onUpdate } = await renderBanner(null);

    const button = element.querySelector<HTMLButtonElement>(".update-banner__btn");
    expect(button?.textContent?.trim()).toBe("Install verified update");
    expect(element.textContent).toContain(candidateSha.slice(0, 12));
    expect(element.querySelector(".update-banner__close")).toBeNull();

    button?.click();
    expect(onUpdate).toHaveBeenCalledWith(candidateSha);
  });

  it("does not let a dismissed generic update hide an exact prepared candidate", async () => {
    const updateAvailable = {
      currentVersion: "2026.6.8",
      latestVersion: "2026.6.11",
      channel: "latest",
    } satisfies UpdateAvailable;
    localStorageValues.set(
      "openclaw:control-ui:update-banner-dismissed:v1",
      JSON.stringify({
        latestVersion: updateAvailable.latestVersion,
        channel: updateAvailable.channel,
        dismissedAtMs: Date.now(),
      }),
    );

    const { element, onDismiss } = await renderBanner(updateAvailable);

    expect(
      element.querySelector<HTMLButtonElement>(".update-banner__btn")?.textContent?.trim(),
    ).toBe("Install verified update");
    expect(element.querySelector(".update-banner__close")).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
