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

function fixture(pluginIds: string[]) {
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
      capabilities: pluginIds.map((pluginId) => ({
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

    expect(resolveCustomRuntimeBuildPluginIds({ repoRoot: root, manifestPath })).toEqual(expected);
  });

  it("fails closed before a build can omit a certification provider", () => {
    const { root, manifestPath } = fixture(["codex", "discord", "searxng"]);

    expect(() => resolveCustomRuntimeBuildPluginIds({ repoRoot: root, manifestPath })).toThrow(
      "Custom runtime certification plugins are missing: ollama",
    );
  });

  it("binds the checked-in capability manifest to all certification plugins", () => {
    const repoRoot = fs.realpathSync(process.cwd());
    const manifestPath = path.join(repoRoot, "config", "custom-runtime-capabilities.json");

    expect(resolveCustomRuntimeBuildPluginIds({ repoRoot, manifestPath })).toEqual(
      expect.arrayContaining([...REQUIRED_CERTIFICATION_PLUGIN_IDS]),
    );
  });
});
