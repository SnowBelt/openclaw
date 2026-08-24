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
  queuePaused?: boolean;
  onQueueTogglePause?: () => void;
};

function sendStateLabel(item: ChatQueueItem): string | null {
  if (item.sendError && !item.sendState) {
    return "Failed";
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
  if (!props.queue.length && !props.queuePaused) {
    return nothing;
  }
  return html`
    <div class="chat-queue" role="status" aria-live="polite">
      <div class="chat-queue__header">
        <div class="chat-queue__title">
          Queue (${props.queue.length})${props.queuePaused ? " · Paused" : ""}
        </div>
        ${props.onQueueTogglePause
          ? html`
              <button
                class="btn chat-queue__pause"
                type="button"
                aria-label=${props.queuePaused ? "Resume queue" : "Pause queue"}
                aria-pressed=${props.queuePaused ? "true" : "false"}
                @click=${props.onQueueTogglePause}
              >
                ${props.queuePaused ? "Resume" : "Pause"}
              </button>
            `
          : nothing}
      </div>
      ${props.queue.length
        ? html`<div class="chat-queue__list">
            ${props.queue.map((item) => {
              const stateLabel = sendStateLabel(item);
              return html`
                <div
                  class="chat-queue__item ${item.kind === "steered"
                    ? "chat-queue__item--steered"
                    : ""}"
                >
                  <div class="chat-queue__main">
                    ${item.kind === "steered"
                      ? html`<span class="chat-queue__badge">Steered</span>`
                      : nothing}
                    ${stateLabel
                      ? html`<span class="chat-queue__badge">${stateLabel}</span>`
                      : nothing}
                    <div class="chat-queue__text">
                      ${item.text ||
                      (item.attachments?.length ? `Image (${item.attachments.length})` : "")}
                    </div>
                    ${item.sendError
                      ? html`<div class="chat-queue__error">${item.sendError}</div>`
                      : nothing}
                  </div>
                  <div class="chat-queue__actions">
                    ${(item.sendState === "failed" || (item.sendError && !item.sendState)) &&
                    props.onQueueRetry
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
                    ${props.canAbort &&
                    props.onQueueSteer &&
                    item.kind !== "steered" &&
                    !item.sendState &&
                    !item.localCommandName
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
          </div>`
        : html`<div class="chat-queue__empty">No messages are waiting. Resume when ready.</div>`}
    </div>
  `;
}
