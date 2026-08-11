// Declarative custom-runtime contracts prevent upgrades from silently removing owned features.
import path from "node:path";

export const CUSTOM_RUNTIME_CAPABILITY_SCHEMA = "openclaw.custom-runtime-capabilities.v2";
export const LEGACY_CUSTOM_RUNTIME_CAPABILITY_SCHEMA = "openclaw.custom-runtime-capabilities.v1";

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

export type CustomRuntimePreservationContract = {
  contractVersion: 2;
  criticality: "required";
  migrationPolicy: "preserve_or_block";
  rollbackPolicy: "immutable_release_pointer";
  sourceStrategy: "merge_from_active_sha";
  dashboardChangePolicy: "register_verify_and_block";
  approvalPolicy: "explicit_exact_candidate";
  proofCommand: "pnpm custom-runtime:update-survival";
  standardsRegistry: string;
  verificationCommands: string[];
};

export type CustomRuntimeCapabilityManifest = {
  schema: typeof CUSTOM_RUNTIME_CAPABILITY_SCHEMA | typeof LEGACY_CUSTOM_RUNTIME_CAPABILITY_SCHEMA;
  version: number;
  preservation?: CustomRuntimePreservationContract;
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
  const currentSchema = isRecord(value) && value.schema === CUSTOM_RUNTIME_CAPABILITY_SCHEMA;
  if (
    !isRecord(value) ||
    (value.schema !== CUSTOM_RUNTIME_CAPABILITY_SCHEMA &&
      value.schema !== LEGACY_CUSTOM_RUNTIME_CAPABILITY_SCHEMA) ||
    typeof value.version !== "number" ||
    !Number.isInteger(value.version) ||
    value.version < 1 ||
    !Array.isArray(value.capabilities)
  ) {
    return null;
  }
  let preservation: CustomRuntimePreservationContract | undefined;
  if (currentSchema) {
    const raw = value.preservation;
    if (!isRecord(raw)) {
      return null;
    }
    const verificationCommands = strings(raw.verificationCommands);
    const standardsRegistry =
      typeof raw.standardsRegistry === "string" ? raw.standardsRegistry.trim() : "";
    if (
      raw.contractVersion !== 2 ||
      raw.criticality !== "required" ||
      raw.migrationPolicy !== "preserve_or_block" ||
      raw.rollbackPolicy !== "immutable_release_pointer" ||
      raw.sourceStrategy !== "merge_from_active_sha" ||
      raw.dashboardChangePolicy !== "register_verify_and_block" ||
      raw.approvalPolicy !== "explicit_exact_candidate" ||
      raw.proofCommand !== "pnpm custom-runtime:update-survival" ||
      !standardsRegistry ||
      verificationCommands.length === 0
    ) {
      return null;
    }
    preservation = {
      contractVersion: raw.contractVersion,
      criticality: raw.criticality,
      migrationPolicy: raw.migrationPolicy,
      rollbackPolicy: raw.rollbackPolicy,
      sourceStrategy: raw.sourceStrategy,
      dashboardChangePolicy: raw.dashboardChangePolicy,
      approvalPolicy: raw.approvalPolicy,
      proofCommand: raw.proofCommand,
      standardsRegistry,
      verificationCommands,
    };
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
    schema: value.schema,
    version: value.version,
    ...(preservation ? { preservation } : {}),
    capabilities,
  };
}

export function validateCustomRuntimeCapabilityManifest(params: {
  manifest: CustomRuntimeCapabilityManifest;
  dashboardSurfaceIds: readonly string[];
}): string[] {
  const errors: string[] = [];
  if (params.manifest.schema === CUSTOM_RUNTIME_CAPABILITY_SCHEMA) {
    const preservation = params.manifest.preservation;
    if (!preservation) {
      errors.push("Current custom capability manifest is missing its preservation contract.");
    } else {
      if (!safeRelativePath(preservation.standardsRegistry)) {
        errors.push("Custom capability standards registry path is unsafe.");
      }
      if (
        new Set(preservation.verificationCommands).size !== preservation.verificationCommands.length
      ) {
        errors.push("Custom capability verification commands contain duplicates.");
      }
    }
  }
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

export function findUnregisteredCustomRuntimePaths(
  manifest: CustomRuntimeCapabilityManifest,
  trackedPaths: readonly string[],
): string[] {
  const registeredPaths = new Set(
    manifest.capabilities.flatMap((capability) => capability.requiredPaths),
  );
  return [
    ...new Set(
      trackedPaths.filter(
        (trackedPath) =>
          trackedPath.startsWith("scripts/custom-runtime/") && !registeredPaths.has(trackedPath),
      ),
    ),
  ].toSorted((left, right) => left.localeCompare(right));
}
