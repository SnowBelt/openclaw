import { describe, expect, it } from "vitest";
import {
  appendDurableWorkerMailboxMessage,
  createDurableWorkerMailboxMessage,
  parseDurableWorkerMailbox,
  summarizeDurableWorkerFanIn,
} from "./durable-worker-mailbox.js";

describe("durable worker mailbox", () => {
  it("correlates assignments and results idempotently across serialization", () => {
    const assignment = createDurableWorkerMailboxMessage({
      messageId: "assignment-1",
      idempotencyKey: "assign:run-1",
      flowId: "flow-1",
      missionId: "mission-1",
      direction: "assignment",
      kind: "work",
      actorId: "program-manager",
      recipientId: "worker",
      summary: "Inspect source",
      createdAt: 1,
    });
    const result = createDurableWorkerMailboxMessage({
      idempotencyKey: "result:run-1",
      flowId: "flow-1",
      missionId: "mission-1",
      direction: "result",
      kind: "success",
      actorId: "worker",
      recipientId: "program-manager",
      summary: "Source inspected",
      correlation: { assignmentMessageId: assignment.messageId, runId: "run-1" },
      evidenceRefs: ["test:source"],
      createdAt: 2,
    });
    const mailbox = appendDurableWorkerMailboxMessage(
      appendDurableWorkerMailboxMessage([assignment], result),
      result,
    );
    const restored = parseDurableWorkerMailbox(JSON.parse(JSON.stringify(mailbox)));
    expect(restored).toHaveLength(2);
    expect(summarizeDurableWorkerFanIn(restored)).toMatchObject({
      assignments: 1,
      results: 1,
      unresolvedAssignmentIds: [],
      ready: true,
    });
  });
});
