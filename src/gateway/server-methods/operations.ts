// Operations Room gateway handlers expose one bounded snapshot and guarded,
// two-step controls. Investigation is explicit, bounded, and non-mutating:
// it records local-AI/Judge evidence only after the operator clicks the action.
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateOperationsActionApplyParams,
  validateOperationsActionPreviewParams,
  validateOperationsSnapshotParams,
  validateOperationsSnapshotV2Params,
} from "../../../packages/gateway-protocol/src/index.js";
import type { ModelCatalogEntry } from "../../agents/model-catalog.types.js";
import {
  createOperationsActionPreview,
  consumeOperationsActionPreview,
} from "../../operations/action-guard.js";
import { collectOperationsSnapshot } from "../../operations/collector.js";
import { projectOperationsSnapshotV1 } from "../../operations/compat.js";
import {
  applyConfirmedOperationsRemediation,
  investigateOperationsRemediation,
  type OperationsRemediationStore,
} from "../../operations/remediation-engine.js";
import { createOperationsRemediationLocalAi } from "../../operations/remediation-local-ai.js";
import {
  createOperationsRemediationContext,
  createOperationsRepairRecipes,
} from "../../operations/remediation-recipes.js";
import {
  loadOperationsRemediationRecords,
  upsertOperationsRemediationRecord,
} from "../../operations/remediation-store.js";
import type { OperationsActionReceipt } from "../../operations/types.js";
import { cancelDetachedTaskRunById, cancelFlowById } from "../../tasks/task-executor.js";
import { listVisibleActiveSessionRuns } from "./session-active-runs.js";
import type { GatewayRequestHandlers } from "./types.js";

