import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireOperation,
  finishOperation,
  getOperationSnapshot,
  heartbeatOperation,
  recoverOperation,
  registerOperationWorkspace,
  updateOperationBindings,
} from "../../scripts/custom-runtime/operation-admission.mjs";

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-operation-admission-"));
  roots.push(root);
  return { root, registryPath: path.join(root, "registry.json") };
}

function request(
  registryPath: string,
  operationId: string,
  claims = [{ resource: "managed-runtime-mutation", key: "default", mode: "exclusive" }],
) {
  return {
    registryPath,
    operationId,
    invocationId: `invocation:${operationId}`,
    taskId: `task:${operationId}`,
    owner: `owner:${operationId}`,
    claims,
    waitMs: 2_000,
    pollMs: 10,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("operation admission", () => {
  it("waits for a temporary contender and completes the original invocation", async () => {
    const input = fixture();
    const first = await acquireOperation(request(input.registryPath, "first"));
    const secondPromise = acquireOperation(request(input.registryPath, "second"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await finishOperation({ operation: first, reason: "first_completed" });
    const second = await secondPromise;
    expect(second.state).toBe("running");
    await finishOperation({ operation: second, reason: "second_completed" });
    const snapshot = await getOperationSnapshot({ registryPath: input.registryPath });
    expect(snapshot.operations.first.state).toBe("completed");
    expect(snapshot.operations.second.state).toBe("completed");
  });

  it("allows compatible shared claims but serializes an exclusive waiter", async () => {
    const input = fixture();
    const sharedClaim = [{ resource: "gateway", key: "health", mode: "shared" }];
    const first = await acquireOperation(request(input.registryPath, "shared-one", sharedClaim));
    const second = await acquireOperation(request(input.registryPath, "shared-two", sharedClaim));
    const exclusivePromise = acquireOperation(
      request(input.registryPath, "exclusive", [
        { resource: "gateway", key: "health", mode: "exclusive" },
      ]),
    );
    await finishOperation({ operation: first });
    let resolved = false;
    void exclusivePromise.then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(resolved).toBe(false);
    await finishOperation({ operation: second });
    const exclusive = await exclusivePromise;
    expect(exclusive.state).toBe("running");
    await finishOperation({ operation: exclusive });
  });

  it("does not let newer compatible work bypass an older exclusive waiter", async () => {
    const input = fixture();
    const shared = [{ resource: "local-model", key: "ollama", mode: "shared" }];
    const exclusive = [{ resource: "local-model", key: "ollama", mode: "exclusive" }];
    const holder = await acquireOperation(request(input.registryPath, "holder", shared));
    const exclusivePromise = acquireOperation(
      request(input.registryPath, "exclusive-waiter", exclusive),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    const newerPromise = acquireOperation(request(input.registryPath, "newer-shared", shared));
    await finishOperation({ operation: holder });
    const admittedExclusive = await exclusivePromise;
    let newerResolved = false;
    void newerPromise.then(() => {
      newerResolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(newerResolved).toBe(false);
    await finishOperation({ operation: admittedExclusive });
    const newer = await newerPromise;
    await finishOperation({ operation: newer });
  });

  it("persists background contention instead of reporting success", async () => {
    const input = fixture();
    const holder = await acquireOperation(request(input.registryPath, "holder"));
    const queued = await acquireOperation({
      ...request(input.registryPath, "background"),
      waitMs: 25,
      persistOnTimeout: true,
    });
    expect(queued.state).toBe("queued");
    await finishOperation({ operation: holder });
    const snapshot = await getOperationSnapshot({ registryPath: input.registryPath });
    expect(snapshot.operations.background.state).toBe("admitted");
  });

  it("heartbeats a delegated owner token and records terminal receipts", async () => {
    const input = fixture();
    const operation = await acquireOperation(request(input.registryPath, "heartbeat"));
    const heartbeat = await heartbeatOperation({ operation, ttlMs: 60_000 });
    expect(Date.parse(heartbeat.expiresAt)).toBeGreaterThanOrEqual(Date.parse(operation.expiresAt));
    expect(Date.parse(heartbeat.heartbeatAt)).toBeGreaterThanOrEqual(
      Date.parse(operation.heartbeatAt),
    );
    const completed = await finishOperation({ operation: heartbeat, reason: "verified" });
    expect(completed.receipt.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const receipt = JSON.parse(readFileSync(completed.receipt.path, "utf8"));
    expect(receipt.receiptSha256).toBe(completed.receipt.sha256);
  });

  it("binds runtime identities once and rejects drift", async () => {
    const input = fixture();
    const operation = await acquireOperation(request(input.registryPath, "bindings"));
    const bound = await updateOperationBindings({
      operation,
      activeRuntimeIdentity: "a".repeat(40),
      candidateIdentity: "b".repeat(64),
    });
    expect(bound).toMatchObject({
      activeRuntimeIdentity: "a".repeat(40),
      candidateIdentity: "b".repeat(64),
    });
    await expect(
      updateOperationBindings({
        operation: bound,
        activeRuntimeIdentity: "c".repeat(40),
      }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
    await finishOperation({ operation: bound });
  });

  it("retains dead storage ownership as cleanup pending until approved recovery", async () => {
    const input = fixture();
    const operation = await acquireOperation({
      ...request(input.registryPath, "storage", [
        { resource: "storage-large", key: "data-volume", mode: "exclusive" },
      ]),
      pid: 999_999,
      pidIsAlive: () => true,
    });
    const workspace = path.join(input.root, "workspace");
    mkdirSync(workspace);
    writeFileSync(path.join(workspace, "artifact"), "preserve\n");
    await registerOperationWorkspace({
      operation,
      workspacePath: workspace,
      pidIsAlive: () => true,
    });
    const snapshot = await getOperationSnapshot({
      registryPath: input.registryPath,
      pidIsAlive: () => false,
    });
    expect(snapshot.operations.storage.state).toBe("cleanup_pending");
    const recovered = await recoverOperation({
      registryPath: input.registryPath,
      operationId: "storage",
      recoveryApprovalId: "approval:cleanup",
      disposition: "completed",
      reason: "hash_verified_cleanup",
      pidIsAlive: () => false,
    });
    expect(recovered.state).toBe("completed");
    expect(readFileSync(path.join(workspace, "artifact"), "utf8")).toBe("preserve\n");
  });

  it("recovers a stale registry lock with a receipt", async () => {
    const input = fixture();
    const lockDir = `${input.registryPath}.lock`;
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      path.join(lockDir, "owner.json"),
      `${JSON.stringify({
        schema: "openclaw.operation-admission-lock.v1",
        pid: 999_999,
        token: "stale",
        createdAt: new Date(0).toISOString(),
      })}\n`,
    );
    const old = new Date(0);
    const { utimesSync } = await import("node:fs");
    utimesSync(lockDir, old, old);
    const operation = await acquireOperation({
      ...request(input.registryPath, "after-stale"),
      staleMs: 1,
      pidIsAlive: (pid: number) => pid !== 999_999,
    });
    expect(operation.state).toBe("running");
    await finishOperation({ operation });
  });

  it("recovers an interrupted empty lock directory after the creation grace period", async () => {
    const input = fixture();
    const lockDir = `${input.registryPath}.lock`;
    mkdirSync(lockDir, { recursive: true });
    const old = new Date(Date.now() - 1_000);
    const { utimesSync } = await import("node:fs");
    utimesSync(lockDir, old, old);

    const operation = await acquireOperation({
      ...request(input.registryPath, "after-empty-lock"),
      staleMs: 60_000,
    });

    expect(operation.state).toBe("running");
    await finishOperation({ operation });
  });

  it("fails closed when registry lock ownership is malformed", async () => {
    const input = fixture();
    const lockDir = `${input.registryPath}.lock`;
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(path.join(lockDir, "owner.json"), "not-json\n");

    await expect(
      acquireOperation(request(input.registryPath, "malformed-lock")),
    ).rejects.toMatchObject({ code: "registry_invalid" });
  });
});
