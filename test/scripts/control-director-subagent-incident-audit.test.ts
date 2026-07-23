import { describe, expect, it } from "vitest";
import {
  auditControlDirectorSubagentIncident,
  CONTROL_DIRECTOR_SUBAGENT_INCIDENT_CODES,
  runControlDirectorSubagentIncidentBaseline,
} from "../../scripts/lib/control-director-subagent-incident-audit.js";

describe("Control Director subagent incident baseline", () => {
  it("reproduces every observed incident with one typed finding", () => {
    const result = runControlDirectorSubagentIncidentBaseline();

    expect(result).toMatchObject({
      passed: true,
      scenarioCount: CONTROL_DIRECTOR_SUBAGENT_INCIDENT_CODES.length,
      reproducedCount: CONTROL_DIRECTOR_SUBAGENT_INCIDENT_CODES.length,
    });
    expect(result.results.map((entry) => entry.expectedCode)).toEqual(
      CONTROL_DIRECTOR_SUBAGENT_INCIDENT_CODES,
    );
    expect(result.results.every((entry) => entry.detectedCodes.length === 1)).toBe(true);
  });

  it("does not flag the corresponding healthy contracts", () => {
    expect(
      auditControlDirectorSubagentIncident({
        scenarioId: "healthy-contract",
        runtime: "subagent",
        requestedCwd: "/private/tmp/project-worktree",
        forwardedCwd: "/private/tmp/project-worktree",
        requestedTaskPath: "/private/tmp/project-worktree/source",
        effectiveWorkspaceRoots: ["/private/tmp/project-worktree"],
        recommendedWorkerDiscoveryTool: "agents_list",
        effectiveTools: ["agents_list", "sessions_spawn"],
        requesterAgentId: "program-manager",
        requestedAgentId: "builder",
        requestedAgentIdWasExplicit: true,
        roleRequiresMutation: false,
        mutationCapabilityAllowed: false,
        completionClaimed: true,
        evidenceRefs: ["artifact:test-report"],
      }),
    ).toEqual([]);
  });

  it("treats sibling-prefix paths as outside the effective root", () => {
    const findings = auditControlDirectorSubagentIncident({
      scenarioId: "sibling-prefix",
      requestedTaskPath: "/private/tmp/project-worktree-other",
      effectiveWorkspaceRoots: ["/private/tmp/project-worktree"],
    });

    expect(findings.map((entry) => entry.code)).toEqual(["task_root_outside_effective_workspace"]);
  });

  it("does not leak raw task paths or secrets into findings", () => {
    const secret = "discord-secret-should-never-appear";
    const findings = auditControlDirectorSubagentIncident({
      scenarioId: "sanitized-output",
      runtime: "subagent",
      requestedCwd: `/private/tmp/${secret}`,
      requestedTaskPath: `/private/tmp/${secret}`,
      effectiveWorkspaceRoots: ["/safe/root"],
      completionClaimed: true,
      evidenceRefs: [],
    });

    expect(JSON.stringify(findings)).not.toContain(secret);
    expect(findings.every((entry) => entry.evidenceRefs.every((ref) => !ref.startsWith("/")))).toBe(
      true,
    );
  });
});
