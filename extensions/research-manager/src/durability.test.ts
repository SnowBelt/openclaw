import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "../api.js";
import { ResearchFlowController } from "./durability.js";
import type { ResearchRunReport } from "./types.js";

function report(): ResearchRunReport {
  const now = new Date().toISOString();
  return {
    runId: "run-1",
    query: "Research this",
    mode: "certified",
    status: "queued",
    sources: [],
    claims: [],
    findings: [],
    attempts: [],
    gaps: [],
    createdAt: now,
    updatedAt: now,
    repairPasses: 0,
    localModelCalls: 0,
    remoteModelCalls: 0,
  };
}

describe("ResearchFlowController", () => {
  it("tracks revisions across running, waiting, and cancellation transitions", async () => {
    let revision = 1;
    const flow = () => ({ flowId: "flow-1", revision });
    const createManaged = vi.fn(() => flow());
    const resume = vi.fn((params: { expectedRevision: number }) => {
      expect(params.expectedRevision).toBe(revision);
      revision += 1;
      return { applied: true, flow: flow() };
    });
    const setWaiting = vi.fn((params: { expectedRevision: number }) => {
      expect(params.expectedRevision).toBe(revision);
      revision += 1;
      return { applied: true, flow: flow() };
    });
    const cancel = vi.fn(async () => ({ found: true, cancelled: true, flow: flow(), tasks: [] }));
    const taskFlow = {
      createManaged,
      resume,
      setWaiting,
      cancel,
      finish: vi.fn(),
      fail: vi.fn(),
    };
    const api = {
      config: {},
      runtime: {
        tasks: { managedFlows: { fromToolContext: () => taskFlow } },
      },
    } as unknown as OpenClawPluginApi;
    const controller = ResearchFlowController.create({
      api,
      ctx: { sessionKey: "agent:main" } as OpenClawPluginToolContext,
      report: report(),
    });
    expect(controller?.flowId).toBe("flow-1");
    controller?.update("planning", { ...report(), status: "planning" });
    controller?.wait({ ...report(), status: "blocked" }, "model busy");
    await controller?.cancel();
    expect(createManaged).toHaveBeenCalledWith(
      expect.objectContaining({ controllerId: "research-manager", notifyPolicy: "done_only" }),
    );
    expect(resume).toHaveBeenCalledOnce();
    expect(setWaiting).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith({ flowId: "flow-1", cfg: {} });
  });

  it("does not create a managed flow without a session key", () => {
    const api = { runtime: { tasks: { managedFlows: {} } } } as unknown as OpenClawPluginApi;
    expect(
      ResearchFlowController.create({
        api,
        ctx: {} as OpenClawPluginToolContext,
        report: report(),
      }),
    ).toBeUndefined();
  });
});
