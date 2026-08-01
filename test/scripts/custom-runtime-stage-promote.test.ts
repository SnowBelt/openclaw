import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

function createRuntimeFixtureRoot(prefix: string): string {
  // The production launcher intentionally rejects /tmp releases. Linux exposes
  // os.tmpdir() as /tmp, while macOS uses a per-user /private/var directory.
  const base = process.platform === "linux" ? os.homedir() : os.tmpdir();
  return mkdtempSync(path.join(base, prefix));
}

function executable(filePath: string, content: string): void {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function fixture() {
  const home = realpathSync(createRuntimeFixtureRoot("openclaw-custom-runtime-update-"));
  roots.push(home);
  const runtimeHome = path.join(home, ".openclaw-custom-runtime");
  const releasesDir = path.join(home, ".openclaw-runtime-releases");
  const release = path.join(releasesDir, "release-new");
  const manifestPath = path.join(release, "dist", "control-ui", "dashboard-surfaces.json");
  const assetPath = path.join(release, "dist", "control-ui", "assets", "pcc.js");
  const capabilityManifestPath = path.join(release, "config", "custom-runtime-capabilities.json");
  const evidenceRoot = path.join(release, ".test-release-governance");
  const pluginManifestPath = path.join(release, "extensions", "apps", "openclaw.plugin.json");
  const updateSchedulerPath = path.join(
    release,
    "scripts",
    "custom-runtime",
    "ai.openclaw.custom-runtime.update-weekly.plist",
  );
  const guardSchedulerPath = path.join(
    release,
    "scripts",
    "custom-runtime",
    "ai.openclaw.custom-runtime.guard.plist",
  );
  const entrypoint = path.join(release, "dist", "index.js");
  const sourceSha = "abcdef1234567890abcdef1234567890abcdef12";
  for (const directory of [
    path.dirname(assetPath),
    path.dirname(capabilityManifestPath),
    path.dirname(pluginManifestPath),
    path.dirname(updateSchedulerPath),
    path.dirname(guardSchedulerPath),
    path.join(runtimeHome, "bin"),
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(assetPath, "// pcc\n");
  writeFileSync(pluginManifestPath, "{}\n");
  cpSync(
    path.join(
      process.cwd(),
      "scripts",
      "custom-runtime",
      "ai.openclaw.custom-runtime.update-weekly.plist",
    ),
    updateSchedulerPath,
  );
  cpSync(
    path.join(process.cwd(), "scripts", "custom-runtime", "ai.openclaw.custom-runtime.guard.plist"),
    guardSchedulerPath,
  );
  writeFileSync(path.join(release, "package.json"), '{"type":"module","version":"2026.6.11"}\n');
  writeFileSync(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);
  executable(
    path.join(release, "dist", "release-governor.js"),
    [
      "#!/usr/bin/env node",
      'import fs from "node:fs";',
      "const args = process.argv.slice(2);",
      "const value = (name) => args[args.indexOf(name) + 1];",
      'if (args[0] !== "verify") process.exit(64);',
      'const bundle = JSON.parse(fs.readFileSync(value("--bundle"), "utf8"));',
      'if (bundle.candidateSha !== value("--candidate-sha") || bundle.operation !== value("--operation") || bundle.decision !== "authorize") process.exit(1);',
      'if (!value("--release") || !fs.existsSync(value("--release"))) process.exit(1);',
      'if (!fs.existsSync(value("--policy"))) process.exit(1);',
      "process.exit(0);",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(release, "config", "release-governor-policy.json"),
    '{"schema":"openclaw.release-governor-policy.v1","version":1}\n',
  );
  for (const operation of ["stage", "promotion"]) {
    const evidencePath = path.join(evidenceRoot, sourceSha, `${operation}.json`);
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(
      evidencePath,
      `${JSON.stringify({ candidateSha: sourceSha, operation, decision: "authorize" })}\n`,
      { mode: 0o600 },
    );
  }
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      buildId: "fixture-build",
      surfaces: [{ id: "pcc", path: "/pcc", assets: ["assets/pcc.js"] }],
    })}\n`,
  );
  writeFileSync(
    capabilityManifestPath,
    `${JSON.stringify({
      schema: "openclaw.custom-runtime-capabilities.v1",
      version: 1,
      capabilities: [
        {
          id: "dashboard:pcc",
          kind: "dashboard_surface",
          surfaceId: "pcc",
          requiredPaths: ["dist/control-ui/dashboard-surfaces.json"],
        },
        {
          id: "plugin:apps",
          kind: "plugin",
          pluginId: "apps",
          requiredPaths: ["extensions/apps/openclaw.plugin.json"],
        },
      ],
    })}\n`,
  );
  writeFileSync(
    entrypoint,
    `import http from "node:http";
const args = process.argv.slice(2);
if (args[0] === "self-improvement" && args[1] === "summary") {
  if (
    !process.env.OPENCLAW_GATEWAY_URL?.startsWith("ws://127.0.0.1:") ||
    process.env.OPENCLAW_GATEWAY_TOKEN !== "fixture-gateway-token"
  ) {
    process.stderr.write("missing explicit stage Gateway auth environment\\n");
    process.exit(2);
  }
  process.stdout.write('{"scorecard":{},"groups":[]}\\n');
  process.exit(0);
}

const port = Number(args[args.indexOf("--port") + 1]);
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(req.url === "/health" ? '{"ok":true}' : '{}');
});
server.on("upgrade", (_req, socket) => {
  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\n\\r\\n");
  socket.end();
});
server.listen(port, "127.0.0.1");
`,
  );
  const bundledPlugins = path.join(release, "dist-runtime", "extensions");
  mkdirSync(bundledPlugins, { recursive: true });
  writeFileSync(
    path.join(release, "snapshot.json"),
    `${JSON.stringify({
      version: 2,
      releaseId: "release-new",
      root: release,
      createdAt: "2026-07-14T06:29:44.990Z",
      packageVersion: "2026.6.11",
      artifactHash: "a".repeat(64),
      source: { commit: sourceSha },
      schemas: {
        runtimeSnapshot: 2,
        selfImprovementLedger: 1,
        selfImprovementRecommendationStore: 3,
        selfImprovementSignal: 1,
      },
      paths: { entrypoint, controlUi: path.dirname(manifestPath), bundledPlugins },
    })}\n`,
  );
  const launcher = path.join(runtimeHome, "bin", "custom-runtime-launcher.sh");
  cpSync(
    path.join(process.cwd(), "scripts", "custom-runtime", "custom-runtime-launcher.sh"),
    launcher,
  );
  chmodSync(launcher, 0o755);
  return {
    capabilityManifestPath,
    entrypoint,
    evidenceRoot,
    home,
    manifestPath,
    release,
    releasesDir,
    runtimeHome,
    sourceSha,
  };
}

function writeReadyUsabilityCampaign(
  input: ReturnType<typeof fixture>,
  overrides: Record<string, unknown> = {},
) {
  const usabilityRoot = path.join(input.runtimeHome, "usability");
  const campaignPath = path.join(usabilityRoot, "or2-human-proof.json");
  mkdirSync(usabilityRoot, { recursive: true, mode: 0o700 });
  const plans = [
    ["7-12", "desktop", "standard"],
    ["13-64", "desktop", "keyboard-only"],
    ["65-90", "mobile", "standard"],
    ["13-64", "mobile", "standard"],
    ["13-64", "desktop", "zoom-200"],
  ] as const;
  const participants = plans.map(([cohort, device, accessibilityMode], index) => ({
    accessibilityMode,
    cohort,
    consentRecorded: true,
    device,
    eligible: true,
    eligibilityReason: "first-use-and-consent-confirmed",
    firstUse: true,
    guardianConsentRecorded: cohort === "7-12",
    id: createHash("sha256").update(`anonymous-usability-${index}`).digest("hex"),
    registeredAt: "2026-07-28T18:00:00.000Z",
    status: "registered",
    viewport: device === "mobile" ? "390x844" : "1440x900",
  }));
  const campaign = {
    campaignId: "or2-final-human-proof",
    candidateSha: input.sourceSha,
    createdAt: "2026-07-28T18:00:00.000Z",
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    fixtureSha256: "b".repeat(64),
    neutralGoal:
      "Use this screen to tell me whether OpenClaw needs the operator, what it is doing now, and show me the most important issue's details.",
    participants,
    schema: "openclaw.operations-room.usability-campaign.v1",
    state: "ready",
    summary: {
      coverage: {
        accessibility: true,
        ageCohorts: true,
        desktop: true,
        mobile: true,
      },
      eligibleParticipantCount: 5,
      excludedParticipantCount: 0,
      failedAttemptCount: 0,
      leaseAllowed: true,
      nextAction: "Start the next eligible participant's timed attempt.",
      passedAttemptCount: 0,
      remainingParticipantCount: 0,
      runningAttemptCount: 0,
      unsafeActionCount: 0,
    },
    updatedAt: "2026-07-28T18:05:00.000Z",
    ...overrides,
  };
  writeFileSync(campaignPath, `${JSON.stringify(campaign)}\n`, { mode: 0o600 });
  const ledgerPath = path.join(usabilityRoot, "participant-ledger.json");
  writeFileSync(
    ledgerPath,
    `${JSON.stringify({
      campaigns: [
        {
          campaignId: campaign.campaignId,
          candidateSha: campaign.candidateSha,
          createdAt: campaign.createdAt,
          expiresAt: campaign.expiresAt,
          fixtureSha256: campaign.fixtureSha256,
        },
      ],
      participants: participants.map(({ id, ...participant }) =>
        Object.assign(participant, {
          campaignId: campaign.campaignId,
          candidateSha: campaign.candidateSha,
          participantId: id,
        }),
      ),
      schema: "openclaw.operations-room.usability-participant-ledger.v1",
      updatedAt: campaign.updatedAt,
    })}\n`,
    { mode: 0o600 },
  );
  chmodSync(campaignPath, 0o600);
  chmodSync(ledgerPath, 0o600);
  return campaignPath;
}

function writeReadyOwnerCampaign(input: ReturnType<typeof fixture>) {
  const usabilityRoot = path.join(input.runtimeHome, "usability");
  const campaignPath = path.join(usabilityRoot, "or2-owner-proof.json");
  mkdirSync(usabilityRoot, { recursive: true, mode: 0o700 });
  const participant = {
    accessibilityMode: "standard",
    browser: "chrome",
    consentRecorded: true,
    device: "mac-studio",
    eligible: true,
    eligibilityReason: "owner-consent-and-device-confirmed",
    id: createHash("sha256").update("control-director-owner").digest("hex"),
    operatorRole: "control-director",
    registeredAt: "2026-07-28T18:00:00.000Z",
    status: "registered",
    viewport: "1728x1117",
  };
  const campaign = {
    activeRuntimeSha: input.sourceSha,
    campaignId: "or2-owner-mac-studio-proof",
    candidateSha: input.sourceSha,
    createdAt: "2026-07-28T18:00:00.000Z",
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    fixtureSha256: "c".repeat(64),
    neutralGoal:
      "Use Operations Room to confirm system health, distinguish OpenClaw work from independent local AI, inspect the most important issue, preview Resolve, and cancel safely.",
    participants: [participant],
    policy: "owner-mac-studio",
    schema: "openclaw.operations-room.usability-campaign.v1",
    state: "ready",
    summary: {
      coverage: {
        browser: true,
        device: true,
        operatorRole: true,
      },
      eligibleParticipantCount: 1,
      excludedParticipantCount: 0,
      failedAttemptCount: 0,
      leaseAllowed: true,
      nextAction: "Start the owner's timed Mac Studio acceptance attempt.",
      participantCountValid: true,
      passedAttemptCount: 0,
      policy: "owner-mac-studio",
      remainingParticipantCount: 0,
      runningAttemptCount: 0,
      unsafeActionCount: 0,
    },
    updatedAt: "2026-07-28T18:05:00.000Z",
  };
  writeFileSync(campaignPath, `${JSON.stringify(campaign)}\n`, { mode: 0o600 });
  const { id, ...ledgerParticipant } = participant;
  const ledgerPath = path.join(usabilityRoot, "participant-ledger.json");
  writeFileSync(
    ledgerPath,
    `${JSON.stringify({
      campaigns: [
        {
          activeRuntimeSha: campaign.activeRuntimeSha,
          campaignId: campaign.campaignId,
          candidateSha: campaign.candidateSha,
          createdAt: campaign.createdAt,
          expiresAt: campaign.expiresAt,
          fixtureSha256: campaign.fixtureSha256,
          policy: campaign.policy,
        },
      ],
      participants: [
        {
          ...ledgerParticipant,
          campaignId: campaign.campaignId,
          candidateSha: campaign.candidateSha,
          participantId: id,
          policy: campaign.policy,
        },
      ],
      schema: "openclaw.operations-room.usability-participant-ledger.v1",
      updatedAt: campaign.updatedAt,
    })}\n`,
    { mode: 0o600 },
  );
  chmodSync(campaignPath, 0o600);
  chmodSync(ledgerPath, 0o600);
  return campaignPath;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("custom runtime canary and rollback", () => {
  it("accepts one exact-runtime Control Director owner on Mac Studio", () => {
    const input = fixture();
    const activePointer = path.join(input.runtimeHome, "active-runtime.json");
    const leasePath = path.join(input.runtimeHome, "certification-lease.json");
    const promoteScript = path.join(
      process.cwd(),
      "scripts",
      "custom-runtime",
      "custom-runtime-promote.sh",
    );
    mkdirSync(input.runtimeHome, { recursive: true });
    writeFileSync(activePointer, `${JSON.stringify({ sourceSha: input.sourceSha })}\n`);
    const campaignPath = writeReadyOwnerCampaign(input);
    const env = {
      ...process.env,
      HOME: input.home,
      OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
    };
    const binding = [
      "--active-sha",
      input.sourceSha,
      "--candidate-sha",
      input.sourceSha,
      "--owner",
      "codex:or2-owner-finalization",
      "--operation-class",
      "human-usability-finalization",
      "--approval-id",
      "user:or2-owner-proof",
      "--operation-id",
      "or2:owner-finalization",
      "--invocation-id",
      "or2-owner-finalization-20260728",
    ];
    const acquired = spawnSync(
      "sh",
      [
        promoteScript,
        "--lease-acquire",
        ...binding,
        "--ttl-seconds",
        "600",
        "--usability-campaign",
        campaignPath,
      ],
      { cwd: process.cwd(), encoding: "utf8", env },
    );
    expect(acquired.status, acquired.stderr).toBe(0);
    expect(JSON.parse(readFileSync(leasePath, "utf8"))).toMatchObject({
      activeSha: input.sourceSha,
      candidateSha: input.sourceSha,
      usabilityCampaignId: "or2-owner-mac-studio-proof",
    });

    const campaign = JSON.parse(readFileSync(campaignPath, "utf8"));
    campaign.activeRuntimeSha = "d".repeat(40);
    writeFileSync(campaignPath, `${JSON.stringify(campaign)}\n`, { mode: 0o600 });
    const status = spawnSync("sh", [promoteScript, "--lease-status"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
    expect(status.status).toBe(78);
    expect(status.stderr).toContain("exact active runtime");
  });

  it("retains a finalization lease only while exact human-usability evidence stays valid", () => {
    const input = fixture();
    const activePointer = path.join(input.runtimeHome, "active-runtime.json");
    const leasePath = path.join(input.runtimeHome, "certification-lease.json");
    const promoteScript = path.join(
      process.cwd(),
      "scripts",
      "custom-runtime",
      "custom-runtime-promote.sh",
    );
    mkdirSync(input.runtimeHome, { recursive: true });
    writeFileSync(activePointer, `${JSON.stringify({ sourceSha: input.sourceSha })}\n`);
    const campaignPath = writeReadyUsabilityCampaign(input);
    const binding = [
      "--active-sha",
      input.sourceSha,
      "--candidate-sha",
      input.sourceSha,
      "--owner",
      "codex:or2-finalization",
      "--operation-class",
      "human-usability-finalization",
      "--approval-id",
      "user:or2-human-proof",
      "--operation-id",
      "or2:human-finalization",
      "--invocation-id",
      "or2-human-finalization-20260728",
    ];
    const env = {
      ...process.env,
      HOME: input.home,
      OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
    };

    const missingCampaign = spawnSync(
      "sh",
      [promoteScript, "--lease-acquire", ...binding, "--ttl-seconds", "600"],
      { cwd: process.cwd(), encoding: "utf8", env },
    );
    expect(missingCampaign.status).toBe(64);
    expect(existsSync(leasePath)).toBe(false);

    const acquired = spawnSync(
      "sh",
      [
        promoteScript,
        "--lease-acquire",
        ...binding,
        "--ttl-seconds",
        "600",
        "--usability-campaign",
        campaignPath,
      ],
      { cwd: process.cwd(), encoding: "utf8", env },
    );
    expect(acquired.status, acquired.stderr).toBe(0);
    expect(JSON.parse(readFileSync(leasePath, "utf8"))).toMatchObject({
      activeSha: input.sourceSha,
      candidateSha: input.sourceSha,
      operationClass: "human-usability-finalization",
      usabilityCampaignId: "or2-final-human-proof",
      usabilityCampaignPath: campaignPath,
    });

    const coordinatorScript = path.join(
      process.cwd(),
      "scripts",
      "custom-runtime",
      "custom-runtime-usability-coordinator.mjs",
    );
    const participantIds = JSON.parse(readFileSync(campaignPath, "utf8")).participants.map(
      (participant: { id: string }) => participant.id,
    );
    for (const [index, participantId] of participantIds.entries()) {
      const started = spawnSync(
        process.execPath,
        [coordinatorScript, "start", "--campaign", campaignPath, "--participant-id", participantId],
        { cwd: process.cwd(), encoding: "utf8", env },
      );
      expect(started.status, started.stderr).toBe(0);
      if (index === 0) {
        const runningStatus = spawnSync("sh", [promoteScript, "--lease-status"], {
          cwd: process.cwd(),
          encoding: "utf8",
          env,
        });
        expect(runningStatus.status, runningStatus.stderr).toBe(0);
      }
      const completed = spawnSync(
        process.execPath,
        [
          coordinatorScript,
          "complete",
          "--campaign",
          campaignPath,
          "--participant-id",
          participantId,
          "--overall-state-correct",
          "true",
          "--operator-action-correct",
          "true",
          "--working-item-identified",
          "true",
          "--issue-details-and-owner-or-next",
          "true",
          "--hint-count",
          "0",
          "--unsafe-action-count",
          "0",
          "--observer-attested",
          "true",
        ],
        { cwd: process.cwd(), encoding: "utf8", env },
      );
      expect(completed.status, completed.stderr).toBe(0);
    }
    const passedStatus = spawnSync("sh", [promoteScript, "--lease-status"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
    expect(passedStatus.status, passedStatus.stderr).toBe(0);
    const automaticReceiptPath = `${campaignPath}.receipt.json`;
    expect(existsSync(automaticReceiptPath)).toBe(true);
    expect(JSON.parse(readFileSync(automaticReceiptPath, "utf8"))).toMatchObject({
      candidateSha: input.sourceSha,
      result: "passed",
      schema: "openclaw.operations-room.usability-receipt.v1",
    });

    const campaign = JSON.parse(readFileSync(campaignPath, "utf8"));
    campaign.participants[0].device = "mobile";
    writeFileSync(campaignPath, `${JSON.stringify(campaign)}\n`, { mode: 0o600 });
    const tamperedStatus = spawnSync("sh", [promoteScript, "--lease-status"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
    expect(tamperedStatus.status).toBe(78);
    expect(tamperedStatus.stderr).toContain("durable participant ledger");
    campaign.participants[0].device = "desktop";

    campaign.participants[0].status = "failed";
    const failedFinishedAt = Date.now();
    campaign.participants[0].attempt = {
      elapsedMs: 61_000,
      finishedAt: new Date(failedFinishedAt).toISOString(),
      hintCount: 0,
      observerAttested: true,
      outcomes: {
        issueDetailsAndOwnerOrNext: true,
        operatorActionCorrect: true,
        overallStateCorrect: true,
        workingItemIdentified: true,
      },
      passed: false,
      startedAt: new Date(failedFinishedAt - 61_000).toISOString(),
      unsafeActionCount: 0,
    };
    campaign.state = "failed";
    campaign.summary.failedAttemptCount = 1;
    campaign.summary.leaseAllowed = false;
    writeFileSync(campaignPath, `${JSON.stringify(campaign)}\n`, { mode: 0o600 });
    const ledgerPath = path.join(path.dirname(campaignPath), "participant-ledger.json");
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    ledger.participants[0].status = "failed";
    ledger.participants[0].attempt = campaign.participants[0].attempt;
    writeFileSync(ledgerPath, `${JSON.stringify(ledger)}\n`, { mode: 0o600 });

    const invalidStatus = spawnSync("sh", [promoteScript, "--lease-status"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
    expect(invalidStatus.status).toBe(78);
    expect(invalidStatus.stderr).toContain("failed attempt");
    expect(existsSync(leasePath)).toBe(true);

    const released = spawnSync("sh", [promoteScript, "--lease-release", ...binding], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
    expect(released.status, released.stderr).toBe(0);
    expect(existsSync(leasePath)).toBe(false);
  });

  it("acquires, reports, and releases one exact certification lease", () => {
    const input = fixture();
    const activeSha = "1".repeat(40);
    const activePointer = path.join(input.runtimeHome, "active-runtime.json");
    const promoteScript = path.join(
      process.cwd(),
      "scripts",
      "custom-runtime",
      "custom-runtime-promote.sh",
    );
    mkdirSync(input.runtimeHome, { recursive: true });
    writeFileSync(activePointer, `${JSON.stringify({ sourceSha: activeSha })}\n`);
    const binding = [
      "--active-sha",
      activeSha,
      "--candidate-sha",
      input.sourceSha,
      "--owner",
      "codex:pr-40",
      "--operation-class",
      "release-certification",
      "--approval-id",
      "release-governor:pr-41",
      "--operation-id",
      "certification:pr-41",
      "--invocation-id",
      "certification-pr-41",
    ];
    const env = {
      ...process.env,
      HOME: input.home,
      OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
    };

    const acquired = spawnSync(
      "sh",
      [promoteScript, "--lease-acquire", ...binding, "--ttl-seconds", "600"],
      { cwd: process.cwd(), encoding: "utf8", env },
    );
    expect(acquired.status, acquired.stderr).toBe(0);
    const leasePath = path.join(input.runtimeHome, "certification-lease.json");
    expect(JSON.parse(readFileSync(leasePath, "utf8"))).toMatchObject({
      activeSha,
      candidateSha: input.sourceSha,
      heartbeatRequired: true,
      heartbeatSequence: 0,
      operationClass: "release-certification",
      owner: "codex:pr-40",
      schema: "openclaw.custom-runtime-certification-lease.v2",
      state: "acquired",
    });

    const prematurePromotion = spawnSync(
      "sh",
      [promoteScript, "--release", input.release, "--source-sha", input.sourceSha],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...env,
          OPENCLAW_CUSTOM_RUNTIME_RELEASES: realpathSync(input.releasesDir),
          OPENCLAW_NODE_BIN: process.execPath,
          OPENCLAW_RELEASE_GOVERNANCE_BUNDLE_DIR: input.evidenceRoot,
        },
      },
    );
    expect(prematurePromotion.status).toBe(75);
    expect(prematurePromotion.stderr).toContain(
      "same-candidate promotion is not owner-authorized yet",
    );

    const duplicate = spawnSync(
      "sh",
      [promoteScript, "--lease-acquire", ...binding, "--ttl-seconds", "600"],
      { cwd: process.cwd(), encoding: "utf8", env },
    );
    expect(duplicate.status, duplicate.stderr).toBe(0);
    expect(duplicate.stdout.trim()).toBe(acquired.stdout.trim());

    const status = spawnSync("sh", [promoteScript, "--lease-status"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
    expect(status.status, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      activeSha,
      candidateSha: input.sourceSha,
      heartbeatValidity: "fresh",
      state: "acquired",
      validity: "active",
    });

    const heartbeat = spawnSync("sh", [promoteScript, "--lease-heartbeat", ...binding], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
    expect(heartbeat.status, heartbeat.stderr).toBe(0);
    expect(readFileSync(heartbeat.stdout.trim(), "utf8")).toContain('"result": "heartbeat"');
    expect(JSON.parse(readFileSync(leasePath, "utf8"))).toMatchObject({
      heartbeatRequired: true,
      heartbeatSequence: 1,
    });

    const released = spawnSync("sh", [promoteScript, "--lease-release", ...binding], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    });
    expect(released.status, released.stderr).toBe(0);
    expect(existsSync(leasePath)).toBe(false);
    expect(readFileSync(released.stdout.trim(), "utf8")).toContain('"result": "released"');
  });

  it("recovers only an expired lease with the exact original binding", () => {
    const input = fixture();
    const activeSha = "1".repeat(40);
    const leasePath = path.join(input.runtimeHome, "certification-lease.json");
    const promoteScript = path.join(
      process.cwd(),
      "scripts",
      "custom-runtime",
      "custom-runtime-promote.sh",
    );
    mkdirSync(input.runtimeHome, { recursive: true });
    const createdAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const expiresAt = new Date(Date.now() - 5 * 60_000).toISOString();
    writeFileSync(
      leasePath,
      `${JSON.stringify({
        activeSha,
        actor: os.userInfo().username,
        approvalId: "release-governor:pr-41",
        candidateSha: input.sourceSha,
        createdAt,
        expiresAt,
        invocationId: "certification-pr-41",
        operationClass: "release-certification",
        operationId: "certification:pr-41",
        owner: "codex:pr-40",
        pid: process.pid,
        rollbackSha: activeSha,
        schema: "openclaw.custom-runtime-certification-lease.v2",
        state: "acquired",
      })}\n`,
      { mode: 0o600 },
    );
    const env = {
      ...process.env,
      HOME: input.home,
      OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
    };
    const wrongOwner = spawnSync(
      "sh",
      [
        promoteScript,
        "--lease-recover-expired",
        "--active-sha",
        activeSha,
        "--candidate-sha",
        input.sourceSha,
        "--owner",
        "other-owner",
        "--operation-class",
        "release-certification",
        "--approval-id",
        "release-governor:pr-41",
        "--operation-id",
        "certification:pr-41",
        "--invocation-id",
        "certification-pr-41",
      ],
      { cwd: process.cwd(), encoding: "utf8", env },
    );
    expect(wrongOwner.status).toBe(78);
    expect(existsSync(leasePath)).toBe(true);

    const recovered = spawnSync(
      "sh",
      [
        promoteScript,
        "--lease-recover-expired",
        "--active-sha",
        activeSha,
        "--candidate-sha",
        input.sourceSha,
        "--owner",
        "codex:pr-40",
        "--operation-class",
        "release-certification",
        "--approval-id",
        "release-governor:pr-41",
        "--operation-id",
        "certification:pr-41",
        "--invocation-id",
        "certification-pr-41",
      ],
      { cwd: process.cwd(), encoding: "utf8", env },
    );
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(existsSync(leasePath)).toBe(false);
    expect(readFileSync(recovered.stdout.trim(), "utf8")).toContain(
      '"result": "expired-recovered"',
    );
  });

  it("recovers only a heartbeat-stale acquired lease with fresh inactive proof", () => {
    const input = fixture();
    const activeSha = "1".repeat(40);
    const leasePath = path.join(input.runtimeHome, "certification-lease.json");
    const proofPath = path.join(input.runtimeHome, "orphan-proof.json");
    const fakeBin = path.join(input.home, "fake-bin");
    mkdirSync(fakeBin, { recursive: true });
    executable(
      path.join(fakeBin, "gh"),
      "#!/bin/sh\nprintf '%s\\n' \"${FAKE_GH_RUNS_JSON:-[]}\"\n",
    );
    const promoteScript = path.join(
      process.cwd(),
      "scripts",
      "custom-runtime",
      "custom-runtime-promote.sh",
    );
    mkdirSync(input.runtimeHome, { recursive: true });
    writeFileSync(
      path.join(input.runtimeHome, "active-runtime.json"),
      `${JSON.stringify({ sourceSha: activeSha })}\n`,
    );
    const binding = [
      "--active-sha",
      activeSha,
      "--candidate-sha",
      input.sourceSha,
      "--owner",
      "codex:pr-40",
      "--operation-class",
      "release-certification",
      "--approval-id",
      "release-governor:pr-41",
      "--operation-id",
      "certification:pr-41",
      "--invocation-id",
      "certification-pr-41",
    ];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: input.home,
      OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    };
    const writeLease = (overrides: Record<string, unknown> = {}) => {
      const createdAt = new Date(Date.now() - 40 * 60_000).toISOString();
      writeFileSync(
        leasePath,
        `${JSON.stringify({
          activeSha,
          actor: os.userInfo().username,
          approvalId: "release-governor:pr-41",
          candidateSha: input.sourceSha,
          createdAt,
          expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
          heartbeatAt: new Date(Date.now() - 35 * 60_000).toISOString(),
          heartbeatRequired: true,
          heartbeatSequence: 3,
          invocationId: "certification-pr-41",
          operationClass: "release-certification",
          operationId: "certification:pr-41",
          owner: "codex:pr-40",
          pid: 999_999,
          rollbackSha: activeSha,
          schema: "openclaw.custom-runtime-certification-lease.v2",
          state: "acquired",
          ...overrides,
        })}\n`,
        { mode: 0o600 },
      );
    };
    const writeProof = (overrides: Record<string, unknown> = {}) => {
      const leaseDigest = createHash("sha256").update(readFileSync(leasePath)).digest("hex");
      writeFileSync(
        proofPath,
        `${JSON.stringify({
          activeSha,
          candidateSha: input.sourceSha,
          checksActive: false,
          invocationId: "certification-pr-41",
          leaseSha256: leaseDigest,
          observedAt: new Date().toISOString(),
          owner: "codex:pr-40",
          ownerActivityActive: false,
          ownerPidLive: false,
          schema: "openclaw.custom-runtime-certification-orphan-proof.v1",
          ...overrides,
        })}\n`,
        { mode: 0o600 },
      );
    };
    const recover = () =>
      spawnSync(
        "sh",
        [
          promoteScript,
          "--lease-recover-orphaned",
          ...binding,
          "--recovery-approval-id",
          "release-governor:orphan-recovery:approved",
          "--activity-proof",
          proofPath,
          "--github-repo",
          "SnowBelt/openclaw",
          "--reason",
          "owner-heartbeat-stale",
        ],
        { cwd: process.cwd(), encoding: "utf8", env },
      );

    writeLease({ heartbeatAt: new Date().toISOString(), heartbeatSequence: 4 });
    writeProof();
    const freshHeartbeat = recover();
    expect(freshHeartbeat.status).toBe(75);
    expect(freshHeartbeat.stderr).toContain("heartbeat is too recent");
    expect(existsSync(leasePath)).toBe(true);

    writeLease({ state: "promotion-authorized", promotionAuthorizedAt: new Date().toISOString() });
    writeProof();
    const promoted = recover();
    expect(promoted.status).toBe(75);
    expect(promoted.stderr).toContain("only an acquired lease");
    expect(existsSync(leasePath)).toBe(true);

    writeLease();
    writeProof({ checksActive: true });
    const activeChecks = recover();
    expect(activeChecks.status).toBe(75);
    expect(activeChecks.stderr).toContain("inactive checks");
    expect(existsSync(leasePath)).toBe(true);

    writeProof({ observedAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    const staleProof = recover();
    expect(staleProof.status).toBe(75);
    expect(staleProof.stderr).toContain("proof is stale");
    expect(existsSync(leasePath)).toBe(true);

    writeProof({ leaseSha256: "0".repeat(64) });
    const wrongDigest = recover();
    expect(wrongDigest.status).toBe(78);
    expect(wrongDigest.stderr).toContain("lease digest does not match");
    expect(existsSync(leasePath)).toBe(true);

    writeProof({ observedAt: new Date(Date.now() + 5 * 60_000).toISOString() });
    const futureProof = recover();
    expect(futureProof.status).toBe(78);
    expect(futureProof.stderr).toContain("observation is in the future");
    expect(existsSync(leasePath)).toBe(true);

    writeProof();
    env.FAKE_GH_RUNS_JSON = JSON.stringify([{ headSha: input.sourceSha, status: "in_progress" }]);
    const activeGitHubChecks = recover();
    expect(activeGitHubChecks.status).toBe(75);
    expect(activeGitHubChecks.stderr).toContain("GitHub checks are active");
    expect(existsSync(leasePath)).toBe(true);
    delete env.FAKE_GH_RUNS_JSON;

    writeLease({ pid: process.pid });
    writeProof();
    const activeOwnerPid = recover();
    expect(activeOwnerPid.status).toBe(75);
    expect(activeOwnerPid.stderr).toContain("owner PID is still active");
    expect(existsSync(leasePath)).toBe(true);

    writeLease();
    writeProof();
    const recovered = recover();
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(existsSync(leasePath)).toBe(false);
    const receipt = JSON.parse(readFileSync(recovered.stdout.trim(), "utf8"));
    expect(receipt).toMatchObject({
      activeSha,
      candidateSha: input.sourceSha,
      reason: "owner-heartbeat-stale",
      result: "orphaned-recovered",
      schema: "openclaw.custom-runtime-certification-lease-receipt.v2",
      lease: {
        orphanGitHubChecksRepo: "SnowBelt/openclaw",
        orphanRecoveredByApprovalId: "release-governor:orphan-recovery:approved",
      },
    });
    expect(receipt.lease.orphanActivityProofSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.lease.orphanGitHubChecksSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("blocks a competing promotion while an exact certification lease is active", () => {
    const input = fixture();
    const activeSha = "1".repeat(40);
    const activePointer = path.join(input.runtimeHome, "active-runtime.json");
    mkdirSync(input.runtimeHome, { recursive: true });
    writeFileSync(
      activePointer,
      `${JSON.stringify({
        releaseId: "release-active",
        runtimeRoot: path.join(input.releasesDir, "release-active"),
        sourceSha: activeSha,
      })}\n`,
    );
    writeFileSync(
      path.join(input.runtimeHome, "certification-lease.json"),
      `${JSON.stringify({
        activeSha,
        actor: "codex",
        approvalId: "release-governor:pr-41",
        candidateSha: "2".repeat(40),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        invocationId: "certification-pr-41",
        operationClass: "release-certification",
        operationId: "certification:pr-41",
        owner: "codex:other-candidate",
        pid: process.pid,
        rollbackSha: activeSha,
        schema: "openclaw.custom-runtime-certification-lease.v2",
        state: "acquired",
      })}\n`,
      { mode: 0o600 },
    );

    const result = spawnSync(
      "sh",
      [
        path.join(process.cwd(), "scripts", "custom-runtime", "custom-runtime-promote.sh"),
        "--release",
        input.release,
        "--source-sha",
        input.sourceSha,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: input.home,
          OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
          OPENCLAW_CUSTOM_RUNTIME_RELEASES: realpathSync(input.releasesDir),
          OPENCLAW_RELEASE_GOVERNANCE_BUNDLE_DIR: input.evidenceRoot,
          OPENCLAW_NODE_BIN: process.execPath,
        },
      },
    );

    expect(result.status).toBe(75);
    expect(result.stderr).toContain("another candidate owns the active certification lease");
    expect(readFileSync(activePointer, "utf8")).toContain(activeSha);
    expect(readdirSync(path.join(input.runtimeHome, "backups"))).toEqual([]);
    expect(existsSync(path.join(input.runtimeHome, "locks", "promotion.lock"))).toBe(false);
  });

  it("fails closed on a malformed lease before promotion state changes", () => {
    const input = fixture();
    const activeSha = "1".repeat(40);
    const activePointer = path.join(input.runtimeHome, "active-runtime.json");
    mkdirSync(input.runtimeHome, { recursive: true });
    writeFileSync(activePointer, `${JSON.stringify({ sourceSha: activeSha })}\n`);
    writeFileSync(path.join(input.runtimeHome, "certification-lease.json"), "{broken\n", {
      mode: 0o600,
    });

    const result = spawnSync(
      "sh",
      [
        path.join(process.cwd(), "scripts", "custom-runtime", "custom-runtime-promote.sh"),
        "--release",
        input.release,
        "--source-sha",
        input.sourceSha,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: input.home,
          OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
          OPENCLAW_CUSTOM_RUNTIME_RELEASES: realpathSync(input.releasesDir),
          OPENCLAW_RELEASE_GOVERNANCE_BUNDLE_DIR: input.evidenceRoot,
          OPENCLAW_NODE_BIN: process.execPath,
        },
      },
    );

    expect(result.status).toBe(78);
    expect(result.stderr).toContain("lease is malformed");
    expect(readFileSync(activePointer, "utf8")).toContain(activeSha);
    expect(readdirSync(path.join(input.runtimeHome, "backups"))).toEqual([]);
  });

  it("never lets a matching lease bypass Release Governor denial", () => {
    const input = fixture();
    const activeSha = "1".repeat(40);
    const activePointer = path.join(input.runtimeHome, "active-runtime.json");
    mkdirSync(input.runtimeHome, { recursive: true });
    writeFileSync(activePointer, `${JSON.stringify({ sourceSha: activeSha })}\n`);
    writeFileSync(
      path.join(input.runtimeHome, "certification-lease.json"),
      `${JSON.stringify({
        activeSha,
        actor: "codex",
        approvalId: "release-governor:pr-41",
        candidateSha: input.sourceSha,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        invocationId: "certification-pr-41",
        operationClass: "release-certification",
        operationId: "certification:pr-41",
        owner: "codex:pr-40",
        pid: process.pid,
        schema: "openclaw.custom-runtime-certification-lease.v2",
        state: "acquired",
      })}\n`,
      { mode: 0o600 },
    );
    writeFileSync(
      path.join(input.evidenceRoot, input.sourceSha, "promotion.json"),
      `${JSON.stringify({
        candidateSha: input.sourceSha,
        decision: "deny",
        operation: "promotion",
      })}\n`,
      { mode: 0o600 },
    );

    const result = spawnSync(
      "sh",
      [
        path.join(process.cwd(), "scripts", "custom-runtime", "custom-runtime-promote.sh"),
        "--release",
        input.release,
        "--source-sha",
        input.sourceSha,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: input.home,
          OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
          OPENCLAW_CUSTOM_RUNTIME_RELEASES: realpathSync(input.releasesDir),
          OPENCLAW_RELEASE_GOVERNANCE_BUNDLE_DIR: input.evidenceRoot,
          OPENCLAW_NODE_BIN: process.execPath,
        },
      },
    );

    expect(result.status).toBe(78);
    expect(result.stderr).toContain("release governance blocked: policy denied promotion");
    expect(readFileSync(activePointer, "utf8")).toContain(activeSha);
    expect(existsSync(path.join(input.runtimeHome, "certification-lease.json"))).toBe(true);
  });

  it("stages a candidate against copied state without changing the active pointer", () => {
    const input = fixture();
    const configPath = path.join(input.home, "openclaw.director.json");
    const stateDir = path.join(input.home, "state");
    const provider = path.join(input.home, "secret-provider");
    const activePointer = path.join(input.runtimeHome, "active-runtime.json");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      configPath,
      `${JSON.stringify({
        gateway: { auth: { mode: "token", token: "fixture-gateway-token" } },
        plugins: { allow: ["apps"], entries: { apps: { enabled: true } } },
      })}\n`,
    );
    executable(
      provider,
      '#!/bin/sh\nprintf \'%s\\n\' \'{"values":{"discord/bot-token":"present"}}\'\n',
    );
    // Models the previously deployed SIG pointer before capability fields were added.
    const originalPointer = `${JSON.stringify({ requiredSurfaces: ["pcc"] })}\n`;
    writeFileSync(activePointer, originalPointer);
    const port = 29_000 + Math.floor(Math.random() * 500);

    const result = spawnSync(
      "sh",
      [
        path.join(process.cwd(), "scripts", "custom-runtime", "custom-runtime-stage.sh"),
        "--release",
        input.release,
        "--source-sha",
        input.sourceSha,
        "--port",
        String(port),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 120_000,
        env: {
          ...process.env,
          HOME: input.home,
          OPENCLAW_CONFIG_PATH: configPath,
          OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
          OPENCLAW_RELEASE_GOVERNANCE_BUNDLE_DIR: input.evidenceRoot,
          OPENCLAW_NODE_BIN: process.execPath,
          OPENCLAW_SECRET_PROVIDER: provider,
          OPENCLAW_STATE_DIR: stateDir,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("CUSTOM_RUNTIME_STAGE_OK");
    expect(readFileSync(activePointer, "utf8")).toBe(originalPointer);
  });

  it("restores the previous pointer and service files when promotion bootstrap fails", () => {
    const input = fixture();
    const activePointer = path.join(input.runtimeHome, "active-runtime.json");
    const plist = path.join(input.home, "ai.openclaw.gateway.plist");
    const envFile = path.join(input.home, "gateway.env");
    const envWrapper = path.join(input.home, "gateway-wrapper.sh");
    const fakeBin = path.join(input.home, "bin");
    const launchctlState = path.join(input.home, "launchctl-count");
    const promotedPlist = path.join(input.home, "promoted-gateway.plist");
    const promotedEnv = path.join(input.home, "promoted-gateway.env");
    const rollbackLauncher = path.join(input.home, "rollback-launcher.sh");
    const sourceRepo = path.join(input.home, "source");
    const activeSourceSha = "1".repeat(40);
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(sourceRepo);
    mkdirSync(input.runtimeHome, { recursive: true });
    const previousRuntimeRoot = path.join(input.releasesDir, "release-old");
    const originalPointer = `${JSON.stringify({
      releaseId: "release-old",
      runtimeRoot: previousRuntimeRoot,
      sourceSha: activeSourceSha,
      requiredSurfaces: [],
    })}\n`;
    writeFileSync(activePointer, originalPointer);
    writeFileSync(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>ai.openclaw.gateway</string><key>ProgramArguments</key><array><string>/usr/bin/true</string></array></dict></plist>
`,
    );
    writeFileSync(envFile, "export EXISTING_VALUE=1\n");
    executable(envWrapper, '#!/bin/sh\nexec "$@"\n');
    executable(rollbackLauncher, '#!/bin/sh\n[ "${1:-}" = --verify ]\n');
    executable(
      path.join(fakeBin, "git"),
      `#!/bin/sh
shift 2
case "$1" in
  cat-file|merge-base) exit 0 ;;
  rev-parse) printf '%s\\n' "$CANDIDATE_SHA"; exit 0 ;;
esac
exit 64
`,
    );
    executable(
      path.join(fakeBin, "launchctl"),
      `#!/bin/sh
case "$1" in
  bootout) exit 0 ;;
  print) exit 1 ;;
  bootstrap)
    count=0
    [ -f "$FAKE_LAUNCHCTL_STATE" ] && count=$(cat "$FAKE_LAUNCHCTL_STATE")
    count=$((count + 1))
    printf '%s\\n' "$count" > "$FAKE_LAUNCHCTL_STATE"
    if [ "$count" -eq 1 ]; then
      cp "$OPENCLAW_GATEWAY_PLIST" "$FAKE_PROMOTED_PLIST"
      cp "$OPENCLAW_GATEWAY_ENV_FILE" "$FAKE_PROMOTED_ENV"
    fi
    [ "$count" -gt 1 ]
    ;;
esac
`,
    );
    // Keep rollback verification deterministic. Without a fake health response,
    // this test can accidentally pass against a developer's live Gateway while
    // timing out on an isolated CI runner.
    executable(path.join(fakeBin, "curl"), "#!/bin/sh\nprintf '%s\\n' '{\"ok\":true}'\n");

    const result = spawnSync(
      "sh",
      [
        path.join(process.cwd(), "scripts", "custom-runtime", "custom-runtime-promote.sh"),
        "--release",
        input.release,
        "--source-sha",
        input.sourceSha,
        "--source-repo",
        sourceRepo,
        "--source-branch",
        "candidate",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          FAKE_LAUNCHCTL_STATE: launchctlState,
          FAKE_PROMOTED_PLIST: promotedPlist,
          FAKE_PROMOTED_ENV: promotedEnv,
          CANDIDATE_SHA: input.sourceSha,
          HOME: input.home,
          OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
          OPENCLAW_CUSTOM_RUNTIME_RELEASES: realpathSync(input.releasesDir),
          OPENCLAW_CUSTOM_RUNTIME_ROLLBACK_LAUNCHER: rollbackLauncher,
          OPENCLAW_RELEASE_GOVERNANCE_BUNDLE_DIR: input.evidenceRoot,
          OPENCLAW_GATEWAY_ENV_FILE: envFile,
          OPENCLAW_GATEWAY_ENV_WRAPPER: envWrapper,
          OPENCLAW_GATEWAY_PLIST: plist,
          OPENCLAW_NODE_BIN: process.execPath,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(1);
    expect(readFileSync(activePointer, "utf8")).toBe(originalPointer);
    expect(readFileSync(envFile, "utf8")).toBe("export EXISTING_VALUE=1\n");
    expect(readFileSync(plist, "utf8")).toContain("/usr/bin/true");
    expect(readFileSync(launchctlState, "utf8").trim()).toBe("2");
    const promotedPlistContents = readFileSync(promotedPlist, "utf8");
    expect(promotedPlistContents).toContain(`<string>${envWrapper}</string>`);
    expect(promotedPlistContents).toContain("OpenClaw Gateway (v2026.6.11)");
    expect(promotedPlistContents).not.toContain("<string>/bin/sh</string>");
    expect(readFileSync(promotedEnv, "utf8")).toContain(
      "export OPENCLAW_SERVICE_VERSION=2026.6.11",
    );
  });

  it("blocks promotion before service mutation when the active runtime is not an ancestor", () => {
    const input = fixture();
    const activePointer = path.join(input.runtimeHome, "active-runtime.json");
    const activeSourceSha = "1".repeat(40);
    const sourceRepo = path.join(input.home, "source");
    const fakeBin = path.join(input.home, "lineage-bin");
    mkdirSync(sourceRepo);
    mkdirSync(fakeBin);
    executable(
      path.join(fakeBin, "git"),
      `#!/bin/sh
shift 2
case "$1" in
  cat-file) exit 0 ;;
  rev-parse) printf '%s\\n' "$CANDIDATE_SHA"; exit 0 ;;
  merge-base) exit 1 ;;
esac
exit 64
`,
    );
    writeFileSync(
      activePointer,
      `${JSON.stringify({
        releaseId: "release-active",
        runtimeRoot: path.join(input.releasesDir, "release-active"),
        sourceSha: activeSourceSha,
        requiredSurfaces: [],
      })}\n`,
    );

    const result = spawnSync(
      "sh",
      [
        path.join(process.cwd(), "scripts", "custom-runtime", "custom-runtime-promote.sh"),
        "--release",
        input.release,
        "--source-sha",
        input.sourceSha,
        "--source-repo",
        sourceRepo,
        "--source-branch",
        "candidate",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          HOME: input.home,
          OPENCLAW_CUSTOM_RUNTIME_HOME: input.runtimeHome,
          OPENCLAW_CUSTOM_RUNTIME_RELEASES: realpathSync(input.releasesDir),
          OPENCLAW_RELEASE_GOVERNANCE_BUNDLE_DIR: input.evidenceRoot,
          OPENCLAW_NODE_BIN: process.execPath,
          CANDIDATE_SHA: input.sourceSha,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.status).toBe(64);
    expect(result.stderr).toContain(
      "promotion blocked: active managed runtime is not an ancestor of the candidate",
    );
    expect(readFileSync(activePointer, "utf8")).toContain(activeSourceSha);
    expect(existsSync(path.join(input.runtimeHome, "locks", "promotion.lock"))).toBe(false);
  });
});
