// SAFETY-RATCHET: template-aware
import fs from "node:fs/promises";
import path from "node:path";
import { gatePath, parseGateReceipt, readJson } from "./controller-receipts.js";
import type { GateName, GateReceipt } from "./controller-receipts.js";
import { sha256File } from "./crypto.js";
import type { RingerSnapshotReceipt, RingerTaskManifest } from "./types.js";

export async function assertGate(params: {
  preparationDir: string;
  gate: GateName;
  manifestSha256: string;
  snapshot: RingerSnapshotReceipt;
  pinIdentity: string;
  tasks: RingerTaskManifest[];
}): Promise<void> {
  const { preparationDir, gate, manifestSha256, snapshot, pinIdentity, tasks } = params;
  const receiptFile = gatePath(preparationDir, gate);
  let receipt: GateReceipt;
  try {
    const stat = await fs.lstat(receiptFile);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw new Error("Gate receipt must be a private regular file.");
    }
    receipt = parseGateReceipt(await readJson<unknown>(receiptFile), gate);
    const outputFile = path.join(preparationDir, "gates", `${gate}.log`);
    const outputStat = await fs.lstat(outputFile);
    if (
      !outputStat.isFile() ||
      outputStat.isSymbolicLink() ||
      (outputStat.mode & 0o077) !== 0 ||
      (await sha256File(outputFile)) !== receipt.outputSha256
    ) {
      throw new Error("Gate output is missing, mutable, or digest-mismatched.");
    }
    if (gate === "baseline") {
      const baseline = receipt.baseline;
      if (!baseline) {
        throw new Error("Baseline gate receipt is missing task expectations.");
      }
      const expectedKeys = tasks.map((task) => task.key).toSorted();
      const actualKeys = Object.keys(baseline).toSorted();
      if (
        expectedKeys.length !== actualKeys.length ||
        expectedKeys.some((key, index) => key !== actualKeys[index]) ||
        tasks.some((task) => baseline[task.key] !== task.baseline_expect)
      ) {
        throw new Error("Baseline gate receipt does not match task expectations.");
      }
    }
  } catch (error) {
    throw new Error(
      `Required ${gate} gate has not completed for this exact manifest: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (
    receipt.manifestSha256 !== manifestSha256 ||
    receipt.snapshotId !== snapshot.snapshotId ||
    receipt.sourceSha !== snapshot.sourceSha ||
    receipt.pinsDigest !== pinIdentity
  ) {
    throw new Error(`Required ${gate} gate is stale or does not match current pins and source.`);
  }
}

export function parseAndValidateBaseline(
  output: string,
  tasks: RingerTaskManifest[],
): Record<string, "pass" | "fail"> {
  const observed: Record<string, "pass" | "fail"> = {};
  for (const line of output.split(/\r?\n/u)) {
    const match = /^([a-z0-9][a-z0-9_-]{0,47})\s+baseline:\s+(pass|FAIL|ERROR)\b/u.exec(line);
    if (!match) {
      continue;
    }
    const taskKey = match[1];
    const result = match[2];
    if (!taskKey || !result) {
      continue;
    }
    if (result === "ERROR") {
      throw new Error(`Baseline verifier error for ${taskKey}; dispatch is blocked.`);
    }
    observed[taskKey] = result === "pass" ? "pass" : "fail";
  }
  for (const task of tasks) {
    if (!observed[task.key]) {
      throw new Error(`Baseline output is missing a result for ${task.key}.`);
    }
    if (observed[task.key] !== task.baseline_expect) {
      throw new Error(
        `Baseline mismatch for ${task.key}: expected ${task.baseline_expect}, observed ${observed[task.key]}.`,
      );
    }
  }
  return observed;
}
