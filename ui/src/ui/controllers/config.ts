// Control UI controller manages config gateway state.
import { applyMergePatch } from "../../../../src/config/merge-patch.ts";
import type { ControlUiBootstrapConfig } from "../../../../src/gateway/control-ui-contract.ts";
import type { CustomRuntimeUpdatePolicy } from "../../api/types.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ConfigSchemaResponse, ConfigSnapshot, ConfigUiHints } from "../types.ts";
import type { JsonSchema } from "../views/config-form.shared.ts";
import { coerceFormValues } from "./config/form-coerce.ts";
import {
  cloneConfigObject,
  removePathValue,
  sanitizeRedactedFormForSubmit,
  serializeConfigForm,
  setPathValue,
} from "./config/form-utils.ts";

export type ConfigState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  applySessionKey: string;
  configLoading: boolean;
  configRaw: string;
  configRawOriginal: string;
  configValid: boolean | null;
  configIssues: unknown[];
  configSaving: boolean;
  configApplying: boolean;
  updateRunning: boolean;
  configSnapshot: ConfigSnapshot | null;
  configDraftBaseHash?: string | null;
  configSchema: unknown;
  configSchemaVersion: string | null;
  configSchemaLoading: boolean;
  configUiHints: ConfigUiHints;
  configForm: Record<string, unknown> | null;
  configFormOriginal: Record<string, unknown> | null;
  configFormDirty: boolean;
  configFormMode: "form" | "raw";
  configSearchQuery: string;
  configActiveSection: string | null;
  configActiveSubsection: string | null;
  pendingUpdateExpectedVersion: string | null;
  pendingUpdateHandoff: boolean;
  pendingManagedInstallSha?: string | null;
  pendingManagedInstallDeadline?: number | null;
  updateStatusBanner: { tone: "danger" | "warn" | "info"; text: string } | null;
  customRuntimeUpdatePolicy?: CustomRuntimeUpdatePolicy | null;
  lastError: string | null;
  chatError?: string | null;
  runtimeIdentity?: ControlUiBootstrapConfig["runtimeIdentity"];
};

const autoAllowlistedPluginIdsByState = new WeakMap<ConfigState, Set<string>>();
const updateSafetyPollTimers = new WeakMap<ConfigState, ReturnType<typeof globalThis.setTimeout>>();
const UPDATE_HANDOFF_STARTED_REASON = "managed-service-handoff-started";
const UPDATE_SAFETY_POLL_MS = 5_000;
const UPDATE_SAFETY_START_GRACE_MS = 30_000;
const UPDATE_INSTALL_START_GRACE_MS = 5 * 60_000;

type UpdateSafetyOperation = "prepare" | "install";

function scheduleUpdateSafetyRefresh(
  state: ConfigState,
  startGraceDeadline: number,
  operation: UpdateSafetyOperation,
): void {
  const previous = updateSafetyPollTimers.get(state);
  if (previous) {
    globalThis.clearTimeout(previous);
  }
  const preparationStatus = state.customRuntimeUpdatePolicy?.preparationStatus;
  const waitingForOperationStart =
    Date.now() < startGraceDeadline &&
    (operation === "install"
      ? Boolean(state.pendingManagedInstallSha) && preparationStatus !== "failed"
      : state.customRuntimeUpdatePolicy?.approvalPending !== true);
  const shouldPoll =
    state.customRuntimeUpdatePolicy?.preparationRunning === true ||
    preparationStatus === "preparing" ||
    preparationStatus === "installing" ||
    waitingForOperationStart;
  if (!shouldPoll || !state.client || !state.connected) {
    updateSafetyPollTimers.delete(state);
    return;
  }
  const timer = globalThis.setTimeout(() => {
    updateSafetyPollTimers.delete(state);
    void refreshUpdateSafety(state, startGraceDeadline, operation);
  }, UPDATE_SAFETY_POLL_MS);
  updateSafetyPollTimers.set(state, timer);
}

