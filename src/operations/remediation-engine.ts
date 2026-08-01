/**
 * Stable compatibility facade for Operations Room remediation.
 *
 * Domain contracts, policy, recommendation review, and repair execution live
 * under ./remediation so consumers do not depend on infrastructure details.
 */
export type {
  OperationsRemediationAiReview,
  OperationsRemediationStore,
  OperationsRepairDomain,
  OperationsRepairRecipe,
  OperationsRepairVerification,
} from "./remediation/contracts.js";
export {
  applyConfirmedOperationsRemediation,
  investigateOperationsRemediation,
  recoverInterruptedOperationsRemediations,
  runOperationsRemediationSweep,
} from "./remediation/service.js";
