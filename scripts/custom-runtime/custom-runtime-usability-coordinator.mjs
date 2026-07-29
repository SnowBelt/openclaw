#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CAMPAIGN_SCHEMA = "openclaw.operations-room.usability-campaign.v1";
export const FINAL_RECEIPT_SCHEMA = "openclaw.operations-room.usability-receipt.v1";
export const PARTICIPANT_LEDGER_SCHEMA = "openclaw.operations-room.usability-participant-ledger.v1";
export const FIRST_USE_PANEL_POLICY = "first-use-panel";
export const OWNER_MAC_STUDIO_POLICY = "owner-mac-studio";
export const LEGACY_NEUTRAL_GOAL =
  "Use this screen to tell me whether OpenClaw needs the operator, what it is doing now, and show me the most important issue's details.";
export const OWNER_NEUTRAL_GOAL =
  "Use Operations Room to confirm system health, distinguish OpenClaw work from independent local AI, inspect the most important issue, preview Resolve, and cancel safely.";

const TERMINAL_STATES = new Set(["passed", "failed", "expired", "blocked"]);
const POLICIES = new Set([FIRST_USE_PANEL_POLICY, OWNER_MAC_STUDIO_POLICY]);
const COHORTS = new Set(["7-12", "13-64", "65-90"]);
const DEVICES = new Set(["desktop", "mobile"]);
const ACCESSIBILITY_MODES = new Set(["standard", "keyboard-only", "zoom-200"]);
const PARTICIPANT_ID_PATTERN = /^[a-f0-9]{64}$/u;
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const ID_PATTERN = /^[A-Za-z0-9._:@/+~-]{1,160}$/u;
const VIEWPORT_PATTERN = /^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$/u;

function fail(message, code = 64) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function parseBoolean(value, label) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fail(`${label} must be true or false`);
}

function parseCount(value, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value ?? "")) {
    fail(`${label} must be a non-negative integer`);
  }
  return Number(value);
}

function parseTimestamp(value, label) {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp) || !value.endsWith("Z")) {
    fail(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return { timestamp, value };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    fail("a coordinator command is required");
  }
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`invalid argument near ${key ?? "<end>"}`);
    }
    const name = key.slice(2);
    if (Object.hasOwn(options, name)) {
      fail(`duplicate option --${name}`);
    }
    options[name] = value;
  }
  return { command, options };
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) {
    fail(`--${name} is required`);
  }
  return value;
}

function nowFrom(options) {
  if (options.now !== undefined && process.env.OPENCLAW_USABILITY_COORDINATOR_TEST_CLOCK !== "1") {
    fail("--now is available only when the explicit coordinator test clock is enabled");
  }
  const value = options.now ?? new Date().toISOString();
  return parseTimestamp(value, "--now").value;
}

function assertNoUnknownOptions(options, allowed) {
  for (const name of Object.keys(options)) {
    if (!allowed.has(name)) {
      fail(`unknown option --${name}`);
    }
  }
}

function safeCampaignPath(input) {
  if (!isAbsolute(input)) {
    fail("--campaign must be an absolute path");
  }
  const runtimeHome = resolve(
    process.env.OPENCLAW_CUSTOM_RUNTIME_HOME ??
      join(process.env.HOME ?? fail("HOME is required"), ".openclaw-custom-runtime"),
  );
  const usabilityRoot = join(runtimeHome, "usability");
  const target = resolve(input);
  mkdirSync(usabilityRoot, { recursive: true, mode: 0o700 });
  chmodSync(usabilityRoot, 0o700);
  const canonicalRoot = realpathSync(usabilityRoot);
  if (realpathSync(dirname(target)) !== canonicalRoot) {
    fail("--campaign must be a direct file in the custom runtime usability directory");
  }
  return join(canonicalRoot, basename(target));
}

function safeReceiptPath(input, campaignPath) {
  if (!isAbsolute(input)) {
    fail("--receipt must be an absolute path");
  }
  const target = resolve(input);
  const root = realpathSync(dirname(campaignPath));
  if (realpathSync(dirname(target)) !== root || basename(target) === basename(campaignPath)) {
    fail("--receipt must be a different file in the campaign directory");
  }
  return join(root, basename(target));
}

function assertRegularSecureFile(path, label) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail(`${label} must be a regular non-symlink file`, 78);
  }
  if ((metadata.mode & 0o077) !== 0) {
    fail(`${label} permissions are unsafe`, 78);
  }
}