async function refreshUpdateSafety(
  state: ConfigState,
  startGraceDeadline: number,
  operation: UpdateSafetyOperation,
): Promise<void> {
  const client = state.client;
  if (!client || !state.connected) {
    return;
  }
  try {
    const response = await client.request<{ updateSafety?: CustomRuntimeUpdatePolicy }>(
      "update.status",
      {},
    );
    if (state.client !== client || !state.connected) {
      return;
    }
    state.customRuntimeUpdatePolicy = response.updateSafety ?? null;
    if (state.customRuntimeUpdatePolicy?.preparationStatus === "failed") {
      state.pendingManagedInstallSha = null;
      state.pendingManagedInstallDeadline = null;
      state.updateStatusBanner = {
        tone: "danger",
        text: `Verified update preparation failed: ${state.customRuntimeUpdatePolicy.preparationReason ?? "unknown failure"}. The live runtime was not changed.`,
      };
    } else if (
      operation === "install" &&
      state.pendingManagedInstallSha &&
      state.customRuntimeUpdatePolicy?.managedRuntime === true &&
      state.customRuntimeUpdatePolicy.standardUpdateBlocked &&
      state.customRuntimeUpdatePolicy.sourceDurable &&
      state.customRuntimeUpdatePolicy.runtimeGuardHealthy &&
      state.customRuntimeUpdatePolicy.backupConfigured &&
      state.customRuntimeUpdatePolicy?.sourceSha === state.pendingManagedInstallSha &&
      state.customRuntimeUpdatePolicy.preparationStatus === "idle" &&
      !state.customRuntimeUpdatePolicy.approvalPending
    ) {
      state.pendingManagedInstallSha = null;
      state.pendingManagedInstallDeadline = null;
      state.updateStatusBanner = {
        tone: "info",
        text: "Verified update installed. Runtime identity and browser health checks are complete.",
      };
    } else if (
      operation === "install" &&
      state.customRuntimeUpdatePolicy?.preparationStatus !== "installing" &&
      Date.now() >= startGraceDeadline
    ) {
      state.pendingManagedInstallSha = null;
      state.pendingManagedInstallDeadline = null;
      state.updateStatusBanner = {
        tone: "warn",
        text: "Verified installation did not start. The prepared update remains unchanged; retry once the reported blocker is resolved.",
      };
    } else if (
      operation !== "install" &&
      state.customRuntimeUpdatePolicy?.preparationStatus === "ready" &&
      state.customRuntimeUpdatePolicy.pendingCandidateSha
    ) {
      state.updateStatusBanner = {
        tone: "info",
        text: `Verified update ${state.customRuntimeUpdatePolicy.pendingCandidateSha.slice(0, 12)} is ready for explicit installation approval.`,
      };
    }
  } catch {
    const installStartUnverified =
      operation === "install" &&
      Date.now() >= startGraceDeadline &&
      state.customRuntimeUpdatePolicy?.preparationStatus !== "installing";
    if (installStartUnverified) {
      state.pendingManagedInstallSha = null;
      state.pendingManagedInstallDeadline = null;
      state.updateStatusBanner = {
        tone: "warn",
        text: "Verified installation status could not be confirmed. The prepared update remains unchanged; retry after the Gateway is reachable.",
      };
      return;
    }
    // A transient status read must not hide a preparation that is still starting.
  }
  scheduleUpdateSafetyRefresh(state, startGraceDeadline, operation);
}

export function resumeManagedInstallVerification(state: ConfigState): void {
  const deadline = state.pendingManagedInstallDeadline ?? 0;
  if (!state.pendingManagedInstallSha || !state.client || !state.connected) {
    return;
  }
  if (!Number.isFinite(deadline) || deadline <= 0) {
    state.pendingManagedInstallSha = null;
    state.pendingManagedInstallDeadline = null;
    state.updateStatusBanner = {
      tone: "warn",
      text: "Verified installation status could not be resumed. Retry the prepared update after checking update safety.",
    };
    return;
  }
  // An expired start window still requires one final status read. That read
  // resolves exact-candidate success or clears the operation as unverified.
  void refreshUpdateSafety(state, deadline, "install");
}

export type LoadConfigOptions = {
  discardPendingChanges?: boolean;
};

