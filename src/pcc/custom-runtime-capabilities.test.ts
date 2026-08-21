import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
  findUnregisteredCustomRuntimePaths,
  parseCustomRuntimeCapabilityManifest,
  validateCustomRuntimeCapabilityManifest,
} from "./custom-runtime-capabilities.js";

describe("custom runtime capability manifest", () => {
  const controlDirectorChatPaths = [
    "ui/src/pages/chat/chat-pane.ts",
    "ui/src/pages/chat/chat-controls.test.ts",
    "ui/src/pages/chat/chat-view.test.ts",
    "ui/src/pages/chat/components/chat-model-controls.ts",
    "ui/src/lib/chat/control-director-thinking.ts",
    "ui/src/lib/chat/model-select-state.ts",
    "ui/src/lib/chat/model-select-state.test.ts",
    "ui/src/styles/chat/layout.css",
    "ui/src/api/types.ts",
    "src/gateway/server.chat.gateway-server-chat-b.test.ts",
    "src/gateway/session-event-payload.ts",
    "src/gateway/server.sessions.list-changed.test.ts",
    "src/gateway/session-utils.ts",
    "src/gateway/session-utils.types.ts",
  ];

  const preservation = {
    contractVersion: 2,
    criticality: "required",
    migrationPolicy: "preserve_or_block",
    rollbackPolicy: "immutable_release_pointer",
    sourceStrategy: "merge_from_active_sha",
    dashboardChangePolicy: "register_verify_and_block",
    approvalPolicy: "explicit_exact_candidate",
    proofCommand: "pnpm custom-runtime:update-survival",
    standardsRegistry: "src/pcc/capability-addition-registry.ts",
    verificationCommands: ["pnpm check:custom-runtime-capabilities"],
  } as const;

  it("accepts a complete, path-safe capability inventory", () => {
    const manifest = parseCustomRuntimeCapabilityManifest({
      schema: CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
      version: 2,
      preservation,
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
      version: 2,
      preservation,
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

  it("fails closed when a current manifest omits migration and rollback policy", () => {
    expect(
      parseCustomRuntimeCapabilityManifest({
        schema: CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
        version: 2,
        capabilities: [],
      }),
    ).toBeNull();
  });

  it("fails closed when update-survival policy is absent or weakened", () => {
    expect(
      parseCustomRuntimeCapabilityManifest({
        schema: CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
        version: 2,
        preservation: { ...preservation, dashboardChangePolicy: "best_effort" },
        capabilities: [],
      }),
    ).toBeNull();
    expect(
      parseCustomRuntimeCapabilityManifest({
        schema: CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
        version: 2,
        preservation: { ...preservation, proofCommand: "pnpm test" },
        capabilities: [],
      }),
    ).toBeNull();
  });

  it("reports tracked custom-runtime files without a capability owner", () => {
    const manifest = parseCustomRuntimeCapabilityManifest({
      schema: CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
      version: 5,
      preservation,
      capabilities: [
        {
          id: "runtime:update-safe-customizations",
          kind: "runtime",
          requiredPaths: ["scripts/custom-runtime/registered.sh"],
        },
      ],
    });

    expect(
      findUnregisteredCustomRuntimePaths(manifest!, [
        "scripts/custom-runtime/registered.sh",
        "scripts/custom-runtime/unregistered.ts",
        "src/unrelated.ts",
        "scripts/custom-runtime/unregistered.ts",
      ]),
    ).toEqual(["scripts/custom-runtime/unregistered.ts"]);
  });

  it("preserves the Control Director Chat implementation in the update contract", () => {
    const manifest = parseCustomRuntimeCapabilityManifest(
      JSON.parse(
        readFileSync(
          new URL("../../config/custom-runtime-capabilities.json", import.meta.url),
          "utf8",
        ),
      ) as unknown,
    );
    const capability = manifest?.capabilities.find(
      (entry) => entry.id === "runtime:control-director-codex-chat",
    );

    expect(capability?.requiredPaths).toEqual(expect.arrayContaining(controlDirectorChatPaths));
  });
});
