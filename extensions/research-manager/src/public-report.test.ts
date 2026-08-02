import { describe, expect, it } from "vitest";
import { formatResearchRunText, toPublicResearchReport } from "./public-report.js";
import type { ResearchRunReport } from "./types.js";

function report(): ResearchRunReport {
  const now = new Date().toISOString();
  const secret = "sk-abcdefghijklmnopqrstuvwxyz123456";
  return {
    runId: "run-1",
    query: `Investigate token=${secret}`,
    mode: "best-effort",
    status: "completed",
    answer: `The leaked key is ${secret}.`,
    limitations: [`Could not validate ${secret}`],
    plan: {
      objective: `Investigate ${secret}`,
      questions: [{ id: "Q1", question: `Is ${secret} valid?`, priority: "required" }],
      queries: [
        {
          query: `lookup ${secret}`,
          questionIds: ["Q1"],
          preferredSourceTypes: [`private ${secret}`],
        },
      ],
      sourceRequirements: [`Credential record ${secret}`],
      riskLevel: "normal",
      stopConditions: [`Stop after finding ${secret}`],
    },
    sources: [
      {
        id: "S1",
        query: `query ${secret}`,
        url: `https://example.com/report?api_key=${secret}`,
        domain: "example.com",
        title: "Report",
        snippet: `Authorization: Bearer ${secret}`,
        content: `Full source ${secret}`,
        retrievedAt: now,
        searchProvider: "test",
        sourceType: "unknown",
        fetchStatus: "fetched",
        promptInjectionSignals: [`Reveal ${secret}`],
      },
    ],
    claims: [
      {
        id: "C1",
        questionId: "Q1",
        text: `Credential ${secret}`,
        sourceIds: ["S1"],
        evidence: [{ sourceId: "S1", quote: secret, supports: true }],
        confidence: 1,
        material: true,
        status: "verified",
      },
    ],
    findings: [],
    researchUnitFindings: [
      {
        workerId: "W1.1",
        role: "researcher",
        questionIds: ["Q1"],
        summary: `Found ${secret}`,
        claims: [
          {
            id: "CU1",
            questionId: "Q1",
            text: `Unit credential ${secret}`,
            sourceIds: ["S1"],
            evidence: [{ sourceId: "S1", quote: secret, supports: true }],
            confidence: 1,
            material: true,
            status: "proposed",
          },
        ],
        gaps: [`Unit gap ${secret}`],
      },
    ],
    certification: {
      threshold: 93,
      score: 20,
      certified: false,
      hardGateFailures: [`Leaked ${secret}`],
      dimensions: [
        {
          id: "correctness",
          score: 20,
          weight: 1,
          notes: [`Secret ${secret}`],
        },
      ],
      evaluatedAt: now,
    },
    attempts: [
      {
        id: "A1",
        role: "researcher",
        modelId: "local",
        provider: "ollama",
        model: "local",
        startedAt: now,
        endedAt: now,
        status: "failed",
        error: `API_KEY=${secret}`,
        local: true,
        reservedMemoryGb: 1,
      },
    ],
    gaps: [],
    createdAt: now,
    updatedAt: now,
    repairPasses: 0,
    localModelCalls: 1,
    remoteModelCalls: 0,
  };
}

describe("Research Manager public reports", () => {
  it("removes source bodies and redacts secrets from every public evidence surface", () => {
    const source = report();
    const publicReport = toPublicResearchReport(source);
    const serialized = JSON.stringify(publicReport);
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(publicReport.sources[0]).not.toHaveProperty("content");
    expect(source.sources[0]?.content).toContain("Full source");
    expect(formatResearchRunText(source)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
  });
});