export async function loadConfig(state: ConfigState, options: LoadConfigOptions = {}) {
  if (!state.client || !state.connected) {
    return;
  }
  state.configLoading = true;
  state.lastError = null;
  state.chatError = null;
  try {
    const res = await state.client.request<ConfigSnapshot>("config.get", {});
    applyConfigSnapshot(state, res, options);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configLoading = false;
  }
}

export async function loadConfigSchema(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.configSchemaLoading) {
    return;
  }
  state.configSchemaLoading = true;
  try {
    const res = await state.client.request<ConfigSchemaResponse>("config.schema", {});
    applyConfigSchema(state, res);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configSchemaLoading = false;
  }
}

function applyConfigSchema(state: ConfigState, res: ConfigSchemaResponse) {
  state.configSchema = res.schema ?? null;
  state.configUiHints = res.uiHints ?? {};
  state.configSchemaVersion = res.version ?? null;
}

function asConfigRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function resolveEditableSnapshotConfig(
  snapshot: ConfigSnapshot | null | undefined,
): Record<string, unknown> | null {
  return (
    asConfigRecord(snapshot?.sourceConfig) ??
    asConfigRecord(snapshot?.resolved) ??
    asConfigRecord(snapshot?.config)
  );
}

export function applyConfigSnapshot(
  state: ConfigState,
  snapshot: ConfigSnapshot,
  options: LoadConfigOptions = {},
) {
  const preservePendingChanges = state.configFormDirty && options.discardPendingChanges !== true;
  const draftBaseHash = state.configDraftBaseHash ?? state.configSnapshot?.hash ?? null;
  state.configSnapshot = snapshot;
  const editableConfig = resolveEditableSnapshotConfig(snapshot);
  const rawAvailable =
    typeof snapshot.raw === "string" || Boolean(editableConfig) || Boolean(state.configForm);
  if (!rawAvailable && state.configFormMode === "raw") {
    state.configFormMode = "form";
  }
  const rawFromSnapshot: string =
    typeof snapshot.raw === "string"
      ? snapshot.raw
      : editableConfig
        ? serializeConfigForm(editableConfig)
        : state.configRaw;
  if (!preservePendingChanges) {
    state.configRaw = rawFromSnapshot;
  } else if (state.configFormMode !== "raw" && state.configForm) {
    state.configRaw = serializeConfigForm(state.configForm);
  } else if (state.configFormMode !== "raw") {
    state.configRaw = rawFromSnapshot;
  }
  state.configValid = typeof snapshot.valid === "boolean" ? snapshot.valid : null;
  state.configIssues = Array.isArray(snapshot.issues) ? snapshot.issues : [];

  if (!preservePendingChanges) {
    state.configForm = cloneConfigObject(editableConfig ?? {});
    state.configFormOriginal = cloneConfigObject(editableConfig ?? {});
    state.configRawOriginal = rawFromSnapshot;
    state.configFormDirty = false;
    state.configDraftBaseHash = snapshot.hash ?? null;
    autoAllowlistedPluginIdsByState.delete(state);
  } else {
    state.configDraftBaseHash = draftBaseHash;
  }
}

function asJsonSchema(value: unknown): JsonSchema | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonSchema;
}

/**
 * Serialize the form state for submission to `config.set` / `config.apply`.
 *
 * HTML `<input>` elements produce string `.value` properties, so numeric and
 * boolean config fields can leak into `configForm` as strings.  We coerce
 * them back to their schema-defined types before JSON serialization so the
 * gateway's Zod validation always sees correctly typed values.
 */
function serializeFormForSubmit(state: ConfigState): string {
  if (state.configFormMode !== "form" || !state.configForm) {
    return state.configRaw;
  }
  const schema = asJsonSchema(state.configSchema);
  const form = schema
    ? (coerceFormValues(state.configForm, schema) as Record<string, unknown>)
    : state.configForm;
  const sanitized = sanitizeRedactedFormForSubmit(
    form,
    state.configFormOriginal,
    state.configRawOriginal,
  );
  return serializeConfigForm(sanitized);
}

type ConfigSubmitMethod = "config.set" | "config.apply";
type ConfigSubmitBusyKey = "configSaving" | "configApplying";

