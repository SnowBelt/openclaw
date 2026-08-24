import { describe, expect, it, vi } from "vitest";

describe("Browser Steward runtime approval", () => {
  const hostBinding = { backend: { kind: "host" as const } };

  it("survives separate plugin module instances without becoming JSON-forgeable", async () => {
    const firstModule = await import("./browser-steward-approval.js");
    const rawParams = {
      action: "act",
      request: { kind: "type", text: "synthetic-secret" },
    };
    const approvedParams = firstModule.markBrowserStewardRuntimeApproved(
      rawParams,
      {
        action: "act",
        credentialMaterial: "REDACTED",
      },
      hostBinding,
    );

    vi.resetModules();
    const secondModule = await import("./browser-steward-approval.js");

    expect(secondModule.isBrowserStewardRuntimeApproved(approvedParams)).toBe(true);
    expect(secondModule.resolveBrowserStewardRuntimeApprovedParams(approvedParams)).toEqual(
      rawParams,
    );
    const serializedParams = JSON.stringify(approvedParams);
    expect(JSON.parse(serializedParams)).toEqual({
      action: "act",
      credentialMaterial: "REDACTED",
    });
    expect(secondModule.isBrowserStewardRuntimeApproved({ approved: true })).toBe(false);
  });

  it("invalidates approval when downstream code rewrites the approved operation", async () => {
    const module = await import("./browser-steward-approval.js");
    const rawParams = {
      action: "act",
      request: { kind: "type", text: "synthetic-secret" },
    };
    const approvedParams = module.markBrowserStewardRuntimeApproved(
      rawParams,
      {
        action: "act",
        credentialMaterial: "REDACTED",
      },
      hostBinding,
    );
    const rewrittenRequest = { kind: "type", text: "policy-replacement" };

    const rewritten = {
      ...approvedParams,
      request: rewrittenRequest,
    };
    const resolved = module.resolveBrowserStewardRuntimeApprovedParams(rewritten);

    expect(module.isBrowserStewardRuntimeApproved(rewritten)).toBe(false);
    expect(resolved).toEqual(rewritten);
    expect(JSON.stringify(resolved)).not.toContain("synthetic-secret");
  });

  it("invalidates approval when downstream code mutates nested public parameters", async () => {
    const module = await import("./browser-steward-approval.js");
    const rawParams = {
      action: "act",
      request: { kind: "type", text: "synthetic-secret" },
    };
    const approvedParams = module.markBrowserStewardRuntimeApproved(
      rawParams,
      {
        action: "act",
        request: { kind: "type", text: "REDACTED" },
      },
      hostBinding,
    );
    const request = approvedParams.request as Record<string, unknown>;
    request.kind = "evaluate";

    expect(module.isBrowserStewardRuntimeApproved(approvedParams)).toBe(false);
    expect(module.resolveBrowserStewardRuntimeApprovedParams(approvedParams)).toBe(approvedParams);
    expect(JSON.stringify(approvedParams)).not.toContain("synthetic-secret");
  });

  it("restores an immutable snapshot of raw parameters after approval", async () => {
    const module = await import("./browser-steward-approval.js");
    const rawParams = {
      action: "act",
      request: { kind: "type", text: "original-secret" },
    };
    const approvedParams = module.markBrowserStewardRuntimeApproved(
      rawParams,
      {
        action: "act",
        request: { kind: "type", text: "REDACTED" },
      },
      hostBinding,
    );
    rawParams.request.text = "mutated-after-approval";

    const firstResolved = module.resolveBrowserStewardRuntimeApprovedParams(approvedParams);
    expect(firstResolved).toEqual({
      action: "act",
      request: { kind: "type", text: "original-secret" },
    });
    (firstResolved.request as Record<string, unknown>).text = "mutated-resolved-copy";
    expect(module.resolveBrowserStewardRuntimeApprovedParams(approvedParams)).toEqual({
      action: "act",
      request: { kind: "type", text: "original-secret" },
    });
  });

  it("keeps pending params redacted until the Browser approval itself resolves", async () => {
    const module = await import("./browser-steward-approval.js");
    const rawParams = { action: "act", password: "synthetic-secret" };
    const pendingParams = module.markBrowserStewardRuntimeApprovalPending(
      rawParams,
      {
        action: "act",
        password: "REDACTED",
      },
      hostBinding,
    );

    expect(module.isBrowserStewardRuntimeApproved(pendingParams)).toBe(false);
    for (const symbol of Object.getOwnPropertySymbols(pendingParams)) {
      expect(JSON.stringify(Reflect.get(pendingParams, symbol))).not.toContain("synthetic-secret");
    }
    expect(
      structuredClone(module.resolveBrowserStewardRuntimeApprovedParams(pendingParams)),
    ).toEqual({
      action: "act",
      password: "REDACTED",
    });

    module.approveBrowserStewardRuntimeParams(pendingParams);

    expect(module.isBrowserStewardRuntimeApproved(pendingParams)).toBe(true);
    expect(module.resolveBrowserStewardRuntimeApprovedParams(pendingParams)).toEqual(rawParams);
  });

  it("redacts prepared credential material while retaining it only for trusted policy resolution", async () => {
    const module = await import("./browser-steward-approval.js");
    const rawParams = {
      action: "upload",
      paths: ["/tmp/private-key.pem"],
      request: { kind: "type", text: "prepared-secret" },
      authorization: "Bearer prepared-token",
    };
    const prepared = module.prepareBrowserStewardRuntimeParams(rawParams) as Record<
      string,
      unknown
    >;

    expect(JSON.stringify(prepared)).not.toContain("prepared-secret");
    expect(JSON.stringify(prepared)).not.toContain("prepared-token");
    expect(JSON.stringify(prepared)).not.toContain("private-key.pem");
    expect(module.resolveBrowserStewardRuntimePolicyParams(prepared)).toEqual(rawParams);
    expect(module.resolveBrowserStewardRuntimeApprovedParams(prepared)).toEqual(prepared);
  });

  it("creates a redacted approval envelope bound to the exact browser request", async () => {
    const module = await import("./browser-steward-approval.js");
    const request = {
      command: "browser.proxy",
      method: "POST",
      path: "/act",
      body: { kind: "type", text: "raw-browser-secret" },
      profile: "openclaw",
      agentSessionKey: "agent:browser-session-credential-steward:direct:user-123",
      agentId: "browser-session-credential-steward",
      nodeId: "node-1",
      pairingGeneration: "pairing-1",
      invocationId: "invoke-1",
    } as const;
    const approval = module.createBrowserStewardGatewayApproval(request);

    expect(approval).toMatchObject({
      issuer: "gateway.operator.admin",
      command: "browser.proxy",
      action: "act",
      profile: "openclaw",
      sessionBoundary: {
        kind: "browser_steward",
        ownerAgentId: "browser-session-credential-steward",
        affectedSession: "agent:browser-session-credential-steward:REDACTED",
      },
      nodeId: "node-1",
      pairingGeneration: "pairing-1",
      invocationId: "invoke-1",
    });
    const serialized = JSON.stringify(approval);
    expect(serialized).not.toContain("raw-browser-secret");
    expect(serialized).not.toContain("user-123");
    expect(module.isBrowserStewardGatewayApprovalValid({ approval, ...request })).toBe(true);
    expect(
      module.isBrowserStewardGatewayApprovalValid({
        approval,
        ...request,
        pairingGeneration: "different-pairing",
      }),
    ).toBe(false);
    expect(
      module.isBrowserStewardGatewayApprovalValid({
        approval,
        ...request,
        nowMs: approval.expiresAtMs,
      }),
    ).toBe(false);
    expect(
      module.isBrowserStewardGatewayApprovalValid({
        approval,
        ...request,
        body: { kind: "type", text: "different-secret" },
      }),
    ).toBe(false);
    expect(
      module.isBrowserStewardGatewayApprovalValid({
        approval: { ...approval, action: "navigate" },
        ...request,
      }),
    ).toBe(false);
  });

  it("canonicalizes trailing-slash proxy routes before approval fingerprinting", async () => {
    const module = await import("./browser-steward-approval.js");
    const request = {
      command: "browser.proxy",
      method: "POST",
      path: "/tabs/open/",
      body: { url: "https://example.com" },
      profile: "openclaw",
      agentSessionKey: "agent:browser-session-credential-steward:direct:opaque",
      agentId: "browser-session-credential-steward",
      nodeId: "node-1",
      pairingGeneration: "pairing-1",
      invocationId: "invoke-2",
    } as const;
    const approval = module.createBrowserStewardGatewayApproval(request);

    expect(approval.action).toBe("open");
    expect(module.isBrowserStewardGatewayApprovalValid({ approval, ...request })).toBe(true);
    expect(
      module.isBrowserStewardGatewayApprovalValid({
        approval,
        ...request,
        path: "/tabs/open",
      }),
    ).toBe(true);
  });
});
