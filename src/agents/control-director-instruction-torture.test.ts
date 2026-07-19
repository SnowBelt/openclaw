import { describe, expect, it } from "vitest";
import {
  controlDirectorInstructionTortureCases,
  runControlDirectorInstructionTortureSuite,
} from "./control-director-instruction-torture.js";

describe("Control Director instruction-following torture suite", () => {
  it.each(controlDirectorInstructionTortureCases())("passes $id", (testCase) => {
    expect(testCase.run()).toBe(true);
  });

  it("accepts only at 98% or better with zero critical omissions and at least 50 cases", () => {
    const report = runControlDirectorInstructionTortureSuite();
    expect(report.total).toBeGreaterThanOrEqual(50);
    expect(report.passRate).toBeGreaterThanOrEqual(98);
    expect(report.criticalOmissions).toBe(0);
    expect(report.accepted).toBe(true);
  });
});
