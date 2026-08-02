import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { detectMime, normalizeMimeType } from "@openclaw/media-core/mime";
import type {
  PccAttachment,
  PccAttachmentUsageReceipt,
  PccAttachmentUsageRecordParams,
  PccAttachmentsUpdateParams,
  PccAttachmentsUploadBeginParams,
} from "../../packages/gateway-protocol/src/index.js";
import { resolveStateDir } from "../config/paths.js";
import { readDurableJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { readPccLedger, withPccLedger } from "./ledger-store.js";
import {
  DEFAULT_PCC_PRIVATE_TEAM_POLICY,
  attachmentCapacityError,
  projectAttachmentUsage,
} from "./private-team-policy.js";

const UPLOAD_TTL_MS = 60 * 60 * 1_000;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const uploadLocks = new Map<string, Promise<void>>();

type PendingUpload = {
  schemaVersion: 1;
  id: string;
  request: PccAttachmentsUploadBeginParams;
  receivedBytes: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

async function withPccUploadLock<T>(lockKey: string, work: () => Promise<T>): Promise<T> {
  const previous = uploadLocks.get(lockKey) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.then(() => current);
  uploadLocks.set(lockKey, tail);
  await previous;
  try {
    return await work();
  } finally {
    releaseCurrent();
    if (uploadLocks.get(lockKey) === tail) {
      uploadLocks.delete(lockKey);
    }
  }
}

async function withUploadLock<T>(uploadId: string, work: () => Promise<T>): Promise<T> {
  return withPccUploadLock(`upload:${uploadId}`, work);
}

async function withProjectUploadLock<T>(
  projectId: string,
  env: NodeJS.ProcessEnv,
  work: () => Promise<T>,
): Promise<T> {
  return withPccUploadLock(`project:${uploadRoot(env)}:${projectId}`, work);
}

function attachmentRoot(env: NodeJS.ProcessEnv): string {
  return path.join(resolveStateDir(env), "pcc", "attachments");
}

function uploadRoot(env: NodeJS.ProcessEnv): string {
  return path.join(attachmentRoot(env), "uploads");
}

function blobRoot(env: NodeJS.ProcessEnv): string {
  return path.join(attachmentRoot(env), "blobs");
}

function assertUuid(value: string): void {
  if (!/^[a-f0-9-]{36}$/iu.test(value)) {
    throw new Error("invalid PCC attachment upload id");
  }
}

function uploadMetadataPath(uploadId: string, env: NodeJS.ProcessEnv): string {
  assertUuid(uploadId);
  return path.join(uploadRoot(env), `${uploadId}.json`);
}

function uploadDataPath(uploadId: string, env: NodeJS.ProcessEnv): string {
  assertUuid(uploadId);
  return path.join(uploadRoot(env), `${uploadId}.part`);
}

async function ensureRoots(env: NodeJS.ProcessEnv): Promise<void> {
  await Promise.all([
    fs.mkdir(uploadRoot(env), { recursive: true, mode: 0o700 }),
    fs.mkdir(blobRoot(env), { recursive: true, mode: 0o700 }),
  ]);
}

async function writePending(upload: PendingUpload, env: NodeJS.ProcessEnv): Promise<void> {
  await writeJsonAtomic(uploadMetadataPath(upload.id, env), upload, {
    mode: 0o600,
    dirMode: 0o700,
    trailingNewline: true,
  });
}

async function readPending(uploadId: string, env: NodeJS.ProcessEnv): Promise<PendingUpload> {
  const upload = await readDurableJsonFile<PendingUpload>(uploadMetadataPath(uploadId, env));
  if (!upload) {
    throw new Error("PCC attachment upload not found");
  }
  if (Date.parse(upload.expiresAt) <= Date.now()) {
    await discardPending(uploadId, env);
    throw new Error("PCC attachment upload expired; start the upload again");
  }
  return upload;
}

async function discardPending(uploadId: string, env: NodeJS.ProcessEnv): Promise<void> {
  await Promise.all([
    fs.rm(uploadMetadataPath(uploadId, env), { force: true }),
    fs.rm(uploadDataPath(uploadId, env), { force: true }),
  ]);
}

/** Remove abandoned upload parts without touching committed attachments. */
export async function cleanupExpiredPccAttachmentUploads(
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  await ensureRoots(env);
  let removed = 0;
  for (const name of await fs.readdir(uploadRoot(env))) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const upload = await readDurableJsonFile<PendingUpload>(path.join(uploadRoot(env), name));
    if (upload && Date.parse(upload.expiresAt) <= Date.now()) {
      await discardPending(upload.id, env);
      removed += 1;
    }
  }
  return removed;
}

async function pendingUploadUsage(
  projectId: string,
  env: NodeJS.ProcessEnv,
): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  for (const name of await fs.readdir(uploadRoot(env))) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const upload = await readDurableJsonFile<PendingUpload>(path.join(uploadRoot(env), name));
    if (upload?.request.projectId === projectId && Date.parse(upload.expiresAt) > Date.now()) {
      count += 1;
      bytes += upload.request.sizeBytes;
    }
  }
  return { count, bytes };
}

