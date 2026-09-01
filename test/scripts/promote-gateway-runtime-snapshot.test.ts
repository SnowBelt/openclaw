import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCustomRuntimeCompletenessManifest } from "../../scripts/custom-runtime/custom-runtime-completeness.mjs";
import {
  promoteGatewayRuntimeSnapshot,
  resolveGatewayRuntimeSnapshotPromotionPolicy,
} from "../../scripts/promote-gateway-runtime-snapshot.mjs";

const temporaryDirectories: string[] = [];

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

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-snapshot-promotion-"));
  temporaryDirectories.push(root);
  const write = (relativePath: string, value = `${relativePath}\n`) => {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value, "utf8");
  };
  write("package.json", `${JSON.stringify({ name: "openclaw", version: "2026.7.13" })}\n`);
  write("ui/src/app/theme.ts", 'export type ThemeMode = "system" | "light" | "dark";\n');
  runGit(root, ["init", "-q"]);
  runGit(root, ["add", "package.json", "ui"]);
  runGit(root, ["commit", "-qm", "fixture source"]);
  const sourceSha = runGit(root, ["rev-parse", "HEAD"]);
  const buildId = "2026.7.13-test";
  write("dist/index.js", "console.log('index');\n");
  write("dist/entry.js", "console.log('entry');\n");
  write("dist/control-ui/index.html", "<!doctype html>\n");
  write(
    "dist/build-info.json",
    `${JSON.stringify({
      version: "2026.7.13",
      commit: sourceSha,
      builtAt: "2026-07-13T12:34:56.000Z",
    })}\n`,
  );
  write(
    "dist/control-ui/dashboard-surfaces.json",
    `${JSON.stringify({
      buildId,
      surfaces: [
        {
          id: "example",
          path: "/example",
          label: "Example",
          aliases: [],
          assets: ["assets/example.js"],
        },
      ],
    })}\n`,
  );
  write("dist/control-ui/assets/example.js");
  write("dist/control-ui/sw.js", `const BUILD_ID = ${JSON.stringify(buildId)};\n`);
  for (const template of [
    "AGENTS.md",
    "SOUL.md",
    "TOOLS.md",
    "IDENTITY.md",
    "USER.md",
    "HEARTBEAT.md",
    "BOOTSTRAP.md",
  ]) {
    write(`dist/templates/${template}`);
  }
  write("dist/.buildstamp", `${JSON.stringify({ head: sourceSha })}\n`);
  write("dist/.runtime-postbuildstamp", `${JSON.stringify({ head: sourceSha })}\n`);
  write("dist/extensions/example/index.d.ts", "export {}\n");
  write("dist/extensions/example/package.json", "{}\n");
  write("dist/extensions/node_modules/openclaw/plugin-sdk/runtime.js");
  write("dist-runtime/extensions/example/package.json", "{}\n");
  write("dist-runtime/extensions/example/index.js", "export {}\n");
  fs.symlinkSync(
    "../../../dist/extensions/example/index.d.ts",
    path.join(root, "dist-runtime/extensions/example/index.d.ts"),
  );
  writeCustomRuntimeCompletenessManifest(root);
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Gateway runtime snapshot promotion", () => {
  it("defaults on locally, defaults off in CI, and honors explicit controls", () => {
    expect(resolveGatewayRuntimeSnapshotPromotionPolicy({})).toEqual({ enabled: true });
    expect(resolveGatewayRuntimeSnapshotPromotionPolicy({ CI: "1" })).toEqual({
      enabled: false,
      reason: "ci",
    });
    expect(
      resolveGatewayRuntimeSnapshotPromotionPolicy({
        CI: "1",
        OPENCLAW_GATEWAY_RUNTIME_SNAPSHOT: "1",
      }),
    ).toEqual({ enabled: true });
    expect(
      resolveGatewayRuntimeSnapshotPromotionPolicy({
        OPENCLAW_GATEWAY_RUNTIME_SNAPSHOT: "0",
      }),
    ).toEqual({ enabled: false, reason: "disabled" });
  });

  it("atomically promotes an immutable content-addressed release with provenance", () => {
    const root = fixtureRoot();
    const result = promoteGatewayRuntimeSnapshot({ rootDir: root, env: {} });
    expect(result).toMatchObject({
      promoted: true,
      releaseId: expect.stringMatching(/^20260713T123456Z-[0-9a-f]{12}$/u),
      artifactHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    if (!result.promoted) {
      throw new Error("expected promotion");
    }
    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.releaseRoot, "snapshot.json"), "utf8"),
    ) as Record<string, unknown>;
    const latest = JSON.parse(
      fs.readFileSync(
        path.join(root, ".artifacts", "openclaw-gateway-runtime", "latest.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      version: 2,
      completenessVersion: 1,
      packageVersion: "2026.7.13",
      artifactHash: result.artifactHash,
      source: { commit: expect.stringMatching(/^[a-f0-9]{40}$/u) },
      schemas: {
        selfImprovementLedger: 1,
        selfImprovementRecommendationStore: 3,
        selfImprovementSignal: 1,
      },
    });
    expect(latest).toMatchObject({ releaseId: result.releaseId, root: result.releaseRoot });
    expect(fs.existsSync(path.join(result.releaseRoot, "dist", "control-ui", "index.html"))).toBe(
      true,
    );
    expect(
      fs.readlinkSync(path.join(result.releaseRoot, "dist-runtime/extensions/example/index.d.ts")),
    ).toBe("../../../dist/extensions/example/index.d.ts");
    expect(
      fs.realpathSync(path.join(result.releaseRoot, "dist-runtime/extensions/example/index.d.ts")),
    ).toBe(fs.realpathSync(path.join(result.releaseRoot, "dist/extensions/example/index.d.ts")));
    expect(
      fs.readdirSync(path.join(root, ".artifacts", "openclaw-gateway-runtime", "releases")),
    ).not.toContainEqual(expect.stringMatching(/^\.promoting-/u));
  });

  it("reuses an identical immutable release instead of overwriting it", () => {
    const root = fixtureRoot();
    const first = promoteGatewayRuntimeSnapshot({ rootDir: root, env: {} });
    const second = promoteGatewayRuntimeSnapshot({ rootDir: root, env: {} });
    expect(second).toMatchObject(first);
  });
});
