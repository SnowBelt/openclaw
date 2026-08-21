# Program Manager acceptance

| Check                 | Required proof                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| One canonical context | `CONTRACT.md` is the only semantic contract; `TOOLS.md` contains mechanics only.                    |
| Small prompt          | Source check passes the per-file and total bootstrap budgets.                                       |
| Truthful state        | The workspace-local state parses and starts as `Unknown`.                                           |
| Safe boundary         | The reviewed config exposes only read, planning, and bounded worker handoff tools.                  |
| Compact output        | PLAN, STATUS, HANDOFF, and COMPLETION profiles are present; the old field list is absent.           |
| Reversible staging    | Install/rollback changes only managed files and preserves unrelated files.                          |
| Repeatable CI         | Static checks run without private operator state or live credentials.                               |
| Local behavior        | Run a local PM smoke with representative plan, status, handoff, and unsupported-completion prompts. |

The package is not complete until source checks, focused tests, workflow sanity,
config validation, and the local smoke all pass. A successful static check is
not behavioral proof.
