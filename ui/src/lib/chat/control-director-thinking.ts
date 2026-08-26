import { normalizeAgentId } from "../sessions/session-key.ts";

type ControlDirectorAgent = {
  id?: string | null;
  role?: string | null;
};

export function resolveControlDirectorAgentId(
  agents?: readonly ControlDirectorAgent[] | null,
  configuredDefaultId?: string | null,
): string | null {
  const configId = resolveControlDirectorAgentConfigId(agents, configuredDefaultId);
  return configId ? normalizeAgentId(configId) : null;
}

export function resolveControlDirectorAgentConfigId(
  agents?: readonly ControlDirectorAgent[] | null,
  configuredDefaultId?: string | null,
  sourceConfig?: unknown,
): string | null {
  void configuredDefaultId;
  if (!agents || agents.length === 0) {
    return null;
  }
  const roleAgent = agents.find((agent) => agent.role === "control_director");
  if (roleAgent?.id?.trim()) {
    const normalizedRoleId = normalizeAgentId(roleAgent.id);
    if (sourceConfig && typeof sourceConfig === "object" && !Array.isArray(sourceConfig)) {
      const configuredAgents = (sourceConfig as { agents?: { list?: unknown } }).agents?.list;
      if (Array.isArray(configuredAgents)) {
        const configuredAgent = configuredAgents.find((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return false;
          }
          const id = (entry as { id?: unknown }).id;
          const role = (entry as { role?: unknown }).role;
          return (
            typeof id === "string" &&
            normalizeAgentId(id) === normalizedRoleId &&
            (role === undefined || role === "control_director")
          );
        });
        const configuredId =
          configuredAgent && typeof (configuredAgent as { id?: unknown }).id === "string"
            ? (configuredAgent as { id: string }).id.trim()
            : "";
        return configuredId || null;
      }
    }
    // Without the source snapshot, retain the role row's spelling for callers
    // that only need an identity. Mutations pass the snapshot to preserve the
    // authored, case-sensitive config key.
    return roleAgent.id.trim();
  }
  // Role-scoped controls fail closed when the Gateway cannot identify the
  // Control Director. A default or main agent must not inherit these controls.
  return null;
}

export function isControlDirectorAgentId(
  agentId: string | null | undefined,
  configuredDefaultId?: string | null,
  agents?: readonly ControlDirectorAgent[] | null,
): boolean {
  const normalizedAgentId = normalizeAgentId(agentId ?? "");
  const controlDirectorAgentId = resolveControlDirectorAgentId(agents, configuredDefaultId);
  return Boolean(normalizedAgentId) && normalizedAgentId === controlDirectorAgentId;
}
