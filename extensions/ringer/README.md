# Local AI Assist

This bundled plugin provides the operator-only execution plane for proof-gated
local agent swarms. It registers `openclaw ringer`, four scoped Gateway methods,
a supervisor service, and a security-audit collector. It intentionally registers
no agent tools, hooks, prompt additions, channels, or model routes.

The plugin is disabled by default. Setup, policy, manifest, qualification, and
rollback instructions are documented at
[docs.openclaw.ai/plugins/ringer](https://docs.openclaw.ai/plugins/ringer).

See [THIRD_PARTY.md](./THIRD_PARTY.md) for the exact unvendored Ringer source and
license notice.
