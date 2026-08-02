import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "../api.js";
import { acceptanceProfileRunId, cancelInterruptedAcceptanceReceipt } from "./acceptance.js";
import { formatResearchRunText, toPublicResearchReport } from "./public-report.js";
import { getResearchManagerRuntime, type ResearchReplayProfile } from "./runtime.js";
import type { ResearchMode, ResearchModelRole } from "./types.js";

const MODEL_ROLES = new Set<ResearchModelRole>([
  "planner",
  "scout",
  "researcher",
  "verifier",
  "critic",
  "finalizer",
]);
const ACTIVE_RESEARCH_STATUSES = new Set([
  "queued",
  "planning",
  "retrieving",
  "researching",
  "verifying",
  "finalizing",
  "certifying",
]);

function print(value: unknown): void {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

function parseBoundedNumber(
  value: string,
  name: string,
  minimum: number,
  maximum?: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || (maximum !== undefined && parsed > maximum)) {
    const range = maximum === undefined ? `at least ${minimum}` : `${minimum}-${maximum}`;
    throw new Error(`${name} must be a finite number in the range ${range}.`);
  }
  return parsed;
}

function parseRoles(value: string | undefined): ResearchModelRole[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const roles = [...new Set(value.split(",").map((entry) => entry.trim()))];
  const invalid = roles.find((role) => !MODEL_ROLES.has(role as ResearchModelRole));
  if (invalid) {
    throw new Error(`Unknown research role ${invalid}.`);
  }
  return roles as ResearchModelRole[];
}