function atomicWriteJson(path, value) {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function loadCampaign(path) {
  if (!existsSync(path)) {
    fail("campaign is missing", 78);
  }
  assertRegularSecureFile(path, "campaign");
  let campaign;
  try {
    campaign = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("campaign is malformed", 78);
  }
  if (!campaign || typeof campaign !== "object" || campaign.schema !== CAMPAIGN_SCHEMA) {
    fail("campaign schema is invalid", 78);
  }
  campaignPolicy(campaign);
  return campaign;
}

function campaignPolicy(campaign) {
  const policy = campaign.policy ?? FIRST_USE_PANEL_POLICY;
  if (!POLICIES.has(policy)) {
    fail("campaign policy is invalid", 78);
  }
  return policy;
}

function requiredOutcomeKeys(campaign) {
  return campaignPolicy(campaign) === OWNER_MAC_STUDIO_POLICY
    ? [
        "issueDetailsAndOwnerOrNext",
        "localAiDistinctionCorrect",
        "overallStateCorrect",
        "resolvePreviewAndSafeCancel",
        "workingItemIdentified",
      ]
    : [
        "issueDetailsAndOwnerOrNext",
        "operatorActionCorrect",
        "overallStateCorrect",
        "workingItemIdentified",
      ];
}

function failedOutcomes(campaign) {
  return Object.fromEntries(requiredOutcomeKeys(campaign).map((key) => [key, false]));
}

function participantLedgerPath(campaignPath) {
  return join(dirname(campaignPath), "participant-ledger.json");
}

function loadParticipantLedger(campaignPath, now, { create = false } = {}) {
  const path = participantLedgerPath(campaignPath);
  if (!existsSync(path)) {
    if (!create) {
      fail("participant ledger is missing", 78);
    }
    return {
      campaigns: [],
      participants: [],
      schema: PARTICIPANT_LEDGER_SCHEMA,
      updatedAt: now,
    };
  }
  assertRegularSecureFile(path, "participant ledger");
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("participant ledger is malformed", 78);
  }
  if (
    !ledger ||
    typeof ledger !== "object" ||
    ledger.schema !== PARTICIPANT_LEDGER_SCHEMA ||
    !Array.isArray(ledger.campaigns) ||
    !Array.isArray(ledger.participants)
  ) {
    fail("participant ledger schema is invalid", 78);
  }
  const campaignIds = new Set();
  for (const campaign of ledger.campaigns) {
    if (
      !campaign ||
      typeof campaign !== "object" ||
      typeof campaign.campaignId !== "string" ||
      !ID_PATTERN.test(campaign.campaignId) ||
      campaignIds.has(campaign.campaignId)
    ) {
      fail("participant ledger campaign identity is invalid or duplicated", 78);
    }
    campaignIds.add(campaign.campaignId);
  }
  const participantKeys = new Set();
  for (const participant of ledger.participants) {
    const key = `${participant?.campaignId ?? ""}:${participant?.participantId ?? ""}`;
    if (
      !participant ||
      typeof participant !== "object" ||
      typeof participant.campaignId !== "string" ||
      !ID_PATTERN.test(participant.campaignId) ||
      typeof participant.participantId !== "string" ||
      !PARTICIPANT_ID_PATTERN.test(participant.participantId) ||
      participantKeys.has(key)
    ) {
      fail("participant ledger participant identity is invalid or duplicated", 78);
    }
    participantKeys.add(key);
  }
  return ledger;
}

function writeParticipantLedger(campaignPath, ledger, now) {
  ledger.updatedAt = now;
  atomicWriteJson(participantLedgerPath(campaignPath), ledger);
}

function acquireLock(campaignPath) {
  const lockPath = join(dirname(campaignPath), ".coordinator.lock");
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("campaign is locked by another coordinator process", 75);
    }
    throw error;
  }
  atomicWriteJson(join(lockPath, "owner.json"), {
    acquiredAt: new Date().toISOString(),
    pid: process.pid,
  });
  return () => rmSync(lockPath, { recursive: true, force: true });
}

function withCampaignLock(campaignPath, operation) {
  const release = acquireLock(campaignPath);
  try {
    return operation();
  } finally {
    release();
  }
}

function calculateCoverage(campaign) {
  const participants = campaign.participants;
  const eligible = participants.filter((participant) => participant.eligible);
  if (campaignPolicy(campaign) === OWNER_MAC_STUDIO_POLICY) {
    return {
      browser: eligible.some((participant) => participant.browser === "chrome"),
      device: eligible.some((participant) => participant.device === "mac-studio"),
      operatorRole: eligible.some((participant) => participant.operatorRole === "control-director"),
    };
  }
  const cohorts = new Set(eligible.map((participant) => participant.cohort));
  const devices = new Set(eligible.map((participant) => participant.device));
  const accessibility = new Set(eligible.map((participant) => participant.accessibilityMode));
  return {
    accessibility: accessibility.has("keyboard-only") || accessibility.has("zoom-200"),
    ageCohorts: cohorts.has("7-12") && cohorts.has("13-64") && cohorts.has("65-90"),
    desktop: devices.has("desktop"),
    mobile: devices.has("mobile"),
  };
}

