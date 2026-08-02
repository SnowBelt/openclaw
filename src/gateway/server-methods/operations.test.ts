import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetOperationsActionPreviewsForTests } from "../../operations/action-guard.js";
import { operationsHandlers } from "./operations.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

type RespondCall = [boolean, unknown?, { message?: string }?];

function context(overrides: Record<string, unknown> = {}) {
  return {
    getRuntimeConfig: () => ({}),
    loadGatewayModelCatalog: vi.fn(async () => []),
    getEventLoopHealth: () => undefined,
    logGateway: { warn: vi.fn() },
    cron: {
      list: vi.fn(async () => []),
      readJob: vi.fn(async () => ({ id: "cron-1" })),
      update: vi.fn(async () => ({ ok: true })),
      enqueueRun: vi.fn(async () => ({ ok: true, enqueued: true })),
    },
    ...overrides,
  };
}

async function invoke(
  method: keyof typeof operationsHandlers,
  params: Record<string, unknown>,
  contextValue = context(),
): Promise<{ call: RespondCall; context: ReturnType<typeof context> }> {
  const respond = vi.fn();
  const handler = operationsHandlers[method];
  expect(handler).toBeTruthy();
  await handler({
    req: { type: "req", id: "operations-1", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: respond as unknown as GatewayRequestHandlerOptions["respond"],
    context: contextValue as unknown as GatewayRequestHandlerOptions["context"],
  });
  expect(respond).toHaveBeenCalledTimes(1);
  return { call: respond.mock.calls[0] as RespondCall, context: contextValue };
}

describe("Operations Room gateway methods", () => {
  beforeEach(() => resetOperationsActionPreviewsForTests());

  it("keeps the legacy snapshot method and exposes V2 separately", () => {
    expect(operationsHandlers["operations.snapshot"]).toBeTypeOf("function");
    expect(operationsHandlers["operations.snapshot.v2"]).toBeTypeOf("function");
  });

  it("rejects unsupported actions before touching runtime state", async () => {
    const result = await invoke("operations.action.preview", {
      action: "process.kill",
      targetId: "42",
    });
    expect(result.call[0]).toBe(false);
    expect(result.call[2]?.message).toContain("invalid operations.action.preview params");
  });

  it("uses an exact single-use preview before changing a schedule", async () => {
    const previewCall = await invoke("operations.action.preview", {
      action: "cron.disable",
      targetId: "cron-1",
    });
    expect(previewCall.call[0]).toBe(true);
    const preview = previewCall.call[1] as { token: string };
    const runtime = context();

    const applyCall = await invoke(
      "operations.action.apply",
      { token: preview.token, action: "cron.disable", targetId: "cron-1" },
      runtime,
    );
    expect(applyCall.call[0]).toBe(true);
    expect(runtime.cron.update).toHaveBeenCalledWith("cron-1", { enabled: false });
    expect(applyCall.call[1]).toMatchObject({ status: "applied" });

    const replayCall = await invoke(
      "operations.action.apply",
      { token: preview.token, action: "cron.disable", targetId: "cron-1" },
      runtime,
    );
    expect(replayCall.call[0]).toBe(false);
    expect(replayCall.call[2]?.message).toContain("already used");
    expect(runtime.cron.update).toHaveBeenCalledTimes(1);
  });

  it("previews investigation as a bounded low-risk action", async () => {
    const result = await invoke("operations.action.preview", {
      action: "remediation.investigate",
      targetId: "plugin:example:failed",
    });

    expect(result.call[0]).toBe(true);
    expect(result.call[1]).toMatchObject({
      action: "remediation.investigate",
      targetId: "plugin:example:failed",
      risk: "low",
      requiresConfirmation: true,
    });
    expect((result.call[1] as { summary: string }).summary).toContain("No runtime change");
  });
});
