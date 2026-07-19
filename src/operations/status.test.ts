import { describe, expect, it } from "vitest";
import {
  capOperationsRows,
  operationsStatusForFindings,
  operationsStatusForTask,
  resetOperationsFindingHistoryForTests,
  scoreOperationsFindings,
  stampOperationsFindingHistory,
} from "./status.js";
import type { OperationsFinding } from "./types.js";

function finding(id: string, severity: OperationsFinding["severity"]): OperationsFinding {
  return {
    id,
    severity,
    category: "resource",
    title: id,
    detail: id,
    lastObservedAt: 1,
  };
}

describe("Operations Room status policy", () => {
  it("derives status and a deduplicated quality score", () => {
    expect(operationsStatusForFindings([])).toBe("healthy");
    expect(operationsStatusForFindings([finding("memory", "warning")])).toBe("degraded");
    expect(operationsStatusForFindings([finding("memory", "critical")])).toBe("blocked");
    expect(
      scoreOperationsFindings([
        finding("memory", "warning"),
        finding("memory", "warning"),
        finding("plugin", "critical"),
      ]),
    ).toBe(90);
  });

  it("caps public rows without changing their order", () => {
    expect(capOperationsRows([1, 2, 3], 2)).toEqual([1, 2]);
    expect(capOperationsRows([1, 2, 3], -1)).toEqual([]);
  });

  it("maps task runtime truth without inferring success from text", () => {
    expect(operationsStatusForTask("running")).toBe("working");
    expect(operationsStatusForTask("succeeded")).toBe("healthy");
    expect(operationsStatusForTask("succeeded", "blocked")).toBe("blocked");
    expect(operationsStatusForTask("timed_out")).toBe("failed");
    expect(operationsStatusForTask("mystery")).toBe("unknown");
  });

  it("keeps first-observed time stable while a finding remains active", () => {
    resetOperationsFindingHistoryForTests();
    const initial = stampOperationsFindingHistory([finding("memory", "warning")], 100);
    const repeated = stampOperationsFindingHistory([finding("memory", "warning")], 200);

    expect(initial[0]).toMatchObject({ firstObservedAt: 100, lastObservedAt: 100 });
    expect(repeated[0]).toMatchObject({ firstObservedAt: 100, lastObservedAt: 200 });
  });
});
