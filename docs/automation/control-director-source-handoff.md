---
summary: "Finish an exact Operations Room source handoff without repeating unsafe GitHub or runtime actions."
read_when:
  - A verified Operations Room branch must be pushed or attached to a draft pull request
  - A source handoff stopped on an exact SHA, branch, remote, or pull-request identity mismatch
  - You need a machine-readable handoff receipt for a later Control Director turn
title: "Control Director source handoff"
---

# Control Director source handoff

The source handoff is a small, deterministic workflow for moving a locally verified Operations
Room candidate to the approved GitHub destination. It is intentionally separate from the managed
Gateway: it never changes runtime state, starts a release, restarts a Gateway, merges a pull
request, or substitutes for Mac Studio proof.

The policy in
`work/control-director/reliability-v1/source-handoff-policy.json` is the source of truth for the
canonical push remote, pull-request repository, base branch, draft-only mode, and local-only proof
mode. A destination approval is a literal match for the policy URL; a GitHub login or a remembered
remote is not treated as approval.

## One bounded workflow

Run preflight first. It is read-only and records the exact source identity:

```sh
pnpm control-director:source-handoff -- preflight \
  --sha <exact-40-character-sha> \
  --branch <codex/branch>
```

When preflight reports `ready_local`, the single finishing action is:

```sh
pnpm control-director:source-handoff -- finish \
  --sha <exact-40-character-sha> \
  --branch <codex/branch> \
  --approve-destination https://github.com/SnowBelt/openclaw.git
```

`finish` first repeats preflight, then pushes the exact branch, rechecks the exact SHA and clean
checkout, and finds or creates one draft pull request targeting `main`. It is idempotent when the
existing pull request has the same branch, SHA, base, open state, and draft state. It refuses to
edit or replace a mismatched, closed, ready-for-review, or ambiguous pull request.

Use `status` to inspect the same source and draft-PR identity without pushing:

```sh
pnpm control-director:source-handoff -- status \
  --sha <exact-40-character-sha> \
  --branch <codex/branch>
```

Every invocation writes a private, ignored receipt under
`.artifacts/control-director/source-handoff/<sha>-<operation>.json`. The receipt records the
schema, exact source SHA, branch, clean-worktree result, canonical destination, checks, blocker
codes, commands, pull-request identity, and the next valid action. Command output and credentials
are not copied into the receipt.

## Fail-closed states

- `ready_local`: exact SHA, branch, clean worktree, isolated root, and canonical remote are proven;
  no external mutation has occurred.
- `destination_approval_required`: `finish` stopped before push because the literal destination
  approval was missing or did not match policy.
- `pushing`: a finish receipt records the bounded push step while it is being attempted.
- `pushed`: reserved for receipts that record a successful push before pull-request reconciliation.
- `draft_pr_ready`: the exact branch and draft pull request were verified together.
- `blocked`: a source, GitHub, or pull-request identity check failed. The receipt names the exact
  blocker and does not invite blind retries.

If a push succeeds but pull-request visibility or identity cannot be verified, the branch is
preserved and the receipt tells the operator to reconcile it. The workflow never force-pushes,
closes, rewrites, merges, or creates a second PR to hide an uncertain result.

## Proof boundary

Use `pnpm operations-room:verify`, the selected changed lanes, DOM smoke, browser proof, and the
other local Control Director gates before `finish`. GitHub is only a destination for a verified
source handoff. Hosted CI, Blacksmith, Crabbox, remote runners, production promotion, and human
acceptance remain separate approvals and proof surfaces.
