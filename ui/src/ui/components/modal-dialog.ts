// Compatibility export for the verified custom Control UI shell. The updated
// Control UI and the custom shell must share one element class so loading both
// source trees never creates conflicting custom-element declarations.
export { OpenClawModalDialog } from "../../components/modal-dialog.ts";
import "../../components/modal-dialog.ts";
