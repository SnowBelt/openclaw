import type { ControlDirectorJourneySignalCode } from "./control-director-journeys.js";

/** Persisted, proof-bound closure state for one typed Control Director journey. */
export type ControlDirectorJourneyClosure = {
  schemaVersion: 1;
  recommendationId: string;
  signalCode: ControlDirectorJourneySignalCode;
  owner: string;
  slaAt: number;
  observation: { startedAt: number; endedAt: number; minimumDurationMs: number };
  recurrenceCount: number;
  targetRecurrenceCount: number;
  lastRecurrenceAt?: number;
  proofReceiptId: string;
  judgeReceiptId: string;
  closedAt: number;
  status: "closed" | "reopened";
  reopenReason?: string;
};
