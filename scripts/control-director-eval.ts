#!/usr/bin/env node
import { createHash, createPublicKey } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildControlDirectorModelEvalCampaignNonce,
  buildControlDirectorModelEvalMatrix,
  buildControlDirectorModelTrialJudgeClaim,
  CONTROL_DIRECTOR_MODEL_EVAL_TRIAL_RECEIPT_SCHEMA,
  digestControlDirectorModelEvalTrialMeasurementReceipt,
  digestControlDirectorModelTrialEvidenceSet,
  digestControlDirectorModelTrialMeasurementSet,
  parseControlDirectorModelEvalTrials,
  type ControlDirectorModelEvalTrial,
} from "../src/agents/control-director-model-eval.js";
import {
  issueControlDirectorModelTrialJudgeReceipt,
  signControlDirectorModelTrialEnvelope,
} from "../src/agents/independent-judge-service.js";
import { resolveStateDir } from "../src/config/paths.js";

function usage(): never {
  throw new Error(
    "Usage: pnpm control-director:eval -- [issue-trial] --input <trials.json> [--output <issued.json>] --source-sha <sha> --rollback-sha <sha> --config-digest <sha256> --model <provider/model> --model-digest <sha256> --cache-digest <sha256> --artifact-root <dir> --active-release-id <id> --rollback-release-id <id> --lease-owner <id> --approval-id <id> --operation-id <id> --invocation-id <id> --judge-agent-id <id> --lease-acquired-at <iso> [--json].",
  );
}

function parse(argv: string[]) {
  const mode = argv[0] === "issue-trial" ? "issue-trial" : "verify";
  const values = mode === "issue-trial" ? argv.slice(1) : argv;
  let inputPath = "";
  let outputPath = "";
  let sourceSha = "";
  let rollbackSha = "";
  let configurationDigest = "";
  let modelRef = "";
  let modelDigest = "";
  let cacheDigest = "";
  let artifactRoot = "";
  const certification = new Map<string, string>();
  let json = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--input") {
      inputPath = values[++index] ?? "";
    } else if (value === "--output") {
      outputPath = values[++index] ?? "";
    } else if (value === "--source-sha") {
      sourceSha = values[++index] ?? "";
    } else if (value === "--rollback-sha") {
      rollbackSha = values[++index] ?? "";
    } else if (value === "--config-digest") {
      configurationDigest = values[++index] ?? "";
    } else if (value === "--model") {
      modelRef = values[++index] ?? "";
    } else if (value === "--model-digest") {
      modelDigest = values[++index] ?? "";
    } else if (value === "--cache-digest") {
      cacheDigest = values[++index] ?? "";
    } else if (value === "--artifact-root") {
      artifactRoot = values[++index] ?? "";
    } else if (
      [
        "--active-release-id",
        "--rollback-release-id",
        "--lease-owner",
        "--approval-id",
        "--operation-id",
        "--invocation-id",
        "--judge-agent-id",
        "--lease-acquired-at",
      ].includes(value)
    ) {
      certification.set(value.slice(2), values[++index] ?? "");
    } else if (value === "--json") {
      json = true;
    } else if (value === "--") {
      continue;
    } else {
      usage();
    }
  }
  if (
    !inputPath ||
    !/^[a-f0-9]{40}$/u.test(sourceSha) ||
    !/^[a-f0-9]{40}$/u.test(rollbackSha) ||
    rollbackSha === sourceSha ||
    !/^[a-f0-9]{64}$/u.test(configurationDigest) ||
    !modelRef.includes("/") ||
    !/^[a-f0-9]{64}$/u.test(modelDigest) ||
    !/^[a-f0-9]{64}$/u.test(cacheDigest) ||
    !artifactRoot ||
    (mode === "issue-trial" && !outputPath) ||
    [...certification.values()].some((value) => !value) ||
    certification.size !== 8 ||
    !Number.isFinite(Date.parse(certification.get("lease-acquired-at") ?? ""))
  ) {
    usage();
  }
  return {
    inputPath: path.resolve(inputPath),
    outputPath: outputPath ? path.resolve(outputPath) : "",
    mode,
    sourceSha,
    rollbackSha,
    configurationDigest,
    modelRef,
    modelIdentity: { modelDigest, cacheDigest },
    artifactRoot: path.resolve(artifactRoot),
    certification,
    json,
  };
}

