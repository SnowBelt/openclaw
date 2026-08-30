import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  withSelfImprovementStoreMutation,
  writeSelfImprovementJsonAtomically,
} from "./json-store.js";
import { isSelfImprovementJsonToSqliteMigrationApplied } from "./ledger-migration.js";
import { listSelfImprovementLedgerRows, replaceSelfImprovementLedgerRows } from "./ledger.js";
import { sanitizeRecommendationText, sanitizeRecommendationTexts } from "./text.js";
import type {
  SelfImprovementCurationConfidence,
  SelfImprovementCurationFreshness,
  SelfImprovementCurationPrivacy,
  SelfImprovementCurationReview,
  SelfImprovementCurationSourceClass,
  SelfImprovementCuratorStatus,
  SelfImprovementProposal,
  SelfImprovementProposalKind,
  SelfImprovementProposalStatus,
  SelfImprovementProposalStoreFile,
  SelfImprovementRecommendationGroup,
} from "./types.js";

const STORE_VERSION = 1;
const STORE_DIR = "self-improvement";
const STORE_FILENAME = "proposals.json";
const MAX_PROPOSALS = 1_000;

function proposalId(value: string): string {
  return `sip_${crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function cloneProposal(proposal: SelfImprovementProposal): SelfImprovementProposal {
  return structuredClone(proposal);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isProposalStatus(value: unknown): value is SelfImprovementProposalStatus {
  return (
    value === "pending" ||
    value === "acknowledged" ||
    value === "approved" ||
    value === "rejected" ||
    value === "superseded"
  );
}

function isProposalKind(value: unknown): value is SelfImprovementProposalKind {
  return (
    value === "implementation" ||
    value === "verification" ||
    value === "sequencing" ||
    value === "memory_skill" ||
    value === "user_synthesis" ||
    value === "major_change" ||
    value === "agentless_alternative"
  );
}

function isCuratorStatus(value: unknown): value is SelfImprovementCuratorStatus {
  return (
    value === "pending_review" ||
    value === "accepted_for_workshop" ||
    value === "rejected" ||
    value === "needs_more_evidence" ||
    value === "superseded" ||
    value === "promoted"
  );
}

function isWorkshopProposalStatus(
  value: unknown,
): value is NonNullable<SelfImprovementProposal["workshopProposalStatus"]> {
  return (
    value === "pending" || value === "quarantined" || value === "applied" || value === "rejected"
  );
}

const CURATION_SOURCE_CLASSES: readonly SelfImprovementCurationSourceClass[] = [
  "task",
  "task_group",
  "cron_job",
  "skill_workshop",
  "skill_workshop_queue",
  "project_health",
  "configuration",
  "agent",
  "instruction",
  "workflow",
  "knowledge",
  "architecture",
  "risk",
  "outcome",
];

function isCurationSourceClass(value: unknown): value is SelfImprovementCurationSourceClass {
  return (
    typeof value === "string" &&
    CURATION_SOURCE_CLASSES.some((sourceClass) => sourceClass === value)
  );
}

function isCurationConfidence(value: unknown): value is SelfImprovementCurationConfidence {
  return value === "low" || value === "medium" || value === "high";
}

function isCurationFreshness(value: unknown): value is SelfImprovementCurationFreshness {
  return value === "current" || value === "stale_risk" || value === "unknown";
}

function isCurationPrivacy(value: unknown): value is SelfImprovementCurationPrivacy {
  return (
    value === "shared_safe" || value === "private_reference_only" || value === "blocked_sensitive"
  );
}

function parseCurationReview(value: unknown): SelfImprovementCurationReview | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .map((entry) => {
          if (!isRecord(entry) || !isCurationSourceClass(entry.sourceClass)) {
            return null;
          }
          const sourceRef = sanitizeRecommendationText(entry.sourceRef, 160);
          if (!sourceRef) {
            return null;
          }
          const observedAt =
            typeof entry.observedAt === "number" && Number.isFinite(entry.observedAt)
              ? Math.max(0, Math.floor(entry.observedAt))
              : undefined;
          return {
            sourceClass: entry.sourceClass,
            sourceRef,
            ...(observedAt !== undefined ? { observedAt } : {}),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .slice(0, 8)
    : [];
  const reason = sanitizeRecommendationText(value.reason, 360);
  const nextAction = sanitizeRecommendationText(value.nextAction, 240);
  if (
    evidence.length === 0 ||
    !isCurationConfidence(value.confidence) ||
    !isCurationFreshness(value.freshness) ||
    !isCurationPrivacy(value.privacy) ||
    typeof value.contradiction !== "boolean" ||
    !reason ||
    !nextAction ||
    typeof value.reviewedAt !== "number" ||
    !Number.isFinite(value.reviewedAt)
  ) {
    return undefined;
  }
  return {
    evidence,
    confidence: value.confidence,
    freshness: value.freshness,
    privacy: value.privacy,
    contradiction: value.contradiction,
    reason,
    nextAction,
    reviewedAt: Math.max(0, Math.floor(value.reviewedAt)),
  };
}

function parseCuratorDispatch(value: unknown): SelfImprovementProposal["curatorDispatch"] {
  if (!isRecord(value)) {
    return undefined;
  }
  const status = value.status;
  if (
    status !== "pending" &&
    status !== "running" &&
    status !== "succeeded" &&
    status !== "failed"
  ) {
    return undefined;
  }
  const attempts =
    typeof value.attempts === "number" && Number.isFinite(value.attempts)
      ? Math.max(0, Math.floor(value.attempts))
      : 0;
  const lastAttemptAt =
    typeof value.lastAttemptAt === "number" && Number.isFinite(value.lastAttemptAt)
      ? Math.max(0, Math.floor(value.lastAttemptAt))
      : undefined;
  const nextAttemptAt =
    typeof value.nextAttemptAt === "number" && Number.isFinite(value.nextAttemptAt)
      ? Math.max(0, Math.floor(value.nextAttemptAt))
      : undefined;
  const error = sanitizeRecommendationText(value.error, 240);
  return {
    status,
    attempts,
    ...(lastAttemptAt !== undefined ? { lastAttemptAt } : {}),
    ...(nextAttemptAt !== undefined ? { nextAttemptAt } : {}),
    ...(error ? { error } : {}),
  };
}

function parseWorkshopDraft(value: unknown): SelfImprovementProposal["workshopDraft"] {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = sanitizeRecommendationText(value.id, 160);
  const title = sanitizeRecommendationText(value.title, 220);
  const sourceProposalId = sanitizeRecommendationText(value.sourceProposalId, 160);
  const agentId = sanitizeRecommendationText(value.agentId, 120);
  const status = value.status;
  if (
    !id ||
    !title ||
    !sourceProposalId ||
    !agentId ||
    (status !== "pending" &&
      status !== "quarantined" &&
      status !== "applied" &&
      status !== "rejected") ||
    typeof value.createdAt !== "number" ||
    typeof value.updatedAt !== "number"
  ) {
    return undefined;
  }
  return {
    id,
    status,
    title,
    sourceProposalId,
    agentId,
    createdAt: Math.max(0, Math.floor(value.createdAt)),
    updatedAt: Math.max(0, Math.floor(value.updatedAt)),
  };
}

function parseProposal(value: unknown): SelfImprovementProposal | null {
  if (!isRecord(value) || typeof value.id !== "string" || !isProposalStatus(value.status)) {
    return null;
  }
  const proposal = value as Partial<SelfImprovementProposal> & Record<string, unknown>;
  if (!isProposalKind(proposal.kind) || typeof proposal.groupKey !== "string") {
    return null;
  }
  const id = value.id;
  const status = value.status;
  const kind = proposal.kind;
  const groupKey = proposal.groupKey;
  const route = proposal.route as SelfImprovementProposal["route"];
  const curationReview = parseCurationReview(proposal.curationReview);
  const curatorDispatch = parseCuratorDispatch(proposal.curatorDispatch);
  const workshopDraft = parseWorkshopDraft(proposal.workshopDraft);
  return {
    ...(proposal as SelfImprovementProposal),
    id,
    status,
    kind,
    groupKey: sanitizeRecommendationText(groupKey, 240),
    title: sanitizeRecommendationText(proposal.title, 220) || "Self-improvement proposal",
    summary: sanitizeRecommendationText(proposal.summary, 640),
    route: {
      ...route,
      reason: sanitizeRecommendationText(route?.reason, 240),
    },
    recommendedAction: sanitizeRecommendationText(proposal.recommendedAction, 640),
    requiredEvidence: sanitizeRecommendationTexts(
      Array.isArray(proposal.requiredEvidence) ? proposal.requiredEvidence : [],
      260,
    ),
    safetyNotes: sanitizeRecommendationTexts(
      Array.isArray(proposal.safetyNotes) ? proposal.safetyNotes : [],
      240,
    ),
    ...(typeof proposal.approvalProof === "string"
      ? { approvalProof: sanitizeRecommendationText(proposal.approvalProof, 640) }
      : {}),
    ...(typeof proposal.dismissalReason === "string"
      ? { dismissalReason: sanitizeRecommendationText(proposal.dismissalReason, 360) }
      : {}),
    ...(isCuratorStatus(proposal.curatorStatus)
      ? { curatorStatus: proposal.curatorStatus }
      : proposal.kind === "memory_skill"
        ? { curatorStatus: "pending_review" as const }
        : {}),
    ...(typeof proposal.curatorProof === "string"
      ? { curatorProof: sanitizeRecommendationText(proposal.curatorProof, 640) }
      : {}),
    ...(typeof proposal.curatorReason === "string"
      ? { curatorReason: sanitizeRecommendationText(proposal.curatorReason, 360) }
      : {}),
    ...(typeof proposal.curatorUpdatedAt === "number" && Number.isFinite(proposal.curatorUpdatedAt)
      ? { curatorUpdatedAt: Math.max(0, Math.floor(proposal.curatorUpdatedAt)) }
      : {}),
    ...(curationReview ? { curationReview } : {}),
    ...(curatorDispatch ? { curatorDispatch } : {}),
    ...(typeof proposal.workshopProposalId === "string"
      ? { workshopProposalId: sanitizeRecommendationText(proposal.workshopProposalId, 160) }
      : {}),
    ...(isWorkshopProposalStatus(proposal.workshopProposalStatus)
      ? { workshopProposalStatus: proposal.workshopProposalStatus }
      : {}),
    ...(workshopDraft ? { workshopDraft } : {}),
    ...(typeof proposal.promotionProof === "string"
      ? { promotionProof: sanitizeRecommendationText(proposal.promotionProof, 640) }
      : {}),
  };
}

function normalizeProposalForStore(proposal: SelfImprovementProposal): SelfImprovementProposal {
  const normalized = parseProposal(proposal);
  if (!normalized) {
    throw new Error("Invalid self-improvement proposal.");
  }
  return normalized;
}

function normalizeStore(value: unknown): SelfImprovementProposalStoreFile {
  if (!isRecord(value) || !Array.isArray(value.proposals)) {
    return { version: STORE_VERSION, proposals: [] };
  }
  return {
    version: STORE_VERSION,
    proposals: value.proposals
      .map(parseProposal)
      .filter((entry): entry is SelfImprovementProposal => Boolean(entry)),
  };
}

async function readStore(
  storePath: string,
  stateDir?: string,
): Promise<SelfImprovementProposalStoreFile> {
  if (stateDir && (await isSelfImprovementJsonToSqliteMigrationApplied({ stateDir }))) {
    const rows = await listSelfImprovementLedgerRows<SelfImprovementProposal>({
      collection: "proposals",
      stateDir,
    });
    return {
      version: STORE_VERSION,
      proposals: rows
        .map((row) => parseProposal(row.value))
        .filter((entry): entry is SelfImprovementProposal => Boolean(entry)),
    };
  }
  try {
    return normalizeStore(JSON.parse(await fs.readFile(storePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: STORE_VERSION, proposals: [] };
    }
    throw error;
  }
}

async function writeStore(
  storePath: string,
  file: SelfImprovementProposalStoreFile,
  stateDir?: string,
): Promise<void> {
  if (stateDir && (await isSelfImprovementJsonToSqliteMigrationApplied({ stateDir }))) {
    await replaceSelfImprovementLedgerRows({
      collection: "proposals",
      stateDir,
      rows: file.proposals,
      id: (proposal) => proposal.id,
      createdAt: (proposal) => proposal.createdAt,
      updatedAt: (proposal) => proposal.updatedAt,
    });
    return;
  }
  await writeSelfImprovementJsonAtomically(storePath, file);
}

function proposalKindForGroup(
  group: SelfImprovementRecommendationGroup,
): SelfImprovementProposalKind {
  if (group.category === "major_change" || group.category === "capability_evolution") {
    return "major_change";
  }
  if (group.category === "agent_minimization" || group.category === "workflow_simplification") {
    return "agentless_alternative";
  }
  switch (group.route.role) {
    case "builder":
      return "implementation";
    case "qa":
      return "verification";
    case "memory_curator":
      return "memory_skill";
    case "todd":
      return "user_synthesis";
    case "program_manager":
      return "sequencing";
    default:
      return "implementation";
  }
}

function proposalSafetyNotes(group: SelfImprovementRecommendationGroup): string[] {
  return [
    "Recommendation-only; no direct merge, push, release, or destructive file action.",
    group.requiresTests
      ? "Code/config follow-up requires test or smoke evidence before resolution."
      : "Tests are required if the follow-up changes code or configuration.",
    group.requiresApproval
      ? "Operator approval is required before risky or production-affecting changes."
      : "Route through the target owner before implementation.",
    group.category === "skill_workshop" || group.route.role === "memory_curator"
      ? "Skill or memory updates must remain pending until explicitly approved."
      : "No uncontrolled memory or skill writes.",
  ];
}

function proposalTitle(
  kind: SelfImprovementProposalKind,
  group: SelfImprovementRecommendationGroup,
): string {
  switch (kind) {
    case "implementation":
      return `Implementation proposal: ${group.title}`;
    case "verification":
      return `Verification proposal: ${group.title}`;
    case "memory_skill":
      return `Pending memory/skill proposal: ${group.title}`;
    case "user_synthesis":
      return `User-facing synthesis proposal: ${group.title}`;
    case "major_change":
      return `Major-change proposal: ${group.title}`;
    case "agentless_alternative":
      return `Agentless workflow proposal: ${group.title}`;
    case "sequencing":
      return `Sequencing proposal: ${group.title}`;
    default:
      return `Implementation proposal: ${group.title}`;
  }
}

export function buildSelfImprovementProposalsFromGroups(params: {
  groups: readonly SelfImprovementRecommendationGroup[];
  now?: number;
  limit?: number;
}): SelfImprovementProposal[] {
  const now = params.now ?? Date.now();
  const limit = params.limit && params.limit > 0 ? params.limit : params.groups.length;
  return params.groups.slice(0, limit).map((group) => {
    const kind = proposalKindForGroup(group);
    const id = proposalId(`${group.id}:${kind}`);
    const summary = sanitizeRecommendationText(group.analysis.summary, 600);
    return {
      id,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      kind,
      groupId: group.id,
      groupKey: group.groupKey,
      title: proposalTitle(kind, group),
      summary,
      route: group.route,
      sourceRecommendationIds: [...group.recommendationIds],
      recommendedAction: sanitizeRecommendationText(group.recommendedAction, 600),
      requiredEvidence: sanitizeRecommendationTexts(
        [
          ...group.topEvidence.slice(0, 4),
          group.requiresTests ? "Verification proof before resolving this proposal." : "",
          group.requiresApproval ? "Explicit operator approval before risky follow-up." : "",
        ].filter(Boolean),
        220,
      ),
      safetyNotes: proposalSafetyNotes(group),
      approvalRequired: group.requiresApproval,
      testsRequired: group.requiresTests,
      analysisMode: group.analysis.mode,
    };
  });
}

export function resolveSelfImprovementProposalStorePath(stateDir = resolveStateDir()): string {
  return path.join(stateDir, STORE_DIR, STORE_FILENAME);
}

export async function listSelfImprovementProposals(params?: {
  stateDir?: string;
  storePath?: string;
  status?: readonly SelfImprovementProposalStatus[];
  kind?: readonly SelfImprovementProposalKind[];
  limit?: number;
}): Promise<SelfImprovementProposal[]> {
  const stateDir = params?.storePath ? undefined : (params?.stateDir ?? resolveStateDir());
  const storePath = params?.storePath ?? resolveSelfImprovementProposalStorePath(stateDir);
  const file = await readStore(storePath, stateDir);
  const status = params?.status ? new Set(params.status) : null;
  const kind = params?.kind ? new Set(params.kind) : null;
  const limit = params?.limit && params.limit > 0 ? params.limit : file.proposals.length;
  return file.proposals
    .filter(
      (proposal) => (!status || status.has(proposal.status)) && (!kind || kind.has(proposal.kind)),
    )
    .toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map(cloneProposal);
}

export async function getSelfImprovementProposal(params: {
  id: string;
  stateDir?: string;
  storePath?: string;
}): Promise<SelfImprovementProposal | null> {
  const id = params.id.trim();
  if (!id) {
    return null;
  }
  const proposals = await listSelfImprovementProposals(params);
  return proposals.find((proposal) => proposal.id === id) ?? null;
}

export async function upsertSelfImprovementProposals(params: {
  proposals: readonly SelfImprovementProposal[];
  stateDir?: string;
  storePath?: string;
}): Promise<{
  proposals: SelfImprovementProposal[];
  created: number;
  updated: number;
  createdProposalIds: string[];
}> {
  const stateDir = params.storePath ? undefined : (params.stateDir ?? resolveStateDir());
  const storePath = params.storePath ?? resolveSelfImprovementProposalStorePath(stateDir);
  return await withSelfImprovementStoreMutation(storePath, async () => {
    const file = await readStore(storePath, stateDir);
    const incomingProposals = params.proposals.map(normalizeProposalForStore);
    const byId = new Map(file.proposals.map((proposal) => [proposal.id, cloneProposal(proposal)]));
    let created = 0;
    let updated = 0;
    const createdProposalIds: string[] = [];
    for (const proposal of incomingProposals) {
      const existing = byId.get(proposal.id);
      if (!existing) {
        created += 1;
        createdProposalIds.push(proposal.id);
        byId.set(proposal.id, cloneProposal(proposal));
        continue;
      }
      updated += 1;
      const safetyNotes = Array.from(new Set([...proposal.safetyNotes, ...existing.safetyNotes]));
      byId.set(proposal.id, {
        ...cloneProposal(proposal),
        createdAt: existing.createdAt,
        status: existing.status,
        safetyNotes,
        ...(existing.dismissalReason ? { dismissalReason: existing.dismissalReason } : {}),
        ...(existing.approvalProof ? { approvalProof: existing.approvalProof } : {}),
        ...(existing.curatorStatus ? { curatorStatus: existing.curatorStatus } : {}),
        ...(existing.curatorProof ? { curatorProof: existing.curatorProof } : {}),
        ...(existing.curatorReason ? { curatorReason: existing.curatorReason } : {}),
        ...(existing.curatorUpdatedAt ? { curatorUpdatedAt: existing.curatorUpdatedAt } : {}),
        ...(existing.curationReview ? { curationReview: existing.curationReview } : {}),
        ...(existing.curatorDispatch ? { curatorDispatch: existing.curatorDispatch } : {}),
        ...(existing.workshopProposalId ? { workshopProposalId: existing.workshopProposalId } : {}),
        ...(existing.workshopProposalStatus
          ? { workshopProposalStatus: existing.workshopProposalStatus }
          : {}),
        ...(existing.workshopDraft ? { workshopDraft: existing.workshopDraft } : {}),
        ...(existing.promotionProof ? { promotionProof: existing.promotionProof } : {}),
      });
    }
    const proposals = [...byId.values()]
      .toSorted(
        (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
      )
      .slice(0, MAX_PROPOSALS);
    await writeStore(storePath, { version: STORE_VERSION, proposals }, stateDir);
    return {
      proposals: proposals.map(cloneProposal),
      created,
      updated,
      createdProposalIds,
    };
  });
}

export async function updateSelfImprovementProposalStatus(params: {
  id: string;
  status: SelfImprovementProposalStatus;
  approvalProof?: string;
  dismissalReason?: string;
  note?: string;
  stateDir?: string;
  storePath?: string;
  now?: number;
}): Promise<SelfImprovementProposal | null> {
  const stateDir = params.storePath ? undefined : (params.stateDir ?? resolveStateDir());
  const storePath = params.storePath ?? resolveSelfImprovementProposalStorePath(stateDir);
  return await withSelfImprovementStoreMutation(storePath, async () => {
    const file = await readStore(storePath, stateDir);
    const now = params.now ?? Date.now();
    let updated: SelfImprovementProposal | null = null;
    const proposals = file.proposals.map((proposal) => {
      if (proposal.id !== params.id.trim()) {
        return proposal;
      }
      const approvalProof = sanitizeRecommendationText(params.approvalProof, 640);
      const dismissalReason = sanitizeRecommendationText(params.dismissalReason, 360);
      const note = sanitizeRecommendationText(params.note, 220);
      updated = {
        ...proposal,
        status: params.status,
        updatedAt: now,
        ...(approvalProof ? { approvalProof } : {}),
        ...(dismissalReason ? { dismissalReason } : {}),
        ...(note
          ? {
              safetyNotes: [...proposal.safetyNotes, note],
            }
          : {}),
      };
      return updated;
    });
    if (!updated) {
      return null;
    }
    await writeStore(storePath, { version: STORE_VERSION, proposals }, stateDir);
    return cloneProposal(updated);
  });
}

export async function updateSelfImprovementCuratorStatus(params: {
  id: string;
  curatorStatus: SelfImprovementCuratorStatus;
  expectedUpdatedAt?: number;
  expectedCuratorStatus?: SelfImprovementCuratorStatus;
  proof?: string;
  reason?: string;
  workshopProposalId?: string;
  workshopProposalStatus?: NonNullable<SelfImprovementProposal["workshopProposalStatus"]>;
  review?: SelfImprovementCurationReview;
  note?: string;
  stateDir?: string;
  storePath?: string;
  now?: number;
}): Promise<SelfImprovementProposal | null> {
  const stateDir = params.storePath ? undefined : (params.stateDir ?? resolveStateDir());
  const storePath = params.storePath ?? resolveSelfImprovementProposalStorePath(stateDir);
  return await withSelfImprovementStoreMutation(storePath, async () => {
    const file = await readStore(storePath, stateDir);
    const now = params.now ?? Date.now();
    const review = params.review ? parseCurationReview(params.review) : undefined;
    if (params.review && !review) {
      throw new Error("invalid curator curation review");
    }
    let updated: SelfImprovementProposal | null = null;
    let conflict = false;
    const proposals = file.proposals.map((proposal) => {
      if (proposal.id !== params.id.trim()) {
        return proposal;
      }
      if (
        (params.expectedUpdatedAt !== undefined &&
          proposal.updatedAt !== params.expectedUpdatedAt) ||
        (params.expectedCuratorStatus !== undefined &&
          (proposal.curatorStatus ?? "pending_review") !== params.expectedCuratorStatus)
      ) {
        conflict = true;
        return proposal;
      }
      if (proposal.kind !== "memory_skill") {
        throw new Error("curator updates are only allowed for memory_skill proposals");
      }
      const proof = sanitizeRecommendationText(params.proof, 640);
      const reason = sanitizeRecommendationText(params.reason, 360);
      const workshopProposalId = sanitizeRecommendationText(params.workshopProposalId, 160);
      const note = sanitizeRecommendationText(params.note, 220);
      const workshopId =
        workshopProposalId ||
        proposal.workshopProposalId ||
        `swp_${crypto.createHash("sha256").update(proposal.id).digest("hex").slice(0, 16)}`;
      const workshopDraft =
        params.curatorStatus === "accepted_for_workshop"
          ? (proposal.workshopDraft ?? {
              id: workshopId,
              status: "pending" as const,
              title: `Curator workshop: ${proposal.title}`,
              sourceProposalId: proposal.id,
              agentId: proposal.route.targetAgentId,
              createdAt: now,
              updatedAt: now,
            })
          : proposal.workshopDraft;
      updated = {
        ...proposal,
        updatedAt: now,
        curatorUpdatedAt: now,
        curatorStatus: params.curatorStatus,
        ...(proof && params.curatorStatus === "promoted" ? { promotionProof: proof } : {}),
        ...(proof && params.curatorStatus !== "promoted" ? { curatorProof: proof } : {}),
        ...(reason ? { curatorReason: reason } : {}),
        ...(params.curatorStatus === "accepted_for_workshop"
          ? { workshopProposalId: workshopId, workshopProposalStatus: "pending" as const }
          : workshopProposalId
            ? { workshopProposalId }
            : {}),
        ...(params.workshopProposalStatus
          ? { workshopProposalStatus: params.workshopProposalStatus }
          : {}),
        ...(review ? { curationReview: review } : {}),
        ...(workshopDraft ? { workshopDraft } : {}),
        ...(note ? { safetyNotes: [...proposal.safetyNotes, note] } : {}),
      };
      return updated;
    });
    if (!updated || conflict) {
      return null;
    }
    await writeStore(storePath, { version: STORE_VERSION, proposals }, stateDir);
    return cloneProposal(updated);
  });
}

export async function updateSelfImprovementCuratorDispatch(params: {
  id: string;
  status: NonNullable<SelfImprovementProposal["curatorDispatch"]>["status"];
  attempts?: number;
  lastAttemptAt?: number;
  nextAttemptAt?: number;
  error?: string;
  stateDir?: string;
  storePath?: string;
  now?: number;
}): Promise<SelfImprovementProposal | null> {
  const stateDir = params.storePath ? undefined : (params.stateDir ?? resolveStateDir());
  const storePath = params.storePath ?? resolveSelfImprovementProposalStorePath(stateDir);
  return await withSelfImprovementStoreMutation(storePath, async () => {
    const file = await readStore(storePath, stateDir);
    const now = params.now ?? Date.now();
    let updated: SelfImprovementProposal | null = null;
    const proposals = file.proposals.map((proposal) => {
      if (proposal.id !== params.id.trim() || proposal.kind !== "memory_skill") {
        return proposal;
      }
      const attempts = Math.max(
        0,
        Math.floor(params.attempts ?? proposal.curatorDispatch?.attempts ?? 0),
      );
      const error = sanitizeRecommendationText(params.error, 240);
      updated = {
        ...proposal,
        updatedAt: now,
        curatorDispatch: {
          status: params.status,
          attempts,
          ...(params.lastAttemptAt !== undefined ? { lastAttemptAt: params.lastAttemptAt } : {}),
          ...(params.nextAttemptAt !== undefined ? { nextAttemptAt: params.nextAttemptAt } : {}),
          ...(error ? { error } : {}),
        },
      };
      return updated;
    });
    if (!updated) {
      return null;
    }
    await writeStore(storePath, { version: STORE_VERSION, proposals }, stateDir);
    return cloneProposal(updated);
  });
}
