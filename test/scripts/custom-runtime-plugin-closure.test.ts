import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertRuntimePluginClosure,
  collectBundledRuntimePluginIds,
  collectConfiguredRuntimePluginIds,
  collectExternalRuntimePluginIds,
} from "../../scripts/custom-runtime/custom-runtime-plugin-closure.mjs";

const roots: string[] = [];

function writeFile(root: string, relativePath: string, contents: string): string {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("custom runtime plugin closure", () => {
  it("collects enabled allow, entry, and explicit slot references deterministically", () => {
    expect(
      collectConfiguredRuntimePluginIds({
        plugins: {
          allow: ["apps", "disabled-entry", "denied"],
          deny: ["denied"],
          entries: {
            configured: { enabled: true },
            "disabled-entry": { enabled: false },
            denied: { enabled: true },
          },
          slots: { memory: "memory-core", contextEngine: "legacy" },
        },
      }),
    ).toEqual(["apps", "configured", "memory-core"]);
  });

  it("does not invent a default memory plugin when no memory slot is explicit", () => {
    expect(collectConfiguredRuntimePluginIds({ plugins: { allow: ["apps"] } })).toEqual(["apps"]);
  });

  it("rejects malformed configuration instead of treating it as empty", () => {
    expect(() => collectConfiguredRuntimePluginIds({ plugins: { allow: "apps" } })).toThrow(
      "Runtime config plugins.allow must be an array",
    );
    expect(() => collectConfiguredRuntimePluginIds({ plugins: { slots: { memory: "" } } })).toThrow(
      "Runtime config plugins.slots.memory contains an invalid plugin id",
    );
  });

  it("reads external manifests and rejects unavailable or conflicting paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "custom-runtime-plugin-closure-"));
    roots.push(root);
    const pluginA = writeFile(
      root,
      "plugin-a/openclaw.plugin.json",
      `${JSON.stringify({ id: "plugin-a" })}\n`,
    );
    expect(
      collectExternalRuntimePluginIds({ plugins: { load: { paths: [path.dirname(pluginA)] } } }),
    ).toEqual(["plugin-a"]);
    expect(() =>
      collectExternalRuntimePluginIds({
        plugins: { load: { paths: [path.join(root, "missing")] } },
      }),
    ).toThrow("Runtime plugin load path is unavailable");
  });

  it("uses manifest ids for bundled plugins instead of assuming directory names", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "custom-runtime-bundled-plugins-"));
    roots.push(root);
    writeFile(root, "dist-runtime/extensions/kimi-coding/openclaw.plugin.json", '{"id":"kimi"}\n');
    writeFile(
      root,
      "dist-runtime/extensions/memory-core/openclaw.plugin.json",
      '{"id":"memory-core"}\n',
    );

    expect(collectBundledRuntimePluginIds(root)).toEqual(["kimi", "memory-core"]);
  });

  it("fails closed for a missing configured plugin and returns sorted proof when complete", () => {
    expect(() =>
      assertRuntimePluginClosure({
        configuredPluginIds: ["memory-core", "apps"],
        bundledPluginIds: ["apps"],
        externalPluginIds: [],
      }),
    ).toThrow("Runtime plugin closure is incomplete: memory-core");
    expect(
      assertRuntimePluginClosure({
        configuredPluginIds: ["memory-core", "apps"],
        bundledPluginIds: ["memory-core"],
        externalPluginIds: ["apps"],
      }),
    ).toEqual({
      configuredPluginIds: ["apps", "memory-core"],
      bundledPluginIds: ["memory-core"],
      externalPluginIds: ["apps"],
    });
  });
});
