// SAFETY-RATCHET: template-aware
import fs from "node:fs/promises";
import type { OpenClawPluginSecurityAuditCollector } from "../api.js";
import { resolveRingerConfig, validateEnabledRingerConfig } from "./config.js";
import { findInvalidRunReceipts, RingerController } from "./controller.js";
import { sha256File } from "./crypto.js";
import { verifyPins } from "./pins.js";

export const collectRingerSecurityFindings: OpenClawPluginSecurityAuditCollector = async (
  context,
) => {
  const raw = context.sourceConfig.plugins?.entries?.ringer?.config;
  const config = resolveRingerConfig(raw, context.config, context.env);
  if (!config.enabled) {
    return [];
  }
  const findings = [];
  const configErrors = validateEnabledRingerConfig(config);
  if (configErrors.length > 0) {
    findings.push({
      checkId: "ringer.config.invalid",
      severity: "critical" as const,
      title: "Local AI Assist configuration is unsafe or incomplete",
      detail: configErrors.join(" "),
      remediation: "Keep productionEnabled=false and correct every reported field.",
    });
    return findings;
  }
  const pins = await verifyPins(config);
  if (!pins.ok) {
    findings.push({
      checkId: "ringer.pins.drift",
      severity: "critical" as const,
      title: "Local AI Assist exact pins have drifted",
      detail: pins.errors.join(" "),
      remediation:
        "Disable the plugin, audit the changed artifact, then update pins only with explicit approval.",
    });
  }
  try {
    const stat = await fs.lstat(config.stateDir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      findings.push({
        checkId: "ringer.state.permissions",
        severity: "critical" as const,
        title: "Local AI Assist state directory is not private",
        detail: `${config.stateDir} must be a non-symlink directory with mode 0700.`,
        remediation: "Stop Local AI Assist and repair ownership and permissions before reuse.",
      });
    }
  } catch {
    findings.push({
      checkId: "ringer.state.missing",
      severity: "warn" as const,
      title: "Local AI Assist state directory is unavailable",
      detail: `${config.stateDir} could not be inspected.`,
      remediation:
        "Start the Gateway service once with production routing disabled, then rerun the audit.",
    });
  }
  try {
    const cleanup = await new RingerController(config, context.config).inspectCleanupState();
    // SAFETY: RingerController.inspectCleanupState returns these fixed string-array fields.
    const orphaned = cleanup.orphanedRunIds as string[];
    // SAFETY: RingerController.inspectCleanupState returns these fixed string-array fields.
    const processLeaks = cleanup.terminalProcessLeaks as string[];
    // SAFETY: RingerController.inspectCleanupState returns these fixed string-array fields.
    const unverifiedActive = cleanup.unverifiedActiveProcessIds as string[];
    // SAFETY: RingerController.inspectCleanupState returns these fixed string-array fields.
    const staleWorktrees = cleanup.staleWorktrees as string[];
    // SAFETY: RingerController.inspectCleanupState returns these fixed string-array fields.
    const taskContainerLeaks = cleanup.taskContainerLeaks as string[];
    if (
      orphaned.length > 0 ||
      processLeaks.length > 0 ||
      unverifiedActive.length > 0 ||
      staleWorktrees.length > 0 ||
      taskContainerLeaks.length > 0
    ) {
      findings.push({
        checkId: "ringer.lifecycle.leaks",
        severity: "critical" as const,
        title: "Local AI Assist lifecycle reconciliation is incomplete",
        detail: `${orphaned.length} orphaned active receipt(s), ${unverifiedActive.length} unverified active process(es), ${processLeaks.length} terminal process leak(s), ${staleWorktrees.length} stale worktree(s), and ${taskContainerLeaks.length} task container leak(s) were found.`,
        remediation:
          "Disable production routing, restart the supervisor, and reconcile or cancel each retained run.",
      });
    }
  } catch (error) {
    findings.push({
      checkId: "ringer.lifecycle.audit_failed",
      severity: "warn" as const,
      title: "Local AI Assist lifecycle state could not be audited",
      detail: error instanceof Error ? error.message : String(error),
      remediation:
        "Keep production routing disabled until snapshot and security audit both complete.",
    });
  }
  if (config.productionEnabled) {
    const unapproved = config.allowedRepositories.flatMap((repo) =>
      repo.models.filter((model) => !model.canaryApproved).map((model) => model.ref),
    );
    if (unapproved.length > 0) {
      findings.push({
        checkId: "ringer.production.unqualified_models",
        severity: "critical" as const,
        title: "Local AI Assist production routing includes unqualified models",
        detail: `Not live-canary approved: ${[...new Set(unapproved)].toSorted().join(", ")}.`,
        remediation: "Set productionEnabled=false until qualification receipts are current.",
      });
    }
    try {
      const qualificationPath = config.qualificationReceiptPath!;
      const stat = await fs.lstat(qualificationPath);
      const digest = await sha256File(qualificationPath);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0 ||
        digest !== config.expectedQualificationReceiptSha256
      ) {
        throw new Error("permission, file type, or digest mismatch");
      }
    } catch (error) {
      findings.push({
        checkId: "ringer.production.qualification_drift",
        severity: "critical" as const,
        title: "Local AI Assist qualification receipt is unavailable or drifted",
        detail: error instanceof Error ? error.message : String(error),
        remediation:
          "Disable production routing and regenerate owner-reviewed qualification evidence.",
      });
    }
  }
  try {
    for (const name of await findInvalidRunReceipts(config)) {
      findings.push({
        checkId: "ringer.receipt.corrupt",
        severity: "critical" as const,
        title: "Local AI Assist has a corrupt or forged run receipt",
        detail: `Invalid receipt: ${name}.`,
        remediation: "Disable production routing and reconcile the affected run from its raw logs.",
      });
    }
  } catch {
    // No receipts exist yet.
  }
  return findings;
};
