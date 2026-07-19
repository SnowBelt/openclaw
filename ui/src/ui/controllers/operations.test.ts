import { describe, expect, it, vi } from "vitest";
import type {
  OperationsActionPreview,
  OperationsActionReceipt,
  OperationsSnapshot,
} from "../types.ts";
import {
  loadOperationsRoom,
  runGuardedOperationsAction,
  type OperationsState,
} from "./operations.ts";

function state(request: ReturnType<typeof vi.fn>): OperationsState {
  return {
    client: { request } as unknown as OperationsState["client"],
    connected: true,
    operationsLoading: false,
    operationsActionBusy: false,
    operationsError: null,
    operationsActionNotice: null,
    operationsSnapshot: null,
    operationsUpdatedAt: null,
  };
}

describe("Operations Room controller", () => {
  it("loads a snapshot and records refresh time", async () => {
    const snapshot = { schema: "openclaw.operations-room.v1" } as OperationsSnapshot;
    const request = vi.fn(async () => snapshot);
    const host = state(request);

    await loadOperationsRoom(host, { includeProcesses: false });

    expect(request).toHaveBeenCalledWith("operations.snapshot", { includeProcesses: false });
    expect(host.operationsSnapshot).toBe(snapshot);
    expect(host.operationsError).toBeNull();
    expect(host.operationsUpdatedAt).toEqual(expect.any(Number));
  });

  it("previews, confirms, applies, and refreshes a guarded action", async () => {
    const preview: OperationsActionPreview = {
      token: "preview-1",
      action: "cron.disable",
      targetId: "cron-1",
      summary: "Pause cron-1.",
      risk: "high",
      expiresAt: Date.now() + 60_000,
      requiresConfirmation: true,
    };
    const receipt: OperationsActionReceipt = {
      action: preview.action,
      targetId: preview.targetId,
      status: "applied",
      summary: "Paused cron-1.",
      appliedAt: Date.now(),
    };
    const snapshot = { schema: "openclaw.operations-room.v1" } as OperationsSnapshot;
    const request = vi
      .fn()
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce(receipt)
      .mockResolvedValueOnce(snapshot);
    const host = state(request);
    const confirm = vi.fn(async () => true);

    await runGuardedOperationsAction(host, {
      action: preview.action,
      targetId: preview.targetId,
      confirm,
    });

    expect(confirm).toHaveBeenCalledWith(preview);
    expect(request.mock.calls).toEqual([
      ["operations.action.preview", { action: "cron.disable", targetId: "cron-1" }],
      [
        "operations.action.apply",
        { token: "preview-1", action: "cron.disable", targetId: "cron-1" },
      ],
      ["operations.snapshot", { includeProcesses: true }],
    ]);
    expect(host.operationsActionNotice).toBe("Paused cron-1.");
    expect(host.operationsActionBusy).toBe(false);
  });

  it("does not apply an action when confirmation is declined", async () => {
    const preview = {
      token: "preview-1",
      action: "flow.cancel",
      targetId: "flow-1",
      summary: "Cancel flow-1.",
      risk: "high",
      expiresAt: Date.now() + 60_000,
      requiresConfirmation: true,
    } satisfies OperationsActionPreview;
    const request = vi.fn(async () => preview);
    const host = state(request);

    await runGuardedOperationsAction(host, {
      action: preview.action,
      targetId: preview.targetId,
      confirm: () => false,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(host.operationsActionNotice).toBe("Action cancelled. Nothing changed.");
  });
});
