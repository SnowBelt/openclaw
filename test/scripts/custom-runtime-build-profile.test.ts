import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REQUIRED_CERTIFICATION_PLUGIN_IDS,
  resolveCustomRuntimeBuildPluginIds,
} from "../../scripts/custom-runtime/custom-runtime-build-profile.mjs";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture(pluginIds: string[], manifestPluginIds = pluginIds) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "custom-runtime-build-profile-"));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  for (const pluginId of pluginIds) {
    const pluginRoot = path.join(root, "extensions", pluginId);
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, "openclaw.plugin.json"),
      `${JSON.stringify({ id: pluginId })}\n`,
    );
  }
  const manifestPath = path.join(root, "config", "custom-runtime-capabilities.json");
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({
      schema: "openclaw.custom-runtime-capabilities.v2",
      capabilities: manifestPluginIds.map((pluginId) => ({
        id: `plugin:${pluginId}`,
        kind: "plugin",
        pluginId,
      })),
    })}\n`,
  );
  return { root, manifestPath };
}

describe("custom runtime build profile", () => {
  it("derives the bounded build set from the capability manifest", () => {
    const expected = ["apps", ...REQUIRED_CERTIFICATION_PLUGIN_IDS].toSorted();
    const { root, manifestPath } = fixture(expected);

    expect(resolveCustomRuntimeBuildPluginIds({ repoRoot: root, manifestPath })).toMatchObject({
      bundledPluginIds: expected,
      externalPluginIds: [],
      bundledRuntimePluginIds: expected,
    });
  });

  it("fails closed before a build can omit a certification provider", () => {
    const { root, manifestPath } = fixture(["codex", "discord", "searxng"]);

    expect(() => resolveCustomRuntimeBuildPluginIds({ repoRoot: root, manifestPath })).toThrow(
      "Custom runtime certification plugins are missing: ollama",
    );
  });

  it("builds a source plugin even when the preservation manifest omitted it", () => {
    const { root, manifestPath } = fixture(
      ["apps", ...REQUIRED_CERTIFICATION_PLUGIN_IDS, "memory-core"],
      ["apps", ...REQUIRED_CERTIFICATION_PLUGIN_IDS],
    );

    expect(resolveCustomRuntimeBuildPluginIds({ repoRoot: root, manifestPath })).toMatchObject({
      bundledPluginIds: expect.arrayContaining(["memory-core"]),
      bundledRuntimePluginIds: expect.arrayContaining(["memory-core"]),
    });
  });

  it("excludes non-packaged QA support plugins from the runtime closure", () => {
    const pluginIds = ["apps", ...REQUIRED_CERTIFICATION_PLUGIN_IDS, "qa-channel"];
    const { root, manifestPath } = fixture(
      pluginIds,
      pluginIds.filter((id) => id !== "qa-channel"),
    );

    expect(resolveCustomRuntimeBuildPluginIds({ repoRoot: root, manifestPath })).toMatchObject({
      bundledPluginIds: expect.arrayContaining(["qa-channel"]),
      bundledRuntimePluginIds: expect.not.arrayContaining(["qa-channel"]),
    });
  });

  it("rejects a configured non-packaged QA support plugin", () => {
    const pluginIds = ["apps", ...REQUIRED_CERTIFICATION_PLUGIN_IDS, "qa-channel"];
    const { root, manifestPath } = fixture(pluginIds);

    expect(() => resolveCustomRuntimeBuildPluginIds({ repoRoot: root, manifestPath })).toThrow(
      "Configured bundled plugin is not buildable: qa-channel",
    );
  });

  it("binds the checked-in capability manifest to all certification plugins", () => {
    const repoRoot = fs.realpathSync(process.cwd());
    const manifestPath = path.join(repoRoot, "config", "custom-runtime-capabilities.json");

    const result = resolveCustomRuntimeBuildPluginIds({ repoRoot, manifestPath });
    expect([...result.bundledPluginIds, ...result.externalPluginIds]).toEqual(
      expect.arrayContaining([...REQUIRED_CERTIFICATION_PLUGIN_IDS]),
    );
    expect(result.bundledPluginIds).toContain("ollama");
    expect(result.externalPluginIds).toContain("searxng");
  });
});
