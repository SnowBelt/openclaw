import type { OpenClawPluginApi, OpenClawPluginToolContext } from "../api.js";
import {
  cancelInterruptedAcceptanceReceipt,
  type AcceptanceBenchmarkReceipt,
} from "./acceptance.js";
import type { ResearchRunStore } from "./store.js";
import type { ResearchRunReport, ResearchRunStatus } from "./types.js";

const INTERRUPTED_STATUSES = new Set<ResearchRunStatus>([
  "queued",
  "planning",
  "retrieving",
  "researching",
  "verifying",
  "finalizing",
  "certifying",
]);

export async function recoverInterruptedResearchRuns(
  store: Pick<ResearchRunStore, "list" | "update">,
): Promise<string[]> {
  const interrupted = (await store.list()).filter((report) =>
    INTERRUPTED_STATUSES.has(report.status),
  );
  for (const report of interrupted) {
    await store.update(report.runId, (current) => ({
      ...current,
      status: "blocked",
      completedAt: new Date().toISOString(),
      blockedReason: "Gateway restarted during this run; resume from the last durable stage.",
      gaps: [...current.gaps, "Gateway restart detected; no automatic remote model call was made."],
    }));
  }
  return interrupted.map((report) => report.runId);
}

export async function recoverInterruptedAcceptanceReceipts(
  store: Pick<ResearchRunStore, "listAcceptance" | "saveAcceptance">,
): Promise<string[]> {
  const interrupted = (await store.listAcceptance()).filter(
    (receipt): receipt is AcceptanceBenchmarkReceipt => receipt.status === "running",
  );
  for (const receipt of interrupted) {
    await store.saveAcceptance(cancelInterruptedAcceptanceReceipt(receipt));
  }
  return interrupted.map((receipt) => receipt.receiptId);
}

type ManagedFlow = ReturnType<
  ReturnType<
    OpenClawPluginApi["runtime"]["tasks"]["managedFlows"]["fromToolContext"]
  >["createManaged"]
>;

export class ResearchFlowController {
  readonly #runtime: ReturnType<
    OpenClawPluginApi["runtime"]["tasks"]["managedFlows"]["fromToolContext"]
  >;
  #flow: ManagedFlow;
  readonly #config: OpenClawPluginApi["config"];

  private constructor(
    runtime: ReturnType<OpenClawPluginApi["runtime"]["tasks"]["managedFlows"]["fromToolContext"]>,
    flow: ManagedFlow,
    config: OpenClawPluginApi["config"],
  ) {
    this.#runtime = runtime;
    this.#flow = flow;
    this.#config = config;
  }

  static create(params: {
    api: OpenClawPluginApi;
    ctx: OpenClawPluginToolContext;
    report: ResearchRunReport;
  }): ResearchFlowController | undefined {
    if (!params.ctx.sessionKey) {
      return undefined;
    }
    const runtime = params.api.runtime.tasks.managedFlows.fromToolContext(params.ctx);
    const flow = runtime.createManaged({
      controllerId: "research-manager",
      goal: params.report.query,
      status: "running",
      notifyPolicy: "done_only",
      currentStep: params.report.status,
      stateJson: {
        runId: params.report.runId,
        mode: params.report.mode,
        status: params.report.status,
      },
    });
    return new ResearchFlowController(runtime, flow, params.api.config);
  }

  get flowId(): string {
    return this.#flow.flowId;
  }

  update(status: ResearchRunStatus, report: ResearchRunReport): void {
    if (["completed", "failed", "cancelled", "blocked"].includes(status)) {
      return;
    }
    const result = this.#runtime.resume({
      flowId: this.#flow.flowId,
      expectedRevision: this.#flow.revision,
      status: "running",
      currentStep: status,
      stateJson: {
        runId: report.runId,
        mode: report.mode,
        status,
        sourceCount: report.sources.length,
        claimCount: report.claims.length,
      },
    });
    if (result.applied) {
      this.#flow = result.flow;
    }
  }

  finish(report: ResearchRunReport): void {
    const result = this.#runtime.finish({
      flowId: this.#flow.flowId,
      expectedRevision: this.#flow.revision,
      stateJson: {
        runId: report.runId,
        status: report.status,
        score: report.certification?.score ?? null,
        certified: report.certification?.certified ?? false,
      },
    });
    if (result.applied) {
      this.#flow = result.flow;
    }
  }

  wait(report: ResearchRunReport, reason: string): void {
    const result = this.#runtime.setWaiting({
      flowId: this.#flow.flowId,
      expectedRevision: this.#flow.revision,
      currentStep: report.status,
      stateJson: { runId: report.runId, status: report.status },
      waitJson: { kind: "capability", reason },
      blockedSummary: reason,
    });
    if (result.applied) {
      this.#flow = result.flow;
    }
  }

  fail(report: ResearchRunReport, reason: string): void {
    const result = this.#runtime.fail({
      flowId: this.#flow.flowId,
      expectedRevision: this.#flow.revision,
      stateJson: { runId: report.runId, status: report.status, reason },
      blockedSummary: reason,
    });
    if (result.applied) {
      this.#flow = result.flow;
    }
  }

  async cancel(): Promise<void> {
    await this.#runtime.cancel({ flowId: this.#flow.flowId, cfg: this.#config });
  }
}