function resolveUpdateStatusBanner(params: { status?: string; reason?: string }): {
  tone: "danger" | "warn" | "info";
  text: string;
} {
  const status = (params.status ?? "error").trim() || "error";
  const reason = (params.reason ?? "unexpected-error").trim() || "unexpected-error";
  const tone = status === "skipped" ? "warn" : "danger";
  const guidance =
    {
      dirty: "Commit or stash changes, then retry.",
      "no-upstream": "Set an upstream branch, then retry.",
      "not-git-install":
        "Not a git checkout. Run `openclaw update` from the CLI for a global reinstall.",
      "not-openclaw-root":
        "Run the update from an OpenClaw checkout or use the CLI global reinstall path.",
      "deps-install-failed": "Dependency install failed. Fix the install error and retry.",
      "build-failed": "Build failed. Fix the build error and retry.",
      "ui-build-failed": "The control UI rebuild failed. Fix the UI build error and retry.",
      "global-install-failed":
        "The global package install did not verify on disk. Retry or reinstall from the CLI.",
      "restart-disabled":
        "The update was not applied because gateway restarts are disabled. Enable restarts in config, then retry — or run `openclaw update` from the CLI.",
      "restart-unavailable":
        "This global install cannot be safely replaced while restarts are disabled and no supervisor is present.",
      "restart-unhealthy":
        "The replacement process never became healthy. The previous process stayed up so you can recover.",
      "doctor-failed": "Doctor repair failed. Run `openclaw doctor --non-interactive` and retry.",
      "custom-runtime-update-preparation-started":
        "Verified preparation started in isolation. The live runtime will not change.",
      "custom-runtime-update-approval-started":
        "Verified installation started. The Dashboard will reconnect after the managed restart.",
      "custom-runtime-update-preparation-running":
        "Verified preparation is already running. Wait for its readiness result.",
      "custom-runtime-update-exact-sha-approval-required":
        "Preparation passed. Review and approve the exact candidate SHA before installation.",
      "custom-runtime-update-safety-blocked":
        "Update protection is incomplete. Resolve the reported source, backup, or broker issue first.",
    }[reason] ?? "See the gateway logs for the exact failure and retry once the cause is fixed.";
  return {
    tone,
    text: `Update ${status}: ${reason}. ${guidance}`,
  };
}

async function submitConfigChange(
  state: ConfigState,
  method: ConfigSubmitMethod,
  busyKey: ConfigSubmitBusyKey,
  extraParams: Record<string, unknown> = {},
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  state[busyKey] = true;
  state.lastError = null;
  state.chatError = null;
  try {
    const raw = serializeFormForSubmit(state);
    const baseHash = state.configDraftBaseHash ?? state.configSnapshot?.hash;
    if (!baseHash) {
      state.lastError = "Config hash missing; reload and retry.";
      return false;
    }
    await state.client.request(method, { raw, baseHash, ...extraParams });
    state.configFormDirty = false;
    state.configDraftBaseHash = null;
    autoAllowlistedPluginIdsByState.delete(state);
    await loadConfig(state);
    return true;
  } catch (err) {
    state.lastError = String(err);
    return false;
  } finally {
    state[busyKey] = false;
  }
}

function syncConfigDraft(state: ConfigState, nextForm: Record<string, unknown>) {
  const original = cloneConfigObject(
    state.configFormOriginal ?? resolveEditableSnapshotConfig(state.configSnapshot) ?? {},
  );
  const nextRaw = serializeConfigForm(nextForm);
  const originalRaw = serializeConfigForm(original);
  state.configForm = nextForm;
  state.configRaw = nextRaw;
  state.configFormDirty = nextRaw !== originalRaw;
}

export async function saveConfig(state: ConfigState): Promise<boolean> {
  return submitConfigChange(state, "config.set", "configSaving");
}

export async function applyConfig(state: ConfigState): Promise<boolean> {
  return submitConfigChange(state, "config.apply", "configApplying", {
    sessionKey: state.applySessionKey,
  });
}

