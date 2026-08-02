import type { OpenClawPluginApi, OpenClawPluginToolContext } from "../api.js";
import { formatResearchRunText, toPublicResearchReport } from "./public-report.js";
import { RESEARCH_MANAGER_TOOL_DESCRIPTOR } from "./tool-descriptor.js";

export type ResearchManagerToolParams = {
  action?: unknown;
  query?: unknown;
  runId?: unknown;
  receiptId?: unknown;
  mode?: unknown;
  highStakes?: unknown;
  maxSources?: unknown;
  deadlineMs?: unknown;
  live?: unknown;
};

type RuntimeModule = typeof import("./runtime.js");
let runtimeModulePromise: Promise<RuntimeModule> | undefined;

function loadRuntime(): Promise<RuntimeModule> {
  runtimeModulePromise ??= import("./runtime.js");
  return runtimeModulePromise;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(
  value: unknown,
  name: string,
  options: { minimum: number; maximum?: number },
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < options.minimum ||
    (options.maximum !== undefined && value > options.maximum)
  ) {
    const range =
      options.maximum === undefined
        ? `at least ${options.minimum}`
        : `between ${options.minimum} and ${options.maximum}`;
    throw new Error(`${name} must be a finite number ${range}.`);
  }
  return value;
}

export function createResearchManagerTool(params: {
  api: OpenClawPluginApi;
  ctx: OpenClawPluginToolContext;
}) {
  return {
    ...RESEARCH_MANAGER_TOOL_DESCRIPTOR,
    async execute(_toolCallId: string, raw: ResearchManagerToolParams) {
      const action = readString(raw.action);
      const { getResearchManagerRuntime } = await loadRuntime();
      const runtime = getResearchManagerRuntime(params.api);
      if (action === "run") {
        const query = readString(raw.query);
        if (!query) {
          throw new Error("query is required for action=run");
        }
        const report = await runtime.run(
          {
            query,
            mode: raw.mode === "certified" || raw.mode === "best-effort" ? raw.mode : undefined,
            highStakes: raw.highStakes === true,
            maxSources: readNumber(raw.maxSources, "maxSources", {
              minimum: 1,
              maximum: 100,
            }),
            deadlineMs: readNumber(raw.deadlineMs, "deadlineMs", { minimum: 1_000 }),
          },
          params.ctx,
        );
        return {
          content: [{ type: "text", text: formatResearchRunText(report) }],
          details: { report: toPublicResearchReport(report) },
        };
      }
      if (action === "list") {
        const reports = (await runtime.store.list()).map(toPublicResearchReport);
        return {
          content: [
            {
              type: "text",
              text:
                reports.length > 0
                  ? reports
                      .map(
                        (report) =>
                          `${report.runId}\t${report.status}\t${report.certification?.score ?? "-"}\t${report.query}`,
                      )
                      .join("\n")
                  : "No Research Manager runs.",
            },
          ],
          details: { reports },
        };
      }
      if (action === "doctor") {
        const doctor = await runtime.doctor(raw.live === true);
        return {
          content: [
            {
              type: "text",
              text: doctor.ok
                ? "Research Manager preflight passed."
                : `Research Manager preflight found ${doctor.issues.length} issue(s):\n${doctor.issues.join("\n")}`,
            },
          ],
          details: { doctor },
        };
      }
      if (action === "acceptance-status") {
        const receiptId = readString(raw.receiptId);
        const receipts = receiptId
          ? [await runtime.store.loadAcceptance(receiptId)].filter(
              (receipt) => receipt !== undefined,
            )
          : await runtime.store.listAcceptance();
        if (receiptId && receipts.length === 0) {
          throw new Error(`Acceptance receipt ${receiptId} was not found.`);
        }
        return {
          content: [
            {
              type: "text",
              text:
                receipts.length > 0
                  ? receipts
                      .map(
                        (receipt) =>
                          `${receipt.receiptId}\t${receipt.status}\t${receipt.aggregate?.hybridMeanScore ?? "-"}\t${receipt.startedAt}`,
                      )
                      .join("\n")
                  : "No Research Manager acceptance receipts.",
            },
          ],
          details: { receipts },
        };
      }
      const runId = readString(raw.runId);
      if (!runId) {
        throw new Error(`runId is required for action=${action ?? "unknown"}`);
      }
      if (action === "status") {
        const report = await runtime.store.load(runId);
        if (!report) {
          throw new Error(`Research run ${runId} was not found.`);
        }
        return {
          content: [{ type: "text", text: formatResearchRunText(report) }],
          details: { report: toPublicResearchReport(report) },
        };
      }
      if (action === "resume") {
        const report = await runtime.resume(runId, params.ctx);
        return {
          content: [{ type: "text", text: formatResearchRunText(report) }],
          details: { report: toPublicResearchReport(report) },
        };
      }
      if (action === "cancel") {
        const report = await runtime.cancel(runId);
        return {
          content: [{ type: "text", text: formatResearchRunText(report) }],
          details: { report: toPublicResearchReport(report) },
        };
      }
      throw new Error(`Unsupported research-manager action: ${action ?? "missing"}`);
    },
  };
}