function validateScope(request: PccAttachmentsUploadBeginParams): void {
  if (request.scope === "milestone" && !request.milestoneId) {
    throw new Error("A milestone attachment must select a milestone");
  }
  if (request.scope === "sub_milestone" && !request.subMilestoneId) {
    throw new Error("A sub-step attachment must select a sub-step");
  }
  if (request.scope === "project" && (request.milestoneId || request.subMilestoneId)) {
    throw new Error("A project attachment cannot also target a milestone or sub-step");
  }
}

function validateLedgerTarget(
  request: PccAttachmentsUploadBeginParams,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const ledger = readPccLedger(env);
  if (!ledger.projects.some((project) => project.id === request.projectId)) {
    throw new Error(`PCC project not found: ${request.projectId}`);
  }
  if (
    request.milestoneId &&
    !ledger.milestones.some(
      (milestone) =>
        milestone.id === request.milestoneId && milestone.projectId === request.projectId,
    )
  ) {
    throw new Error("The selected milestone does not belong to this project");
  }
  if (
    request.subMilestoneId &&
    !ledger.subMilestones.some(
      (subMilestone) =>
        subMilestone.id === request.subMilestoneId &&
        subMilestone.projectId === request.projectId &&
        (!request.milestoneId || subMilestone.milestoneId === request.milestoneId),
    )
  ) {
    throw new Error("The selected sub-step does not belong to this project");
  }
}

function mimeAllowed(value: string): boolean {
  const mime = normalizeMimeType(value) ?? "";
  return (
    mime.startsWith("image/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    mime.startsWith("text/") ||
    mime === "application/pdf" ||
    mime === "application/json" ||
    mime === "application/rtf" ||
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-powerpoint" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
}

async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function sniffMime(filePath: string, declaredMime: string): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const sample = Buffer.alloc(8_192);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    return (
      normalizeMimeType(
        (await detectMime({
          buffer: sample.subarray(0, bytesRead),
          filePath,
          headerMime: declaredMime,
        })) ?? declaredMime,
      ) || "application/octet-stream"
    );
  } finally {
    await handle.close();
  }
}