function computeSummary(campaign, now) {
  const policy = campaignPolicy(campaign);
  const eligible = campaign.participants.filter((participant) => participant.eligible);
  const excluded = campaign.participants.filter((participant) => !participant.eligible);
  const passed = eligible.filter((participant) => participant.status === "passed");
  const failed = eligible.filter((participant) => participant.status === "failed");
  const running = eligible.filter((participant) => participant.status === "running");
  const coverage = calculateCoverage(campaign);
  const requiredParticipantCount = policy === OWNER_MAC_STUDIO_POLICY ? 1 : 5;
  const participantCountValid =
    policy === OWNER_MAC_STUDIO_POLICY
      ? eligible.length === requiredParticipantCount
      : eligible.length >= requiredParticipantCount;
  const remainingParticipantCount = Math.max(0, requiredParticipantCount - eligible.length);
  const coverageComplete = Object.values(coverage).every(Boolean);
  const expired = Date.parse(campaign.expiresAt) <= Date.parse(now);
  let nextAction;
  if (expired || campaign.state === "expired") {
    nextAction = "Create a new exact-SHA campaign; this campaign has expired.";
  } else if (campaign.state === "blocked") {
    nextAction = `Resolve the recorded blocker: ${campaign.blockedReason}.`;
  } else if (campaign.state === "failed") {
    nextAction = "Stop finalization. Preserve the failed attempt and correct the product.";
  } else if (campaign.state === "passed") {
    nextAction = "Generate and attach the exact-SHA final usability receipt.";
  } else if (campaign.state === "running") {
    nextAction =
      policy === OWNER_MAC_STUDIO_POLICY
        ? "Complete the active owner acceptance attempt without hints."
        : "Complete the active zero-instruction attempt without hints.";
  } else if (remainingParticipantCount > 0 || !coverageComplete) {
    const requirements = [];
    if (remainingParticipantCount > 0) {
      requirements.push(
        policy === OWNER_MAC_STUDIO_POLICY
          ? "the Control Director owner"
          : `${remainingParticipantCount} additional first-use participant(s)`,
      );
    }
    if (policy === OWNER_MAC_STUDIO_POLICY && !coverage.browser) {
      requirements.push("Chrome");
    }
    if (policy === OWNER_MAC_STUDIO_POLICY && !coverage.device) {
      requirements.push("the managed Mac Studio");
    }
    if (policy === OWNER_MAC_STUDIO_POLICY && !coverage.operatorRole) {
      requirements.push("the Control Director role");
    }
    if (policy === FIRST_USE_PANEL_POLICY && !coverage.ageCohorts) {
      requirements.push("coverage of all age cohorts");
    }
    if (policy === FIRST_USE_PANEL_POLICY && !coverage.desktop) {
      requirements.push("one desktop participant");
    }
    if (policy === FIRST_USE_PANEL_POLICY && !coverage.mobile) {
      requirements.push("one mobile participant");
    }
    if (policy === FIRST_USE_PANEL_POLICY && !coverage.accessibility) {
      requirements.push("one keyboard-only or 200% zoom participant");
    }
    nextAction = `Register ${requirements.join(", ")}.`;
  } else {
    nextAction =
      policy === OWNER_MAC_STUDIO_POLICY
        ? "Start the owner's timed Mac Studio acceptance attempt."
        : "Start the next eligible participant's timed attempt.";
  }
  const leaseAllowed =
    !expired &&
    failed.length === 0 &&
    remainingParticipantCount === 0 &&
    participantCountValid &&
    coverageComplete &&
    ["ready", "running", "passed"].includes(campaign.state);
  return {
    coverage,
    eligibleParticipantCount: eligible.length,
    excludedParticipantCount: excluded.length,
    failedAttemptCount: failed.length,
    leaseAllowed,
    nextAction,
    participantCountValid,
    policy,
    passedAttemptCount: passed.length,
    remainingParticipantCount,
    runningAttemptCount: running.length,
    unsafeActionCount: eligible.reduce(
      (total, participant) => total + (participant.attempt?.unsafeActionCount ?? 0),
      0,
    ),
  };
}

function refreshCampaign(campaign, now) {
  const policy = campaignPolicy(campaign);
  const requiredParticipantCount = policy === OWNER_MAC_STUDIO_POLICY ? 1 : 5;
  const summary = computeSummary(campaign, now);
  if (!TERMINAL_STATES.has(campaign.state)) {
    if (Date.parse(campaign.expiresAt) <= Date.parse(now)) {
      campaign.state = "expired";
      campaign.expiredAt = now;
    } else if (summary.failedAttemptCount > 0) {
      campaign.state = "failed";
    } else if (
      (policy === OWNER_MAC_STUDIO_POLICY
        ? summary.eligibleParticipantCount === requiredParticipantCount
        : summary.eligibleParticipantCount >= requiredParticipantCount) &&
      Object.values(summary.coverage).every(Boolean)
    ) {
      const eligible = campaign.participants.filter((participant) => participant.eligible);
      if (eligible.every((participant) => participant.status === "passed")) {
        campaign.state = "passed";
        campaign.passedAt ??= now;
      } else if (
        eligible.some((participant) => ["running", "passed"].includes(participant.status))
      ) {
        campaign.state = "running";
      } else {
        campaign.state = "ready";
        campaign.readyAt ??= now;
      }
    } else {
      campaign.state = "waiting";
    }
  }
  campaign.summary = computeSummary(campaign, now);
  campaign.updatedAt = now;
  return campaign;
}

