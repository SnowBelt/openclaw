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
export const NEUTRAL_GOAL =
  "Use this screen to tell me whether OpenClaw needs the operator, what it is doing now, and show me the most important issue's details.";

const TERMINAL_STATES = new Set(["passed", "failed", "expired", "blocked"]);
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
  return campaign;
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

function calculateCoverage(participants) {
  const eligible = participants.filter((participant) => participant.eligible);
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
  const eligible = campaign.participants.filter((participant) => participant.eligible);
  const excluded = campaign.participants.filter((participant) => !participant.eligible);
  const passed = eligible.filter((participant) => participant.status === "passed");
  const failed = eligible.filter((participant) => participant.status === "failed");
  const running = eligible.filter((participant) => participant.status === "running");
  const coverage = calculateCoverage(campaign.participants);
  const remainingParticipantCount = Math.max(0, 5 - eligible.length);
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
    nextAction = "Complete the active zero-instruction attempt without hints.";
  } else if (remainingParticipantCount > 0 || !coverageComplete) {
    const requirements = [];
    if (remainingParticipantCount > 0) {
      requirements.push(`${remainingParticipantCount} additional first-use participant(s)`);
    }
    if (!coverage.ageCohorts) {
      requirements.push("coverage of all age cohorts");
    }
    if (!coverage.desktop) {
      requirements.push("one desktop participant");
    }
    if (!coverage.mobile) {
      requirements.push("one mobile participant");
    }
    if (!coverage.accessibility) {
      requirements.push("one keyboard-only or 200% zoom participant");
    }
    nextAction = `Register ${requirements.join(", ")}.`;
  } else {
    nextAction = "Start the next eligible participant's timed attempt.";
  }
  const leaseAllowed =
    !expired &&
    failed.length === 0 &&
    remainingParticipantCount === 0 &&
    coverageComplete &&
    ["ready", "running", "passed"].includes(campaign.state);
  return {
    coverage,
    eligibleParticipantCount: eligible.length,
    excludedParticipantCount: excluded.length,
    failedAttemptCount: failed.length,
    leaseAllowed,
    nextAction,
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
  const summary = computeSummary(campaign, now);
  if (!TERMINAL_STATES.has(campaign.state)) {
    if (Date.parse(campaign.expiresAt) <= Date.parse(now)) {
      campaign.state = "expired";
      campaign.expiredAt = now;
    } else if (summary.failedAttemptCount > 0) {
      campaign.state = "failed";
    } else if (
      summary.eligibleParticipantCount >= 5 &&
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
    outcomes: {
      issueDetailsAndOwnerOrNext: false,
      operatorActionCorrect: false,
      overallStateCorrect: false,
      workingItemIdentified: false,
    },
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
    new Set(["campaign", "campaign-id", "candidate-sha", "expires-at", "fixture-sha256", "now"]),
  );
  const campaignPath = safeCampaignPath(requireOption(options, "campaign"));
  if (existsSync(campaignPath)) {
    fail("campaign already exists", 75);
  }
  const campaignId = requireOption(options, "campaign-id");
  const candidateSha = requireOption(options, "candidate-sha");
  const fixtureSha256 = requireOption(options, "fixture-sha256");
  const now = nowFrom(options);
  const expiresAt = parseTimestamp(requireOption(options, "expires-at"), "--expires-at");
  if (!ID_PATTERN.test(campaignId)) {
    fail("--campaign-id is invalid");
  }
  if (!SHA_PATTERN.test(candidateSha)) {
    fail("--candidate-sha is invalid");
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
        schema: CAMPAIGN_SCHEMA,
        campaignId,
        candidateSha,
        createdAt: now,
        expiresAt: expiresAt.value,
        fixtureSha256,
        neutralGoal: NEUTRAL_GOAL,
        participants: [],
        state: "waiting",
        updatedAt: now,
      },
      now,
    );
    ledger.campaigns.push({
      campaignId,
      candidateSha,
      createdAt: now,
      expiresAt: expiresAt.value,
      fixtureSha256,
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
    if (!campaignRecord) {
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
  const participant = ledger.participants.find((entry) => entry.participantId === participantId);
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
      "cohort",
      "consent-recorded",
      "device",
      "first-use",
      "guardian-consent-recorded",
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
      if (ledger.participants.some((participant) => participant.participantId === participantId)) {
        fail("participant was already recorded in a prior campaign and cannot be recycled", 75);
      }
      const cohort = requireOption(options, "cohort");
      const device = requireOption(options, "device");
      const accessibilityMode = requireOption(options, "accessibility");
      const viewport = requireOption(options, "viewport");
      if (!COHORTS.has(cohort)) {
        fail("--cohort must be 7-12, 13-64, or 65-90");
      }
      if (!DEVICES.has(device)) {
        fail("--device must be desktop or mobile");
      }
      if (!ACCESSIBILITY_MODES.has(accessibilityMode)) {
        fail("--accessibility must be standard, keyboard-only, or zoom-200");
      }
      if (!VIEWPORT_PATTERN.test(viewport)) {
        fail("--viewport must use WIDTHxHEIGHT");
      }
      const firstUse = parseBoolean(requireOption(options, "first-use"), "--first-use");
      const consentRecorded = parseBoolean(
        requireOption(options, "consent-recorded"),
        "--consent-recorded",
      );
      const guardianConsentRecorded =
        cohort === "7-12"
          ? parseBoolean(
              requireOption(options, "guardian-consent-recorded"),
              "--guardian-consent-recorded",
            )
          : false;
      const eligible =
        firstUse && consentRecorded && (cohort !== "7-12" || guardianConsentRecorded);
      campaign.participants.push({
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
      });
      ledger.participants.push({
        accessibilityMode,
        campaignId: campaign.campaignId,
        candidateSha: campaign.candidateSha,
        cohort,
        consentRecorded,
        device,
        eligibilityReason: eligible
          ? "first-use-and-consent-confirmed"
          : !firstUse
            ? "previously-trained"
            : !consentRecorded
              ? "consent-not-recorded"
              : "guardian-consent-not-recorded",
        eligible,
        firstUse,
        guardianConsentRecorded,
        participantId,
        registeredAt: now,
        status: eligible ? "registered" : "excluded",
        viewport,
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
      "operator-action-correct",
      "overall-state-correct",
      "participant-id",
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
      const outcomes = {
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
          entry.fixtureSha256 === campaign.fixtureSha256,
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
      campaignId: campaign.campaignId,
      candidateSha: campaign.candidateSha,
      finalReceiptPath: campaign.finalReceiptPath,
      finalReceiptSha256: campaign.finalReceiptSha256,
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
  for (const participant of campaign.participants) {
    const ledgerParticipant = requireLedgerParticipant(ledger, campaign, participant.id);
    if (
      ledgerParticipant.accessibilityMode !== participant.accessibilityMode ||
      ledgerParticipant.cohort !== participant.cohort ||
      ledgerParticipant.consentRecorded !== participant.consentRecorded ||
      ledgerParticipant.device !== participant.device ||
      ledgerParticipant.eligible !== participant.eligible ||
      ledgerParticipant.eligibilityReason !== participant.eligibilityReason ||
      ledgerParticipant.firstUse !== participant.firstUse ||
      ledgerParticipant.guardianConsentRecorded !== participant.guardianConsentRecorded ||
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
    receipt.fixtureSha256 !== campaign.fixtureSha256 ||
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
        cohort: participant.cohort,
        consentRecorded: participant.consentRecorded,
        device: participant.device,
        firstUse: participant.firstUse,
        guardianConsentRecorded: participant.guardianConsentRecorded,
        participantId: participant.id,
        viewport: participant.viewport,
      }));
    const receiptInput = {
      campaignId: campaign.campaignId,
      candidateSha: campaign.candidateSha,
      completedAt: now,
      fixtureSha256: campaign.fixtureSha256,
      neutralGoal: campaign.neutralGoal,
      participantLedgerSha256: createHash("sha256")
        .update(readFileSync(participantLedgerPath(campaignPath)))
        .digest("hex"),
      participants,
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