export async function beginPccAttachmentUpload(
  request: PccAttachmentsUploadBeginParams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ uploadId: string; offset: number; expiresAt: string }> {
  validateScope(request);
  validateLedgerTarget(request, env);
  if (request.sizeBytes <= 0 || request.sizeBytes > MAX_FILE_BYTES) {
    throw new Error("PCC attachments must be between 1 byte and 100 MiB");
  }
  return withProjectUploadLock(request.projectId, env, async () => {
    await ensureRoots(env);
    await cleanupExpiredPccAttachmentUploads(env);
    if (request.idempotencyKey) {
      for (const name of await fs.readdir(uploadRoot(env))) {
        if (!name.endsWith(".json")) {
          continue;
        }
        const existing = await readDurableJsonFile<PendingUpload>(path.join(uploadRoot(env), name));
        if (
          existing?.request.projectId === request.projectId &&
          existing.request.idempotencyKey === request.idempotencyKey &&
          Date.parse(existing.expiresAt) > Date.now()
        ) {
          return {
            uploadId: existing.id,
            offset: existing.receivedBytes,
            expiresAt: existing.expiresAt,
          };
        }
      }
    }
    const pending = await pendingUploadUsage(request.projectId, env);
    const ready = projectAttachmentUsage(readPccLedger(env).attachments ?? [], request.projectId);
    if (ready.count + pending.count >= DEFAULT_PCC_PRIVATE_TEAM_POLICY.maxAttachmentsPerProject) {
      throw new Error(
        `This project is limited to ${DEFAULT_PCC_PRIVATE_TEAM_POLICY.maxAttachmentsPerProject} attached files. Remove an unused file before adding another.`,
      );
    }
    if (
      ready.bytes + pending.bytes + request.sizeBytes >
      DEFAULT_PCC_PRIVATE_TEAM_POLICY.maxAttachmentBytesPerProject
    ) {
      throw new Error(
        "This project's attachment storage limit is 1 GiB. Remove an unused file or attach a smaller file.",
      );
    }
    const now = new Date();
    const upload: PendingUpload = {
      schemaVersion: 1,
      id: randomUUID(),
      request: {
        ...request,
        originalName: path.basename(request.originalName).slice(0, 512),
        mimeType: normalizeMimeType(request.mimeType) || "application/octet-stream",
      },
      receivedBytes: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS).toISOString(),
    };
    await fs.writeFile(uploadDataPath(upload.id, env), Buffer.alloc(0), { mode: 0o600 });
    await writePending(upload, env);
    return { uploadId: upload.id, offset: 0, expiresAt: upload.expiresAt };
  });
}