function failOvertimeAttempt(campaign, ledger, now) {
  const participant = campaign.participants.find((entry) => entry.status === "running");
  if (!participant?.attempt?.startedAt) {
    return false;
  }
  const elapsedMs = Date.parse(now) - Date.parse(participant.attempt.startedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 60_000) {
    return false;
  }
  participant.attempt = {
    ...participant.attempt,
    elapsedMs,
    finishedAt: now,
    hintCount: 0,
    observerAttested: false,
    outcomes: failedOutcomes(campaign),
    passed: false,
    unsafeActionCount: 0,
  };
  participant.status = "failed";
  const ledgerParticipant = requireLedgerParticipant(ledger, campaign, participant.id);
  ledgerParticipant.attempt = participant.attempt;
  ledgerParticipant.status = "failed";
  return true;
}

function validateParticipantId(value) {
  if (!PARTICIPANT_ID_PATTERN.test(value)) {
    fail("--participant-id must be a lowercase SHA-256 identifier");
  }
}

function initCampaign(options) {
  assertNoUnknownOptions(
    options,
    new Set([
      "active-runtime-sha",
      "campaign",
      "campaign-id",
      "candidate-sha",
      "expires-at",
      "fixture-sha256",
      "now",
      "policy",
    ]),
  );
  const campaignPath = safeCampaignPath(requireOption(options, "campaign"));
  if (existsSync(campaignPath)) {
    fail("campaign already exists", 75);
  }
  const campaignId = requireOption(options, "campaign-id");
  const candidateSha = requireOption(options, "candidate-sha");
  const fixtureSha256 = requireOption(options, "fixture-sha256");
  const policy = options.policy ?? FIRST_USE_PANEL_POLICY;
  const now = nowFrom(options);
  const expiresAt = parseTimestamp(requireOption(options, "expires-at"), "--expires-at");
  if (!ID_PATTERN.test(campaignId)) {
    fail("--campaign-id is invalid");
  }
  if (!SHA_PATTERN.test(candidateSha)) {
    fail("--candidate-sha is invalid");
  }
  if (!POLICIES.has(policy)) {
    fail("--policy must be first-use-panel or owner-mac-studio");
  }
  const activeRuntimeSha =
    policy === OWNER_MAC_STUDIO_POLICY
      ? requireOption(options, "active-runtime-sha")
      : options["active-runtime-sha"];
  if (activeRuntimeSha !== undefined && !SHA_PATTERN.test(activeRuntimeSha)) {
    fail("--active-runtime-sha is invalid");
  }
  if (policy === OWNER_MAC_STUDIO_POLICY && activeRuntimeSha !== candidateSha) {
    fail("--active-runtime-sha must equal --candidate-sha for owner acceptance");
  }
  if (!/^[a-f0-9]{64}$/u.test(fixtureSha256)) {
    fail("--fixture-sha256 is invalid");
  }
  if (expiresAt.timestamp <= Date.parse(now)) {
    fail("--expires-at must be after --now");
  }
  return withCampaignLock(campaignPath, () => {
    if (existsSync(campaignPath)) {
      fail("campaign already exists", 75);
    }
    const ledger = loadParticipantLedger(campaignPath, now, { create: true });
    if (ledger.campaigns.some((entry) => entry.campaignId === campaignId)) {
      fail("campaign identity is already recorded and cannot be replaced", 75);
    }
    const campaign = refreshCampaign(
      {
        activeRuntimeSha,
        schema: CAMPAIGN_SCHEMA,
        campaignId,
        candidateSha,
        createdAt: now,
        expiresAt: expiresAt.value,
        fixtureSha256,
        neutralGoal: policy === OWNER_MAC_STUDIO_POLICY ? OWNER_NEUTRAL_GOAL : LEGACY_NEUTRAL_GOAL,
        participants: [],
        policy,
        state: "waiting",
        updatedAt: now,
      },
      now,
    );
    ledger.campaigns.push({
      activeRuntimeSha,
      campaignId,
      candidateSha,
      createdAt: now,
      expiresAt: expiresAt.value,
      fixtureSha256,
      policy,
    });
    atomicWriteJson(campaignPath, campaign);
    writeParticipantLedger(campaignPath, ledger, now);
    return campaign;
  });
}

function mutateCampaign(options, allowedOptions, mutation) {
  assertNoUnknownOptions(options, new Set(["campaign", "now", ...allowedOptions]));
  const campaignPath = safeCampaignPath(requireOption(options, "campaign"));
  const now = nowFrom(options);
  return withCampaignLock(campaignPath, () => {
    const campaign = loadCampaign(campaignPath);
    const ledger = loadParticipantLedger(campaignPath, now);
    const timedOut = failOvertimeAttempt(campaign, ledger, now);
    refreshCampaign(campaign, now);
    const campaignRecord = ledger.campaigns.find(
      (entry) =>
        entry.campaignId === campaign.campaignId &&
        entry.candidateSha === campaign.candidateSha &&
        entry.fixtureSha256 === campaign.fixtureSha256,
    );
    if (
      !campaignRecord ||
      (campaignRecord.policy ?? FIRST_USE_PANEL_POLICY) !== campaignPolicy(campaign) ||
      campaignRecord.activeRuntimeSha !== campaign.activeRuntimeSha
    ) {
      fail("campaign is not bound to the participant ledger", 78);
    }
    if (timedOut) {
      atomicWriteJson(campaignPath, campaign);
      writeParticipantLedger(campaignPath, ledger, now);
      fail("the active attempt exceeded 60 seconds and is now terminal", 75);
    }
    const next = mutation(campaign, now, ledger);
    refreshCampaign(next, now);
    atomicWriteJson(campaignPath, next);
    writeParticipantLedger(campaignPath, ledger, now);
    if (next.state === "passed") {
      ensureFinalReceipt(campaignPath, next, ledger, now);
    }
    return next;
  });
}

