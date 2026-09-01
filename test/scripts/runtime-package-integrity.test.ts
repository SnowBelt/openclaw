import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCustomRuntimeCompletenessManifest } from "../../scripts/custom-runtime/custom-runtime-completeness.mjs";
import {
  hashBuildArtifactTree,
  hashRuntimeClosure,
  listRuntimeClosurePaths,
  verifyRuntimePackage,
} from "../../scripts/custom-runtime/runtime-package-integrity.mjs";

const roots: string[] = [];

function writeFile(root: string, relativePath: string, contents = `${relativePath}\n`): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

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

function createRuntime(options: { missingDependency?: string } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-integrity-"));
  roots.push(root);
  writeFile(root, "dist/index.js");
  writeFile(root, "dist/entry.js");
  writeFile(root, "dist/control-ui/index.html");
  writeFile(root, "dist-runtime/extensions/research-manager/index.js");
  writeFile(root, "package.json", '{"name":"openclaw"}\n');
  writeFile(root, "config/release-governor-policy.json", "{}\n");
  writeFile(root, "src/pcc/capability-addition-registry.ts");
  writeFile(root, "extensions/research-manager/index.ts");
  writeFile(root, "extensions/research-manager/openclaw.plugin.json", "{}\n");
  writeFile(root, "extensions/research-manager/src/tool-descriptor.ts");
  const dependencies = ["@mozilla/readability", "linkedom", "pdfjs-dist", "typebox"];
  writeFile(
    root,
    "extensions/research-manager/package.json",
    `${JSON.stringify({ dependencies: Object.fromEntries(dependencies.map((item) => [item, "1"])) })}\n`,
  );
  for (const dependency of dependencies) {
    if (dependency !== options.missingDependency) {
      writeFile(root, `node_modules/${dependency}/package.json`, "{}\n");
    }
  }
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
  writeFile(root, "ui/src/app/theme.ts", 'export type ThemeMode = "system" | "light" | "dark";\n');
  runGit(root, ["init", "-q"]);
  runGit(root, ["add", "package.json", "config", "extensions", "src", "ui"]);
  runGit(root, ["commit", "-qm", "fixture source"]);
  const sourceCommit = runGit(root, ["rev-parse", "HEAD"]);
  const buildId = "2026.7.13-test";
  writeFile(
    root,
    "dist/build-info.json",
    `${JSON.stringify({ version: "1.0.0", commit: sourceCommit, builtAt: "2026-07-13T12:34:56.000Z" })}\n`,
  );
  writeFile(
    root,
    "dist/control-ui/dashboard-surfaces.json",
    `${JSON.stringify({
      buildId,
      surfaces: [{ id: "pcc", path: "/pcc", label: "PCC", aliases: [], assets: ["assets/pcc.js"] }],
    })}\n`,
  );
  writeFile(root, "dist/control-ui/assets/pcc.js");
  writeFile(root, "dist/control-ui/sw.js", `const BUILD_ID = ${JSON.stringify(buildId)};\n`);
  for (const template of [
    "AGENTS.md",
    "SOUL.md",
    "TOOLS.md",
    "IDENTITY.md",
    "USER.md",
    "HEARTBEAT.md",
    "BOOTSTRAP.md",
  ]) {
    writeFile(root, `dist/templates/${template}`);
  }
  writeFile(root, "dist/extensions/research-manager/index.js");
  writeFile(root, "dist/extensions/research-manager/openclaw.plugin.json", "{}\n");
  writeFile(root, "dist/extensions/research-manager/package.json", "{}\n");
  writeFile(root, "dist/extensions/node_modules/openclaw/plugin-sdk/runtime.js");
  writeFile(root, "dist-runtime/extensions/research-manager/index.js");
  writeFile(root, "dist-runtime/extensions/research-manager/package.json", "{}\n");
  writeCustomRuntimeCompletenessManifest(root);
  fs.rmSync(path.join(root, "ui"), { recursive: true, force: true });
  fs.rmSync(path.join(root, ".git"), { recursive: true, force: true });
  writeFile(root, ".openclaw-production-sha", `${sourceCommit}\n`);
  return root;
}