export async function runUpdate(state: ConfigState, approvalSha?: string) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.customRuntimeUpdatePolicy?.preparationStatus === "installing") {
    return;
  }
  if (
    state.customRuntimeUpdatePolicy?.standardUpdateBlocked &&
    !state.customRuntimeUpdatePolicy.managedRuntime
  ) {
    state.updateStatusBanner = {
      tone: "warn",
      text: "Verified update safety is unavailable. The stock updater is blocked so PCC and other customizations cannot be replaced.",
    };
    return;
  }
  const pendingCandidateSha = state.customRuntimeUpdatePolicy?.pendingCandidateSha ?? null;
  const managedApprovalPending =
    state.customRuntimeUpdatePolicy?.managedRuntime &&
    state.customRuntimeUpdatePolicy.approvalPending;
  const exactApprovalMatches =
    typeof approvalSha === "string" &&
    /^[0-9a-f]{40}$/u.test(approvalSha) &&
    approvalSha === pendingCandidateSha;
  if (
    (managedApprovalPending && !exactApprovalMatches) ||
    (!managedApprovalPending && approvalSha)
  ) {
    state.updateStatusBanner = {
      tone: "warn",
      text: "Verified installation requires the exact prepared candidate shown by update safety.",
    };
    return;
  }
  state.updateRunning = true;
  state.lastError = null;
  state.chatError = null;
  state.updateStatusBanner = null;
  try {
    const res = await state.client.request<{
      ok?: boolean;
      result?: { status?: string; reason?: string; after?: { version?: string | null } };
      handoff?: { status?: string };
    }>("update.run", {
      sessionKey: state.applySessionKey,
      ...(approvalSha ? { approvalSha } : {}),
    });
    const status = res.result?.status ?? (res.ok === true ? "ok" : "error");
    const handoffStarted =
      res.ok === true &&
      status === "skipped" &&
      res.result?.reason === UPDATE_HANDOFF_STARTED_REASON &&
      res.handoff?.status === "started";
    if (handoffStarted) {
      state.pendingManagedInstallSha = null;
      state.pendingManagedInstallDeadline = null;
      state.pendingUpdateExpectedVersion = res.result?.after?.version ?? null;
      state.pendingUpdateHandoff = true;
      return;
    }
    if (
      res.ok === true &&
      status === "skipped" &&
      res.result?.reason === "custom-runtime-update-preparation-started"
    ) {
      state.pendingManagedInstallSha = null;
      state.pendingManagedInstallDeadline = null;
      state.pendingUpdateExpectedVersion = null;
      state.pendingUpdateHandoff = false;
      state.updateStatusBanner = {
        tone: "info",
        text: "Verified update preparation started. The live runtime will remain unchanged.",
      };
      void refreshUpdateSafety(state, Date.now() + UPDATE_SAFETY_START_GRACE_MS, "prepare");
      return;
    }
    if (
      res.ok === true &&
      status === "skipped" &&
      res.result?.reason === "custom-runtime-update-approval-started"
    ) {
      if (!approvalSha) {
        state.updateStatusBanner = {
          tone: "warn",
          text: "Verified installation could not be bound to an exact prepared candidate.",
        };
        return;
      }
      state.pendingUpdateExpectedVersion = null;
      // Managed activation is verified by update-safety receipts, not the stock update sentinel.
      // Arming generic reconnect verification would misreport a successful managed restart.
      state.pendingUpdateHandoff = false;
      state.pendingManagedInstallSha = approvalSha;
      state.pendingManagedInstallDeadline = Date.now() + UPDATE_INSTALL_START_GRACE_MS;
      state.updateStatusBanner = {
        tone: "info",
        text: "Verified installation started. The Dashboard will reconnect after restart.",
      };
      void refreshUpdateSafety(state, state.pendingManagedInstallDeadline, "install");
      return;
    }
    state.pendingManagedInstallSha = null;
    state.pendingManagedInstallDeadline = null;
    if (status === "ok" && res.ok === true) {
      state.pendingUpdateExpectedVersion = res.result?.after?.version ?? null;
      state.pendingUpdateHandoff = false;
      return;
    }
    state.pendingUpdateExpectedVersion = null;
    state.pendingUpdateHandoff = false;
    state.updateStatusBanner = resolveUpdateStatusBanner({
      status,
      reason: res.result?.reason,
    });
  } catch (err) {
    state.lastError = String(err);
    state.pendingUpdateExpectedVersion = null;
    state.pendingUpdateHandoff = false;
    state.pendingManagedInstallSha = null;
    state.pendingManagedInstallDeadline = null;
  } finally {
    state.updateRunning = false;
  }
}

