import type {
  ControlDirectorLayoutObservationReportParams,
  ControlDirectorLayoutObservationReportResult,
  ControlDirectorLayoutObstructionReason,
  ExecutionStateSnapshot,
} from "../../../../packages/gateway-protocol/src/index.js";

const LAYOUT_EDGE_TOLERANCE_PX = 1;
const LAYOUT_REPORT_RETRY_MS = 5_000;

type LayoutRect = NonNullable<ControlDirectorLayoutObservationReportParams["composer"]["rect"]>;

export type ControlDirectorChatLayoutSnapshot = Omit<
  ControlDirectorLayoutObservationReportParams,
  "schemaVersion" | "sessionKey" | "observationId" | "observedAt" | "reason"
>;

type LayoutFailureEpisode = {
  key: string;
  observationId: string;
  lastAttemptAt: number;
};

export type ControlDirectorLayoutHealthHost = {
  tab: string;
  connected?: boolean;
  sessionKey: string;
  chatExecutionState?: ExecutionStateSnapshot | null;
  client?: {
    request: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  } | null;
  querySelector: Element["querySelector"];
  controlDirectorLayoutFrame?: number | null;
  controlDirectorLayoutRetryTimer?: ReturnType<typeof globalThis.setTimeout> | number | null;
  controlDirectorLayoutFailureEpisode?: LayoutFailureEpisode | null;
  controlDirectorLayoutObservationSeq?: number;
  controlDirectorLayoutResizeHandler?: (() => void) | null;
};

function rectSnapshot(rect: DOMRect): LayoutRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function isVisible(element: HTMLElement | null): boolean {
  if (!element) {
    return false;
  }
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity || "1") > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function detectControlDirectorLayoutObstruction(
  snapshot: ControlDirectorChatLayoutSnapshot,
): ControlDirectorLayoutObstructionReason | undefined {
  if (snapshot.pccProjectionPresent) {
    return "pcc_projection_in_chat";
  }
  if (snapshot.truthCompletionPresent) {
    return "truth_completion_in_chat";
  }
  if (!snapshot.transcript.visible) {
    return "transcript_hidden";
  }
  if (!snapshot.composer.visible) {
    return "composer_hidden";
  }
  if (
    snapshot.transcript.rect &&
    snapshot.composer.rect &&
    snapshot.transcript.rect.bottom > snapshot.composer.rect.top + LAYOUT_EDGE_TOLERANCE_PX
  ) {
    return "transcript_composer_overlap";
  }
  if (
    snapshot.composer.rect &&
    (snapshot.composer.rect.top < -LAYOUT_EDGE_TOLERANCE_PX ||
      snapshot.composer.rect.bottom > snapshot.viewport.height + LAYOUT_EDGE_TOLERANCE_PX)
  ) {
    return "composer_outside_viewport";
  }
  return undefined;
}

export function measureControlDirectorChatLayout(
  host: ControlDirectorLayoutHealthHost,
): ControlDirectorChatLayoutSnapshot | undefined {
  const chat = host.querySelector<HTMLElement>(".card.chat");
  if (!chat || window.innerWidth < 1 || window.innerHeight < 1) {
    return undefined;
  }
  const transcript = chat.querySelector<HTMLElement>(".chat-thread");
  const composer = chat.querySelector<HTMLElement>(".agent-chat__input");
  const textarea = composer?.querySelector<HTMLTextAreaElement>("textarea") ?? null;
  const transcriptRect = transcript?.getBoundingClientRect();
  const composerRect = composer?.getBoundingClientRect();
  return {
    viewport: {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
    },
    transcript: {
      visible: isVisible(transcript),
      ...(transcriptRect ? { rect: rectSnapshot(transcriptRect) } : {}),
    },
    composer: {
      visible: isVisible(composer) && isVisible(textarea),
      ...(composerRect ? { rect: rectSnapshot(composerRect) } : {}),
    },
    truthCompletionPresent: Boolean(chat.querySelector("[data-control-director-diagnostics]")),
    pccProjectionPresent: Boolean(chat.querySelector("[data-pcc-chat-sync]")),
  };
}

function isControlDirectorChat(host: ControlDirectorLayoutHealthHost): boolean {
  const executionState = host.chatExecutionState;
  return Boolean(
    host.tab === "chat" &&
    host.connected &&
    host.client &&
    executionState?.sessionKey === host.sessionKey &&
    executionState.runtimeLineage?.role === "control_director",
  );
}

