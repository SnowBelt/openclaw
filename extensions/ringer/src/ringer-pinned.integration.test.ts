import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { WORKER_SCRIPT_PATH, VERIFIER_SCRIPT_PATH } from "./assets.js";
import { materializeNativeManifest } from "./manifest.js";
import { renderPinnedRingerConfig } from "./pins.js";
import type {
  ResolvedRingerConfig,
  RingerAdapterManifest,
  RingerRepositoryPolicy,
  RingerSnapshotReceipt,
} from "./types.js";

const execFileAsync = promisify(execFile);
const sourceDir = process.env.OPENCLAW_RINGER_SOURCE_DIR;
const roots: string[] = [];

async function execWithDetails(
  file: string,
  args: string[],
  options: Parameters<typeof execFileAsync>[2],
) {
  try {
    return await execFileAsync(file, args, options);
  } catch (error) {
    const detail = error as Error & { stdout?: string; stderr?: string };
    throw new Error(
      `${detail.message}\nstdout:\n${detail.stdout ?? ""}\nstderr:\n${detail.stderr ?? ""}`,
      { cause: error },
    );
  }
}

async function git(repo: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", repo, ...args]);
  return result.stdout.trim();
}

afterAll(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe.runIf(Boolean(sourceDir))("exact-pinned Ringer lifecycle", () => {
  it("runs lint, dry-run, baseline, two mock workers, harvest, and passing cleanup", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-pinned-integration-"));
    roots.push(root);
    const repo = path.join(root, "repo");
    const stateDir = path.join(root, "state");
    const preparationDir = path.join(stateDir, "preparation");
    await fs.mkdir(path.join(repo, "scripts"), { recursive: true });
    await git(repo, "init", "-q");
    await fs.writeFile(path.join(repo, "alpha.txt"), "before\n");
    await fs.writeFile(path.join(repo, "bravo.txt"), "before\n");
    await fs.writeFile(
      path.join(repo, "scripts", "check.mjs"),
      'import fs from "node:fs"; process.exit(fs.readFileSync(process.argv[2], "utf8") === "after\\n" ? 0 : 1);\n',
    );
    await git(repo, "add", ".");
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
    const sourceSha = await git(repo, "rev-parse", "HEAD");
    const mockCli = path.join(root, "openclaw-mock.mjs");
    await fs.writeFile(
      mockCli,
      `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
const session = args[args.indexOf("--session-id") + 1];
const key = session.includes("alpha") ? "alpha" : "bravo";
fs.writeFileSync(key + ".txt", "after\\n");
process.stdout.write(JSON.stringify({payloads:[{text:"changed " + key}],meta:{agentMeta:{provider:"ollama",model:"qwen3-coder-next:latest"}}}));
`,
      { mode: 0o700 },
    );
    await fs.chmod(mockCli, 0o700);
    const config = {
      stateDir,
      ringerSourceDir: sourceDir,
      ringerConfigPath: path.join(root, "ringer.toml"),
      openclawCliPath: mockCli,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      dockerHost: "unix:///var/run/docker.sock",
      dockerImage: "unused-by-mock",
      maxParallel: 2,
      maxTasks: 4,
      maxPatchBytes: 1024 * 1024,
    } as ResolvedRingerConfig;
    await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(config.ringerConfigPath!, renderPinnedRingerConfig({ stateDir }), {
      mode: 0o600,
    });
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
    const tasks = ["alpha", "bravo"].map((key) => ({
      key,
      spec: `Change only ${key}.txt from the current before fixture to the exact text after followed by one newline. Do not edit any other path.`,
      engine: "openclaw-local" as const,
      model: "ollama/qwen3-coder-next:latest",
      task_type: "code" as const,
      allowed_paths: [`${key}.txt`],
      expected_outputs: [`${key}.txt`],
      check_argv: [process.execPath, "scripts/check.mjs", `${key}.txt`],
      baseline_expect: "fail" as const,
      must_change: true,
      verified: `${key} fixture check passes.`,
      timeout_s: 60,
      max_attempts: 2 as const,
      full_access: false as const,
      redact_spec: false,
    }));
    const manifest: RingerAdapterManifest = {
      schema_version: 1,
      run_name: "openclaw-pinned-mock",
      repo,
      snapshot_id: `snap-${"a".repeat(24)}`,
      source_sha: sourceSha,
      source_digest: "b".repeat(64),
      check_digest: "c".repeat(64),
      environment_digest: "d".repeat(64),
      workdir: path.join(stateDir, "declared-work"),
      worktrees: true,
      max_parallel: 2,
      tasks,
    };
    for (const key of ["alpha", "bravo"]) {
      const workerStateRoot = path.join(preparationDir, "workers", key);
      await fs.mkdir(workerStateRoot, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(workerStateRoot, "worker.json"), "stale\n", { mode: 0o600 });
    }
    const snapshot = {
      snapshotId: manifest.snapshot_id,
      repo,
      shadowRepo: repo,
      baseSha: sourceSha,
      sourceSha,
      workspaceDigest: manifest.source_digest,
      overlaySha256: "c".repeat(64),
      includedUntrackedPaths: [],
      excludedPaths: [],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } satisfies RingerSnapshotReceipt;
    const native = await materializeNativeManifest({
      config,
      manifest,
      snapshot,
      policy,
      preparationDir,
      workerScriptPath: WORKER_SCRIPT_PATH,
      verifierScriptPath: VERIFIER_SCRIPT_PATH,
      nodePath: process.execPath,
    });
    for (const key of ["alpha", "bravo"]) {
      await expect(
        fs.access(path.join(preparationDir, "workers", key, "worker.json")),
      ).rejects.toThrow();
    }
    const nativeManifest = JSON.parse(await fs.readFile(native.nativeManifestPath, "utf8")) as {
      tasks: Array<{ check: string }>;
    };
    for (const task of nativeManifest.tasks) {
      expect(task.check).not.toContain(path.join(preparationDir, "contracts"));
      expect(task.check).not.toMatch(/[;&|`$<>]/u);
      expect(task.check).toMatch(
        new RegExp(`${path.basename(VERIFIER_SCRIPT_PATH)}' '[a-f0-9-]{36}'$`, "u"),
      );
    }
    const ringerScript = path.join(sourceDir!, "ringer.py");
    const common = [ringerScript, "--config", config.ringerConfigPath!, "--no-self-update"];
    const env = {
      HOME: path.join(root, "home"),
      PATH: process.env.PATH,
      TMPDIR: os.tmpdir(),
      LANG: "C.UTF-8",
      RINGER_NO_SELF_UPDATE: "1",
      RINGER_NO_CATALOG_REFRESH: "1",
      LOCAL_AI_ASSIST_VERIFIER_ROOT: path.join(preparationDir, "contracts"),
    };
    await fs.mkdir(env.HOME, { recursive: true });
    await expect(
      execFileAsync("python3", [...common, "lint", native.nativeManifestPath], { env }),
    ).resolves.toBeTruthy();
    await expect(
      execFileAsync(
        "python3",
        [
          ...common,
          "run",
          native.nativeManifestPath,
          "--dry-run",
          "--no-dashboard",
          "--no-artifact",
        ],
        { env },
      ),
    ).resolves.toBeTruthy();
    const baseline = await execFileAsync(
      "python3",
      [
        ...common,
        "run",
        native.nativeManifestPath,
        "--baseline",
        "--no-dashboard",
        "--no-artifact",
      ],
      { env },
    );
    expect(baseline.stdout).toContain("baseline: 0 pass, 2 fail, 0 error");
    let run: Awaited<ReturnType<typeof execWithDetails>>;
    try {
      run = await execWithDetails(
        "python3",
        [...common, "run", native.nativeManifestPath, "--no-dashboard", "--no-artifact"],
        { env, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
      );
    } catch (error) {
      const logs = await Promise.all(
        ["alpha", "bravo"].map(async (key) => {
          try {
            return await fs.readFile(
              path.join(preparationDir, "worktrees", "logs", `${key}.worker.log`),
              "utf8",
            );
          } catch {
            return "";
          }
        }),
      );
      throw new Error(`${String(error)}\nworker logs:\n${logs.join("\n---\n")}`, {
        cause: error,
      });
    }
    const runStdout = String(run.stdout);
    const runId = /^run_id:\s*(\S+)\s*$/gmu.exec(runStdout)?.[1];
    expect(runId).toBeTruthy();
    expect(runStdout).toMatch(/alpha\s+pass\s+PASS\s+1/u);
    expect(runStdout).toMatch(/bravo\s+pass\s+PASS\s+1/u);
    for (const key of ["alpha", "bravo"]) {
      const artifactDir = path.join(stateDir, "upstream", "artifacts", "deliverables", runId!, key);
      expect(await fs.readFile(path.join(artifactDir, "changes.patch"), "utf8")).toContain(
        "+after",
      );
      await expect(fs.access(path.join(preparationDir, "worktrees", key))).rejects.toThrow();
    }
  }, 240_000);
});
