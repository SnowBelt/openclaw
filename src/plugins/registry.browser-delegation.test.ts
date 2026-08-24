import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { registerBrowserNodeDelegation } from "../plugin-sdk/browser-node-delegation-runtime.js";
import { createPluginRecord } from "./loader-records.js";
import { markPluginRegistryActive } from "./registry-lifecycle.js";
import { createPluginRegistry } from "./registry.js";
import { getPluginRuntimeGatewayRequestScope } from "./runtime/gateway-request-scope.js";
import { createPluginRuntime } from "./runtime/index.js";

function createTestRegistry() {
  return createPluginRegistry({
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    runtime: createPluginRuntime(),
    activateGlobalSideEffects: false,
  });
}

describe("plugin registry Browser node delegation", () => {
  it("exposes delegation to registered consumers and revokes stale handles", async () => {
    const pluginRegistry = createTestRegistry();
    const browserRecord = createPluginRecord({
      id: "browser",
      source: "/plugins/browser/index.js",
      origin: "bundled",
      enabled: true,
      configSchema: false,
    });
    const request = vi.fn(async (params: unknown) => params);
    const browserApi = pluginRegistry.createApi(browserRecord, {
      config: {} as OpenClawConfig,
    });
    expect("registerBrowserNodeDelegation" in browserApi).toBe(false);
    registerBrowserNodeDelegation(browserApi, {
      consumerPluginIds: ["google-meet"],
      request,
    });

    const consumerRecord = createPluginRecord({
      id: "google-meet",
      source: "/plugins/google-meet/index.js",
      origin: "bundled",
      enabled: true,
      configSchema: false,
    });
    const consumerRuntime = pluginRegistry.createApi(consumerRecord, {
      config: {} as OpenClawConfig,
    }).runtime;
    const browserCapability = consumerRuntime.browser;
    pluginRegistry.registry.plugins.push(consumerRecord);
    markPluginRegistryActive(pluginRegistry.registry);
    await browserCapability?.request({
      method: "GET",
      path: "/profiles",
      timeoutMs: 1_000,
      nodeId: "node-1",
    });
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/profiles",
      timeoutMs: 1_000,
      nodeId: "node-1",
      consumerPluginId: "google-meet",
    });

    const unrelatedRuntime = pluginRegistry.createApi(
      createPluginRecord({
        id: "unrelated",
        source: "/plugins/unrelated/index.js",
        origin: "global",
        enabled: true,
        configSchema: false,
      }),
      { config: {} as OpenClawConfig },
    ).runtime;
    expect(unrelatedRuntime.browser).toBeUndefined();

    pluginRegistry.registry.browserNodeDelegations.length = 0;
    await expect(
      browserCapability?.request({
        method: "GET",
        path: "/profiles",
        timeoutMs: 1_000,
        nodeId: "node-1",
      }),
    ).rejects.toThrow("Browser node delegation is no longer active.");
  });

  it("rejects a retained capability after the consumer lifecycle is rolled back", async () => {
    const pluginRegistry = createTestRegistry();
    const browserRecord = createPluginRecord({
      id: "browser",
      source: "/plugins/browser/index.js",
      origin: "bundled",
      enabled: true,
      configSchema: false,
    });
    const request = vi.fn(async (params: unknown) => params);
    registerBrowserNodeDelegation(
      pluginRegistry.createApi(browserRecord, {
        config: {} as OpenClawConfig,
      }),
      {
        consumerPluginIds: ["google-meet"],
        request,
      },
    );
    const consumerRecord = createPluginRecord({
      id: "google-meet",
      source: "/plugins/google-meet/index.js",
      origin: "bundled",
      enabled: true,
      configSchema: false,
    });
    const consumerRuntime = pluginRegistry.createApi(consumerRecord, {
      config: {} as OpenClawConfig,
    }).runtime;
    pluginRegistry.registry.plugins.push(consumerRecord);
    markPluginRegistryActive(pluginRegistry.registry);
    const browserCapability = consumerRuntime.browser;

    await expect(
      browserCapability?.request({
        method: "GET",
        path: "/profiles",
        timeoutMs: 1_000,
        nodeId: "node-1",
      }),
    ).resolves.toBeDefined();

    pluginRegistry.rollbackPluginGlobalSideEffects("google-meet", consumerRecord);

    await expect(
      browserCapability?.request({
        method: "GET",
        path: "/profiles",
        timeoutMs: 1_000,
        nodeId: "node-1",
      }),
    ).rejects.toThrow("Browser node delegation consumer lifecycle is no longer active.");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("carries consumer lifecycle authority into the Browser effect boundary", async () => {
    const pluginRegistry = createTestRegistry();
    const browserRecord = createPluginRecord({
      id: "browser",
      source: "/plugins/browser/index.js",
      origin: "bundled",
      enabled: true,
      configSchema: false,
    });
    let effectAuthority: (() => boolean) | undefined;
    const request = vi.fn(async () => {
      effectAuthority = getPluginRuntimeGatewayRequestScope()?.pluginRuntimeAuthority;
      return { ok: true };
    });
    registerBrowserNodeDelegation(
      pluginRegistry.createApi(browserRecord, {
        config: {} as OpenClawConfig,
      }),
      {
        consumerPluginIds: ["google-meet"],
        request,
      },
    );
    const consumerRecord = createPluginRecord({
      id: "google-meet",
      source: "/plugins/google-meet/index.js",
      origin: "bundled",
      enabled: true,
      configSchema: false,
    });
    const consumerRuntime = pluginRegistry.createApi(consumerRecord, {
      config: {} as OpenClawConfig,
    }).runtime;
    pluginRegistry.registry.plugins.push(consumerRecord);
    markPluginRegistryActive(pluginRegistry.registry);

    await consumerRuntime.browser?.request({
      method: "GET",
      path: "/profiles",
      timeoutMs: 1_000,
      nodeId: "node-1",
    });

    expect(effectAuthority?.()).toBe(true);
    pluginRegistry.rollbackPluginGlobalSideEffects("google-meet", consumerRecord);
    expect(effectAuthority?.()).toBe(false);
  });

  it("rejects delegation registration from a non-Browser plugin", () => {
    const pluginRegistry = createTestRegistry();
    const api = pluginRegistry.createApi(
      createPluginRecord({
        id: "google-meet",
        source: "/plugins/google-meet/index.js",
        origin: "bundled",
        enabled: true,
        configSchema: false,
      }),
      { config: {} as OpenClawConfig },
    );
    registerBrowserNodeDelegation(api, {
      consumerPluginIds: ["google-meet"],
      request: async () => undefined,
    });

    expect(pluginRegistry.registry.browserNodeDelegations).toEqual([]);
    expect(pluginRegistry.registry.diagnostics).toContainEqual(
      expect.objectContaining({
        level: "error",
        pluginId: "google-meet",
        message: "browser node delegation may only be registered by the browser plugin",
      }),
    );
  });

  it("prints a redacted final-effect proof for allowed and revoked Browser I/O", async () => {
    const pluginRegistry = createTestRegistry();
    const browserRecord = createPluginRecord({
      id: "browser",
      source: "/plugins/browser/index.js",
      origin: "bundled",
      enabled: true,
      configSchema: false,
    });
    const request = vi.fn(async () => ({ ok: true }));
    registerBrowserNodeDelegation(
      pluginRegistry.createApi(browserRecord, { config: {} as OpenClawConfig }),
      {
        consumerPluginIds: ["google-meet"],
        request,
      },
    );
    const consumerRecord = createPluginRecord({
      id: "google-meet",
      source: "/plugins/google-meet/index.js",
      origin: "bundled",
      enabled: true,
      configSchema: false,
    });
    const consumerRuntime = pluginRegistry.createApi(consumerRecord, {
      config: {} as OpenClawConfig,
    }).runtime;
    pluginRegistry.registry.plugins.push(consumerRecord);
    markPluginRegistryActive(pluginRegistry.registry);
    const browserCapability = consumerRuntime.browser;

    await browserCapability?.request({
      method: "GET",
      path: "/profiles",
      timeoutMs: 1_000,
      nodeId: "node-1",
    });
    pluginRegistry.rollbackPluginGlobalSideEffects("google-meet", consumerRecord);
    await expect(
      browserCapability?.request({
        method: "GET",
        path: "/profiles",
        timeoutMs: 1_000,
        nodeId: "node-1",
      }),
    ).rejects.toThrow();

    const proof = {
      allowed: {
        decision: "allow",
        browserIo: request.mock.calls.length === 1 ? "called" : "not_called",
      },
      rejected: {
        decision: "reject",
        browserIo: request.mock.calls.length === 1 ? "not_called" : "called",
        ordering: "reject_before_io",
      },
      redaction: "opaque-identifiers-only",
    } as const;
    expect(proof).toEqual({
      allowed: { decision: "allow", browserIo: "called" },
      rejected: {
        decision: "reject",
        browserIo: "not_called",
        ordering: "reject_before_io",
      },
      redaction: "opaque-identifiers-only",
    });
    process.stdout.write(`BROWSER_STEWARD_FINAL_EFFECT_PROOF ${JSON.stringify(proof)}\n`);
  });
});
