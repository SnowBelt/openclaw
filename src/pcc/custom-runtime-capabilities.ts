// Declarative custom-runtime contracts prevent upgrades from silently removing owned features.
import path from "node:path";

export const CUSTOM_RUNTIME_CAPABILITY_SCHEMA = "openclaw.custom-runtime-capabilities.v1";

export const CUSTOM_RUNTIME_CAPABILITY_KINDS = [
  "dashboard_surface",
  "plugin",
  "workflow",
  "runtime",
] as const;

export type CustomRuntimeCapabilityKind = (typeof CUSTOM_RUNTIME_CAPABILITY_KINDS)[number];

export type CustomRuntimeCapability = {
  id: string;
  kind: CustomRuntimeCapabilityKind;
  requiredPaths: string[];
  surfaceId?: string;
  pluginId?: string;
};

export type CustomRuntimeCapabilityManifest = {
  schema: typeof CUSTOM_RUNTIME_CAPABILITY_SCHEMA;
  version: number;
  capabilities: CustomRuntimeCapability[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function safeRelativePath(value: string): boolean {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  return (
    normalized === value &&
    !path.posix.isAbsolute(normalized) &&
    normalized !== ".." &&
    !normalized.startsWith("../")
  );
}

export function parseCustomRuntimeCapabilityManifest(
  value: unknown,
): CustomRuntimeCapabilityManifest | null {
  if (
    !isRecord(value) ||
    value.schema !== CUSTOM_RUNTIME_CAPABILITY_SCHEMA ||
    typeof value.version !== "number" ||
    !Number.isInteger(value.version) ||
    value.version < 1 ||
    !Array.isArray(value.capabilities)
  ) {
    return null;
  }
  const capabilities: CustomRuntimeCapability[] = [];
  for (const item of value.capabilities) {
    if (!isRecord(item)) {
      return null;
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const kind = typeof item.kind === "string" ? item.kind : "";
    const requiredPaths = strings(item.requiredPaths);
    if (
      !id ||
      !CUSTOM_RUNTIME_CAPABILITY_KINDS.includes(kind as CustomRuntimeCapabilityKind) ||
      requiredPaths.length === 0
    ) {
      return null;
    }
    const surfaceId = typeof item.surfaceId === "string" ? item.surfaceId.trim() : "";
    const pluginId = typeof item.pluginId === "string" ? item.pluginId.trim() : "";
    capabilities.push({
      id,
      kind: kind as CustomRuntimeCapabilityKind,
      requiredPaths,
      ...(surfaceId ? { surfaceId } : {}),
      ...(pluginId ? { pluginId } : {}),
    });
  }
  return {
    schema: CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
    version: value.version,
    capabilities,
  };
}

export function validateCustomRuntimeCapabilityManifest(params: {
  manifest: CustomRuntimeCapabilityManifest;
  dashboardSurfaceIds: readonly string[];
}): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const dashboardIds: string[] = [];
  for (const capability of params.manifest.capabilities) {
    if (ids.has(capability.id)) {
      errors.push(`Duplicate custom capability id: ${capability.id}`);
    }
    ids.add(capability.id);
    if (capability.requiredPaths.some((entry) => !safeRelativePath(entry))) {
      errors.push(`Custom capability ${capability.id} has an unsafe required path.`);
    }
    if (new Set(capability.requiredPaths).size !== capability.requiredPaths.length) {
      errors.push(`Custom capability ${capability.id} repeats a required path.`);
    }
    if (capability.kind === "dashboard_surface") {
      if (!capability.surfaceId) {
        errors.push(`Dashboard capability ${capability.id} is missing surfaceId.`);
      } else {
        dashboardIds.push(capability.surfaceId);
      }
    }
    if (capability.kind === "plugin" && !capability.pluginId) {
      errors.push(`Plugin capability ${capability.id} is missing pluginId.`);
    }
  }
  const expected = [...params.dashboardSurfaceIds].toSorted();
  const actual = [...dashboardIds].toSorted();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(
      `Dashboard capability inventory must match the canonical surface registry (expected ${expected.join(", ")}; received ${actual.join(", ")}).`,
    );
  }
  return errors;
}
