import crypto from "node:crypto";
import { formatErrorMessage } from "../infra/errors.js";
import { createAsyncLock } from "../infra/json-files.js";
import { listSelfImprovementLedgerRows, upsertSelfImprovementLedgerRows } from "./ledger.js";
import { sanitizeRecommendationText } from "./text.js";

const withOutboxMutation = createAsyncLock();
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;

export type SelfImprovementOutboxKind = "signal_analysis";
export type SelfImprovementOutboxStatus = "pending" | "processing" | "completed" | "quarantined";

export type SelfImprovementOutboxItem = {
  id: string;
  kind: SelfImprovementOutboxKind;
  entityId: string;
  status: SelfImprovementOutboxStatus;
  createdAt: number;
  updatedAt: number;
  availableAt: number;
  attempts: number;
  leaseExpiresAt?: number;
  completedAt?: number;
  lastError?: string;
};

function outboxId(kind: SelfImprovementOutboxKind, entityId: string): string {
  return `sio_${crypto.createHash("sha256").update(`${kind}\n${entityId}`).digest("hex").slice(0, 20)}`;
}

async function writeItem(stateDir: string | undefined, item: SelfImprovementOutboxItem) {
  await upsertSelfImprovementLedgerRows({
    stateDir,
    collection: "outbox",
    rows: [item],
    id: (entry) => entry.id,
    createdAt: (entry) => entry.createdAt,
    updatedAt: (entry) => entry.updatedAt,
  });
}

export async function listSelfImprovementOutbox(params?: {
  stateDir?: string;
  status?: readonly SelfImprovementOutboxStatus[];
  kind?: SelfImprovementOutboxKind;
  limit?: number;
}): Promise<SelfImprovementOutboxItem[]> {
  const rows = await listSelfImprovementLedgerRows<SelfImprovementOutboxItem>({
    stateDir: params?.stateDir,
    collection: "outbox",
  });
  const statuses = params?.status ? new Set(params.status) : null;
  const limit = params?.limit && params.limit > 0 ? Math.floor(params.limit) : 2_000;
  return rows
    .map((row) => row.value)
    .filter((item) => !statuses || statuses.has(item.status))
    .filter((item) => !params?.kind || item.kind === params.kind)
    .toSorted(
      (left, right) => left.availableAt - right.availableAt || left.id.localeCompare(right.id),
    )
    .slice(0, limit);
}

export async function enqueueSelfImprovementOutbox(params: {
  kind: SelfImprovementOutboxKind;
  entityId: string;
  stateDir?: string;
  now?: number;
  availableAt?: number;
}): Promise<{ item: SelfImprovementOutboxItem; created: boolean }> {
  return await withOutboxMutation(async () => {
    const now = params.now ?? Date.now();
    const entityId = sanitizeRecommendationText(params.entityId, 180);
    if (!entityId) {
      throw new Error("Self-improvement outbox requires a non-empty entityId.");
    }
    const id = outboxId(params.kind, entityId);
    const existing = (await listSelfImprovementOutbox({ stateDir: params.stateDir })).find(
      (item) => item.id === id,
    );
    const item: SelfImprovementOutboxItem = {
      id,
      kind: params.kind,
      entityId,
      status: "pending",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      availableAt: Math.max(0, Math.floor(params.availableAt ?? now)),
      attempts: existing?.status === "processing" ? existing.attempts : 0,
    };
    await writeItem(params.stateDir, item);
    return { item, created: !existing };
  });
}

export type SelfImprovementOutboxReplayResult = {
  attempted: number;
  completed: number;
  retried: number;
  quarantined: number;
  skipped: number;
};

export async function replaySelfImprovementOutbox(params: {
  handler: (item: SelfImprovementOutboxItem) => Promise<void>;
  stateDir?: string;
  kind?: SelfImprovementOutboxKind;
  now?: number;
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
}): Promise<SelfImprovementOutboxReplayResult> {
  return await withOutboxMutation(async () => {
    const now = params.now ?? Date.now();
    const limit = params.limit && params.limit > 0 ? Math.floor(params.limit) : 100;
    const leaseMs = params.leaseMs && params.leaseMs > 0 ? params.leaseMs : DEFAULT_LEASE_MS;
    const maxAttempts =
      params.maxAttempts && params.maxAttempts > 0
        ? Math.floor(params.maxAttempts)
        : DEFAULT_MAX_ATTEMPTS;
    const items = await listSelfImprovementOutbox({
      stateDir: params.stateDir,
      kind: params.kind,
      status: ["pending", "processing"],
    });
    const eligible = items
      .filter(
        (item) =>
          (item.status === "pending" && item.availableAt <= now) ||
          (item.status === "processing" && (item.leaseExpiresAt ?? 0) <= now),
      )
      .slice(0, limit);
    const result: SelfImprovementOutboxReplayResult = {
      attempted: 0,
      completed: 0,
      retried: 0,
      quarantined: 0,
      skipped: Math.max(0, items.length - eligible.length),
    };
    for (const candidate of eligible) {
      const processing: SelfImprovementOutboxItem = {
        ...candidate,
        status: "processing",
        updatedAt: now,
        attempts: candidate.attempts + 1,
        leaseExpiresAt: now + leaseMs,
      };
      await writeItem(params.stateDir, processing);
      result.attempted += 1;
      try {
        await params.handler(structuredClone(processing));
        const {
          leaseExpiresAt: _leaseExpiresAt,
          lastError: _lastError,
          ...completedBase
        } = processing;
        await writeItem(params.stateDir, {
          ...completedBase,
          status: "completed",
          updatedAt: now,
          completedAt: now,
        });
        result.completed += 1;
      } catch (error) {
        const quarantined = processing.attempts >= maxAttempts;
        const backoffMs = Math.min(60 * 60_000, 2 ** Math.min(processing.attempts, 10) * 1_000);
        const { leaseExpiresAt: _leaseExpiresAt, ...retryBase } = processing;
        await writeItem(params.stateDir, {
          ...retryBase,
          status: quarantined ? "quarantined" : "pending",
          updatedAt: now,
          availableAt: quarantined ? now : now + backoffMs,
          lastError: sanitizeRecommendationText(formatErrorMessage(error), 640),
        });
        if (quarantined) {
          result.quarantined += 1;
        } else {
          result.retried += 1;
        }
      }
    }
    return result;
  });
}
