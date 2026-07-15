# Pattern Lab scoped rules

- For any Pattern Lab production, rebuild, QA, repair, or owner-review task,
  load `skills/patternlab-production-director/SKILL.md` first.
- The only supported public production command is
  `scripts/patternlab_production.py`. Leaf scripts are debugging tools; their
  outputs are not completion proof until the canonical entrypoint reruns.
- Read `resources/patternlab-production-contract.json`. Additions must extend
  its typed stage/output/side-effect contract and targeted tests in the same
  change.
- Keep tracked skills deployed to the active Codex and OpenClaw skill roots;
  `scripts/patternlab_skill_deployment.py` is the hash-verification gate.
- Keep only the canonical `com.openclaw.patternlab-v2.*` user LaunchAgents
  installed; `scripts/patternlab_launchd_install.py` is the backup, install,
  rollback, and verification gate. Never load the root wake scheduler as a
  user job.
- Never ask the owner to remember routine production substeps. The selected
  canonical profile owns ordering, preflight, production, QA, receipts, and
  review handoff.
- Every episode must own one explicit city, hidden-history question, proof
  object, source trail, visual payoff, five thumbnail hypotheses, and 3-5
  Shorts. Never infer a city or copy a prior city's package defaults.
- A requested local-AI beat must pass prompt compilation, route health,
  hash-bound >=93 tournament selection, source-pool promotion, and final-pixel
  QA. A no-AI episode records not-applicable; no weak or paid fallback is
  silent.
- Require exact source rights, current artifact hashes, a 93/100 minimum for
  every final asset, zero warnings, and owner review. AI is non-proof support.
- Never call paid providers or mutate YouTube without exact scoped approval.
- Keep generated media, credentials, local-output, caches, model files, and
  virtual environments out of Git.
