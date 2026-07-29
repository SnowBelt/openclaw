// Runtime task test harness helpers build mocked plugin runtimes for task-flow tests.
import { vi } from "vitest";
import { resetDetachedTaskLifecycleRuntimeForTests } from "../../tasks/detached-task-runtime.js";
import {
  resetTaskRegistryControlRuntimeForTests,
  resetTaskRegistryDeliveryRuntimeForTests,
  resetTaskRegistryForTests,
  setTaskRegistryControlRuntimeForTests,
  setTaskRegistryDeliveryRuntimeForTests,
} from "../../tasks/runtime-internal.js";
import {
  configureTaskFlowRegistryRuntime,
  type TaskFlowRegistryStoreSnapshot,
} from "../../tasks/task-flow-registry.store.js";
import type { TaskFlowRecord } from "../../tasks/task-flow-registry.types.js";
import { resetTaskFlowRegistryForTests } from "../../tasks/task-flow-runtime-internal.js";

const runtimeTaskMocks = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  cancelSessionMock: vi.fn(),
  killSubagentRunAdminMock: vi.fn(),
}));

export function getRuntimeTaskMocks() {
  return runtimeTaskMocks;
}

export function installRuntimeTaskDeliveryMock(): void {
  let flows = new Map<string, TaskFlowRecord>();
  configureTaskFlowRegistryRuntime({
    // Runtime plugin tests must never inherit or persist the operator's real task-flow registry.
    store: {
      loadSnapshot: () => ({ flows: new Map(flows) }),
      saveSnapshot: (snapshot: TaskFlowRegistryStoreSnapshot) => {
        flows = new Map(snapshot.flows);
      },
      upsertFlow: (flow) => {
        flows.set(flow.flowId, structuredClone(flow));
      },
      deleteFlow: (flowId) => {
        flows.delete(flowId);
      },
    },
  });
  setTaskRegistryDeliveryRuntimeForTests({
    sendMessage: runtimeTaskMocks.sendMessageMock,
  });
  setTaskRegistryControlRuntimeForTests({
    getAcpSessionManager: () => ({
      cancelSession: runtimeTaskMocks.cancelSessionMock,
    }),
    killSubagentRunAdmin: (params: unknown) => runtimeTaskMocks.killSubagentRunAdminMock(params),
  });
}

export function resetRuntimeTaskTestState(
  taskRegistryOptions?: Parameters<typeof resetTaskRegistryForTests>[0],
): void {
  resetDetachedTaskLifecycleRuntimeForTests();
  resetTaskRegistryControlRuntimeForTests();
  resetTaskRegistryDeliveryRuntimeForTests();
  resetTaskRegistryForTests(taskRegistryOptions);
  resetTaskFlowRegistryForTests({ persist: false });
  vi.clearAllMocks();
}
