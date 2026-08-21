#!/usr/bin/env python3
"""Apply or remove the managed Control Director role/capability contract."""

import copy
import datetime
import json
import os
import shutil
import stat
import sys
from pathlib import Path


HOME = Path.home()
CONFIG = Path(
    os.environ.get(
        "OPENCLAW_CONFIG_PATH", str(HOME / ".openclaw" / "openclaw.director.json")
    )
)
RUNTIME_HOME = Path(
    os.environ.get(
        "OPENCLAW_ROLE_RUNTIME_HOME", str(HOME / ".openclaw-custom-runtime")
    )
)
STATE = Path(
    os.environ.get(
        "OPENCLAW_ROLE_STATE_PATH",
        str(RUNTIME_HOME / "control-director-role-config-state.json"),
    )
)
WORKER_IDS = (
    "automation-playbook-architect",
    "builder-agent",
    "engineering-spec-writer",
    "market-research-analyst",
    "memory-knowledge-curator",
    "qa-test-agent",
    "research-brief-agent",
    "support-incident-response-agent",
    "telemetry-evaluation-analyst",
)
ROLES = {
    "main": "control_director",
    "program-manager": "program_manager",
    "judge": "judge",
    **{agent_id: "worker" for agent_id in WORKER_IDS},
}
READ_EVIDENCE_TOOLS = (
    "read",
    "memory_search",
    "memory_get",
    "sessions_list",
    "sessions_history",
    "get_goal",
)
PROGRAM_MANAGER_TOOLS = (
    *READ_EVIDENCE_TOOLS,
    "agents_list",
    "sessions_spawn",
    "sessions_yield",
    "subagents",
    "update_plan",
    "update_goal",
)
JUDGE_FORBIDDEN_TOOLS = (
    "create_goal",
    "update_goal",
    "update_plan",
    "sessions_spawn",
    "sessions_send",
    "sessions_yield",
    "subagents",
)


def fail(message: str) -> None:
    raise SystemExit(message)


def read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        fail(f"{path} must contain a JSON object")
    return value


