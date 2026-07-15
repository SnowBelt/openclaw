import { describe, expect, it } from "vitest";
import {
  CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
  parseCustomRuntimeCapabilityManifest,
  validateCustomRuntimeCapabilityManifest,
} from "./custom-runtime-capabilities.js";

describe("custom runtime capability manifest", () => {
  it("accepts a complete, path-safe capability inventory", () => {
    const manifest = parseCustomRuntimeCapabilityManifest({
      schema: CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
      version: 1,
      capabilities: [
        {
          id: "dashboard:pcc",
          kind: "dashboard_surface",
          surfaceId: "pcc",
          requiredPaths: ["dist/control-ui/dashboard-surfaces.json"],
        },
        {
          id: "plugin:apps",
          kind: "plugin",
          pluginId: "apps",
          requiredPaths: ["extensions/apps/openclaw.plugin.json"],
        },
      ],
    });

    expect(manifest).not.toBeNull();
    expect(
      validateCustomRuntimeCapabilityManifest({
        manifest: manifest!,
        dashboardSurfaceIds: ["pcc"],
      }),
    ).toEqual([]);
  });

  it("rejects path traversal, duplicate ids, and a weakened dashboard inventory", () => {
    const manifest = parseCustomRuntimeCapabilityManifest({
      schema: CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
      version: 1,
      capabilities: [
        {
          id: "plugin:apps",
          kind: "plugin",
          pluginId: "apps",
          requiredPaths: ["../outside"],
        },
        {
          id: "plugin:apps",
          kind: "plugin",
          pluginId: "apps",
          requiredPaths: ["extensions/apps/openclaw.plugin.json"],
        },
      ],
    });

    expect(manifest).not.toBeNull();
    expect(
      validateCustomRuntimeCapabilityManifest({
        manifest: manifest!,
        dashboardSurfaceIds: ["pcc"],
      }),
    ).toEqual(
      expect.arrayContaining([
        "Custom capability plugin:apps has an unsafe required path.",
        "Duplicate custom capability id: plugin:apps",
        expect.stringContaining("Dashboard capability inventory must match"),
      ]),
    );
  });
});
