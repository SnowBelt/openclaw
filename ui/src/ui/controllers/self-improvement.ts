import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  SelfImprovementAnalysisRunResult,
  SelfImprovementAuditEvent,
  SelfImprovementDailyScorecard,
  SelfImprovementModelPreflightResult,
  SelfImprovementOperationalHealthResult,
  SelfImprovementProductionCheckResult,
  SelfImprovementMaintenanceResult,
  SelfImprovementProposal,
  SelfImprovementRecommendation,
  SelfImprovementRecommendationGroup,
  SelfImprovementScanResult,
  SelfImprovementScorecard,
  SelfImprovementScorecardResult,
  SelfImprovementSummaryResult,
} from "../types.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

const SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS = 15_000;

export type SelfImprovementState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  selfImprovementLoading: boolean;
  selfImprovementError: string | null;
  selfImprovementRecommendations: SelfImprovementRecommendation[];
  selfImprovementGroups: SelfImprovementRecommendationGroup[];
  selfImprovementScorecard: SelfImprovementScorecard | null;
  selfImprovementScorecards: SelfImprovementDailyScorecard[];
  selfImprovementHealth: SelfImprovementOperationalHealthResult | null;
  selfImprovementProposals: SelfImprovementProposal[];
  selfImprovementAuditEvents: SelfImprovementAuditEvent[];
  selfImprovementTotal: number;
  selfImprovementScanLoading: boolean;
  selfImprovementLastScan: SelfImprovementScanResult["scan"] | null;
  selfImprovementAnalysisLoading: boolean;
  selfImprovementLastAnalysis: SelfImprovementAnalysisRunResult | null;
  selfImprovementModelPreflightLoading: boolean;
  selfImprovementLastModelPreflight: SelfImprovementModelPreflightResult | null;
  selfImprovementProductionCheckLoading: boolean;
  selfImprovementLastProductionCheck: SelfImprovementProductionCheckResult | null;
  selfImprovementMaintenanceLoading: boolean;
  selfImprovementLastMaintenance: SelfImprovementMaintenanceResult | null;
};

export type SelfImprovementRecommendationUpdateInput = {
  id: string;
  status: string;
  note?: string;
  assignedTargetAgentId?: string;
  claimedBy?: string;
  resolutionProof?: string;
  dismissalReason?: string;
};

export type SelfImprovementGroupUpdateInput = SelfImprovementRecommendationUpdateInput;

export type SelfImprovementCuratorUpdateInput = {
  id: string;
  curatorStatus: string;
  proof?: string;
  reason?: string;
  workshopProposalId?: string;
  workshopProposalStatus?: string;
  note?: string;
};

function formatSelfImprovementError(error: unknown): string {
  return isMissingOperatorReadScopeError(error)
    ? formatMissingOperatorReadScopeMessage("self-improvement recommendations")
    : String(error);
}

