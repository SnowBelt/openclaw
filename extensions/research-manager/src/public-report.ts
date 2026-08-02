import { redactSensitiveText } from "openclaw/plugin-sdk/security-runtime";
import type { ResearchRunReport } from "./types.js";

function redact(value: string | undefined): string | undefined {
  return value === undefined ? undefined : redactSensitiveText(value, { mode: "tools" });
}

function redactList(values: string[] | undefined): string[] | undefined {
  return values?.map((value) => redact(value) ?? "");
}

function redactFinding(finding: ResearchRunReport["findings"][number]) {
  return {
    ...finding,
    summary: redact(finding.summary) ?? "",
    gaps: finding.gaps.map((gap) => redact(gap) ?? ""),
    claims: finding.claims.map((claim) => ({
      ...claim,
      text: redact(claim.text) ?? "",
      contradiction: redact(claim.contradiction),
      evidence: claim.evidence.map((entry) => ({
        ...entry,
        quote: redact(entry.quote) ?? "",
      })),
    })),
  };
}

export function toPublicResearchReport(report: ResearchRunReport): ResearchRunReport {
  return {
    ...report,
    query: redact(report.query) ?? "",
    answer: redact(report.answer),
    limitations: redactList(report.limitations),
    blockedReason: redact(report.blockedReason),
    failure: redact(report.failure),
    gaps: report.gaps.map((gap) => redact(gap) ?? ""),
    plan: report.plan
      ? {
          ...report.plan,
          objective: redact(report.plan.objective) ?? "",
          questions: report.plan.questions.map((question) => ({
            ...question,
            question: redact(question.question) ?? "",
          })),
          queries: report.plan.queries.map((query) => ({
            ...query,
            query: redact(query.query) ?? "",
            preferredSourceTypes: redactList(query.preferredSourceTypes) ?? [],
          })),
          sourceRequirements: redactList(report.plan.sourceRequirements) ?? [],
          stopConditions: redactList(report.plan.stopConditions) ?? [],
        }
      : undefined,
    sources: report.sources.map(({ content: _content, ...source }) => ({
      ...source,
      query: redact(source.query) ?? "",
      url: redact(source.url) ?? "",
      finalUrl: redact(source.finalUrl),
      domain: redact(source.domain) ?? "",
      title: redact(source.title) ?? "",
      snippet: redact(source.snippet) ?? "",
      searchProvider: redact(source.searchProvider) ?? "",
      contentType: redact(source.contentType),
      promptInjectionSignals: redactList(source.promptInjectionSignals),
      rejectionReason: redact(source.rejectionReason),
    })),
    claims: report.claims.map((claim) => ({
      ...claim,
      text: redact(claim.text) ?? "",
      contradiction: redact(claim.contradiction),
      evidence: claim.evidence.map((entry) => ({
        ...entry,
        quote: redact(entry.quote) ?? "",
      })),
    })),
    findings: report.findings.map(redactFinding),
    researchUnitFindings: report.researchUnitFindings?.map(redactFinding),
    certification: report.certification
      ? {
          ...report.certification,
          hardGateFailures: redactList(report.certification.hardGateFailures) ?? [],
          dimensions: report.certification.dimensions.map((dimension) => ({
            ...dimension,
            notes: redactList(dimension.notes) ?? [],
          })),
        }
      : undefined,
    attempts: report.attempts.map((attempt) => ({
      ...attempt,
      fallbackReason: redact(attempt.fallbackReason),
      error: redact(attempt.error),
    })),
  };
}

export function formatResearchRunText(report: ResearchRunReport): string {
  const safe = toPublicResearchReport(report);
  if (safe.status === "completed" && safe.answer) {
    const certification = safe.certification?.certified
      ? `Certified ${safe.certification.score}/100.`
      : `Uncertified ${safe.certification?.score ?? 0}/100.`;
    return `${certification}\n\n${safe.answer}`;
  }
  if (safe.status === "blocked") {
    const answer = safe.answer ? `\n\nBest retained draft (not certified):\n${safe.answer}` : "";
    return `Research run ${safe.runId} is blocked: ${safe.blockedReason ?? "required capability unavailable"}.${answer}`;
  }
  if (safe.status === "failed") {
    return `Research run ${safe.runId} failed: ${safe.failure ?? "unknown failure"}.`;
  }
  if (safe.status === "cancelled") {
    return `Research run ${safe.runId} was cancelled.`;
  }
  return `Research run ${safe.runId}: ${safe.status}.`;
}
