import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

async function main(): Promise<void> {
  const artifactDir = join(
    ".artifacts",
    "control-ui-pcc-release-governor-smoke",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  mkdirSync(artifactDir, { recursive: true });
  const dom = new JSDOM('<!doctype html><main id="root"></main>', {
    url: "http://127.0.0.1/pcc",
  });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
  });
  try {
    const { render } = await import("lit");
    const { renderPccDashboard } = await import("../../ui/src/ui/views/pcc.ts");
    const { EMPTY_PCC_DECISION_FORM, EMPTY_PCC_MILESTONE_FORM, EMPTY_PCC_PROJECT_FORM } =
      await import("../../ui/src/ui/controllers/pcc.ts");
    const root = dom.window.document.getElementById("root");
    if (!root) {
      throw new Error("Release Governor smoke root is missing.");
    }
    render(
      renderPccDashboard({
        loading: false,
        error: null,
        connected: true,
        updatedAt: Date.now(),
        portfolio: null,
        projects: [],
        selectedProjectId: null,
        projectDetail: null,
        actionBusy: false,
        actionError: null,
        editorMode: null,
        projectForm: { ...EMPTY_PCC_PROJECT_FORM },
        milestoneForm: { ...EMPTY_PCC_MILESTONE_FORM },
        decisionForm: { ...EMPTY_PCC_DECISION_FORM },
        chatSyncText: "",
        chatSyncProposals: [],
        chatSyncError: null,
        productFocusMode: "pcc_product",
        releaseGovernance: {
          schema: "openclaw.release-governance-status.v1",
          policyVersion: 1,
          candidateSha: "a".repeat(40),
          activeRuntimeSha: "b".repeat(40),
          riskLevel: "P1",
          protectedPaths: [
            {
              path: "src/pcc/release-governance/policy.ts",
              pattern: "src/pcc/release-governance/**",
              reason: "Release policy engine cannot approve itself",
            },
          ],
          capabilityDiff: [],
          checks: [
            {
              id: "workflow_sanity",
              status: "pending",
              summary: "Exact-SHA Workflow Sanity is pending.",
              recordedAt: "2026-07-15T12:00:00.000Z",
            },
          ],
          approvalStatus: "none",
          approvalScope: null,
          reviews: [],
          rollbackTarget: "b".repeat(40),
          decision: "escalate",
          evidenceReceiptHash: null,
          evidencePath: null,
          exactBlocker: "Explicit approval is required.",
          approvalWording: "Approve exact candidate SHA.",
          updatedAt: "2026-07-15T12:00:00.000Z",
        },
        onRefresh: () => undefined,
        onSelectProject: () => undefined,
        onOpenProjectEditor: () => undefined,
        onOpenMilestoneEditor: () => undefined,
        onProjectFormChange: () => undefined,
        onMilestoneFormChange: () => undefined,
        onSaveProject: () => undefined,
        onSaveMilestone: () => undefined,
        onCancelEditor: () => undefined,
        onSetProjectStatus: () => undefined,
        onSetMilestoneStatus: () => undefined,
        onSetMilestoneStopHere: () => undefined,
        onUpdateWorkLoop: () => undefined,
        onPrepareNextWorkItem: () => undefined,
        onChatSyncTextChange: () => undefined,
        onPreviewChatSync: () => undefined,
        onApplyChatSyncProposal: () => undefined,
        onDismissChatSync: () => undefined,
      }),
      root,
    );
    const governance = root.querySelector<HTMLDetailsElement>("[data-pcc-release-governance]");
    const approval = governance?.querySelector<HTMLTextAreaElement>("textarea");
    const checks = {
      visible: Boolean(governance),
      failClosedOpen: governance?.open === true,
      blocker: governance?.textContent?.includes("Explicit approval is required.") === true,
      protectedPath:
        governance?.textContent?.includes("Release policy engine cannot approve itself") === true,
      approvalCopy: approval?.value === "Approve exact candidate SHA.",
      noSecrets: !/token|password|credential/i.test(governance?.textContent ?? ""),
    };
    const result = { artifactDir, checks, ok: Object.values(checks).every(Boolean) };
    writeFileSync(join(artifactDir, "pcc-release-governor.html"), dom.serialize());
    writeFileSync(join(artifactDir, "summary.json"), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) {
      process.exitCode = 1;
    }
  } finally {
    Object.assign(globalThis, previous);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
