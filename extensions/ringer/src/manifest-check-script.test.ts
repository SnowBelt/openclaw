import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { WORKER_SCRIPT_PATH, VERIFIER_SCRIPT_PATH } from "./assets.js";
import { materializeNativeManifest } from "./manifest.js";
import type {
  ResolvedRingerConfig,
  RingerAdapterManifest,
  RingerRepositoryPolicy,
  RingerSnapshotReceipt,
} from "./types.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Local AI Assist check confinement", () => {
  it("rejects a Node check script that is absent from the immutable snapshot", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-check-script-test-"));
    roots.push(root);
    const repo = path.join(root, "repo");
    const stateDir = path.join(root, "state");
    await fs.mkdir(repo, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });
    await execFileAsync("git", ["-C", repo, "init", "-q"]);
    await fs.writeFile(path.join(repo, "alpha.txt"), "before\n");
    await fs.writeFile(path.join(repo, "bravo.txt"), "before\n");
    await execFileAsync("git", ["-C", repo, "add", "."]);
    await execFileAsync("git", [
      "-C",
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-qm",
      "base",
    ]);
    const { stdout } = await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"]);
    const sourceSha = stdout.trim();
    const snapshot: RingerSnapshotReceipt = {
      snapshotId: `snap-${"a".repeat(24)}`,
      repo,
      shadowRepo: repo,
      baseSha: sourceSha,
      sourceSha,
      workspaceDigest: "b".repeat(64),
      overlaySha256: "c".repeat(64),
      includedUntrackedPaths: [],
      excludedPaths: [],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const config = {
      stateDir,
      openclawCliPath: process.execPath,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      dockerHost: "unix:///var/run/docker.sock",
      dockerImage: "unused-by-test",
      maxPatchBytes: 1024 * 1024,
    } as ResolvedRingerConfig;
    const policy: RingerRepositoryPolicy = {
      root: repo,
      checkArgvPrefixes: [[process.execPath, "scripts/check.mjs"]],
      models: [
        {
          ref: "ollama/qwen3-coder-next:latest",
          contextWindow: 32_768,
          maxTokens: 4_096,
          roles: ["code"],
          canaryApproved: false,
        },
      ],
    };
    const task = (key: string) => ({
      key,
      spec: `Change only ${key}.txt.`,
      engine: "openclaw-local" as const,
      model: "ollama/qwen3-coder-next:latest",
      task_type: "code" as const,
      allowed_paths: [`${key}.txt`],
      expected_outputs: [`${key}.txt`],
      check_argv: [process.execPath, "scripts/check.mjs", `${key}.txt`],
      baseline_expect: "fail" as const,
      must_change: true,
      verified: "The focused fixture check passes.",
      timeout_s: 60,
      max_attempts: 1 as const,
      full_access: false as const,
      redact_spec: false,
    });
    const manifest: RingerAdapterManifest = {
      schema_version: 1,
      run_name: "missing-check-script",
      repo,
      snapshot_id: snapshot.snapshotId,
      source_sha: sourceSha,
      source_digest: snapshot.workspaceDigest,
      check_digest: "d".repeat(64),
      environment_digest: "e".repeat(64),
      workdir: path.join(stateDir, "workdir"),
      worktrees: true,
      max_parallel: 1,
      tasks: [task("alpha"), task("bravo")],
    };

    await expect(
      materializeNativeManifest({
        config,
        manifest,
        snapshot,
        policy,
        preparationDir: path.join(stateDir, "preparation"),
        workerScriptPath: WORKER_SCRIPT_PATH,
        verifierScriptPath: VERIFIER_SCRIPT_PATH,
        nodePath: process.execPath,
      }),
    ).rejects.toThrow(/check script is missing from the immutable snapshot/u);
  });
});
