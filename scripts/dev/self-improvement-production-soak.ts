import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { rollbackGatewayRuntimeSnapshot } from "../../src/daemon/gateway-runtime-snapshot.js";
import { callGatewayCli } from "../../src/gateway/call.js";
import {
  SELF_IMPROVEMENT_PRODUCTION_SOAK_MS,
  type SelfImprovementSoakSample,
} from "../../src/self-improvement/acceptance.js";
import {
  appendSelfImprovementSoakSample,
  createSelfImprovementSoakReceipt,
  evaluateSelfImprovementSoakReceipt,
  parseSelfImprovementSoakReceipt,
  recordSelfImprovementSoakError,
  recordSelfImprovementSoakRestart,
  recordSelfImprovementSoakRollback,
  shouldAutomaticallyRollbackSelfImprovementSoak,
  type SelfImprovementSoakReceipt,
} from "../../src/self-improvement/soak.js";

const DEFAULT_RECEIPT_PATH = "work/self-improvement/sig-production-soak.json";
const DEFAULT_DASHBOARD_BASE_URL = "http://127.0.0.1:18789";
const SAMPLE_INTERVAL_MS = 6 * 60 * 60_000;
const ERROR_RETRY_MS = 5 * 60_000;
const MANAGED_RESTART_OFFSETS_MS = [24 * 60 * 60_000, 48 * 60 * 60_000] as const;
const MAX_ROLLBACK_EVIDENCE_BYTES = 5 * 1024 * 1024;
const MAX_LIVE_LOCK_AGE_MS = 96 * 60 * 60_000;
const DASHBOARD_ROUTES = ["/", "/self-improvement", "/healthz", "/readyz"] as const;

const productionResultSchema = z.object({
  status: z.enum(["ready", "degraded", "blocked"]),
  ready: z.boolean(),
  score: z.number().finite(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  health: z.object({
    dimensions: z.array(
      z.object({
        id: z.string(),
        metrics: z.array(
          z.object({
            key: z.string(),
            value: z.union([z.string(), z.number(), z.boolean()]),
          }),
        ),
      }),
    ),
  }),
  runtime: z.object({ releaseId: z.string().trim().min(1) }),
});

type GatewayCall = (method: string, params: unknown) => Promise<unknown>;
type RouteProbe = (url: string) => Promise<boolean>;

export type SelfImprovementSoakDependencies = {
  callGateway: GatewayCall;
  now: () => number;
  probeRoute: RouteProbe;
  restartManagedGateway: () => Promise<void>;
  rollbackCandidate: (params: {
    candidateReleaseId: string;
    rollbackReleaseId: string;
  }) => Promise<{ releaseId: string; performedAt: number; verifiedAt: number }>;
  sleep: (durationMs: number) => Promise<void>;
};

function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveBoundedArtifactPath(candidatePath: string, rootDir = process.cwd()): string {
  const artifactsRoot = path.resolve(rootDir, "work", "self-improvement");
  const resolved = path.resolve(rootDir, candidatePath);
  if (!isPathInside(resolved, artifactsRoot)) {
    throw new Error("SIG soak artifacts must stay under work/self-improvement.");
  }
  return resolved;
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await fs.open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some filesystems do not support directory fsync. The file itself is still synced.
  }
}

