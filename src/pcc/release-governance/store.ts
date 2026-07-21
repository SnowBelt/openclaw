import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RELEASE_GOVERNANCE_STATUS_SCHEMA,
  type ReleaseEvidenceBundle,
  type ReleaseGovernanceStatus,
} from "./contracts.js";
import { canonicalReleaseJson, releaseGovernanceStatusFromBundle } from "./evidence.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

function stateRoot(env: NodeJS.ProcessEnv): string {
  return env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw", "state");
}

export function releaseGovernanceDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateRoot(env), "pcc", "release-governance");
}

export function releaseGovernanceStatusPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(releaseGovernanceDirectory(env), "status.json");
}

function privateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
  fs.chmodSync(directory, DIRECTORY_MODE);
}

function atomicPrivateWrite(target: string, contents: string): void {
  privateDirectory(path.dirname(target));
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, contents, { encoding: "utf8", mode: FILE_MODE });
  fs.renameSync(temporary, target);
  fs.chmodSync(target, FILE_MODE);
}

export function writeReleaseEvidenceBundle(
  bundle: ReleaseEvidenceBundle,
  env: NodeJS.ProcessEnv = process.env,
): { evidencePath: string; statusPath: string } {
  const directory = releaseGovernanceDirectory(env);
  const evidencePath = path.join(
    directory,
    `${bundle.facts.candidateSha}-${bundle.evaluation.decision.operation}.json`,
  );
  atomicPrivateWrite(evidencePath, canonicalReleaseJson(bundle));
  const status = { ...releaseGovernanceStatusFromBundle(bundle), evidencePath };
  const statusPath = releaseGovernanceStatusPath(env);
  atomicPrivateWrite(statusPath, canonicalReleaseJson(status));
  return { evidencePath, statusPath };
}

export function readReleaseGovernanceStatus(
  env: NodeJS.ProcessEnv = process.env,
): ReleaseGovernanceStatus | null {
  const target = releaseGovernanceStatusPath(env);
  if (!fs.existsSync(target)) {
    return null;
  }
  try {
    const value = JSON.parse(fs.readFileSync(target, "utf8")) as Partial<ReleaseGovernanceStatus>;
    return value.schema === RELEASE_GOVERNANCE_STATUS_SCHEMA
      ? (value as ReleaseGovernanceStatus)
      : null;
  } catch {
    return null;
  }
}
