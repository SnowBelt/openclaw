# Program Manager acceptance

| Check               | Required proof                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical context   | `workspace/AGENTS.md` is the sole injected semantic contract; `CONTRACT.md` is optional examples only; other bootstrap files are non-policy.                                                                         |
| Small prompt        | Source check proves per-file and total bootstrap character budgets, with zero skill-prompt chars.                                                                                                                    |
| Truthful state      | Current packet/`get_goal` state is owner runtime state; the checked-in fixture is not installed or live proof.                                                                                                       |
| Safe boundary       | Config exposes only goal/state, `update_plan`, memory, session-list, and bounded worker-handoff tools; read/exec/web/send tools are denied. The shipped policy alias resolves to the `progress_card` runtime schema. |
| Skill isolation     | PM owns `skills: []`, `maxSkillsPromptChars: 0`, and cannot inherit global, bundled, or extra skills.                                                                                                                |
| Active config       | PM-only config sync is backed up, reversible, supports both registry shapes, and passes canonical validation.                                                                                                        |
| Compact output      | PLAN, STATUS, HANDOFF, and COMPLETION profiles are in `AGENTS.md`; duplicated policy is absent from support files.                                                                                                   |
| Continuation safety | `continuation-skip` uses bounded memory/post-compaction limits and existing freshness/rebuild tests.                                                                                                                 |
| Model independence  | The source role config contains no model route or provider-specific parameters; portable thinking-off intent is used and every candidate must pass the same behavioral contract.                                     |
| Reversible staging  | Install/verify-install/rollback touch only managed files and preserve unrelated files.                                                                                                                               |
| Repeatable CI       | Static checks run without private operator state, live credentials, or secrets.                                                                                                                                      |
| Model qualification | Candidate preflight, 15-scenario contract matrix repeated three times, redacted receipt, atomic promotion, post-activation smoke, and automatic rollback are proven.                                                 |
| Local behavior      | Truth, safety, tool, delegation, output-profile, continuation, compaction, restart, timeout, and fallback behavior pass at 100% for the qualified candidate.                                                         |

The package is not complete until source checks, focused tests, config validation,
workflow sanity, and local behavior proof pass. Static checks do not replace
owner acceptance for final certification. Qualification fails fast at the first
critical contract failure and must leave the active route byte-for-byte
unchanged; correctness gates cannot be waived by latency or token results.
