import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = path.join(
  process.cwd(),
  "scripts",
  "custom-runtime",
  "custom-runtime-usability-coordinator.mjs",
);
const candidateSha = "a".repeat(40);
const fixtureSha256 = "b".repeat(64);
const roots: string[] = [];

type CommandResult = ReturnType<typeof spawnSync>;

function fixture() {
  const home = mkdtempSync(path.join(os.tmpdir(), "openclaw-usability-coordinator-"));
  roots.push(home);
  const runtimeHome = path.join(home, "runtime");
  const campaign = path.join(runtimeHome, "usability", "campaign.json");
  const receipt = `${campaign}.receipt.json`;
  const env = {
    ...process.env,
    HOME: home,
    OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
    OPENCLAW_USABILITY_COORDINATOR_TEST_CLOCK: "1",
  };
  return { campaign, env, home, receipt, runtimeHome };
}

function command(input: ReturnType<typeof fixture>, args: string[]): CommandResult {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: input.env,
  });
}

function expectSuccess(result: CommandResult) {
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function initialize(input: ReturnType<typeof fixture>, expiresAt = "2026-07-30T00:00:00.000Z") {
  return expectSuccess(
    command(input, [
      "init",
      "--campaign",
      input.campaign,
      "--campaign-id",
      "or2-a3ac-human-proof",
      "--candidate-sha",
      candidateSha,
      "--fixture-sha256",
      fixtureSha256,
      "--expires-at",
      expiresAt,
      "--now",
      "2026-07-28T18:00:00.000Z",
    ]),
  );
}

function initializeOwner(
  input: ReturnType<typeof fixture>,
  campaign = input.campaign,
  campaignId = "or2-owner-mac-studio",
  ownerCandidateSha = candidateSha,
) {
  return expectSuccess(
    command(input, [
      "init",
      "--campaign",
      campaign,
      "--campaign-id",
      campaignId,
      "--candidate-sha",
      ownerCandidateSha,
      "--active-runtime-sha",
      ownerCandidateSha,
      "--fixture-sha256",
      fixtureSha256,
      "--policy",
      "owner-mac-studio",
      "--expires-at",
      "2026-07-30T00:00:00.000Z",
      "--now",
      "2026-07-28T18:00:00.000Z",
    ]),
  );
}

const participantPlans = [
  {
    accessibility: "standard",
    cohort: "7-12",
    device: "desktop",
    guardian: "true",
    viewport: "1440x900",
  },
  {
    accessibility: "keyboard-only",
    cohort: "13-64",
    device: "desktop",
    guardian: "false",
    viewport: "1440x900",
  },
  {
    accessibility: "standard",
    cohort: "65-90",
    device: "mobile",
    guardian: "false",
    viewport: "390x844",
  },
  {
    accessibility: "standard",
    cohort: "13-64",
    device: "mobile",
    guardian: "false",
    viewport: "390x844",
  },
  {
    accessibility: "zoom-200",
    cohort: "13-64",
    device: "desktop",
    guardian: "false",
    viewport: "1280x800",
  },
] as const;

function participantId(index: number): string {
  return createHash("sha256").update(`anonymous-participant-${index}`).digest("hex");
}

function register(
  input: ReturnType<typeof fixture>,
  index: number,
  overrides: Partial<(typeof participantPlans)[number]> & {
    consent?: string;
    firstUse?: string;
  } = {},
) {
  const plan = { ...participantPlans[index], ...overrides };
  return command(input, [
    "register",
    "--campaign",
    input.campaign,
    "--participant-id",
    participantId(index),
    "--cohort",
    plan.cohort,
    "--device",
    plan.device,
    "--viewport",
    plan.viewport,
    "--accessibility",
    plan.accessibility,
    "--first-use",
    overrides.firstUse ?? "true",
    "--consent-recorded",
    overrides.consent ?? "true",
    "--guardian-consent-recorded",
    plan.guardian,
    "--now",
    `2026-07-28T18:0${index + 1}:00.000Z`,
  ]);
}

function registerReadyCohort(input: ReturnType<typeof fixture>) {
  for (let index = 0; index < participantPlans.length; index += 1) {
    expectSuccess(register(input, index));
  }
}

function registerOwner(
  input: ReturnType<typeof fixture>,
  campaign = input.campaign,
  overrides: {
    browser?: string;
    consent?: string;
    device?: string;
    operatorRole?: string;
  } = {},
) {
  return command({ ...input, campaign }, [
    "register",
    "--campaign",
    campaign,
    "--participant-id",
    participantId(99),
    "--device",
    overrides.device ?? "mac-studio",
    "--browser",
    overrides.browser ?? "chrome",
    "--operator-role",
    overrides.operatorRole ?? "control-director",
    "--viewport",
    "1728x1117",
    "--accessibility",
    "standard",
    "--consent-recorded",
    overrides.consent ?? "true",
    "--now",
    "2026-07-28T18:01:00.000Z",
  ]);
}

function start(input: ReturnType<typeof fixture>, index: number, minute: number) {
  return command(input, [
    "start",
    "--campaign",
    input.campaign,
    "--participant-id",
    participantId(index),
    "--now",
    `2026-07-28T19:${String(minute).padStart(2, "0")}:00.000Z`,
  ]);
}

function complete(
  input: ReturnType<typeof fixture>,
  index: number,
  minute: number,
  seconds: number,
  overrides: { overall?: string; hints?: string; unsafe?: string } = {},
) {
  return command(input, [
    "complete",
    "--campaign",
    input.campaign,
    "--participant-id",
    participantId(index),
    "--overall-state-correct",
    overrides.overall ?? "true",
    "--operator-action-correct",
    "true",
    "--working-item-identified",
    "true",
    "--issue-details-and-owner-or-next",
    "true",
    "--hint-count",
    overrides.hints ?? "0",
    "--unsafe-action-count",
    overrides.unsafe ?? "0",
    "--observer-attested",
    "true",
    "--now",
    `2026-07-28T19:${String(minute).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.000Z`,
  ]);
}

function completeOwner(
  input: ReturnType<typeof fixture>,
  overrides: { distinction?: string; preview?: string } = {},
) {
  return command(input, [
    "complete",
    "--campaign",
    input.campaign,
    "--participant-id",
    participantId(99),
    "--overall-state-correct",
    "true",
    "--working-item-identified",
    "true",
    "--local-ai-distinction-correct",
    overrides.distinction ?? "true",
    "--issue-details-and-owner-or-next",
    "true",
    "--resolve-preview-and-safe-cancel",
    overrides.preview ?? "true",
    "--hint-count",
    "0",
    "--unsafe-action-count",
    "0",
    "--observer-attested",
    "true",
    "--now",
    "2026-07-28T19:00:45.000Z",
  ]);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Operations Room usability coordinator", () => {
  it("makes one consented Control Director on Mac Studio lease-ready", () => {
    const input = fixture();
    initializeOwner(input);

    const initial = expectSuccess(
      command(input, ["status", "--campaign", input.campaign, "--now", "2026-07-28T18:00:30.000Z"]),
    );
    expect(initial).toMatchObject({
      activeRuntimeSha: candidateSha,
      policy: "owner-mac-studio",
      state: "waiting",
      summary: {
        leaseAllowed: false,
        policy: "owner-mac-studio",
        remainingParticipantCount: 1,
      },
    });

    const ready = expectSuccess(registerOwner(input));
    expect(ready).toMatchObject({
      policy: "owner-mac-studio",
      state: "ready",
      summary: {
        coverage: {
          browser: true,
          device: true,
          operatorRole: true,
        },
        eligibleParticipantCount: 1,
        leaseAllowed: true,
        remainingParticipantCount: 0,
      },
    });
    expect(ready.participants[0]).not.toHaveProperty("firstUse");
    expect(ready.participants[0]).not.toHaveProperty("cohort");
  });

  it("binds owner acceptance to the exact active candidate and Mac Studio surface", () => {
    const mismatched = fixture();
    const initMismatch = command(mismatched, [
      "init",
      "--campaign",
      mismatched.campaign,
      "--campaign-id",
      "or2-owner-mismatch",
      "--candidate-sha",
      candidateSha,
      "--active-runtime-sha",
      "c".repeat(40),
      "--fixture-sha256",
      fixtureSha256,
      "--policy",
      "owner-mac-studio",
      "--expires-at",
      "2026-07-30T00:00:00.000Z",
      "--now",
      "2026-07-28T18:00:00.000Z",
    ]);
    expect(initMismatch.status).toBe(64);
    expect(initMismatch.stderr).toContain("must equal --candidate-sha");

    for (const [field, overrides, message] of [
      ["device", { device: "desktop" }, "--device must be mac-studio"],
      ["browser", { browser: "safari" }, "--browser must be chrome"],
      ["operator", { operatorRole: "administrator" }, "--operator-role must be control-director"],
      ["consent", { consent: "false" }, "--consent-recorded must be true"],
    ] as const) {
      const input = fixture();
      initializeOwner(input, input.campaign, `or2-owner-invalid-${field}`);
      const result = registerOwner(input, input.campaign, overrides);
      expect(result.status, field).toBe(64);
      expect(result.stderr, field).toContain(message);
    }
  });

  it("records one owner attempt, permits the owner on later releases, and never permits a retry", () => {
    const input = fixture();
    initializeOwner(input);
    expectSuccess(registerOwner(input));
    expectSuccess(start(input, 99, 0));
    expectSuccess(completeOwner(input));

    const finalCampaign = JSON.parse(readFileSync(input.campaign, "utf8"));
    expect(finalCampaign).toMatchObject({
      activeRuntimeSha: candidateSha,
      policy: "owner-mac-studio",
      state: "passed",
      summary: {
        leaseAllowed: true,
        passedAttemptCount: 1,
      },
    });
    const receipt = expectSuccess(
      command(input, [
        "finalize",
        "--campaign",
        input.campaign,
        "--now",
        "2026-07-28T19:01:00.000Z",
      ]),
    );
    expect(receipt).toMatchObject({
      activeRuntimeSha: candidateSha,
      candidateSha,
      policy: "owner-mac-studio",
      result: "passed",
      participants: [
        expect.objectContaining({
          browser: "chrome",
          device: "mac-studio",
          operatorRole: "control-director",
        }),
      ],
    });
    expect(start(input, 99, 1).stderr).toContain("campaign state is passed");

    rmSync(input.campaign);
    const sameCandidateCampaign = path.join(
      input.runtimeHome,
      "usability",
      "same-candidate-owner-retry.json",
    );
    initializeOwner(input, sameCandidateCampaign, "or2-owner-same-candidate");
    expect(registerOwner(input, sameCandidateCampaign).stderr).toContain(
      "already recorded for this candidate",
    );
    rmSync(sameCandidateCampaign);

    const laterCampaign = path.join(input.runtimeHome, "usability", "later-owner-release.json");
    initializeOwner(input, laterCampaign, "or2-owner-later-release", "e".repeat(40));
    const reusedOwner = registerOwner(input, laterCampaign);
    expectSuccess(reusedOwner);
    const ledger = JSON.parse(
      readFileSync(path.join(path.dirname(laterCampaign), "participant-ledger.json"), "utf8"),
    );
    expect(
      ledger.participants.filter(
        (participant: { participantId: string }) => participant.participantId === participantId(99),
      ),
    ).toHaveLength(2);
  });

  it("makes a failed owner acceptance terminal without replacement or retry", () => {
    const input = fixture();
    initializeOwner(input);
    expectSuccess(registerOwner(input));
    expectSuccess(start(input, 99, 0));
    expectSuccess(completeOwner(input, { distinction: "false" }));
    const campaign = JSON.parse(readFileSync(input.campaign, "utf8"));
    expect(campaign).toMatchObject({
      state: "failed",
      summary: {
        failedAttemptCount: 1,
        leaseAllowed: false,
      },
    });
    expect(start(input, 99, 1).stderr).toContain("campaign state is failed");
    expect(registerOwner(input).stderr).toContain("campaign state is failed");
  });

  it("rejects a second owner participant in the same campaign", () => {
    const input = fixture();
    initializeOwner(input);
    expectSuccess(registerOwner(input));
    const secondOwner = command(input, [
      "register",
      "--campaign",
      input.campaign,
      "--participant-id",
      participantId(98),
      "--device",
      "mac-studio",
      "--browser",
      "chrome",
      "--operator-role",
      "control-director",
      "--viewport",
      "1728x1117",
      "--accessibility",
      "standard",
      "--consent-recorded",
      "true",
      "--now",
      "2026-07-28T18:02:00.000Z",
    ]);
    expect(secondOwner.status).toBe(75);
    expect(secondOwner.stderr).toContain("campaign state is ready");
  });

  it("reports exact missing coverage and becomes lease-ready only with five eligible participants", () => {
    const input = fixture();
    initialize(input);

    const initial = expectSuccess(
      command(input, ["status", "--campaign", input.campaign, "--now", "2026-07-28T18:00:30.000Z"]),
    );
    expect(initial).toMatchObject({
      state: "waiting",
      summary: {
        eligibleParticipantCount: 0,
        leaseAllowed: false,
        remainingParticipantCount: 5,
      },
    });

    registerReadyCohort(input);
    const campaign = JSON.parse(readFileSync(input.campaign, "utf8"));
    expect(campaign).toMatchObject({
      state: "ready",
      summary: {
        coverage: {
          accessibility: true,
          ageCohorts: true,
          desktop: true,
          mobile: true,
        },
        eligibleParticipantCount: 5,
        leaseAllowed: true,
        remainingParticipantCount: 0,
      },
    });
    expect(statSync(input.campaign).mode & 0o077).toBe(0);
    expect(
      statSync(path.join(path.dirname(input.campaign), "participant-ledger.json")).mode & 0o077,
    ).toBe(0);
  });

  it("fails closed instead of racing a concurrent coordinator mutation", () => {
    const input = fixture();
    initialize(input);
    const lockPath = path.join(path.dirname(input.campaign), ".coordinator.lock");
    mkdirSync(lockPath, { mode: 0o700 });

    const concurrent = register(input, 0);
    expect(concurrent.status).toBe(75);
    expect(concurrent.stderr).toContain("locked by another coordinator process");
    expect(JSON.parse(readFileSync(input.campaign, "utf8")).participants).toEqual([]);

    rmSync(lockPath, { recursive: true });
    expectSuccess(register(input, 0));
  });

  it("rejects caller-controlled timestamps unless the explicit test clock is enabled", () => {
    const input = fixture();
    initialize(input);
    const env = { ...input.env };
    Reflect.deleteProperty(env, "OPENCLAW_USABILITY_COORDINATOR_TEST_CLOCK");
    const result = spawnSync(
      process.execPath,
      [script, "status", "--campaign", input.campaign, "--now", "2026-07-28T18:00:30.000Z"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
      },
    );
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("explicit coordinator test clock");
  });

  it("records trained participants as ineligible and never allows their identity to be recycled", () => {
    const input = fixture();
    initialize(input);
    expectSuccess(register(input, 0, { firstUse: "false" }));
    const duplicate = register(input, 0);
    expect(duplicate.status).toBe(75);
    expect(duplicate.stderr).toContain("already recorded and cannot be recycled");

    const campaign = JSON.parse(readFileSync(input.campaign, "utf8"));
    expect(campaign).toMatchObject({
      state: "waiting",
      summary: {
        eligibleParticipantCount: 0,
        excludedParticipantCount: 1,
        leaseAllowed: false,
        remainingParticipantCount: 5,
      },
    });
    expect(campaign.participants[0]).not.toHaveProperty("name");
    expect(campaign.participants[0]).not.toHaveProperty("email");

    rmSync(input.campaign);
    const replacementCampaign = path.join(input.runtimeHome, "usability", "replacement.json");
    expectSuccess(
      command(input, [
        "init",
        "--campaign",
        replacementCampaign,
        "--campaign-id",
        "or2-replacement-human-proof",
        "--candidate-sha",
        candidateSha,
        "--fixture-sha256",
        fixtureSha256,
        "--expires-at",
        "2026-08-01T00:00:00.000Z",
        "--now",
        "2026-07-30T18:00:00.000Z",
      ]),
    );
    const crossCampaignReuse = register({ ...input, campaign: replacementCampaign }, 0);
    expect(crossCampaignReuse.status).toBe(75);
    expect(crossCampaignReuse.stderr).toContain(
      "recorded in a prior campaign and cannot be recycled",
    );
  });

  it("runs one attempt at a time, rejects retries, and generates an exact-SHA receipt", () => {
    const input = fixture();
    initialize(input);
    registerReadyCohort(input);

    for (let index = 0; index < participantPlans.length; index += 1) {
      const minute = index * 2;
      expectSuccess(start(input, index, minute));
      const startedCampaign = JSON.parse(readFileSync(input.campaign, "utf8"));
      const startedLedger = JSON.parse(
        readFileSync(path.join(path.dirname(input.campaign), "participant-ledger.json"), "utf8"),
      );
      expect(
        startedLedger.participants.find(
          (participant: { participantId: string }) =>
            participant.participantId === participantId(index),
        ).attempt,
      ).toEqual(
        startedCampaign.participants.find(
          (participant: { id: string }) => participant.id === participantId(index),
        ).attempt,
      );
      expectSuccess(complete(input, index, minute, 45));
      const retry = start(input, index, minute + 1);
      expect(retry.status).toBe(75);
      expect(retry.stderr).toContain(
        index === participantPlans.length - 1 ? "campaign state is passed" : "cannot retry",
      );
    }

    const finalCampaign = JSON.parse(readFileSync(input.campaign, "utf8"));
    expect(finalCampaign).toMatchObject({
      candidateSha,
      finalReceiptPath: realpathSync(input.receipt),
      finalReceiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      state: "passed",
      summary: {
        failedAttemptCount: 0,
        leaseAllowed: true,
        passedAttemptCount: 5,
        unsafeActionCount: 0,
      },
    });
    expect(existsSync(input.receipt)).toBe(true);
    const receipt = expectSuccess(
      command(input, [
        "finalize",
        "--campaign",
        input.campaign,
        "--receipt",
        input.receipt,
        "--now",
        "2026-07-28T19:20:00.000Z",
      ]),
    );
    expect(receipt).toMatchObject({
      candidateSha,
      fixtureSha256,
      participantLedgerSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      participants: expect.arrayContaining([
        expect.objectContaining({
          firstUse: true,
        }),
      ]),
      receiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      result: "passed",
      schema: "openclaw.operations-room.usability-receipt.v1",
    });
    expect(existsSync(input.receipt)).toBe(true);
    expect(statSync(input.receipt).mode & 0o077).toBe(0);
    const repeatedFinalize = expectSuccess(
      command(input, [
        "finalize",
        "--campaign",
        input.campaign,
        "--now",
        "2026-07-28T19:21:00.000Z",
      ]),
    );
    expect(repeatedFinalize.receiptSha256).toBe(receipt.receiptSha256);

    const replacementReceipt = command(input, [
      "finalize",
      "--campaign",
      input.campaign,
      "--receipt",
      path.join(path.dirname(input.campaign), "replacement-receipt.json"),
      "--now",
      "2026-07-28T19:22:00.000Z",
    ]);
    expect(replacementReceipt.status).toBe(75);
    expect(replacementReceipt.stderr).toContain(
      "final receipt path does not match the automatic campaign receipt",
    );
  });

  it("makes a failed, hinted, unsafe, incorrect, or over-time attempt terminal", () => {
    for (const [label, completion] of [
      ["incorrect", { overall: "false" }],
      ["hinted", { hints: "1" }],
      ["unsafe", { unsafe: "1" }],
    ] as const) {
      const input = fixture();
      initialize(input);
      registerReadyCohort(input);
      expectSuccess(start(input, 0, 0));
      const result = complete(input, 0, 0, 45, completion);
      expectSuccess(result);
      const campaign = JSON.parse(readFileSync(input.campaign, "utf8"));
      expect(campaign.state, label).toBe("failed");
      expect(campaign.summary.leaseAllowed, label).toBe(false);
      const next = start(input, 1, 2);
      expect(next.status, label).toBe(75);
      expect(next.stderr, label).toContain("campaign state is failed");
    }

    const overtime = fixture();
    initialize(overtime);
    registerReadyCohort(overtime);
    expectSuccess(start(overtime, 0, 0));
    const overtimeResult = complete(overtime, 0, 1, 1);
    expect(overtimeResult.status).toBe(75);
    expect(overtimeResult.stderr).toContain("exceeded 60 seconds");
    expect(JSON.parse(readFileSync(overtime.campaign, "utf8")).state).toBe("failed");
    expect(
      JSON.parse(
        readFileSync(path.join(path.dirname(overtime.campaign), "participant-ledger.json"), "utf8"),
      ).participants[0].status,
    ).toBe("failed");
  });

  it("preserves failed participant history across replacement campaigns", () => {
    const input = fixture();
    initialize(input);
    registerReadyCohort(input);
    expectSuccess(start(input, 0, 0));
    expectSuccess(complete(input, 0, 0, 45, { overall: "false" }));
    rmSync(input.campaign);

    const replacementCampaign = path.join(input.runtimeHome, "usability", "after-failure.json");
    expectSuccess(
      command(input, [
        "init",
        "--campaign",
        replacementCampaign,
        "--campaign-id",
        "or2-after-failure-human-proof",
        "--candidate-sha",
        candidateSha,
        "--fixture-sha256",
        fixtureSha256,
        "--expires-at",
        "2026-08-01T00:00:00.000Z",
        "--now",
        "2026-07-30T18:00:00.000Z",
      ]),
    );
    const reuse = register({ ...input, campaign: replacementCampaign }, 0);
    expect(reuse.status).toBe(75);
    expect(reuse.stderr).toContain("recorded in a prior campaign and cannot be recycled");
  });

  it("supports explicit blocked and expired terminal states without retry loops", () => {
    const blocked = fixture();
    initialize(blocked);
    const blockedResult = expectSuccess(
      command(blocked, [
        "block",
        "--campaign",
        blocked.campaign,
        "--reason",
        "participant-identity-uncertain",
        "--now",
        "2026-07-28T18:01:00.000Z",
      ]),
    );
    expect(blockedResult).toMatchObject({
      blockedReason: "participant-identity-uncertain",
      state: "blocked",
    });
    expect(register(blocked, 0).status).toBe(75);

    const expired = fixture();
    initialize(expired);
    const expiredResult = expectSuccess(
      command(expired, [
        "expire",
        "--campaign",
        expired.campaign,
        "--now",
        "2026-07-28T18:01:00.000Z",
      ]),
    );
    expect(expiredResult).toMatchObject({ state: "expired" });
    expect(register(expired, 0).status).toBe(75);
  });

  it("fails closed on paths outside the protected usability proof directory", () => {
    const input = fixture();
    const unsafe = command(input, [
      "init",
      "--campaign",
      path.join(input.runtimeHome, "outside.json"),
      "--campaign-id",
      "unsafe",
      "--candidate-sha",
      candidateSha,
      "--fixture-sha256",
      fixtureSha256,
      "--expires-at",
      "2026-07-30T00:00:00.000Z",
      "--now",
      "2026-07-28T18:00:00.000Z",
    ]);
    expect(unsafe.status).toBe(64);
    expect(unsafe.stderr).toContain("custom runtime usability directory");
  });
});