export async function loadSelfImprovementRecommendations(state: SelfImprovementState) {
  if (!state.client || !state.connected || state.selfImprovementLoading) {
    return;
  }
  state.selfImprovementLoading = true;
  state.selfImprovementError = null;
  try {
    const results = await Promise.allSettled([
      state.client.request<SelfImprovementSummaryResult>(
        "selfImprovement.summary",
        { limit: 50 },
        { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
      ),
      state.client.request<{
        recommendations: SelfImprovementRecommendation[];
        total: number;
      }>(
        "selfImprovement.recommendations.list",
        {
          status: ["open", "acknowledged", "assigned", "in_progress", "reopened", "quarantined"],
          limit: 100,
        },
        { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
      ),
      state.client.request<SelfImprovementScorecardResult>(
        "selfImprovement.scorecard",
        { days: 14, limit: 14 },
        { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
      ),
      state.client.request<SelfImprovementOperationalHealthResult>(
        "selfImprovement.health",
        { days: 14, limit: 14 },
        { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
      ),
      state.client.request<{ proposals: SelfImprovementProposal[]; total: number }>(
        "selfImprovement.proposals.list",
        { status: ["pending", "acknowledged"], limit: 25 },
        { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
      ),
      state.client.request<{ proposals: SelfImprovementProposal[]; total: number }>(
        "selfImprovement.curator.list",
        { limit: 50 },
        { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
      ),
      state.client.request<{ events: SelfImprovementAuditEvent[]; total: number }>(
        "selfImprovement.auditEvents.list",
        { limit: 20 },
        { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
      ),
    ]);
    const errors: string[] = [];
    const value = (index: number, label: string): unknown => {
      const result = results[index];
      if (result?.status === "fulfilled") {
        return result.value;
      }
      if (result?.status === "rejected") {
        errors.push(`${label}: ${formatSelfImprovementError(result.reason)}`);
      }
      return undefined;
    };
    const summary = value(0, "Summary") as SelfImprovementSummaryResult | undefined;
    const list = value(1, "Recommendations") as
      | { recommendations: SelfImprovementRecommendation[]; total: number }
      | undefined;
    const scorecard = value(2, "Scorecard") as SelfImprovementScorecardResult | undefined;
    const health = value(3, "Health") as SelfImprovementOperationalHealthResult | undefined;
    const proposals = value(4, "Proposals") as
      | { proposals: SelfImprovementProposal[]; total: number }
      | undefined;
    const curator = value(5, "Curator") as
      | { proposals: SelfImprovementProposal[]; total: number }
      | undefined;
    const auditEvents = value(6, "Audit events") as
      | { events: SelfImprovementAuditEvent[]; total: number }
      | undefined;
    if (summary) {
      state.selfImprovementGroups = summary.groups ?? [];
      state.selfImprovementScorecard = summary.scorecard ?? state.selfImprovementScorecard;
      state.selfImprovementTotal =
        summary.scorecard?.activeRecommendations ?? state.selfImprovementTotal;
    }
    if (scorecard) {
      state.selfImprovementScorecard = scorecard.current ?? state.selfImprovementScorecard;
      state.selfImprovementScorecards = scorecard.scorecards ?? [];
    }
    if (health) {
      state.selfImprovementHealth = health;
    }
    if (proposals && curator) {
      state.selfImprovementProposals = [
        ...(proposals.proposals ?? []),
        ...(curator.proposals ?? []).filter(
          (proposal) => !(proposals.proposals ?? []).some((entry) => entry.id === proposal.id),
        ),
      ];
    }
    if (auditEvents) {
      state.selfImprovementAuditEvents = auditEvents.events ?? [];
    }
    if (list) {
      state.selfImprovementRecommendations = list.recommendations ?? [];
      if (!summary) {
        state.selfImprovementTotal = list.total ?? state.selfImprovementTotal;
      }
    }
    state.selfImprovementError = errors.length > 0 ? errors.join(" | ") : null;
  } catch (error) {
    state.selfImprovementError = formatSelfImprovementError(error);
  } finally {
    state.selfImprovementLoading = false;
  }
}

export async function runSelfImprovementScan(state: SelfImprovementState) {
  if (!state.client || !state.connected || state.selfImprovementScanLoading) {
    return;
  }
  state.selfImprovementScanLoading = true;
  state.selfImprovementError = null;
  try {
    const result = await state.client.request<SelfImprovementScanResult>(
      "selfImprovement.scan",
      {},
      { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
    );
    state.selfImprovementLastScan = result?.scan ?? null;
    await loadSelfImprovementRecommendations(state);
  } catch (error) {
    state.selfImprovementError = formatSelfImprovementError(error);
  } finally {
    state.selfImprovementScanLoading = false;
  }
}

export async function runSelfImprovementAnalysis(state: SelfImprovementState) {
  if (!state.client || !state.connected || state.selfImprovementAnalysisLoading) {
    return;
  }
  state.selfImprovementAnalysisLoading = true;
  state.selfImprovementError = null;
  try {
    const result = await state.client.request<SelfImprovementAnalysisRunResult>(
      "selfImprovement.analysis.run",
      { limit: 25 },
      { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
    );
    state.selfImprovementLastAnalysis = result ?? null;
    await loadSelfImprovementRecommendations(state);
  } catch (error) {
    state.selfImprovementError = formatSelfImprovementError(error);
  } finally {
    state.selfImprovementAnalysisLoading = false;
  }
}

export async function runSelfImprovementModelPreflight(state: SelfImprovementState) {
  if (!state.client || !state.connected || state.selfImprovementModelPreflightLoading) {
    return;
  }
  state.selfImprovementModelPreflightLoading = true;
  state.selfImprovementError = null;
  try {
    const result = await state.client.request<SelfImprovementModelPreflightResult>(
      "selfImprovement.models.preflight",
      { localFirst: true },
      { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
    );
    state.selfImprovementLastModelPreflight = result ?? null;
  } catch (error) {
    state.selfImprovementError = formatSelfImprovementError(error);
  } finally {
    state.selfImprovementModelPreflightLoading = false;
  }
}

export async function runSelfImprovementProductionCheck(state: SelfImprovementState) {
  if (!state.client || !state.connected || state.selfImprovementProductionCheckLoading) {
    return;
  }
  state.selfImprovementProductionCheckLoading = true;
  state.selfImprovementError = null;
  try {
    const result = await state.client.request<SelfImprovementProductionCheckResult>(
      "selfImprovement.productionCheck",
      { requireModelReady: true, requireEvalsReady: true },
      { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
    );
    state.selfImprovementLastProductionCheck = result ?? null;
  } catch (error) {
    state.selfImprovementError = formatSelfImprovementError(error);
  } finally {
    state.selfImprovementProductionCheckLoading = false;
  }
}

export async function runSelfImprovementMaintenanceDryRun(state: SelfImprovementState) {
  if (!state.client || !state.connected || state.selfImprovementMaintenanceLoading) {
    return;
  }
  state.selfImprovementMaintenanceLoading = true;
  state.selfImprovementError = null;
  try {
    const result = await state.client.request<SelfImprovementMaintenanceResult>(
      "selfImprovement.maintenance.run",
      { apply: false },
      { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
    );
    state.selfImprovementLastMaintenance = result ?? null;
  } catch (error) {
    state.selfImprovementError = formatSelfImprovementError(error);
  } finally {
    state.selfImprovementMaintenanceLoading = false;
  }
}

export async function updateSelfImprovementRecommendation(
  state: SelfImprovementState,
  input: SelfImprovementRecommendationUpdateInput,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.selfImprovementError = null;
  try {
    await state.client.request(
      "selfImprovement.recommendations.update",
      {
        id: input.id,
        status: input.status,
        note: input.note,
        assignedTargetAgentId: input.assignedTargetAgentId,
        claimedBy: input.claimedBy,
        resolutionProof: input.resolutionProof,
        dismissalReason: input.dismissalReason,
      },
      { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
    );
    await loadSelfImprovementRecommendations(state);
  } catch (error) {
    state.selfImprovementError = formatSelfImprovementError(error);
  }
}

export async function updateSelfImprovementGroup(
  state: SelfImprovementState,
  input: SelfImprovementGroupUpdateInput,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.selfImprovementError = null;
  try {
    await state.client.request(
      "selfImprovement.groups.update",
      {
        id: input.id,
        status: input.status,
        note: input.note,
        assignedTargetAgentId: input.assignedTargetAgentId,
        claimedBy: input.claimedBy,
        resolutionProof: input.resolutionProof,
        dismissalReason: input.dismissalReason,
      },
      { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
    );
    await loadSelfImprovementRecommendations(state);
  } catch (error) {
    state.selfImprovementError = formatSelfImprovementError(error);
  }
}

export async function updateSelfImprovementCuratorProposal(
  state: SelfImprovementState,
  input: SelfImprovementCuratorUpdateInput,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.selfImprovementError = null;
  try {
    await state.client.request(
      "selfImprovement.curator.update",
      {
        id: input.id,
        curatorStatus: input.curatorStatus,
        proof: input.proof,
        reason: input.reason,
        workshopProposalId: input.workshopProposalId,
        workshopProposalStatus: input.workshopProposalStatus,
        note: input.note,
      },
      { timeoutMs: SELF_IMPROVEMENT_REQUEST_TIMEOUT_MS },
    );
    await loadSelfImprovementRecommendations(state);
  } catch (error) {
    state.selfImprovementError = formatSelfImprovementError(error);
  }
}
