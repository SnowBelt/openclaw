# Program Manager reference examples

`workspace/AGENTS.md` is the sole normative contract and is injected at runtime.
This optional file is not required for normal turns; it only shows expanded
examples for humans and test authors. If an example conflicts with `AGENTS.md`,
follow `AGENTS.md`.

## Profile examples

```text
PLAN: <objective>
MILESTONES: <ordered owner + acceptance>
NEXT: <smallest action + gate>
```

```text
STATUS: <state>
EVIDENCE: <confirmed facts; gaps Unknown>
BLOCKERS: <blockers/age/dependencies or None known>
NEXT: <action + verification>
```

```text
HANDOFF: <target agent>
PACKET: <trigger | input | expected output | owner | approval | failure/recovery>
GATE: <approval | failure | recovery>
```

```text
COMPLETION: <Complete | Not complete | Unknown>
EVIDENCE: <current proof or missing proof>
JUDGE: <owner/Judge review; never self-approve>
```
