---
summary: "Operate OpenClaw from one truthful, low-overhead view of agents, workflows, schedules, capabilities, models, and host resources."
read_when:
  - You need to see what OpenClaw is doing and what needs attention
  - You need to verify that scheduled or always-on work is healthy
  - You are adding an agent, workflow, skill, plugin, tool, model route, or runtime process
title: "Operations Room"
---

# Operations Room

The Operations Room is OpenClaw's deterministic operational control surface. It answers four
questions without invoking a model:

1. What is configured?
2. What is observed as active, idle, blocked, failed, disabled, or unknown?
3. Which host resources and local processes are under pressure?
4. Which operator-confirmed action is safe to take next?

It does not pretend that configured means running. It also does not invent per-agent RAM: agents
share the Gateway process, so the dashboard reports per-agent memory as unavailable unless a future
runtime supplies real attribution.

## Runtime policy

- The Gateway runs a 60-second, unref'd shadow monitor using local runtime facts only.
- The monitor never starts an agent, invokes an LLM, changes config, or kills a process.
- New findings are logged once on transition and remain visible in the dashboard snapshot.
- The browser refreshes the active Operations Room every 15 seconds while visible.
- Host process collection is bounded, omits command arguments, and returns only the 30 largest RSS
  rows.
- Host RAM uses Linux `MemAvailable` or macOS `memory_pressure` when available, then falls back to
  raw free memory. The dashboard shows both available and free RAM instead of treating reclaimable
  filesystem cache as unavailable.
- Catalogs are bounded and separate `configured`, `active`, and `unknown`.

Existing specialized supervisors remain authoritative: heartbeat owns always-on wakeups, cron owns
schedules, task registry maintenance owns stale task lifecycle, channel health owns channels, the
skill curator owns skill maintenance, and the Self-Improvement Governor owns recommendation
governance. The Operations Room observes those systems instead of creating competing loops.

## Guarded controls

The first release supports only:

- run, pause, or enable a cron job;
- cancel a managed task; and
- cancel a managed TaskFlow.

Every mutation requires `operator.write`, a short-lived single-use preview, an exact action/target
match, and an explicit browser confirmation. There is no automatic remediation. Process killing,
model starting, plugin installation, config editing, and permission changes stay in their owner
surfaces.

## Standard for future additions

Every new agent, workflow, skill, plugin, tool, model route, or process must declare:

- stable ID and owner;
- desired duty: always-on, scheduled, on-demand, or disabled;
- deterministic health signal and stale threshold;
- model route and fallback when applicable;
- permission and cost class;
- bounded failure/retry behavior;
- proof commands and observability surface;
- update impact and rollback path.

Register custom runtime additions in both `config/custom-runtime-capabilities.json` and
`src/pcc/capability-addition-registry.ts`. The preservation gates reject an update that silently
removes a required capability.

## Milestone and proof map

The implementation follows this order so low-reasoning workers can execute each boundary without
guessing:

| ID    | Milestone                | Required proof                                                              |
| ----- | ------------------------ | --------------------------------------------------------------------------- |
| OR-00 | Truth contract           | Schema and status-policy tests                                              |
| OR-01 | Desired-state inventory  | Agent duty and capability registry checks                                   |
| OR-02 | Telemetry model          | Bounded snapshot schema validation                                          |
| OR-03 | Local probes             | Process parser and resource tests                                           |
| OR-04 | Reconciliation receipts  | Shadow-monitor transition tests                                             |
| OR-05 | Dashboard shell          | Navigation and render tests                                                 |
| OR-06 | Agent room               | Activity, model, fallback, heartbeat, and unknown-RAM proof                 |
| OR-07 | Work inspector           | Active/recent task plus TaskFlow status and blocker rendering               |
| OR-08 | Scheduler                | Cron health and guarded controls                                            |
| OR-09 | Capability catalog       | Skills, plugins, and tools configured/active states                         |
| OR-10 | Model and cost routes    | Local/subscription/metered/unknown route labels                             |
| OR-11 | Resource view            | Host and bounded process RSS truth                                          |
| OR-12 | Reliability rules        | Memory, event-loop, task, flow, cron, plugin, and skill findings            |
| OR-13 | Notifications            | New-finding transition log and dashboard attention surface                  |
| OR-14 | Guarded controls         | Preview/apply authorization and replay rejection tests                      |
| OR-15 | Shadow reconciliation    | Non-overlapping 60-second monitor proof                                     |
| OR-16 | Bounded remediation      | Explicitly limited action allowlist proof                                   |
| OR-17 | Supervisor integration   | No duplicate ownership of heartbeat, cron, tasks, skills, or governor       |
| OR-18 | Future-addition standard | Capability contract and docs                                                |
| OR-19 | Update preservation      | Custom runtime capability checks                                            |
| OR-20 | Verification suite       | Targeted tests, typecheck, build, changed gate, desktop/mobile smoke        |
| OR-21 | Production promotion     | Immutable runtime, Gateway restart, browser, persistence, and soak receipts |

A milestone is complete only when its named proof passes. Source, runtime, browser, remote CI, and
persistence are separate evidence surfaces.
