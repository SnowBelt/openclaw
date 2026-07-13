---
summary: "Evidence-bound PCC learning candidates that remain recommendation-only until reviewed and proven"
read_when:
  - You are reviewing a PCC learning candidate
  - You need to understand PCC learning evidence, expiry, or promotion gates
title: "PCC Learning Loop"
sidebarTitle: "PCC Learning Loop"
---

The PCC learning loop turns finalized, sanitized PCC receipts, proof, and decisions into bounded recommendation candidates. It is a helper contract, not an automation authority.

## Source Of Truth

The PCC receipt, passed proof evidence, and finalized decision are the source of truth. A candidate records only their project ID, revision, receipt ID, decision ID, evidence IDs, and a bounded sanitized content summary. Its deterministic fingerprint deduplicates the same evidence-backed recommendation.

Candidates reject raw output, missing proof IDs, stale revisions, oversized summaries, and secret-like content. A candidate never stores an executor transcript, prompt, credential, or raw model response.

Canonical candidates are stored as a bounded, deduplicated list in project metadata under `pccLearningCandidates`. Malformed records are ignored, newer records win by fingerprint, and the list is capped at 100 entries. Saving a candidate cannot approve, trial, promote, or execute it.

## Lifecycle

Candidates begin as `proposed`. A reviewer can move them through:

```text
proposed -> approved -> trial -> promoted
```

At the appropriate review point, a candidate can instead become `rejected`, `superseded`, or `expired`. Terminal candidates cannot restart. An active candidate expires at its recorded expiry time and cannot advance.

## Promotion Evidence

Promotion requires before-and-after metrics for every required measure:

- `speed`
- `accuracy`
- `efficiency`
- `first_pass_quality`
- `overall_quality`

Each after metric must be from `0` through `100`, score at least `93`, and not regress from its baseline. Missing metrics, a score below `93`, or any regression blocks promotion.

## Safety Boundary

The learning bridge only creates candidates and validates lifecycle transitions. It does not edit skills, configuration, source code, documentation, or PCC records. It also does not recursively learn from learning candidates, lifecycle bookkeeping, or its own recommendations; every candidate starts from new finalized PCC receipt, proof, and decision evidence.

The PCC dashboard exposes a read-only summary of saved candidates. It has no apply button and no hidden automation path. Execution-team behavior is documented separately in [PCC Execution Teams](/automation/pcc-execution-teams).

## Canonical Documentation

Keep this page as the canonical PCC learning-loop contract, including when a
Self-Improvement Governor recommendation is routed into PCC. Other pages may
link here, but should not duplicate lifecycle rules, source-of-truth
requirements, or promotion thresholds. Update this page with the helper
contract before describing any new learning behavior elsewhere.