function mutateConfigForm(state: ConfigState, mutate: (draft: Record<string, unknown>) => void) {
  const base = cloneConfigObject(
    state.configForm ?? resolveEditableSnapshotConfig(state.configSnapshot) ?? {},
  );
  mutate(base);
  syncConfigDraft(state, base);
}

function trackAutoAllowlistedPluginId(state: ConfigState, pluginId: string) {
  const pluginIds = autoAllowlistedPluginIdsByState.get(state);
  if (pluginIds) {
    pluginIds.add(pluginId);
  } else {
    autoAllowlistedPluginIdsByState.set(state, new Set([pluginId]));
  }
}

function untrackAutoAllowlistedPluginId(state: ConfigState, pluginId: string) {
  const pluginIds = autoAllowlistedPluginIdsByState.get(state);
  if (!pluginIds) {
    return;
  }
  pluginIds.delete(pluginId);
  if (pluginIds.size === 0) {
    autoAllowlistedPluginIdsByState.delete(state);
  }
}

function syncEnabledPluginAllowlist(
  state: ConfigState,
  draft: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown,
) {
  if (
    path.length !== 4 ||
    path[0] !== "plugins" ||
    path[1] !== "entries" ||
    typeof path[2] !== "string" ||
    path[3] !== "enabled"
  ) {
    return;
  }
  const pluginId = path[2];
  const plugins =
    draft.plugins && typeof draft.plugins === "object" && !Array.isArray(draft.plugins)
      ? (draft.plugins as Record<string, unknown>)
      : null;
  const allow = Array.isArray(plugins?.allow) ? plugins.allow : null;
  if (!allow) {
    untrackAutoAllowlistedPluginId(state, pluginId);
    return;
  }
  if (value === true) {
    if (allow.includes(pluginId)) {
      return;
    }
    if (allow.length === 0) {
      untrackAutoAllowlistedPluginId(state, pluginId);
      return;
    }
    setPathValue(draft, ["plugins", "allow"], [...allow, pluginId]);
    trackAutoAllowlistedPluginId(state, pluginId);
    return;
  }
  const autoAllowlistedPluginIds = autoAllowlistedPluginIdsByState.get(state);
  if (!autoAllowlistedPluginIds?.has(pluginId)) {
    return;
  }
  setPathValue(
    draft,
    ["plugins", "allow"],
    allow.filter((entry) => entry !== pluginId),
  );
  untrackAutoAllowlistedPluginId(state, pluginId);
}

export function updateConfigFormValue(
  state: ConfigState,
  path: Array<string | number>,
  value: unknown,
) {
  mutateConfigForm(state, (draft) => {
    setPathValue(draft, path, value);
    if (path[0] === "plugins" && path[1] === "allow") {
      autoAllowlistedPluginIdsByState.delete(state);
      return;
    }
    syncEnabledPluginAllowlist(state, draft, path, value);
  });
}

export function updateConfigRawValue(state: ConfigState, value: string) {
  state.configRaw = value;
  state.configFormDirty = value !== state.configRawOriginal;
  if (state.configFormDirty) {
    state.configDraftBaseHash = state.configDraftBaseHash ?? state.configSnapshot?.hash ?? null;
  } else {
    state.configDraftBaseHash = state.configSnapshot?.hash ?? null;
  }
}

export function stageConfigPreset(state: ConfigState, patch: Record<string, unknown>) {
  const snapshotConfig = resolveEditableSnapshotConfig(state.configSnapshot);
  const baseSource = state.configForm ?? snapshotConfig;
  if (!baseSource || (!state.configForm && !state.configSnapshot?.hash)) {
    return;
  }
  const base = cloneConfigObject(baseSource);
  const merged = applyMergePatch(base, patch);
  if (!merged || typeof merged !== "object" || Array.isArray(merged)) {
    return;
  }
  syncConfigDraft(state, cloneConfigObject(merged as Record<string, unknown>));
}

