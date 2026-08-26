import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../api.js";
import {
  assertQualificationCanaryManifest,
  buildNativeTaskReceipts,
  canReserveWorkerSlots,
  RingerController,
  warmOllamaModel,
} from "./controller.js";
import { prepareShadowSnapshot } from "./snapshot.js";
import type { ResolvedRingerConfig, RingerRunReceipt, RingerTaskManifest } from "./types.js";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

async function git(repo: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", repo, ...args]);
  return result.stdout.trim();
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Local AI Assist supervision", () => {
  it("enforces machine-wide worker admission across concurrent runs", () => {
    expect(
      canReserveWorkerSlots({ admittedParallel: 1, reservedWorkers: 0, requestedWorkers: 1 }),
    ).toBe(true);
    expect(
      canReserveWorkerSlots({ admittedParallel: 1, reservedWorkers: 1, requestedWorkers: 1 }),
    ).toBe(false);
    expect(
      canReserveWorkerSlots({ admittedParallel: 2, reservedWorkers: 1, requestedWorkers: 1 }),
    ).toBe(true);
    expect(
      canReserveWorkerSlots({ admittedParallel: 2, reservedWorkers: 1, requestedWorkers: 2 }),
    ).toBe(false);
  });

  it("retains successful task attempts and artifacts when a sibling fails", () => {
    const tasks = [
      { key: "alpha", model: "ollama/qwen3.6:27b-q8_0" },
      { key: "bravo", model: "ollama/qwen3.6:27b-q8_0" },
    ] as RingerTaskManifest[];
    const receipts = buildNativeTaskReceipts({
      manifestTasks: tasks,
      nativeTasks: [
        { key: "alpha", status: "pass", attempts: 1 },
        { key: "bravo", status: "fail", attempts: 2 },
      ],
      artifactRoot: "/private/tmp/local-ai-assist-artifacts/native-run",
      validArtifacts: new Map([
        ["alpha", true],
        ["bravo", false],
      ]),
    });
    expect(receipts).toEqual([
      {
        key: "alpha",
        status: "pass",
        attempts: 1,
        model: "ollama/qwen3.6:27b-q8_0",
        artifactDir: "/private/tmp/local-ai-assist-artifacts/native-run/alpha",
      },
      {
        key: "bravo",
        status: "fail",
        attempts: 2,
        model: "ollama/qwen3.6:27b-q8_0",
        artifactDir: "/private/tmp/local-ai-assist-artifacts/native-run/bravo",
      },
    ]);
  });

  it("warms only the exact installed Ollama model and validates returned identity", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ model: "qwen3.6:27b-q8_0", done: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      warmOllamaModel("http://127.0.0.1:11434", "ollama/qwen3.6:27b-q8_0", 1_000),
    ).resolves.toBe(true);
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("http://127.0.0.1:11434/api/chat");
    const body = request?.[1]?.body;
    if (typeof body !== "string") {
      throw new Error("Expected the exact-model prewarm request body to be JSON text.");
    }
    expect(JSON.parse(body)).toMatchObject({
      model: "qwen3.6:27b-q8_0",
      stream: false,
      keep_alive: "10m",
    });
  });

  it("fails closed on model identity drift or a non-success response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ model: "different", done: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      warmOllamaModel("http://127.0.0.1:11434", "ollama/qwen3.6:27b-q8_0", 1_000),
    ).resolves.toBe(false);
    await expect(
      warmOllamaModel("http://127.0.0.1:11434", "ollama/qwen3.6:27b-q8_0", 1_000),
    ).resolves.toBe(false);
  });

  it("requires an explicitly named, bounded qualification canary", () => {
    const task = {
      key: "alpha",
      full_access: false,
      max_attempts: 2,
    } as const;
    const manifest = {
      run_name: "qualification-canary-alpha",
      max_parallel: 2,
      tasks: [task, { ...task, key: "bravo" }],
    };
    expect(() => assertQualificationCanaryManifest(manifest, 4)).not.toThrow();
    expect(() =>
      assertQualificationCanaryManifest({ ...manifest, run_name: "ordinary-start" }, 4),
    ).toThrow(/run_name/u);
    expect(() => assertQualificationCanaryManifest({ ...manifest, tasks: [task] }, 4)).toThrow(
      /at least two/u,
    );
  });

  it("fails closed on invalid raw enabled configuration before caller proof", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-invalid-config-test-"));
    roots.push(root);
    const controller = new RingerController(
      {
        enabled: true,
        stateDir: root,
        callerSecret: { source: "env", provider: "ringer", id: "value" },
        allowedRepositories: [],
      } as unknown as ResolvedRingerConfig,
      {} as OpenClawConfig,
    );
    await expect(controller.prepare({} as never)).rejects.toThrow(/file-backed SecretRef/u);
    await expect(controller.snapshot()).resolves.toMatchObject({
      health: "blocked",
      configErrors: expect.arrayContaining([expect.stringContaining("file-backed SecretRef")]),
    });
  });

  it("refuses a symlinked state directory during initialization", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-state-symlink-test-"));
    roots.push(root);
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    const stateDir = path.join(root, "state");
    await fs.symlink(outside, stateDir);
    const controller = new RingerController(
      { stateDir, rawRetentionDays: 7, receiptRetentionDays: 30 } as ResolvedRingerConfig,
      {} as OpenClawConfig,
    );
    await expect(controller.initialize()).rejects.toThrow(/real directory/u);
  });

  it("reconciles orphaned active receipts to durable interrupted state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-controller-test-"));
    roots.push(root);
    const config = {
      stateDir: root,
      rawRetentionDays: 7,
      receiptRetentionDays: 30,
    } as ResolvedRingerConfig;
    const receipts = path.join(root, "receipts");
    await fs.mkdir(receipts);
    const receipt: RingerRunReceipt = {
      runId: `run-${"a".repeat(36)}`,
      runName: "orphan",
      manifestSha256: "b".repeat(64),
      snapshotId: `snap-${"c".repeat(24)}`,
      sourceSha: "d".repeat(40),
      pid: 2_147_483_000,
      status: "running",
      action: "start",
      startedAt: new Date().toISOString(),
      logPath: path.join(root, "missing.log"),
      tasks: [
        {
          key: "alpha",
          status: "running",
          attempts: 1,
          model: "ollama/qwen3-coder-next:latest",
          artifactDir: "",
        },
      ],
    };
    const file = path.join(receipts, `${receipt.runId}.json`);
    await fs.writeFile(file, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    const controller = new RingerController(config, {} as OpenClawConfig);
    await controller.reconcileRuns();
    const reconciled = JSON.parse(await fs.readFile(file, "utf8")) as RingerRunReceipt;
    expect(reconciled.status).toBe("interrupted");
    expect(reconciled.tasks[0]?.status).toBe("interrupted");
    expect(reconciled.pid).toBeUndefined();
    expect(reconciled.finishedAt).toBeTruthy();
  });

  it("fails closed instead of killing an unverified process after Gateway restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-restart-identity-test-"));
    roots.push(root);
    const config = {
      stateDir: root,
      ringerSourceDir: path.join(root, "ringer"),
      ringerConfigPath: path.join(root, "ringer.toml"),
      rawRetentionDays: 7,
      receiptRetentionDays: 30,
    } as ResolvedRingerConfig;
    const receipt: RingerRunReceipt = {
      runId: `run-${"f".repeat(36)}`,
      runName: "restart-identity",
      manifestSha256: "a".repeat(64),
      snapshotId: `snap-${"b".repeat(24)}`,
      sourceSha: "c".repeat(40),
      pid: process.pid,
      status: "running",
      action: "start",
      startedAt: new Date().toISOString(),
      logPath: path.join(root, "runs", "run.log"),
      tasks: [],
    };
    const receiptDir = path.join(root, "receipts");
    await fs.mkdir(receiptDir, { recursive: true });
    await fs.writeFile(
      path.join(receiptDir, `${receipt.runId}.json`),
      `${JSON.stringify(receipt)}\n`,
      { mode: 0o600 },
    );
    await expect(
      new RingerController(config, {} as OpenClawConfig).reconcileRuns({ startup: true }),
    ).rejects.toThrow(/unverified process identity/u);
    const retained = JSON.parse(
      await fs.readFile(path.join(receiptDir, `${receipt.runId}.json`), "utf8"),
    ) as RingerRunReceipt;
    expect(retained.status).toBe("running");
    expect(retained.pid).toBe(process.pid);
  });

  it("does not report cleanup reconciled while a terminal task worktree remains", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-stale-worktree-test-"));
    roots.push(root);
    const staleWorktree = path.join(root, "preparations", "a".repeat(64), "worktrees", "alpha");
    await fs.mkdir(staleWorktree, { recursive: true });
    const symlinkTarget = path.join(root, "outside");
    await fs.mkdir(symlinkTarget);
    const symlinkWorktree = path.join(path.dirname(staleWorktree), "bravo");
    await fs.symlink(symlinkTarget, symlinkWorktree);
    const cleanup = await new RingerController(
      { stateDir: root, rawRetentionDays: 7, receiptRetentionDays: 30 } as ResolvedRingerConfig,
      {} as OpenClawConfig,
    ).inspectCleanupState([]);
    expect(cleanup.staleWorktrees).toEqual([staleWorktree, symlinkWorktree]);
    expect(cleanup.reconciled).toBe(false);
  });

  it("removes an empty task worktree left during cancellation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-empty-worktree-test-"));
    roots.push(root);
    const manifestSha256 = "c".repeat(64);
    const worktreeRoot = path.join(root, "preparations", manifestSha256, "worktrees");
    const taskdir = path.join(worktreeRoot, "alpha");
    await fs.mkdir(taskdir, { recursive: true, mode: 0o700 });
    const runId = `run-${"d".repeat(36)}`;
    const receiptDir = path.join(root, "receipts");
    await fs.mkdir(receiptDir, { recursive: true, mode: 0o700 });
    const receipt: RingerRunReceipt = {
      runId,
      runName: "empty-worktree",
      manifestSha256,
      snapshotId: `snap-${"e".repeat(24)}`,
      sourceSha: "f".repeat(40),
      pid: 2_147_483_000,
      status: "running",
      action: "start",
      startedAt: new Date().toISOString(),
      logPath: path.join(root, "runs", runId, "ringer.log"),
      tasks: [],
    };
    await fs.writeFile(path.join(receiptDir, `${runId}.json`), `${JSON.stringify(receipt)}\n`, {
      mode: 0o600,
    });
    await new RingerController(
      { stateDir: root, rawRetentionDays: 7, receiptRetentionDays: 30 } as ResolvedRingerConfig,
      {} as OpenClawConfig,
    ).reconcileRuns();
    await expect(fs.stat(taskdir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans a task worktree when its retained snapshot has expired", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-expired-snapshot-test-"));
    roots.push(root);
    const repo = path.join(root, "repo");
    await fs.mkdir(repo);
    await git(repo, "init", "-q");
    await fs.writeFile(path.join(repo, "tracked.txt"), "base\n");
    await git(repo, "add", "tracked.txt");
    await git(
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-qm",
      "base",
    );
    const head = await git(repo, "rev-parse", "HEAD");
    const config = {
      stateDir: path.join(root, "state"),
      rawRetentionDays: 7,
      receiptRetentionDays: 30,
      maxSnapshotBytes: 1024 * 1024,
      maxSnapshotStorageBytes: 1024 * 1024 * 1024,
      dockerHost: "unix:///private/tmp/ringer-no-docker.sock",
      allowedRepositories: [{ root: repo, checkArgvPrefixes: [["node"]], models: [] }],
    } as unknown as ResolvedRingerConfig;
    const snapshot = await prepareShadowSnapshot({
      config,
      repo,
      expectedHeadSha: head,
    });
    const manifestSha256 = "b".repeat(64);
    const worktreeRoot = path.join(config.stateDir, "preparations", manifestSha256, "worktrees");
    const taskdir = path.join(worktreeRoot, "alpha");
    await fs.mkdir(worktreeRoot, { recursive: true, mode: 0o700 });
    await git(snapshot.shadowRepo, "worktree", "add", taskdir, "HEAD");

    const snapshotPath = path.join(
      config.stateDir,
      "snapshots",
      snapshot.snapshotId,
      "receipt.json",
    );
    const expired = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as Record<string, unknown>;
    expired.expiresAt = "2026-08-01T00:00:00.000Z";
    await fs.writeFile(snapshotPath, `${JSON.stringify(expired)}\n`, { mode: 0o600 });
    const runId = `run-${"a".repeat(36)}`;
    const receiptDir = path.join(config.stateDir, "receipts");
    await fs.mkdir(receiptDir, { recursive: true, mode: 0o700 });
    const receipt: RingerRunReceipt = {
      runId,
      runName: "expired-snapshot",
      manifestSha256,
      snapshotId: snapshot.snapshotId,
      sourceSha: snapshot.sourceSha,
      pid: 2_147_483_000,
      status: "running",
      action: "start",
      startedAt: new Date().toISOString(),
      logPath: path.join(config.stateDir, "runs", runId, "ringer.log"),
      tasks: [
        {
          key: "alpha",
          status: "running",
          attempts: 1,
          model: "ollama/qwen3-coder-next:latest",
          artifactDir: "",
        },
      ],
    };
    const receiptPath = path.join(receiptDir, `${runId}.json`);
    await fs.writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });

    await new RingerController(config, {} as OpenClawConfig).reconcileRuns();

    await expect(fs.access(taskdir)).rejects.toThrow();
    const reconciled = JSON.parse(await fs.readFile(receiptPath, "utf8")) as RingerRunReceipt;
    expect(reconciled.status).toBe("interrupted");
    expect(await git(repo, "rev-parse", "HEAD")).toBe(head);
  });

  it("fails closed before writing a path from a forged run ID", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-forged-receipt-test-"));
    roots.push(root);
    const config = {
      stateDir: root,
      rawRetentionDays: 7,
      receiptRetentionDays: 30,
    } as ResolvedRingerConfig;
    const receipts = path.join(root, "receipts");
    await fs.mkdir(receipts);
    const receipt: RingerRunReceipt = {
      runId: "../../forged",
      runName: "forged",
      manifestSha256: "b".repeat(64),
      snapshotId: `snap-${"c".repeat(24)}`,
      sourceSha: "d".repeat(40),
      pid: 2_147_483_000,
      status: "running",
      action: "start",
      startedAt: new Date().toISOString(),
      logPath: path.join(root, "missing.log"),
      tasks: [],
    };
    await fs.writeFile(
      path.join(receipts, `run-${"a".repeat(36)}.json`),
      `${JSON.stringify(receipt)}\n`,
      { mode: 0o600 },
    );
    await expect(
      new RingerController(config, {} as OpenClawConfig).reconcileRuns(),
    ).rejects.toThrow(/Run ID/u);
    await expect(fs.access(path.join(root, "forged"))).rejects.toThrow();
  });

  it("prunes raw state earlier than durable receipts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-retention-test-"));
    roots.push(root);
    const config = {
      stateDir: root,
      rawRetentionDays: 7,
      receiptRetentionDays: 30,
    } as ResolvedRingerConfig;
    const raw = path.join(root, "runs", "old-run");
    const receipt = path.join(root, "receipts", "run-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json");
    await fs.mkdir(raw, { recursive: true });
    await fs.mkdir(path.dirname(receipt), { recursive: true });
    await fs.writeFile(receipt, "{}\n");
    const old = new Date("2026-08-01T00:00:00.000Z");
    await fs.utimes(raw, old, old);
    await fs.utimes(receipt, old, old);
    const controller = new RingerController(config, {} as OpenClawConfig);
    await controller.pruneRetention(new Date("2026-08-10T00:00:00.000Z").getTime());
    await expect(fs.access(raw)).rejects.toThrow();
    await expect(fs.access(receipt)).resolves.toBeUndefined();
  });

  it("preserves raw state when a receipt is corrupt", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-corrupt-receipt-test-"));
    roots.push(root);
    const config = {
      stateDir: root,
      rawRetentionDays: 7,
      receiptRetentionDays: 30,
    } as ResolvedRingerConfig;
    const raw = path.join(root, "runs", "corrupt-run");
    const receipt = path.join(root, "receipts", `run-${"a".repeat(36)}.json`);
    await fs.mkdir(raw, { recursive: true });
    await fs.mkdir(path.dirname(receipt), { recursive: true });
    await fs.writeFile(receipt, "not-json\n", { mode: 0o600 });
    const old = new Date("2026-08-01T00:00:00.000Z");
    await fs.utimes(raw, old, old);
    await fs.utimes(receipt, old, old);
    await new RingerController(config, {} as OpenClawConfig).pruneRetention(
      new Date("2026-08-10T00:00:00.000Z").getTime(),
    );
    await expect(fs.access(raw)).resolves.toBeUndefined();
    await expect(fs.access(receipt)).resolves.toBeUndefined();
  });

  it("never prunes state retained by an active run", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-retention-active-test-"));
    roots.push(root);
    const config = {
      stateDir: root,
      rawRetentionDays: 7,
      receiptRetentionDays: 30,
    } as ResolvedRingerConfig;
    const runId = `run-${"a".repeat(36)}`;
    const manifestSha256 = "b".repeat(64);
    const snapshotId = `snap-${"c".repeat(24)}`;
    const nativeRunId = "native-active";
    const receiptDir = path.join(root, "receipts");
    const activePaths = [
      path.join(root, "runs", runId),
      path.join(root, "preparations", manifestSha256),
      path.join(root, "snapshots", snapshotId),
      path.join(root, "upstream", "runs", `${nativeRunId}.json`),
      path.join(root, "upstream", "artifacts", "deliverables", nativeRunId),
      path.join(root, "upstream", "artifacts", "versions", nativeRunId),
    ];
    await Promise.all(activePaths.map((item) => fs.mkdir(item, { recursive: true })));
    await fs.mkdir(receiptDir, { recursive: true });
    const receipt: RingerRunReceipt = {
      runId,
      runName: "active",
      manifestSha256,
      snapshotId,
      sourceSha: "d".repeat(40),
      pid: process.pid,
      nativeRunId,
      status: "running",
      action: "start",
      startedAt: new Date().toISOString(),
      logPath: path.join(root, "runs", runId, "ringer.log"),
      tasks: [],
    };
    await fs.writeFile(path.join(receiptDir, `${runId}.json`), `${JSON.stringify(receipt)}\n`, {
      mode: 0o600,
    });
    const old = new Date("2026-08-01T00:00:00.000Z");
    await Promise.all(activePaths.map((item) => fs.utimes(item, old, old)));
    await new RingerController(config, {} as OpenClawConfig).pruneRetention(
      new Date("2026-08-10T00:00:00.000Z").getTime(),
    );
    await Promise.all(activePaths.map((item) => expect(fs.access(item)).resolves.toBeUndefined()));
  });
});
