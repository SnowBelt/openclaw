export type ObserverToolEventRedaction = {
  paramsRedacted: boolean;
  resultRedacted: boolean;
};

const observerToolEventRedaction = Symbol("openclaw.agent-session.observer-tool-event-redaction");

type MarkedObserverToolEvent = {
  [observerToolEventRedaction]?: ObserverToolEventRedaction;
};

// Keep observer redaction provenance out of serialized events while allowing
// downstream hooks to distinguish trusted redaction from an unknown tool.
export function markObserverToolEventRedaction<T extends object>(
  event: T,
  redaction: ObserverToolEventRedaction,
): T {
  Object.defineProperty(event, observerToolEventRedaction, {
    configurable: false,
    enumerable: false,
    value: redaction,
    writable: false,
  });
  return event;
}

export function readObserverToolEventRedaction(
  event: unknown,
): ObserverToolEventRedaction | undefined {
  if (!event || typeof event !== "object") {
    return undefined;
  }
  const redaction = (event as MarkedObserverToolEvent)[observerToolEventRedaction];
  if (
    !redaction ||
    typeof redaction.paramsRedacted !== "boolean" ||
    typeof redaction.resultRedacted !== "boolean"
  ) {
    return undefined;
  }
  return redaction;
}
