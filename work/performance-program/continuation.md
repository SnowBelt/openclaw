# Whole-Repository Performance Program

Updated: 2026-07-30

## Goal

Improve startup speed, steady-state memory, request scalability, Control UI rendering, and build execution without changing product behavior.

## Proof rule

A milestone passes only when its targeted behavior tests, performance budget or measured benchmark, type checks, formatting/lint checks, and production build surface are green. Mock, source-only, and stale-artifact evidence are not sufficient.

## Milestones

| ID      | Scope                                                       | Status   | Completion |
| ------- | ----------------------------------------------------------- | -------- | ---------- |
| PERF-01 | Baseline and classify current bottlenecks                   | complete | 100%       |
| PERF-02 | Default-startup plugin lazy loading and memory ceiling      | complete | 100%       |
| PERF-03 | Gateway/CLI startup and build reuse                         | complete | 100%       |
| PERF-04 | Control UI polling/rendering and Book Writer scalability    | complete | 100%       |
| PERF-05 | Hot-loop allocation, cache, listener, timer, and leak audit | complete | 100%       |
| PERF-06 | Final production verification                               | complete | 100%       |

## Safety boundaries

- Preserve public behavior and compatibility paths.
- Do not overwrite or revert unrelated dirty work.
- Do not weaken budgets, tests, snapshots, or expected-failure inventories to claim success.
- Keep generated artifacts and local credentials out of commits.
- Keep runtime, browser, memory, build, and test proof separate.
- No live deployment, production Gateway restart, release packaging, or SIG activation was performed by this performance program.

## Current evidence

- Chat hot path now reuses completed render models for unchanged immutable inputs and caches tool-card extraction through weak message references. The explicit characterization tests cover cache reuse, invalidation, and persisted expansion state.
- Chat microbench before optimization: `buildChatItems` repeated unchanged renders were 33.9965 ms total for 100 runs, 0.339965 ms per build. `syncToolCardExpansionState` repeated unchanged syncs were 85.0836 ms total for 200 runs, 0.425418 ms per sync.
- Chat microbench after optimization: `buildChatItems` repeated unchanged renders are 0.066625 ms total for 100 runs, 0.00066625 ms per build. `syncToolCardExpansionState` repeated unchanged syncs are 0.071083 ms total for 200 runs, 0.000355415 ms per sync.
- Research Manager registration now imports only the lightweight descriptor and defers the complete tool runtime until first execution. The retained design avoids the rejected dynamic-public-report approach that made the full build exceed the 4 GB old-space cap.
- Research Manager direct built-entry startup memory dropped from 187.734375 MB to about 68.7 MB in the default startup-plugin memory gate, while preserving tool behavior and restart-recovery service registration.
- `pnpm test extensions/research-manager ui/src/ui/chat/build-chat-items.test.ts ui/src/ui/chat/tool-expansion-state.test.ts ui/src/ui/views/chat.test.ts ui/src/ui/chat/chat-responsive.browser.test.ts` passed: 78 UI/browser tests and 134 Research Manager tests.
- `pnpm tsgo:extensions`, `pnpm tsgo:extensions:test`, and `pnpm tsgo:all` passed after the final source edits.
- Targeted `oxfmt --check` and `scripts/run-oxlint.mjs` passed for the touched Chat and Research Manager files.
- `pnpm build` passed after the final architecture-cycle repair and promoted runtime snapshot `20260730T153308Z-21322`.
- `pnpm ui:build` passed: Vite 8.0.11, 839 modules, 374 ms. Current key chunks include `chat` at 144.97 kB / 41.95 kB gzip, `book-writer-dashboard` at 196.85 kB / 47.01 kB gzip, base `index` at 300.21 kB / 75.19 kB gzip, and `snes-studio` at 552.09 kB / 143.49 kB gzip.
- The built Research Manager `dist/extensions/research-manager/index.js` imports only the descriptor chunk and dynamically imports the full tool chunk; it has no static `public-report` or `security-runtime` import.
- `pnpm test:extensions:startup-memory -- --skip-build` passed after the final build: 22/22 default startup plugins under the 200 MB peak RSS budget. Research Manager was 68.6875 MB, Canvas was the max at 127.546875 MB.
- `pnpm test:startup:gateway:budget -- --skip-build --runs 3 --warmup 1` passed after the final build: readyz p95 2227.2 ms, CPU p95 3130.0 ms, max RSS p95 580.1 MB, plugin load p95 208.8 ms, runtime post-attach p95 341.9 ms, server import p95 516.6 ms.
- `pnpm test:startup:memory` passed: `--help` 46.8 MB, `status --json` 219.5 MB, `gateway status` 271.6 MB.
- `pnpm test:startup:bench:smoke` passed and wrote `.artifacts/cli-startup-bench-smoke.json`; `gateway status --json` completed in 918.0 ms with 60.7 MB RSS and expected disconnected-status exit distribution.
- `node --import tsx --expose-gc scripts/embedded-run-abort-leak.ts --mode production` passed after the final build: 250/250 finalizations, zero retained scopes, 1.3 MB RSS growth, stable 2.5 MB external memory, stable 0.1 MB buffers.
- Architecture repair removed Research Manager source cycles by replacing broad class type imports with structural leaf contracts in `acceptance.ts`, `evaluation.ts`, and `pipeline.ts`. `pnpm check:architecture` now reaches zero runtime cycles, zero Madge cycles, zero clean-boundary violations, and green deprecated API/JSDoc checks before the unrelated Kysely script blocker.

## Remaining checkout-level limitations

- The aggregate `pnpm check:architecture` still stops at `pnpm db:kysely:check` because the dirty checkout's `package.json` references `scripts/generate-kysely-types.mjs`, but that script is absent from `HEAD` and absent from the working tree. `scripts/check-kysely-guardrails.mjs` is also referenced by `lint:kysely` and absent. This is unrelated to the performance implementation and was not invented or stubbed in this program.
- `pnpm changed:lanes --json` is not useful as proof in this shared checkout because hundreds of unrelated generated/media/environment paths are dirty.

## Scalability follow-ups

- Add durable microbench thresholds for the Chat render-model cache and tool expansion sync path so the current hot-path gains cannot regress silently.
- Consider route-splitting the largest remaining Control UI chunks, especially SNES Studio at 143.49 kB gzip, after confirming that route behavior and editor state hydration remain unchanged.
- After a separate checkout cleanup, restore or remove the package-level Kysely scripts so `pnpm check:architecture` can be used as a fully green aggregate gate again.
