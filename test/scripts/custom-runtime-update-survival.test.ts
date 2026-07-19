import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditUpdateSurvivalRepository,
  buildCandidateUpdateSurvivalProof,
  validateCapabilityMonotonicity,
} from "../../scripts/custom-runtime/custom-runtime-update-survival.js";
import {
  parseCustomRuntimeCapabilityManifest,
  type CustomRuntimeCapabilityManifest,
} from "../../src/pcc/custom-runtime-capabilities.js";

const temporaryDirectories: string[] = [];

function temporaryRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "update-survival-")));
  temporaryDirectories.push(root);
  return root;
}

function git(repoRoot: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return result.stdout.trim();
}

function currentManifest(): CustomRuntimeCapabilityManifest {
  const value = parseCustomRuntimeCapabilityManifest(
    JSON.parse(fs.readFileSync("config/custom-runtime-capabilities.json", "utf8")),
  );
  if (!value) {
    throw new Error("expected current custom runtime capability manifest");
  }
  return value;
}

function writeCandidateFiles(repoRoot: string, manifest: CustomRuntimeCapabilityManifest): void {
  for (const requiredPath of new Set(
    manifest.capabilities.flatMap((capability) => capability.requiredPaths),
  )) {
    const filePath = path.join(repoRoot, requiredPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `preserved:${requiredPath}\n`);
  }
  const manifestPath = path.join(repoRoot, "config", "custom-runtime-capabilities.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("custom runtime update survival", () => {
  it("audits every repository wiring surface required by M61", () => {
    expect(auditUpdateSurvivalRepository(process.cwd())).toEqual([]);
  });

  it("fails closed when a candidate removes or changes an active capability", () => {
    const active: CustomRuntimeCapabilityManifest = {
      schema: "openclaw.custom-runtime-capabilities.v1",
      version: 1,
      capabilities: [
        {
          id: "runtime:kept",
          kind: "runtime",
          requiredPaths: ["kept.ts", "also-kept.ts"],
        },
      ],
    };
    expect(
      validateCapabilityMonotonicity(active, {
        ...active,
        capabilities: [],
      }),
    ).toContain("Candidate removed required custom capability runtime:kept.");
    expect(
      validateCapabilityMonotonicity(active, {
        ...active,
        capabilities: [
          {
            id: "runtime:kept",
            kind: "workflow",
            requiredPaths: ["kept.ts"],
          },
        ],
      }),
    ).toEqual([
      "Candidate changed the identity of required custom capability runtime:kept.",
      "Candidate removed also-kept.ts from required custom capability runtime:kept.",
    ]);
    expect(validateCapabilityMonotonicity(active, { ...active, version: 0 })).toContain(
      "Candidate capability manifest version 0 regressed below active version 1.",
    );
  });

  it("proves an exact active-first official merge and digest-binds every required path", () => {
    const repoRoot = temporaryRoot();
    const manifest = currentManifest();
    git(repoRoot, ["init", "-q"]);
    git(repoRoot, ["config", "user.email", "test@example.invalid"]);
    git(repoRoot, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(repoRoot, "base.txt"), "base\n");
    git(repoRoot, ["add", "."]);
    git(repoRoot, ["commit", "-qm", "base"]);
    const baseSha = git(repoRoot, ["rev-parse", "HEAD"]);

    git(repoRoot, ["switch", "-qc", "active"]);
    writeCandidateFiles(repoRoot, manifest);
    git(repoRoot, ["add", "."]);
    git(repoRoot, ["commit", "-qm", "active custom runtime"]);
    const activeSha = git(repoRoot, ["rev-parse", "HEAD"]);

    git(repoRoot, ["switch", "-qc", "official", baseSha]);
    fs.writeFileSync(path.join(repoRoot, "official.txt"), "official\n");
    git(repoRoot, ["add", "official.txt"]);
    git(repoRoot, ["commit", "-qm", "official update"]);
    const officialSha = git(repoRoot, ["rev-parse", "HEAD"]);

    git(repoRoot, ["switch", "-q", "active"]);
    git(repoRoot, ["merge", "--no-ff", "--no-edit", officialSha]);
    const candidateSha = git(repoRoot, ["rev-parse", "HEAD"]);
    const proof = buildCandidateUpdateSurvivalProof({
      repoRoot,
      activeSha,
      officialRef: officialSha,
      candidateSha,
      activeManifest: manifest,
      candidateManifest: manifest,
      checkedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(proof).toMatchObject({
      schema: "openclaw.custom-runtime-update-survival.v1",
      mode: "candidate-merge",
      activeSha,
      officialSha,
      candidateSha,
      mergeParents: [activeSha, officialSha],
      sourceClean: true,
      contractVersion: 2,
      activeManifestVersion: 4,
      candidateManifestVersion: 4,
      passed: true,
    });
    expect(proof.requiredPathDigests).toMatchObject({
      "config/custom-runtime-capabilities.json": expect.stringMatching(/^[a-f0-9]{64}$/u),
    });

    fs.writeFileSync(path.join(repoRoot, "after-merge.txt"), "after\n");
    git(repoRoot, ["add", "after-merge.txt"]);
    git(repoRoot, ["commit", "-qm", "wrong candidate parent"]);
    const wrongCandidateSha = git(repoRoot, ["rev-parse", "HEAD"]);
    expect(() =>
      buildCandidateUpdateSurvivalProof({
        repoRoot,
        activeSha,
        officialRef: officialSha,
        candidateSha: wrongCandidateSha,
        activeManifest: manifest,
        candidateManifest: manifest,
      }),
    ).toThrow("exact two-parent merge");

    fs.writeFileSync(path.join(repoRoot, "dirty.txt"), "dirty\n");
    expect(() =>
      buildCandidateUpdateSurvivalProof({
        repoRoot,
        activeSha,
        officialRef: officialSha,
        candidateSha: wrongCandidateSha,
        activeManifest: manifest,
        candidateManifest: manifest,
      }),
    ).toThrow("checkout is dirty");
  });
});
