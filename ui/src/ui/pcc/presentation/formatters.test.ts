import { describe, expect, it } from "vitest";
import { formatPccProjectDate, formatPccStatus, formatPccUpdatedAt } from "./formatters.ts";

describe("PCC presentation formatters", () => {
  it("formats stable labels without allocating a formatter per call", () => {
    expect(formatPccStatus("complete_with_maintenance")).toBe("Complete With Maintenance");
    expect(formatPccStatus("complete_with_maintenance")).toBe("Complete With Maintenance");
    expect(formatPccStatus(undefined)).toBe("Not recorded");
  });

  it("preserves fallback behavior for missing and invalid dates", () => {
    expect(formatPccProjectDate(undefined)).toBe("No due date");
    expect(formatPccProjectDate("not-a-date")).toBe("not-a-date");
    expect(formatPccUpdatedAt(null)).toBe("Not loaded yet");
  });
});
