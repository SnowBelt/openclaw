import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const workerIds = [
  "automation-playbook-architect",
  "builder-agent",
  "engineering-spec-writer",
  "market-research-analyst",
  "memory-knowledge-curator",
  "qa-test-agent",
  "research-brief-agent",
  "support-incident-response-agent",
  "telemetry-evaluation-analyst",
];
const requiredIds = ["main", "program-manager", "judge", ...workerIds];

type JsonRecord = Record<string, unknown>;

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-role-config-"));
  roots.push(root);
  const configPath = path.join(root, "openclaw.director.json");
  const runtimeHome = path.join(root, "runtime");
  const statePath = path.join(runtimeHome, "role-state.json");
  const backupDir = path.join(runtimeHome, "backups");
  const baseline = {
    agents: {
      defaults: { subagents: { maxConcurrent: 3, customBaselineValue: true } },
      list: requiredIds.map((id) => {
        const agent: JsonRecord = { id };
        if (id === "program-manager") {
          agent.tools = { profile: "full", allow: ["write"], deny: ["browser", "get_goal"] };
        } else if (id === "judge") {
          agent.tools = { profile: "full", allow: ["write"], deny: ["memory_search", "write"] };
        }
        return agent;
      }),
    },
    ui: { theme: "system" },
  };
  mkdirSync(runtimeHome, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(baseline, null, 2)}\n`);
  chmodSync(configPath, 0o640);
  return { backupDir, baseline, configPath, root, runtimeHome, statePath };
}

function runRoleConfig(
  input: ReturnType<typeof fixture>,
  action: "apply" | "remove" | "reconcile",
) {
  return spawnSync(
    "python3",
    [
      path.join(process.cwd(), "scripts", "custom-runtime", "control-director-role-config.py"),
      action,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: input.configPath,
        OPENCLAW_ROLE_BACKUP_DIR: input.backupDir,
        OPENCLAW_ROLE_RUNTIME_HOME: input.runtimeHome,
        OPENCLAW_ROLE_STATE_PATH: input.statePath,
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );
}

function readConfig(input: ReturnType<typeof fixture>): JsonRecord {
  return JSON.parse(readFileSync(input.configPath, "utf8")) as JsonRecord;
}

function agentsById(config: JsonRecord): Map<string, JsonRecord> {
  const agents = config.agents as { list: JsonRecord[] };
  return new Map(agents.list.map((agent) => [String(agent.id), agent]));
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Control Director managed role configuration", () => {
  it("applies the least-privilege role graph atomically and idempotently", () => {
    const input = fixture();
    const first = runRoleConfig(input, "apply");

    expect(first.status, first.stderr).toBe(0);
    const firstConfig = readConfig(input);
    const byId = agentsById(firstConfig);
    expect(byId.get("main")?.role).toBe("control_director");
    expect(byId.get("program-manager")?.role).toBe("program_manager");
    expect(byId.get("judge")?.role).toBe("judge");
    for (const workerId of workerIds) {
      expect(byId.get(workerId)?.role).toBe("worker");
    }
    expect(byId.get("main")?.subagents).toEqual({
      allowAgents: ["program-manager"],
      delegationMode: "prefer",
      requireAgentId: true,
    });
    expect(byId.get("program-manager")?.subagents).toEqual({
      allowAgents: workerIds,
      delegationMode: "prefer",
      requireAgentId: true,
    });

    const programManagerTools = byId.get("program-manager")?.tools as {
      profile: string;
      alsoAllow: string[];
      deny: string[];
    };
    expect(programManagerTools.profile).toBe("minimal");
    expect((programManagerTools as JsonRecord).allow).toBeUndefined();
    expect(programManagerTools.alsoAllow).toEqual(
      expect.arrayContaining([
        "agents_list",
        "sessions_spawn",
        "sessions_yield",
        "subagents",
        "update_plan",
        "update_goal",
        "get_goal",
      ]),
    );
    expect(programManagerTools.deny).toEqual(["browser", "sessions_send"]);

    const judgeTools = byId.get("judge")?.tools as {
      profile: string;
      alsoAllow: string[];
      deny: string[];
    };
    expect(judgeTools.profile).toBe("minimal");
    expect((judgeTools as JsonRecord).allow).toBeUndefined();
    expect(judgeTools.alsoAllow).toEqual(
      expect.arrayContaining(["read", "memory_search", "sessions_history", "get_goal"]),
    );
    expect(judgeTools.deny).toEqual(
      expect.arrayContaining([
        "create_goal",
        "sessions_spawn",
        "sessions_send",
        "update_goal",
        "write",
      ]),
    );

    const defaults = (firstConfig.agents as { defaults: JsonRecord }).defaults;
    expect(defaults.subagents).toEqual({
      announceTimeoutMs: 120_000,
      customBaselineValue: true,
      maxChildrenPerAgent: 5,
      maxConcurrent: 8,
      maxSpawnDepth: 2,
      runTimeoutSeconds: 900,
    });
    expect(statSync(input.configPath).mode & 0o777).toBe(0o640);
    expect(statSync(input.statePath).mode & 0o777).toBe(0o600);
    expect(readdirSync(input.backupDir)).toHaveLength(1);

    const second = runRoleConfig(input, "apply");
    expect(second.status, second.stderr).toBe(0);
    expect(readConfig(input)).toEqual(firstConfig);
    expect(readdirSync(input.backupDir)).toHaveLength(2);
  });

  it("removes only controlled fields and preserves unrelated edits", () => {
    const input = fixture();
    expect(runRoleConfig(input, "apply").status).toBe(0);
    const applied = readConfig(input);
    (applied.ui as JsonRecord).theme = "dark";
    writeFileSync(input.configPath, `${JSON.stringify(applied, null, 2)}\n`);

    const removed = runRoleConfig(input, "remove");

    expect(removed.status, removed.stderr).toBe(0);
    const restored = readConfig(input);
    expect(restored.agents).toEqual(input.baseline.agents);
    expect(restored.ui).toEqual({ theme: "dark" });
    expect(readdirSync(input.backupDir)).toHaveLength(2);
  });

  it("refuses a lossy remove when no baseline state exists", () => {
    const input = fixture();
    const before = readFileSync(input.configPath, "utf8");

    const result = runRoleConfig(input, "remove");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("role config state is unavailable");
    expect(readFileSync(input.configPath, "utf8")).toBe(before);
  });

  it("refuses to overwrite an out-of-band controlled-field change", () => {
    const input = fixture();
    expect(runRoleConfig(input, "apply").status).toBe(0);
    const changed = readConfig(input);
    const byId = agentsById(changed);
    byId.get("program-manager")!.role = "worker";
    writeFileSync(input.configPath, `${JSON.stringify(changed, null, 2)}\n`);
    const before = readFileSync(input.configPath, "utf8");

    const result = runRoleConfig(input, "apply");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("changed outside this helper");
    expect(readFileSync(input.configPath, "utf8")).toBe(before);
  });

  it("reconciles explicit controlled drift without losing the rollback baseline", () => {
    const input = fixture();
    expect(runRoleConfig(input, "apply").status).toBe(0);
    const drifted = readConfig(input);
    const byId = agentsById(drifted);
    byId.get("program-manager")!.role = "worker";
    byId.get("program-manager")!.subagents = {
      allowAgents: ["builder-agent"],
      delegationMode: "suggest",
      requireAgentId: true,
    };
    writeFileSync(input.configPath, `${JSON.stringify(drifted, null, 2)}\n`);

    const reconciled = runRoleConfig(input, "reconcile");

    expect(reconciled.status, reconciled.stderr).toBe(0);
    const repaired = readConfig(input);
    expect(agentsById(repaired).get("program-manager")?.role).toBe("program_manager");
    expect(agentsById(repaired).get("program-manager")?.subagents).toEqual({
      allowAgents: workerIds,
      delegationMode: "prefer",
      requireAgentId: true,
    });
    expect(reconciled.stdout).toContain("stateBackup");

    const removed = runRoleConfig(input, "remove");
    expect(removed.status, removed.stderr).toBe(0);
    const restored = agentsById(readConfig(input)).get("program-manager");
    expect(restored?.role).toBe("worker");
    expect(restored?.subagents).toEqual({
      allowAgents: ["builder-agent"],
      delegationMode: "suggest",
      requireAgentId: true,
    });
  });
});