type ParsedArgs = ReturnType<typeof parse>;

function artifactReader(args: ParsedArgs) {
  const artifactRoot = fs.realpathSync(args.artifactRoot);
  return (artifact: { path: string; sha256: string }): string | undefined => {
    const candidate = path.resolve(artifactRoot, artifact.path);
    const relative = path.relative(artifactRoot, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return undefined;
    }
    try {
      const realCandidate = fs.realpathSync(candidate);
      const realRelative = path.relative(artifactRoot, realCandidate);
      if (
        realRelative.startsWith("..") ||
        path.isAbsolute(realRelative) ||
        fs.lstatSync(candidate).isSymbolicLink() ||
        !fs.statSync(realCandidate).isFile()
      ) {
        return undefined;
      }
      const bytes = fs.readFileSync(realCandidate);
      if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
        return undefined;
      }
      return bytes.toString("utf8");
    } catch {
      return undefined;
    }
  };
}

function judgeKey() {
  const judgePublicKeyPath = path.join(
    resolveStateDir(),
    "credentials",
    "judge-receipt-ed25519-public.pem",
  );
  const judgePublicKeyPem = fs.readFileSync(judgePublicKeyPath, "utf8");
  return {
    judgePublicKeyPem,
    judgePublicKeyId: createHash("sha256")
      .update(createPublicKey(judgePublicKeyPem).export({ type: "spki", format: "der" }))
      .digest("hex"),
  };
}

const measurementFields = [
  "ackMs",
  "firstActivityMs",
  "maximumActivityGapMs",
  "cancelAckMs",
  "substantiveResponseMs",
  "instructionCoveragePercent",
  "recentRecallTop3",
  "missionContinuity",
  "completionProofValid",
  "layoutVisible",
  "peakCpuPercent",
  "peakMemoryGb",
  "thermalPressure",
] as const;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function issueArtifactSources(
  trial: Omit<ControlDirectorModelEvalTrial, "runtimeReceipt">,
  artifacts: ControlDirectorModelEvalTrial["runtimeReceipt"]["artifacts"],
  readArtifact: ReturnType<typeof artifactReader>,
) {
  return measurementFields.map((metric) => {
    const jsonPointer = `/trial/${metric}`;
    const artifact = artifacts.find((candidate) => {
      const text = readArtifact(candidate);
      if (!text) {
        return false;
      }
      try {
        return JSON.stringify(JSON.parse(text)?.trial?.[metric]) === JSON.stringify(trial[metric]);
      } catch {
        return false;
      }
    });
    if (!artifact) {
      throw new Error(`No digest-verified artifact derives trial measurement ${metric}.`);
    }
    return {
      metric,
      evidenceRef: artifact.evidenceRef,
      artifactSha256: artifact.sha256,
      jsonPointer,
      valueSha256: createHash("sha256").update(JSON.stringify(trial[metric])).digest("hex"),
    };
  });
}

function issueEvidenceArtifacts(
  artifacts: ControlDirectorModelEvalTrial["runtimeReceipt"]["artifacts"],
  readArtifact: ReturnType<typeof artifactReader>,
) {
  return artifacts.map((artifact) => {
    const content = readArtifact(artifact);
    if (!content) {
      throw new Error(`Evidence artifact failed digest verification: ${artifact.evidenceRef}`);
    }
    return { ...artifact, content };
  });
}

