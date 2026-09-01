import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assembleManagedRuntimePackage,
  assertCandidateLineage,
  resolveDefaultDeployInvocation,
} from "../../scripts/custom-runtime/custom-runtime-package.mjs";
import { importSourceProvenance } from "../../scripts/custom-runtime/custom-runtime-source-provenance.mjs";
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

function createRepository(
  options: {
    includeSourceImport?: boolean;
    registerSourceDependency?: boolean;
  } = {},
): { root: string; activeSha: string; candidateSha: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-package-source-"));
  roots.push(root);
  runGit(root, ["init", "-q"]);
  writeFile(root, ".gitignore", ".artifacts/\ndist/\ndist-runtime/\n");
  writeFile(root, "package.json", '{"name":"openclaw","version":"1.0.0"}\n');
  writeFile(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  writeFile(root, "config/release-governor-policy.json", "{}\n");
  writeFile(root, "src/pcc/capability-addition-registry.ts");
  writeFile(root, "scripts/custom-runtime/placeholder.sh");
  writeFile(
    root,
    "scripts/custom-runtime/custom-runtime-seal.sh",
    [
      "#!/bin/sh",
      'case "$*" in *seal-failure-release*) exit 1;; esac',
      '[ -d "${OPENCLAW_CUSTOM_RUNTIME_HOME:?}/source-provenance" ]',
      "",
    ].join("\n"),
  );
  if (options.includeSourceImport) {
    writeFile(
      root,
      "scripts/custom-runtime/placeholder.ts",
      'import { runtimeDependency } from "../../src/runtime-dependency.js";\nexport { runtimeDependency };\n',
    );
    writeFile(root, "src/runtime-dependency.ts", 'export const runtimeDependency = "ok";\n');
  }
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
            ...(options.includeSourceImport
              ? [
                  "scripts/custom-runtime/placeholder.ts",
                  ...(options.registerSourceDependency ? ["src/runtime-dependency.ts"] : []),
                ]
              : []),
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

function createProvenanceHome(sourceRoot: string, candidateSha: string): string {
  const provenanceHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-runtime-package-provenance-"),
  );
  roots.push(provenanceHome);
  importSourceProvenance({
    sourceRoot,
    sourceSha: candidateSha,
    runtimeHome: provenanceHome,
  });
  const trustedHelper = path.join(provenanceHome, "bin", "custom-runtime-source-provenance.mjs");
  fs.mkdirSync(path.dirname(trustedHelper), { recursive: true, mode: 0o700 });
  fs.copyFileSync(
    path.resolve("scripts/custom-runtime/custom-runtime-source-provenance.mjs"),
    trustedHelper,
  );
  fs.chmodSync(trustedHelper, 0o700);
  return provenanceHome;
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
  it("makes the default dependency deployment explicitly offline when requested", () => {
    const result = resolveDefaultDeployInvocation({
      stagingRoot: "/tmp/runtime-staging",
      env: { OPENCLAW_BUILD_OFFLINE: "1", PATH: "/bin" },
    });

    expect(result).toEqual({
      command: "pnpm",
      args: [
        "--config.offline=true",
        "--config.inject-workspace-packages=true",
        "--filter",
        "openclaw",
        "deploy",
        "--prod",
        "/tmp/runtime-staging",
      ],
      env: { OPENCLAW_BUILD_OFFLINE: "1", PATH: "/bin", npm_config_offline: "true" },
    });
  });

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
    const { root, activeSha, candidateSha } = createRepository({
      includeSourceImport: true,
      registerSourceDependency: true,
    });
    writeBuildSnapshot(root, candidateSha);
    const releasesDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-package-output-"));
    const provenanceRuntimeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-runtime-package-provenance-"),
    );
    roots.push(releasesDir);
    roots.push(provenanceRuntimeHome);

    const result = assembleManagedRuntimePackage({
      sourceRoot: root,
      releasesDir,
      sourceSha: candidateSha,
      activeSha,
      releaseId: "candidate-release",
      provenanceRuntimeHome,
      sourceRemote: "https://github.com/SnowBelt/openclaw.git",
      sourceRemoteBranch: "codex/runtime-update-20260829T120000Z",
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
    const provenance = JSON.parse(
      fs.readFileSync(path.join(result.releaseRoot, ".openclaw-runtime-provenance.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(provenance).toMatchObject({
      sourceSha: candidateSha,
      storePath: expect.stringContaining("source-provenance"),
      bundlePath: expect.stringContaining("source.bundle"),
      bundleSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      sourceRemote: "https://github.com/SnowBelt/openclaw.git",
      sourceRemoteBranch: "codex/runtime-update-20260829T120000Z",
    });
    expect(fs.realpathSync(path.join(result.releaseRoot, "node_modules/pdfjs-dist"))).toContain(
      result.releaseRoot,
    );
    expect(
      fs.readFileSync(path.join(result.releaseRoot, "src/runtime-dependency.ts"), "utf8"),
    ).toBe('export const runtimeDependency = "ok";\n');
  });

  it("reuses an existing deep-verified provenance record without re-importing it", () => {
    const { root, activeSha, candidateSha } = createRepository();
    writeBuildSnapshot(root, candidateSha);
    const provenanceHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "openclaw-runtime-package-provenance-"),
    );
    roots.push(provenanceHome);
    const provenance = importSourceProvenance({
      sourceRoot: root,
      sourceSha: candidateSha,
      runtimeHome: provenanceHome,
    });
    const trustedHelper = path.join(provenanceHome, "bin", "custom-runtime-source-provenance.mjs");
    fs.mkdirSync(path.dirname(trustedHelper), { recursive: true, mode: 0o700 });
    fs.copyFileSync(
      path.resolve("scripts/custom-runtime/custom-runtime-source-provenance.mjs"),
      trustedHelper,
    );
    fs.chmodSync(trustedHelper, 0o700);
    const releasesDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-package-output-"));
    roots.push(releasesDir);

    const result = assembleManagedRuntimePackage({
      sourceRoot: root,
      releasesDir,
      sourceSha: candidateSha,
      activeSha,
      releaseId: "existing-provenance-release",
      provenanceRecordPath: provenance.recordPath,
      deploy({ stagingRoot }) {
        writeFile(stagingRoot, "package.json", '{"name":"openclaw"}\n');
        writeFile(stagingRoot, "node_modules/pdfjs-dist/package.json", "{}\n");
      },
    });

    const envelope = JSON.parse(
      fs.readFileSync(path.join(result.releaseRoot, ".openclaw-runtime-provenance.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(envelope.recordPath).toBe(provenance.recordPath);
    expect(envelope.recordSha256).toEqual(expect.any(String));
  });

  it("fails before deployment when a custom-runtime source import has no capability owner", () => {
    const { root, activeSha, candidateSha } = createRepository({ includeSourceImport: true });
    writeBuildSnapshot(root, candidateSha);
    const releasesDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-package-output-"));
    roots.push(releasesDir);
    const provenanceHome = createProvenanceHome(root, candidateSha);

    expect(() =>
      assembleManagedRuntimePackage({
        sourceRoot: root,
        releasesDir,
        sourceSha: candidateSha,
        activeSha,
        releaseId: "unregistered-source-dependency-release",
        provenanceRuntimeHome: provenanceHome,
        seal: false,
        deploy() {
          throw new Error("deployment should not start before source-closure validation");
        },
      }),
    ).toThrow(/source import has no capability owner.*src\/runtime-dependency\.ts/u);
    expect(fs.readdirSync(releasesDir)).toEqual([]);
  });

  it("fails closed and removes staging when deployment dirties the candidate source", () => {
    const { root, activeSha, candidateSha } = createRepository();
    writeBuildSnapshot(root, candidateSha);
    const releasesDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-package-output-"));
    roots.push(releasesDir);
    const provenanceHome = createProvenanceHome(root, candidateSha);

    expect(() =>
      assembleManagedRuntimePackage({
        sourceRoot: root,
        releasesDir,
        sourceSha: candidateSha,
        activeSha,
        releaseId: "dirty-candidate-release",
        provenanceRuntimeHome: provenanceHome,
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

  it("rejects packaging without durable source provenance before deployment", () => {
    const { root, activeSha, candidateSha } = createRepository();
    const releasesDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-package-output-"));
    roots.push(releasesDir);
    const deploy = () => {
      throw new Error("deployment must not start without provenance");
    };

    expect(() =>
      assembleManagedRuntimePackage({
        sourceRoot: root,
        releasesDir,
        sourceSha: candidateSha,
        activeSha,
        releaseId: "missing-provenance-release",
        seal: false,
        deploy,
      }),
    ).toThrow(/Durable source provenance is required/u);
    expect(fs.readdirSync(releasesDir)).toEqual([]);
  });

  it("removes the exact newly created release when sealing fails", () => {
    const { root, activeSha, candidateSha } = createRepository();
    writeBuildSnapshot(root, candidateSha);
    const releasesDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-package-output-"));
    roots.push(releasesDir);
    const provenanceHome = createProvenanceHome(root, candidateSha);

    expect(() =>
      assembleManagedRuntimePackage({
        sourceRoot: root,
        releasesDir,
        sourceSha: candidateSha,
        activeSha,
        releaseId: "seal-failure-release",
        provenanceRuntimeHome: provenanceHome,
        deploy({ stagingRoot }) {
          writeFile(stagingRoot, "package.json", '{"name":"openclaw"}\n');
          writeFile(stagingRoot, "node_modules/pdfjs-dist/package.json", "{}\n");
        },
      }),
    ).toThrow(/custom-runtime-seal\.sh/u);
    expect(fs.readdirSync(releasesDir)).toEqual([]);
  });
});
