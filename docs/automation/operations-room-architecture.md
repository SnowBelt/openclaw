---
summary: "Clean architecture boundaries for Operations Room remediation and Control Director source handoff."
read_when:
  - You are changing Operations Room repair policy, execution, verification, or rollback
  - You are changing Control Director source handoff, Git identity checks, or draft pull request handling
title: "Operations Room architecture"
---

# Operations Room architecture

The Operations Room keeps safety policy, application orchestration, infrastructure adapters, and
delivery entry points separate. Public compatibility files remain stable so existing Gateway,
monitor, test, and package consumers do not need to know how the implementation is organized.

## Folder structure

```text
src/operations/
├── remediation-engine.ts          # stable public compatibility facade
└── remediation/
    ├── contracts.ts               # domain ports and immutable recipe contracts
    ├── policy.ts                  # automatic-repair eligibility rules
    ├── records.ts                 # remediation receipt construction and transitions
    ├── recommendation.ts          # local investigation and Judge-reviewed advice
    ├── execution.ts               # apply, verify, rollback, and rollback verification
    ├── service.ts                 # application use cases and sweep orchestration
    └── text.ts                    # bounded, redacted persistence helpers

scripts/
├── control-director-source-handoff.mjs  # stable command and import facade
└── control-director-source-handoff/
    ├── shared.mjs                 # identities and validation primitives
    ├── policy.mjs                 # destination policy validation
    ├── command.mjs                # subprocess port adapter
    ├── git-state.mjs              # local source identity adapter
    ├── preflight.mjs              # pure source/destination readiness evaluation
    ├── github.mjs                 # exact draft pull request adapter
    ├── workflow.mjs               # source-handoff application workflow
    └── cli.mjs                    # arguments and atomic private receipts
```

## Dependency direction

The remediation domain contracts do not import Gateway, cron, model, filesystem, or process
implementations. Recipes supply those capabilities through typed functions. Policy evaluates a
recipe without performing a mutation. The application service selects one unambiguous recipe and
delegates mutation to the execution service. Execution owns the apply, authoritative read-back,
rollback, and rollback read-back sequence. Recommendation generation cannot bypass the recipe or
execution boundaries.

The source-handoff command follows the same direction. Shared identity rules and policy validation
are independent of Git and GitHub. Preflight evaluates a supplied Git state. The workflow receives a
command runner port, coordinates Git and GitHub adapters, and returns a receipt. Only the CLI reads
arguments and writes the private atomic receipt. The top-level script is intentionally a thin stable
facade.

## Behavioral compatibility

- Existing imports from `src/operations/remediation-engine.ts` remain valid.
- Existing imports and the package command for `scripts/control-director-source-handoff.mjs` remain
  valid.
- Repair eligibility, confirmation, execution, verification, rollback, interruption recovery, and
  advisory-only failure behavior retain their existing contracts.
- Source handoff still requires a clean exact SHA, the expected branch and worktree, the canonical
  remote, and literal destination approval before mutation.
- Draft pull request discovery uses the repository-local branch name and then validates the exact
  branch, SHA, base, open state, and draft state. This avoids coupling PR discovery to a GitHub owner
  alias that may redirect while preserving the stricter exact-source validation.

## Change rules

New risk policy belongs in `remediation/policy.ts`. New repair behavior belongs in a recipe, not the
application service. New execution states require the remediation record contract and transition
tests to change together. New source-host providers should implement a separate infrastructure
adapter rather than adding provider conditionals to the workflow. Delivery surfaces may depend on
application services; application services must not depend on a CLI, UI, or concrete model process.
