const CONTROL_DIRECTOR_AGENT_IDS = new Set(["main", "control-director"]);
const CONTROL_DIRECTOR_CODEX_LUNA_MODEL = "gpt-5.6-luna";

export function isControlDirectorCodexLunaSelection(params: {
  agentId?: string | null;
  provider?: string | null;
  model?: string | null;
  agentRuntime?: string | null;
}): boolean {
  const agentId = params.agentId?.trim().toLowerCase();
  if (!agentId || !CONTROL_DIRECTOR_AGENT_IDS.has(agentId)) {
    return false;
  }
  const provider = params.provider?.trim().toLowerCase();
  if (provider !== "openai" && provider !== "codex") {
    return false;
  }
  const rawModel = params.model?.trim().toLowerCase() ?? "";
  const model = (rawModel.includes("/") ? rawModel.slice(rawModel.lastIndexOf("/") + 1) : rawModel)
    .split("@")[0]
    ?.split(/\s+/u)[0]
    ?.replace(/:latest$/u, "");
  const runtime = params.agentRuntime?.trim().toLowerCase();
  return model === CONTROL_DIRECTOR_CODEX_LUNA_MODEL && (!runtime || runtime === "codex");
}
