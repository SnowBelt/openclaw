import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const RUN_GATEWAY_E2E = process.env.OPENCLAW_TEST_INCLUDE_GATEWAY === "1";
const E2E_TIMEOUT_MS = 120_000;

type JsonObject = Record<string, unknown>;
type CliResult = { code: number | null; stdout: string; stderr: string };
type OpenClawTestInstance = {
  stateDir: string;
  env: NodeJS.ProcessEnv;
  startGateway: () => Promise<void>;
  cleanup: () => Promise<void>;
};
type CreateOpenClawTestInstance = (options: {
  name: string;
  gatewayToken?: string;
  config?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}) => Promise<OpenClawTestInstance>;
type DevicePairingList = {
  pending: Array<{ requestId?: string }>;
};
type ApprovedDevicePairing = {
  status: "approved";
  device: {
    deviceId?: string;
  };
};
type DevicePairingModule = {
  listDevicePairing: (baseDir?: string) => Promise<DevicePairingList>;
  approveDevicePairing: (
    requestId: string,
    options: { callerScopes?: readonly string[] },
    baseDir?: string,
  ) => Promise<ApprovedDevicePairing | { status: string } | null>;
};

const instances: Array<{ cleanup: () => Promise<void> }> = [];
let createOpenClawTestInstancePromise: Promise<CreateOpenClawTestInstance> | undefined;
let devicePairingModulePromise: Promise<DevicePairingModule> | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function loadCreateOpenClawTestInstance(): Promise<CreateOpenClawTestInstance> {
  createOpenClawTestInstancePromise ??= (async () => {
    const modulePath = "../helpers/openclaw-test-instance.js";
    const mod = (await import(modulePath)) as { createOpenClawTestInstance?: unknown };
    if (typeof mod.createOpenClawTestInstance !== "function") {
      throw new Error("createOpenClawTestInstance test helper unavailable");
    }
    return mod.createOpenClawTestInstance as CreateOpenClawTestInstance;
  })();
  return await createOpenClawTestInstancePromise;
}

async function loadDevicePairingModule(): Promise<DevicePairingModule> {
  devicePairingModulePromise ??= (async () => {
    const modulePath = "../../src/infra/device-pairing.js";
    const mod = (await import(modulePath)) as Partial<DevicePairingModule>;
    if (
      typeof mod.listDevicePairing !== "function" ||
      typeof mod.approveDevicePairing !== "function"
    ) {
      throw new Error("device pairing helper unavailable");
    }
    return {
      listDevicePairing: mod.listDevicePairing,
      approveDevicePairing: mod.approveDevicePairing,
    };
  })();
  return await devicePairingModulePromise;
}

async function runOpenClawCli(params: {
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const child = spawn("node", ["scripts/run-node.mjs", ...params.args], {
    cwd: process.cwd(),
    env: params.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));

  const completed = await Promise.race([
    new Promise<{ code: number | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve({ code }));
    }),
    sleep(params.timeoutMs ?? 30_000).then(() => null),
  ]);
  if (completed === null) {
    child.kill("SIGKILL");
    return {
      code: 124,
      stdout: stdout.join(""),
      stderr: `${stderr.join("")}\ncommand timed out`,
    };
  }
  return {
    code: completed.code,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

function parseJsonObject(stdout: string): JsonObject {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("expected JSON output, received empty stdout");
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const json = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(json) as JsonObject;
}

function getArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? (value.filter((item) => typeof item === "object" && item) as JsonObject[])
    : [];
}

function getObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null ? (value as JsonObject) : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function approveLatestDevicePairing(params: { stateDir: string }): Promise<void> {
  const { approveDevicePairing, listDevicePairing } = await loadDevicePairingModule();
  const list = await listDevicePairing(params.stateDir);
  const requestId = list.pending[0]?.requestId;
  if (!requestId) {
    throw new Error("expected pending device pairing request");
  }
  const approval = await approveDevicePairing(
    requestId,
    { callerScopes: ["operator.admin"] },
    params.stateDir,
  );
  if (approval?.status !== "approved") {
    throw new Error(`expected device pairing approval to succeed: ${JSON.stringify(approval)}`);
  }
  const approved = approval as ApprovedDevicePairing;
  expect(getString(approved.device.deviceId)).toBeTruthy();
}

