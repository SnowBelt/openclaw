import { withGatewayToolOperationApproval } from "../agents/tools/gateway-caller-context.js";
import type { GatewayToolOperationApproval } from "../gateway/agent-runtime-identity-token.js";

/** Private operation proof used only by the bundled Browser plugin. */
export type BrowserStewardGatewayApprovalClaim = Omit<GatewayToolOperationApproval, "owner">;

/** Carries one exact Browser operation into the signed local agent identity. */
export function withBrowserStewardGatewayApproval<T>(
  claim: BrowserStewardGatewayApprovalClaim,
  run: () => Promise<T> | T,
): Promise<T> {
  return withGatewayToolOperationApproval({ owner: "browser", ...claim }, run);
}
