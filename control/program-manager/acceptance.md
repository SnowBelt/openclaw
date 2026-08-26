# Program Manager acceptance

| Check                | Required proof                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical context    | `workspace/AGENTS.md` is the sole injected semantic contract; `CONTRACT.md` is optional examples only; other bootstrap files are non-policy.                                                                         |
| Small prompt         | Source check proves per-file and total bootstrap character budgets, with zero skill-prompt chars.                                                                                                                    |
| Truthful state       | Current packet/`get_goal` state is owner runtime state; the checked-in fixture is not installed or live proof.                                                                                                       |
| Safe boundary        | Config exposes only goal/state, `update_plan`, memory, session-list, and bounded worker-handoff tools; read/exec/web/send tools are denied. The shipped policy alias resolves to the `progress_card` runtime schema. |
| Skill isolation      | PM owns `skills: []`, `maxSkillsPromptChars: 0`, and cannot inherit global, bundled, or extra skills.                                                                                                                |
| Active config        | PM-only config sync is backed up, reversible, supports both registry shapes, and passes canonical validation.                                                                                                        |
| Compact output       | PLAN, STATUS, HANDOFF, and COMPLETION profiles are in `AGENTS.md`; duplicated policy is absent from support files.                                                                                                   |
| Continuation safety  | `continuation-skip` uses bounded memory/post-compaction limits and existing freshness/rebuild tests.                                                                                                                 |
| Local model boundary | Thinking is explicitly disabled so the bounded response budget is spent on the visible PM answer.                                                                                                                    |
| Reversible staging   | Install/verify-install/rollback touch only managed files and preserve unrelated files.                                                                                                                               |
| Repeatable CI        | Static checks run without private operator state, live credentials, or secrets.                                                                                                                                      |
| Local behavior       | Representative plan, status, handoff, and unsupported-completion smoke cases pass.                                                                                                                                   |

The package is not complete until source checks, focused tests, config validation,
workflow sanity, and local behavior proof pass. Static checks do not replace
owner acceptance for final certification.
