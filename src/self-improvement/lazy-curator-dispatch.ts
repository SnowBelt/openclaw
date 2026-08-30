import type { CuratorDispatch } from "./curator-dispatch.js";

export function createLazySelfImprovementCuratorDispatch(
  createDispatch: () => Promise<CuratorDispatch>,
): CuratorDispatch {
  let dispatch: CuratorDispatch | undefined;
  let initialization: Promise<CuratorDispatch> | undefined;
  let disposed = false;
  const disposedInstances = new WeakSet<CuratorDispatch>();
  const disposeInstance = (instance: CuratorDispatch) => {
    if (!disposedInstances.has(instance)) {
      disposedInstances.add(instance);
      instance.dispose();
    }
  };
  const getDispatch = async (): Promise<CuratorDispatch> => {
    if (disposed) {
      throw new Error("curator dispatch is disposed");
    }
    if (dispatch) {
      return dispatch;
    }
    initialization ??= createDispatch();
    const created = await initialization;
    if (disposed) {
      disposeInstance(created);
      throw new Error("curator dispatch is disposed");
    }
    dispatch = created;
    return created;
  };
  return {
    enqueue: async (proposalIds) => (await getDispatch()).enqueue(proposalIds),
    reconcile: async () => (await getDispatch()).reconcile(),
    retry: async (proposalId) => (await getDispatch()).retry(proposalId),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (dispatch) {
        disposeInstance(dispatch);
      } else if (initialization) {
        void initialization.then(disposeInstance, () => undefined);
      }
    },
  };
}