function parseIds(value: string | undefined): string[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const ids = [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
  return ids.length > 0 ? ids : undefined;
}

function parseResearchMode(value: string | undefined): ResearchMode | undefined {
  if (value === undefined || value === "certified" || value === "best-effort") {
    return value;
  }
  throw new Error("mode must be certified or best-effort.");
}

function parseReplayProfile(value: string): ResearchReplayProfile {
  if (value === "hybrid" || value === "sol-only") {
    return value;
  }
  throw new Error("profile must be hybrid or sol-only.");
}

async function writeJsonAtomic(file: string, value: unknown): Promise<string> {
  const target = path.resolve(file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, target);
  return target;
}

async function withProcessAbortSignal<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Research command interrupted."));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    return await task(controller.signal);
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

export function registerResearchManagerCli(params: {
  api: OpenClawPluginApi;
  program: Parameters<Parameters<OpenClawPluginApi["registerCli"]>[0]>[0]["program"];
}): void {
  const command = params.program
    .command("research")
    .description("Run and inspect durable evidence-backed research");

  command
    .command("run")
    .description("Run a research question")
    .argument("<query>", "Research question")
    .option("--mode <mode>", "certified or best-effort")
    .option("--high-stakes", "Use high-stakes planning policy")
    .option("--max-sources <count>", "Maximum sources", (value: string) =>
      parseBoundedNumber(value, "max-sources", 1, 100),
    )
    .option("--deadline-ms <milliseconds>", "Queue/model deadline", (value: string) =>
      parseBoundedNumber(value, "deadline-ms", 1_000),
    )
    .option("--json", "Print the full public report")
    .action(
      async (
        query: string,
        options: {
          mode?: string;
          highStakes?: boolean;
          maxSources?: number;
          deadlineMs?: number;
          json?: boolean;
        },
      ) => {
        const mode = parseResearchMode(options.mode);
        const runtime = getResearchManagerRuntime(params.api);
        const report = await withProcessAbortSignal(
          async (signal) =>
            await runtime.run(
              {
                query,
                mode,
                highStakes: options.highStakes,
                maxSources: options.maxSources,
                deadlineMs: options.deadlineMs,
              },
              undefined,
              signal,
            ),
        );
        print(options.json ? toPublicResearchReport(report) : formatResearchRunText(report));
        if (report.status === "failed" || report.status === "blocked") {
          process.exitCode = 2;
        }
      },
    );

  command
    .command("status")
    .description("Show one run or list all runs")
    .argument("[run-id]", "Research run id")
    .option("--json", "Print JSON")
    .action(async (runId: string | undefined, options: { json?: boolean }) => {
      const runtime = getResearchManagerRuntime(params.api);
      if (runId) {
        const report = await runtime.store.load(runId);
        if (!report) {
          throw new Error(`Research run ${runId} was not found.`);
        }
        print(options.json ? toPublicResearchReport(report) : formatResearchRunText(report));
        return;
      }
      const reports = await runtime.store.list();
      print(
        options.json
          ? reports.map(toPublicResearchReport)
          : reports
              .map(
                (report) =>
                  `${report.runId}\t${report.status}\t${report.certification?.score ?? "-"}\t${report.query}`,
              )
              .join("\n") || "No Research Manager runs.",
      );
    });

  command
    .command("bakeoff")
    .description("Evaluate and optionally qualify one configured model")
    .requiredOption("--model <id>", "Configured Research Manager model id")
    .option("--roles <roles>", "Comma-separated configured roles")
    .option("--no-qualify", "Do not persist role qualifications")
    .option("--output <path>", "Write an immutable JSON receipt")
    .option("--json", "Print the full receipt")
    .action(
      async (options: {
        model: string;
        roles?: string;
        qualify: boolean;
        output?: string;
        json?: boolean;
      }) => {
        const receipt = await getResearchManagerRuntime(params.api).bakeoff({
          modelId: options.model,
          roles: parseRoles(options.roles),
          persistQualifications: options.qualify,
        });
        const output = options.output ? await writeJsonAtomic(options.output, receipt) : undefined;
        if (options.json) {
          print(receipt);
        } else {
          print(
            [
              `${receipt.model.id} evaluation ${receipt.receiptId}`,
              ...receipt.roles.map(
                (role) =>
                  `${role.role}: ${role.score}/100, threshold ${role.threshold}, ${role.qualified ? "qualified" : "not qualified"}, schema ${(role.schemaAdherence * 100).toFixed(0)}%`,
              ),
              output ? `Receipt: ${output}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }
        if (receipt.roles.some((role) => !role.qualified)) {
          process.exitCode = 2;
        }
      },
    );

  command
    .command("qualifications")
    .description("List durable role qualification records")
    .option("--json", "Print JSON")
    .action(async (options: { json?: boolean }) => {
      const runtime = getResearchManagerRuntime(params.api);
      await runtime.prepare();
      const records = (await runtime.store.listQualifications()).toSorted((left, right) =>
        `${left.modelId}:${left.role}`.localeCompare(`${right.modelId}:${right.role}`),
      );
      print(
        options.json
          ? records
          : records
              .map(
                (record) =>
                  `${record.modelId}\t${record.role}\t${record.score}\t${record.qualified === false ? "not-qualified" : "qualified"}\t${record.corpusVersion}`,
              )
              .join("\n") || "No Research Manager qualification records.",
      );
    });

  const acceptance = command
    .command("acceptance")
    .description("Run or inspect paired Sol-only versus hybrid acceptance benchmarks");

  acceptance
    .command("run")
    .description("Run the locked paired acceptance corpus")
    .option("--tasks <ids>", "Comma-separated task IDs for diagnostic subsets")
    .option("--resume <receipt-id>", "Resume a running or cancelled receipt")
    .option("--output <path>", "Write the final immutable JSON receipt")
    .option("--json", "Print the full receipt")
    .action(
      async (options: { tasks?: string; resume?: string; output?: string; json?: boolean }) => {
        const receipt = await withProcessAbortSignal(
          async (signal) =>
            await getResearchManagerRuntime(params.api).acceptance({
              taskIds: parseIds(options.tasks),
              receiptId: options.resume,
              signal,
            }),
        );
        const output = options.output ? await writeJsonAtomic(options.output, receipt) : undefined;
        if (options.json) {
          print(receipt);
        } else {
          print(
            [
              `Acceptance ${receipt.receiptId}: ${receipt.status}`,
              receipt.aggregate
                ? `Hybrid ${receipt.aggregate.hybridMeanScore}/100 vs Sol-only ${receipt.aggregate.baselineMeanScore}/100; local share ${(receipt.aggregate.hybridLocalCallShare * 100).toFixed(1)}%; remote token reduction ${(receipt.aggregate.remoteTokenReduction * 100).toFixed(1)}%`
                : "Acceptance is incomplete.",
              ...(receipt.gates ?? []).map(
                (gate) =>
                  `${gate.passed ? "PASS" : "FAIL"}\t${gate.id}\t${String(gate.actual)} (required ${String(gate.required)})`,
              ),
              output ? `Receipt: ${output}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }
        if (receipt.status !== "passed") {
          process.exitCode = 2;
        }
      },
    );

  acceptance
    .command("status")
    .description("Show one acceptance receipt or list all receipts")
    .argument("[receipt-id]", "Acceptance receipt id")
    .option("--json", "Print JSON")
    .action(async (receiptId: string | undefined, options: { json?: boolean }) => {
      const runtime = getResearchManagerRuntime(params.api);
      if (receiptId) {
        const receipt = await runtime.store.loadAcceptance(receiptId);
        if (!receipt) {
          throw new Error(`Acceptance receipt ${receiptId} was not found.`);
        }
        print(
          options.json
            ? receipt
            : `${receipt.receiptId}\t${receipt.status}\t${receipt.aggregate?.hybridMeanScore ?? "-"}\t${receipt.aggregate?.qualityDelta ?? "-"}`,
        );
        return;
      }
      const receipts = await runtime.store.listAcceptance();
      print(
        options.json
          ? receipts
          : receipts
              .map(
                (receipt) =>
                  `${receipt.receiptId}\t${receipt.status}\t${receipt.aggregate?.hybridMeanScore ?? "-"}\t${receipt.startedAt}`,
              )
              .join("\n") || "No Research Manager acceptance receipts.",
      );
    });

  acceptance
    .command("cancel")
    .description("Cancel an acceptance receipt and any active paired run")
    .argument("<receipt-id>", "Acceptance receipt id")
    .action(async (receiptId: string) => {
      const runtime = getResearchManagerRuntime(params.api);
      const receipt = await runtime.store.loadAcceptance(receiptId);
      if (!receipt) {
        throw new Error(`Acceptance receipt ${receiptId} was not found.`);
      }
      const cancelled = cancelInterruptedAcceptanceReceipt(receipt);
      await runtime.store.saveAcceptance(cancelled);
      let cancelledRuns = 0;
      for (const taskId of receipt.selectedTaskIds) {
        for (const profile of ["sol-only", "hybrid"] as const) {
          const runId = acceptanceProfileRunId(receipt.receiptId, taskId, profile);
          const report = await runtime.store.load(runId);
          if (report && ACTIVE_RESEARCH_STATUSES.has(report.status)) {
            await runtime.cancel(runId);
            cancelledRuns += 1;
          }
        }
      }
      print(
        `Acceptance ${cancelled.receiptId}: ${cancelled.status}; cancelled runs: ${cancelledRuns}`,
      );
    });

  command
    .command("resume")
    .description("Resume an interrupted or blocked run")
    .argument("<run-id>", "Research run id")
    .option("--json", "Print JSON")
    .action(async (runId: string, options: { json?: boolean }) => {
      const report = await withProcessAbortSignal(
        async (signal) =>
          await getResearchManagerRuntime(params.api).resume(runId, undefined, signal),
      );
      print(options.json ? toPublicResearchReport(report) : formatResearchRunText(report));
    });

  command
    .command("replay")
    .description("Reuse a persisted plan and source corpus, then rerun research onward")
    .argument("<run-id>", "Source research run id")
    .option("--model-profile <profile>", "hybrid or sol-only", "hybrid")
    .option("--json", "Print JSON")
    .action(async (runId: string, options: { modelProfile: string; json?: boolean }) => {
      const profile = parseReplayProfile(options.modelProfile);
      const report = await withProcessAbortSignal(
        async (signal) =>
          await getResearchManagerRuntime(params.api).replay(runId, {
            profile,
            signal,
          }),
      );
      print(options.json ? toPublicResearchReport(report) : formatResearchRunText(report));
      if (report.status === "failed" || report.status === "blocked") {
        process.exitCode = 2;
      }
    });

  command
    .command("cancel")
    .description("Cancel a run")
    .argument("<run-id>", "Research run id")
    .action(async (runId: string) => {
      print(formatResearchRunText(await getResearchManagerRuntime(params.api).cancel(runId)));
    });

  command
    .command("doctor")
    .description("Inspect models, retrieval, and resource readiness")
    .option("--live", "Make minimal live model probes")
    .option("--output <path>", "Write an atomic JSON preflight receipt")
    .option("--json", "Print JSON")
    .action(async (options: { live?: boolean; output?: string; json?: boolean }) => {
      const report = await getResearchManagerRuntime(params.api).doctor(options.live === true);
      const output = options.output ? await writeJsonAtomic(options.output, report) : undefined;
      print(
        options.json
          ? report
          : report.ok
            ? ["Research Manager preflight passed.", output ? `Receipt: ${output}` : ""]
                .filter(Boolean)
                .join("\n")
            : `Research Manager preflight issues:\n${report.issues.join("\n")}`,
      );
      if (!report.ok) {
        process.exitCode = 2;
      }
    });
}