function requireLedgerParticipant(ledger, campaign, participantId) {
  const participant = ledger.participants.find(
    (entry) =>
      entry.participantId === participantId &&
      entry.campaignId === campaign.campaignId &&
      entry.candidateSha === campaign.candidateSha,
  );
  if (
    !participant ||
    participant.campaignId !== campaign.campaignId ||
    participant.candidateSha !== campaign.candidateSha
  ) {
    fail("participant is not bound to this campaign ledger", 78);
  }
  return participant;
}

function registerParticipant(options) {
  return mutateCampaign(
    options,
    [
      "accessibility",
      "browser",
      "cohort",
      "consent-recorded",
      "device",
      "first-use",
      "guardian-consent-recorded",
      "operator-role",
      "participant-id",
      "viewport",
    ],
    (campaign, now, ledger) => {
      if (campaign.state !== "waiting") {
        fail(`participants cannot be registered while campaign state is ${campaign.state}`, 75);
      }
      const participantId = requireOption(options, "participant-id");
      validateParticipantId(participantId);
      if (campaign.participants.some((participant) => participant.id === participantId)) {
        fail("participant is already recorded and cannot be recycled", 75);
      }
      const policy = campaignPolicy(campaign);
      if (
        policy === FIRST_USE_PANEL_POLICY &&
        ledger.participants.some((participant) => participant.participantId === participantId)
      ) {
        fail("participant was already recorded in a prior campaign and cannot be recycled", 75);
      }
      if (
        policy === OWNER_MAC_STUDIO_POLICY &&
        campaign.participants.some((participant) => participant.eligible)
      ) {
        fail("owner acceptance already has its single eligible participant", 75);
      }
      if (
        policy === OWNER_MAC_STUDIO_POLICY &&
        ledger.participants.some(
          (participant) =>
            participant.participantId === participantId &&
            participant.candidateSha === campaign.candidateSha,
        )
      ) {
        fail("owner was already recorded for this candidate and cannot retry", 75);
      }
      const device = requireOption(options, "device");
      const viewport = requireOption(options, "viewport");
      if (!VIEWPORT_PATTERN.test(viewport)) {
        fail("--viewport must use WIDTHxHEIGHT");
      }
      const consentRecorded = parseBoolean(
        requireOption(options, "consent-recorded"),
        "--consent-recorded",
      );
      let participant;
      if (policy === OWNER_MAC_STUDIO_POLICY) {
        const browser = requireOption(options, "browser");
        const operatorRole = requireOption(options, "operator-role");
        if (device !== "mac-studio") {
          fail("--device must be mac-studio for owner acceptance");
        }
        if (browser !== "chrome") {
          fail("--browser must be chrome for owner acceptance");
        }
        if (operatorRole !== "control-director") {
          fail("--operator-role must be control-director for owner acceptance");
        }
        if (!consentRecorded) {
          fail("--consent-recorded must be true for owner acceptance");
        }
        const accessibilityMode = options.accessibility ?? "standard";
        if (!ACCESSIBILITY_MODES.has(accessibilityMode)) {
          fail("--accessibility must be standard, keyboard-only, or zoom-200");
        }
        participant = {
          accessibilityMode,
          browser,
          consentRecorded,
          device,
          eligible: consentRecorded,
          eligibilityReason: consentRecorded
            ? "owner-consent-and-device-confirmed"
            : "consent-not-recorded",
          id: participantId,
          operatorRole,
          registeredAt: now,
          status: consentRecorded ? "registered" : "excluded",
          viewport,
        };
      } else {
        const cohort = requireOption(options, "cohort");
        const accessibilityMode = requireOption(options, "accessibility");
        if (!COHORTS.has(cohort)) {
          fail("--cohort must be 7-12, 13-64, or 65-90");
        }
        if (!DEVICES.has(device)) {
          fail("--device must be desktop or mobile");
        }
        if (!ACCESSIBILITY_MODES.has(accessibilityMode)) {
          fail("--accessibility must be standard, keyboard-only, or zoom-200");
        }
        const firstUse = parseBoolean(requireOption(options, "first-use"), "--first-use");
        const guardianConsentRecorded =
          cohort === "7-12"
            ? parseBoolean(
                requireOption(options, "guardian-consent-recorded"),
                "--guardian-consent-recorded",
              )
            : false;
        const eligible =
          firstUse && consentRecorded && (cohort !== "7-12" || guardianConsentRecorded);
        participant = {
          accessibilityMode,
          cohort,
          consentRecorded,
          device,
          eligible,
          eligibilityReason: eligible
            ? "first-use-and-consent-confirmed"
            : !firstUse
              ? "previously-trained"
              : !consentRecorded
                ? "consent-not-recorded"
                : "guardian-consent-not-recorded",
          firstUse,
          guardianConsentRecorded,
          id: participantId,
          registeredAt: now,
          status: eligible ? "registered" : "excluded",
          viewport,
        };
      }
      campaign.participants.push(participant);
      const { id, ...ledgerParticipant } = participant;
      ledger.participants.push({
        ...ledgerParticipant,
        campaignId: campaign.campaignId,
        candidateSha: campaign.candidateSha,
        participantId: id,
        policy,
      });
      return campaign;
    },
  );
}

