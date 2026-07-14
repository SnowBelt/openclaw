import { describe, expect, it } from "vitest";
import {
  PCC_CAPABILITY_ADDITION_STANDARDS,
  PCC_CUSTOM_RUNTIME_ADDITION_STANDARD_IDS,
  PCC_WORKFLOW_ADDITION_STANDARD_IDS,
} from "./capability-addition-registry.js";
import { validatePccCapabilityAddition } from "./capability-standards.js";

describe("PCC capability addition standards registry", () => {
  it("gives every registered addition a complete, deterministic standard", () => {
    const ids = PCC_CAPABILITY_ADDITION_STANDARDS.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(PCC_CAPABILITY_ADDITION_STANDARDS.flatMap(validatePccCapabilityAddition)).toEqual([]);
    expect(ids).toEqual(expect.arrayContaining(PCC_WORKFLOW_ADDITION_STANDARD_IDS));
    expect(ids).toEqual(expect.arrayContaining(PCC_CUSTOM_RUNTIME_ADDITION_STANDARD_IDS));
  });
});
