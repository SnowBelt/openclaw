import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listSelfImprovementAuditEvents } from "./audit-events.js";
import { recordSelfImprovementDashboardIntervention } from "./interventions.js";
import { listSelfImprovementRecommendations } from "./store.js";

describe("dashboard intervention evidence", () => {
  it("creates evidence-bound prevention work without using healthy lifecycle events", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sig-dashboard-intervention-"));
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const result = await recordSelfImprovementDashboardIntervention({
      cfg: { agents: { list: [{ id: "qa-test-agent" }] } },
      stateDir,
      now,
      intervention: {
        title: "Dashboard route returned stale status",
        issue: "The operator had to refresh the Control UI after an unhealthy cached status.",
        correctiveIntervention:
          "The operator restarted the dashboard view and verified live status.",
        evidence: ["Observed in operator session 2026-07-10."],
      },
    });

    expect(result.created).toBe(true);
    expect(result.recommendation.category).toBe("risk_prevention");
    expect(result.recommendation.source.label).toBe("Operator dashboard intervention");
    expect(result.recommendation.safety.requiresTests).toBe(true);
    expect(result.recommendation.requiredEvidence).toContain(
      "Attach a passing prevention-proof receipt before resolution.",
    );
    expect(result.recommendation.evidence.join(" ")).toContain("operator");

    const repeated = await recordSelfImprovementDashboardIntervention({
      cfg: { agents: { list: [{ id: "qa-test-agent" }] } },
      stateDir,
      now: now + 1_000,
      intervention: {
        title: "Dashboard route returned stale status",
        issue: "The operator had to refresh the Control UI after an unhealthy cached status.",
        correctiveIntervention:
          "The operator restarted the dashboard view and verified live status.",
      },
    });
    expect(repeated.created).toBe(false);
    expect(repeated.updated).toBe(true);

    const recommendations = await listSelfImprovementRecommendations({ stateDir });
    expect(recommendations).toHaveLength(1);
    const events = await listSelfImprovementAuditEvents({ stateDir });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.kind === "dashboard_intervention_recorded")).toBe(true);
  });

  it("rejects empty operator evidence instead of inferring an intervention", async () => {
    await expect(
      recordSelfImprovementDashboardIntervention({
        cfg: {},
        stateDir: await fs.mkdtemp(path.join(os.tmpdir(), "sig-dashboard-intervention-")),
        intervention: { title: "", issue: "", correctiveIntervention: "" },
      }),
    ).rejects.toThrow("Dashboard intervention requires title, issue, and corrective intervention.");
  });
});