def write_atomic(path: Path, value: dict, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.roles-{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, mode)
    os.replace(temporary, path)
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def required_agents(config: dict) -> dict[str, dict]:
    agents = config.get("agents", {}).get("list")
    if not isinstance(agents, list):
        fail("agents.list is unavailable")
    by_id: dict[str, dict] = {}
    for agent in agents:
        if isinstance(agent, dict) and agent.get("id") in ROLES:
            agent_id = agent["id"]
            if agent_id in by_id:
                fail(f"duplicate required agent: {agent_id}")
            by_id[agent_id] = agent
    missing = sorted(set(ROLES) - set(by_id))
    if missing:
        fail("missing required agents: " + ", ".join(missing))
    return by_id


def capture_controlled(config: dict) -> dict:
    by_id = required_agents(config)
    defaults = config.get("agents", {}).get("defaults", {})
    return {
        "defaultsSubagents": copy.deepcopy(defaults.get("subagents")),
        "agents": {
            agent_id: {
                "rolePresent": "role" in agent,
                "role": copy.deepcopy(agent.get("role")),
                "subagentsPresent": "subagents" in agent,
                "subagents": copy.deepcopy(agent.get("subagents")),
                "toolsPresent": "tools" in agent,
                "tools": copy.deepcopy(agent.get("tools")),
            }
            for agent_id, agent in by_id.items()
            if agent_id in {"main", "program-manager", "judge"}
        }
        | {
            agent_id: {
                "rolePresent": "role" in by_id[agent_id],
                "role": copy.deepcopy(by_id[agent_id].get("role")),
            }
            for agent_id in WORKER_IDS
        },
    }


def restore_field(target: dict, key: str, present: bool, value: object) -> None:
    if present:
        target[key] = copy.deepcopy(value)
    else:
        target.pop(key, None)


def restore_controlled(config: dict, baseline: dict) -> None:
    by_id = required_agents(config)
    agents_config = config.setdefault("agents", {})
    defaults = agents_config.setdefault("defaults", {})
    if baseline.get("defaultsSubagents") is None:
        defaults.pop("subagents", None)
    else:
        defaults["subagents"] = copy.deepcopy(baseline["defaultsSubagents"])
    for agent_id, saved in baseline["agents"].items():
        agent = by_id[agent_id]
        restore_field(agent, "role", saved["rolePresent"], saved.get("role"))
        if agent_id in {"main", "program-manager", "judge"}:
            restore_field(
                agent,
                "subagents",
                saved["subagentsPresent"],
                saved.get("subagents"),
            )
            restore_field(agent, "tools", saved["toolsPresent"], saved.get("tools"))


def sorted_union(values: list[str], additions: tuple[str, ...]) -> list[str]:
    return sorted({value for value in [*values, *additions] if isinstance(value, str)})


def apply_contract(config: dict, *, allow_role_replacement: bool = False) -> None:
    by_id = required_agents(config)
    agents_config = config.setdefault("agents", {})
    defaults = agents_config.setdefault("defaults", {})
    default_subagents = defaults.setdefault("subagents", {})
    if not isinstance(default_subagents, dict):
        fail("agents.defaults.subagents must be an object")
    default_subagents.update(
        {
            "announceTimeoutMs": 120000,
            "maxChildrenPerAgent": 5,
            "maxConcurrent": 8,
            "maxSpawnDepth": 2,
            "runTimeoutSeconds": 900,
        }
    )

    for agent_id, expected in ROLES.items():
        current = by_id[agent_id].get("role")
        if not allow_role_replacement and current not in (None, expected):
            fail(f"unexpected role for {agent_id}: {current!r}")
        by_id[agent_id]["role"] = expected

    by_id["main"]["subagents"] = {
        "allowAgents": ["program-manager"],
        "delegationMode": "prefer",
        "requireAgentId": True,
    }
    by_id["program-manager"]["subagents"] = {
        "allowAgents": list(WORKER_IDS),
        "delegationMode": "prefer",
        "requireAgentId": True,
    }

    program_manager_tools = copy.deepcopy(by_id["program-manager"].get("tools") or {})
    if not isinstance(program_manager_tools, dict):
        fail("program-manager tools must be an object")
    program_manager_tools["profile"] = "minimal"
    program_manager_tools["alsoAllow"] = list(PROGRAM_MANAGER_TOOLS)
    program_manager_deny = [
        tool
        for tool in program_manager_tools.get("deny", [])
        if tool not in PROGRAM_MANAGER_TOOLS
    ]
    program_manager_tools["deny"] = sorted_union(program_manager_deny, ("sessions_send",))
    by_id["program-manager"]["tools"] = program_manager_tools

    judge_tools = copy.deepcopy(by_id["judge"].get("tools") or {})
    if not isinstance(judge_tools, dict):
        fail("judge tools must be an object")
    judge_tools["profile"] = "minimal"
    judge_tools["alsoAllow"] = list(READ_EVIDENCE_TOOLS)
    judge_deny = [
        tool for tool in judge_tools.get("deny", []) if tool not in READ_EVIDENCE_TOOLS
    ]
    judge_tools["deny"] = sorted_union(judge_deny, JUDGE_FORBIDDEN_TOOLS)
    by_id["judge"]["tools"] = judge_tools


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"apply", "remove", "reconcile"}:
        fail("usage: control-director-role-config.py apply|remove|reconcile")
    action = sys.argv[1]
    mode = stat.S_IMODE(CONFIG.stat().st_mode)
    config = read_json(CONFIG)
    required_agents(config)

    state = read_json(STATE) if STATE.exists() else None
    if state is not None and state.get("version") != 1:
        fail("unsupported role config state version")
    current = capture_controlled(config)
    if (
        action != "reconcile"
        and state is not None
        and current not in (state.get("baseline"), state.get("applied"))
    ):
        fail("controlled role configuration changed outside this helper; refusing to overwrite")

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    backup_dir = Path(
        os.environ.get(
            "OPENCLAW_ROLE_BACKUP_DIR",
            str(RUNTIME_HOME / "backups"),
        )
    )
    backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = backup_dir / f"openclaw.director.roles-{action}-{stamp}.json"
    shutil.copy2(CONFIG, backup)
    state_backup = None

    if action == "apply":
        baseline = state["baseline"] if state is not None else current
        apply_contract(config)
        next_state = {
            "version": 1,
            "baseline": baseline,
            "applied": capture_controlled(config),
        }
        write_atomic(STATE, next_state, 0o600)
    elif action == "reconcile":
        if state is None:
            fail("role config state is unavailable; reconcile requires an existing state")
        if current in (state.get("baseline"), state.get("applied")):
            fail("reconcile requires controlled role configuration drift")
        state_backup = backup_dir / f"control-director-role-config-state-{action}-{stamp}.json"
        shutil.copy2(STATE, state_backup)
        apply_contract(config, allow_role_replacement=True)
        next_state = {
            "version": 1,
            "baseline": current,
            "applied": capture_controlled(config),
        }
        write_atomic(STATE, next_state, 0o600)
    else:
        if state is None:
            fail("role config state is unavailable; refusing a lossy remove")
        restore_controlled(config, state["baseline"])

    write_atomic(CONFIG, config, mode)
    by_id = required_agents(config)
    print(
        json.dumps(
            {
                "action": action,
                "backup": str(backup),
                "roles": {
                    agent_id: by_id[agent_id].get("role")
                    for agent_id in sorted(ROLES)
                },
                "programManagerWorkers": list(WORKER_IDS),
                "state": str(STATE),
                "stateBackup": str(state_backup) if state_backup is not None else None,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
