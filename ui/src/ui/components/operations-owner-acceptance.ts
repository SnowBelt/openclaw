import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";

export const OPERATIONS_OWNER_ACCEPTANCE_SCHEMA = "openclaw.operations-room.owner-ui-attempt.v1";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9._:@/+~-]{1,160}$/u;
const ACCEPTANCE_DURATION_MS = 60_000;
const RESOLUTION_OPENED_EVENT = "openclaw-operations-resolution-opened";
const RESOLUTION_DEFERRED_EVENT = "openclaw-operations-resolution-deferred";

export type OperationsOwnerAcceptanceConfig = {
  campaignId: string;
  candidateSha: string;
  fixtureSha256: string;
  participantId: string;
};

export type OperationsOwnerAcceptanceFacts = {
  localAiProcessCount: number | null;
  openClawWorkingCount: number;
  primaryIssueId: string | null;
  primaryIssueNextAction: string;
  primaryIssueOwner: string;
  primaryStatus: "normal" | "attention" | "urgent" | "unknown";
  snapshotGeneratedAt: number;
};

export type OperationsOwnerAcceptanceReceipt = {
  schema: typeof OPERATIONS_OWNER_ACCEPTANCE_SCHEMA;
  campaignId: string;
  candidateSha: string;
  fixtureSha256: string;
  participantId: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  snapshotGeneratedAt: number;
  hintCount: 0;
  unsafeActionCount: 0;
  ownerAttested: true;
  outcomes: {
    issueDetailsAndOwnerOrNext: boolean;
    localAiDistinctionCorrect: boolean;
    overallStateCorrect: boolean;
    resolvePreviewAndSafeCancel: boolean;
    workingItemIdentified: boolean;
  };
  result: "passed" | "failed";
};

type AnswerKey = "activity" | "issue" | "status";
type Phase = "idle" | "running" | "finished";

function requiredParam(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 && values[0] ? values[0] : null;
}

export function operationsOwnerAcceptanceConfigFromUrl(
  href: string,
): OperationsOwnerAcceptanceConfig | null {
  const url = new URL(href);
  if (url.searchParams.get("ownerAcceptance") !== "1") {
    return null;
  }
  const campaignId = requiredParam(url.searchParams, "campaignId");
  const candidateSha = requiredParam(url.searchParams, "candidateSha");
  const fixtureSha256 = requiredParam(url.searchParams, "fixtureSha256");
  const participantId = requiredParam(url.searchParams, "participantId");
  if (
    !campaignId ||
    !candidateSha ||
    !fixtureSha256 ||
    !participantId ||
    !ID_PATTERN.test(campaignId) ||
    !SHA_PATTERN.test(candidateSha) ||
    !DIGEST_PATTERN.test(fixtureSha256) ||
    !DIGEST_PATTERN.test(participantId)
  ) {
    return null;
  }
  return { campaignId, candidateSha, fixtureSha256, participantId };
}

function uniqueOptions(values: string[]): string[] {
  return [...new Set(values)];
}

