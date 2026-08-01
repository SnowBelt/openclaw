#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { summarizeControlDirectorProgress } from "./control-director-roadmap-proof.mjs";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const CLASSIFICATIONS = new Set(["required", "inherited", "superseded", "overlapping", "excluded"]);
const REQUIRED_SCRIPTS = [
  "control-director:preflight",
  "control-director:verify",
  "control-director:roadmap-proof",
  "control-director:readiness",
  "control-director:runtime-proof",
  "control-director:source-handoff",
  "custom-runtime:update-survival",
];
const REQUIRED_PROOF_SURFACES = [
  "targeted-tests",
  "format",
  "lint",
  "type",
  "build",
  "mac-studio-source-validation",
  "browser-mac-studio",
  "local-workflow-sanity",
  "managed-runtime",
  "rollback-restore",
  "soak",
];
const EXCLUSIONS = [
  "dependencies",
  "lockfiles",
  "product-version",
  "publishing",
  "secrets",
  "unrelated-files",
  "managed-runtime-without-exact-approval",
  "blacksmith",
  "testbox",
  "crabbox",
  "remote-execution",
];

function git(repoRoot, args, allowFailure = false) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return { output: result.stdout.trim(), status: result.status ?? 1 };
}

function parseArgs(argv) {
  const args = {
    acceptedHeads: [],
    classifications: [],
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") {
      continue;
    }
    if (key === "--json") {
      args.json = true;
      continue;
    }
    if (key === "--accepted-head" || key === "--classification") {
      const value = argv[++index];
      if (!value) {
        throw new Error(`Missing value for ${key}.`);
      }
      args[key === "--accepted-head" ? "acceptedHeads" : "classifications"].push(value);
      continue;
    }
    const field = {
      "--expected-sha": "expectedSha",
      "--active-sha": "activeSha",
      "--candidate-sha": "candidateSha",
      "--rollback-sha": "rollbackSha",
      "--base-tip-sha": "baseTipSha",
      "--reviewed-base-sha": "reviewedBaseSha",
    }[key];
    if (!field) {
      throw new Error(`Unknown argument: ${key ?? ""}`);
    }
    const value = argv[++index];
    if (!value) {
      throw new Error(`Missing value for ${key}.`);
    }
    args[field] = value.toLowerCase();
  }
  return args;
}

function splitAssignment(value, label) {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`${label} must use name=value.`);
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function addCheck(checks, id, passed, detail, fileHints = []) {
  checks.push({ detail, fileHints, id, passed });
}

