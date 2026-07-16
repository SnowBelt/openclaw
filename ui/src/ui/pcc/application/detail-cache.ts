import type { PccProjectDetail } from "./state.ts";

export const PCC_PROJECT_DETAIL_CACHE_LIMIT = 32;

type DetailCacheOptions = {
  selectedProjectId?: string | null;
  limit?: number;
};

type PccDetailCacheState = {
  pccProjectDetails: Record<string, PccProjectDetail>;
  pccSelectedProjectId: string | null;
};

function pinnedProjectIds(options: DetailCacheOptions): Set<string> {
  return new Set(
    ["project-command-center", options.selectedProjectId].filter((projectId): projectId is string =>
      Boolean(projectId),
    ),
  );
}

export function rememberPccProjectDetail(
  cache: Readonly<Record<string, PccProjectDetail>>,
  detail: PccProjectDetail,
  options: DetailCacheOptions = {},
): Record<string, PccProjectDetail> {
  const limit = Math.max(2, options.limit ?? PCC_PROJECT_DETAIL_CACHE_LIMIT);
  const entries = Object.entries(cache).filter(([projectId]) => projectId !== detail.project.id);
  entries.push([detail.project.id, detail]);
  const pinned = pinnedProjectIds(options);
  while (entries.length > limit) {
    const evictionIndex = entries.findIndex(([projectId]) => !pinned.has(projectId));
    if (evictionIndex < 0) {
      break;
    }
    entries.splice(evictionIndex, 1);
  }
  return Object.fromEntries(entries);
}

export function rememberPccProjectDetailForState(
  state: PccDetailCacheState,
  detail: PccProjectDetail,
): void {
  state.pccProjectDetails = rememberPccProjectDetail(state.pccProjectDetails, detail, {
    selectedProjectId: state.pccSelectedProjectId ?? detail.project.id,
  });
}