export class OperationsOwnerAcceptance extends LitElement {
  override createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) config: OperationsOwnerAcceptanceConfig | null = null;
  @property({ attribute: false }) facts: OperationsOwnerAcceptanceFacts | null = null;

  @state() private phase: Phase = "idle";
  @state() private startedAt: number | null = null;
  @state() private now = Date.now();
  @state() private answers: Partial<Record<AnswerKey, boolean>> = {};
  @state() private selectedLabels: Partial<Record<AnswerKey, string>> = {};
  @state() private primaryResolutionOpened = false;
  @state() private primaryResolutionDeferred = false;
  @state() private receipt: OperationsOwnerAcceptanceReceipt | null = null;
  @state() private copied = false;
  @state() private copyFailed = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly handleResolutionOpened = (event: Event) => {
    if (
      this.phase === "running" &&
      event instanceof CustomEvent &&
      event.detail?.findingId === this.facts?.primaryIssueId
    ) {
      this.primaryResolutionOpened = true;
    }
  };

  private readonly handleResolutionDeferred = (event: Event) => {
    if (
      this.phase === "running" &&
      event instanceof CustomEvent &&
      event.detail?.findingId === this.facts?.primaryIssueId
    ) {
      this.primaryResolutionOpened = true;
      this.primaryResolutionDeferred = true;
    }
  };

  override connectedCallback() {
    super.connectedCallback();
    globalThis.addEventListener(RESOLUTION_OPENED_EVENT, this.handleResolutionOpened);
    globalThis.addEventListener(RESOLUTION_DEFERRED_EVENT, this.handleResolutionDeferred);
  }

  override disconnectedCallback() {
    this.stopTimer();
    globalThis.removeEventListener(RESOLUTION_OPENED_EVENT, this.handleResolutionOpened);
    globalThis.removeEventListener(RESOLUTION_DEFERRED_EVENT, this.handleResolutionDeferred);
    super.disconnectedCallback();
  }

  private stopTimer() {
    if (this.timer != null) {
      globalThis.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private begin() {
    if (!this.config || !this.facts || this.phase !== "idle") {
      return;
    }
    const startedAt = Date.now();
    this.phase = "running";
    this.startedAt = startedAt;
    this.now = startedAt;
    this.answers = {};
    this.selectedLabels = {};
    this.primaryResolutionOpened = false;
    this.primaryResolutionDeferred = false;
    this.timer = globalThis.setInterval(() => {
      this.now = Date.now();
    }, 1_000);
  }

  private recordAnswer(key: AnswerKey, label: string, correct: boolean) {
    if (this.phase !== "running") {
      return;
    }
    this.answers = { ...this.answers, [key]: correct };
    this.selectedLabels = { ...this.selectedLabels, [key]: label };
  }

  private finish() {
    if (!this.config || !this.facts || this.phase !== "running" || this.startedAt == null) {
      return;
    }
    const finishedAt = Date.now();
    const elapsedMs = Math.max(0, finishedAt - this.startedAt);
    const outcomes = {
      issueDetailsAndOwnerOrNext: this.answers.issue === true,
      localAiDistinctionCorrect: this.answers.activity === true,
      overallStateCorrect: this.answers.status === true,
      // Preserve the receipt field for existing coordinator records; the UI event is explicitly
      // a safe deferral rather than a cancellation-based resolution.
      resolvePreviewAndSafeCancel: this.primaryResolutionOpened && this.primaryResolutionDeferred,
      workingItemIdentified: this.answers.activity === true,
    };
    const passed = elapsedMs <= ACCEPTANCE_DURATION_MS && Object.values(outcomes).every(Boolean);
    this.receipt = {
      schema: OPERATIONS_OWNER_ACCEPTANCE_SCHEMA,
      ...this.config,
      startedAt: new Date(this.startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      elapsedMs,
      snapshotGeneratedAt: this.facts.snapshotGeneratedAt,
      hintCount: 0,
      unsafeActionCount: 0,
      ownerAttested: true,
      outcomes,
      result: passed ? "passed" : "failed",
    };
    this.stopTimer();
    this.phase = "finished";
    this.dispatchEvent(
      new CustomEvent("operations-owner-acceptance-receipt", {
        bubbles: true,
        composed: true,
        detail: this.receipt,
      }),
    );
  }

  private async copyReceipt() {
    if (!this.receipt) {
      return;
    }
    try {
      await globalThis.navigator.clipboard.writeText(JSON.stringify(this.receipt, null, 2));
      this.copied = true;
      this.copyFailed = false;
    } catch {
      this.copyFailed = true;
    }
  }

  private secondsRemaining(): number {
    if (this.startedAt == null) {
      return 60;
    }
    return Math.max(0, Math.ceil((ACCEPTANCE_DURATION_MS - (this.now - this.startedAt)) / 1000));
  }

  private renderChoice(key: AnswerKey, label: string, correct: boolean, selected: boolean) {
    return html`<button
      type="button"
      class=${`btn operations-owner-check__choice${selected ? " is-selected" : ""}`}
      aria-pressed=${selected}
      @click=${() => this.recordAnswer(key, label, correct)}
    >
      ${label}
    </button>`;
  }

  private renderRunning(facts: OperationsOwnerAcceptanceFacts) {
    const localAiCount = facts.localAiProcessCount ?? 0;
    const statusOptions = [
      { key: "normal", label: t("operationsRoom.overallBriefingTone.normal") },
      { key: "attention", label: t("operationsRoom.overallBriefingTone.attention") },
      { key: "urgent", label: t("operationsRoom.overallBriefingTone.urgent") },
      { key: "unknown", label: t("operationsRoom.overallBriefingTone.unknown") },
    ] as const;
    const exactActivity = t("operationsRoom.ownerAcceptance.activityAnswer", {
      localAi: String(localAiCount),
      openClaw: String(facts.openClawWorkingCount),
    });
    const activityOptions = uniqueOptions([
      exactActivity,
      t("operationsRoom.ownerAcceptance.activityAnswer", {
        localAi: String(facts.openClawWorkingCount),
        openClaw: String(localAiCount),
      }),
      t("operationsRoom.ownerAcceptance.activityAnswer", {
        localAi: "0",
        openClaw: "0",
      }),
    ]).toSorted();
    const exactIssue = t("operationsRoom.ownerAcceptance.issueAnswer", {
      next: facts.primaryIssueNextAction,
      owner: facts.primaryIssueOwner,
    });
    const issueOptions = [exactIssue, t("operationsRoom.ownerAcceptance.issueUnknown")].toSorted();
    const resolveDone = this.primaryResolutionOpened && this.primaryResolutionDeferred;
    const readyToFinish =
      this.answers.status !== undefined &&
      this.answers.activity !== undefined &&
      this.answers.issue !== undefined &&
      resolveDone;
    return html`
      <div class="operations-owner-check__timer" role="timer" aria-live="off">
        <strong>${this.secondsRemaining()}</strong>
        <span>${t("operationsRoom.ownerAcceptance.secondsLeft")}</span>
      </div>
      <div class="operations-owner-check__questions">
        <fieldset>
          <legend>${t("operationsRoom.ownerAcceptance.statusQuestion")}</legend>
          <div class="operations-owner-check__choices">
            ${statusOptions.map((option) =>
              this.renderChoice(
                "status",
                option.label,
                option.key === facts.primaryStatus,
                this.selectedLabels.status === option.label,
              ),
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend>${t("operationsRoom.ownerAcceptance.activityQuestion")}</legend>
          <div class="operations-owner-check__choices">
            ${activityOptions.map((label) =>
              this.renderChoice(
                "activity",
                label,
                label === exactActivity,
                this.selectedLabels.activity === label,
              ),
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend>${t("operationsRoom.ownerAcceptance.issueQuestion")}</legend>
          <div class="operations-owner-check__choices">
            ${issueOptions.map((label) =>
              this.renderChoice(
                "issue",
                label,
                label === exactIssue,
                this.selectedLabels.issue === label,
              ),
            )}
          </div>
        </fieldset>
        <div class=${`operations-owner-check__resolve${resolveDone ? " is-done" : ""}`}>
          <strong>${t("operationsRoom.ownerAcceptance.resolveQuestion")}</strong>
          <span>
            ${resolveDone
              ? t("operationsRoom.ownerAcceptance.resolveDone")
              : t("operationsRoom.ownerAcceptance.resolvePending")}
          </span>
        </div>
      </div>
      <button
        type="button"
        class="btn btn--primary operations-owner-check__finish"
        ?disabled=${!readyToFinish}
        @click=${() => this.finish()}
      >
        ${t("operationsRoom.ownerAcceptance.finish")}
      </button>
    `;
  }

  private renderFinished(receipt: OperationsOwnerAcceptanceReceipt) {
    const download = `data:application/json;charset=utf-8,${encodeURIComponent(
      `${JSON.stringify(receipt, null, 2)}\n`,
    )}`;
    return html`
      <div
        class=${`operations-owner-check__result operations-owner-check__result--${receipt.result}`}
        role="status"
      >
        <strong>
          ${t(
            receipt.result === "passed"
              ? "operationsRoom.ownerAcceptance.passed"
              : "operationsRoom.ownerAcceptance.failed",
          )}
        </strong>
        <span>
          ${t("operationsRoom.ownerAcceptance.elapsed", {
            seconds: (receipt.elapsedMs / 1000).toFixed(1),
          })}
        </span>
      </div>
      <div class="operations-owner-check__receipt-actions">
        <button type="button" class="btn btn--primary" @click=${() => void this.copyReceipt()}>
          ${t(
            this.copied
              ? "operationsRoom.ownerAcceptance.copied"
              : "operationsRoom.ownerAcceptance.copyReceipt",
          )}
        </button>
        <a
          class="btn"
          href=${download}
          download=${`operations-room-owner-acceptance-${receipt.candidateSha.slice(0, 12)}.json`}
        >
          ${t("operationsRoom.ownerAcceptance.downloadReceipt")}
        </a>
      </div>
      ${this.copyFailed
        ? html`<p class="operations-muted" role="status">
            ${t("operationsRoom.ownerAcceptance.copyFailed")}
          </p>`
        : nothing}
    `;
  }

  override render() {
    if (!this.config || !this.facts) {
      return nothing;
    }
    return html`
      <section class="operations-owner-check" aria-labelledby="operations-owner-check-title">
        <div class="operations-owner-check__header">
          <div>
            <p class="operations-eyebrow">${t("operationsRoom.ownerAcceptance.eyebrow")}</p>
            <h2 id="operations-owner-check-title">${t("operationsRoom.ownerAcceptance.title")}</h2>
            <p>${t("operationsRoom.ownerAcceptance.subtitle")}</p>
          </div>
          ${this.phase === "idle"
            ? html`<button type="button" class="btn btn--primary" @click=${() => this.begin()}>
                ${t("operationsRoom.ownerAcceptance.begin")}
              </button>`
            : nothing}
        </div>
        ${this.phase === "running" && this.facts
          ? this.renderRunning(this.facts)
          : this.phase === "finished" && this.receipt
            ? this.renderFinished(this.receipt)
            : nothing}
      </section>
    `;
  }
}

if (!customElements.get("operations-owner-acceptance")) {
  customElements.define("operations-owner-acceptance", OperationsOwnerAcceptance);
}
