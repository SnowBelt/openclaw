// Chat project application service owns PCC discovery and session attachment.
import { formatConnectError } from "../connect-error.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ProjectRecord, ProjectsListResult } from "../types.ts";

type ChatProjectState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  chatProjectPickerOpen?: boolean;
  chatProjectBusy?: boolean;
  chatProjectError?: string | null;
  projectsLoading?: boolean;
  projectsList?: ProjectsListResult | null;
};

type ChatProjectSessionCreateResponse = {
  ok: true;
  key?: string;
};

type ChatPccProjectSummary = {
  id?: string;
  title?: string;
  status?: string;
  updatedAt?: string;
};

type ChatPccProjectsListResponse = {
  projects?: ChatPccProjectSummary[];
};

function requireConnectedChatClient(state: ChatProjectState): GatewayBrowserClient {
  if (!state.client || !state.connected) {
    throw new Error("Gateway is not connected.");
  }
  return state.client;
}

function currentChatSessionKey(state: ChatProjectState): string {
  const normalized = state.sessionKey.trim();
  if (!normalized) {
    throw new Error("No active chat session.");
  }
  return normalized;
}

function setChatProjectError(state: ChatProjectState, err: unknown): void {
  state.chatProjectError = formatConnectError(err);
}

function projectRecordFromPccSummary(project: ChatPccProjectSummary): ProjectRecord | null {
  const id = project.id?.trim();
  const name = project.title?.trim();
  if (!id || !name) {
    return null;
  }
  const updatedAt = project.updatedAt ? Date.parse(project.updatedAt) : Number.NaN;
  return {
    id,
    name,
    archived: project.status === "archived",
    ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
  };
}

export async function loadChatProjects(state: ChatProjectState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.projectsLoading = true;
  try {
    const res = await state.client.request<ChatPccProjectsListResponse>("pcc.projects.list", {
      includeArchived: true,
    });
    const projects = (res.projects ?? [])
      .map(projectRecordFromPccSummary)
      .filter((project): project is ProjectRecord => project !== null);
    state.projectsList = {
      ok: true,
      ts: Date.now(),
      count: projects.length,
      projects,
    };
    state.chatProjectError = null;
  } catch (err) {
    setChatProjectError(state, err);
  } finally {
    state.projectsLoading = false;
  }
}

export async function attachChatSessionToProject(
  state: ChatProjectState,
  projectId: string,
): Promise<boolean> {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) {
    return false;
  }
  state.chatProjectBusy = true;
  state.chatProjectError = null;
  try {
    const client = requireConnectedChatClient(state);
    await client.request("sessions.patch", {
      key: currentChatSessionKey(state),
      projectId: normalizedProjectId,
    });
    state.chatProjectPickerOpen = false;
    await loadChatProjects(state);
    return true;
  } catch (err) {
    setChatProjectError(state, err);
    return false;
  } finally {
    state.chatProjectBusy = false;
  }
}

export async function detachChatSessionFromProject(state: ChatProjectState): Promise<boolean> {
  state.chatProjectBusy = true;
  state.chatProjectError = null;
  try {
    const client = requireConnectedChatClient(state);
    await client.request("sessions.patch", {
      key: currentChatSessionKey(state),
      projectId: null,
    });
    state.chatProjectPickerOpen = false;
    await loadChatProjects(state);
    return true;
  } catch (err) {
    setChatProjectError(state, err);
    return false;
  } finally {
    state.chatProjectBusy = false;
  }
}

export async function createChatSessionInProject(
  state: ChatProjectState,
  projectId: string,
): Promise<string | null> {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) {
    return null;
  }
  state.chatProjectBusy = true;
  state.chatProjectError = null;
  try {
    const client = requireConnectedChatClient(state);
    const response = await client.request<ChatProjectSessionCreateResponse>("sessions.create", {
      projectId: normalizedProjectId,
    });
    const nextSessionKey = response?.key?.trim() ?? "";
    if (!nextSessionKey) {
      throw new Error("Project chat was created without a session key.");
    }
    state.chatProjectPickerOpen = false;
    await loadChatProjects(state);
    return nextSessionKey;
  } catch (err) {
    setChatProjectError(state, err);
    return null;
  } finally {
    state.chatProjectBusy = false;
  }
}