export async function appendPccAttachmentChunk(
  input: { uploadId: string; offset: number; dataBase64: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ uploadId: string; offset: number }> {
  return withUploadLock(input.uploadId, async () => {
    const upload = await readPending(input.uploadId, env);
    if (input.offset !== upload.receivedBytes) {
      throw new Error(`PCC attachment chunk offset mismatch; expected ${upload.receivedBytes}`);
    }
    const currentSize = (await fs.stat(uploadDataPath(upload.id, env))).size;
    if (currentSize !== upload.receivedBytes) {
      throw new Error("PCC attachment upload state does not match its durable file");
    }
    const normalizedBase64 = input.dataBase64.replace(/=+$/u, "");
    const bytes = Buffer.from(input.dataBase64, "base64");
    if (
      bytes.length === 0 ||
      bytes.length > MAX_CHUNK_BYTES ||
      bytes.toString("base64").replace(/=+$/u, "") !== normalizedBase64
    ) {
      throw new Error("PCC attachment chunk must contain valid base64 data up to 4 MiB");
    }
    if (upload.receivedBytes + bytes.length > upload.request.sizeBytes) {
      throw new Error("PCC attachment upload exceeds the declared file size");
    }
    await fs.appendFile(uploadDataPath(upload.id, env), bytes, { mode: 0o600 });
    upload.receivedBytes += bytes.length;
    upload.updatedAt = new Date().toISOString();
    await writePending(upload, env);
    return { uploadId: upload.id, offset: upload.receivedBytes };
  });
}

export async function commitPccAttachmentUpload(
  input: { uploadId: string; sha256?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<PccAttachment> {
  return withUploadLock(input.uploadId, async () => {
    const upload = await readPending(input.uploadId, env);
    const prior = (readPccLedger(env).attachments ?? []).find(
      (attachment) =>
        upload.request.idempotencyKey &&
        attachment.projectId === upload.request.projectId &&
        attachment.sourceUploadKey === upload.request.idempotencyKey,
    );
    if (prior) {
      await discardPending(upload.id, env);
      return prior;
    }
    if (upload.receivedBytes !== upload.request.sizeBytes) {
      throw new Error(
        `PCC attachment upload is incomplete: ${upload.receivedBytes}/${upload.request.sizeBytes} bytes`,
      );
    }
    validateLedgerTarget(upload.request, env);
    const partPath = uploadDataPath(upload.id, env);
    const sha256 = await fileSha256(partPath);
    const expectedSha = input.sha256 ?? upload.request.sha256;
    if (expectedSha && expectedSha.toLowerCase() !== sha256) {
      throw new Error("PCC attachment SHA-256 does not match the uploaded file");
    }
    const mimeType = await sniffMime(partPath, upload.request.mimeType);
    if (!mimeAllowed(mimeType)) {
      throw new Error(`PCC attachment type is not allowed: ${mimeType}`);
    }
    const blobPath = path.join(blobRoot(env), sha256);
    try {
      await fs.link(partPath, blobPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
    }
    await fs.chmod(blobPath, 0o600);
    const now = new Date().toISOString();
    const attachment: PccAttachment = {
      id: `attachment-${randomUUID()}`,
      revision: 1,
      logicalId: `attachment-${randomUUID()}`,
      version: 1,
      projectId: upload.request.projectId,
      ...(upload.request.milestoneId ? { milestoneId: upload.request.milestoneId } : {}),
      ...(upload.request.subMilestoneId ? { subMilestoneId: upload.request.subMilestoneId } : {}),
      originalName: upload.request.originalName,
      title: upload.request.originalName,
      mimeType,
      sizeBytes: upload.request.sizeBytes,
      sha256,
      role: upload.request.role,
      scope: upload.request.scope,
      instructions: upload.request.instructions?.trim() ?? "",
      ...(upload.request.clarifiedInstructions?.trim()
        ? { clarifiedInstructions: upload.request.clarifiedInstructions.trim() }
        : {}),
      ...(upload.request.instructionProvenance
        ? { instructionProvenance: upload.request.instructionProvenance }
        : {}),
      modelAccess: upload.request.modelAccess ?? "project_policy",
      sensitivity: upload.request.sensitivity ?? "normal",
      status: "ready",
      createdAt: now,
      updatedAt: now,
      ...(upload.request.idempotencyKey ? { sourceUploadKey: upload.request.idempotencyKey } : {}),
    };
    try {
      withPccLedger(
        (ledger) => {
          ledger.attachments ??= [];
          const capacityError = attachmentCapacityError(
            ledger.attachments,
            attachment.projectId,
            attachment.sizeBytes,
          );
          if (capacityError) {
            throw new Error(capacityError);
          }
          ledger.attachments.push(attachment);
        },
        { write: true, auditKind: "pcc.attachments.upload.commit" },
        env,
      );
    } catch (error) {
      const stillReferenced = (readPccLedger(env).attachments ?? []).some(
        (item) => item.sha256 === sha256,
      );
      if (!stillReferenced) {
        await fs.rm(blobPath, { force: true });
      }
      throw error;
    }
    await discardPending(upload.id, env);
    return attachment;
  });
}

export function listPccAttachments(
  projectId: string,
  options: { includeTombstoned?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): PccAttachment[] {
  return (readPccLedger(env).attachments ?? [])
    .filter((attachment) => attachment.projectId === projectId)
    .filter((attachment) => options.includeTombstoned || attachment.status !== "tombstoned")
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
}

export async function readPccAttachmentChunk(
  input: { attachmentId: string; offset?: number; maxBytes?: number },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  attachmentId: string;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  dataBase64: string;
  eof: boolean;
}> {
  const attachment = (readPccLedger(env).attachments ?? []).find(
    (item) => item.id === input.attachmentId && item.status === "ready",
  );
  if (!attachment) {
    throw new Error("Ready PCC attachment not found");
  }
  const offset = input.offset ?? 0;
  const maxBytes = input.maxBytes ?? MAX_CHUNK_BYTES;
  if (offset < 0 || offset > attachment.sizeBytes) {
    throw new Error("PCC attachment read offset is outside the file");
  }
  if (maxBytes < 1 || maxBytes > MAX_CHUNK_BYTES) {
    throw new Error("PCC attachment reads must request between 1 byte and 4 MiB");
  }
  const length = Math.min(maxBytes, attachment.sizeBytes - offset);
  const handle = await fs.open(path.join(blobRoot(env), attachment.sha256), "r");
  try {
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await handle.read(bytes, 0, length, offset);
    const nextOffset = offset + bytesRead;
    return {
      attachmentId: attachment.id,
      offset,
      nextOffset,
      totalBytes: attachment.sizeBytes,
      dataBase64: bytes.subarray(0, bytesRead).toString("base64"),
      eof: nextOffset >= attachment.sizeBytes,
    };
  } finally {
    await handle.close();
  }
}

export function updatePccAttachment(
  input: PccAttachmentsUpdateParams,
  env: NodeJS.ProcessEnv = process.env,
): PccAttachment {
  return withPccLedger(
    (ledger) => {
      const attachments = (ledger.attachments ??= []);
      const index = attachments.findIndex((attachment) => attachment.id === input.attachmentId);
      const current = attachments[index];
      if (!current) {
        throw new Error("PCC attachment not found");
      }
      const currentRevision = current.revision ?? 1;
      if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
        throw new Error(
          `Review latest changes before saving ${current.id}. Expected revision ${input.expectedRevision}, but the current revision is ${currentRevision}.`,
        );
      }
      const next: PccAttachment = {
        ...current,
        revision: currentRevision + 1,
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.milestoneId !== undefined
          ? input.milestoneId === null
            ? { milestoneId: undefined }
            : { milestoneId: input.milestoneId }
          : {}),
        ...(input.subMilestoneId !== undefined
          ? input.subMilestoneId === null
            ? { subMilestoneId: undefined }
            : { subMilestoneId: input.subMilestoneId }
          : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions.trim() } : {}),
        ...(input.clarifiedInstructions !== undefined
          ? { clarifiedInstructions: input.clarifiedInstructions.trim() }
          : {}),
        ...(input.modelAccess !== undefined ? { modelAccess: input.modelAccess } : {}),
        ...(input.sensitivity !== undefined ? { sensitivity: input.sensitivity } : {}),
        ...(input.tombstone !== undefined
          ? { status: input.tombstone ? ("tombstoned" as const) : ("ready" as const) }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      validateScope({
        projectId: next.projectId,
        originalName: next.originalName,
        mimeType: next.mimeType,
        sizeBytes: next.sizeBytes,
        sha256: next.sha256,
        role: next.role,
        scope: next.scope,
        milestoneId: next.milestoneId,
        subMilestoneId: next.subMilestoneId,
        instructions: next.instructions,
        modelAccess: next.modelAccess,
        sensitivity: next.sensitivity,
      });
      validateLedgerTarget(
        {
          projectId: next.projectId,
          originalName: next.originalName,
          mimeType: next.mimeType,
          sizeBytes: next.sizeBytes,
          sha256: next.sha256,
          role: next.role,
          scope: next.scope,
          milestoneId: next.milestoneId,
          subMilestoneId: next.subMilestoneId,
          instructions: next.instructions,
          modelAccess: next.modelAccess,
          sensitivity: next.sensitivity,
        },
        env,
      );
      attachments[index] = next;
      return next;
    },
    { write: true, auditKind: "pcc.attachments.update" },
    env,
  );
}

export function recordPccAttachmentUsage(
  input: PccAttachmentUsageRecordParams,
  env: NodeJS.ProcessEnv = process.env,
): PccAttachmentUsageReceipt {
  return withPccLedger(
    (ledger) => {
      const attachment = (ledger.attachments ?? []).find(
        (item) => item.id === input.attachmentId && item.status === "ready",
      );
      if (!attachment) {
        throw new Error("Ready PCC attachment not found");
      }
      if (
        input.milestoneId &&
        !ledger.milestones.some(
          (milestone) =>
            milestone.id === input.milestoneId && milestone.projectId === attachment.projectId,
        )
      ) {
        throw new Error("The usage milestone does not belong to the attachment project");
      }
      const receipt: PccAttachmentUsageReceipt = {
        id: `attachment-usage-${randomUUID()}`,
        attachmentId: attachment.id,
        projectId: attachment.projectId,
        ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.model ? { model: input.model } : {}),
        purpose: input.purpose.trim(),
        ...(input.outcome?.trim() ? { outcome: input.outcome.trim() } : {}),
        usedAt: new Date().toISOString(),
      };
      ledger.attachmentUsageReceipts ??= [];
      ledger.attachmentUsageReceipts.push(receipt);
      return receipt;
    },
    { write: true, auditKind: "pcc.attachments.usage.record" },
    env,
  );
}

export function listPccAttachmentUsage(
  input: { projectId: string; attachmentId?: string },
  env: NodeJS.ProcessEnv = process.env,
): PccAttachmentUsageReceipt[] {
  return (readPccLedger(env).attachmentUsageReceipts ?? [])
    .filter((receipt) => receipt.projectId === input.projectId)
    .filter((receipt) => !input.attachmentId || receipt.attachmentId === input.attachmentId)
    .toSorted((a, b) => b.usedAt.localeCompare(a.usedAt));
}