function startAttempt(options) {
  return mutateCampaign(options, ["participant-id"], (campaign, now, ledger) => {
    if (!["ready", "running"].includes(campaign.state)) {
      fail(`an attempt cannot start while campaign state is ${campaign.state}`, 75);
    }
    const participantId = requireOption(options, "participant-id");
    validateParticipantId(participantId);
    const participant = campaign.participants.find((entry) => entry.id === participantId);
    if (!participant?.eligible) {
      fail("participant is missing or ineligible", 75);
    }
    if (participant.status !== "registered") {
      fail("participant already has an attempt and cannot retry", 75);
    }
    if (campaign.participants.some((entry) => entry.status === "running")) {
      fail("another participant attempt is already running", 75);
    }
    participant.status = "running";
    participant.attempt = {
      startedAt: now,
    };
    const ledgerParticipant = requireLedgerParticipant(ledger, campaign, participantId);
    if (ledgerParticipant.status !== "registered") {
      fail("participant ledger already contains an attempt", 75);
    }
    ledgerParticipant.attempt = participant.attempt;
    ledgerParticipant.status = "running";
    return campaign;
  });
}

function completeAttempt(options) {
  return mutateCampaign(
    options,
    [
      "hint-count",
      "issue-details-and-owner-or-next",
      "local-ai-distinction-correct",
      "operator-action-correct",
      "overall-state-correct",
      "participant-id",
      "resolve-preview-and-safe-cancel",
      "unsafe-action-count",
      "working-item-identified",
      "observer-attested",
    ],
    (campaign, now, ledger) => {
      if (campaign.state !== "running") {
        fail(`an attempt cannot complete while campaign state is ${campaign.state}`, 75);
      }
      const participantId = requireOption(options, "participant-id");
      validateParticipantId(participantId);
      const participant = campaign.participants.find((entry) => entry.id === participantId);
      if (!participant?.eligible || participant.status !== "running" || !participant.attempt) {
        fail("participant does not have a running attempt", 75);
      }
      const startedAt = Date.parse(participant.attempt.startedAt);
      const finishedAt = Date.parse(now);
      const elapsedMs = finishedAt - startedAt;
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        fail("attempt completion precedes its start", 78);
      }
      const outcomes =
        campaignPolicy(campaign) === OWNER_MAC_STUDIO_POLICY
          ? {
              issueDetailsAndOwnerOrNext: parseBoolean(
                requireOption(options, "issue-details-and-owner-or-next"),
                "--issue-details-and-owner-or-next",
              ),
              localAiDistinctionCorrect: parseBoolean(
                requireOption(options, "local-ai-distinction-correct"),
                "--local-ai-distinction-correct",
              ),
              overallStateCorrect: parseBoolean(
                requireOption(options, "overall-state-correct"),
                "--overall-state-correct",
              ),
              resolvePreviewAndSafeCancel: parseBoolean(
                requireOption(options, "resolve-preview-and-safe-cancel"),
                "--resolve-preview-and-safe-cancel",
              ),
              workingItemIdentified: parseBoolean(
                requireOption(options, "working-item-identified"),
                "--working-item-identified",
              ),
            }
          : {
              issueDetailsAndOwnerOrNext: parseBoolean(
                requireOption(options, "issue-details-and-owner-or-next"),
                "--issue-details-and-owner-or-next",
              ),
              operatorActionCorrect: parseBoolean(
                requireOption(options, "operator-action-correct"),
                "--operator-action-correct",
              ),
              overallStateCorrect: parseBoolean(
                requireOption(options, "overall-state-correct"),
                "--overall-state-correct",
              ),
              workingItemIdentified: parseBoolean(
                requireOption(options, "working-item-identified"),
                "--working-item-identified",
              ),
            };
      const hintCount = parseCount(requireOption(options, "hint-count"), "--hint-count");
      const unsafeActionCount = parseCount(
        requireOption(options, "unsafe-action-count"),
        "--unsafe-action-count",
      );
      const observerAttested = parseBoolean(
        requireOption(options, "observer-attested"),
        "--observer-attested",
      );
      const passed =
        elapsedMs <= 60_000 &&
        Object.values(outcomes).every(Boolean) &&
        hintCount === 0 &&
        unsafeActionCount === 0 &&
        observerAttested;
      participant.attempt = {
        ...participant.attempt,
        elapsedMs,
        finishedAt: now,
        hintCount,
        observerAttested,
        outcomes,
        passed,
        unsafeActionCount,
      };
      participant.status = passed ? "passed" : "failed";
      const ledgerParticipant = requireLedgerParticipant(ledger, campaign, participantId);
      if (
        ledgerParticipant.status !== "running" ||
        JSON.stringify(ledgerParticipant.attempt ?? null) !==
          JSON.stringify({ startedAt: participant.attempt.startedAt })
      ) {
        fail("participant ledger running attempt conflicts with the campaign", 78);
      }
      ledgerParticipant.attempt = participant.attempt;
      ledgerParticipant.status = participant.status;
      return campaign;
    },
  );
}

