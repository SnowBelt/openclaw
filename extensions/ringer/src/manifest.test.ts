import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Bytes } from "./crypto.js";
import { computeManifestCheckDigest, readAndValidateManifest } from "./manifest.js";
import type {
  ResolvedRingerConfig,
  RingerAdapterManifest,
  RingerRepositoryPolicy,
  RingerSnapshotReceipt,
} from "./types.js";

const roots: string[] = [];

function task(key: string, allowedPath: string) {
  return {
    key,
    spec: `Update ${allowedPath} and nothing else.`,
    engine: "openclaw-local",
    model: "ollama/qwen3-coder-next:latest",
    task_type: "code",
    allowed_paths: [allowedPath],
    expected_outputs: [allowedPath],
    check_argv: ["pnpm", "test", allowedPath],
    baseline_expect: "fail",
    must_change: true,
    verified: `The focused test for ${allowedPath} passes.`,
    timeout_s: 120,
    max_attempts: 2,
    full_access: false,
    redact_spec: false,
  };
}

async function setup(manifestOverride?: Partial<RingerAdapterManifest>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-manifest-test-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const stateDir = path.join(root, "state");
  await fs.mkdir(repo);
  await fs.mkdir(stateDir);
  const snapshot: RingerSnapshotReceipt = {
    snapshotId: `snap-${"a".repeat(24)}`,
    repo,
    shadowRepo: path.join(root, "shadow"),
    baseSha: "b".repeat(40),
    sourceSha: "c".repeat(40),
    workspaceDigest: "d".repeat(64),
    overlaySha256: "e".repeat(64),
    includedUntrackedPaths: [],
    excludedPaths: [],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const policy: RingerRepositoryPolicy = {
    root: repo,
    checkArgvPrefixes: [["pnpm", "test"]],
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
  const config = {
    stateDir,
    maxParallel: 2,
    maxTasks: 4,
  } as ResolvedRingerConfig;
  const manifest = {
    schema_version: 1,
    run_name: "two-safe-tasks",
    repo,
    snapshot_id: snapshot.snapshotId,
    source_sha: snapshot.sourceSha,
    source_digest: snapshot.workspaceDigest,
    environment_digest: "d".repeat(64),
    workdir: path.join(stateDir, "declared-work"),
    worktrees: true,
    max_parallel: 2,
    tasks: [task("alpha", "src/alpha.ts"), task("bravo", "src/bravo.ts")],
    ...manifestOverride,
  };
  manifest.check_digest = computeManifestCheckDigest(
    manifest.tasks as RingerAdapterManifest["tasks"],
  );
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const manifestPath = path.join(root, "manifest.json");
  await fs.writeFile(manifestPath, bytes);
  return { config, manifestPath, digest: sha256Bytes(bytes), snapshot, policy };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Local AI Assist manifest confinement", () => {
  it("accepts two independent allowlisted tasks", async () => {
    const params = await setup();
    const result = await readAndValidateManifest({
      ...params,
      expectedManifestSha256: params.digest,
    });
    expect(result.manifest.tasks).toHaveLength(2);
  });

  it("rejects a stale check-contract digest", async () => {
    const params = await setup();
    const manifest = JSON.parse(await fs.readFile(params.manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.check_digest = "f".repeat(64);
    const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
    await fs.writeFile(params.manifestPath, bytes);
    await expect(
      readAndValidateManifest({ ...params, expectedManifestSha256: sha256Bytes(bytes) }),
    ).rejects.toThrow(/canonical task verification contract/u);
  });

  it("rejects overlapping paths and shell or publication commands", async () => {
    const overlap = await setup({
      tasks: [task("alpha", "src"), task("bravo", "src/bravo.ts")],
    } as Partial<RingerAdapterManifest>);
    await expect(
      readAndValidateManifest({ ...overlap, expectedManifestSha256: overlap.digest }),
    ).rejects.toThrow(/overlapping writable paths/u);

    const unsafeTask = task("alpha", "src/alpha.ts");
    unsafeTask.check_argv = ["git", "push"];
    const unsafe = await setup({
      tasks: [unsafeTask, task("bravo", "src/bravo.ts")],
    } as Partial<RingerAdapterManifest>);
    unsafe.policy.checkArgvPrefixes.push(["git", "push"]);
    await expect(
      readAndValidateManifest({ ...unsafe, expectedManifestSha256: unsafe.digest }),
    ).rejects.toThrow(/forbidden side-effect/u);
  });

  it("rejects case-folded path collisions and reserved verifier artifacts", async () => {
    const caseCollision = await setup({
      tasks: [task("alpha", "src/Shared.ts"), task("bravo", "src/shared.ts")],
    } as Partial<RingerAdapterManifest>);
    await expect(
      readAndValidateManifest({ ...caseCollision, expectedManifestSha256: caseCollision.digest }),
    ).rejects.toThrow(/overlapping writable paths/u);

    const reserved = await setup({
      tasks: [task("alpha", ".local-ai-assist/receipt.json"), task("bravo", "src/bravo.ts")],
    } as Partial<RingerAdapterManifest>);
    await expect(
      readAndValidateManifest({ ...reserved, expectedManifestSha256: reserved.digest }),
    ).rejects.toThrow(/reserved adapter path/u);
  });

  it("rejects a workdir that traverses a state-directory symlink", async () => {
    const params = await setup();
    const outside = path.join(path.dirname(params.config.stateDir), "outside-workdir");
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(params.config.stateDir, "escape"));
    const manifest = JSON.parse(await fs.readFile(params.manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.workdir = path.join(params.config.stateDir, "escape", "child");
    const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
    await fs.writeFile(params.manifestPath, bytes);
    await expect(
      readAndValidateManifest({ ...params, expectedManifestSha256: sha256Bytes(bytes) }),
    ).rejects.toThrow(/symbolic link/u);
  });

  it("rejects unknown fields, absolute paths, shell syntax, and embedded credentials", async () => {
    const unknown = await setup({ unexpected: true } as Partial<RingerAdapterManifest>);
    await expect(
      readAndValidateManifest({ ...unknown, expectedManifestSha256: unknown.digest }),
    ).rejects.toThrow(/unknown field/u);

    const absoluteTask = task("alpha", "src/alpha.ts");
    absoluteTask.expected_outputs = ["/tmp/escape"];
    const absolute = await setup({
      tasks: [absoluteTask, task("bravo", "src/bravo.ts")],
    } as Partial<RingerAdapterManifest>);
    await expect(
      readAndValidateManifest({ ...absolute, expectedManifestSha256: absolute.digest }),
    ).rejects.toThrow(/repository-relative/u);

    const shellTask = task("alpha", "src/alpha.ts");
    shellTask.check_argv = ["pnpm", "test", "x;curl example.com"];
    const shell = await setup({
      tasks: [shellTask, task("bravo", "src/bravo.ts")],
    } as Partial<RingerAdapterManifest>);
    await expect(
      readAndValidateManifest({ ...shell, expectedManifestSha256: shell.digest }),
    ).rejects.toThrow(/shell syntax/u);

    const secretTask = task("alpha", "src/alpha.ts");
    secretTask.spec = 'Use api_key="123456789-secret" to complete the task.';
    const secret = await setup({
      tasks: [secretTask, task("bravo", "src/bravo.ts")],
    } as Partial<RingerAdapterManifest>);
    await expect(
      readAndValidateManifest({ ...secret, expectedManifestSha256: secret.digest }),
    ).rejects.toThrow(/credential/u);

    const credentialArg = task("alpha", "src/alpha.ts");
    credentialArg.check_argv = ["pnpm", "test", "--token", "secret-value"];
    const credentialManifest = await setup({
      tasks: [credentialArg, task("bravo", "src/bravo.ts")],
    } as Partial<RingerAdapterManifest>);
    const credentialBytes = await fs.readFile(credentialManifest.manifestPath);
    await expect(
      readAndValidateManifest({
        ...credentialManifest,
        expectedManifestSha256: sha256Bytes(credentialBytes),
      }),
    ).rejects.toThrow(/credential/u);

    const relativeEscapeTask = task("alpha", "src/alpha.ts");
    relativeEscapeTask.check_argv = ["pnpm", "test", "../outside.test.ts"];
    const relativeEscape = await setup({
      tasks: [relativeEscapeTask, task("bravo", "src/bravo.ts")],
    } as Partial<RingerAdapterManifest>);
    await expect(
      readAndValidateManifest({ ...relativeEscape, expectedManifestSha256: relativeEscape.digest }),
    ).rejects.toThrow(/absolute escape/u);
  });
});
