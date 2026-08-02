import { assertOperationsSnapshotV2Integrity } from "../../../../packages/gateway-protocol/src/operations-snapshot-integrity.js";
// Operations Room controller keeps snapshot reads and guarded actions in one
// place so every view follows the same confirmation and refresh contract.
import type { OperationsSnapshotV1Result } from "../../../../packages/gateway-protocol/src/schema/types.js";
import type {
  OperationsActionKind,
  OperationsActionPreview,
  OperationsActionReceipt,
  OperationsSnapshot,
} from "../../../../src/operations/types.js";
import { t } from "../../i18n/index.ts";
import { GatewayRequestError, type GatewayBrowserClient } from "../gateway.ts";
import { adaptOperationsSnapshotV1 } from "./operations-compat.ts";

export type OperationsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  operationsLoading: boolean;
  operationsActionBusy: boolean;
  operationsError: string | null;
  operationsActionNotice: string | null;
  operationsActionNoticeTone: "info" | "success" | null;
  operationsSnapshot: OperationsSnapshot | null;
  operationsUpdatedAt: number | null;
  operationsLastSuccessfulAt: number | null;
  operationsRefreshFailedAt: number | null;
};

const operationsRequestSequence = new WeakMap<object, number>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnsupportedOperationsV2(err: unknown): boolean {
  if (!(err instanceof GatewayRequestError) || err.gatewayCode !== "INVALID_REQUEST") {
    return false;
  }
  const message = err.message.toLowerCase();
  return (
    message.includes("unknown method: operations.snapshot.v2") ||
    message.includes("method not found: operations.snapshot.v2")
  );
}

async function requestOperationsSnapshot(
  client: GatewayBrowserClient,
  includeProcesses: boolean,
): Promise<OperationsSnapshot> {
  try {
    const snapshot = await client.request<OperationsSnapshot>("operations.snapshot.v2", {
      includeProcesses,
    });
    assertOperationsSnapshotV2Integrity(snapshot);
    return snapshot;
  } catch (err) {
    if (!isUnsupportedOperationsV2(err)) {
      throw err;
    }
  }
  const legacy = await client.request<OperationsSnapshotV1Result>("operations.snapshot", {
    includeProcesses,
  });
  const snapshot = adaptOperationsSnapshotV1(legacy);
  assertOperationsSnapshotV2Integrity(snapshot);
  return snapshot;
}

export async function loadOperationsRoom(
  state: OperationsState,
  opts?: { quiet?: boolean; includeProcesses?: boolean },
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  const requestSequence = (operationsRequestSequence.get(state) ?? 0) + 1;
  operationsRequestSequence.set(state, requestSequence);
  const isLatestRequest = () => operationsRequestSequence.get(state) === requestSequence;
  if (!opts?.quiet) {
    state.operationsLoading = true;
    state.operationsError = null;
    state.operationsActionNotice = null;
    state.operationsActionNoticeTone = null;
  }
  try {
    const snapshot = await requestOperationsSnapshot(
      state.client,
      opts?.includeProcesses !== false,
    );
    if (!isLatestRequest()) {
      return;
    }
    state.operationsSnapshot = snapshot;
    state.operationsUpdatedAt = snapshot.generatedAt;
    state.operationsLastSuccessfulAt = Date.now();
    state.operationsRefreshFailedAt = null;
    state.operationsError = null;
  } catch (err) {
    if (!isLatestRequest()) {
      return;
    }
    state.operationsError = errorMessage(err);
    state.operationsRefreshFailedAt = Date.now();
  } finally {
    if (isLatestRequest()) {
      state.operationsLoading = false;
    }
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
  state.operationsActionNoticeTone = null;
  try {
    const preview = await state.client.request<OperationsActionPreview>(
      "operations.action.preview",
      { action: params.action, targetId: params.targetId },
    );
    // Investigation only records bounded local-AI/Judge evidence and never
    // mutates runtime state, so the primary one-click action does not add a
    // second confirmation dialog. All repair actions still use the caller's
    // explicit confirmation callback.
    const confirmed =
      preview.action === "remediation.investigate" ? true : await params.confirm(preview);
    if (!confirmed) {
      state.operationsActionNotice = t("operationsRoom.actions.cancelled");
      state.operationsActionNoticeTone = "info";
      return;
    }
    const receipt = await state.client.request<OperationsActionReceipt>("operations.action.apply", {
      token: preview.token,
      action: preview.action,
      targetId: preview.targetId,
    });
    if (receipt.status !== "applied") {
      state.operationsError = receipt.summary;
      return;
    }
    state.operationsActionNotice = receipt.summary;
    state.operationsActionNoticeTone = "success";
    await loadOperationsRoom(state, { quiet: true });
  } catch (err) {
    state.operationsError = errorMessage(err);
  } finally {
    state.operationsActionBusy = false;
  }
}