export async function writeSelfImprovementSoakReceipt(params: {
  filePath: string;
  receipt: SelfImprovementSoakReceipt;
  exclusive?: boolean;
}): Promise<void> {
  const receipt = parseSelfImprovementSoakReceipt(params.receipt);
  const directory = path.dirname(params.filePath);
  await fs.mkdir(directory, { recursive: true });
  if (params.exclusive) {
    try {
      await fs.access(params.filePath);
      throw new Error(`Refusing to overwrite existing soak receipt: ${params.filePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  const temporaryPath = path.join(
    directory,
    `.${path.basename(params.filePath)}.${randomUUID()}.tmp`,
  );
  const handle = await fs.open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporaryPath, params.filePath);
    await syncDirectory(directory);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function readSelfImprovementSoakReceipt(
  filePath: string,
): Promise<SelfImprovementSoakReceipt> {
  return parseSelfImprovementSoakReceipt(JSON.parse(await fs.readFile(filePath, "utf8")));
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function withSelfImprovementSoakReceiptLock<T>(params: {
  receiptPath: string;
  run: () => Promise<T>;
}): Promise<T> {
  const lockPath = `${params.receiptPath}.lock`;
  const token = randomUUID();
  const payload = { version: 1, pid: process.pid, token, createdAt: Date.now() };
  let acquired = false;
  for (let attempt = 0; attempt < 3 && !acquired; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(payload)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      let existing: { pid?: unknown; createdAt?: unknown } = {};
      try {
        existing = JSON.parse(await fs.readFile(lockPath, "utf8")) as typeof existing;
      } catch {
        // An unreadable lock is preserved below before retrying acquisition.
      }
      const pid = typeof existing.pid === "number" ? existing.pid : -1;
      const createdAt = typeof existing.createdAt === "number" ? existing.createdAt : 0;
      const lockIsCurrent =
        processIsAlive(pid) &&
        Date.now() - createdAt >= 0 &&
        Date.now() - createdAt <= MAX_LIVE_LOCK_AGE_MS;
      if (lockIsCurrent) {
        throw new Error(`A SIG production soak process already owns ${params.receiptPath}.`, {
          cause: error,
        });
      }
      try {
        await fs.rename(lockPath, `${lockPath}.stale.${randomUUID()}`);
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw renameError;
        }
      }
    }
  }
  if (!acquired) {
    throw new Error(`Unable to acquire SIG production soak receipt lock: ${lockPath}`);
  }
  try {
    return await params.run();
  } finally {
    try {
      const current = JSON.parse(await fs.readFile(lockPath, "utf8")) as { token?: unknown };
      if (current.token === token) {
        await fs.rm(lockPath, { force: true });
      }
    } catch {
      // Never remove a lock whose ownership cannot be verified.
    }
  }
}

export async function hashSelfImprovementSoakEvidence(params: {
  filePath: string;
  rootDir?: string;
}): Promise<{ path: string; sha256: string }> {
  const rootDir = path.resolve(params.rootDir ?? process.cwd());
  const filePath = resolveBoundedArtifactPath(params.filePath, rootDir);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_ROLLBACK_EVIDENCE_BYTES) {
    throw new Error("Rollback evidence must be a non-empty bounded file.");
  }
  const content = await fs.readFile(filePath);
  return {
    path: path.relative(rootDir, filePath),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function readSafetyViolations(result: z.infer<typeof productionResultSchema>): {
  safetyViolations: number;
  blocker?: string;
} {
  const metric = result.health.dimensions
    .find((dimension) => dimension.id === "effectiveness")
    ?.metrics.find((entry) => entry.key === "safetyViolations");
  if (typeof metric?.value !== "number" || !Number.isInteger(metric.value) || metric.value < 0) {
    return {
      safetyViolations: 1,
      blocker: "Production health omitted the numeric safetyViolations metric.",
    };
  }
  return { safetyViolations: metric.value };
}

async function probeDashboardRoutes(params: {
  baseUrl: string;
  probeRoute: RouteProbe;
}): Promise<boolean> {
  const baseUrl = params.baseUrl.replace(/\/$/u, "");
  const results = await Promise.all(
    DASHBOARD_ROUTES.map((route) => params.probeRoute(`${baseUrl}${route}`)),
  );
  return results.every(Boolean);
}

export async function collectSelfImprovementSoakSample(params: {
  callGateway: GatewayCall;
  dashboardBaseUrl: string;
  now: () => number;
  probeRoute: RouteProbe;
}): Promise<SelfImprovementSoakSample> {
  const production = productionResultSchema.parse(
    await params.callGateway("selfImprovement.productionCheck", {
      days: 14,
      limit: 14,
      failOnDegraded: true,
      failOnBlocked: true,
      requireModelReady: true,
      requireEvalsReady: true,
    }),
  );
  let rpcReady = true;
  try {
    await params.callGateway("selfImprovement.summary", { limit: 100 });
  } catch {
    rpcReady = false;
  }
  const dashboardReady = await probeDashboardRoutes({
    baseUrl: params.dashboardBaseUrl,
    probeRoute: params.probeRoute,
  });
  const safety = readSafetyViolations(production);
  return {
    observedAt: params.now(),
    runtimeReleaseId: production.runtime.releaseId,
    productionReady: production.ready && production.status === "ready",
    productionScore: production.score,
    blockers: [
      ...production.blockers,
      ...production.warnings,
      ...(rpcReady ? [] : ["selfImprovement.summary RPC failed."]),
      ...(dashboardReady ? [] : ["One or more dashboard acceptance routes failed."]),
      ...(safety.blocker ? [safety.blocker] : []),
    ],
    rpcReady,
    dashboardReady,
    safetyViolations: safety.safetyViolations,
  };
}

export async function executeSelfImprovementSoakCycle(params: {
  receipt: SelfImprovementSoakReceipt;
  dashboardBaseUrl: string;
  dependencies: SelfImprovementSoakDependencies;
}): Promise<{ receipt: SelfImprovementSoakReceipt; rolledBack: boolean }> {
  let receipt = parseSelfImprovementSoakReceipt(params.receipt);
  let sample: SelfImprovementSoakSample;
  try {
    sample = await collectSelfImprovementSoakSample({
      callGateway: params.dependencies.callGateway,
      dashboardBaseUrl: params.dashboardBaseUrl,
      now: params.dependencies.now,
      probeRoute: params.dependencies.probeRoute,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      receipt: recordSelfImprovementSoakError({
        receipt,
        error: `Sample collection failed: ${message}`,
        observedAt: params.dependencies.now(),
      }),
      rolledBack: false,
    };
  }
  receipt = appendSelfImprovementSoakSample({ receipt, sample });
  if (!shouldAutomaticallyRollbackSelfImprovementSoak({ receipt, sample })) {
    return { receipt, rolledBack: false };
  }
  const rollbackReleaseId = receipt.rollbackReleaseId;
  if (!rollbackReleaseId) {
    throw new Error("Automatic rollback was enabled without a preregistered release.");
  }
  const rollback = await params.dependencies.rollbackCandidate({
    candidateReleaseId: receipt.candidateReleaseId,
    rollbackReleaseId,
  });
  return {
    receipt: recordSelfImprovementSoakRollback({
      receipt,
      performedAt: rollback.performedAt,
      verifiedAt: rollback.verifiedAt,
      toReleaseId: rollback.releaseId,
    }),
    rolledBack: true,
  };
}

async function runFixedCommand(params: {
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["--silent", "openclaw", ...params.args], {
      cwd: params.cwd,
      env: params.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `OpenClaw command failed (${signal ? `signal ${signal}` : `exit ${String(code)}`}): ${params.args.join(" ")}`,
        ),
      );
    });
  });
}

async function waitForRuntimeRelease(params: {
  callGateway: GatewayCall;
  releaseId: string;
  sleep: (durationMs: number) => Promise<void>;
}): Promise<number> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const result = productionResultSchema.parse(
        await params.callGateway("selfImprovement.productionCheck", {
          days: 14,
          limit: 14,
          requireModelReady: true,
          requireEvalsReady: true,
        }),
      );
      if (result.runtime.releaseId === params.releaseId) {
        return Date.now();
      }
    } catch {
      // Managed restart can temporarily close the RPC listener.
    }
    await params.sleep(2_000);
  }
  throw new Error(`Gateway did not activate expected runtime release ${params.releaseId}.`);
}

function defaultGatewayCall(params: { gatewayUrl?: string }): GatewayCall {
  return async (method, methodParams) =>
    await callGatewayCli({
      ...(params.gatewayUrl ? { url: params.gatewayUrl } : {}),
      method,
      params: methodParams,
      timeoutMs: 60_000,
      mode: "cli",
      clientName: "cli",
    });
}

function defaultRouteProbe(url: string): Promise<boolean> {
  return fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  })
    .then((response) => response.status === 200)
    .catch(() => false);
}

function buildDefaultDependencies(params: {
  gatewayUrl?: string;
  rootDir: string;
}): SelfImprovementSoakDependencies {
  const callGateway = defaultGatewayCall(params);
  const sleep = async (durationMs: number) =>
    await new Promise<void>((resolve) => {
      setTimeout(resolve, durationMs);
    });
  const childEnv = { ...process.env };
  delete childEnv.OPENCLAW_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS;
  return {
    callGateway,
    now: () => Date.now(),
    probeRoute: defaultRouteProbe,
    sleep,
    restartManagedGateway: async () => {
      await runFixedCommand({
        args: ["gateway", "restart", "--force", "--json"],
        cwd: params.rootDir,
        env: childEnv,
      });
    },
    rollbackCandidate: async ({ candidateReleaseId, rollbackReleaseId }) => {
      const before = productionResultSchema.parse(
        await callGateway("selfImprovement.productionCheck", {
          days: 14,
          limit: 14,
          requireModelReady: true,
          requireEvalsReady: true,
        }),
      );
      if (before.runtime.releaseId !== candidateReleaseId) {
        throw new Error(
          "Refusing rollback because the active runtime is not the scoped candidate.",
        );
      }
      const performedAt = Date.now();
      rollbackGatewayRuntimeSnapshot({ rootDir: params.rootDir, releaseId: rollbackReleaseId });
      await runFixedCommand({
        args: ["gateway", "restart", "--force", "--json"],
        cwd: params.rootDir,
        env: childEnv,
      });
      const verifiedAt = await waitForRuntimeRelease({
        callGateway,
        releaseId: rollbackReleaseId,
        sleep,
      });
      return { releaseId: rollbackReleaseId, performedAt, verifiedAt };
    },
  };
}

async function restartAndVerifyCandidate(params: {
  receipt: SelfImprovementSoakReceipt;
  dashboardBaseUrl: string;
  dependencies: SelfImprovementSoakDependencies;
}): Promise<SelfImprovementSoakReceipt> {
  await params.dependencies.restartManagedGateway();
  const verifiedAt = await waitForRuntimeRelease({
    callGateway: params.dependencies.callGateway,
    releaseId: params.receipt.candidateReleaseId,
    sleep: params.dependencies.sleep,
  });
  const sample = await collectSelfImprovementSoakSample({
    callGateway: params.dependencies.callGateway,
    dashboardBaseUrl: params.dashboardBaseUrl,
    now: () => verifiedAt,
    probeRoute: params.dependencies.probeRoute,
  });
  return recordSelfImprovementSoakRestart({
    receipt: appendSelfImprovementSoakSample({ receipt: params.receipt, sample }),
    releaseId: sample.runtimeReleaseId,
    observedAt: verifiedAt,
  });
}

export async function runSelfImprovementProductionSoak(params: {
  receiptPath: string;
  dashboardBaseUrl: string;
  dependencies: SelfImprovementSoakDependencies;
}): Promise<SelfImprovementSoakReceipt> {
  let receipt = await readSelfImprovementSoakReceipt(params.receiptPath);
  while (true) {
    const cycle = await executeSelfImprovementSoakCycle({
      receipt,
      dashboardBaseUrl: params.dashboardBaseUrl,
      dependencies: params.dependencies,
    });
    receipt = cycle.receipt;
    await writeSelfImprovementSoakReceipt({ filePath: params.receiptPath, receipt });
    if (cycle.rolledBack) {
      return receipt;
    }

    const now = params.dependencies.now();
    const elapsedMs = Math.max(0, now - receipt.startedAt);
    for (const [index, offsetMs] of MANAGED_RESTART_OFFSETS_MS.entries()) {
      if (elapsedMs >= offsetMs && receipt.managedRestartReleaseIds.length <= index) {
        receipt = await restartAndVerifyCandidate({
          receipt,
          dashboardBaseUrl: params.dashboardBaseUrl,
          dependencies: params.dependencies,
        });
        await writeSelfImprovementSoakReceipt({ filePath: params.receiptPath, receipt });
      }
    }

    const evaluation = evaluateSelfImprovementSoakReceipt(receipt, params.dependencies.now());
    if (evaluation.status !== "pending") {
      return receipt;
    }
    const remainingMs = Math.max(
      0,
      receipt.startedAt + SELF_IMPROVEMENT_PRODUCTION_SOAK_MS - params.dependencies.now(),
    );
    const delayMs = receipt.lastError
      ? ERROR_RETRY_MS
      : remainingMs > 0
        ? Math.min(SAMPLE_INTERVAL_MS, remainingMs)
        : SAMPLE_INTERVAL_MS;
    await params.dependencies.sleep(delayMs);
  }
}

function optionValue(values: Record<string, unknown>, key: string): string | undefined {
  const value = values[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || !["start", "sample", "run", "status"].includes(command)) {
    throw new Error(
      "Usage: self-improvement-production-soak.ts <start|sample|run|status> [options]",
    );
  }
  const { values } = parseArgs({
    args: process.argv.slice(3),
    strict: true,
    options: {
      "auto-rollback": { type: "boolean", default: false },
      "candidate-release": { type: "string" },
      "dashboard-url": { type: "string" },
      "gateway-url": { type: "string" },
      receipt: { type: "string" },
      "rollback-evidence": { type: "string" },
      "rollback-release": { type: "string" },
      root: { type: "string" },
    },
  });
  const rootDir = path.resolve(optionValue(values, "root") ?? process.cwd());
  const receiptPath = resolveBoundedArtifactPath(
    optionValue(values, "receipt") ?? DEFAULT_RECEIPT_PATH,
    rootDir,
  );
  const dashboardBaseUrl = optionValue(values, "dashboard-url") ?? DEFAULT_DASHBOARD_BASE_URL;
  if (command === "start") {
    const candidateReleaseId = optionValue(values, "candidate-release");
    const rollbackEvidencePath = optionValue(values, "rollback-evidence");
    if (!candidateReleaseId || !rollbackEvidencePath) {
      throw new Error("start requires --candidate-release and --rollback-evidence.");
    }
    const rollbackEvidence = await hashSelfImprovementSoakEvidence({
      filePath: rollbackEvidencePath,
      rootDir,
    });
    const receipt = createSelfImprovementSoakReceipt({
      candidateReleaseId,
      rollbackReleaseId: optionValue(values, "rollback-release"),
      automaticRollbackEnabled: values["auto-rollback"] ?? false,
      startedAt: Date.now(),
      rollbackEvidence,
    });
    await writeSelfImprovementSoakReceipt({ filePath: receiptPath, receipt, exclusive: true });
    console.log(JSON.stringify({ receiptPath, receipt }, null, 2));
    return;
  }

  const dependencies = buildDefaultDependencies({
    gatewayUrl: optionValue(values, "gateway-url"),
    rootDir,
  });
  if (command === "status") {
    const receipt = await readSelfImprovementSoakReceipt(receiptPath);
    console.log(
      JSON.stringify(
        {
          receiptPath,
          receipt,
          evaluation: evaluateSelfImprovementSoakReceipt(receipt, Date.now()),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "sample") {
    const cycle = await withSelfImprovementSoakReceiptLock({
      receiptPath,
      run: async () => {
        const result = await executeSelfImprovementSoakCycle({
          receipt: await readSelfImprovementSoakReceipt(receiptPath),
          dashboardBaseUrl,
          dependencies,
        });
        await writeSelfImprovementSoakReceipt({ filePath: receiptPath, receipt: result.receipt });
        return result;
      },
    });
    console.log(
      JSON.stringify(
        {
          receiptPath,
          rolledBack: cycle.rolledBack,
          evaluation: evaluateSelfImprovementSoakReceipt(cycle.receipt, Date.now()),
        },
        null,
        2,
      ),
    );
    return;
  }
  const receipt = await withSelfImprovementSoakReceiptLock({
    receiptPath,
    run: async () =>
      await runSelfImprovementProductionSoak({
        receiptPath,
        dashboardBaseUrl,
        dependencies,
      }),
  });
  console.log(
    JSON.stringify(
      { receiptPath, receipt, evaluation: evaluateSelfImprovementSoakReceipt(receipt, Date.now()) },
      null,
      2,
    ),
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
