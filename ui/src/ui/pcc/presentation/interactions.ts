type PccDragKind = "milestone" | "submilestone";

const draggedIds: Record<PccDragKind, string | null> = {
  milestone: null,
  submilestone: null,
};

export function beginPccDrag(event: DragEvent, kind: PccDragKind, id: string): void {
  event.stopPropagation();
  draggedIds[kind] = id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-openclaw-pcc-reorder", `${kind}:${id}`);
    event.dataTransfer.setData("text/plain", id);
  }
}

export function endPccDrag(kind: PccDragKind): void {
  draggedIds[kind] = null;
}

export function getPccDraggedId(event: DragEvent, kind: PccDragKind): string | null {
  const encoded = event.dataTransfer?.getData("application/x-openclaw-pcc-reorder") ?? "";
  const prefix = `${kind}:`;
  if (encoded.startsWith(prefix)) {
    return encoded.slice(prefix.length);
  }
  return event.dataTransfer?.getData("text/plain") || draggedIds[kind];
}

export function setPccDropTarget(event: DragEvent, active: boolean): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  if (!active) {
    const related = event.relatedTarget;
    if (related instanceof Node && target.contains(related)) {
      return;
    }
  }
  target.classList.toggle("is-drop-target", active);
}

export function confirmPccAction(message: string): boolean {
  return globalThis.confirm?.(message) ?? true;
}

export function confirmedSkipNote(): string {
  return "Skipped from the PCC action menu.";
}

export function confirmedRemoveNote(): string {
  return "Removed from the active PCC plan from the action menu.";
}

function resetPccConfirmationButton(button: HTMLButtonElement): void {
  const popover = button.nextElementSibling;
  if (popover instanceof HTMLElement && popover.dataset.pccConfirmPopover === "true") {
    popover.remove();
  }
  const originalLabel = button.dataset.pccConfirmOriginalLabel;
  if (originalLabel) {
    button.textContent = originalLabel;
  }
  delete button.dataset.pccConfirmArmed;
  delete button.dataset.pccConfirmOriginalLabel;
  button.classList.remove("is-confirming");
}

function armPccConfirmationButton(button: HTMLButtonElement, label: string): void {
  resetPccConfirmationButton(button);
  button.dataset.pccConfirmArmed = "true";
  button.dataset.pccConfirmOriginalLabel = button.textContent?.trim() ?? "";
  button.textContent = label;
  button.classList.add("is-confirming");
  const popover = document.createElement("span");
  popover.className = "pcc-confirm-popover";
  popover.dataset.pccConfirmPopover = "true";
  popover.textContent = `${label} to continue.`;
  button.insertAdjacentElement("afterend", popover);
}

function resetSiblingPccConfirmations(button: HTMLButtonElement): void {
  const root = button.closest(".pcc-shell") ?? button.getRootNode();
  if (!("querySelectorAll" in root)) {
    return;
  }
  const queryRoot = root as ParentNode;
  queryRoot
    .querySelectorAll<HTMLButtonElement>("[data-pcc-confirm-armed='true']")
    .forEach((armed) => {
      if (armed !== button) {
        resetPccConfirmationButton(armed);
      }
    });
}

export function runPccConfirmedButtonAction(
  event: Event,
  confirmLabel: string,
  action: () => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget as HTMLButtonElement;
  if (button.dataset.pccConfirmArmed === "true") {
    resetPccConfirmationButton(button);
    action();
    return;
  }
  resetSiblingPccConfirmations(button);
  armPccConfirmationButton(button, confirmLabel);
}

export function togglePccActionMenu(event: Event): void {
  event.stopPropagation();
  const trigger = event.currentTarget as HTMLButtonElement;
  const menu = trigger.closest<HTMLElement>(".pcc-action-menu");
  if (!menu) {
    return;
  }
  const root = menu.getRootNode() as ParentNode;
  const nextOpen = !menu.classList.contains("is-open");
  root.querySelectorAll<HTMLElement>(".pcc-action-menu.is-open").forEach((openMenu) => {
    if (openMenu !== menu) {
      openMenu.classList.remove("is-open");
      openMenu
        .querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")
        ?.setAttribute("aria-expanded", "false");
      const items = openMenu.querySelector<HTMLElement>(".pcc-action-menu__items");
      if (items) {
        items.hidden = true;
        items.setAttribute("aria-hidden", "true");
        items.setAttribute("inert", "");
      }
    }
  });
  menu.classList.toggle("is-open", nextOpen);
  trigger.setAttribute("aria-expanded", String(nextOpen));
  const items = menu.querySelector<HTMLElement>(".pcc-action-menu__items");
  if (items) {
    items.hidden = !nextOpen;
    items.setAttribute("aria-hidden", String(!nextOpen));
    if (nextOpen) {
      items.removeAttribute("inert");
    } else {
      items.setAttribute("inert", "");
    }
  }
  if (nextOpen) {
    menu
      .querySelector<HTMLButtonElement>("[role='menuitem'], [role='menuitemcheckbox'] input")
      ?.focus();
  }
}

export function closePccActionMenu(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget as HTMLElement;
  const menu = target.closest<HTMLElement>(".pcc-action-menu");
  menu?.classList.remove("is-open");
  menu
    ?.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")
    ?.setAttribute("aria-expanded", "false");
  const items = menu?.querySelector<HTMLElement>(".pcc-action-menu__items");
  if (items) {
    items.hidden = true;
    items.setAttribute("aria-hidden", "true");
    items.setAttribute("inert", "");
  }
}

export function runPccMenuAction(event: Event, action: () => void): void {
  closePccActionMenu(event);
  action();
}

export function handlePccActionMenuKeydown(event: KeyboardEvent): void {
  const menu = event.currentTarget as HTMLElement;
  const root = menu.closest<HTMLElement>(".pcc-action-menu");
  const focusable = [
    ...menu.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      "button:not(:disabled), input:not(:disabled)",
    ),
  ];
  const currentIndex = focusable.findIndex((item) => item === document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    root?.classList.remove("is-open");
    root
      ?.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")
      ?.setAttribute("aria-expanded", "false");
    menu.hidden = true;
    menu.setAttribute("aria-hidden", "true");
    menu.setAttribute("inert", "");
    root?.querySelector<HTMLButtonElement>("[data-pcc-action-menu-trigger]")?.focus();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }
  event.preventDefault();
  const direction = event.key === "ArrowDown" ? 1 : -1;
  const nextIndex =
    currentIndex < 0
      ? 0
      : (currentIndex + direction + focusable.length) % Math.max(focusable.length, 1);
  focusable[nextIndex]?.focus();
}

export function runPccConfirmedMenuAction(
  event: Event,
  confirmLabel: string,
  action: () => void,
): void {
  const button = event.currentTarget as HTMLButtonElement;
  if (button.dataset.pccConfirmArmed === "true") {
    closePccActionMenu(event);
    resetPccConfirmationButton(button);
    action();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  resetSiblingPccConfirmations(button);
  armPccConfirmationButton(button, confirmLabel);
}
