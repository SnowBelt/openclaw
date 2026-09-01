import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBaselineCertificate,
  verifyBaselineCertificate,
} from "../../scripts/custom-runtime/custom-runtime-baseline-certificate.mjs";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-baseline-cert-")));
  roots.push(root);
  return root;
}

function writeFile(filePath: string, contents: string, mode = 0o644): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { mode });
  fs.chmodSync(filePath, mode);
}

function writeJson(filePath: string, value: unknown, mode = 0o600): void {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "OpenClaw Test",
      GIT_AUTHOR_EMAIL: "openclaw-test@local",
      GIT_COMMITTER_NAME: "OpenClaw Test",
      GIT_COMMITTER_EMAIL: "openclaw-test@local",
    },
  }).trim();
}

function fixture(): {
  repoRoot: string;
  evidenceRoot: string;
  certificatePath: string;
  sourceSha: string;
  branch: string;
  evidence: {
    security: string;
    runtime: string;
    rollback: string;
    proofs: Array<{ id: string; path: string }>;
  };
} {
  const root = temporaryRoot();
  const repoRoot = path.join(root, "source");
  const evidenceRoot = path.join(root, "evidence");
  const certificatePath = path.join(evidenceRoot, "baseline-certificate.json");
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(evidenceRoot, { recursive: true });
  writeFile(path.join(repoRoot, ".gitignore"), "dist/\n");
  writeFile(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFile(
    path.join(repoRoot, ".github/workflows/control-director-reliability.yml"),
    "name: Control Director Reliability\n",
  );
  writeJson(
    path.join(repoRoot, "config/custom-runtime-capabilities.json"),
    {
      schema: "openclaw.custom-runtime-capabilities.v2",
      version: 5,
      preservation: {
        contractVersion: 2,
        criticality: "required",
        migrationPolicy: "preserve_or_block",
        rollbackPolicy: "immutable_release_pointer",
        sourceStrategy: "merge_from_active_sha",
        dashboardChangePolicy: "register_verify_and_block",
        approvalPolicy: "explicit_exact_candidate",
        proofCommand: "pnpm custom-runtime:update-survival",
      },
      capabilities: [{ id: "runtime:update-safe-customizations", requiredPaths: [] }],
    },
    0o644,
  );
  git(repoRoot, ["init", "-q"]);
  git(repoRoot, ["config", "user.name", "OpenClaw Test"]);
  git(repoRoot, ["config", "user.email", "openclaw-test@local"]);
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-qm", "baseline source"]);
  const sourceSha = git(repoRoot, ["rev-parse", "HEAD"]);
  const branch = git(repoRoot, ["branch", "--show-current"]);
  writeJson(
    path.join(repoRoot, "dist/custom-runtime-completeness.json"),
    {
      schema: "openclaw.custom-runtime-completeness.v1",
      version: 1,
      source: { commit: sourceSha },
      build: { id: "test-build" },
      artifacts: { dist: [], distRuntime: [] },
    },
    0o644,
  );

  const security = path.join(evidenceRoot, "security.json");
  const runtime = path.join(evidenceRoot, "runtime.json");
  const rollback = path.join(evidenceRoot, "rollback.json");
  const proof = path.join(evidenceRoot, "proof.json");
  for (const [filePath, result] of [
    [security, "passed"],
    [runtime, "passed"],
    [rollback, "rollback_ready"],
    [proof, "passed"],
  ] as const) {
    writeJson(filePath, {
      schema: `openclaw.test-${path.basename(filePath)}`,
      sourceSha,
      result,
    });
  }
  return {
    repoRoot,
    evidenceRoot,
    certificatePath,
    sourceSha,
    branch,
    evidence: {
      security,
      runtime,
      rollback,
      proofs: [{ id: "repository-proof", path: proof }],
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("custom runtime baseline certificate", () => {
  it("binds source, workflow, lockfile, manifests, and distinct proof receipts", () => {
    const value = fixture();
    const certificate = createBaselineCertificate({
      sourceRoot: value.repoRoot,
      sourceSha: value.sourceSha,
      branch: value.branch,
      repository: "SnowBelt/openclaw",
      workflowPath: ".github/workflows/control-director-reliability.yml",
      lockfilePath: "pnpm-lock.yaml",
      capabilityManifestPath: "config/custom-runtime-capabilities.json",
      completenessManifestPath: "dist/custom-runtime-completeness.json",
      evidence: value.evidence,
      evidenceRoot: value.evidenceRoot,
      outputPath: value.certificatePath,
      checkedAt: new Date().toISOString(),
    });

    expect(certificate).toMatchObject({
      schema: "openclaw.custom-runtime-baseline-certificate.v1",
      version: 1,
      sourceRoot: fs.realpathSync(value.repoRoot),
      sourceSha: value.sourceSha,
      repository: "SnowBelt/openclaw",
      result: "passed",
    });
    expect(
      verifyBaselineCertificate({
        certificatePath: value.certificatePath,
        expectedSha: value.sourceSha,
        sourceRoot: value.repoRoot,
        evidenceRoot: value.evidenceRoot,
      }),
    ).toMatchObject({ result: "verified", sourceSha: value.sourceSha, proofCount: 1 });
  });

  it("rejects a missing required evidence role", () => {
    const value = fixture();
    expect(() =>
      createBaselineCertificate({
        sourceRoot: value.repoRoot,
        sourceSha: value.sourceSha,
        branch: value.branch,
        repository: "SnowBelt/openclaw",
        workflowPath: ".github/workflows/control-director-reliability.yml",
        lockfilePath: "pnpm-lock.yaml",
        capabilityManifestPath: "config/custom-runtime-capabilities.json",
        completenessManifestPath: "dist/custom-runtime-completeness.json",
        evidence: { ...value.evidence, rollback: "" },
        evidenceRoot: value.evidenceRoot,
        outputPath: value.certificatePath,
      }),
    ).toThrow(/rollback evidence is required/u);
  });

  it("rejects failed or mismatched evidence instead of certifying it", () => {
    const value = fixture();
    writeJson(value.evidence.runtime, { sourceSha: "b".repeat(40), result: "passed" });
    expect(() =>
      createBaselineCertificate({
        sourceRoot: value.repoRoot,
        sourceSha: value.sourceSha,
        branch: value.branch,
        repository: "SnowBelt/openclaw",
        workflowPath: ".github/workflows/control-director-reliability.yml",
        lockfilePath: "pnpm-lock.yaml",
        capabilityManifestPath: "config/custom-runtime-capabilities.json",
        completenessManifestPath: "dist/custom-runtime-completeness.json",
        evidence: value.evidence,
        evidenceRoot: value.evidenceRoot,
        outputPath: value.certificatePath,
      }),
    ).toThrow(/runtime evidence is not bound to the exact source SHA/u);

    writeJson(value.evidence.runtime, { sourceSha: value.sourceSha, result: "failed" });
    expect(() =>
      createBaselineCertificate({
        sourceRoot: value.repoRoot,
        sourceSha: value.sourceSha,
        branch: value.branch,
        repository: "SnowBelt/openclaw",
        workflowPath: ".github/workflows/control-director-reliability.yml",
        lockfilePath: "pnpm-lock.yaml",
        capabilityManifestPath: "config/custom-runtime-capabilities.json",
        completenessManifestPath: "dist/custom-runtime-completeness.json",
        evidence: value.evidence,
        evidenceRoot: value.evidenceRoot,
        outputPath: value.certificatePath,
      }),
    ).toThrow(/runtime evidence does not contain an accepted successful result/u);
  });

  it("rejects tampered evidence and certificate bytes", () => {
    const value = fixture();
    createBaselineCertificate({
      sourceRoot: value.repoRoot,
      sourceSha: value.sourceSha,
      branch: value.branch,
      repository: "SnowBelt/openclaw",
      workflowPath: ".github/workflows/control-director-reliability.yml",
      lockfilePath: "pnpm-lock.yaml",
      capabilityManifestPath: "config/custom-runtime-capabilities.json",
      completenessManifestPath: "dist/custom-runtime-completeness.json",
      evidence: value.evidence,
      evidenceRoot: value.evidenceRoot,
      outputPath: value.certificatePath,
    });
    writeJson(value.evidence.proofs[0]!.path, {
      sourceSha: value.sourceSha,
      result: "passed",
      changed: true,
    });
    expect(() =>
      verifyBaselineCertificate({
        certificatePath: value.certificatePath,
        expectedSha: value.sourceSha,
        sourceRoot: value.repoRoot,
        evidenceRoot: value.evidenceRoot,
      }),
    ).toThrow(/proof evidence hash or source identity changed after certification/u);

    const certificate = JSON.parse(fs.readFileSync(value.certificatePath, "utf8")) as {
      certificateSha256: string;
    };
    certificate.certificateSha256 = "0".repeat(64);
    writeJson(value.certificatePath, certificate);
    expect(() =>
      verifyBaselineCertificate({
        certificatePath: value.certificatePath,
        expectedSha: value.sourceSha,
        sourceRoot: value.repoRoot,
        evidenceRoot: value.evidenceRoot,
      }),
    ).toThrow(/certificate hash does not match its contents/u);
  });

  it("requires explicit CLI roots and accepts only repository-native yml workflows", () => {
    const value = fixture();
    const script = path.resolve("scripts/custom-runtime/custom-runtime-baseline-certificate.mjs");
    expect(() =>
      execFileSync(process.execPath, [script, "verify", "--sha", value.sourceSha], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).toThrow(/--source is required/u);

    expect(() =>
      createBaselineCertificate({
        sourceRoot: value.repoRoot,
        sourceSha: value.sourceSha,
        branch: value.branch,
        repository: "SnowBelt/openclaw",
        workflowPath: ".github/workflows/control-director-reliability.yaml",
        lockfilePath: "pnpm-lock.yaml",
        capabilityManifestPath: "config/custom-runtime-capabilities.json",
        completenessManifestPath: "dist/custom-runtime-completeness.json",
        evidence: value.evidence,
        evidenceRoot: value.evidenceRoot,
        outputPath: value.certificatePath,
      }),
    ).toThrow(/repository-native \.github\/workflows YAML/u);
  });
});
