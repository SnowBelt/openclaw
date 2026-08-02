import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_RESEARCH_MANAGER_CONFIG } from "./src/config.js";

type PluginManifest = {
  id?: string;
  enabledByDefault?: boolean;
  contracts?: { tools?: string[] };
  toolMetadata?: Record<string, { optional?: boolean }>;
  configSchema?: {
    properties?: Record<
      string,
      { default?: unknown; properties?: Record<string, { default?: unknown }> }
    >;
  };
};

describe("research-manager package and plugin manifests", () => {
  it("declares every runtime dependency and the preflight command", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    expect(packageJson.dependencies).toMatchObject({
      "@mozilla/readability": expect.any(String),
      linkedom: expect.any(String),
      "pdfjs-dist": expect.any(String),
      typebox: expect.any(String),
    });
    expect(packageJson.scripts?.["qa:configure"]).toBe("node qa/configure-active.mjs");
    expect(packageJson.scripts?.["qa:preflight"]).toBe("node qa/preflight.mjs");
  });

  it("keeps remote spending opt-in and manifest defaults aligned with runtime defaults", () => {
    const manifest = JSON.parse(
      fs.readFileSync(new URL("./openclaw.plugin.json", import.meta.url), "utf8"),
    ) as PluginManifest;
    expect(manifest.id).toBe("research-manager");
    expect(manifest.enabledByDefault).not.toBe(true);
    expect(manifest.contracts?.tools).toEqual(["research-manager"]);
    expect(manifest.toolMetadata?.["research-manager"]?.optional).toBe(true);
    expect(manifest.configSchema?.properties?.certificationThreshold?.default).toBe(
      DEFAULT_RESEARCH_MANAGER_CONFIG.certificationThreshold,
    );
    expect(manifest.configSchema?.properties?.resourceLimits?.properties).toMatchObject({
      softMemoryGb: { default: DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.softMemoryGb },
      hardMemoryGb: { default: DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.hardMemoryGb },
      absoluteMemoryGb: {
        default: DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.absoluteMemoryGb,
      },
      maxLocalParallel: {
        default: DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.maxLocalParallel,
      },
      maxLogicalWorkers: {
        default: DEFAULT_RESEARCH_MANAGER_CONFIG.resourceLimits.maxLogicalWorkers,
      },
    });
  });
});