function blockCampaign(options) {
  return mutateCampaign(options, ["reason"], (campaign, now) => {
    if (TERMINAL_STATES.has(campaign.state)) {
      fail(`campaign is already terminal: ${campaign.state}`, 75);
    }
    const reason = requireOption(options, "reason");
    if (!ID_PATTERN.test(reason)) {
      fail("--reason is invalid");
    }
    campaign.blockedAt = now;
    campaign.blockedReason = reason;
    campaign.state = "blocked";
    return campaign;
  });
}

function expireCampaign(options) {
  return mutateCampaign(options, [], (campaign, now) => {
    if (TERMINAL_STATES.has(campaign.state)) {
      fail(`campaign is already terminal: ${campaign.state}`, 75);
    }
    campaign.expiredAt = now;
    campaign.state = "expired";
    return campaign;
  });
}

function campaignStatus(options) {
  assertNoUnknownOptions(options, new Set(["campaign", "now"]));
  const campaignPath = safeCampaignPath(requireOption(options, "campaign"));
  const now = nowFrom(options);
  return withCampaignLock(campaignPath, () => {
    const campaign = loadCampaign(campaignPath);
    const ledger = loadParticipantLedger(campaignPath, now);
    const timedOut = failOvertimeAttempt(campaign, ledger, now);
    refreshCampaign(campaign, now);
    if (
      !ledger.campaigns.some(
        (entry) =>
          entry.campaignId === campaign.campaignId &&
          entry.candidateSha === campaign.candidateSha &&
          entry.fixtureSha256 === campaign.fixtureSha256 &&
          (entry.policy ?? FIRST_USE_PANEL_POLICY) === campaignPolicy(campaign) &&
          entry.activeRuntimeSha === campaign.activeRuntimeSha,
      )
    ) {
      fail("campaign is not bound to the participant ledger", 78);
    }
    atomicWriteJson(campaignPath, campaign);
    if (timedOut) {
      writeParticipantLedger(campaignPath, ledger, now);
    }
    if (campaign.state === "passed") {
      ensureFinalReceipt(campaignPath, campaign, ledger, now);
    }
    return {
      activeRuntimeSha: campaign.activeRuntimeSha,
      campaignId: campaign.campaignId,
      candidateSha: campaign.candidateSha,
      finalReceiptPath: campaign.finalReceiptPath,
      finalReceiptSha256: campaign.finalReceiptSha256,
      policy: campaignPolicy(campaign),
      schema: CAMPAIGN_SCHEMA,
      state: campaign.state,
      summary: campaign.summary,
    };
  });
}

function receiptPathForCampaign(campaignPath) {
  return safeReceiptPath(`${campaignPath}.receipt.json`, campaignPath);
}

function assertFinalLedgerConsistency(campaign, ledger) {
  const campaignLedgerParticipants = ledger.participants.filter(
    (participant) => participant.campaignId === campaign.campaignId,
  );
  if (
    campaignLedgerParticipants.length !== campaign.participants.length ||
    campaignLedgerParticipants.some(
      (participant) => participant.candidateSha !== campaign.candidateSha,
    )
  ) {
    fail("participant ledger contains replaced or extraneous campaign evidence", 78);
  }
  for (const participant of campaign.participants) {
    const ledgerParticipant = requireLedgerParticipant(ledger, campaign, participant.id);
    if (
      ledgerParticipant.accessibilityMode !== participant.accessibilityMode ||
      ledgerParticipant.browser !== participant.browser ||
      ledgerParticipant.cohort !== participant.cohort ||
      ledgerParticipant.consentRecorded !== participant.consentRecorded ||
      ledgerParticipant.device !== participant.device ||
      ledgerParticipant.eligible !== participant.eligible ||
      ledgerParticipant.eligibilityReason !== participant.eligibilityReason ||
      ledgerParticipant.firstUse !== participant.firstUse ||
      ledgerParticipant.guardianConsentRecorded !== participant.guardianConsentRecorded ||
      ledgerParticipant.operatorRole !== participant.operatorRole ||
      (ledgerParticipant.policy ?? FIRST_USE_PANEL_POLICY) !== campaignPolicy(campaign) ||
      ledgerParticipant.status !== participant.status ||
      ledgerParticipant.viewport !== participant.viewport ||
      JSON.stringify(ledgerParticipant.attempt ?? null) !==
        JSON.stringify(participant.attempt ?? null)
    ) {
      fail("participant ledger conflicts with final campaign evidence", 78);
    }
  }
}

