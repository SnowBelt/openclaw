import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
/** Narrow PCC doctor checks and safe state repairs. */
import { readConfigFileSnapshot } from "../config/config.js";
import { CORE_HEALTH_CHECKS } from "../flows/doctor-core-checks.js";
import { runDoctorHealthRepairs } from "../flows/doctor-repair-flow.js";
import type { HealthCheck, HealthFinding } from "../flows/health-checks.js";
import type { RuntimeEnv } from "../runtime.js";

const PCC_DOCTOR_CHECK_IDS = new Set([
  "core/doctor/pcc-ledger-storage",
  "core/doctor/pcc-production-truth-bindings",
]);

export type PccDoctorMode = "check" | "fix";

export type PccDoctorReport = {
  ok: boolean;
  mode: PccDoctorMode;
  repaired: boolean;
  checksRun: number;
  findings: readonly HealthFinding[];
  remainingFindings: readonly HealthFinding[];
  changes: readonly string[];
  warnings: readonly string[];
};

function pccDoctorChecks(): readonly HealthCheck[] {
  return CORE_HEALTH_CHECKS.filter((check) => PCC_DOCTOR_CHECK_IDS.has(check.id));
}

/** Runs only PCC storage and proof-binding checks, never unrelated doctor repairs. */
export async function runPccDoctor(params: {
  mode: PccDoctorMode;
  runtime: RuntimeEnv;
}): Promise<PccDoctorReport> {
  const snapshot = await readConfigFileSnapshot({ observe: false });
  const cfg = snapshot.config;
  const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  const checks = pccDoctorChecks();
  const context = {
    runtime: params.runtime,
    cfg,
    cwd: workspaceDir,
    ...(snapshot.path !== undefined ? { configPath: snapshot.path } : {}),
  };

  if (params.mode === "check") {
    const findings = (
      await Promise.all(
        checks.map(async (check) => await check.detect({ ...context, mode: "lint" })),
      )
    ).flat();
    return {
      ok: findings.length === 0,
      mode: "check",
      repaired: false,
      checksRun: checks.length,
      findings,
      remainingFindings: findings,
      changes: [],
      warnings: [],
    };
  }

  const result = await runDoctorHealthRepairs({ ...context, mode: "fix" }, { checks });
  return {
    ok: result.remainingFindings.length === 0 && result.warnings.length === 0,
    mode: "fix",
    repaired: result.changes.length > 0,
    checksRun: result.checksRun,
    findings: result.findings,
    remainingFindings: result.remainingFindings,
    changes: result.changes,
    warnings: result.warnings,
  };
}
