// Control UI tests cover models behavior.
import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ModelCatalogEntry } from "../types.ts";
import { loadModels } from "./models.ts";

describe("loadModels", () => {
  it("requests the configured model list view", async () => {
    const request = vi.fn(async () => ({
      models: [
        { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed", provider: "minimax" },
      ],
    }));

    const models = await loadModels({ request } as unknown as GatewayBrowserClient);

    expect(request).toHaveBeenCalledWith("models.list", { view: "configured" });
    expect(models).toEqual([
      { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed", provider: "minimax" },
    ]);
  });

  it("reuses the configured model list while the cache is fresh", async () => {
    const request = vi.fn(async () => ({
      models: [{ id: "gpt-5.5", name: "GPT-5.5", provider: "openai" }],
    }));
    const client = { request } as unknown as GatewayBrowserClient;

    const first = await loadModels(client);
    const second = await loadModels(client);

    expect(request).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("bypasses the fresh cache when a user explicitly refreshes models", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        models: [{ id: "old-local", name: "Old Local", provider: "local" }],
      })
      .mockResolvedValueOnce({
        models: [{ id: "new-local", name: "New Local", provider: "local" }],
      });
    const client = { request } as unknown as GatewayBrowserClient;

    const first = await loadModels(client);
    const refreshed = await loadModels(client, { force: true });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith("models.list", {
      view: "configured",
      refresh: true,
    });
    expect(first[0]?.id).toBe("old-local");
    expect(refreshed[0]?.id).toBe("new-local");
  });

  it("reuses an in-flight catalog request during explicit refresh to prevent cache races", async () => {
    let resolveRequest: ((value: { models: ModelCatalogEntry[] }) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<{ models: ModelCatalogEntry[] }>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const client = { request } as unknown as GatewayBrowserClient;

    const first = loadModels(client);
    const refreshed = loadModels(client, { force: true });
    resolveRequest?.({ models: [{ id: "local", name: "Local", provider: "local" }] });

    await expect(first).resolves.toEqual(await refreshed);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps cached rows but rejects a failed explicit refresh", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        models: [{ id: "cached-local", name: "Cached Local", provider: "local" }],
      })
      .mockRejectedValueOnce(new Error("gateway catalog refresh failed"));
    const client = { request } as unknown as GatewayBrowserClient;

    const cached = await loadModels(client);
    await expect(loadModels(client, { force: true })).rejects.toThrow(
      "gateway catalog refresh failed",
    );
    await expect(loadModels(client)).resolves.toEqual(cached);
  });
});
