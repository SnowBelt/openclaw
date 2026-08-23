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
});
