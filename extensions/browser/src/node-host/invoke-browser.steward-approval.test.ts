// Browser tests cover the node-host Browser Steward final-effect approval gate.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserStewardGatewayApproval } from "../browser/browser-steward-approval.js";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  startBrowserControlService: vi.fn(async () => true),
  loadConfig: vi.fn(() => ({
    browser: {},
    nodeHost: { browserProxy: { enabled: true, allowProfiles: [] as string[] } },
  })),
}));

vi.mock("../sdk-config.js", () => ({
  getRuntimeConfig: mocks.loadConfig,
  getRuntimeConfigSourceSnapshot: () => null,
}));

vi.mock("../browser/config.js", () => ({
  resolveBrowserConfig: vi.fn(() => ({
    enabled: true,
    defaultProfile: "openclaw",
    profiles: {
      openclaw: {
        name: "openclaw",
        driver: "openclaw",
        cdpUrl: "http://127.0.0.1:9222",
      },
    },
    remoteCdpTimeoutMs: 20_000,
    ssrfPolicy: undefined,
  })),
  resolveProfile: vi.fn(
    (resolved: { profiles?: Record<string, unknown> }, name: string) =>
      resolved.profiles?.[name] ?? null,
  ),
}));

vi.mock("../browser-proxy-upload.js", () => ({
  stageBrowserProxyUploadRequest: vi.fn(async ({ body }: { body: unknown }) => ({ body })),
  discardStagedBrowserProxyUpload: vi.fn(async () => undefined),
  ensureBrowserProxyUploadCleanup: vi.fn(async () => undefined),
}));

vi.mock("../browser/request-policy.js", () => ({
  isPersistentBrowserProfileMutation: vi.fn(() => false),
  isBrowserHostLocalRoute: vi.fn(() => false),
  normalizeBrowserRequestPath: vi.fn((path: string) => path),
  resolveRequestedBrowserProfile: vi.fn(({ profile }: { profile?: string }) =>
    profile?.trim() ? profile.trim() : undefined,
  ),
}));

vi.mock("../browser/routes/dispatcher.js", () => ({
  createBrowserRouteDispatcher: vi.fn(() => ({ dispatch: mocks.dispatch })),
}));

vi.mock("../control-service.js", () => ({
  createBrowserControlContext: vi.fn(() => ({ control: true })),
  getBrowserControlState: vi.fn(() => null),
  startBrowserControlServiceFromConfig: mocks.startBrowserControlService,
}));

vi.mock("../browser/cdp.helpers.js", () => ({
  closeTrackedCdpTarget: vi.fn(),
  redactCdpUrl: vi.fn((url: string) => url),
}));

vi.mock("../browser/cdp-reachability-policy.js", () => ({
  resolveCdpControlPolicy: vi.fn(),
}));

vi.mock("../sdk-setup-tools.js", () => ({ detectMime: vi.fn(async () => "text/plain") }));

const { runBrowserProxyCommand } = await import("./invoke-browser.js");

const baseParams = {
  method: "POST",
  path: "/tabs/open",
  body: { url: "https://example.com" },
  profile: "openclaw",
  agentSessionKey: "agent:browser-session-credential-steward:node-run",
  agentId: "browser-session-credential-steward",
  nodeId: "node-1",
  pairingGeneration: "pairing-1",
  invocationId: "invoke-1",
} as const;

describe("node-host Browser Steward approval", () => {
  beforeEach(() => {
    mocks.dispatch.mockReset();
    mocks.startBrowserControlService.mockClear().mockResolvedValue(true);
  });

  it("rejects a Browser Steward mutation when Gateway approval is absent", async () => {
    await expect(runBrowserProxyCommand(JSON.stringify(baseParams))).rejects.toThrow(
      /approval_required/,
    );
    expect(mocks.startBrowserControlService).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("redeems only an exact redacted Gateway approval", async () => {
    mocks.dispatch.mockResolvedValueOnce({ status: 200, body: { ok: true } });
    const approval = createBrowserStewardGatewayApproval({
      command: "browser.proxy",
      ...baseParams,
    });

    await expect(
      runBrowserProxyCommand(
        JSON.stringify({ ...baseParams, browserStewardApproval: approval }),
        "browser.proxy",
        undefined,
        { nodeId: "node-1", pairingGeneration: "pairing-1", invocationId: "invoke-1" },
      ),
    ).resolves.toBe(JSON.stringify({ result: { ok: true } }));
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    expect(JSON.stringify(approval)).not.toContain("node-run");

    await expect(
      runBrowserProxyCommand(
        JSON.stringify({
          ...baseParams,
          body: { url: "https://example.com/changed" },
          browserStewardApproval: approval,
        }),
        "browser.proxy",
        undefined,
        { nodeId: "node-1", pairingGeneration: "pairing-1", invocationId: "invoke-1" },
      ),
    ).rejects.toThrow(/approval_required/);
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it("rejects replay on a different node or invocation and consumes once", async () => {
    const approval = createBrowserStewardGatewayApproval({
      command: "browser.proxy",
      ...baseParams,
      invocationId: "invoke-replay",
    });
    mocks.dispatch.mockResolvedValue({ status: 200, body: { ok: true } });

    await expect(
      runBrowserProxyCommand(
        JSON.stringify({ ...baseParams, browserStewardApproval: approval }),
        "browser.proxy",
        undefined,
        { nodeId: "other-node", pairingGeneration: "pairing-1", invocationId: "invoke-replay" },
      ),
    ).rejects.toThrow(/approval_required/);
    await expect(
      runBrowserProxyCommand(
        JSON.stringify({ ...baseParams, browserStewardApproval: approval }),
        "browser.proxy",
        undefined,
        { nodeId: "node-1", pairingGeneration: "pairing-1", invocationId: "other-invocation" },
      ),
    ).rejects.toThrow(/approval_required/);
    await expect(
      runBrowserProxyCommand(
        JSON.stringify({ ...baseParams, browserStewardApproval: approval }),
        "browser.proxy",
        undefined,
        { nodeId: "node-1", pairingGeneration: "pairing-1", invocationId: "invoke-replay" },
      ),
    ).resolves.toBe(JSON.stringify({ result: { ok: true } }));
    await expect(
      runBrowserProxyCommand(
        JSON.stringify({ ...baseParams, browserStewardApproval: approval }),
        "browser.proxy",
        undefined,
        { nodeId: "node-1", pairingGeneration: "pairing-1", invocationId: "invoke-replay" },
      ),
    ).rejects.toThrow(/approval_required/);
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it("rejects a node frame whose authenticated pairing generation differs", async () => {
    const approval = createBrowserStewardGatewayApproval({
      command: "browser.proxy",
      ...baseParams,
      invocationId: "invoke-generation",
    });

    await expect(
      runBrowserProxyCommand(
        JSON.stringify({ ...baseParams, browserStewardApproval: approval }),
        "browser.proxy",
        undefined,
        {
          nodeId: "node-1",
          pairingGeneration: "pairing-2",
          invocationId: "invoke-generation",
        },
      ),
    ).rejects.toThrow(/approval_required/);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
