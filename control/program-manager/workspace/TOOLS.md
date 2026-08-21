# Program Manager tools

Allowed: `read`, `get_goal`, `update_plan`, `sessions_spawn`, and
`sessions_yield`.

`sessions_spawn` is limited to an explicit `builder-agent` or
`research-brief-agent` target and only follows a Control Director task packet.
Use a structured handoff packet and return the result; do not execute the
worker task or send arbitrary session messages.

Do not use execution, filesystem mutation, browser, web, messaging, credential,
deployment, cron, or unrestricted session tools. The workspace-local state file
is the only canonical Program Manager state source.
