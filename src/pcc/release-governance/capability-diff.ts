import {
  parseCustomRuntimeCapabilityManifestForComparison,
  type CustomRuntimeCapability,
  type CustomRuntimeCapabilityManifest,
} from "../custom-runtime-capabilities.js";
import type { ReleaseCapabilityDiffEntry } from "./contracts.js";

function indexCapabilities(
  manifest: CustomRuntimeCapabilityManifest,
): Map<string, CustomRuntimeCapability> {
  return new Map(manifest.capabilities.map((capability) => [capability.id, capability]));
}

function identityChanged(
  active: CustomRuntimeCapability,
  candidate: CustomRuntimeCapability,
): boolean {
  return (
    active.kind !== candidate.kind ||
    active.surfaceId !== candidate.surfaceId ||
    active.pluginId !== candidate.pluginId
  );
}

export function diffReleaseCapabilities(params: {
  activeManifest: unknown;
  candidateManifest: unknown;
  requiredCapabilityIds: readonly string[];
}): ReleaseCapabilityDiffEntry[] {
  const required = new Set(params.requiredCapabilityIds);
  const active = parseCustomRuntimeCapabilityManifestForComparison(params.activeManifest);
  const candidate = parseCustomRuntimeCapabilityManifestForComparison(params.candidateManifest);
  if (!active || !candidate) {
    return [
      {
        id: "*manifest*",
        change: "unknown",
        required: true,
        reason: !active
          ? "Active capability manifest is missing or invalid."
          : "Candidate capability manifest is missing or invalid.",
      },
    ];
  }
  const activeById = indexCapabilities(active);
  const candidateById = indexCapabilities(candidate);
  const ids = [...new Set([...activeById.keys(), ...candidateById.keys(), ...required])].toSorted();
  return ids.map((id) => {
    const before = activeById.get(id);
    const after = candidateById.get(id);
    const isRequired = required.has(id);
    if (!before && !after) {
      return {
        id,
        change: "unknown",
        required: isRequired,
        reason: "Required capability is absent from both manifests.",
      };
    }
    if (!before && after) {
      return {
        id,
        change: "added",
        required: isRequired,
        reason: "Capability is newly declared by the candidate.",
      };
    }
    if (before && !after) {
      return {
        id,
        change: "removed",
        required: isRequired,
        reason: "Candidate removed the capability.",
      };
    }
    const beforePaths = new Set(before!.requiredPaths);
    const afterPaths = new Set(after!.requiredPaths);
    const declaredMigrations = (candidate.pathMigrations ?? []).filter(
      (migration) => migration.capabilityId === id,
    );
    const migrationSources = new Set<string>();
    const migrationTargets = new Set<string>();
    const invalidMigrations = declaredMigrations.filter((migration) => {
      const invalid =
        !beforePaths.has(migration.from) ||
        beforePaths.has(migration.to) ||
        !afterPaths.has(migration.to) ||
        migrationSources.has(migration.from) ||
        migrationTargets.has(migration.to);
      migrationSources.add(migration.from);
      migrationTargets.add(migration.to);
      return invalid;
    });
    if (invalidMigrations.length > 0) {
      return {
        id,
        change: "weakened",
        required: isRequired,
        reason: `Candidate declared invalid required-path migrations: ${invalidMigrations
          .map((migration) => `${migration.from} -> ${migration.to}`)
          .join(", ")}.`,
      };
    }
    const removedPaths = [...beforePaths].filter((entry) => !afterPaths.has(entry));
    const migratedPaths = removedPaths.filter((entry) =>
      declaredMigrations.some(
        (migration) =>
          migration.capabilityId === id && migration.from === entry && afterPaths.has(migration.to),
      ),
    );
    const unaccountedRemovedPaths = removedPaths.filter((entry) => !migratedPaths.includes(entry));
    if (identityChanged(before!, after!) || unaccountedRemovedPaths.length > 0) {
      return {
        id,
        change: "weakened",
        required: isRequired,
        reason: identityChanged(before!, after!)
          ? "Candidate changed the capability identity or owner contract."
          : `Candidate removed required paths: ${unaccountedRemovedPaths.join(", ")}.`,
      };
    }
    const addedPaths = [...afterPaths].filter((entry) => !beforePaths.has(entry));
    if (addedPaths.length > 0 || migratedPaths.length > 0) {
      const migratedTargets = new Set(
        declaredMigrations
          .filter((migration) => migratedPaths.includes(migration.from))
          .map((migration) => migration.to),
      );
      const ordinaryAddedPaths = addedPaths.filter((entry) => !migratedTargets.has(entry));
      const changes = [
        ...(migratedPaths.length > 0
          ? [
              `migrated required paths: ${declaredMigrations
                .filter((migration) => migratedPaths.includes(migration.from))
                .map((migration) => `${migration.from} -> ${migration.to}`)
                .join(", ")}`,
            ]
          : []),
        ...(ordinaryAddedPaths.length > 0
          ? [`added required paths: ${ordinaryAddedPaths.join(", ")}`]
          : []),
      ];
      return {
        id,
        change: "modified",
        required: isRequired,
        reason: `Candidate ${changes.join("; ")}.`,
      };
    }
    return {
      id,
      change: "unchanged",
      required: isRequired,
      reason: "Capability contract is unchanged.",
    };
  });
}
