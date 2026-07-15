import { html, nothing } from "lit";
import {
  autopilotStatusLabel,
  buildPccAutopilotPermissionForecast,
  getPccAutopilotState,
  PCC_AUTOPILOT_MODES,
  type PccAutopilotModeId,
  type PccAutopilotPromptSlot,
} from "../../../../../src/pcc/autopilot.js";
import {
  normalizePccExecutionProfile,
  summarizePccExecutionProfile,
  type PccExecutionProfilePresetId,
} from "../../../../../src/pcc/execution-profile.js";
import { resolvePccExecutionStandardForDetail } from "../application/execution-team.ts";
import type { PccDashboardProps, PccProjectDetail } from "../contracts.ts";

export type PccFactRenderer = (label: string, value: string) => unknown;

const EXECUTION_PROFILE_TITLES: Record<PccExecutionProfilePresetId, string> = {
  local_focused: "Focused",
  local_parallel: "Parallel",
  ultra_local: "Ultra",
  balanced: "Balanced team",
  ultra_hybrid: "Ultra + Codex",
};

function formatStatus(status: string | null | undefined): string {
  const value = typeof status === "string" ? status.trim() : "";
  if (!value) {
    return "Not recorded";
  }
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatUpdatedAt(value: number | null): string {
  if (!value) {
    return "Not loaded yet";
  }
  return `Updated ${new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function renderAutopilotPromptSlot(slot: PccAutopilotPromptSlot, props: PccDashboardProps) {
  return html`<article
    class="pcc-autopilot-prompt"
    data-pcc-autopilot-prompt
    data-pcc-autopilot-prompt-id=${slot.id}
  >
    <header>
      <label>
        <input
          type="checkbox"
          .checked=${slot.enabled}
          ?disabled=${props.actionBusy}
          @change=${(event: Event) =>
            props.onUpdateAutopilotPrompt?.(slot.id, {
              enabled: (event.target as HTMLInputElement).checked,
            })}
        />
        Enabled
      </label>
      <span>${slot.title} · v${slot.version}</span>
    </header>
    <label>
      <span>Prompt title</span>
      <input
        .value=${slot.title}
        ?disabled=${props.actionBusy}
        @change=${(event: Event) =>
          props.onUpdateAutopilotPrompt?.(slot.id, {
            title: (event.target as HTMLInputElement).value,
          })}
      />
    </label>
    <label>
      <span>Prompt body</span>
      <textarea
        rows="5"
        .value=${slot.promptBody}
        ?disabled=${props.actionBusy}
        @change=${(event: Event) =>
          props.onUpdateAutopilotPrompt?.(slot.id, {
            promptBody: (event.target as HTMLTextAreaElement).value,
          })}
      ></textarea>
    </label>
    <div class="pcc-autopilot-prompt__meta">
      <span
        >Executor:
        ${slot.executor === "safe_stub" ? "Safe stub" : formatStatus(slot.executor)}</span
      >
      <span>Reasoning: ${slot.reasoningLevel ?? "standard"}</span>
      <span>Approval: ${formatStatus(slot.approvalTier)}</span>
      <span>Judge: ${formatStatus(slot.judge)}</span>
    </div>
    ${slot.lastRunResult
      ? html`<p data-pcc-autopilot-last-run>${slot.lastRunResult}</p>`
      : html`<p data-pcc-autopilot-last-run>Not run yet.</p>`}
  </article>`;
}

export function renderAutopilotProjectLoop(
  detail: PccProjectDetail,
  props: PccDashboardProps,
  renderFact: PccFactRenderer,
) {
  const executionStandard = resolvePccExecutionStandardForDetail(
    detail,
    props.skillsReport,
    undefined,
    props.skillsError,
  );
  const autopilot = getPccAutopilotState({
    project: detail.project,
    milestones: detail.milestones,
    subMilestones: detail.subMilestones ?? [],
    permissions: detail.permissions,
    evidence: detail.evidence,
    decisions: detail.decisions ?? [],
    executionStandard,
  });
  const mode = props.viewMode ?? "simple";
  const enabledPrompts = autopilot.promptSlots.filter((slot) => slot.enabled);
  const permissionForecast = buildPccAutopilotPermissionForecast(autopilot);
  const latestRun = autopilot.runHistory.at(-1);
  const latestJudge = autopilot.latestJudgeResult;
  const blocker = autopilot.currentBlocker;
  const activeGrants = autopilot.permissionGrants.filter((grant) => grant.status === "active");
  const pendingQueue = autopilot.permissionQueue.filter((item) => item.status === "pending");
  const recentQueue = autopilot.permissionQueue.slice(-5).toReversed();
  const repairPreview =
    autopilot.permissionRepair?.status === "preview" ? autopilot.permissionRepair : undefined;
  const executionProfile = normalizePccExecutionProfile(detail.project.metadata);
  const executionTitle = EXECUTION_PROFILE_TITLES[executionProfile.presetId];
  return html`<section
    class="pcc-autopilot"
    data-pcc-autopilot-project-loop
    data-pcc-mobile-section="autopilot"
    data-pcc-autopilot-status=${autopilot.status}
  >
    <div class="pcc-section-heading">
      <div>
        <p class="pcc-kicker">Autopilot Project Loop</p>
        <h4>Structured AI loop</h4>
        <p>
          Separate from milestones. Uses editable prompts, safe approvals, judge review, history,
          and final reports.
        </p>
      </div>
      <span class="pcc-status pcc-status--${autopilot.status}" data-pcc-autopilot-status-label>
        ${autopilot.executionMode === "simulation" && autopilot.status === "completed"
          ? "Simulation complete"
          : autopilotStatusLabel(autopilot.status)}
      </span>
    </div>
    <article class="pcc-autopilot__inherited-profile" data-pcc-autopilot-execution-profile>
      <div>
        <span>Project team</span>
        <strong>${executionTitle}</strong>
        <small>${summarizePccExecutionProfile(executionProfile)}</small>
      </div>
      <p>
        Autopilot inherits this project profile. Prompt slots may narrow a role, but cannot enable
        Codex or exceed local capacity beyond this profile.
      </p>
    </article>
    <article class="pcc-autopilot__inherited-profile" data-pcc-autopilot-execution-standard>
      <div>
        <span>Automatic workflow</span>
        <strong>${executionStandard.status === "ready" ? "Ready" : "Needs attention"}</strong>
        <small>
          ${executionStandard.qualityTarget}/100 minimum ·
          ${executionStandard.selectedSkillKeys.length
            ? executionStandard.selectedSkillKeys.join(", ")
            : "built-in workflow"}
        </small>
      </div>
      <p>
        ${executionStandard.status === "ready"
          ? "PCC applies the same process, skills, QA, judge, and repair contract to every prompt."
          : (executionStandard.blockers[0] ??
            "PCC must resolve its live processes and skills before Autopilot can start.")}
      </p>
    </article>
    <article class="pcc-autopilot__status-card" data-pcc-autopilot-status-card>
      <dl>
        ${renderFact("Mode", autopilot.modeTitle)}
        ${renderFact(
          "Active prompt",
          autopilot.promptSlots.find((slot) => slot.id === autopilot.activePromptSlotId)?.title ??
            enabledPrompts[0]?.title ??
            "None",
        )}
        ${renderFact("Current set", String(autopilot.currentSet))}
        ${renderFact("Completed sets", String(autopilot.completedSets))}
        ${renderFact("Prompt iterations", String(autopilot.totalPromptIterations))}
        ${renderFact(
          "Executor",
          autopilot.currentExecutor === "safe_stub"
            ? "Safe stub (simulation)"
            : formatStatus(autopilot.currentExecutor),
        )}
        ${renderFact(
          "Last output",
          autopilot.lastOutputSummary ?? latestRun?.outputSummary ?? "No output yet",
        )}
        ${renderFact("Blocker", blocker?.whyBlocked ?? executionStandard.blockers[0] ?? "None")}
        ${renderFact(
          "Next action",
          blocker?.recommendedNextAction ??
            (executionStandard.status === "blocked"
              ? "Restore the live skill catalog or resolve the first required-skill blocker"
              : autopilot.status === "off"
                ? "Choose a mode and generate prompts"
                : "Review prompts or start safe loop"),
        )}
        ${renderFact("Judge", latestJudge?.summary ?? "Judge not run")}
      </dl>
      <p class="pcc-autopilot__safety" data-pcc-autopilot-safe-stub>
        Simulation mode is active: PCC records prompts and review guidance only. It does not claim
        live implementation, spend Codex/high-reasoning tokens, deploy, delete files, change
        credentials, reboot, or perform external writes.
      </p>
    </article>
    ${permissionForecast.required
      ? html`<article class="pcc-autopilot__permission" data-pcc-autopilot-permission-request>
          <div>
            <p class="pcc-kicker">Permission needed before start</p>
            <h5>${permissionForecast.reason}</h5>
            <p>${permissionForecast.policySummary}</p>
            <p>${permissionForecast.recommendedNextAction}</p>
            <ul>
              ${permissionForecast.promptTitles.map((title) => html`<li>${title}</li>`)}
            </ul>
          </div>
          <div class="pcc-autopilot__permission-actions">
            ${permissionForecast.requiredTier === "low"
              ? html`<button
                  class="btn"
                  type="button"
                  data-pcc-autopilot-allow-low
                  ?disabled=${props.actionBusy}
                  @click=${() => props.onRunAutopilotAction?.("allow_low_risk")}
                >
                  Allow low-risk loop
                </button>`
              : nothing}
            ${permissionForecast.requiredTier === "medium"
              ? html`<button
                  class="btn"
                  type="button"
                  data-pcc-autopilot-allow-medium
                  ?disabled=${props.actionBusy}
                  @click=${() => props.onRunAutopilotAction?.("allow_medium_risk")}
                >
                  Allow medium-risk loop
                </button>`
              : nothing}
            ${permissionForecast.requiredTier === "high"
              ? html`<button
                  class="btn"
                  type="button"
                  data-pcc-autopilot-allow-high
                  ?disabled=${props.actionBusy}
                  @click=${() => props.onRunAutopilotAction?.("allow_high_risk")}
                >
                  Allow high-risk loop
                </button>`
              : nothing}
            <button
              class="btn btn--subtle"
              type="button"
              data-pcc-autopilot-deny-permission
              ?disabled=${props.actionBusy}
              @click=${() => props.onRunAutopilotAction?.("deny_permission")}
            >
              Not now
            </button>
          </div>
        </article>`
      : html`<p class="pcc-autopilot__permission-ready" data-pcc-autopilot-permission-ready>
          Permission preflight: ${permissionForecast.policySummary}.
        </p>`}
    <section class="pcc-autopilot__permission-ledger" data-pcc-autopilot-permission-ledger>
      <article data-pcc-autopilot-permission-queue>
        <p class="pcc-kicker">Permission queue</p>
        ${pendingQueue.length
          ? html`<ul>
              ${pendingQueue.map(
                (item) => html`<li>
                  <strong>${formatStatus(item.riskTier)} approval waiting</strong>
                  <p>${item.reason}</p>
                  <small>Approve: ${item.approvalConsequence}</small>
                  <small>Deny: ${item.denialConsequence}</small>
                </li>`,
              )}
            </ul>`
          : html`<p class="pcc-empty pcc-empty--small">No Autopilot permissions waiting.</p>`}
        ${mode === "simple" || recentQueue.length === 0
          ? nothing
          : html`<details>
              <summary>Recent queue history (${recentQueue.length})</summary>
              <ul>
                ${recentQueue.map(
                  (item) => html`<li>
                    ${formatStatus(item.riskTier)} · ${formatStatus(item.status)} · ${item.reason}
                  </li>`,
                )}
              </ul>
            </details>`}
      </article>
      <article data-pcc-autopilot-grant-history>
        <p class="pcc-kicker">Autopilot grants</p>
        ${activeGrants.length
          ? html`<ul>
                ${activeGrants.map(
                  (grant) => html`<li>
                    <strong>${formatStatus(grant.riskTier)} grant active</strong>
                    <p>${grant.reason}</p>
                    <small>${grant.allowedActions.join(", ")}</small>
                  </li>`,
                )}
              </ul>
              <button
                class="btn btn--subtle"
                type="button"
                data-pcc-autopilot-revoke-grant
                ?disabled=${props.actionBusy}
                @click=${() => props.onRunAutopilotAction?.("revoke_permission_grant")}
              >
                Revoke latest grant
              </button>`
          : html`<p class="pcc-empty pcc-empty--small">No active Autopilot grants.</p>`}
      </article>
    </section>
    ${repairPreview
      ? html`<article class="pcc-autopilot__repair" data-pcc-autopilot-repair-preview>
          <p class="pcc-kicker">Judge repair recommendation</p>
          <h5>${repairPreview.title}</h5>
          <p>${repairPreview.summary}</p>
          <ul>
            ${repairPreview.changes.map((change) => html`<li>${change}</li>`)}
          </ul>
          <button
            class="btn"
            type="button"
            data-pcc-autopilot-apply-repair
            ?disabled=${props.actionBusy}
            @click=${() => props.onRunAutopilotAction?.("apply_permission_repair")}
          >
            Apply repair recommendation
          </button>
        </article>`
      : nothing}
    <div class="pcc-autopilot__controls" data-pcc-autopilot-controls>
      <label>
        <span>Loop mode</span>
        <select
          .value=${autopilot.mode}
          ?disabled=${props.actionBusy}
          data-pcc-autopilot-mode-picker
          @change=${(event: Event) =>
            props.onConfigureAutopilotMode?.(
              (event.target as HTMLSelectElement).value as PccAutopilotModeId,
            )}
        >
          ${PCC_AUTOPILOT_MODES.map(
            (loopMode) => html`<option value=${loopMode.id}>${loopMode.title}</option>`,
          )}
        </select>
      </label>
      <button
        class="btn"
        type="button"
        data-pcc-autopilot-generate-prompts
        ?disabled=${props.actionBusy}
        @click=${() => props.onGenerateAutopilotPrompts?.()}
      >
        Generate Loop Prompts
      </button>
      <button
        class="btn"
        type="button"
        data-pcc-autopilot-start
        ?disabled=${props.actionBusy ||
        enabledPrompts.length === 0 ||
        permissionForecast.required ||
        executionStandard.status === "blocked"}
        @click=${() => props.onRunAutopilotAction?.("start")}
      >
        Start Safe Loop
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-autopilot-pause
        ?disabled=${props.actionBusy}
        @click=${() => props.onRunAutopilotAction?.("pause")}
      >
        Pause
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-autopilot-resume
        ?disabled=${props.actionBusy}
        @click=${() => props.onRunAutopilotAction?.("resume")}
      >
        Resume
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-autopilot-stop
        ?disabled=${props.actionBusy}
        @click=${() => props.onRunAutopilotAction?.("stop")}
      >
        Stop now
      </button>
      <button
        class="btn btn--subtle"
        type="button"
        data-pcc-autopilot-block
        ?disabled=${props.actionBusy}
        @click=${() => props.onRunAutopilotAction?.("block")}
      >
        Mark blocked
      </button>
    </div>
    <details class="pcc-autopilot__prompts" data-pcc-autopilot-prompts open>
      <summary>Prompt slots (${enabledPrompts.length}/5 enabled)</summary>
      ${mode === "simple"
        ? html`<p class="pcc-empty pcc-empty--small">
            Prompt editors are hidden in Simple view. Switch to Detailed to edit prompts.
          </p>`
        : html`<div class="pcc-autopilot__prompt-grid">
            ${autopilot.promptSlots.map((slot) => renderAutopilotPromptSlot(slot, props))}
          </div>`}
    </details>
    <details class="pcc-autopilot__history" data-pcc-autopilot-history>
      <summary>Run history and judge review (${autopilot.runHistory.length})</summary>
      ${mode === "simple"
        ? html`<p class="pcc-empty pcc-empty--small">
            Run history is lazy-loaded in Detailed view.
          </p>`
        : autopilot.runHistory.length
          ? html`<ol>
              ${autopilot.runHistory
                .slice(-10)
                .toReversed()
                .map(
                  (run) => html`<li data-pcc-autopilot-run>
                    <strong>${run.promptTitle}</strong>
                    <span>${run.executor} · ${formatUpdatedAt(Date.parse(run.timestamp))}</span>
                    <p>${run.outputSummary}</p>
                    <small data-pcc-autopilot-context-summary>
                      Context: ${run.inputContextSummary || "No context summary recorded."}
                    </small>
                    <small data-pcc-autopilot-change-summary>
                      Changes: ${run.changedFiles.length}
                      file${run.changedFiles.length === 1 ? "" : "s"} · ${run.artifacts.length}
                      artifact${run.artifacts.length === 1 ? "" : "s"} · ${run.checksRun.length}
                      check${run.checksRun.length === 1 ? "" : "s"}
                    </small>
                    ${run.approvals.length
                      ? html`<small data-pcc-autopilot-approval-summary
                          >Approvals: ${run.approvals.join(", ")}</small
                        >`
                      : html`<small data-pcc-autopilot-approval-summary
                          >Approvals: none used</small
                        >`}
                    ${run.judgeResult ? html`<em>Judge: ${run.judgeResult.summary}</em>` : nothing}
                  </li>`,
                )}
            </ol>`
          : html`<p class="pcc-empty pcc-empty--small">No Autopilot runs yet.</p>`}
    </details>
    <details
      class="pcc-autopilot__report"
      data-pcc-autopilot-final-report
      ?open=${Boolean(autopilot.finalReport)}
    >
      <summary>Final report</summary>
      ${mode === "simple"
        ? html`<p class="pcc-empty pcc-empty--small">
            Final report details are available in Detailed view.
          </p>`
        : autopilot.finalReport
          ? html`<dl>
                ${renderFact("Project", autopilot.finalReport.projectName)}
                ${renderFact("Sets", String(autopilot.finalReport.setsCompleted))}
                ${renderFact("Prompt runs", String(autopilot.finalReport.totalPromptRuns))}
                ${renderFact("Judge", autopilot.finalReport.judgeResult)}
                ${renderFact("Next loop", formatStatus(autopilot.finalReport.recommendedNextLoop))}
              </dl>
              <strong>Remaining risks</strong>
              <ul>
                ${autopilot.finalReport.remainingRisks
                  .slice(0, 8)
                  .map((risk) => html`<li>${risk}</li>`)}
              </ul>`
          : html`<p class="pcc-empty pcc-empty--small">Run a loop to generate a final report.</p>`}
    </details>
  </section>`;
}
