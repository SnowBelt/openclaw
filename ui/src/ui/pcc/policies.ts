import type { PccStatus } from "../types.ts";

/** Terminal statuses shared by PCC application and presentation policies. */
export const PCC_TERMINAL_STATUSES = new Set<PccStatus>([
  "complete",
  "complete_with_maintenance",
  "skipped",
  "archived",
]);

export function pccStatusIsTerminal(status: PccStatus): boolean {
  return PCC_TERMINAL_STATUSES.has(status);
}