export function evaluateControlDirectorPreflight(input) {
  const checks = [];
  addCheck(
    checks,
    "source-identity",
    SHA_PATTERN.test(input.headSha) && input.headSha === input.expectedSha,
    input.headSha === input.expectedSha
      ? `HEAD matches ${input.expectedSha}`
      : `HEAD ${input.headSha || "<missing>"} does not match ${input.expectedSha || "<missing>"}`,
  );
  addCheck(
    checks,
    "source-clean",
    input.sourceClean === true,
    input.sourceClean
      ? "source checkout is clean"
      : "source checkout has tracked or untracked changes",
  );
  addCheck(
    checks,
    "roadmap-schema",
    input.roadmapError === undefined,
    input.roadmapError ?? `roadmap exposes ${input.progress?.milestoneCount ?? 0} milestones`,
    ["work/control-director/reliability-v1/roadmap.json"],
  );
  const missingScripts = REQUIRED_SCRIPTS.filter((name) => !input.packageScripts.includes(name));
  addCheck(
    checks,
    "command-contract",
    missingScripts.length === 0,
    missingScripts.length === 0
      ? "all required repository commands are registered"
      : `missing package scripts: ${missingScripts.join(", ")}`,
    ["package.json"],
  );
  addCheck(
    checks,
    "mac-studio-local-proof-policy",
    input.macStudioLocalProofPolicy === true,
    input.macStudioLocalProofPolicy
      ? "Mac Studio-local exact-source proof is authoritative and remote execution is not required"
      : "roadmap does not enforce the Mac Studio-local-only proof policy",
    ["work/control-director/reliability-v1/roadmap.json"],
  );

  const lineage = input.lineage;
  const lineageFields = [
    "activeSha",
    "candidateSha",
    "rollbackSha",
    "baseTipSha",
    "reviewedBaseSha",
  ];
  const invalidLineage = lineageFields.filter((field) => !SHA_PATTERN.test(lineage[field] ?? ""));
  addCheck(
    checks,
    "lineage-identities",
    invalidLineage.length === 0,
    invalidLineage.length === 0
      ? "lineage identities are immutable SHAs"
      : `missing or invalid lineage fields: ${invalidLineage.join(", ")}`,
  );
  addCheck(
    checks,
    "base-tip",
    lineage.baseTipSha === lineage.reviewedBaseSha,
    lineage.baseTipSha === lineage.reviewedBaseSha
      ? "base tip matches the reviewed base"
      : "base tip moved after review",
  );
  addCheck(
    checks,
    "active-lineage",
    input.activeIsAncestor === true,
    input.activeIsAncestor
      ? "candidate descends from the exact active runtime"
      : "candidate does not descend from the exact active runtime",
  );

  const classifications = new Map(input.classifications.map((entry) => [entry.name, entry.value]));
  const missingAcceptedHeads = input.acceptedHeads.filter((head) => head.isAncestor !== true);
  const blockingMissingHeads = missingAcceptedHeads.filter((head) => {
    const classification = classifications.get(head.name);
    return !CLASSIFICATIONS.has(classification) || classification === "required";
  });
  addCheck(
    checks,
    "accepted-heads",
    blockingMissingHeads.length === 0,
    missingAcceptedHeads.length === 0
      ? "candidate contains every accepted runtime-intended head"
      : blockingMissingHeads.length === 0
        ? `non-ancestor heads have explicit semantic dispositions: ${missingAcceptedHeads
            .map((head) => `${head.name}=${classifications.get(head.name)}`)
            .join(", ")}`
        : `candidate omits required or unclassified accepted heads: ${blockingMissingHeads
            .map((head) => head.name)
            .join(", ")}`,
    blockingMissingHeads.flatMap((head) => head.files ?? []),
  );
  const unclassified = input.acceptedHeads
    .map((head) => head.name)
    .filter((name) => !CLASSIFICATIONS.has(classifications.get(name)));
  const invalidClassifications = input.classifications.filter(
    (entry) => !CLASSIFICATIONS.has(entry.value),
  );
  addCheck(
    checks,
    "semantic-inventory",
    unclassified.length === 0 && invalidClassifications.length === 0,
    unclassified.length === 0 && invalidClassifications.length === 0
      ? "every accepted head has a valid semantic classification"
      : `semantic inventory incomplete: ${[
          ...unclassified,
          ...invalidClassifications.map((entry) => entry.name),
        ].join(", ")}`,
    ["work/control-director/reliability-v1/continuation.md"],
  );

  const blockers = checks.filter((check) => !check.passed);
  const files = [...new Set(blockers.flatMap((check) => check.fileHints))].toSorted((left, right) =>
    left.localeCompare(right),
  );
  return {
    schema: "openclaw.control-director-preflight.v1",
    passed: blockers.length === 0,
    progress: input.progress,
    lineage: {
      ...lineage,
      acceptedHeads: input.acceptedHeads.map(({ isAncestor: _isAncestor, ...head }) => head),
    },
    checks,
    blockers: blockers.map(({ fileHints: _fileHints, ...blocker }) => blocker),
    remediationManifest: {
      approvalClass: "control-director-source-remediation",
      files,
      commands: [
        "pnpm control-director:preflight -- --json <exact-lineage-arguments>",
        "pnpm control-director:verify -- --expected-sha <candidate-sha>",
        "pnpm check:workflows",
        "OPENCLAW_LOCAL_CHECK=1 OPENCLAW_LOCAL_CHECK_MODE=full pnpm check",
        "OPENCLAW_LOCAL_CHECK=1 OPENCLAW_LOCAL_CHECK_MODE=full pnpm test",
        "pnpm build",
      ],
      exclusions: EXCLUSIONS,
      proofSurfaces: REQUIRED_PROOF_SURFACES,
    },
  };
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const args = parseArgs(process.argv.slice(2));
  const headSha = git(repoRoot, ["rev-parse", "HEAD"]).output.toLowerCase();
  const expectedSha = args.expectedSha ?? headSha;
  const candidateSha = args.candidateSha ?? headSha;
  const activeSha = args.activeSha ?? "";
  const rollbackSha = args.rollbackSha ?? activeSha;
  const baseTipSha = args.baseTipSha ?? "";
  const reviewedBaseSha = args.reviewedBaseSha ?? "";
  let progress;
  let roadmap;
  let roadmapError;
  try {
    roadmap = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "work", "control-director", "reliability-v1", "roadmap.json"),
        "utf8",
      ),
    );
    progress = summarizeControlDirectorProgress(roadmap);
  } catch (error) {
    roadmapError = error instanceof Error ? error.message : String(error);
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const acceptedHeads = args.acceptedHeads.map((entry) => {
    const [name, sha] = splitAssignment(entry, "--accepted-head");
    const isAncestor =
      SHA_PATTERN.test(sha) &&
      git(repoRoot, ["merge-base", "--is-ancestor", sha, candidateSha], true).status === 0;
    const mergeBase = SHA_PATTERN.test(sha)
      ? git(repoRoot, ["merge-base", sha, candidateSha], true).output
      : "";
    const files =
      SHA_PATTERN.test(mergeBase) && SHA_PATTERN.test(sha)
        ? git(repoRoot, ["diff", "--name-only", `${mergeBase}..${sha}`], true)
            .output.split(/\r?\n/u)
            .filter(Boolean)
            .toSorted((left, right) => left.localeCompare(right))
        : [];
    return { files, isAncestor, name, sha };
  });
  const classifications = args.classifications.map((entry) => {
    const [name, value] = splitAssignment(entry, "--classification");
    return { name, value };
  });
  const result = evaluateControlDirectorPreflight({
    headSha,
    expectedSha,
    sourceClean: git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]).output === "",
    progress,
    roadmapError,
    packageScripts: Object.keys(packageJson.scripts ?? {}),
    macStudioLocalProofPolicy:
      roadmap?.completionPolicy?.executionPlatform === "mac-studio" &&
      roadmap?.completionPolicy?.remoteExecutionRequired === false,
    lineage: { activeSha, baseTipSha, candidateSha, reviewedBaseSha, rollbackSha },
    activeIsAncestor:
      SHA_PATTERN.test(activeSha) &&
      git(repoRoot, ["merge-base", "--is-ancestor", activeSha, candidateSha], true).status === 0,
    acceptedHeads,
    classifications,
  });
  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  if (!result.passed) {
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
