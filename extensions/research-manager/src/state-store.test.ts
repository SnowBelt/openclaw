import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../api.js";
import { createResearchStateStores } from "./state-store.js";

const temporaryDirectories: string[] = [];

async function createTemporaryStateDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "research-manager-state-"));
  temporaryDirectories.push(directory);
  return directory;
}

function fallbackApi(stateDir: string, warning = vi.fn()): OpenClawPluginApi {
  return {
    logger: { warn: warning },
    runtime: {
      state: {
        resolveStateDir: () => stateDir,
        openKeyedStore: () => {
          throw new Error("openKeyedStore is only available for trusted plugins in this release.");
        },
      },
    },
  } as unknown as OpenClawPluginApi;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("Research Manager state stores", () => {
  it("prefers native keyed state and propagates unrelated native failures", () => {
    const native = {
      register: vi.fn(),
      registerIfAbsent: vi.fn(),
      lookup: vi.fn(),
      delete: vi.fn(),
      entries: vi.fn(),
    };
    const api = {
      runtime: { state: { openKeyedStore: () => native } },
    } as unknown as OpenClawPluginApi;
    const stores = createResearchStateStores(api);
    expect(stores.open({ namespace: "native", maxEntries: 2 })).toBe(native);
    expect(stores.storage()).toEqual({ backend: "openclaw-keyed-store", durable: true });

    const brokenApi = {
      runtime: {
        state: {
          openKeyedStore: () => {
            throw new Error("database is corrupt");
          },
        },
      },
    } as unknown as OpenClawPluginApi;
    expect(() =>
      createResearchStateStores(brokenApi).open({ namespace: "broken", maxEntries: 2 }),
    ).toThrow("database is corrupt");
  });

  it("falls back only for the trust gate and persists isolated, bounded state", async () => {
    const stateDir = await createTemporaryStateDir();
    const warning = vi.fn();
    const firstFactory = createResearchStateStores(fallbackApi(stateDir, warning));
    const first = firstFactory.open<{ value: number }>({ namespace: "runs", maxEntries: 2 });

    expect(firstFactory.storage()).toEqual({ backend: "plugin-sqlite", durable: true });
    expect(warning).toHaveBeenCalledOnce();
    expect(await first.registerIfAbsent("a", { value: 1 })).toBe(true);
    expect(await first.registerIfAbsent("a", { value: 2 })).toBe(false);
    await first.register("b", { value: 2 });
    await first.register("c", { value: 3 });
    expect(await first.lookup("a")).toBeUndefined();
    expect((await first.entries()).map((entry) => entry.key)).toEqual(["b", "c"]);

    const secondFactory = createResearchStateStores(fallbackApi(stateDir));
    const reopened = secondFactory.open<{ value: number }>({ namespace: "runs", maxEntries: 2 });
    expect(await reopened.lookup("c")).toEqual({ value: 3 });
    const claims = await Promise.all([
      first.registerIfAbsent("winner", { value: 1 }),
      reopened.registerIfAbsent("winner", { value: 2 }),
    ]);
    expect(claims).toEqual([true, false]);

    const other = secondFactory.open<{ value: number }>({
      namespace: "qualifications",
      maxEntries: 2,
    });
    expect(await other.lookup("c")).toBeUndefined();
    await other.register("role", { value: 93 });
    expect(await reopened.lookup("role")).toBeUndefined();

    secondFactory.close();
    firstFactory.close();
    const directoryMode = (await fs.stat(path.join(stateDir, "research-manager"))).mode & 0o777;
    const fileMode =
      (await fs.stat(path.join(stateDir, "research-manager", "state.sqlite"))).mode & 0o777;
    expect(directoryMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it("routes bounded large evidence values to private SQLite without changing native limits", async () => {
    const stateDir = await createTemporaryStateDir();
    const nativeOpen = vi.fn();
    const warning = vi.fn();
    const api = {
      logger: { warn: warning },
      runtime: {
        state: {
          resolveStateDir: () => stateDir,
          openKeyedStore: nativeOpen,
        },
      },
    } as unknown as OpenClawPluginApi;
    const factory = createResearchStateStores(api);
    const evidence = factory.open<{ content: string }>({
      namespace: "evidence",
      maxEntries: 2,
      largeValues: true,
    });
    const content = "e".repeat(2 * 1024 * 1024);
    await evidence.register("large-report", { content });
    expect((await evidence.lookup("large-report"))?.content).toHaveLength(content.length);
    expect(nativeOpen).not.toHaveBeenCalled();
    expect(factory.storage()).toEqual({ backend: "plugin-sqlite", durable: true });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("large evidence"));
    factory.close();
  });

  it("expires entries and rejects unsafe or incompatible state", async () => {
    const stateDir = await createTemporaryStateDir();
    const factory = createResearchStateStores(fallbackApi(stateDir));
    const store = factory.open<{ value: number | string }>({
      namespace: "ttl",
      maxEntries: 2,
      defaultTtlMs: 5,
    });
    await store.register("temporary", { value: 1 });
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(await store.lookup("temporary")).toBeUndefined();
    expect(() => factory.open({ namespace: "../unsafe", maxEntries: 2 })).toThrow(/namespace/);
    await expect(store.register("invalid-number", { value: Number.NaN })).rejects.toThrow(
      /finite number/,
    );
    await expect(store.register("too-large", { value: "1".repeat(70_000) })).rejects.toThrow(
      /exceeds 65536 bytes/,
    );
    factory.close();

    const databasePath = path.join(stateDir, "research-manager", "state.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA user_version = 2;");
    database.close();
    const incompatible = createResearchStateStores(fallbackApi(stateDir));
    expect(() => incompatible.open({ namespace: "future", maxEntries: 1 })).toThrow(
      /newer than supported/,
    );
  });
});
