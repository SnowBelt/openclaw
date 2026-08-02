import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(qaDir, "..");
const codexPluginRoot = path.resolve(pluginRoot, "../codex");
const searxngPluginRoot = path.resolve(pluginRoot, "../searxng");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("configure-active", () => {
  it("uses the bundled Codex plugin and enables every required plugin", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "research-manager-configure-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "openclaw.json");
    const receiptPath = path.join(directory, "receipt.json");
    await fs.writeFile(
      configPath,
      `${JSON.stringify({ plugins: { load: { paths: [codexPluginRoot] } } }, null, 2)}\n`,
    );

    const result = spawnSync(
      process.execPath,
      [path.join(qaDir, "configure-active.mjs"), "--config", configPath, "--receipt", receiptPath],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    const config = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      plugins: {
        allow: string[];
        load: { paths: string[] };
        entries: Record<
          string,
          {
            enabled?: boolean;
            config?: { retrieval?: { queryCount?: number } };
          }
        >;
      };
    };
    expect(config.plugins.load.paths).toContain(pluginRoot);
    expect(config.plugins.load.paths).toContain(searxngPluginRoot);
    expect(config.plugins.load.paths).not.toContain(codexPluginRoot);
    expect(config.plugins.allow).toEqual(
      expect.arrayContaining(["codex", "research-manager", "searxng", "duckduckgo"]),
    );
    expect(config.plugins.entries.codex?.enabled).toBe(true);
    expect(config.plugins.entries["research-manager"]?.config?.retrieval?.queryCount).toBe(24);

    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8")) as {
      changedPaths: string[];
      pluginPaths: string[];
    };
    expect(receipt.pluginPaths).toEqual([pluginRoot, searxngPluginRoot]);
    expect(receipt.changedPaths).toContain(
      "plugins.load.paths[codex] (removed; bundled plugin retained)",
    );
  });
});
