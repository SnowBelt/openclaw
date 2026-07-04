import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts/snes-asset-studio.mjs");
const teamScriptPath = path.join(process.cwd(), "scripts/snes-team-orchestrator.mjs");
const fixturePath = path.join(process.cwd(), "fixtures/snes-asset-studio/source-fixture.png");
const promptPath = path.join(process.cwd(), "fixtures/snes-demo-prompt.txt");

function uniqueProject(prefix = "asset-studio-test") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function runAsset(args: string[]) {
  const output = execFileSync(process.execPath, [scriptPath, ...args, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function runAssetBlocked(args: string[]) {
  const result = spawnSync(process.execPath, [scriptPath, ...args, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  return JSON.parse(result.stdout);
}

function runTeam(args: string[]) {
  const output = execFileSync(process.execPath, [teamScriptPath, ...args, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return JSON.parse(output);
}

describe("SNES Asset Studio CLI", () => {
  it("preserves, converts, contact-sheets, and inserts a generic asset without runtime-proof collapse", () => {
    const project = uniqueProject();
    const assetId = "hero_sprite";
    const preserve = runAsset([
      "preserve",
      "--project",
      project,
      "--asset-id",
      assetId,
      "--kind",
      "sprite",
      "--source",
      fixturePath,
    ]);
    expect(preserve.status).toBe("pass");
    expect(preserve.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(preserve.source.preservedPath)).toBe(true);

    const intent = runAsset([
      "intent",
      "--project",
      project,
      "--asset-id",
      assetId,
      "--kind",
      "sprite",
      "--dimensions",
      "32x32",
      "--frames",
      "3",
      "--must-show",
      "readable hero silhouette,clear face",
      "--must-not-show",
      "placeholder box,licensed character",
    ]);
    expect(intent.status).toBe("pass");
    expect(intent.intent.runtimeProofRequired).toBe(true);

    const conversion = runAsset(["convert", "--project", project, "--asset-id", assetId]);
    expect(conversion.status).toBe("pass");
    expect(conversion.output.colorCount).toBeLessThanOrEqual(16);
    expect(conversion.output.frameCount).toBe(3);

    const contactSheet = runAsset(["contact-sheet", "--project", project, "--asset-id", assetId]);
    expect(contactSheet.status).toBe("pass");
    expect(contactSheet.blankFrames).toEqual([]);
    expect(contactSheet.duplicateFrames).toEqual([]);
    expect(fs.existsSync(contactSheet.contactSheetPath)).toBe(true);

    const pipeline = runAsset(["pipeline", "--project", project, "--asset-id", assetId]);
    expect(pipeline.status).toBe("pass");
    expect(pipeline.runtimeProofSatisfied).toBe(false);
    expect(pipeline.stages.runtimeUse.status).toBe("blocked");

    const created = runTeam([
      "--mode",
      "create-game",
      "--project",
      project,
      "--prompt",
      promptPath,
    ]);
    expect(created.status).toBe("pass");

    const insertion = runAsset([
      "insert",
      "--project",
      project,
      "--asset-id",
      assetId,
      "--target",
      "player.sprite",
    ]);
    expect(insertion.status).toBe("pass");
    expect(insertion.runtimeProofSatisfied).toBe(false);
    expect(fs.existsSync(insertion.manifestPath)).toBe(true);

    const runtimePlan = runAssetBlocked([
      "runtime-proof-plan",
      "--project",
      project,
      "--asset-id",
      assetId,
    ]);
    expect(runtimePlan.status).toBe("blocked");
    expect(runtimePlan.staticInsertionIsRuntimeProof).toBe(false);
    expect(runtimePlan.requiredFutureProof.expectedRuntimeLocation).toBe("player.sprite");

    const dashboard = runTeam(["--mode", "dashboard-snapshot", "--project", project]);
    expect(dashboard.status).toBe("pass");
    expect(dashboard.assetStudio.assetCount).toBe(1);
    expect(dashboard.assetStudio.assets[0]).toMatchObject({
      assetId,
      target: "player.sprite",
      runtimeProofSatisfied: false,
    });
  });

  it("blocks missing sources and blocked named-game or commercial references", () => {
    const project = uniqueProject("asset-studio-negative");
    const missing = runAssetBlocked([
      "preserve",
      "--project",
      project,
      "--asset-id",
      "missing_sprite",
      "--kind",
      "sprite",
      "--source",
      "fixtures/snes-asset-studio/does-not-exist.png",
    ]);
    expect(missing.status).toBe("blocked");
    expect(missing.blocker).toContain("source image not found");

    const named = runAssetBlocked([
      "preserve",
      "--project",
      project,
      "--asset-id",
      "metro_sprite",
      "--kind",
      "sprite",
      "--source",
      fixturePath,
    ]);
    expect(named.status).toBe("blocked");
    expect(named.blocker).toContain("blocked named-game");

    const commercial = runAssetBlocked([
      "intent",
      "--project",
      project,
      "--asset-id",
      "hero_sprite",
      "--kind",
      "sprite",
      "--must-show",
      "Super Mario style copy",
    ]);
    expect(commercial.status).toBe("blocked");
    expect(commercial.blocker).toContain("blocked named-game or commercial reference");
  });

  it("records local-only redraw attempts as blocked when no local generator is configured", () => {
    const project = uniqueProject("asset-studio-redraw");
    const result = spawnSync(
      process.execPath,
      [scriptPath, "redraw-local", "--project", project, "--asset-id", "hero_sprite", "--json"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 90_000,
      },
    );
    expect(result.status).not.toBe(0);
    const receipt = JSON.parse(result.stdout);
    expect(receipt.status).toBe("blocked");
    expect(receipt.hostedImageGenerationUsed).toBe(false);
    expect(receipt.hostedGlmUsed).toBe(false);
  });
});
