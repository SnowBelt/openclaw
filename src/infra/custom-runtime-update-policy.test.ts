import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CUSTOM_RUNTIME_UPDATE_BROKER_REQUIRED_REASON,
  resolveCustomRuntimeUpdatePolicy,
} from "./custom-runtime-update-policy.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(sourceSha = "a".repeat(40)) {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-policy-"));
  temporaryDirectories.push(homedir);
  const runtimeRoot = path.join(homedir, ".openclaw-runtime-releases", "candidate");
  const pointerPath = path.join(homedir, ".openclaw-custom-runtime", "active-runtime.json");
  fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
  fs.writeFileSync(
    pointerPath,
    `${JSON.stringify({
      runtimeRoot,
      entrypoint: path.join(runtimeRoot, "dist", "index.js"),
      sourceSha,
      sourceRepo: path.join(homedir, "source"),
      sourceBranch: "codex/custom-runtime",
    })}\n`,
  );
  return { homedir, pointerPath, runtimeRoot };
}

describe("custom runtime update policy", () => {
  it("blocks generic updates for the active immutable runtime", () => {
    const value = fixture();
    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result).toMatchObject({
      managedRuntime: true,
      standardUpdateBlocked: true,
      sourceDurable: true,
      sourceSha: "a".repeat(40),
      sourceBranch: "codex/custom-runtime",
      runtimeRoot: value.runtimeRoot,
    });
    expect(CUSTOM_RUNTIME_UPDATE_BROKER_REQUIRED_REASON).toBe(
      "custom-runtime-update-broker-required",
    );
  });

  it("does not block an unrelated source checkout with a stale pointer", () => {
    const value = fixture();
    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", "/workspace/openclaw/dist/index.js"],
      env: {},
    });

    expect(result.managedRuntime).toBe(false);
    expect(result.standardUpdateBlocked).toBe(false);
  });

  it("marks provenance hashes as non-durable sources", () => {
    const value = fixture("b".repeat(64));
    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.standardUpdateBlocked).toBe(true);
    expect(result.sourceDurable).toBe(false);
  });
});
