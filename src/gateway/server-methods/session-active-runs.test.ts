// Tests gateway active-run matching by logical session key and backing id.
import { expect, it } from "vitest";
import {
  hasVisibleActiveSessionRun,
  listAllActiveSessionRuns,
  listVisibleActiveSessionRuns,
  resolveVisibleActiveSessionRunState,
} from "./session-active-runs.js";

it("matches session-id-only gateway runs during archive admission", () => {
  const context = {
    chatAbortControllers: new Map([
      [
        "run-1",
        {
          sessionId: "session-1",
          controlUiVisible: true,
          projectSessionActive: true,
        },
      ],
    ]),
  } as never;

  expect(
    hasVisibleActiveSessionRun({
      context,
      requestedKey: "agent:main:child",
      canonicalKey: "agent:main:child",
      sessionId: "session-1",
    }),
  ).toBe(true);
});

it("returns deterministic visible run ids for the selected session", () => {
  const context = {
    chatAbortControllers: new Map([
      ["run-z", { sessionKey: "main" }],
      ["run-hidden", { sessionKey: "main", controlUiVisible: false }],
      ["run-other", { sessionKey: "other" }],
      ["run-a", { sessionKey: "main" }],
    ]),
  } as never;

  expect(
    resolveVisibleActiveSessionRunState({
      context,
      requestedKey: "main",
      canonicalKey: "main",
    }),
  ).toEqual({ active: true, runIds: ["run-a", "run-z"] });
});

it("lists only visible active runs in newest-first order for operational projections", () => {
  const context = {
    chatAbortControllers: new Map([
      [
        "run-old",
        {
          sessionId: "session-old",
          sessionKey: "agent:alpha:main",
          agentId: "alpha",
          startedAtMs: 10,
        },
      ],
      [
        "run-hidden",
        {
          sessionId: "session-hidden",
          sessionKey: "agent:hidden:main",
          agentId: "hidden",
          startedAtMs: 30,
          controlUiVisible: false,
        },
      ],
      [
        "run-new",
        {
          sessionId: "session-new",
          sessionKey: "agent:beta:main",
          agentId: "beta",
          startedAtMs: 20,
        },
      ],
    ]),
  } as never;

  expect(listVisibleActiveSessionRuns(context)).toEqual([
    expect.objectContaining({ runId: "run-new", agentId: "beta", startedAtMs: 20 }),
    expect.objectContaining({ runId: "run-old", agentId: "alpha", startedAtMs: 10 }),
  ]);
});

it("lists hidden background runs for Operations Room truth without changing visible session semantics", () => {
  const context = {
    chatAbortControllers: new Map([
      ["run-visible", { sessionKey: "agent:alpha:main", startedAtMs: 10 }],
      [
        "run-hidden",
        {
          sessionKey: "agent:background:main",
          startedAtMs: 30,
          controlUiVisible: false,
        },
      ],
    ]),
  } as never;

  expect(listVisibleActiveSessionRuns(context).map((run) => run.runId)).toEqual(["run-visible"]);
  expect(listAllActiveSessionRuns(context).map((run) => run.runId)).toEqual([
    "run-hidden",
    "run-visible",
  ]);
});
