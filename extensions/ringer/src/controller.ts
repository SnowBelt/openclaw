// SAFETY-RATCHET: template-aware
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../api.js";
import { WORKER_SCRIPT_PATH, VERIFIER_SCRIPT_PATH } from "./assets.js";
import { CallerProofVerifier } from "./auth.js";
import { validateEnabledRingerConfig } from "./config.js";
import {
  canReserveWorkerSlots,
  inspectCapacity,
  isProcessAlive,
  modelNameMatchesRef,
  ringerArgs,
  ringerEnv,
  terminateOwnedRingerProcess,
  waitForResidentOllamaModel,
  warmOllamaModel,
} from "./controller-capacity.js";
import { cleanupRunWorktrees, inspectCleanupState, pruneRetention } from "./controller-cleanup.js";
import { assertGate, parseAndValidateBaseline } from "./controller-gates.js";
import type { GateName, GateReceipt } from "./controller-receipts.js";
import {
  assertQualificationCanaryManifest,
  buildNativeTaskReceipts,
  gatePath,
  nowIso,
  parseRunReceipt,
  preparationRoot,
  readJson,
  findInvalidRunReceipts as findInvalidRunReceiptsFromReceipts,
  readRunReceipts,
  runReceiptPath,
  assertEnabled,
  pinsDigest,
  writeJsonAtomic,
} from "./controller-receipts.js";
import { payloadWithoutAuth, sha256Bytes, sha256File } from "./crypto.js";
import { materializeNativeManifest, readAndValidateManifest } from "./manifest.js";
import { verifyPins } from "./pins.js";
import { commandFailure, runCommand } from "./process.js";
import { verifyQualificationReceipt } from "./qualification.js";
import {
  computeCurrentWorkspaceDigest,
  loadSnapshot,
  prepareShadowSnapshot,
  resolveRepositoryPolicy,
} from "./snapshot.js";
import type {
  ResolvedRingerConfig,
  RingerAdapterManifest,
  RingerCancelRequest,
  RingerPrepareRequest,
  RingerRunReceipt,
  RingerRunRequest,
  RingerSnapshotReceipt,
  RingerTaskManifest,
} from "./types.js";

export {
  assertQualificationCanaryManifest,
  buildNativeTaskReceipts,
  canReserveWorkerSlots,
  findInvalidRunReceiptsFromReceipts as findInvalidRunReceipts,
  warmOllamaModel,
};

export class RingerController {
  readonly #config: ResolvedRingerConfig;
  readonly #auth: CallerProofVerifier;
  #snapshotQueue: Promise<void> = Promise.resolve();
  #startQueue: Promise<void> = Promise.resolve();
  #runLocks = new Map<string, Promise<void>>();
  #reservedWorkerCount = 0;
  #runWorkerReservations = new Map<string, 1 | 2>();

  constructor(config: ResolvedRingerConfig, appConfig: OpenClawConfig) {
    this.#config = config;
    this.#auth = new CallerProofVerifier(config, appConfig);
  }

