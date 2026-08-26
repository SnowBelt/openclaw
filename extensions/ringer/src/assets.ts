import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File } from "./crypto.js";

const sourceAssetsRoot = fileURLToPath(new URL("../assets/", import.meta.url));
const builtAssetsRoot = fileURLToPath(new URL("./assets/", import.meta.url));
const ASSETS_ROOT = existsSync(sourceAssetsRoot) ? sourceAssetsRoot : builtAssetsRoot;

export const WORKER_SCRIPT_PATH = path.join(ASSETS_ROOT, "openclaw-local-worker.mjs");
export const VERIFIER_SCRIPT_PATH = path.join(ASSETS_ROOT, "trusted-verifier.mjs");

export async function readAssetDigests(): Promise<{
  workerSha256: string;
  verifierSha256: string;
}> {
  return {
    workerSha256: await sha256File(WORKER_SCRIPT_PATH),
    verifierSha256: await sha256File(VERIFIER_SCRIPT_PATH),
  };
}

export async function assertAssetFilesPrivateFromMutation(): Promise<void> {
  for (const file of [WORKER_SCRIPT_PATH, VERIFIER_SCRIPT_PATH]) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Trusted adapter asset is not a regular file: ${file}`);
    }
    if ((stat.mode & 0o022) !== 0) {
      throw new Error(`Trusted adapter asset is group/world writable: ${file}`);
    }
  }
}
