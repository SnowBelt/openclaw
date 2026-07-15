import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  promoteGatewayRuntimeSnapshot,
  resolveGatewayRuntimeSnapshotPromotionPolicy,
} from "../../scripts/promote-gateway-runtime-snapshot.mjs";

const temporaryDirectories: string[] = [];

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-snapshot-promotion-"));
  temporaryDirectories.push(root);
  const write = (relativePath: string, value: string) => {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value, "utf8");
  };
  write("package.json", `${JSON.stringify({ name: "openclaw", version: "2026.7.13" })}\n`);
  write("dist/index.js", "console.log('index');\n");
  write("dist/entry.js", "console.log('entry');\n");
  write("dist/control-ui/index.html", "<!doctype html>\n");
  write(
    "dist/build-info.json",
    `${JSON.stringify({
      version: "2026.7.13",
      commit: "a".repeat(40),
      builtAt: "2026-07-13T12:34:56.000Z",
    })}\n`,
  );
  write("dist/.buildstamp", `${JSON.stringify({ head: "a".repeat(40) })}\n`);
  write("dist/.runtime-postbuildstamp", `${JSON.stringify({ head: "a".repeat(40) })}\n`);
  write("dist-runtime/extensions/example/package.json", "{}\n");
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
      packageVersion: "2026.7.13",
      artifactHash: result.artifactHash,
      source: { commit: "a".repeat(40) },
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
