---
name: control-ui-e2e
description: Use when testing, fixing, or extending the OpenClaw Control UI GUI with Vitest + Playwright end-to-end checks, mocked Gateway WebSocket flows, mocked dashboard runs, screenshots/videos, or agent-verifiable browser proof.
---

# Control UI E2E

Use this for Control UI changes that need a real browser flow with deterministic Gateway data.

## Test Shape

- Use `ui/src/**/*.e2e.test.ts` for full GUI flows.
- Use `ui/src/test-helpers/control-ui-e2e.ts` to start the Vite Control UI and install a mocked Gateway WebSocket.
- Keep scenarios deterministic. Do not use live provider keys, real channel credentials, or a real Gateway unless the user explicitly asks for live proof.
- Prefer existing `.browser.test.ts` or unit tests for narrow rendering logic; use this E2E lane when the proof should cover routing, app boot, Gateway handshake, requests, and visible UI behavior together.

## Operations Room proof

Operations Room work must use `ui/src/ui/e2e/operations-room.e2e.test.ts` in addition to the
cheap DOM smoke. The E2E scenario must use deterministic Gateway responses and prove:

- the one-sentence current briefing, actionable issue count, working-now count, and system state;
- Needs you, OpenClaw is handling it, and Watching issue lanes without mixing history into action;
- priority agent ordering plus a stable directory sort, with Ready and Off groups collapsed by default;
- top-summary navigation that updates URL state, moves focus to the destination heading, and keeps
  browser Back and Forward usable;
- current work versus last activity, bounded display text, full detail disclosure, and recurring-run
  rollups keyed by the generic task `runtime` and `sourceId` contracts;
- stale, partial, offline, zero-issue, warning, critical, and large-inventory states without a false
  all-clear;
- authoritative V2 loading, exact V1 fallback only for an explicitly unsupported V2 method, and no
  fallback for authentication, connectivity, validation, timeout, or collector errors;
- unresolved Last known incidents when a source becomes non-authoritative, fail-closed monitor
  health, and available, partial, omitted, and unavailable process-probe states;
- guarded preview, cancel, apply, replay rejection, and post-action refresh behavior; and
- keyboard focus, non-color status cues, reduced motion, 200% zoom, and desktop, tablet, and mobile
  layouts in light, dark, and increased-contrast modes.

The focused command is:

```bash
pnpm ui:smoke:operations-room:e2e
```

Run both Operations Room smoke layers with:

```bash
pnpm ui:smoke:operations-room
```

Write a compact receipt plus desktop and mobile screenshots beneath
`.artifacts/control-ui-e2e/operations-room/`. The dedicated Operations Room V2 Proof workflow uploads
that exact directory for the exact SHA supplied at dispatch.
Do not describe the DOM smoke as browser, accessibility, mobile, or interaction proof.

The receipt set is a gate, not optional evidence. It must contain nonempty `receipt.json`,
`desktop-light.png`, `desktop-dark.png`, `mobile-320.png`, `mobile-rtl.png`, and
`tablet-768-increased-contrast.png`. The browser receipt must use schema
`openclaw.operations-room.e2e-receipt.v3`, name all five screenshots with byte counts and SHA-256
digests, bind the run to its source SHA and runtime versions, and mark every required boolean check
true. The exact-SHA workflow validates those fields, writes `browser-receipt.sha256`, and emits a
passing `workflow-receipt.json` with the checked-out SHA, dispatched SHA, run identity, commands, and
artifact digests. A green test process without this complete receipt set is not browser proof.

Use `pnpm operations-room:verify` for the complete focused source gate. It includes the full
Operations and task-registry test inventory, `tsgo:test:src` and the other type lanes, both smoke
layers, i18n, capability and workflow checks, and build. Human learnability is a separate production
gate: follow the zero-instruction protocol in `docs/automation/operations-room.md`, preserve every
attempt, and require every first-use participant to finish all four outcomes in 60 seconds or less
with zero hints and zero unsafe actions.

## Commands

- Target one E2E test in a Codex worktree:

```bash
node scripts/run-vitest.mjs run --config test/vitest/vitest.ui-e2e.config.ts --configLoader runner ui/src/ui/e2e/chat-flow.e2e.test.ts
```

- Run the whole local lane in a normal checkout:

```bash
pnpm test:ui:e2e
```

If dependencies are missing in a Codex worktree, install once with `pnpm install`; for broad GUI proof or dependency-heavy checks, use Testbox/Crabbox instead of running a wide local pnpm lane.

## Visual Proof Default

When running mocked Control UI/dashboard validation for a user-facing feature, produce visual proof by default unless the user explicitly opts out.

- Keep the Vitest E2E assertions deterministic; do not commit generated screenshots or videos.
- After or alongside the focused E2E test, run the mocked Control UI app when available, for example `pnpm dev:ui:mock -- --port <port>`.
- Drive Chromium with Playwright against the local mock URL and capture a video plus screenshots for each meaningful state: initial view, interaction input, result state, and final/paginated/selected state.
- Use `browser.newContext({ recordVideo: { dir, size }, viewport })`, `page.screenshot({ path })`, and close the context before reporting the video path.
- Put artifacts under `.artifacts/control-ui-e2e/<short-feature-name>/` or another clearly named local temp directory, and report the absolute paths in the final answer.
- Treat recording as validation, not only demo capture. If the recorder fails or shows surprising behavior, stop, fix the behavior, add or update a regression test, then rerecord.
- If visual proof is blocked, state the exact blocker and still report the textual E2E evidence.

## Mock Pattern

Start the app server, install the mock before `page.goto`, then assert both Gateway traffic and visible UI:

```ts
const server = await startControlUiE2eServer();
const page = await context.newPage();
const gateway = await installMockGateway(page, {
  historyMessages: [{ role: "assistant", content: [{ type: "text", text: "Ready." }] }],
});

await page.goto(`${server.baseUrl}chat`);
await page.locator(".agent-chat__composer-combobox textarea").fill("hello");
await page.getByRole("button", { name: "Send message" }).click();

const request = await gateway.waitForRequest("chat.send");
await gateway.emitChatFinal({ runId: String(request.params.idempotencyKey), text: "Done." });
await page.getByText("Done.").waitFor();
```

Extend `installMockGateway` with typed scenario options or method responses when a new flow needs more Gateway surface.

## Standalone Recording

When recording an already-running mocked Control UI URL, use a temporary Playwright script or `playwright test` spec and keep the recording flow focused:

- Open the mock URL, interact through stable `data-*` selectors or user-facing role selectors, and wait on asserted states instead of relying on fixed sleeps.
- Assert both visible UI state and mocked Gateway traffic for request-driven flows. For example, verify the expected count/row is visible and that `sessions.list` was called with the expected `search`, `offset`, and `limit`.
- Use short sleeps only after assertions to make the captured video readable.
- Store the generated video under `.artifacts/control-ui-e2e/<feature>/`; do not commit it.