  async initialize(): Promise<void> {
    try {
      const existing = await fs.lstat(this.#config.stateDir);
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new Error("Local AI Assist stateDir must be a real directory.");
      }
    } catch (error) {
      // SAFETY: Filesystem errors expose the standard Node errno code used for ENOENT handling.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await fs.mkdir(this.#config.stateDir, { recursive: true, mode: 0o700 });
    }
    const stateStat = await fs.lstat(this.#config.stateDir);
    if (stateStat.isSymbolicLink() || !stateStat.isDirectory()) {
      throw new Error("Local AI Assist stateDir must be a real directory.");
    }
    await fs.chmod(this.#config.stateDir, 0o700);
    await this.reconcileRuns({ startup: true });
    await pruneRetention(this.#config);
  }

  async snapshot(): Promise<Record<string, unknown>> {
    const configErrors = this.#config.enabled ? validateEnabledRingerConfig(this.#config) : [];
    const pins =
      this.#config.enabled && configErrors.length === 0
        ? await verifyPins(this.#config)
        : undefined;
    const capacity =
      this.#config.enabled && configErrors.length === 0
        ? await inspectCapacity(this.#config)
        : undefined;
    const runs = await readRunReceipts(this.#config);
    return {
      enabled: this.#config.enabled,
      productionEnabled: this.#config.productionEnabled,
      health: !this.#config.enabled
        ? "disabled"
        : configErrors.length > 0
          ? "blocked"
          : pins?.ok && capacity?.admittedParallel
            ? "ready"
            : "blocked",
      configErrors,
      pins,
      policy: {
        allowedRepositories: this.#config.allowedRepositories.map((repo) => ({
          root: repo.root,
          checkArgvPrefixes: repo.checkArgvPrefixes,
          models: repo.models,
        })),
        maxParallel: this.#config.maxParallel,
        maxTasks: this.#config.maxTasks,
        maxPatchBytes: this.#config.maxPatchBytes,
        maxSnapshotBytes: this.#config.maxSnapshotBytes,
        maxSnapshotStorageBytes: this.#config.maxSnapshotStorageBytes,
        rawRetentionDays: this.#config.rawRetentionDays,
        receiptRetentionDays: this.#config.receiptRetentionDays,
        minFreeMemoryBytesForTwoWorkers: this.#config.minFreeMemoryBytesForTwoWorkers,
      },
      capacity,
      cleanup: await inspectCleanupState(this.#config, runs),
      activeRuns: runs.filter((run) => run.status === "queued" || run.status === "running"),
      terminalRuns: runs.filter((run) => !["queued", "running"].includes(run.status)).slice(0, 20),
    };
  }

  async inspectCleanupState(existingRuns?: RingerRunReceipt[]): Promise<Record<string, unknown>> {
    return await inspectCleanupState(this.#config, existingRuns);
  }

  async findInvalidRunReceipts(): Promise<string[]> {
    return await findInvalidRunReceiptsFromReceipts(this.#config);
  }

  async pruneRetention(now = Date.now()): Promise<void> {
    await pruneRetention(this.#config, now);
  }

  async prepare(request: RingerPrepareRequest): Promise<RingerSnapshotReceipt> {
    assertEnabled(this.#config);
    await this.#auth.verifyAndConsume(
      // SAFETY: Gateway request objects are serialized as records after auth is removed.
      payloadWithoutAuth(request as unknown as Record<string, unknown>),
      request.auth,
    );
    const pins = await verifyPins(this.#config);
    if (!pins.ok) {
      throw new Error(`Local AI Assist pin verification failed: ${pins.errors.join(" ")}`);
    }
    const operation = this.#snapshotQueue.then(() =>
      prepareShadowSnapshot({
        config: this.#config,
        repo: request.repo,
        expectedHeadSha: request.expectedHeadSha,
        includeUntrackedPaths: request.includeUntrackedPaths,
      }),
    );
    this.#snapshotQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return await operation;
  }

  async run(request: RingerRunRequest): Promise<Record<string, unknown>> {
    assertEnabled(this.#config);
    await this.#auth.verifyAndConsume(
      // SAFETY: Gateway request objects are serialized as records after auth is removed.
      payloadWithoutAuth(request as unknown as Record<string, unknown>),
      request.auth,
    );
    const pins = await verifyPins(this.#config);
    if (!pins.ok) {
      throw new Error(`Local AI Assist pin verification failed: ${pins.errors.join(" ")}`);
    }
    const snapshot = await loadSnapshot(this.#config, request.snapshotId);
    if (snapshot.sourceSha !== request.expectedSourceSha) {
      throw new Error("Expected source SHA does not match the retained snapshot.");
    }
    const currentDigest = await computeCurrentWorkspaceDigest({
      config: this.#config,
      receipt: snapshot,
    });
    if (currentDigest !== snapshot.workspaceDigest) {
      throw new Error(
        "Codex workspace drifted after snapshot preparation; return patches for manual reconciliation.",
      );
    }
    const { policy } = await resolveRepositoryPolicy(this.#config, snapshot.repo);
    const { manifest, manifestSha256 } = await readAndValidateManifest({
      config: this.#config,
      manifestPath: request.manifestPath,
      expectedManifestSha256: request.expectedManifestSha256,
      snapshot,
      policy,
      expectedEnvironmentDigest: pinsDigest(pins.actual),
    });
    if (request.qualification === true && request.action !== "start") {
      throw new Error("Qualification mode is available only for the start action.");
    }
    const preparationDir = preparationRoot(this.#config, manifestSha256);
    await fs.mkdir(preparationDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(preparationDir, "tmp"), { recursive: true, mode: 0o700 });
    const native = await materializeNativeManifest({
      config: this.#config,
      manifest,
      snapshot,
      policy,
      preparationDir,
      workerScriptPath: WORKER_SCRIPT_PATH,
      verifierScriptPath: VERIFIER_SCRIPT_PATH,
      nodePath: process.execPath,
    });
    const pinIdentity = pinsDigest(pins.actual);
    if (request.action !== "lint") {
      const prerequisite: GateName =
        request.action === "dry_run"
          ? "lint"
          : request.action === "baseline"
            ? "dry_run"
            : "baseline";
      await assertGate({
        preparationDir,
        gate: prerequisite,
        manifestSha256,
        snapshot,
        pinIdentity,
        tasks: manifest.tasks,
      });
    }
    if (request.action === "start") {
      return await this.#start({
        manifest,
        manifestSha256,
        snapshot,
        preparationDir,
        nativeManifestPath: native.nativeManifestPath,
        qualification: request.qualification === true,
      });
    }
    const result = await runCommand(
      "python3",
      ringerArgs(this.#config, native.nativeManifestPath, request.action),
      {
        cwd: this.#config.ringerSourceDir,
        timeoutMs: Math.max(120_000, manifest.tasks.length * 70_000),
        env: ringerEnv(preparationDir, path.join(preparationDir, "contracts")),
      },
    );
    const output = Buffer.concat([result.stdout, result.stderr]).toString("utf8");
    let baseline: Record<string, "pass" | "fail"> | undefined;
    if (result.code !== 0) {
      throw commandFailure(
        "python3",
        ringerArgs(this.#config, native.nativeManifestPath, request.action),
        result,
      );
    }
    if (request.action === "baseline") {
      baseline = parseAndValidateBaseline(output, manifest.tasks);
    }
    const receipt: GateReceipt = {
      schemaVersion: 1,
      gate: request.action,
      manifestSha256,
      snapshotId: snapshot.snapshotId,
      sourceSha: snapshot.sourceSha,
      pinsDigest: pinIdentity,
      completedAt: nowIso(),
      outputSha256: sha256Bytes(output),
      baseline,
    };
    const gateLogPath = path.join(preparationDir, "gates", `${request.action}.log`);
    await fs.mkdir(path.dirname(gateLogPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(gateLogPath, output, { mode: 0o600 });
    await fs.chmod(gateLogPath, 0o600);
    await writeJsonAtomic(gatePath(preparationDir, request.action), receipt);
    return { ok: true, gate: receipt, output: output.slice(-20_000) };
  }

  async #start(params: {
    manifest: RingerAdapterManifest;
    manifestSha256: string;
    snapshot: RingerSnapshotReceipt;
    preparationDir: string;
    nativeManifestPath: string;
    qualification: boolean;
  }): Promise<RingerRunReceipt> {
    const operation = this.#startQueue.then(() => this.#startUnsafe(params));
    this.#startQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return await operation;
  }

  async #startUnsafe(params: {
    manifest: RingerAdapterManifest;
    manifestSha256: string;
    snapshot: RingerSnapshotReceipt;
    preparationDir: string;
    nativeManifestPath: string;
    qualification: boolean;
  }): Promise<RingerRunReceipt> {
    if (params.qualification && this.#config.productionEnabled) {
      throw new Error("Qualification canaries require production routing to remain disabled.");
    }
    if (!params.qualification && !this.#config.productionEnabled) {
      throw new Error("Local AI Assist production routing is disabled; start is fail-closed.");
    }
    if (params.qualification) {
      assertQualificationCanaryManifest(params.manifest, this.#config.maxTasks);
    } else {
      await verifyQualificationReceipt({ config: this.#config, manifest: params.manifest });
    }
    const { policy } = await resolveRepositoryPolicy(this.#config, params.snapshot.repo);
    for (const task of params.manifest.tasks) {
      const model = policy.models.find((candidate) => candidate.ref === task.model);
      if (!model) {
        throw new Error(`Model is not allowlisted for this repository: ${task.model}`);
      }
      if (!params.qualification && !model.canaryApproved) {
        throw new Error(`Model has not passed live canary qualification: ${task.model}`);
      }
    }
    const runKind = params.qualification ? "qualification-canary" : "production";
    const existing = (await readRunReceipts(this.#config)).find(
      (receipt) =>
        receipt.manifestSha256 === params.manifestSha256 &&
        receipt.action === "start" &&
        (receipt.runKind ?? "production") === runKind,
    );
    if (existing) {
      return existing;
    }
    const requestedWorkers: 1 | 2 = params.manifest.max_parallel === 2 ? 2 : 1;
    let capacity = await inspectCapacity(this.#config);
    const requestedModels = [
      ...new Set(params.manifest.tasks.map((task) => task.model)),
    ].toSorted();
    let missingResidentModels = requestedModels.filter(
      (model) => !capacity.residentModels.some((name) => modelNameMatchesRef(name, model)),
    );
    if (
      missingResidentModels.length > 0 &&
      capacity.ollamaReady &&
      missingResidentModels.every((model) =>
        capacity.installedModels.some((name) => modelNameMatchesRef(name, model)),
      )
    ) {
      const warmed = await Promise.all(
        missingResidentModels.map((model) => warmOllamaModel(this.#config.ollamaBaseUrl, model)),
      );
      if (warmed.every(Boolean)) {
        await Promise.all(
          missingResidentModels.map((model) =>
            waitForResidentOllamaModel(this.#config.ollamaBaseUrl, model),
          ),
        );
      }
      capacity = await inspectCapacity(this.#config);
      missingResidentModels = requestedModels.filter(
        (model) => !capacity.residentModels.some((name) => modelNameMatchesRef(name, model)),
      );
    }
    if (
      !canReserveWorkerSlots({
        admittedParallel: capacity.admittedParallel,
        reservedWorkers: this.#reservedWorkerCount,
        requestedWorkers,
      })
    ) {
      throw new Error(
        `Resource admission allows ${Math.max(0, capacity.admittedParallel - this.#reservedWorkerCount)} additional worker(s), but manifest requests ${params.manifest.max_parallel}: ${capacity.reasons.join(" ")}`,
      );
    }
    if (params.manifest.max_parallel === 2) {
      if (missingResidentModels.length > 0) {
        throw new Error(
          `Two-worker admission requires every exact task model to be resident: ${missingResidentModels.toSorted().join(", ")}`,
        );
      }
    }
    if (missingResidentModels.length > 0) {
      throw new Error(
        `Exact task model is not resident after bounded prewarm: ${missingResidentModels.toSorted().join(", ")}`,
      );
    }
    for (const task of params.manifest.tasks) {
      const modelId = task.model.replace(/^ollama\//u, "");
      if (
        !capacity.installedModels.some((name) => name === modelId || name === `${modelId}:latest`)
      ) {
        throw new Error(
          `Exact model is not installed in Ollama; automatic downloads are forbidden: ${modelId}`,
        );
      }
    }
    const runId = `run-${crypto.randomUUID()}`;
    const runRoot = path.join(this.#config.stateDir, "runs", runId);
    const logPath = path.join(runRoot, "ringer.log");
    await fs.mkdir(runRoot, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(runRoot, "home"), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(runRoot, "tmp"), { recursive: true, mode: 0o700 });
    const logHandle = await fs.open(logPath, "wx", 0o600);
    this.#reservedWorkerCount += requestedWorkers;
    this.#runWorkerReservations.set(runId, requestedWorkers);
    const receipt: RingerRunReceipt = {
      runId,
      runName: params.manifest.run_name,
      manifestSha256: params.manifestSha256,
      snapshotId: params.snapshot.snapshotId,
      sourceSha: params.snapshot.sourceSha,
      status: "queued",
      action: "start",
      runKind,
      startedAt: nowIso(),
      logPath,
      tasks: params.manifest.tasks.map((task) => ({
        key: task.key,
        status: "queued",
        attempts: 0,
        model: task.model,
        artifactDir: "",
      })),
    };
    let child: ReturnType<typeof spawn> | undefined;
    try {
      await writeJsonAtomic(runReceiptPath(this.#config, runId), receipt);
      return await this.#withRunLock(runId, async () => {
        const persistedBeforeSpawn = parseRunReceipt(
          await readJson<unknown>(runReceiptPath(this.#config, runId)),
          this.#config,
          runId,
        );
        if (persistedBeforeSpawn.status === "cancelled") {
          this.#releaseWorkerReservation(runId);
          await logHandle.close().catch(() => {});
          return persistedBeforeSpawn;
        }
        child = spawn("python3", ringerArgs(this.#config, params.nativeManifestPath, "start"), {
          cwd: this.#config.ringerSourceDir,
          env: ringerEnv(runRoot, path.join(params.preparationDir, "contracts")),
          detached: process.platform !== "win32",
          stdio: ["ignore", logHandle.fd, logHandle.fd],
        });
        receipt.pid = child.pid;
        receipt.status = "running";
        receipt.tasks = receipt.tasks.map((task) => ({ ...task, status: "running" }));
        await writeJsonAtomic(runReceiptPath(this.#config, runId), receipt);
        child.once("error", () => {
          void this.#finalizeRun(receipt, params.manifest, 1).catch(() => {});
        });
        child.once("close", (code) => {
          void (async () => {
            await logHandle.close().catch(() => {});
            await this.#finalizeRun(receipt, params.manifest, code).catch(() => {});
          })();
        });
        child.unref();
        return receipt;
      });
    } catch (error) {
      child?.kill("SIGTERM");
      this.#releaseWorkerReservation(runId);
      await logHandle.close().catch(() => {});
      throw error;
    }
  }

  #releaseWorkerReservation(runId: string): void {
    const reserved = this.#runWorkerReservations.get(runId);
    if (reserved === undefined) {
      return;
    }
    this.#runWorkerReservations.delete(runId);
    this.#reservedWorkerCount = Math.max(0, this.#reservedWorkerCount - reserved);
  }

  async #finalizeRun(
    receipt: RingerRunReceipt,
    manifest: RingerAdapterManifest,
    code: number | null,
  ): Promise<void> {
    await this.#withRunLock(receipt.runId, () =>
      this.#finalizeRunUnlocked(receipt, manifest, code),
    );
  }

  async #finalizeRunUnlocked(
    receipt: RingerRunReceipt,
    manifest: RingerAdapterManifest,
    code: number | null,
  ): Promise<void> {
    try {
      const persisted = parseRunReceipt(
        await readJson<unknown>(runReceiptPath(this.#config, receipt.runId)),
        this.#config,
        receipt.runId,
      );
      if (persisted.status === "cancelled" || persisted.status === "interrupted") {
        persisted.finishedAt ??= nowIso();
        delete persisted.pid;
        await cleanupRunWorktrees(this.#config, persisted).catch(() => {});
        this.#releaseWorkerReservation(persisted.runId);
        await writeJsonAtomic(runReceiptPath(this.#config, persisted.runId), persisted);
        return;
      }
    } catch {
      // The in-memory receipt remains authoritative if the retained receipt is unavailable.
    }
    let log = "";
    try {
      log = await fs.readFile(receipt.logPath, "utf8");
    } catch {}
    const nativeRunId = [...log.matchAll(/^run_id:\s*(\S+)\s*$/gmu)].at(-1)?.[1];
    receipt.nativeRunId = nativeRunId;
    receipt.exitCode = code;
    receipt.finishedAt = nowIso();
    if (nativeRunId) {
      try {
        const nativeState = await readJson<Record<string, unknown>>(
          path.join(this.#config.stateDir, "upstream", "runs", `${nativeRunId}.json`),
        );
        const nativeTasks = Array.isArray(nativeState.tasks) ? nativeState.tasks : [];
        const artifactRoot = path.join(
          this.#config.stateDir,
          "upstream",
          "artifacts",
          "deliverables",
          nativeRunId,
        );
        const validArtifacts = new Map<string, boolean>();
        const artifactTelemetry = new Map<
          string,
          { sessionAttempts: number; modelCompletions: number; sessionRetries: number }
        >();
        for (const task of manifest.tasks) {
          const artifactDir = path.join(artifactRoot, task.key);
          const validation = await this.#validateArtifacts(artifactDir, task);
          validArtifacts.set(task.key, validation.valid);
          if (validation.telemetry) {
            artifactTelemetry.set(task.key, validation.telemetry);
          }
        }
        receipt.tasks = buildNativeTaskReceipts({
          manifestTasks: manifest.tasks,
          nativeTasks,
          artifactRoot,
          validArtifacts,
          artifactTelemetry,
        });
        receipt.status =
          code === 0 && receipt.tasks.every((task) => task.status === "pass") ? "pass" : "fail";
      } catch {
        receipt.status = "fail";
        receipt.tasks = receipt.tasks.map((task) => ({ ...task, status: "fail" }));
      }
    } else if (receipt.status !== "cancelled") {
      receipt.status = "fail";
      receipt.tasks = receipt.tasks.map((task) => ({ ...task, status: "fail" }));
    }
    await cleanupRunWorktrees(this.#config, receipt).catch(() => {});
    this.#releaseWorkerReservation(receipt.runId);
    delete receipt.pid;
    await writeJsonAtomic(runReceiptPath(this.#config, receipt.runId), receipt);
  }

  async #validateArtifacts(
    artifactDir: string,
    task: RingerTaskManifest,
  ): Promise<{
    valid: boolean;
    telemetry?: { sessionAttempts: number; modelCompletions: number; sessionRetries: number };
  }> {
    try {
      const [patchDigest, checkDigest, verifierReceipt, changedFiles] = await Promise.all([
        sha256File(path.join(artifactDir, "changes.patch")),
        sha256File(path.join(artifactDir, "check.log")),
        readJson<Record<string, unknown>>(path.join(artifactDir, "receipt.json")),
        readJson<unknown>(path.join(artifactDir, "changed-files.json")),
      ]);
      if (
        verifierReceipt.schemaVersion !== 1 ||
        verifierReceipt.taskKey !== task.key ||
        verifierReceipt.status !== "pass" ||
        verifierReceipt.model !== task.model ||
        verifierReceipt.patchSha256 !== patchDigest ||
        verifierReceipt.checkSha256 !== checkDigest ||
        !Array.isArray(changedFiles) ||
        JSON.stringify(changedFiles) !== JSON.stringify(verifierReceipt.changedFiles)
      ) {
        return { valid: false };
      }
      const patchStat = await fs.stat(path.join(artifactDir, "changes.patch"));
      const sessionAttempts = verifierReceipt.sessionAttempts;
      const modelCompletions = verifierReceipt.modelCompletions;
      const sessionRetries = verifierReceipt.sessionRetries;
      if (
        typeof sessionAttempts !== "number" ||
        typeof modelCompletions !== "number" ||
        typeof sessionRetries !== "number" ||
        !Number.isInteger(sessionAttempts) ||
        !Number.isInteger(modelCompletions) ||
        !Number.isInteger(sessionRetries) ||
        sessionAttempts < 1 ||
        sessionAttempts > 2 ||
        modelCompletions < 1 ||
        sessionRetries !== sessionAttempts - 1
      ) {
        return { valid: false };
      }
      const telemetry = { sessionAttempts, modelCompletions, sessionRetries };
      return {
        valid:
          patchStat.size <= this.#config.maxPatchBytes && (!task.must_change || patchStat.size > 0),
        telemetry,
      };
    } catch {
      return { valid: false };
    }
  }

  async cancel(request: RingerCancelRequest): Promise<RingerRunReceipt> {
    assertEnabled(this.#config);
    await this.#auth.verifyAndConsume(
      // SAFETY: Gateway request objects are serialized as records after auth is removed.
      payloadWithoutAuth(request as unknown as Record<string, unknown>),
      request.auth,
    );
    const pins = await verifyPins(this.#config);
    if (!pins.ok) {
      throw new Error(`Local AI Assist pin verification failed: ${pins.errors.join(" ")}`);
    }
    if (!/^run-[a-f0-9-]{36}$/u.test(request.runId)) {
      throw new Error("Invalid retained run ID.");
    }
    return await this.#withRunLock(request.runId, async () => {
      const file = runReceiptPath(this.#config, request.runId);
      const receipt = parseRunReceipt(await readJson<unknown>(file), this.#config, request.runId);
      if (receipt.status !== "queued" && receipt.status !== "running") {
        return receipt;
      }
      if (receipt.pid) {
        if (!(await terminateOwnedRingerProcess(this.#config, receipt))) {
          throw new Error(
            "Refusing to terminate a run process whose exact Ringer identity cannot be verified.",
          );
        }
      }
      receipt.status = "cancelled";
      receipt.finishedAt = nowIso();
      receipt.tasks = receipt.tasks.map((task) => ({ ...task, status: "interrupted" }));
      delete receipt.pid;
      await cleanupRunWorktrees(this.#config, receipt).catch(() => {});
      this.#releaseWorkerReservation(receipt.runId);
      // Publish the durable terminal receipt only after bounded cleanup has
      // completed, so callers never observe cancellation as complete while a
      // task worktree or owned worker container is still being reconciled.
      await writeJsonAtomic(file, receipt);
      return receipt;
    });
  }

  async #withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#runLocks.get(runId);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#runLocks.set(runId, current);
    await previous?.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.#runLocks.get(runId) === current) {
        this.#runLocks.delete(runId);
      }
    }
  }

  async reconcileRuns(options: { startup?: boolean } = {}): Promise<void> {
    for (const receipt of await readRunReceipts(this.#config, true)) {
      if (receipt.status !== "queued" && receipt.status !== "running") {
        continue;
      }
      if (receipt.pid && isProcessAlive(receipt.pid) && options.startup) {
        if (!(await terminateOwnedRingerProcess(this.#config, receipt))) {
          throw new Error(
            `Active Local AI Assist run ${receipt.runId} survived Gateway restart with an unverified process identity.`,
          );
        }
      }
      if (!receipt.pid || !isProcessAlive(receipt.pid)) {
        receipt.status = "interrupted";
        receipt.finishedAt = nowIso();
        receipt.tasks = receipt.tasks.map((task) => ({ ...task, status: "interrupted" }));
        delete receipt.pid;
        await cleanupRunWorktrees(this.#config, receipt).catch(() => {});
        this.#releaseWorkerReservation(receipt.runId);
        await writeJsonAtomic(runReceiptPath(this.#config, receipt.runId), receipt);
      }
    }
  }
}