function sealSnapshot(root: string): void {
  const sourceSha = fs.readFileSync(path.join(root, ".openclaw-production-sha"), "utf8").trim();
  const runtimeClosurePaths = listRuntimeClosurePaths(root);
  const snapshot = {
    version: 2,
    releaseId: "fixture-release",
    root,
    artifactHash: hashBuildArtifactTree(root),
    runtimeClosureVersion: 1,
    runtimeClosurePaths,
    runtimeClosureHash: hashRuntimeClosure(root, runtimeClosurePaths),
    source: { commit: sourceSha },
  };
  writeFile(root, "snapshot.json", `${JSON.stringify(snapshot)}\n`);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("managed runtime package integrity", () => {
  it("verifies exact build bytes, complete runtime closure, capabilities, and dependencies", () => {
    const root = createRuntime();
    for (const relativePath of [
      ".agents/placeholder.txt",
      ".github/placeholder.txt",
      "AGENTS.md",
      "CHANGELOG.md",
      "LICENSE",
      "README.md",
      "THIRD_PARTY_NOTICES.md",
      "apps/placeholder.txt",
      "ui/placeholder.txt",
      "work/placeholder.txt",
    ]) {
      writeFile(root, relativePath);
    }
    sealSnapshot(root);

    expect(verifyRuntimePackage({ releaseRoot: root })).toEqual([]);
  });

  it("detects build and closure tampering", () => {
    const root = createRuntime();
    sealSnapshot(root);
    fs.appendFileSync(path.join(root, "dist/index.js"), "tampered\n");

    expect(verifyRuntimePackage({ releaseRoot: root })).toEqual(
      expect.arrayContaining([
        "Runtime package build artifact hash does not match its bytes.",
        "Runtime package closure hash does not match its bytes.",
      ]),
    );
  });

  it("detects executable-mode tampering in the production closure", () => {
    const root = createRuntime();
    const executable = path.join(root, "dist/index.js");
    fs.chmodSync(executable, 0o755);
    sealSnapshot(root);
    fs.chmodSync(executable, 0o644);

    expect(verifyRuntimePackage({ releaseRoot: root })).toContain(
      "Runtime package closure hash does not match its bytes.",
    );
  });

  it("detects files added after the closure inventory was recorded", () => {
    const root = createRuntime();
    sealSnapshot(root);
    writeFile(root, "unexpected.txt");

    expect(verifyRuntimePackage({ releaseRoot: root })).toContain(
      "Runtime package closure path inventory does not match the release.",
    );
  });

  it("rejects symlinks escaping the immutable release", () => {
    const root = createRuntime();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-outside-"));
    roots.push(outside);
    writeFile(outside, "outside.txt");
    fs.symlinkSync(path.join(outside, "outside.txt"), path.join(root, "escaped-link"));
    sealSnapshot(root);

    expect(verifyRuntimePackage({ releaseRoot: root })).toContain(
      "Runtime package symlink escapes the release: escaped-link",
    );
  });

  it("rejects missing Research Manager production dependencies", () => {
    const root = createRuntime({ missingDependency: "pdfjs-dist" });
    sealSnapshot(root);

    expect(verifyRuntimePackage({ releaseRoot: root })).toContain(
      "Research Manager runtime dependency is missing: pdfjs-dist",
    );
  });

  it("rejects sensitive files outside the dependency closure", () => {
    const root = createRuntime();
    writeFile(root, "config/release-signing.pem", "not-a-real-key\n");
    sealSnapshot(root);

    expect(verifyRuntimePackage({ releaseRoot: root })).toContain(
      "Runtime package contains a prohibited sensitive file: config/release-signing.pem",
    );
  });

  it("rejects an unsupported completeness contract version", () => {
    const root = createRuntime();
    sealSnapshot(root);
    const snapshotPath = path.join(root, "snapshot.json");
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as Record<string, unknown>;
    snapshot.completenessVersion = 2;
    fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`);

    expect(verifyRuntimePackage({ releaseRoot: root })).toContain(
      "Runtime package completeness version must be 1.",
    );
  });
});
