import { describe, expect, it, vi } from "vitest";
import type { CuratorDispatch } from "./curator-dispatch.js";
import { createLazySelfImprovementCuratorDispatch } from "./lazy-curator-dispatch.js";

function dispatch(): CuratorDispatch {
  return {
    enqueue: vi.fn(async () => undefined),
    reconcile: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
}

describe("createLazySelfImprovementCuratorDispatch", () => {
  it("does not initialize when disposed before first use", async () => {
    const create = vi.fn(async () => dispatch());
    const lazy = createLazySelfImprovementCuratorDispatch(create);

    lazy.dispose();
    lazy.dispose();

    await expect(lazy.reconcile()).rejects.toThrow("disposed");
    expect(create).not.toHaveBeenCalled();
  });

  it("disposes an instance that finishes initializing during shutdown", async () => {
    let finish: ((value: CuratorDispatch) => void) | undefined;
    const created = dispatch();
    const create = vi.fn(
      async () =>
        await new Promise<CuratorDispatch>((resolve) => {
          finish = resolve;
        }),
    );
    const lazy = createLazySelfImprovementCuratorDispatch(create);

    const reconcile = lazy.reconcile();
    lazy.dispose();
    finish?.(created);

    await expect(reconcile).rejects.toThrow("disposed");
    await Promise.resolve();
    expect(created.dispose).toHaveBeenCalledTimes(1);
    expect(created.reconcile).not.toHaveBeenCalled();
  });

  it("initializes once and disposes an active instance once", async () => {
    const created = dispatch();
    const create = vi.fn(async () => created);
    const lazy = createLazySelfImprovementCuratorDispatch(create);

    await Promise.all([lazy.reconcile(), lazy.enqueue(["sip_one"])]);
    lazy.dispose();
    lazy.dispose();

    expect(create).toHaveBeenCalledTimes(1);
    expect(created.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not retain or double-dispose dispatches across repeated lifecycle cycles", async () => {
    const instances = Array.from({ length: 100 }, () => dispatch());

    for (const instance of instances) {
      const lazy = createLazySelfImprovementCuratorDispatch(async () => instance);
      await lazy.reconcile();
      lazy.dispose();
      lazy.dispose();
    }

    for (const instance of instances) {
      expect(instance.reconcile).toHaveBeenCalledTimes(1);
      expect(instance.dispose).toHaveBeenCalledTimes(1);
    }
  });
});
