import type {
  ReleaseGovernorPolicy,
  ReleaseHealthDecision,
  ReleaseHealthSample,
  ReleaseProofProfile,
} from "./contracts.js";

export function evaluateReleaseHealth(
  sample: ReleaseHealthSample,
  policy: ReleaseGovernorPolicy,
  proofProfile: ReleaseProofProfile = "standard",
): ReleaseHealthDecision {
  const blockers: string[] = [];
  if (!sample.gatewayConnected) {
    blockers.push("Gateway connectivity failed.");
  }
  for (const route of sample.routes) {
    if (route.status !== 200) {
      blockers.push(`Required route ${route.path} returned HTTP ${route.status}.`);
    }
    if (route.latencyMs > policy.healthThresholds.maxRouteLatencyMs) {
      blockers.push(
        `Required route ${route.path} exceeded ${policy.healthThresholds.maxRouteLatencyMs} ms latency.`,
      );
    }
  }
  if (sample.errorRate > policy.healthThresholds.maxErrorRate) {
    blockers.push(
      `Error rate ${sample.errorRate} exceeded ${policy.healthThresholds.maxErrorRate}.`,
    );
  }
  if (sample.startupFailures > policy.healthThresholds.maxStartupFailures) {
    blockers.push(`${sample.startupFailures} startup failure(s) exceeded the allowed threshold.`);
  }
  if (sample.missingCapabilities.length > 0) {
    blockers.push(
      `Required capabilities are unavailable: ${sample.missingCapabilities.join(", ")}.`,
    );
  }
  const browserErrors =
    proofProfile === "mac_studio_control_director"
      ? sample.desktopBrowserErrors
      : sample.desktopBrowserErrors + sample.mobileBrowserErrors;
  if (browserErrors > policy.healthThresholds.maxBrowserErrors) {
    blockers.push(
      proofProfile === "mac_studio_control_director"
        ? `${browserErrors} Control Director browser error(s) were observed.`
        : `${browserErrors} desktop/mobile browser error(s) were observed.`,
    );
  }
  if (!sample.activeRunsReconciled) {
    blockers.push("Active-run completion reconciliation failed.");
  }
  if (sample.serviceWorkerIntegrity === "failed") {
    blockers.push("Service-worker/PWA integrity failed.");
  }
  return {
    passed: blockers.length === 0,
    deterministicRollbackTrigger: blockers.length > 0,
    blockers,
  };
}
