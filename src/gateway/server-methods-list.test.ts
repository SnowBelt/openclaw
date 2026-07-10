/**
 * Tests the registered gateway server method list and exported method names.
 */
import { describe, expect, it } from "vitest";
import { GATEWAY_EVENTS, listGatewayMethods } from "./server-methods-list.js";
import { coreGatewayHandlers } from "./server-methods.js";

describe("GATEWAY_EVENTS", () => {
  it("advertises Talk event streams in hello features", () => {
    expect(GATEWAY_EVENTS).toContain("talk.event");
    expect(GATEWAY_EVENTS).not.toContain("talk.realtime.relay");
    expect(GATEWAY_EVENTS).not.toContain("talk.transcription.relay");
  });
});

describe("listGatewayMethods", () => {
  it("advertises plugin surface refresh for capability rotation", () => {
    expect(listGatewayMethods()).toContain("node.pluginSurface.refresh");
  });

  it("advertises ClawHub skill trust methods", () => {
    const methods = listGatewayMethods();
    expect(methods).toContain("skills.securityVerdicts");
    expect(methods).toContain("skills.skillCard");
  });

  it("does not advertise hidden core handlers", () => {
    const methods = listGatewayMethods();
    expect(methods).not.toContain("config.openFile");
    expect(methods).not.toContain("chat.inject");
    expect(methods).not.toContain("nativeHook.invoke");
    expect(methods).not.toContain("sessions.usage");
  });

  it("preserves the legacy advertised method order", () => {
    const methods = listGatewayMethods();
    expect(methods.slice(0, 5)).toEqual([
      "health",
      "diagnostics.stability",
      "doctor.memory.status",
      "doctor.memory.dreamDiary",
      "doctor.memory.backfillDreamDiary",
    ]);
    const execApprovalStart = methods.indexOf("exec.approvals.get");
    expect(execApprovalStart).toBeGreaterThan(0);
    expect(methods.slice(execApprovalStart, execApprovalStart + 5)).toEqual([
      "exec.approvals.get",
      "exec.approvals.set",
      "exec.approvals.node.get",
      "exec.approvals.node.set",
      "exec.approval.get",
    ]);
  });

  it("advertises Project Command Center methods", () => {
    const methods = listGatewayMethods();
    const pccMethods = [
      "pcc.projects.list",
      "pcc.ledger.repairCanonicalMetadata",
      "pcc.projects.upsert",
      "pcc.milestones.upsert",
      "pcc.subMilestones.list",
      "pcc.subMilestones.upsert",
      "pcc.permissions.upsert",
      "pcc.receipts.add",
      "pcc.decisions.add",
      "pcc.lastKnownGood.upsert",
    ];
    for (const method of pccMethods) {
      expect(methods).toContain(method);
      expect(coreGatewayHandlers[method]).toBeTypeOf("function");
    }
  });

  it("advertises every SNES Studio method with a registered handler", () => {
    const methods = listGatewayMethods();
    const snesMethods = [
      "snes.benchmark.latest",
      "snes.glm52.status",
      "snes.mastery.status",
      "snes.assetStudio.pipeline",
      "snes.proof.run",
      "snes.project.createBlank",
      "snes.toolchain.status",
      "snes.visual.artBible",
      "snes.visual.artManifest",
      "snes.visual.artSourcePack",
      "snes.visual.compileArt",
      "snes.visual.reject",
      "snes.visual.captureProof",
      "snes.visual.qualityAudit",
      "snes.visual.runtimeAssetTruth",
      "snes.visual.approve",
      "snes.production.status",
      "snes.production.continue",
      "snes.production.auto",
      "snes.production.pause",
      "snes.production.resume",
      "snes.production.cancel",
      "snes.production.splitNext",
      "snes.production.retryBlocked",
      "snes.stanski.production.status",
      "snes.stanski.production.continue",
      "snes.stanski.production.auto",
      "snes.stanski.production.pause",
      "snes.stanski.production.resume",
      "snes.stanski.production.cancel",
      "snes.stanski.production.splitNext",
      "snes.stanski.production.retryBlocked",
    ];
    for (const method of snesMethods) {
      expect(methods).toContain(method);
      expect(coreGatewayHandlers[method]).toBeTypeOf("function");
    }
  });

  it("advertises every Self-Improvement method with a registered handler", () => {
    const methods = listGatewayMethods();
    const selfImprovementMethods = [
      "selfImprovement.auditEvents.list",
      "selfImprovement.scan",
      "selfImprovement.summary",
      "selfImprovement.scorecard",
      "selfImprovement.health",
      "selfImprovement.productionCheck",
      "selfImprovement.maintenance.run",
      "selfImprovement.analysis.run",
      "selfImprovement.models.preflight",
      "selfImprovement.evals.run",
      "selfImprovement.groups.update",
      "selfImprovement.recommendations.list",
      "selfImprovement.recommendations.get",
      "selfImprovement.recommendations.update",
      "selfImprovement.proposals.list",
      "selfImprovement.proposals.get",
      "selfImprovement.proposals.update",
      "selfImprovement.curator.list",
      "selfImprovement.curator.get",
      "selfImprovement.curator.update",
    ];
    for (const method of selfImprovementMethods) {
      expect(methods).toContain(method);
      expect(coreGatewayHandlers[method]).toBeTypeOf("function");
    }
  });

  it("advertises the versioned Talk session RPCs", () => {
    const methods = listGatewayMethods();
    expect(methods).toContain("talk.client.create");
    expect(methods).toContain("talk.client.toolCall");
    expect(methods).toContain("talk.client.steer");
    expect(methods).toContain("talk.session.create");
    expect(methods).toContain("talk.session.join");
    expect(methods).toContain("talk.session.appendAudio");
    expect(methods).toContain("talk.session.startTurn");
    expect(methods).toContain("talk.session.endTurn");
    expect(methods).toContain("talk.session.cancelTurn");
    expect(methods).toContain("talk.session.cancelOutput");
    expect(methods).toContain("talk.session.submitToolResult");
    expect(methods).toContain("talk.session.steer");
    expect(methods).toContain("talk.session.close");
  });
});
