import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendPccAttachmentChunk,
  beginPccAttachmentUpload,
  commitPccAttachmentUpload,
  listPccAttachmentUsage,
  listPccAttachments,
  readPccAttachmentChunk,
  recordPccAttachmentUsage,
  updatePccAttachment,
} from "./attachments.js";
import { closePccLedgerStorageForTest, withPccLedger } from "./ledger-store.js";

const roots: string[] = [];

function makeEnv(): NodeJS.ProcessEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-pcc-attachments-"));
  roots.push(root);
  const env = { OPENCLAW_STATE_DIR: root };
  withPccLedger(
    (ledger) => {
      ledger.projects.push({
        id: "project-1",
        title: "Attachment Project",
        status: "active",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      });
      ledger.milestones.push({
        id: "milestone-1",
        projectId: "project-1",
        title: "Use the brief",
        status: "active",
        order: 0,
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      });
    },
    { write: true, auditKind: "test.setup" },
    env,
  );
  return env;
}

afterEach(() => {
  closePccLedgerStorageForTest();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("PCC attachments", () => {
  it("uploads in chunks, verifies the hash, and stores project intent", async () => {
    const env = makeEnv();
    const bytes = Buffer.from("Use this brief as the canonical product requirement.", "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const begin = await beginPccAttachmentUpload(
      {
        projectId: "project-1",
        originalName: "product-brief.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        sha256,
        role: "requirement",
        scope: "milestone",
        milestoneId: "milestone-1",
        instructions: "Use this as the source of truth for the selected milestone.",
        clarifiedInstructions:
          "Use this brief as the source of truth for the selected milestone and verify the result against it.",
        instructionProvenance: {
          provider: "ollama",
          model: "qwen3.6:30b",
          generatedAt: "2026-07-27T00:00:00.000Z",
        },
        modelAccess: "local_only",
        sensitivity: "normal",
        idempotencyKey: "upload-product-brief",
      },
      env,
    );
    const duplicate = await beginPccAttachmentUpload(
      {
        projectId: "project-1",
        originalName: "product-brief.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        sha256,
        role: "requirement",
        scope: "milestone",
        milestoneId: "milestone-1",
        instructions: "Use this as the source of truth for the selected milestone.",
        modelAccess: "local_only",
        sensitivity: "normal",
        idempotencyKey: "upload-product-brief",
      },
      env,
    );
    expect(duplicate.uploadId).toBe(begin.uploadId);

    const first = bytes.subarray(0, 12);
    const second = bytes.subarray(12);
    await appendPccAttachmentChunk(
      { uploadId: begin.uploadId, offset: 0, dataBase64: first.toString("base64") },
      env,
    );
    await appendPccAttachmentChunk(
      {
        uploadId: begin.uploadId,
        offset: first.length,
        dataBase64: second.toString("base64"),
      },
      env,
    );
    const attachment = await commitPccAttachmentUpload({ uploadId: begin.uploadId, sha256 }, env);

    expect(attachment).toMatchObject({
      projectId: "project-1",
      milestoneId: "milestone-1",
      role: "requirement",
      scope: "milestone",
      modelAccess: "local_only",
      sha256,
      status: "ready",
      clarifiedInstructions:
        "Use this brief as the source of truth for the selected milestone and verify the result against it.",
      instructionProvenance: { provider: "ollama", model: "qwen3.6:30b" },
    });
    const retry = await beginPccAttachmentUpload(
      {
        projectId: "project-1",
        originalName: "product-brief.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        sha256,
        role: "requirement",
        scope: "milestone",
        milestoneId: "milestone-1",
        instructions: "Use this as the source of truth for the selected milestone.",
        clarifiedInstructions:
          "Use this brief as the source of truth for the selected milestone and verify the result against it.",
        instructionProvenance: {
          provider: "ollama",
          model: "qwen3.6:30b",
          generatedAt: "2026-07-27T00:00:00.000Z",
        },
        modelAccess: "local_only",
        sensitivity: "normal",
        idempotencyKey: "upload-product-brief",
      },
      env,
    );
    await appendPccAttachmentChunk(
      { uploadId: retry.uploadId, offset: 0, dataBase64: bytes.toString("base64") },
      env,
    );
    expect((await commitPccAttachmentUpload({ uploadId: retry.uploadId }, env)).id).toBe(
      attachment.id,
    );
    expect(listPccAttachments("project-1", {}, env)).toHaveLength(1);
    const read = await readPccAttachmentChunk(
      { attachmentId: attachment.id, offset: 4, maxBytes: 12 },
      env,
    );
    expect(Buffer.from(read.dataBase64, "base64").toString("utf8")).toBe(
      bytes.subarray(4, 16).toString("utf8"),
    );
    expect(read).toMatchObject({
      attachmentId: attachment.id,
      offset: 4,
      nextOffset: 16,
      totalBytes: bytes.length,
      eof: false,
    });
    const usage = recordPccAttachmentUsage(
      {
        attachmentId: attachment.id,
        milestoneId: "milestone-1",
        model: "ollama/qwen3.6:30b",
        purpose: "Read the canonical requirement before implementation.",
        outcome: "The worker used the brief to constrain its plan.",
      },
      env,
    );
    expect(usage).toMatchObject({
      projectId: "project-1",
      attachmentId: attachment.id,
      milestoneId: "milestone-1",
      model: "ollama/qwen3.6:30b",
    });
    expect(listPccAttachmentUsage({ projectId: "project-1" }, env)).toEqual([usage]);
  });

  it("fails closed on offset and hash mismatches", async () => {
    const env = makeEnv();
    const bytes = Buffer.from("proof", "utf8");
    const begin = await beginPccAttachmentUpload(
      {
        projectId: "project-1",
        originalName: "proof.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        role: "proof",
        scope: "proof_only",
      },
      env,
    );
    await expect(
      appendPccAttachmentChunk(
        { uploadId: begin.uploadId, offset: 1, dataBase64: bytes.toString("base64") },
        env,
      ),
    ).rejects.toThrow("offset mismatch");
    await expect(
      appendPccAttachmentChunk(
        { uploadId: begin.uploadId, offset: 0, dataBase64: "not-base64!" },
        env,
      ),
    ).rejects.toThrow("valid base64");
    await appendPccAttachmentChunk(
      { uploadId: begin.uploadId, offset: 0, dataBase64: bytes.toString("base64") },
      env,
    );
    await expect(
      commitPccAttachmentUpload({ uploadId: begin.uploadId, sha256: "0".repeat(64) }, env),
    ).rejects.toThrow("SHA-256");
  });

  it("serializes concurrent chunks so the same offset cannot be written twice", async () => {
    const env = makeEnv();
    const bytes = Buffer.from("proof", "utf8");
    const begin = await beginPccAttachmentUpload(
      {
        projectId: "project-1",
        originalName: "concurrent-proof.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        role: "proof",
        scope: "proof_only",
      },
      env,
    );
    const writes = await Promise.allSettled([
      appendPccAttachmentChunk(
        { uploadId: begin.uploadId, offset: 0, dataBase64: bytes.toString("base64") },
        env,
      ),
      appendPccAttachmentChunk(
        { uploadId: begin.uploadId, offset: 0, dataBase64: bytes.toString("base64") },
        env,
      ),
    ]);

    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(
      commitPccAttachmentUpload({ uploadId: begin.uploadId }, env),
    ).resolves.toMatchObject({ sizeBytes: bytes.length });
  });

  it("updates intent and tombstones without deleting history", async () => {
    const env = makeEnv();
    const bytes = Buffer.from("reference", "utf8");
    const begin = await beginPccAttachmentUpload(
      {
        projectId: "project-1",
        originalName: "reference.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        role: "reference",
        scope: "project",
      },
      env,
    );
    await appendPccAttachmentChunk(
      { uploadId: begin.uploadId, offset: 0, dataBase64: bytes.toString("base64") },
      env,
    );
    const attachment = await commitPccAttachmentUpload({ uploadId: begin.uploadId }, env);
    const updated = updatePccAttachment(
      {
        attachmentId: attachment.id,
        title: "Approved visual reference",
        instructions: "Match the tone, not the exact layout.",
        tombstone: true,
      },
      env,
    );

    expect(updated).toMatchObject({
      title: "Approved visual reference",
      instructions: "Match the tone, not the exact layout.",
      status: "tombstoned",
    });
    expect(listPccAttachments("project-1", {}, env)).toHaveLength(0);
    expect(listPccAttachments("project-1", { includeTombstoned: true }, env)).toHaveLength(1);
  });
});
