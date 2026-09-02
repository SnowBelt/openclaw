import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  verifyCustomRuntimeCompleteness,
  writeCustomRuntimeCompletenessManifest,
} from "../../scripts/custom-runtime/custom-runtime-completeness.mjs";

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

function createFixture(): { root: string; sourceSha: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-runtime-completeness-"));
  roots.push(root);
  writeFile(root, "package.json", '{"name":"openclaw","version":"1.0.0"}\n');
  writeFile(root, "ui/src/app/theme.ts", 'export type ThemeMode = "system" | "light" | "dark";\n');
  runGit(root, ["init", "-q"]);
  runGit(root, ["add", "package.json", "ui"]);
  runGit(root, ["commit", "-qm", "fixture source"]);
  const sourceSha = runGit(root, ["rev-parse", "HEAD"]);
  const buildId = "2026.7.13-test";
  writeFile(
    root,
    "dist/build-info.json",
    `${JSON.stringify({
      version: "1.0.0",
      commit: sourceSha,
      builtAt: "2026-07-13T12:34:56.000Z",
    })}\n`,
  );
  writeFile(root, "dist/index.js");
  writeFile(root, "dist/entry.js");
  writeFile(root, "dist/control-ui/index.html");
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
  writeFile(root, "dist/extensions/example/index.js");
  writeFile(root, "dist/extensions/example/package.json", "{}\n");
  writeFile(root, "dist/extensions/node_modules/openclaw/plugin-sdk/runtime.js");
  writeFile(root, "dist-runtime/extensions/example/index.js");
  writeFile(root, "dist-runtime/extensions/example/package.json", "{}\n");
  writeCustomRuntimeCompletenessManifest(root);
  return { root, sourceSha };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("custom runtime completeness", () => {
  it("writes and verifies an exact build and packaged-artifact inventory", () => {
    const { root, sourceSha } = createFixture();
    const manifestPath = path.join(root, "dist/custom-runtime-completeness.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      schema: "openclaw.custom-runtime-completeness.v1",
      source: { commit: sourceSha },
      build: { id: "2026.7.13-test" },
      modes: { values: ["system", "light", "dark"] },
    });
    expect(
      verifyCustomRuntimeCompleteness({ rootDir: root, expectedSourceSha: sourceSha }),
    ).toEqual([]);
  });

  it("detects changed and missing packaged artifacts", () => {
    const { root, sourceSha } = createFixture();
    fs.appendFileSync(path.join(root, "dist/index.js"), "tampered\n");
    fs.rmSync(path.join(root, "dist/templates/USER.md"));

    expect(
      verifyCustomRuntimeCompleteness({ rootDir: root, expectedSourceSha: sourceSha }),
    ).toEqual(
      expect.arrayContaining([
        "dist asset changed: dist/index.js",
        "dist asset is missing: dist/templates/USER.md",
      ]),
    );
  });

  it("can verify a packaged release without source checkout files", () => {
    const { root, sourceSha } = createFixture();
    fs.rmSync(path.join(root, "ui"), { recursive: true, force: true });
    fs.rmSync(path.join(root, ".git"), { recursive: true, force: true });

    expect(
      verifyCustomRuntimeCompleteness({
        rootDir: root,
        expectedSourceSha: sourceSha,
        verifySourceContract: false,
      }),
    ).toEqual([]);
  });

  it("rejects an unexpected source identity", () => {
    const { root } = createFixture();

    expect(
      verifyCustomRuntimeCompleteness({
        rootDir: root,
        expectedSourceSha: "f".repeat(40),
      }),
    ).toContain("Custom runtime completeness source SHA does not match the expected SHA.");
  });
});
