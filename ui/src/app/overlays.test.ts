// Control UI tests cover application-owned overlay races.
import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient, GatewayEventFrame } from "../api/gateway.ts";
import type { ApplicationGateway, ApplicationGatewaySnapshot } from "./gateway.ts";
import { createApplicationOverlays } from "./overlays.ts";
import "../components/update-banner.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

function deferred<T = unknown>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function approval(id: string, createdAtMs: number) {
  return {
    id,
    createdAtMs,
    expiresAtMs: Date.now() + 60_000,
    request: { command: `echo ${id}` },
  };
}

function createGatewayHarness(initialClient: GatewayBrowserClient) {
  let snapshot: ApplicationGatewaySnapshot = {
    assistantAgentId: "main",
    client: initialClient,
    connected: true,
    reconnecting: false,
    hello: null,
    lastError: null,
    lastErrorCode: null,
    sessionKey: "main",
  };
  const snapshotListeners = new Set<(next: ApplicationGatewaySnapshot) => void>();
  const eventListeners = new Set<(event: GatewayEventFrame) => void>();
  const gateway = {
    get snapshot() {
      return snapshot;
    },
    connection: { gatewayUrl: "ws://gateway.test", password: "", token: "" },
    eventLog: [],
    connect() {},
    setSessionKey() {},
    start() {},
    stop() {},
    subscribe(listener: (next: ApplicationGatewaySnapshot) => void) {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
    subscribeEventLog() {
      return () => {};
    },
    subscribeEvents(listener: (event: GatewayEventFrame) => void) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  } satisfies ApplicationGateway;
  return {
    emitApproval(id: string, createdAtMs: number) {
      const event: GatewayEventFrame = {
        event: "exec.approval.requested",
        payload: approval(id, createdAtMs),
        type: "event",
      };
      for (const listener of eventListeners) {
        listener(event);
      }
    },
    gateway,
    update(next: Partial<ApplicationGatewaySnapshot>) {
      snapshot = { ...snapshot, ...next };
      for (const listener of snapshotListeners) {
        listener(snapshot);
      }
    },
  };
}

function client(request: RequestFn): GatewayBrowserClient {
  return { request } as unknown as GatewayBrowserClient;
}

describe("application approval overlays", () => {
  it("does not attach an older resolve failure to a newer approval", async () => {
    const resolveAttempt = deferred();
    const request = vi.fn<RequestFn>((method) =>
      method.endsWith(".list") ? Promise.resolve([]) : resolveAttempt.promise,
    );
    const harness = createGatewayHarness(client(request));
    const overlays = createApplicationOverlays(harness.gateway);

    harness.emitApproval("approval-active", 1_000);
    const decision = overlays.decideApproval("allow-once");
    harness.emitApproval("approval-newer", 2_000);
    resolveAttempt.reject(new Error("gateway unavailable"));
    await decision;

    expect(overlays.snapshot.approvalQueue.map((entry) => entry.id)).toEqual([
      "approval-newer",
      "approval-active",
    ]);
    expect(overlays.snapshot.approvalError).toBeNull();
    expect(overlays.snapshot.approvalBusy).toBe(false);
    overlays.dispose();
  });

  it("does not release a new client's busy state when an old resolve settles", async () => {
    const oldResolve = deferred();
    const oldRequest = vi.fn<RequestFn>((method) =>
      method.endsWith(".list") ? Promise.resolve([]) : oldResolve.promise,
    );
    const harness = createGatewayHarness(client(oldRequest));
    const overlays = createApplicationOverlays(harness.gateway);

    harness.emitApproval("approval-old", 1_000);
    const oldDecision = overlays.decideApproval("allow-once");
    harness.update({ client: null, connected: false });

    const newResolve = deferred();
    const newClient = client((method) =>
      method.endsWith(".list") ? Promise.resolve([]) : newResolve.promise,
    );
    harness.update({ client: newClient, connected: true });
    await Promise.resolve();
    harness.emitApproval("approval-new", 2_000);
    const newDecision = overlays.decideApproval("deny");
    expect(overlays.snapshot.approvalBusy).toBe(true);

    oldResolve.reject(new Error("gateway client stopped"));
    await oldDecision;
    expect(overlays.snapshot.approvalBusy).toBe(true);
    expect(overlays.snapshot.approvalError).toBeNull();

    newResolve.resolve({ ok: true });
    await newDecision;
    expect(overlays.snapshot.approvalBusy).toBe(false);
    expect(overlays.snapshot.approvalQueue).toEqual([]);
    overlays.dispose();
  });
});

describe("application update overlays", () => {
  it("retries the initial safety read after a transient connection failure", async () => {
    vi.useFakeTimers();
    let statusReads = 0;
    const oldClient = client(() => Promise.resolve([]));
    const nextClient = client((method) => {
      if (method === "update.status") {
        statusReads += 1;
        if (statusReads === 1) {
          return Promise.reject(new Error("temporary disconnect"));
        }
        return Promise.resolve({
          updateSafety: {
            managedRuntime: true,
            standardUpdateBlocked: true,
            sourceDurable: true,
            runtimeGuardHealthy: true,
            backupConfigured: true,
            preparationRunning: false,
            preparationStatus: "idle",
          },
        });
      }
      return Promise.resolve([]);
    });
    const harness = createGatewayHarness(oldClient);
    const overlays = createApplicationOverlays(harness.gateway);

    try {
      harness.update({ client: nextClient, connected: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(statusReads).toBe(1);
      expect(overlays.snapshot.updateSafety).toBeNull();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(statusReads).toBe(2);
      expect(overlays.snapshot.updateSafety).toMatchObject({ managedRuntime: true });
    } finally {
      overlays.dispose();
      vi.useRealTimers();
    }
  });

  it("disables the global update action when safety status is unavailable", async () => {
    const element = document.createElement("openclaw-update-banner") as HTMLElement & {
      props: {
        statusBanner: null;
        updateAvailable: { currentVersion: string; latestVersion: string; channel: string };
        updateRunning: boolean;
        updateSafety: null;
        connected: boolean;
        onUpdate: () => void;
        onDismiss: () => void;
      };
      updateComplete: Promise<boolean>;
    };
    element.props = {
      statusBanner: null,
      updateAvailable: {
        currentVersion: "2026.6.8",
        latestVersion: "2099.1.1",
        channel: "latest",
      },
      updateRunning: false,
      updateSafety: null,
      connected: true,
      onUpdate: vi.fn(),
      onDismiss: vi.fn(),
    };
    document.body.append(element);
    try {
      await element.updateComplete;
      const button = element.querySelector<HTMLButtonElement>(".update-banner__btn");
      expect(button?.disabled).toBe(true);
      expect(button?.textContent).toContain("Update protection needs attention");
    } finally {
      element.remove();
    }
  });

  it("disables the global update action when the managed runtime pointer is invalid", async () => {
    const element = document.createElement("openclaw-update-banner") as HTMLElement & {
      props: Record<string, unknown>;
      updateComplete: Promise<boolean>;
    };
    element.props = {
      statusBanner: null,
      updateAvailable: {
        currentVersion: "2026.6.8",
        latestVersion: "2099.1.2",
        channel: "latest",
      },
      updateRunning: false,
      updateSafety: {
        managedRuntime: true,
        standardUpdateBlocked: true,
        sourceDurable: false,
        sourceDurabilityReason: "missing",
        runtimeGuardHealthy: false,
        runtimeGuardReason: "missing",
        backupConfigured: false,
        approvalPending: false,
        pendingCandidateSha: null,
        preparationRunning: false,
        preparationStatus: "blocked",
        preparationReason: "invalid-active-runtime-pointer",
        sourceSha: null,
        sourceRepo: null,
        sourceBranch: null,
        runtimeRoot: null,
        pointerPath: "/missing/active-runtime.json",
        reason: "missing pointer",
      },
      connected: true,
      onUpdate: vi.fn(),
      onDismiss: vi.fn(),
    };
    document.body.append(element);
    try {
      await element.updateComplete;
      const button = element.querySelector<HTMLButtonElement>(".update-banner__btn");
      expect(button?.disabled).toBe(true);
      expect(button?.textContent).toContain("Update protection needs attention");
    } finally {
      element.remove();
    }
  });

  it("disables the global update action while verified installation is active", async () => {
    const element = document.createElement("openclaw-update-banner") as HTMLElement & {
      props: Record<string, unknown>;
      updateComplete: Promise<boolean>;
    };
    element.props = {
      statusBanner: null,
      updateAvailable: {
        currentVersion: "2026.6.8",
        latestVersion: "2099.1.3",
        channel: "latest",
      },
      updateRunning: false,
      updateSafety: {
        managedRuntime: true,
        standardUpdateBlocked: true,
        sourceDurable: true,
        sourceDurabilityReason: "durable",
        runtimeGuardHealthy: true,
        runtimeGuardReason: "healthy",
        backupConfigured: true,
        approvalPending: true,
        pendingCandidateSha: "a".repeat(40),
        preparationRunning: false,
        preparationStatus: "installing",
        preparationReason: "installation-running",
        sourceSha: "b".repeat(40),
        sourceRepo: "/source.git",
        sourceBranch: "refs/provenance/source",
        runtimeRoot: "/release",
        pointerPath: "/runtime-home/active-runtime.json",
        reason: "managed",
      },
      connected: true,
      onUpdate: vi.fn(),
      onDismiss: vi.fn(),
    };
    document.body.append(element);
    try {
      await element.updateComplete;
      const button = element.querySelector<HTMLButtonElement>(".update-banner__btn");
      expect(button?.disabled).toBe(true);
      expect(button?.textContent).toContain("Updating");
    } finally {
      element.remove();
    }
  });

  it("preserves active installation tracking when a duplicate action is requested", async () => {
    const candidateSha = "d".repeat(40);
    const request = vi.fn<RequestFn>((method) => {
      if (method === "update.status") {
        return Promise.resolve({
          updateSafety: {
            managedRuntime: true,
            standardUpdateBlocked: true,
            sourceDurable: true,
            sourceDurabilityReason: "durable",
            runtimeGuardHealthy: true,
            runtimeGuardReason: "healthy",
            backupConfigured: true,
            approvalPending: true,
            pendingCandidateSha: candidateSha,
            preparationRunning: false,
            preparationStatus: "installing",
            preparationReason: "installation-running",
            sourceSha: "a".repeat(40),
            sourceRepo: "/source.git",
            sourceBranch: "refs/provenance/source",
            runtimeRoot: "/release",
            pointerPath: "/runtime-home/active-runtime.json",
            reason: "managed",
          },
        });
      }
      return Promise.resolve({ ok: true });
    });
    const harness = createGatewayHarness(client(() => Promise.resolve([])));
    const overlays = createApplicationOverlays(harness.gateway);
    try {
      harness.update({ client: client(request), connected: true });
      await vi.waitFor(() =>
        expect(overlays.snapshot.updateSafety?.preparationStatus).toBe("installing"),
      );
      const updateRunCallsBefore = request.mock.calls.filter(
        ([method]) => method === "update.run",
      ).length;

      await overlays.runUpdate(candidateSha);

      expect(request.mock.calls.filter(([method]) => method === "update.run")).toHaveLength(
        updateRunCallsBefore,
      );
      expect(overlays.snapshot.updateSafety?.preparationStatus).toBe("installing");
    } finally {
      overlays.dispose();
    }
  });

  it("polls isolated preparation until the exact candidate is ready", async () => {
    vi.useFakeTimers();
    const candidateSha = "c".repeat(40);
    let statusReads = 0;
    const request = vi.fn<RequestFn>((method) => {
      if (method === "update.run") {
        return Promise.resolve({
          ok: true,
          result: { status: "skipped", reason: "custom-runtime-update-preparation-started" },
          handoff: { status: "started" },
        });
      }
      if (method === "update.status") {
        statusReads += 1;
        return Promise.resolve({
          updateSafety: {
            managedRuntime: true,
            standardUpdateBlocked: true,
            sourceDurable: true,
            sourceDurabilityReason: "durable",
            runtimeGuardHealthy: true,
            runtimeGuardReason: "healthy",
            backupConfigured: true,
            approvalPending: statusReads > 2,
            pendingCandidateSha: statusReads > 2 ? candidateSha : null,
            preparationRunning: statusReads === 2,
            preparationStatus: statusReads === 2 ? "preparing" : statusReads > 2 ? "ready" : "idle",
            preparationReason: statusReads > 2 ? "ready-for-approval" : null,
            sourceSha: "a".repeat(40),
            sourceRepo: "/source.git",
            sourceBranch: `refs/provenance/${"a".repeat(40)}`,
            runtimeRoot: "/release",
            pointerPath: "/runtime-home/active-runtime.json",
            reason: "managed",
          },
        });
      }
      return Promise.resolve([]);
    });
    const harness = createGatewayHarness(client(request));
    const overlays = createApplicationOverlays(harness.gateway);

    try {
      await overlays.runUpdate();
      await vi.advanceTimersByTimeAsync(0);
      expect(overlays.snapshot.updateSafety?.preparationRunning).toBe(false);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(overlays.snapshot.updateSafety?.preparationRunning).toBe(true);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(overlays.snapshot.updateSafety).toMatchObject({
        preparationRunning: false,
        approvalPending: true,
        pendingCandidateSha: candidateSha,
      });
      expect(statusReads).toBe(3);
    } finally {
      overlays.dispose();
      vi.useRealTimers();
    }
  });

  it("continues polling after a transient update status failure", async () => {
    vi.useFakeTimers();
    const candidateSha = "d".repeat(40);
    let statusReads = 0;
    const request = vi.fn<RequestFn>((method) => {
      if (method === "update.run") {
        return Promise.resolve({
          ok: true,
          result: { status: "skipped", reason: "custom-runtime-update-preparation-started" },
          handoff: { status: "started" },
        });
      }
      if (method === "update.status") {
        statusReads += 1;
        if (statusReads === 2) {
          return Promise.reject(new Error("temporary disconnect"));
        }
        return Promise.resolve({
          updateSafety: {
            managedRuntime: true,
            standardUpdateBlocked: true,
            sourceDurable: true,
            backupConfigured: true,
            approvalPending: statusReads > 2,
            pendingCandidateSha: statusReads > 2 ? candidateSha : null,
            preparationRunning: statusReads === 1,
            preparationStatus: statusReads > 2 ? "ready" : "preparing",
          },
        });
      }
      return Promise.resolve([]);
    });
    const harness = createGatewayHarness(client(request));
    const overlays = createApplicationOverlays(harness.gateway);

    try {
      await overlays.runUpdate();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(statusReads).toBe(3);
      expect(overlays.snapshot.updateSafety).toMatchObject({
        approvalPending: true,
        pendingCandidateSha: candidateSha,
        preparationStatus: "ready",
      });
    } finally {
      overlays.dispose();
      vi.useRealTimers();
    }
  });

  it("surfaces a coalesced restart while reconnect verification remains active", async () => {
    const request = vi.fn<RequestFn>().mockResolvedValue({
      ok: true,
      restart: { coalesced: true },
      result: { status: "ok", after: { version: "2.0.0" } },
    });
    const harness = createGatewayHarness(client(request));
    const overlays = createApplicationOverlays(harness.gateway);

    await overlays.runUpdate();

    expect(request).toHaveBeenCalledWith("update.run", {});
    expect(overlays.snapshot.updateStatusBanner).toEqual({
      tone: "info",
      text: "Update installed. A gateway restart is already in progress; status will refresh after it reconnects.",
    });
    expect(overlays.snapshot.updateRunning).toBe(false);
    overlays.dispose();
  });

  it("passes the exact prepared SHA for one-click managed installation", async () => {
    const candidateSha = "b".repeat(40);
    const request = vi.fn<RequestFn>().mockResolvedValue({
      ok: true,
      result: { status: "skipped", reason: "custom-runtime-update-approval-started" },
      handoff: { status: "started" },
    });
    const harness = createGatewayHarness(client(request));
    const overlays = createApplicationOverlays(harness.gateway);

    await overlays.runUpdate(candidateSha);

    expect(request).toHaveBeenCalledWith("update.run", { approvalSha: candidateSha });
    expect(overlays.snapshot.updateStatusBanner).toEqual({
      tone: "info",
      text: "Verified installation started. The Dashboard will reconnect after the managed restart.",
    });

    const reconnectRequest = vi.fn<RequestFn>((method) =>
      Promise.resolve(
        method === "update.status"
          ? {
              updateSafety: {
                managedRuntime: true,
                standardUpdateBlocked: true,
                sourceDurable: true,
                runtimeGuardHealthy: true,
                backupConfigured: true,
                approvalPending: false,
                pendingCandidateSha: null,
                preparationRunning: false,
                preparationStatus: "idle",
                sourceSha: candidateSha,
              },
            }
          : [],
      ),
    );
    harness.update({ client: client(reconnectRequest), connected: true });
    await vi.waitFor(() => expect(reconnectRequest).toHaveBeenCalledWith("update.status", {}));
    expect(overlays.snapshot.updateStatusBanner).toEqual({
      tone: "info",
      text: "Verified update installed. Runtime identity and browser health checks are complete.",
    });
    overlays.dispose();
  });

  it("retries installation status after a transient read failure", async () => {
    vi.useFakeTimers();
    const candidateSha = "e".repeat(40);
    let statusReads = 0;
    const request = vi.fn<RequestFn>((method) => {
      if (method === "update.run") {
        return Promise.resolve({
          ok: true,
          result: { status: "skipped", reason: "custom-runtime-update-approval-started" },
          handoff: { status: "started" },
        });
      }
      if (method === "update.status") {
        statusReads += 1;
        if (statusReads === 1) {
          return Promise.reject(new Error("temporary disconnect"));
        }
        return Promise.resolve({
          updateSafety: {
            approvalPending: true,
            pendingCandidateSha: candidateSha,
            preparationRunning: true,
            preparationStatus: "installing",
          },
        });
      }
      return Promise.resolve([]);
    });
    const harness = createGatewayHarness(client(request));
    const overlays = createApplicationOverlays(harness.gateway);

    try {
      await overlays.runUpdate(candidateSha);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(statusReads).toBe(2);
      expect(overlays.snapshot.updateSafety).toMatchObject({
        pendingCandidateSha: candidateSha,
        preparationStatus: "installing",
      });
    } finally {
      overlays.dispose();
      vi.useRealTimers();
    }
  });

  it("keeps polling when installation status initially returns the ready snapshot", async () => {
    vi.useFakeTimers();
    const candidateSha = "f".repeat(40);
    let statusReads = 0;
    const request = vi.fn<RequestFn>((method) => {
      if (method === "update.run") {
        return Promise.resolve({
          ok: true,
          result: { status: "skipped", reason: "custom-runtime-update-approval-started" },
          handoff: { status: "started" },
        });
      }
      if (method === "update.status") {
        statusReads += 1;
        return Promise.resolve({
          updateSafety: {
            approvalPending: statusReads === 1,
            pendingCandidateSha: candidateSha,
            preparationRunning: statusReads > 1,
            preparationStatus: statusReads === 1 ? "ready" : "installing",
          },
        });
      }
      return Promise.resolve([]);
    });
    const harness = createGatewayHarness(client(request));
    const overlays = createApplicationOverlays(harness.gateway);

    try {
      await overlays.runUpdate(candidateSha);
      await vi.advanceTimersByTimeAsync(0);
      expect(overlays.snapshot.updateSafety?.preparationStatus).toBe("ready");
      expect(overlays.snapshot.updateStatusBanner).toEqual({
        tone: "info",
        text: "Verified installation started. The Dashboard will reconnect after the managed restart.",
      });

      await vi.advanceTimersByTimeAsync(5_000);
      expect(statusReads).toBe(2);
      expect(overlays.snapshot.updateSafety?.preparationStatus).toBe("installing");
    } finally {
      overlays.dispose();
      vi.useRealTimers();
    }
  });

  it.each(["ready", "idle", "blocked"] as const)(
    "reports an unverified install after the start window from a stale %s snapshot",
    async (staleStatus) => {
      vi.useFakeTimers();
      const candidateSha = "9".repeat(40);
      let statusReads = 0;
      const request = vi.fn<RequestFn>((method) => {
        if (method === "update.run") {
          return Promise.resolve({
            ok: true,
            result: { status: "skipped", reason: "custom-runtime-update-approval-started" },
            handoff: { status: "started" },
          });
        }
        if (method === "update.status") {
          statusReads += 1;
          if (statusReads > 1) {
            return Promise.reject(new Error("temporary disconnect"));
          }
          return Promise.resolve({
            updateSafety: {
              approvalPending: true,
              pendingCandidateSha: candidateSha,
              preparationRunning: false,
              preparationStatus: staleStatus,
            },
          });
        }
        return Promise.resolve([]);
      });
      const harness = createGatewayHarness(client(request));
      const overlays = createApplicationOverlays(harness.gateway);

      try {
        await overlays.runUpdate(candidateSha);
        await vi.advanceTimersByTimeAsync(5 * 60_000);

        expect(overlays.snapshot.updateStatusBanner).toEqual({
          tone: "warn",
          text: "Verified installation status could not be confirmed. The prepared update remains unchanged; retry after the Gateway is reachable.",
        });
      } finally {
        overlays.dispose();
        vi.useRealTimers();
      }
    },
  );
});