async function waitFor<T>(
  label: string,
  probe: () => Promise<T | undefined>,
  timeoutMs = 30_000,
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await probe();
      if (value !== undefined) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(
    `timed out waiting for ${label}${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

describe.skipIf(!RUN_GATEWAY_E2E)("book-writer Gateway cron registration", () => {
  afterEach(async () => {
    const pending = instances.splice(0);
    await Promise.all(pending.map((instance) => instance.cleanup()));
  });

  it(
    "registers one managed cron job and records task history after a manual run",
    { timeout: E2E_TIMEOUT_MS },
    async () => {
      const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-book-writer-gw-"));
      const gatewayToken = "book-writer-cron-gateway-token";
      const createOpenClawTestInstance = await loadCreateOpenClawTestInstance();
      const inst = await createOpenClawTestInstance({
        name: "book-writer-cron-gateway",
        gatewayToken,
        config: {
          plugins: {
            allow: ["book-writer"],
            entries: {
              "book-writer": {
                enabled: true,
                config: {
                  outputDir,
                },
              },
            },
          },
        },
        env: {
          OPENCLAW_SKIP_CRON: "0",
          OPENCLAW_GATEWAY_TOKEN: gatewayToken,
        },
      });
      instances.push(inst);
      await inst.startGateway();
      const cli = async (args: string[], options?: { timeoutMs?: number }) =>
        await runOpenClawCli({
          args,
          env: inst.env,
          timeoutMs: options?.timeoutMs,
        });
      const pairingProbe = await cli(["cron", "list", "--all", "--json", "--token", gatewayToken]);
      if (pairingProbe.code !== 0) {
        await approveLatestDevicePairing({
          stateDir: inst.stateDir,
        });
      }

      const entrypoint = ["scripts/run-node.mjs"];
      const openclawCommand = ["node", ...entrypoint].join(" ");
      const installSchedule = async (): Promise<JsonObject> => {
        const result = await cli(
          [
            "books",
            "schedule-install",
            "--output-dir",
            outputDir,
            "--run-id",
            "gateway-cron-e2e",
            "--target-words",
            "100",
            "--allow-estimated",
            "--dry-run",
            "--enable-autonomous-writing",
            "--register-gateway-cron",
            "--openclaw-command",
            openclawCommand,
            "--json",
          ],
          { timeoutMs: 45_000 },
        );
        expect(result.code, result.stderr).toBe(0);
        return parseJsonObject(result.stdout);
      };

      let firstInstall = await installSchedule();
      let firstGatewayCron = getObject(firstInstall.gatewayCron);

      if (
        firstGatewayCron?.status === "failed" &&
        getString(firstGatewayCron.error)?.includes("scope upgrade pending approval")
      ) {
        await approveLatestDevicePairing({
          stateDir: inst.stateDir,
        });
        firstInstall = await installSchedule();
        firstGatewayCron = getObject(firstInstall.gatewayCron);
      }

      if (firstGatewayCron?.status !== "created") {
        throw new Error(`expected Gateway cron creation: ${JSON.stringify(firstGatewayCron)}`);
      }
      expect(firstGatewayCron.status).toBe("created");
      expect(firstGatewayCron.verified).toBe(true);
      const jobId = firstGatewayCron.matchedJobId;
      expect(typeof jobId).toBe("string");

      const secondInstall = await installSchedule();
      const secondGatewayCron = getObject(secondInstall.gatewayCron);

      expect(secondGatewayCron?.status).toBe("updated");
      expect(secondGatewayCron?.matchedJobId).toBe(jobId);

      const listResult = await cli(["cron", "list", "--all", "--json", "--token", gatewayToken]);
      expect(listResult.code).toBe(0);
      const jobs = getArray(parseJsonObject(listResult.stdout).jobs);
      const bookWriterJobs = jobs.filter((job) => job.name === "Book Writer Overnight");
      expect(bookWriterJobs).toHaveLength(1);
      expect(bookWriterJobs[0]?.id).toBe(jobId);
      expect((bookWriterJobs[0]?.payload as JsonObject | undefined)?.command).toBe(
        firstInstall.scriptPath,
      );

      const runResult = await cli(["cron", "run", String(jobId), "--token", gatewayToken], {
        timeoutMs: 60_000,
      });
      expect(runResult.code).toBe(0);
      const runJson = parseJsonObject(runResult.stdout);
      expect(runJson.ok).toBe(true);
      const runId = getString(runJson.runId);
      expect(runId).toBeTruthy();

      const task = await waitFor("book-writer cron task success", async () => {
        const tasksResult = await cli(["tasks", "list", "--runtime", "cron", "--json"]);
        if (tasksResult.code !== 0) {
          throw new Error(tasksResult.stderr);
        }
        const tasks = getArray(parseJsonObject(tasksResult.stdout).tasks);
        const matched = tasks.filter((candidate) => candidate.sourceId === jobId);
        const succeeded = matched.find((candidate) => candidate.status === "succeeded");
        if (succeeded) {
          return succeeded;
        }
        throw new Error(
          `cron tasks: ${JSON.stringify(
            tasks.map((candidate) => ({
              sourceId: candidate.sourceId,
              runId: candidate.runId,
              status: candidate.status,
              runtime: candidate.runtime,
              deliveryStatus: candidate.deliveryStatus,
              error: candidate.error,
              terminalSummary: candidate.terminalSummary,
              progressSummary: candidate.progressSummary,
              task: candidate.task,
            })),
          )}`,
        );
      });
      expect(task.runtime).toBe("cron");
      expect(task.deliveryStatus).toBe("not_applicable");

      const runEntry = await waitFor("book-writer cron run history", async () => {
        const runsResult = await cli([
          "cron",
          "runs",
          "--id",
          String(jobId),
          "--limit",
          "20",
          "--token",
          gatewayToken,
        ]);
        if (runsResult.code !== 0) {
          throw new Error(runsResult.stderr);
        }
        const entries = getArray(parseJsonObject(runsResult.stdout).entries);
        return entries.find(
          (entry) =>
            entry.jobId === jobId &&
            entry.runId === runId &&
            entry.status === "ok" &&
            entry.deliveryStatus === "not-requested",
        );
      });
      expect(getString(runEntry.summary)).toContain("finished with exit 0");
      const tickReport = parseJsonObject(
        await fs.readFile(path.join(outputDir, "scheduler", "scheduler-tick-report.json"), "utf8"),
      );
      expect(tickReport.status).toBe("completed");
    },
  );
});
