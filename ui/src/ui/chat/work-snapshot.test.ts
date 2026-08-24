import { describe, expect, it } from "vitest";
import {
  buildWorkSurfaceSnapshot,
  hasQueuedWork,
  isWorkSurfaceItemExecuting,
} from "./work-snapshot.ts";

const sessionsResult = {
  ts: 0,
  path: "",
  count: 2,
  sessions: [
    {
      key: "agent:main:main",
      kind: "direct" as const,
      updatedAt: 50,
      hasActiveRun: true,
      displayName: "Main chat",
    },
    {
      key: "agent:main:research",
      kind: "direct" as const,
      updatedAt: 80,
      hasActiveRun: true,
      displayName: "Research lane",
      projectId: "proj-1",
    },
  ],
  defaults: { modelProvider: null, model: null, contextTokens: null },
};

describe("buildWorkSurfaceSnapshot", () => {
  it("returns no items for an idle chat", () => {
    expect(buildWorkSurfaceSnapshot({ currentSessionKey: "agent:main:main" })).toEqual([]);
  });

  it("does not treat a contradictory running status as active work", () => {
    const items = buildWorkSurfaceSnapshot({
      sessionsResult: {
        ...sessionsResult,
        sessions: [
          {
            ...sessionsResult.sessions[0],
            hasActiveRun: false,
            status: "running",
          },
        ],
      },
    });

    expect(items).toEqual([]);
  });

  it("does not duplicate the selected chat when its session row uses the default-main alias", () => {
    const items = buildWorkSurfaceSnapshot({
      currentSessionKey: "main",
      chatRunId: "run-1",
      sessionsResult: {
        ...sessionsResult,
        sessions: [{ ...sessionsResult.sessions[0], key: "agent:main:main" }],
      },
    });

    expect(items.map((item) => item.kind)).toEqual(["chat_run"]);
  });

  it("sorts active run, queued messages, running tasks, queued tasks, and active sessions", () => {
    const items = buildWorkSurfaceSnapshot({
      assistantName: "OpenClaw",
      currentSessionKey: "agent:main:main",
      chatRunId: "run-1",
      chatRunStatus: {
        phase: "done",
        runId: "run-1",
        sessionKey: "agent:main:main",
        occurredAt: 100,
      },
      chatQueue: [{ id: "queue-1", text: "Next step", createdAt: 90 }],
      sessionsResult,
      tasks: [
        {
          id: "task-queued",
          taskId: "task-queued",
          title: "Queued task",
          status: "queued",
          updatedAt: 70,
        },
        {
          id: "task-running",
          taskId: "task-running",
          title: "Running task",
          status: "running",
          progressSummary: "Half done",
          updatedAt: 60,
        },
      ],
    });

    expect(items.map((item) => `${item.kind}:${item.title}`)).toEqual([
      "chat_run:OpenClaw is working…",
      "queued_message:Next step",
      "task:Running task",
      "task:Queued task",
      "active_session:Research lane",
    ]);
    expect(items[0]?.actions).toEqual(["stop_run"]);
    expect(items[1]?.actions).toEqual(["remove_queue"]);
    expect(items[2]?.actions).toEqual(["cancel_task"]);
    expect(items[4]?.actions).toEqual(["open_session"]);
  });

  it("does not show cancel for tasks without an id", () => {
    const items = buildWorkSurfaceSnapshot({
      tasks: [{ title: "Anonymous task", status: "running", updatedAt: 1 }],
    });

    expect(items[0]?.actions).toEqual([]);
  });

  it("projects a durable goal even when no child task is currently running", () => {
    const items = buildWorkSurfaceSnapshot({
      currentSessionKey: "agent:main:main",
      goals: [
        {
          id: "flow-1",
          goal: "Finish the dashboard",
          status: "running",
          currentStep: "Waiting for the next continuation",
          taskSummary: { active: 0 },
          updatedAt: 100,
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "goal",
      title: "Finish the dashboard",
      status: "Goal active · waiting",
      detail: "Waiting for the next continuation",
    });
  });

  it("labels paused goals without claiming work is running", () => {
    const items = buildWorkSurfaceSnapshot({
      goals: [{ id: "flow-1", goal: "Finish the dashboard", status: "paused" }],
    });

    expect(items[0]?.status).toBe("Goal paused");
  });

  it("turns a blocked goal into actionable attention with an owner and next step", () => {
    const items = buildWorkSurfaceSnapshot({
      goals: [
        {
          id: "flow-blocked",
          goal: "Finish the dashboard",
          status: "blocked",
          blockedSummary: "Remote proof is missing.",
        },
      ],
    });

    expect(items[0]).toMatchObject({
      kind: "goal",
      status: "Goal blocked",
      detail: "Remote proof is missing.",
      attention: {
        owner: "Pursue Goal",
        nextAction: "Open the goal, review the blocker, then retry or edit it.",
      },
      actions: ["open_goal"],
    });
  });

  it("separates queued work from work that is actively executing", () => {
    const items = buildWorkSurfaceSnapshot({
      chatQueue: [{ id: "queue-1", text: "Wait for the current run", createdAt: 1 }],
      tasks: [{ id: "task-1", title: "Waiting task", status: "queued" }],
    });

    expect(hasQueuedWork(items)).toBe(true);
    expect(items.some((item) => isWorkSurfaceItemExecuting(item))).toBe(false);
  });

  it("surfaces failed queued messages as attention instead of active work", () => {
    const items = buildWorkSurfaceSnapshot({
      chatQueue: [
        {
          id: "queue-failed",
          text: "Retry this prompt",
          createdAt: 1,
          sendState: "failed",
          sendError: "Gateway rejected the request",
        },
      ],
    });

    expect(items[0]).toMatchObject({
      kind: "queued_message",
      status: "Failed",
      attention: {
        owner: "Chat queue",
        nextAction: "Retry the message or remove it from the queue.",
      },
    });
    expect(items.some((item) => isWorkSurfaceItemExecuting(item))).toBe(false);
  });

  it("keeps reconnectable queued messages waiting instead of failed", () => {
    const items = buildWorkSurfaceSnapshot({
      chatQueue: [
        {
          id: "queue-reconnect",
          text: "Send after reconnect",
          createdAt: 1,
          sendState: "waiting-reconnect",
          sendError: "Gateway disconnected",
        },
      ],
    });

    expect(items[0]).toMatchObject({
      kind: "queued_message",
      status: "Waiting for reconnect",
    });
    expect(items[0]?.attention).toBeUndefined();
    expect(hasQueuedWork(items)).toBe(true);
    expect(items.some((item) => isWorkSurfaceItemExecuting(item))).toBe(false);
  });

  it("treats a worker-backed goal and running session as executing", () => {
    const items = buildWorkSurfaceSnapshot({
      goals: [
        {
          id: "flow-1",
          goal: "Finish the dashboard",
          status: "running",
          taskSummary: { active: 1 },
        },
      ],
      sessionsResult,
    });

    expect(items.some((item) => isWorkSurfaceItemExecuting(item))).toBe(true);
  });

  it("uses task status when a goal snapshot has no active-task count or a stale zero", () => {
    const items = buildWorkSurfaceSnapshot({
      goals: [
        {
          id: "flow-1",
          goal: "Finish the dashboard",
          status: "running",
          taskSummary: { active: 0 },
          tasks: [{ id: "task-1", status: "running" }],
        },
      ],
    });

    expect(items[0]?.status).toBe("Goal active · worker running");
    expect(items.some((item) => isWorkSurfaceItemExecuting(item))).toBe(true);
  });

  it("treats active and working task rows as executing work", () => {
    for (const status of ["active", "working"]) {
      const items = buildWorkSurfaceSnapshot({
        currentSessionKey: "agent:main:main",
        tasks: [{ id: `task-${status}`, status }],
      });

      expect(items[0]?.status).toBe("Working");
      expect(isWorkSurfaceItemExecuting(items[0]!)).toBe(true);
    }
  });

  it("recognizes subagent activity flags as executing sessions", () => {
    const items = buildWorkSurfaceSnapshot({
      sessionsResult: {
        count: 1,
        defaults: { contextTokens: null, model: null, modelProvider: null },
        path: "",
        ts: 0,
        sessions: [
          {
            key: "agent:main:subagent:worker",
            kind: "direct",
            updatedAt: 1,
            hasActiveSubagentRun: true,
          },
        ],
      },
    });

    expect(items).toEqual([
      expect.objectContaining({
        kind: "active_session",
        status: "Active",
        sessionKey: "agent:main:subagent:worker",
      }),
    ]);
    expect(items.some((item) => isWorkSurfaceItemExecuting(item))).toBe(true);
  });
});
