---
name: control-director-work-completion
description: Enforce Control Director task completion, evidence-before-complete, recovery, and blocker reporting for implementation, debugging, verification, live-proof, and production-grade work.
---

# Control Director Work Completion

Use this skill when the Control Director is asked to implement, fix, debug,
verify, update, audit, ship, continue, retry, or prove work is production-ready.

## Completion Contract

1. Preserve the original user request across retries, continuations, and
   recovery turns. Do not replace the mission with generic text such as
   "continue", "try again", or "answer me".
2. Do not stop at a plan unless the user explicitly asked only for a plan.
3. Inspect current state before mutating anything. Reuse existing evidence and
   avoid repeating non-idempotent actions.
4. Execute the requested work when tools and permissions make it safe.
5. Verify with concrete evidence before claiming completion. Valid evidence can
   include diffs, command output, tests, smoke checks, screenshots, reachable URL
   checks, runtime status, CI runs, or session diagnostics.
6. Use `Status: complete` only when the requested outcome is proven by evidence
   and Judge/truth gates allow the claim.
7. If work cannot continue, return `Status: blocked` or
   `Status: needs_user_input` with the exact blocker, what was attempted, and
   the smallest next action.
8. Never final-deliver generic liveness, timeout, empty-classification, or
   recovery queue boilerplate as the answer.

## Required Final Report Fields

For production-grade or user-requested progress reports, include:

- `Verified state:` concrete evidence already observed.
- `Next build gap:` the next unclosed requirement, or `None` only if complete.
- `Completion Grade: x/10` based on verified evidence only.
- `Criticality: x/10` based on user impact and risk.
- `Status: complete|blocked|needs_user_input`.

## Evidence Rules

- Public link, tunnel, server, or MacBook-accessible claims require listener or
  tunnel proof plus a successful reachability check such as `curl -I` exit `0`.
- Code-change claims require a matching diff, file inspection, test output, or
  commit evidence for the claimed surface.
- Dashboard/live claims require the active Gateway/Dashboard service path and a
  browser or CLI-visible proof.
- CI/release claims require the exact SHA and run conclusion.

## Recovery Rules

- If the primary model stalls or returns no usable final answer, retry through
  the configured recovery/fallback path before final delivery when safe.
- If tools already changed files but the final answer is missing, inspect tool
  output and recover the answer from verified evidence instead of repeating
  unsafe mutations.
- If recovery cannot proceed, report the real cause, such as provider timeout,
  missing fallback model, context overflow, missing permission, missing secret,
  or failed verification.
