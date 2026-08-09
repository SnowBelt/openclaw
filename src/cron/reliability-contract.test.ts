import { describe, expect, it } from "vitest";
import {
  createLegacyScheduledProgramReliabilityContract,
  parseScheduledProgramReliabilityContract,
  scheduledProgramIdempotencyKey,
  type ScheduledProgramReliabilityContractV1,
} from "./reliability-contract.js";

function contract(
  patch: Partial<ScheduledProgramReliabilityContractV1> = {},
): ScheduledProgramReliabilityContractV1 {
  return {
    version: 1,
    programId: "pattern-lab.daily",
    ownerAgentId: "publisher-scheduler",
    criticality: "high",
    maxLatenessMs: 300_000,
    catchUpPolicy: "run_latest",
    idempotencyScope: "schedule_window",
    resourceClaims: [{ resource: "local-model", mode: "exclusive" }],
    sideEffectClass: "external_reversible",
    approvalClass: "automatic",
    preflight: ["model_ready", "resources_ready"],
    completionProof: ["task_terminal", "artifact_digest"],
    ...patch,
  };
}

describe("scheduled program reliability contract", () => {
  it("parses a closed version-one contract", () => {
    expect(parseScheduledProgramReliabilityContract(contract())).toEqual(contract());
  });

  it("derives distinct idempotency identities for run, window, and program scopes", () => {
    const key = (idempotencyScope: ScheduledProgramReliabilityContractV1["idempotencyScope"]) =>
      scheduledProgramIdempotencyKey({
        contract: { programId: "program", idempotencyScope },
        flowId: "flow",
        scheduledFor: 100,
      });
    expect(key("run")).toBe("program:run:flow:100");
    expect(key("schedule_window")).toBe("program:window:100");
    expect(key("program")).toBe("program");
  });

  it("fails closed on unknown authority, malformed resources, and missing proof", () => {
    expect(
      parseScheduledProgramReliabilityContract({ ...contract(), approvalClass: "root" }),
    ).toBeUndefined();
    expect(
      parseScheduledProgramReliabilityContract({
        ...contract(),
        resourceClaims: [{ resource: "local-model", mode: "steal" }],
      }),
    ).toBeUndefined();
    expect(
      parseScheduledProgramReliabilityContract({ ...contract(), completionProof: [] }),
    ).toBeUndefined();
    expect(
      parseScheduledProgramReliabilityContract({
        ...contract(),
        approvalClass: "automatic",
        sideEffectClass: "external_irreversible",
      }),
    ).toBeUndefined();
  });

  it("keeps legacy jobs operator-owned and manual", () => {
    expect(
      createLegacyScheduledProgramReliabilityContract({ jobId: "legacy", ownerAgentId: "agent" }),
    ).toMatchObject({
      programId: "cron:legacy",
      ownerAgentId: "agent",
      catchUpPolicy: "manual",
      approvalClass: "operator",
      sideEffectClass: "external_irreversible",
    });
  });
});
