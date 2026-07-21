export const OPERATIONS_SECTIONS = [
  "attention",
  "working",
  "agents",
  "automations",
  "system",
] as const;

export type OperationsSection = (typeof OPERATIONS_SECTIONS)[number];

const OPERATIONS_SECTION_PARAM = "section";

export function isOperationsSection(value: string | null | undefined): value is OperationsSection {
  return OPERATIONS_SECTIONS.includes(value as OperationsSection);
}

export function operationsSectionFromUrl(url: URL): OperationsSection | null {
  const value = url.searchParams.get(OPERATIONS_SECTION_PARAM);
  return isOperationsSection(value) ? value : null;
}

export function operationsSectionTargetId(section: OperationsSection): string {
  return `operations-${section}`;
}

export function updateOperationsSectionUrl(url: URL, section: OperationsSection | null): URL {
  const next = new URL(url.toString());
  if (section) {
    next.searchParams.set(OPERATIONS_SECTION_PARAM, section);
  } else {
    next.searchParams.delete(OPERATIONS_SECTION_PARAM);
  }
  return next;
}

export function focusOperationsSection(
  section: OperationsSection,
  root: ParentNode = document,
): boolean {
  const target = root.querySelector<HTMLElement>(`#${operationsSectionTargetId(section)}`);
  if (!target) {
    return false;
  }
  const reduceMotion =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView?.({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  target.focus({ preventScroll: true });
  return true;
}
