/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  focusOperationsSection,
  operationsSectionFromUrl,
  operationsSectionTargetId,
  updateOperationsSectionUrl,
} from "./operations-navigation.ts";

describe("Operations Room navigation", () => {
  it("round-trips valid section state without disturbing other query parameters", () => {
    const initial = new URL("https://control.example/operations?gateway=local");
    const next = updateOperationsSectionUrl(initial, "attention");

    expect(next.searchParams.get("gateway")).toBe("local");
    expect(operationsSectionFromUrl(next)).toBe("attention");
    expect(operationsSectionFromUrl(updateOperationsSectionUrl(next, null))).toBeNull();
  });

  it("rejects unknown section values", () => {
    expect(
      operationsSectionFromUrl(new URL("https://control.example/operations?section=unknown")),
    ).toBeNull();
  });

  it("scrolls and focuses the requested section", () => {
    const target = document.createElement("section");
    target.id = operationsSectionTargetId("working");
    target.tabIndex = -1;
    target.scrollIntoView = () => undefined;
    document.body.append(target);

    expect(focusOperationsSection("working")).toBe(true);
    expect(document.activeElement).toBe(target);
    target.remove();
  });
});
