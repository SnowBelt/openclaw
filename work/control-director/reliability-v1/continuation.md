# Control Director Reliability V1 Continuation

## Verified baseline

- Clean worktree: `codex/control-director-codex-chat-v1-20260718`
- Source SHA: `a9a72db96dc2deb4dffb7ba240ede33e03b48839`
- Runtime version represented by that source: `2026.7.1`
- Dirty root checkout is excluded from implementation and validation.
- Locked dependencies installed successfully in the clean worktree.

## Completion policy

`roadmap.json` is authoritative. A milestone is complete only when its status is `passed` and its evidence identifies current source plus every applicable test, build, runtime, desktop, tablet, mobile, persistence, restart, soak, and rollback proof surface.

Partial source implementation must remain `in_progress` or `blocked`. Do not infer completion from a plan, source-string readiness check, mock-only test, screenshot, stale receipt, or prior runtime.

## Current state

- Passed: 0/61
- In progress: M01
- Pending: M02-M61
- Weighted completion: 0%

## Next dependency-ready work

1. Implement M01 exact-runtime baseline and dirty-checkout protection.
2. Implement M04 canonical identity/model registry.
3. Implement M45 active contract wiring gate.
4. Implement M46 proportional response contracts.
5. Implement M47 immutable mission envelope.
6. Implement M61 customization update-survival acceptance after M44, M45, and M60 evidence is available.

## Prohibited completion shortcuts

- Do not run validation from the dirty root checkout.
- Do not mark a managed Task Flow `running` without a live controller lease.
- Do not treat deterministic text matching as an independent Judge verdict.
- Do not infer PCC state from ordinary assistant prose.
- Do not use a mock GPT identity as proof for the managed Gemma Control Director.
- Do not claim live or Dashboard completion until the exact promoted SHA is exercised there.
