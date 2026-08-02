import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assembleManagedRuntimePackage,
  assertCandidateLineage,
} from "../../scripts/custom-runtime/custom-runtime-package.mjs";
import { hashBuildArtifactTree } from "../../scripts/custom-runtime/runtime-package-integrity.mjs";

const roots: string[] = [];

function runGit(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
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

function writeFile(root: string, relativePath: string, contents = `${relativePath}\n`): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function createRepository(): { root: string; activeSha: string; candidateSha: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-package-source-"));
  roots.push(root);
  runGit(root, ["init", "-q"]);
  writeFile(root, ".gitignore", ".artifacts/\ndist/\ndist-runtime/\n");
  writeFile(root, "package.json", '{"name":"openclaw","version":"1.0.0"}\n');
  writeFile(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  writeFile(root, "config/release-governor-policy.json", "{}\n");
  writeFile(root, "src/pcc/capability-addition-registry.ts");
  writeFile(root, "scripts/custom-runtime/placeholder.sh");
  writeFile(root, "extensions/research-manager/index.ts");
  writeFile(root, "extensions/research-manager/openclaw.plugin.json", "{}\n");
  writeFile(root, "extensions/research-manager/src/tool-descriptor.ts");
  writeFile(
    root,
    "extensions/research-manager/package.json",
    '{"dependencies":{"pdfjs-dist":"1"}}\n',
  );
  writeFile(
    root,
    "config/custom-runtime-capabilities.json",
    `${JSON.stringify({
      preservation: { standardsRegistry: "src/pcc/capability-addition-registry.ts" },
      capabilities: [
        {
          id: "plugin:research-manager",
          kind: "plugin",
          pluginId: "research-manager",
          requiredPaths: [
            "extensions/research-manager/index.ts",
            "extensions/research-manager/openclaw.plugin.json",
            "extensions/research-manager/package.json",
            "extensions/research-manager/src/tool-descriptor.ts",
          ],
        },
      ],
    })}\n`,
  );
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-qm", "active"]);
  const activeSha = runGit(root, ["rev-parse", "HEAD"]);
  writeFile(root, "candidate.txt");
  runGit(root, ["add", "candidate.txt"]);
  runGit(root, ["commit", "-qm", "candidate one"]);
  writeFile(root, "candidate-two.txt");
  runGit(root, ["add", "candidate-two.txt"]);
  runGit(root, ["commit", "-qm", "candidate two"]);
  const candidateSha = runGit(root, ["rev-parse", "HEAD"]);
  return { root, activeSha, candidateSha };
}

function writeBuildSnapshot(root: string, candidateSha: string): void {
  const buildRoot = path.join(root, ".artifacts", "openclaw-gateway-runtime", "releases", "build");
  writeFile(buildRoot, "dist/index.js");
  writeFile(buildRoot, "dist/entry.js");
  writeFile(buildRoot, "dist/control-ui/index.html");
  writeFile(buildRoot, "dist-runtime/extensions/research-manager/index.js");
  fs.copyFileSync(path.join(root, "package.json"), path.join(buildRoot, "package.json"));
  const snapshot = {
    version: 2,
    releaseId: "source-build",
    root: buildRoot,
    artifactHash: hashBuildArtifactTree(buildRoot),
    packageVersion: "1.0.0",
    source: { root, commit: candidateSha },
    paths: {},
  };
  writeFile(buildRoot, "snapshot.json", `${JSON.stringify(snapshot)}\n`);
  writeFile(
    root,
    ".artifacts/openclaw-gateway-runtime/latest.json",
    `${JSON.stringify(snapshot)}\n`,
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("custom managed-runtime packaging", () => {
  it("accepts an indirect active ancestor and rejects unrelated lineage", () => {
    const { root, activeSha, candidateSha } = createRepository();

    expect(() =>
      assertCandidateLineage({ sourceRoot: root, sourceSha: candidateSha, activeSha }),
    ).not.toThrow();
    expect(() =>
      assertCandidateLineage({
        sourceRoot: root,
        sourceSha: candidateSha,
        activeSha: "f".repeat(40),
      }),
    ).toThrow(/merge-base --is-ancestor/u);
  });

  it("assembles a self-contained exact-build package with a verified closure hash", () => {
    const { root, activeSha, candidateSha } = createRepository();
    writeBuildSnapshot(root, candidateSha);
    const releasesDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-package-output-"));
    roots.push(releasesDir);

    const result = assembleManagedRuntimePackage({
      sourceRoot: root,
      releasesDir,
      sourceSha: candidateSha,
      activeSha,
      releaseId: "candidate-release",
      seal: false,
      deploy({ stagingRoot }) {
        writeFile(stagingRoot, "package.json", '{"name":"openclaw"}\n');
        writeFile(stagingRoot, "node_modules/pdfjs-dist/package.json", "{}\n");
      },
    });

    const snapshot = JSON.parse(
      fs.readFileSync(path.join(result.releaseRoot, "snapshot.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(result.releaseRoot).toBe(path.join(fs.realpathSync(releasesDir), "candidate-release"));
    expect(snapshot).toMatchObject({
      root: result.releaseRoot,
      artifactHash: result.artifactHash,
      runtimeClosureVersion: 1,
      runtimeClosureHash: result.runtimeClosureHash,
    });
    expect(fs.realpathSync(path.join(result.releaseRoot, "node_modules/pdfjs-dist"))).toContain(
      result.releaseRoot,
    );
  });

  it("fails closed and removes staging when deployment dirties the candidate source", () => {
    const { root, activeSha, candidateSha } = createRepository();
    writeBuildSnapshot(root, candidateSha);
    const releasesDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-package-output-"));
    roots.push(releasesDir);

    expect(() =>
      assembleManagedRuntimePackage({
        sourceRoot: root,
        releasesDir,
        sourceSha: candidateSha,
        activeSha,
        releaseId: "dirty-candidate-release",
        seal: false,
        deploy({ stagingRoot }) {
          writeFile(stagingRoot, "package.json", '{"name":"openclaw"}\n');
          writeFile(stagingRoot, "node_modules/pdfjs-dist/package.json", "{}\n");
          fs.appendFileSync(path.join(root, "candidate.txt"), "dirty\n");
        },
      }),
    ).toThrow(/must be clean/u);
    expect(fs.readdirSync(releasesDir)).toEqual([]);
  });

  it("removes the exact newly created release when sealing fails", () => {
    const { root, activeSha, candidateSha } = createRepository();
    writeBuildSnapshot(root, candidateSha);
    const releasesDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-package-output-"));
    roots.push(releasesDir);

    expect(() =>
      assembleManagedRuntimePackage({
        sourceRoot: root,
        releasesDir,
        sourceSha: candidateSha,
        activeSha,
        releaseId: "seal-failure-release",
        deploy({ stagingRoot }) {
          writeFile(stagingRoot, "package.json", '{"name":"openclaw"}\n');
          writeFile(stagingRoot, "node_modules/pdfjs-dist/package.json", "{}\n");
        },
      }),
    ).toThrow(/custom-runtime-seal\.sh/u);
    expect(fs.readdirSync(releasesDir)).toEqual([]);
  });
});
