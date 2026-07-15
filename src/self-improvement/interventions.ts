import crypto from "node:crypto";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { appendSelfImprovementAuditEvent } from "./audit-events.js";
import {
  buildSelfImprovementRecommendation,
  type SelfImprovementRecommendationDraft,
} from "./auditor.js";
import { resolveSelfImprovementRoute } from "./routing.js";
import { upsertSelfImprovementRecommendations } from "./store.js";
import { sanitizeRecommendationText, sanitizeRecommendationTexts } from "./text.js";
import type { SelfImprovementRecommendation } from "./types.js";

export type SelfImprovementDashboardInterventionInput = {
  title: string;
  issue: string;
  correctiveIntervention: string;
  evidence?: readonly string[];
};

export type SelfImprovementDashboardInterventionResult = {
  recommendation: SelfImprovementRecommendation;
  created: boolean;
  updated: boolean;
  reopened: boolean;
  auditEventId: string;
};

function interventionKey(params: SelfImprovementDashboardInterventionInput): string {
  return crypto
    .createHash("sha256")
    .update(`${params.title.trim()}\n${params.issue.trim()}`)
    .digest("hex")
    .slice(0, 24);
}

export async function recordSelfImprovementDashboardIntervention(params: {
  cfg: OpenClawConfig;
  intervention: SelfImprovementDashboardInterventionInput;
  stateDir?: string;
  now?: number;
}): Promise<SelfImprovementDashboardInterventionResult> {
  const title = sanitizeRecommendationText(params.intervention.title, 180);
  const issue = sanitizeRecommendationText(params.intervention.issue, 640);
  const correctiveIntervention = sanitizeRecommendationText(
    params.intervention.correctiveIntervention,
    640,
  );
  if (!title || !issue || !correctiveIntervention) {
    throw new Error("Dashboard intervention requires title, issue, and corrective intervention.");
  }
  const now = params.now ?? Date.now();
  const key = interventionKey({ ...params.intervention, title, issue });
  const evidence = sanitizeRecommendationTexts(
    [
      `Operator-reported dashboard issue: ${issue}`,
      `Operator corrective intervention: ${correctiveIntervention}`,
      ...(params.intervention.evidence ?? []),
    ],
    300,
  );
  const draft: SelfImprovementRecommendationDraft = {
    category: "risk_prevention",
    severity: "medium",
    impact: "medium",
    effort: "small",
    title: `Prevent dashboard intervention recurrence: ${title}`,
    summary:
      "An operator recorded a real dashboard issue and corrective intervention. The Governor must preserve the evidence and require a prevention proof before closure.",
    source: {
      kind: "workflow",
      label: "Operator dashboard intervention",
      runId: `dashboard-intervention:${key}`,
    },
    route: resolveSelfImprovementRoute({ cfg: params.cfg, category: "risk_prevention" }),
    recommendedAction:
      "Reproduce the reported dashboard issue, add the narrowest prevention guard or smoke, and attach passing evidence before requesting closure.",
    requiredEvidence: [
      "Retain the operator issue and corrective-intervention evidence.",
      "Add or run the narrowest dashboard regression test or smoke that prevents recurrence.",
      "Attach a passing prevention-proof receipt before resolution.",
    ],
    evidence,
    confidence: 0.9,
  };
  const candidate = buildSelfImprovementRecommendation(draft, now);
  const upsert = await upsertSelfImprovementRecommendations({
    stateDir: params.stateDir,
    recommendations: [candidate],
  });
  const recommendation = upsert.recommendations.find((entry) => entry.id === candidate.id);
  if (!recommendation) {
    throw new Error("Dashboard intervention recommendation was not persisted.");
  }
  const auditEvent = await appendSelfImprovementAuditEvent({
    stateDir: params.stateDir,
    event: {
      kind: "dashboard_intervention_recorded",
      actor: "operator",
      targetId: recommendation.id,
      summary: "Operator dashboard intervention recorded as evidence-bound prevention work.",
      metadata: {
        source: "operator_dashboard_intervention",
        preventionProofRequired: true,
        issueTitle: title,
      },
    },
  });
  return {
    recommendation,
    created: upsert.created === 1,
    updated: upsert.updated === 1,
    reopened: upsert.reopened === 1,
    auditEventId: auditEvent.id,
  };
}