export function resetConfigPendingChanges(state: ConfigState) {
  const editableConfig = resolveEditableSnapshotConfig(state.configSnapshot);
  state.configForm = cloneConfigObject(state.configFormOriginal ?? editableConfig ?? {});
  state.configRaw =
    state.configRawOriginal ??
    serializeConfigForm(state.configFormOriginal ?? editableConfig ?? {});
  state.configFormDirty = false;
  state.configDraftBaseHash = state.configSnapshot?.hash ?? null;
  autoAllowlistedPluginIdsByState.delete(state);
}

export function removeConfigFormValue(state: ConfigState, path: Array<string | number>) {
  mutateConfigForm(state, (draft) => removePathValue(draft, path));
}

export function updateMcpServerEnabled(state: ConfigState, name: string, enabled: boolean) {
  mutateConfigForm(state, (draft) => {
    const serverPath = ["mcp", "servers", name];
    if (!enabled) {
      setPathValue(draft, [...serverPath, "enabled"], false);
      return;
    }

    removePathValue(draft, [...serverPath, "enabled"]);
    const mcp = asConfigRecord(draft.mcp);
    const servers = asConfigRecord(mcp?.servers);
    const server = asConfigRecord(servers?.[name]);
    if (server && Object.keys(server).length === 0) {
      removePathValue(draft, serverPath);
    }
  });
}

export function findAgentConfigEntryIndex(
  config: Record<string, unknown> | null,
  agentId: string,
): number {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return -1;
  }
  const list = (config as { agents?: { list?: unknown[] } } | null)?.agents?.list;
  if (!Array.isArray(list)) {
    return -1;
  }
  return list.findIndex(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      "id" in entry &&
      (entry as { id?: string }).id === normalizedAgentId,
  );
}

export function ensureAgentConfigEntry(state: ConfigState, agentId: string): number {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return -1;
  }
  const source = state.configForm ?? resolveEditableSnapshotConfig(state.configSnapshot);
  const existingIndex = findAgentConfigEntryIndex(source, normalizedAgentId);
  if (existingIndex >= 0) {
    return existingIndex;
  }
  const list = (source as { agents?: { list?: unknown[] } } | null)?.agents?.list;
  const nextIndex = Array.isArray(list) ? list.length : 0;
  updateConfigFormValue(state, ["agents", "list", nextIndex, "id"], normalizedAgentId);
  return nextIndex;
}

export function stageDefaultAgentConfigEntry(state: ConfigState, agentId: string): boolean {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return false;
  }
  const source = state.configForm ?? resolveEditableSnapshotConfig(state.configSnapshot);
  const targetIndex = findAgentConfigEntryIndex(source, normalizedAgentId);
  if (targetIndex < 0) {
    return false;
  }
  mutateConfigForm(state, (draft) => {
    const list = (draft as { agents?: { list?: unknown[] } } | null)?.agents?.list;
    if (!Array.isArray(list)) {
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      if (i === targetIndex) {
        record.default = true;
      } else {
        delete record.default;
      }
    }
  });
  return true;
}

export async function openConfigFile(state: ConfigState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.lastError = null;
  state.chatError = null;
  try {
    const res = await state.client.request<{ ok: boolean; path?: string; error?: string }>(
      "config.openFile",
      {},
    );
    if (!res.ok) {
      const errorMessage = res.error || "Failed to open config file";
      state.lastError = errorMessage;
      const path = res.path || state.configSnapshot?.path;
      if (path) {
        try {
          await navigator.clipboard.writeText(path);
          state.lastError += `\n\nFile path copied to clipboard: ${path}`;
        } catch {
          state.lastError += `\n\nFile path: ${path}`;
        }
      }
    }
  } catch (err) {
    const path = state.configSnapshot?.path;
    if (path) {
      try {
        await navigator.clipboard.writeText(path);
      } catch {
        // ignore
      }
    }
    state.lastError = String(err);
  }
}
