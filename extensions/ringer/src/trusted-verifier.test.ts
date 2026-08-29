import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { VERIFIER_SCRIPT_PATH } from "./assets.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(repo: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", repo, ...args]);
}

async function setup(): Promise<{
  root: string;
  repo: string;
  contractPath: string;
  contractId: string;
  verifierRoot: string;
  workerReceiptPath: string;
  artifactOutputDir: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-verifier-test-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  await fs.mkdir(repo);
  await git(repo, "init", "-q");
  await fs.writeFile(path.join(repo, "output.txt"), "before\n");
  await git(repo, "add", "output.txt");
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
  const checkScript = path.join(root, "check.mjs");
  await fs.writeFile(
    checkScript,
    'import fs from "node:fs"; process.exit(fs.readFileSync("output.txt", "utf8") === "after\\n" ? 0 : 1);\n',
  );
  const contractId = "01234567-89ab-cdef-0123-456789abcdef";
  const verifierRoot = path.join(root, "contracts");
  const workerReceiptPath = path.join(root, "worker.json");
  await fs.mkdir(verifierRoot, { mode: 0o700 });
  const contractPath = path.join(verifierRoot, `${contractId}.verify.json`);
  const artifactOutputDir = path.join(root, "verified-artifacts");
  await fs.writeFile(
    contractPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        contractId,
        taskKey: "alpha",
        expectedTaskdir: repo,
        expectedGitCommonDir: path.join(repo, ".git"),
        workerReceiptPath,
        expectedModel: "ollama/qwen3-coder-next:latest",
        allowedPaths: ["output.txt"],
        expectedOutputs: ["output.txt"],
        checkArgv: [process.execPath, checkScript],
        checkTimeoutMs: 10_000,
        mustChange: true,
        maxPatchBytes: 1024 * 1024,
        artifactDirName: ".local-ai-assist",
        artifactOutputDir,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return {
    root,
    repo,
    contractPath,
    contractId,
    verifierRoot,
    workerReceiptPath,
    artifactOutputDir,
  };
}

function verifierEnv(verifierRoot: string): NodeJS.ProcessEnv {
  return { ...process.env, LOCAL_AI_ASSIST_VERIFIER_ROOT: verifierRoot };
}

function runVerifier(repo: string, verifierRoot: string, contractId: string) {
  return execFileAsync(process.execPath, [VERIFIER_SCRIPT_PATH, contractId], {
    cwd: repo,
    env: verifierEnv(verifierRoot),
  });
}

async function writeWorkerReceipt(file: string, model = "ollama/qwen3-coder-next:latest") {
  await fs.writeFile(
    file,
    `${JSON.stringify({
      schemaVersion: 1,
      taskKey: "alpha",
      model,
      sessionAttempts: 1,
      modelCompletions: 1,
      sessionRetries: 0,
      trajectorySha256: "a".repeat(64),
    })}\n`,
    { mode: 0o600 },
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("trusted Local AI Assist verifier", () => {
  it("captures a checked, allowlisted, identity-bound patch", async () => {
    const { repo, contractId, verifierRoot, workerReceiptPath, artifactOutputDir } = await setup();
    await fs.writeFile(path.join(repo, "output.txt"), "after\n");
    await writeWorkerReceipt(workerReceiptPath);
    await runVerifier(repo, verifierRoot, contractId);
    const patch = await fs.readFile(path.join(artifactOutputDir, "changes.patch"), "utf8");
    expect(patch).toContain("+after");
    const receipt = JSON.parse(
      await fs.readFile(path.join(artifactOutputDir, "receipt.json"), "utf8"),
    );
    expect(receipt).toMatchObject({
      status: "pass",
      model: "ollama/qwen3-coder-next:latest",
      changedFiles: ["output.txt"],
      sessionAttempts: 1,
      modelCompletions: 1,
      sessionRetries: 0,
    });
  });

  it("returns the declared check result in a clean baseline worktree", async () => {
    const { repo, contractId, verifierRoot } = await setup();
    await fs.writeFile(path.join(repo, "output.txt"), "after\n");
    await git(repo, "add", "output.txt");
    await execFileAsync("git", [
      "-C",
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-qm",
      "baseline",
    ]);
    const result = await runVerifier(repo, verifierRoot, contractId);
    expect(result.stdout).toContain("baseline check passed");
  });

  it("rejects changes outside allowed paths", async () => {
    const { repo, contractId, verifierRoot, workerReceiptPath } = await setup();
    await fs.writeFile(path.join(repo, "output.txt"), "after\n");
    await fs.writeFile(path.join(repo, "escape.txt"), "no\n");
    await writeWorkerReceipt(workerReceiptPath);
    await expect(runVerifier(repo, verifierRoot, contractId)).rejects.toMatchObject({
      stderr: expect.stringContaining("outside allowed_paths"),
    });
  });

  it("rejects unexpected generated files even under an allowed directory", async () => {
    const { repo, contractPath, contractId, verifierRoot, workerReceiptPath } = await setup();
    const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));
    contract.allowedPaths = ["output.txt", "src"];
    contract.checkArgv = [process.execPath, "-e", "process.exit(0)"];
    await fs.writeFile(contractPath, `${JSON.stringify(contract)}\n`, { mode: 0o600 });
    await fs.mkdir(path.join(repo, "src"));
    await fs.writeFile(path.join(repo, "src", "generated.txt"), "unexpected\n");
    await writeWorkerReceipt(workerReceiptPath);
    await expect(runVerifier(repo, verifierRoot, contractId)).rejects.toMatchObject({
      stderr: expect.stringContaining("unexpected changed output"),
    });
  });

  it("rejects no-op output, failed checks, model drift, binary changes, and oversized patches", async () => {
    const noOp = await setup();
    const noOpContract = JSON.parse(await fs.readFile(noOp.contractPath, "utf8"));
    noOpContract.checkArgv = [process.execPath, "-e", "process.exit(0)"];
    await fs.writeFile(noOp.contractPath, `${JSON.stringify(noOpContract)}\n`, { mode: 0o600 });
    await writeWorkerReceipt(noOp.workerReceiptPath);
    await expect(runVerifier(noOp.repo, noOp.verifierRoot, noOp.contractId)).rejects.toMatchObject({
      stderr: expect.stringContaining("must_change=true"),
    });

    const drift = await setup();
    await fs.writeFile(path.join(drift.repo, "output.txt"), "after\n");
    await writeWorkerReceipt(drift.workerReceiptPath, "ollama/other");
    await expect(
      runVerifier(drift.repo, drift.verifierRoot, drift.contractId),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("identity receipt") });

    const binary = await setup();
    const binaryContract = JSON.parse(await fs.readFile(binary.contractPath, "utf8"));
    binaryContract.checkArgv = [process.execPath, "-e", "process.exit(0)"];
    await fs.writeFile(binary.contractPath, `${JSON.stringify(binaryContract)}\n`, {
      mode: 0o600,
    });
    await fs.writeFile(path.join(binary.repo, "output.txt"), Buffer.from([0, 1, 2]));
    await writeWorkerReceipt(binary.workerReceiptPath);
    await expect(
      runVerifier(binary.repo, binary.verifierRoot, binary.contractId),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("binary changes are forbidden") });

    const oversized = await setup();
    const contract = JSON.parse(await fs.readFile(oversized.contractPath, "utf8"));
    contract.maxPatchBytes = 8;
    await fs.writeFile(oversized.contractPath, `${JSON.stringify(contract)}\n`, { mode: 0o600 });
    await fs.writeFile(path.join(oversized.repo, "output.txt"), "after\n");
    await writeWorkerReceipt(oversized.workerReceiptPath);
    await expect(
      runVerifier(oversized.repo, oversized.verifierRoot, oversized.contractId),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("patch exceeds") });
  });

  it("rejects a changed symlink that escapes its worktree", async () => {
    const { root, repo, contractPath, contractId, verifierRoot, workerReceiptPath } = await setup();
    const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));
    contract.allowedPaths = ["output.txt", "link.txt"];
    contract.expectedOutputs = ["output.txt", "link.txt"];
    contract.checkArgv = [process.execPath, "-e", "process.exit(0)"];
    await fs.writeFile(contractPath, `${JSON.stringify(contract)}\n`, { mode: 0o600 });
    await fs.writeFile(path.join(repo, "output.txt"), "after\n");
    await fs.symlink(path.join(root, "outside.txt"), path.join(repo, "link.txt"));
    await writeWorkerReceipt(workerReceiptPath);
    await expect(runVerifier(repo, verifierRoot, contractId)).rejects.toMatchObject({
      stderr: expect.stringContaining("symlink escapes"),
    });
  });

  it("rejects a worktree whose Git metadata drifts from the locked snapshot", async () => {
    const { root, repo, contractPath, contractId, verifierRoot } = await setup();
    const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));
    contract.expectedGitCommonDir = root;
    await fs.writeFile(contractPath, `${JSON.stringify(contract)}\n`, { mode: 0o600 });
    await expect(runVerifier(repo, verifierRoot, contractId)).rejects.toMatchObject({
      stderr: expect.stringContaining("outside the locked snapshot"),
    });
  });
});
