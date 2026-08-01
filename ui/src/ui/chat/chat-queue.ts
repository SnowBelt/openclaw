// Control UI chat module implements chat queue behavior.
import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type { ChatQueueItem } from "../ui-types.ts";

export type ChatQueueProps = {
  queue: ChatQueueItem[];
  canAbort?: boolean;
  onQueueRetry?: (id: string) => void;
  onQueueSteer?: (id: string) => void;
  onQueueRemove: (id: string) => void;
};

export type ChatQueueSummary = {
  queued: number;
  working: number;
  failed: number;
};

export function summarizeChatQueue(queue: readonly ChatQueueItem[]): ChatQueueSummary {
  const summary: ChatQueueSummary = { queued: 0, working: 0, failed: 0 };
  for (const item of queue) {
    if (item.serverPhase === "failed" || item.sendState === "failed") {
      summary.failed += 1;
    } else if (
      item.serverPhase === "dispatching" ||
      item.serverPhase === "admitted" ||
      item.sendState === "sending" ||
      item.sendState === "waiting-model"
    ) {
      summary.working += 1;
    } else {
      summary.queued += 1;
    }
  }
  return summary;
}

function sendStateLabel(item: ChatQueueItem): string | null {
  if (item.serverPhase === "pending") {
    return "Queued";
  }
  if (item.serverPhase === "dispatching") {
    return "Starting";
  }
  if (item.serverPhase === "admitted") {
    return "Running";
  }
  switch (item.sendState) {
    case "waiting-model":
      return "Waiting for model";
    case "sending":
      return "Sending";
    case "waiting-reconnect":
      return "Waiting for reconnect";
    case "failed":
      return "Failed";
    default:
      return null;
  }
}

export function renderChatQueue(props: ChatQueueProps) {
  if (!props.queue.length) {
    return nothing;
  }
  const summary = summarizeChatQueue(props.queue);
  const summaryParts = [
    summary.working > 0 ? `${summary.working} running` : null,
    summary.queued > 0 ? `${summary.queued} queued` : null,
    summary.failed > 0 ? `${summary.failed} failed` : null,
  ].filter((part): part is string => part !== null);
  return html`
    <div class="chat-queue" role="status" aria-live="polite">
      <div class="chat-queue__title">Queue · ${summaryParts.join(" · ")}</div>
      <div class="chat-queue__list">
        ${props.queue.map((item) => {
          const stateLabel = sendStateLabel(item);
          return html`
            <div
              class="chat-queue__item ${item.kind === "steered" ? "chat-queue__item--steered" : ""}"
            >
              <div class="chat-queue__main">
                ${item.kind === "steered"
                  ? html`<span class="chat-queue__badge">Steered</span>`
                  : nothing}
                ${stateLabel ? html`<span class="chat-queue__badge">${stateLabel}</span>` : nothing}
                <div class="chat-queue__text" data-chat-queue-text>
                  ${item.text ||
                  (item.attachments?.length ? `Image (${item.attachments.length})` : "")}
                </div>
                ${item.sendError
                  ? html`<div class="chat-queue__error">${item.sendError}</div>`
                  : nothing}
                ${item.serverActivitySummary
                  ? html`<div class="chat-queue__activity">${item.serverActivitySummary}</div>`
                  : nothing}
              </div>
              <div class="chat-queue__actions">
                ${item.sendState === "failed" && props.onQueueRetry
                  ? html`
                      <button
                        class="btn chat-queue__retry"
                        type="button"
                        title=${t("chat.queue.retrySend")}
                        aria-label=${t("chat.queue.retryQueuedMessage")}
                        @click=${() => props.onQueueRetry?.(item.id)}
                      >
                        ${icons.refresh}
                        <span>${t("chat.queue.retry")}</span>
                      </button>
                    `
                  : nothing}
                ${props.onQueueSteer && item.serverTurnId && item.serverAdmissionOpen
                  ? html`
                      <button
                        class="btn chat-queue__steer"
                        type="button"
                        title=${item.kind === "steered" ? "Keep queued" : "Steer now"}
                        aria-label=${item.kind === "steered"
                          ? "Change steered message back to queued"
                          : "Steer queued message"}
                        @click=${() => props.onQueueSteer?.(item.id)}
                      >
                        ${item.kind === "steered" ? icons.clock : icons.cornerDownRight}
                        <span>${item.kind === "steered" ? "Queue" : "Steer"}</span>
                      </button>
                    `
                  : props.canAbort &&
                      props.onQueueSteer &&
                      item.kind !== "steered" &&
                      !item.sendState &&
                      !item.localCommandName &&
                      !item.serverTurnId
                    ? html`
                        <button
                          class="btn chat-queue__steer"
                          type="button"
                          title="Steer now"
                          aria-label="Steer queued message"
                          @click=${() => props.onQueueSteer?.(item.id)}
                        >
                          ${icons.cornerDownRight}
                          <span>Steer</span>
                        </button>
                      `
                    : nothing}
                <button
                  class="btn chat-queue__remove"
                  type="button"
                  aria-label="Remove queued message"
                  @click=${() => props.onQueueRemove(item.id)}
                >
                  ${icons.x}
                </button>
              </div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}