function invalidParams(
  respond: Parameters<GatewayRequestHandlers[string]>[0]["respond"],
  method: string,
  errors: Parameters<typeof formatValidationErrors>[0],
): void {
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${method} params: ${formatValidationErrors(errors)}`,
    ),
  );
}

export const operationsHandlers: GatewayRequestHandlers = {
  "operations.snapshot": async ({ params, respond, context }) => {
    if (!validateOperationsSnapshotParams(params)) {
      invalidParams(respond, "operations.snapshot", validateOperationsSnapshotParams.errors);
      return;
    }
    try {
      let modelCatalog: ModelCatalogEntry[] = [];
      let modelCatalogAvailable = true;
      try {
        modelCatalog = await context.loadGatewayModelCatalog({ readOnly: true });
      } catch (err) {
        modelCatalogAvailable = false;
        context.logGateway.warn(`operations: model catalog unavailable: ${String(err)}`);
      }
      const snapshot = await collectOperationsSnapshot({
        cfg: context.getRuntimeConfig(),
        cron: context.cron,
        modelCatalog,
        modelCatalogAvailable,
        eventLoop: context.getEventLoopHealth?.(),
        includeProcesses: params.includeProcesses !== false,
        activeRuns: listVisibleActiveSessionRuns(context),
      });
      respond(true, projectOperationsSnapshotV1(snapshot), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "operations.snapshot.v2": async ({ params, respond, context }) => {
    if (!validateOperationsSnapshotV2Params(params)) {
      invalidParams(respond, "operations.snapshot.v2", validateOperationsSnapshotV2Params.errors);
      return;
    }
    try {
      let modelCatalog: ModelCatalogEntry[] = [];
      let modelCatalogAvailable = true;
      try {
        modelCatalog = await context.loadGatewayModelCatalog({ readOnly: true });
      } catch (err) {
        modelCatalogAvailable = false;
        context.logGateway.warn(`operations: model catalog unavailable: ${String(err)}`);
      }
      const snapshot = await collectOperationsSnapshot({
        cfg: context.getRuntimeConfig(),
        cron: context.cron,
        modelCatalog,
        modelCatalogAvailable,
        eventLoop: context.getEventLoopHealth?.(),
        includeProcesses: params.includeProcesses !== false,
        activeRuns: listVisibleActiveSessionRuns(context),
      });
      respond(true, snapshot, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "operations.action.preview": ({ params, respond }) => {
    if (!validateOperationsActionPreviewParams(params)) {
      invalidParams(
        respond,
        "operations.action.preview",
        validateOperationsActionPreviewParams.errors,
      );
      return;
    }
    if (params.action === "remediation.apply") {
      try {
        const record = loadOperationsRemediationRecords().find(
          (entry) => entry.id === params.targetId,
        );
        if (
          !record ||
          record.status !== "confirmation_required" ||
          record.risk !== "medium" ||
          !record.judge?.approved
        ) {
          throw new Error("recommended repair is not eligible for one-confirmation execution");
        }
        respond(
          true,
          createOperationsActionPreview({
            action: params.action,
            targetId: params.targetId,
            summary: record.exactRepair,
            risk: "medium",
          }),
          undefined,
        );
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, `operations action preview failed: ${String(err)}`),
        );
      }
      return;
    }
    if (params.action === "remediation.investigate") {
      respond(
        true,
        createOperationsActionPreview({
          action: params.action,
          targetId: params.targetId,
          summary:
            "Run a bounded local-AI investigation and independent Judge review. No runtime change will be made.",
          risk: "low",
        }),
        undefined,
      );
      return;
    }
    respond(
      true,
      createOperationsActionPreview({ action: params.action, targetId: params.targetId }),
      undefined,
    );
  },
  "operations.action.apply": async ({ params, respond, context }) => {
    if (!validateOperationsActionApplyParams(params)) {
      invalidParams(respond, "operations.action.apply", validateOperationsActionApplyParams.errors);
      return;
    }
    const preview = consumeOperationsActionPreview({
      token: params.token,
      action: params.action,
      targetId: params.targetId,
    });
    if (!preview) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "operations action preview is missing, expired, already used, or does not match",
        ),
      );
      return;
    }

    const cfg = context.getRuntimeConfig();
    let applied = false;
    let summary = preview.summary;
    try {
      switch (params.action) {
        case "cron.run": {
          const job = await context.cron.readJob(params.targetId);
          if (!job) {
            throw new Error("scheduled workflow not found");
          }
          const result = await context.cron.enqueueRun(params.targetId, "force");
          applied =
            result.ok &&
            (("enqueued" in result && result.enqueued) || ("ran" in result && result.ran));
          const reason = "reason" in result ? result.reason : "unknown reason";
          summary = applied
            ? `Scheduled workflow ${params.targetId} was queued.`
            : `Scheduled workflow ${params.targetId} was not queued: ${reason}.`;
          break;
        }
        case "cron.enable":
        case "cron.disable": {
          const job = await context.cron.readJob(params.targetId);
          if (!job) {
            throw new Error("scheduled workflow not found");
          }
          const enabled = params.action === "cron.enable";
          await context.cron.update(params.targetId, { enabled });
          applied = true;
          summary = `${enabled ? "Enabled" : "Paused"} scheduled workflow ${params.targetId}.`;
          break;
        }
        case "remediation.investigate": {
          const store = {
            list: () => loadOperationsRemediationRecords(),
            upsert: (record) => {
              upsertOperationsRemediationRecord(record);
            },
          } satisfies OperationsRemediationStore;
          const snapshot = await collectOperationsSnapshot({
            cfg,
            cron: context.cron,
            modelCatalog: [],
            modelCatalogAvailable: false,
            eventLoop: context.getEventLoopHealth?.(),
            includeProcesses: false,
            activeRuns: listVisibleActiveSessionRuns(context),
          });
          const finding = snapshot.findings.find((entry) => entry.id === params.targetId);
          if (!finding) {
            throw new Error("current issue no longer matches the investigation request");
          }
          const record = await investigateOperationsRemediation({
            finding,
            ai: createOperationsRemediationLocalAi(),
            store,
          });
          applied = true;
          summary = record.recommendedFix
            ? `Investigation complete. Recommendation recorded: ${record.recommendedFix}`
            : "Investigation complete. The recommendation is ready for review.";
          break;
        }
        case "remediation.apply": {
          const store = {
            list: () => loadOperationsRemediationRecords(),
            upsert: (record) => {
              upsertOperationsRemediationRecord(record);
            },
          } satisfies OperationsRemediationStore;
          const record = store.list().find((entry) => entry.id === params.targetId);
          if (!record) {
            throw new Error("recommended repair record not found");
          }
          const snapshot = await collectOperationsSnapshot({
            cfg,
            cron: context.cron,
            modelCatalog: [],
            modelCatalogAvailable: false,
            eventLoop: context.getEventLoopHealth?.(),
            includeProcesses: false,
            activeRuns: listVisibleActiveSessionRuns(context),
          });
          const finding = snapshot.findings.find((entry) => entry.id === record.findingId);
          if (!finding) {
            throw new Error("current issue no longer matches the recommended repair");
          }
          const completed = await applyConfirmedOperationsRemediation({
            recordId: record.id,
            finding,
            context: createOperationsRemediationContext(context.cron),
            recipes: createOperationsRepairRecipes(),
            store,
          });
          applied = completed.status === "completed";
          summary =
            completed.result ??
            (completed.status === "rolled_back"
              ? "Repair did not verify, so OpenClaw restored the rollback point."
              : completed.progress);
          break;
        }
        case "task.cancel": {
          const result = await cancelDetachedTaskRunById({ cfg, taskId: params.targetId });
          applied = result.cancelled;
          summary = result.cancelled
            ? `Cancelled task ${params.targetId}.`
            : `Task ${params.targetId} was not cancelled: ${result.reason ?? "unknown reason"}.`;
          break;
        }
        case "flow.cancel": {
          const result = await cancelFlowById({ cfg, flowId: params.targetId });
          applied = result.cancelled;
          summary = result.cancelled
            ? `Cancelled workflow ${params.targetId}.`
            : `Workflow ${params.targetId} was not cancelled: ${result.reason ?? "unknown reason"}.`;
          break;
        }
      }
      const receipt: OperationsActionReceipt = {
        action: params.action,
        targetId: params.targetId,
        status: applied ? "applied" : "rejected",
        summary,
        appliedAt: Date.now(),
      };
      respond(true, receipt, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `operations action failed: ${String(err)}`),
      );
    }
  },
};
