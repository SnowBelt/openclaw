/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../../test-helpers/storage.ts";
import { loadOperationsPreferences, saveOperationsPreferences } from "./operations-preferences.ts";

describe("Operations Room preferences", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips browser-local pins, sort, and last-visit time", () => {
    saveOperationsPreferences({
      agentSort: "recent",
      lastVisitedAt: 1234,
      pinnedAgentIds: ["main", "writer", "main"],
    });

    expect(loadOperationsPreferences()).toEqual({
      agentSort: "recent",
      lastVisitedAt: 1234,
      pinnedAgentIds: ["main", "writer"],
    });
  });

  it("fails closed to defaults for malformed storage", () => {
    localStorage.setItem("openclaw.operations.preferences.v1", "not-json");
    expect(loadOperationsPreferences()).toEqual({
      agentSort: "priority",
      lastVisitedAt: null,
      pinnedAgentIds: [],
    });
  });
});
