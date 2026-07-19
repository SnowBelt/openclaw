// Operations Room controller keeps snapshot reads and guarded actions in one
// place so every view follows the same confirmation and refresh contract.
import type {
  OperationsActionKind,
  OperationsActionPreview,
  OperationsActionReceipt,
  OperationsSnapshot,
} from "../../../../src/operations/types.js";
import type { GatewayBrowserClient } from "../gateway.ts";

export type OperationsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  operationsLoading: boolean;
  operationsActionBusy: boolean;
  operationsError: string | null;
  operationsActionNotice: string | null;
  operationsSnapshot: OperationsSnapshot | null;
  operationsUpdatedAt: number | null;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function loadOperationsRoom(
  state: OperationsState,
  opts?: { quiet?: boolean; includeProcesses?: boolean },
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (!opts?.quiet) {
    state.operationsLoading = true;
    state.operationsError = null;
  }
  try {
    state.operationsSnapshot = await state.client.request<OperationsSnapshot>(
      "operations.snapshot",
      { includeProcesses: opts?.includeProcesses !== false },
    );
    state.operationsUpdatedAt = Date.now();
    state.operationsError = null;
  } catch (err) {
    state.operationsError = errorMessage(err);
  } finally {
    state.operationsLoading = false;
  }
}

export async function runGuardedOperationsAction(
  state: OperationsState,
  params: {
    action: OperationsActionKind;
    targetId: string;
    confirm: (preview: OperationsActionPreview) => boolean | Promise<boolean>;
  },
): Promise<void> {
  if (!state.client || !state.connected || state.operationsActionBusy) {
    return;
  }
  state.operationsActionBusy = true;
  state.operationsError = null;
  state.operationsActionNotice = null;
  try {
    const preview = await state.client.request<OperationsActionPreview>(
      "operations.action.preview",
      { action: params.action, targetId: params.targetId },
    );
    if (!(await params.confirm(preview))) {
      state.operationsActionNotice = "Action cancelled. Nothing changed.";
      return;
    }
    const receipt = await state.client.request<OperationsActionReceipt>("operations.action.apply", {
      token: preview.token,
      action: preview.action,
      targetId: preview.targetId,
    });
    state.operationsActionNotice = receipt.summary;
    await loadOperationsRoom(state, { quiet: true });
  } catch (err) {
    state.operationsError = errorMessage(err);
  } finally {
    state.operationsActionBusy = false;
  }
}