async function issueTrial(args: ParsedArgs, readArtifact: ReturnType<typeof artifactReader>) {
  const draft = object(JSON.parse(fs.readFileSync(args.inputPath, "utf8")), "trial draft");
  const receiptDraft = object(draft.runtimeReceipt, "trial draft.runtimeReceipt");
  const route = stringValue(draft.route, "trial draft.route");
  const taskClass = stringValue(draft.taskClass, "trial draft.taskClass");
  const thermalPressure = stringValue(draft.thermalPressure, "trial draft.thermalPressure");
  if (
    !["local", "codex"].includes(route) ||
    !["conversation", "recall", "planning", "delegation", "steering", "verification"].includes(
      taskClass,
    ) ||
    !["nominal", "fair", "serious", "critical", "unknown"].includes(thermalPressure)
  ) {
    throw new Error("Trial draft contains an unsupported route, task class, or thermal pressure.");
  }
  const trial = {
    trialId: stringValue(draft.trialId, "trial draft.trialId"),
    modelRef: stringValue(draft.modelRef, "trial draft.modelRef"),
    route: route as ControlDirectorModelEvalTrial["route"],
    taskClass: taskClass as ControlDirectorModelEvalTrial["taskClass"],
    cold: booleanValue(draft.cold, "trial draft.cold"),
    ackMs: numberValue(draft.ackMs, "trial draft.ackMs"),
    firstActivityMs: numberValue(draft.firstActivityMs, "trial draft.firstActivityMs"),
    maximumActivityGapMs: numberValue(
      draft.maximumActivityGapMs,
      "trial draft.maximumActivityGapMs",
    ),
    cancelAckMs: numberValue(draft.cancelAckMs, "trial draft.cancelAckMs"),
    substantiveResponseMs: numberValue(
      draft.substantiveResponseMs,
      "trial draft.substantiveResponseMs",
    ),
    instructionCoveragePercent: numberValue(
      draft.instructionCoveragePercent,
      "trial draft.instructionCoveragePercent",
    ),
    recentRecallTop3: booleanValue(draft.recentRecallTop3, "trial draft.recentRecallTop3"),
    missionContinuity: booleanValue(draft.missionContinuity, "trial draft.missionContinuity"),
    completionProofValid: booleanValue(
      draft.completionProofValid,
      "trial draft.completionProofValid",
    ),
    layoutVisible: booleanValue(draft.layoutVisible, "trial draft.layoutVisible"),
    peakCpuPercent: numberValue(draft.peakCpuPercent, "trial draft.peakCpuPercent"),
    peakMemoryGb: numberValue(draft.peakMemoryGb, "trial draft.peakMemoryGb"),
    thermalPressure: thermalPressure as ControlDirectorModelEvalTrial["thermalPressure"],
    evidenceRefs: Array.isArray(draft.evidenceRefs)
      ? draft.evidenceRefs.map((entry, index) =>
          stringValue(entry, `trial draft.evidenceRefs[${index}]`),
        )
      : [],
  } satisfies Omit<ControlDirectorModelEvalTrial, "runtimeReceipt">;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(trial.trialId)) {
    throw new Error("trial draft.trialId must use 1-128 prompt-safe identifier characters.");
  }
  const telemetry = object(receiptDraft.telemetry, "trial draft.runtimeReceipt.telemetry");
  const artifacts = Array.isArray(receiptDraft.artifacts)
    ? receiptDraft.artifacts.map((entry, index) => {
        const artifact = object(entry, `trial draft.runtimeReceipt.artifacts[${index}]`);
        return {
          evidenceRef: stringValue(
            artifact.evidenceRef,
            `trial draft.runtimeReceipt.artifacts[${index}].evidenceRef`,
          ),
          path: stringValue(artifact.path, `trial draft.runtimeReceipt.artifacts[${index}].path`),
          sha256: stringValue(
            artifact.sha256,
            `trial draft.runtimeReceipt.artifacts[${index}].sha256`,
          ),
        };
      })
    : [];
  const receiptBase = {
    schema: receiptDraft.schema as ControlDirectorModelEvalTrial["runtimeReceipt"]["schema"],
    sourceSha: stringValue(receiptDraft.sourceSha, "trial draft.runtimeReceipt.sourceSha"),
    configurationDigest: stringValue(
      receiptDraft.configurationDigest,
      "trial draft.runtimeReceipt.configurationDigest",
    ),
    activeReleaseId: stringValue(
      receiptDraft.activeReleaseId,
      "trial draft.runtimeReceipt.activeReleaseId",
    ),
    rollbackReleaseId: stringValue(
      receiptDraft.rollbackReleaseId,
      "trial draft.runtimeReceipt.rollbackReleaseId",
    ),
    leaseOwner: stringValue(receiptDraft.leaseOwner, "trial draft.runtimeReceipt.leaseOwner"),
    approvalId: stringValue(receiptDraft.approvalId, "trial draft.runtimeReceipt.approvalId"),
    operationId: stringValue(receiptDraft.operationId, "trial draft.runtimeReceipt.operationId"),
    invocationId: stringValue(receiptDraft.invocationId, "trial draft.runtimeReceipt.invocationId"),
    campaignNonce: stringValue(
      receiptDraft.campaignNonce,
      "trial draft.runtimeReceipt.campaignNonce",
    ),
    judgeAgentId: stringValue(receiptDraft.judgeAgentId, "trial draft.runtimeReceipt.judgeAgentId"),
    capturedAt: stringValue(receiptDraft.capturedAt, "trial draft.runtimeReceipt.capturedAt"),
    startedAt: stringValue(receiptDraft.startedAt, "trial draft.runtimeReceipt.startedAt"),
    endedAt: stringValue(receiptDraft.endedAt, "trial draft.runtimeReceipt.endedAt"),
    telemetry: {
      path: stringValue(telemetry.path, "trial draft.runtimeReceipt.telemetry.path"),
      sha256: stringValue(telemetry.sha256, "trial draft.runtimeReceipt.telemetry.sha256"),
    },
    artifacts,
  };
  const expectedCampaignNonce = buildControlDirectorModelEvalCampaignNonce({
    sourceSha: args.sourceSha,
    activeReleaseId: args.certification.get("active-release-id")!,
    invocationId: args.certification.get("invocation-id")!,
  });
  if (
    trial.modelRef !== args.modelRef ||
    receiptBase.schema !== CONTROL_DIRECTOR_MODEL_EVAL_TRIAL_RECEIPT_SCHEMA ||
    receiptBase.sourceSha !== args.sourceSha ||
    receiptBase.configurationDigest !== args.configurationDigest ||
    receiptBase.campaignNonce !== expectedCampaignNonce ||
    receiptBase.activeReleaseId !== args.certification.get("active-release-id") ||
    receiptBase.rollbackReleaseId !== args.certification.get("rollback-release-id") ||
    receiptBase.leaseOwner !== args.certification.get("lease-owner") ||
    receiptBase.approvalId !== args.certification.get("approval-id") ||
    receiptBase.operationId !== args.certification.get("operation-id") ||
    receiptBase.invocationId !== args.certification.get("invocation-id") ||
    receiptBase.judgeAgentId !== args.certification.get("judge-agent-id")
  ) {
    throw new Error("Trial draft does not match the exact certification identities.");
  }
  const startedAtMs = Date.parse(receiptBase.startedAt);
  const endedAtMs = Date.parse(receiptBase.endedAt);
  const capturedAtMs = Date.parse(receiptBase.capturedAt);
  const leaseAcquiredAtMs = Date.parse(args.certification.get("lease-acquired-at")!);
  if (
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(endedAtMs) ||
    !Number.isFinite(capturedAtMs) ||
    startedAtMs < leaseAcquiredAtMs ||
    endedAtMs < startedAtMs ||
    capturedAtMs < endedAtMs ||
    new Set(trial.evidenceRefs).size !== trial.evidenceRefs.length ||
    new Set(artifacts.map((artifact) => artifact.evidenceRef)).size !== artifacts.length ||
    [...trial.evidenceRefs].toSorted().join("\n") !==
      artifacts
        .map((artifact) => artifact.evidenceRef)
        .toSorted()
        .join("\n") ||
    !readArtifact(receiptBase.telemetry)
  ) {
    throw new Error("Trial draft does not contain valid lease-bounded runtime evidence.");
  }
  const measurementReceiptSha256 = digestControlDirectorModelEvalTrialMeasurementReceipt(
    trial,
    receiptBase,
  );
  const claim = buildControlDirectorModelTrialJudgeClaim({
    trial,
    campaignNonce: expectedCampaignNonce,
    receiptSha256: measurementReceiptSha256,
  });
  const judgeReceipt = await issueControlDirectorModelTrialJudgeReceipt({
    claim,
    campaignNonce: expectedCampaignNonce,
    trialId: trial.trialId,
    trialModelRef: trial.modelRef,
    trialModelIdentity: args.modelIdentity,
    sourceSha: args.sourceSha,
    rollbackSha: args.rollbackSha,
    activeReleaseId: receiptBase.activeReleaseId,
    rollbackReleaseId: receiptBase.rollbackReleaseId,
    leaseOwner: receiptBase.leaseOwner,
    approvalId: receiptBase.approvalId,
    operationId: receiptBase.operationId,
    invocationId: receiptBase.invocationId,
    measurementReceiptSha256,
    measurementSetSha256: digestControlDirectorModelTrialMeasurementSet(trial),
    evidenceSetSha256: digestControlDirectorModelTrialEvidenceSet(artifacts),
    measurementSources: issueArtifactSources(trial, artifacts, readArtifact),
    evidenceArtifacts: issueEvidenceArtifacts(artifacts, readArtifact),
    artifactRoot: args.artifactRoot,
  });
  if (judgeReceipt.judgeAgentId !== args.certification.get("judge-agent-id")) {
    throw new Error("Configured Judge identity does not match certification authorization.");
  }
  const receiptWithoutDigest = {
    ...receiptBase,
    measurementReceiptSha256,
    judgeReceipt,
  };
  const signedEnvelope = signControlDirectorModelTrialEnvelope({
    trial,
    receipt: receiptWithoutDigest,
  });
  const completed = {
    ...trial,
    runtimeReceipt: {
      ...receiptWithoutDigest,
      receiptSha256: signedEnvelope.receiptSha256,
      publicKeyId: signedEnvelope.publicKeyId,
      signature: signedEnvelope.signature,
    },
  };
  const [parsed] = parseControlDirectorModelEvalTrials([completed]);
  fs.mkdirSync(path.dirname(args.outputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(args.outputPath, `${JSON.stringify(parsed, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`${args.outputPath}\n`);
}

async function main() {
  const args = parse(process.argv.slice(2));
  const readArtifact = artifactReader(args);
  if (args.mode === "issue-trial") {
    await issueTrial(args, readArtifact);
    return;
  }
  const trials = parseControlDirectorModelEvalTrials(
    JSON.parse(fs.readFileSync(args.inputPath, "utf8")),
  );
  const { judgePublicKeyPem, judgePublicKeyId } = judgeKey();
  const matrix = buildControlDirectorModelEvalMatrix({
    trials,
    sourceSha: args.sourceSha,
    configurationDigest: args.configurationDigest,
    modelRef: args.modelRef,
    modelIdentity: args.modelIdentity,
    certification: {
      activeReleaseId: args.certification.get("active-release-id")!,
      rollbackReleaseId: args.certification.get("rollback-release-id")!,
      leaseOwner: args.certification.get("lease-owner")!,
      approvalId: args.certification.get("approval-id")!,
      operationId: args.certification.get("operation-id")!,
      invocationId: args.certification.get("invocation-id")!,
      judgeAgentId: args.certification.get("judge-agent-id")!,
      judgePublicKeyPem,
      judgePublicKeyId,
      leaseAcquiredAt: args.certification.get("lease-acquired-at")!,
    },
    verifyArtifact: (artifact) => readArtifact(artifact) !== undefined,
    readArtifact,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Control Director model eval: ${matrix.passed ? "PASS" : "FAIL"}; ${matrix.passRate}% trials; ${matrix.criticalOmissions} critical omissions.\n`,
    );
  }
  process.exitCode = matrix.passed ? 0 : 1;
}

await main();
