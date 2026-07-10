import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../tasks/task-registry.types.js";
import { filterSelfImprovementSystemTasks } from "./runner.js";

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId: "task-test",
    runtime: "cli",
    requesterSessionKey: "main",
    ownerKey: "main",
    scopeKind: "system",
    task: "Inspect task",
    status: "succeeded",
    deliveryStatus: "not_applicable",
    notifyPolicy: "silent",
    createdAt: 1,
    ...overrides,
  };
}

describe("Self-Improvement Governor task filtering", () => {
  it("excludes only exact system-owned Governor tasks", () => {
    const visible = filterSelfImprovementSystemTasks([
      task({
        taskId: "sig-task-kind",
        taskKind: "self-improvement",
        task: "metric and approval discussion",
      }),
      task({
        taskId: "sig-source-id",
        sourceId: "self-improvement-governor",
      }),
      task({
        taskId: "sig-owner",
        ownerKey: "system:self-improvement",
      }),
      task({
        taskId: "sig-session",
        requesterSessionKey: "system:self-improvement",
      }),
      task({
        taskId: "ordinary-task",
        task: "A user task discussing SIG metrics and approval",
      }),
    ]);

    expect(visible.map((entry) => entry.taskId)).toEqual(["ordinary-task"]);
  });
});