function validateFinalReceipt(receiptPath, campaign) {
  assertRegularSecureFile(receiptPath, "final receipt");
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch {
    fail("final receipt is malformed", 78);
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("final receipt is malformed", 78);
  }
  const { receiptSha256, ...receiptInput } = receipt;
  const computedReceiptSha256 = createHash("sha256")
    .update(`${JSON.stringify(receiptInput, null, 2)}\n`)
    .digest("hex");
  if (
    receipt.schema !== FINAL_RECEIPT_SCHEMA ||
    receipt.campaignId !== campaign.campaignId ||
    receipt.candidateSha !== campaign.candidateSha ||
    receipt.activeRuntimeSha !== campaign.activeRuntimeSha ||
    receipt.fixtureSha256 !== campaign.fixtureSha256 ||
    (receipt.policy ?? FIRST_USE_PANEL_POLICY) !== campaignPolicy(campaign) ||
    receipt.result !== "passed" ||
    receiptSha256 !== computedReceiptSha256
  ) {
    fail("final receipt identity or digest is invalid", 78);
  }
  return receipt;
}

function ensureFinalReceipt(campaignPath, campaign, ledger, now, requestedPath) {
  if (campaign.state !== "passed" || !campaign.summary.leaseAllowed) {
    fail(`campaign cannot finalize while state is ${campaign.state}`, 75);
  }
  assertFinalLedgerConsistency(campaign, ledger);
  const receiptPath = requestedPath ?? receiptPathForCampaign(campaignPath);
  const receiptIdentity = existsSync(receiptPath) ? realpathSync(receiptPath) : receiptPath;
  if (campaign.finalReceiptPath && receiptIdentity !== campaign.finalReceiptPath) {
    fail("final receipt path does not match the automatic campaign receipt", 75);
  }
  let receipt;
  if (existsSync(receiptPath)) {
    receipt = validateFinalReceipt(receiptPath, campaign);
  } else {
    const participants = campaign.participants
      .filter((participant) => participant.eligible)
      .map((participant) => ({
        accessibilityMode: participant.accessibilityMode,
        attempt: participant.attempt,
        browser: participant.browser,
        cohort: participant.cohort,
        consentRecorded: participant.consentRecorded,
        device: participant.device,
        firstUse: participant.firstUse,
        guardianConsentRecorded: participant.guardianConsentRecorded,
        operatorRole: participant.operatorRole,
        participantId: participant.id,
        viewport: participant.viewport,
      }));
    const receiptInput = {
      activeRuntimeSha: campaign.activeRuntimeSha,
      campaignId: campaign.campaignId,
      candidateSha: campaign.candidateSha,
      completedAt: now,
      fixtureSha256: campaign.fixtureSha256,
      neutralGoal: campaign.neutralGoal,
      participantLedgerSha256: createHash("sha256")
        .update(readFileSync(participantLedgerPath(campaignPath)))
        .digest("hex"),
      participants,
      policy: campaignPolicy(campaign),
      result: "passed",
      schema: FINAL_RECEIPT_SCHEMA,
      summary: campaign.summary,
    };
    receipt = {
      ...receiptInput,
      receiptSha256: createHash("sha256")
        .update(`${JSON.stringify(receiptInput, null, 2)}\n`)
        .digest("hex"),
    };
    atomicWriteJson(receiptPath, receipt);
  }
  campaign.finalReceiptPath = realpathSync(receiptPath);
  campaign.finalReceiptSha256 = createHash("sha256")
    .update(readFileSync(receiptPath))
    .digest("hex");
  campaign.finalizedAt ??= receipt.completedAt;
  atomicWriteJson(campaignPath, campaign);
  return receipt;
}

function finalizeCampaign(options) {
  assertNoUnknownOptions(options, new Set(["campaign", "now", "receipt"]));
  const campaignPath = safeCampaignPath(requireOption(options, "campaign"));
  const receiptPath =
    typeof options.receipt === "string"
      ? safeReceiptPath(options.receipt, campaignPath)
      : receiptPathForCampaign(campaignPath);
  const now = nowFrom(options);
  return withCampaignLock(campaignPath, () => {
    const campaign = refreshCampaign(loadCampaign(campaignPath), now);
    const ledger = loadParticipantLedger(campaignPath, now);
    return ensureFinalReceipt(campaignPath, campaign, ledger, now, receiptPath);
  });
}

export function run(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "init":
      return initCampaign(options);
    case "register":
      return registerParticipant(options);
    case "start":
      return startAttempt(options);
    case "complete":
      return completeAttempt(options);
    case "block":
      return blockCampaign(options);
    case "expire":
      return expireCampaign(options);
    case "status":
      return campaignStatus(options);
    case "finalize":
      return finalizeCampaign(options);
    default:
      return fail(`unknown coordinator command: ${command}`);
  }
}

const isCli = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const result = run(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}
