import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashBuildArtifactTree,
  hashRuntimeClosure,
  listRuntimeClosurePaths,
  verifyRuntimePackage,
} from "../../scripts/custom-runtime/runtime-package-integrity.mjs";

const SOURCE_SHA = "a".repeat(40);
const roots: string[] = [];

function writeFile(root: string, relativePath: string, contents = `${relativePath}\n`): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
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
  writeFile(root, ".openclaw-production-sha", `${SOURCE_SHA}\n`);
  return root;
}

function sealSnapshot(root: string): void {
  const runtimeClosurePaths = listRuntimeClosurePaths(root);
  const snapshot = {
    version: 2,
    releaseId: "fixture-release",
    root,
    artifactHash: hashBuildArtifactTree(root),
    runtimeClosureVersion: 1,
    runtimeClosurePaths,
    runtimeClosureHash: hashRuntimeClosure(root, runtimeClosurePaths),
    source: { commit: SOURCE_SHA },
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
});