function clearRetryTimer(host: ControlDirectorLayoutHealthHost): void {
  if (host.controlDirectorLayoutRetryTimer != null) {
    globalThis.clearTimeout(host.controlDirectorLayoutRetryTimer);
    host.controlDirectorLayoutRetryTimer = null;
  }
}

async function reportControlDirectorLayoutHealth(
  host: ControlDirectorLayoutHealthHost,
): Promise<void> {
  if (!isControlDirectorChat(host)) {
    host.controlDirectorLayoutFailureEpisode = null;
    return;
  }
  const snapshot = measureControlDirectorChatLayout(host);
  if (!snapshot) {
    return;
  }
  const reason = detectControlDirectorLayoutObstruction(snapshot);
  if (!reason) {
    host.controlDirectorLayoutFailureEpisode = null;
    clearRetryTimer(host);
    return;
  }
  const key = `${host.sessionKey}:${reason}:${snapshot.viewport.width}x${snapshot.viewport.height}`;
  const now = Date.now();
  const previous = host.controlDirectorLayoutFailureEpisode;
  const nextSequence = (host.controlDirectorLayoutObservationSeq ?? 0) + 1;
  const episode =
    previous?.key === key
      ? previous
      : {
          key,
          observationId: `layout-${now.toString(36)}-${nextSequence.toString(36)}`,
          lastAttemptAt: 0,
        };
  if (previous?.key !== key) {
    host.controlDirectorLayoutObservationSeq = nextSequence;
  }
  host.controlDirectorLayoutFailureEpisode = episode;
  if (episode.lastAttemptAt > 0 && now - episode.lastAttemptAt < LAYOUT_REPORT_RETRY_MS) {
    return;
  }
  episode.lastAttemptAt = now;
  const params: ControlDirectorLayoutObservationReportParams = {
    schemaVersion: 1,
    sessionKey: host.sessionKey,
    observationId: episode.observationId,
    observedAt: now,
    ...snapshot,
    reason,
  };
  try {
    await host.client!.request<ControlDirectorLayoutObservationReportResult>(
      "selfImprovement.controlDirector.layout.report",
      params,
    );
    clearRetryTimer(host);
  } catch {
    clearRetryTimer(host);
    host.controlDirectorLayoutRetryTimer = globalThis.setTimeout(() => {
      host.controlDirectorLayoutRetryTimer = null;
      scheduleControlDirectorLayoutHealthCheck(host);
    }, LAYOUT_REPORT_RETRY_MS);
  }
}

export function scheduleControlDirectorLayoutHealthCheck(
  host: ControlDirectorLayoutHealthHost,
): void {
  if (typeof window === "undefined") {
    return;
  }
  if (
    host.controlDirectorLayoutFrame != null &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(host.controlDirectorLayoutFrame);
  }
  if (typeof window.requestAnimationFrame !== "function") {
    return;
  }
  host.controlDirectorLayoutFrame = window.requestAnimationFrame(() => {
    host.controlDirectorLayoutFrame = null;
    void reportControlDirectorLayoutHealth(host);
  });
}

export function connectControlDirectorLayoutHealth(host: ControlDirectorLayoutHealthHost): void {
  if (typeof window === "undefined") {
    return;
  }
  if (!host.controlDirectorLayoutResizeHandler) {
    host.controlDirectorLayoutResizeHandler = () => scheduleControlDirectorLayoutHealthCheck(host);
    window.addEventListener("resize", host.controlDirectorLayoutResizeHandler, { passive: true });
  }
  scheduleControlDirectorLayoutHealthCheck(host);
}

export function disconnectControlDirectorLayoutHealth(host: ControlDirectorLayoutHealthHost): void {
  if (typeof window === "undefined") {
    clearRetryTimer(host);
    host.controlDirectorLayoutFailureEpisode = null;
    return;
  }
  if (host.controlDirectorLayoutResizeHandler) {
    window.removeEventListener("resize", host.controlDirectorLayoutResizeHandler);
    host.controlDirectorLayoutResizeHandler = null;
  }
  if (
    host.controlDirectorLayoutFrame != null &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(host.controlDirectorLayoutFrame);
    host.controlDirectorLayoutFrame = null;
  }
  clearRetryTimer(host);
  host.controlDirectorLayoutFailureEpisode = null;
}
