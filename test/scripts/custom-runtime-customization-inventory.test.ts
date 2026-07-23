import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCustomRuntimeCustomizationInventory } from "../../scripts/custom-runtime/custom-runtime-customization-inventory.js";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const temporaryDirectories = useAutoCleanupTempDirTracker(afterEach);

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function fixture() {
  const repo = fs.realpathSync(temporaryDirectories.make("custom-inventory-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "test@example.invalid"]);
  git(repo, ["config", "user.name", "Test"]);
  fs.mkdirSync(path.join(repo, "src", "pcc"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "pcc", "base.ts"), "export const base = true;\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "base"]);
  const upstream = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["switch", "-qc", "custom"]);
  fs.mkdirSync(path.join(repo, "extensions", "demo"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "extensions", "demo", "index.ts"),
    "export const demo = true;\n",
  );
  fs.writeFileSync(path.join(repo, "src", "pcc", "base.ts"), "export const base = false;\n");
  fs.writeFileSync(path.join(repo, "src", "uncovered.ts"), "export const uncovered = true;\n");
  fs.writeFileSync(path.join(repo, "ROOT-NOTE"), "manual\n");
  const manifestPath = path.join(repo, "manifest.json");
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({
      capabilities: [
        {
          id: "plugin:demo",
          requiredPaths: ["extensions/demo/index.ts"],
        },
        {
          id: "runtime:pcc",
          requiredPaths: ["src/pcc/base.ts"],
        },
      ],
    })}\n`,
  );
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "custom"]);
  return { manifestPath, repo, upstream };
}

describe("custom runtime customization inventory", () => {
  it("reports deterministic ownership, capability coverage, and divergence", () => {
    const input = fixture();
    const first = buildCustomRuntimeCustomizationInventory({
      capabilityManifestPath: input.manifestPath,
      headRef: "HEAD",
      repoRoot: input.repo,
      upstreamRef: input.upstream,
    });
    const second = buildCustomRuntimeCustomizationInventory({
      capabilityManifestPath: input.manifestPath,
      headRef: "HEAD",
      repoRoot: input.repo,
      upstreamRef: input.upstream,
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      changedLines: { additions: 5, deletions: 1 },
      divergence: {
        ahead: 1,
        behind: 0,
        equivalentPatches: 0,
        nonEquivalentPatches: 1,
      },
      summary: {
        changedPaths: 5,
        manualClassificationRequired: 3,
      },
    });
    expect(first.paths.find((entry) => entry.path === "extensions/demo/index.ts")).toMatchObject({
      capabilities: ["plugin:demo"],
      disposition: "plugin_owned",
      owner: "plugin:demo",
    });
    expect(first.paths.find((entry) => entry.path === "src/pcc/base.ts")).toMatchObject({
      capabilities: ["runtime:pcc"],
      disposition: "bounded_core_patch",
      owner: "core:pcc",
    });
    expect(first.paths.find((entry) => entry.path === "src/uncovered.ts")).toMatchObject({
      capabilities: [],
      disposition: "manual_classification_required",
      owner: "core:runtime",
    });
    expect(first.paths.find((entry) => entry.path === "ROOT-NOTE")).toMatchObject({
      disposition: "manual_classification_required",
      owner: "unowned",
    });
    expect(first.inventoryHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("binds capability ownership and changed paths to the exact committed head", () => {
    const input = fixture();
    const baseline = buildCustomRuntimeCustomizationInventory({
      capabilityManifestPath: input.manifestPath,
      headRef: "HEAD",
      repoRoot: input.repo,
      upstreamRef: input.upstream,
    });
    fs.writeFileSync(
      input.manifestPath,
      '{"capabilities":[{"id":"fake","requiredPaths":["src/uncommitted.ts"]}]}\n',
    );
    fs.writeFileSync(
      path.join(input.repo, "src", "uncommitted.ts"),
      "export const dirty = true;\n",
    );

    const dirty = buildCustomRuntimeCustomizationInventory({
      capabilityManifestPath: input.manifestPath,
      headRef: "HEAD",
      repoRoot: input.repo,
      upstreamRef: input.upstream,
    });

    expect(dirty).toEqual(baseline);
    expect(dirty.paths.some((entry) => entry.path === "src/uncommitted.ts")).toBe(false);
  });

  it("rejects an unknown upstream ref without writing files", () => {
    const input = fixture();
    expect(() =>
      buildCustomRuntimeCustomizationInventory({
        capabilityManifestPath: input.manifestPath,
        headRef: "HEAD",
        repoRoot: input.repo,
        upstreamRef: "missing-upstream",
      }),
    ).toThrow(/unknown revision|Needed a single revision|ambiguous argument/u);
    expect(git(input.repo, ["status", "--short"])).toBe("");
  });
});
