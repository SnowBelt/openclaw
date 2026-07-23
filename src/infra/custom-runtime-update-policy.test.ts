import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  CUSTOM_RUNTIME_UPDATE_BROKER_REQUIRED_REASON,
  resolveCustomRuntimeUpdatePolicy,
} from "./custom-runtime-update-policy.js";

const temporaryDirectories = useAutoCleanupTempDirTracker(afterEach);

function fixture(sourceShaOverride?: string) {
  const homedir = fs.realpathSync(temporaryDirectories.make("openclaw-update-policy-"));
  const runtimeRoot = path.join(homedir, ".openclaw-runtime-releases", "candidate");
  const pointerPath = path.join(homedir, ".openclaw-custom-runtime", "active-runtime.json");
  const sourceRepo = path.join(homedir, "source");
  fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
  fs.mkdirSync(sourceRepo);
  expect(spawnSync("git", ["init", "-q", sourceRepo]).status).toBe(0);
  expect(
    spawnSync("git", ["-C", sourceRepo, "config", "user.email", "test@example.invalid"]).status,
  ).toBe(0);
  expect(spawnSync("git", ["-C", sourceRepo, "config", "user.name", "Test"]).status).toBe(0);
  fs.writeFileSync(path.join(sourceRepo, "source.txt"), "source\n");
  expect(spawnSync("git", ["-C", sourceRepo, "add", "source.txt"]).status).toBe(0);
  expect(spawnSync("git", ["-C", sourceRepo, "commit", "-qm", "source"]).status).toBe(0);
  const sourceSha =
    sourceShaOverride ??
    spawnSync("git", ["-C", sourceRepo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
  const sourceBranch = spawnSync("git", ["-C", sourceRepo, "branch", "--show-current"], {
    encoding: "utf8",
  }).stdout.trim();
  const sourceGitCommonDir = path.join(sourceRepo, ".git");
  fs.writeFileSync(
    pointerPath,
    `${JSON.stringify({
      runtimeRoot,
      entrypoint: path.join(runtimeRoot, "dist", "index.js"),
      sourceSha,
      sourceRepo,
      sourceGitCommonDir,
      sourceBranch,
      sourceRemoteUrl: "https://github.com/SnowBelt/openclaw.git",
      sourceRemoteRef: `refs/heads/${sourceBranch}`,
      sourceRemoteSha: sourceSha,
      sourceRemoteVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
    })}\n`,
  );
  return { homedir, pointerPath, runtimeRoot, sourceBranch, sourceRepo, sourceSha };
}

describe("custom runtime update policy", () => {
  it("blocks generic updates for the active immutable runtime", () => {
    const value = fixture();
    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result).toMatchObject({
      managedRuntime: true,
      standardUpdateBlocked: true,
      sourceDurable: true,
      sourceSha: value.sourceSha,
      sourceBranch: value.sourceBranch,
      runtimeRoot: value.runtimeRoot,
    });
    expect(CUSTOM_RUNTIME_UPDATE_BROKER_REQUIRED_REASON).toBe(
      "custom-runtime-update-broker-required",
    );
  });

  it("does not block an unrelated source checkout with a stale pointer", () => {
    const value = fixture();
    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", "/workspace/openclaw/dist/index.js"],
      env: {},
    });

    expect(result.managedRuntime).toBe(false);
    expect(result.standardUpdateBlocked).toBe(false);
  });

  it("marks provenance hashes as non-durable sources", () => {
    const value = fixture("b".repeat(64));
    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.standardUpdateBlocked).toBe(true);
    expect(result.sourceDurable).toBe(false);
  });

  it("marks a source without exact remote recovery provenance as non-durable", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete pointer.sourceRemoteSha;
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
  });

  it("rejects a clean source checkout whose HEAD moved away from the active source SHA", () => {
    const value = fixture();
    fs.writeFileSync(path.join(value.sourceRepo, "source.txt"), "new source\n");
    expect(spawnSync("git", ["-C", value.sourceRepo, "add", "source.txt"]).status).toBe(0);
    expect(
      spawnSync("git", ["-C", value.sourceRepo, "commit", "-qm", "move source head"]).status,
    ).toBe(0);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
  });

  it("rejects future-dated remote verification evidence", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    pointer.sourceRemoteVerifiedAt = "2999-01-01T00:00:00Z";
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
  });

  it("rejects expired remote verification evidence", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    pointer.sourceRemoteVerifiedAt = new Date(Date.now() - 9 * 24 * 60 * 60 * 1_000).toISOString();
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
  });

  it("accepts a fresh exact-identity provenance receipt when pointer evidence expires", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    pointer.sourceRemoteVerifiedAt = new Date(Date.now() - 9 * 24 * 60 * 60 * 1_000).toISOString();
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);
    const receipts = path.join(path.dirname(value.pointerPath), "receipts");
    fs.mkdirSync(receipts);
    fs.writeFileSync(
      path.join(receipts, "source-provenance-20260723T120000Z.json"),
      `${JSON.stringify({
        schema: "openclaw.custom-runtime-source-provenance.v1",
        result: "passed",
        sourceSha: value.sourceSha,
        sourceRemoteUrl: pointer.sourceRemoteUrl,
        sourceRemoteRef: pointer.sourceRemoteRef,
        sourceRemoteSha: value.sourceSha,
        verifiedAt: new Date(Date.now() - 60_000).toISOString(),
      })}\n`,
    );

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(true);
  });

  it("finds a matching fresh receipt even when a newer receipt belongs to another source", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    pointer.sourceRemoteVerifiedAt = new Date(Date.now() - 9 * 24 * 60 * 60 * 1_000).toISOString();
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);
    const receipts = path.join(path.dirname(value.pointerPath), "receipts");
    fs.mkdirSync(receipts);
    const receipt = (sourceSha: string) => ({
      schema: "openclaw.custom-runtime-source-provenance.v1",
      result: "passed",
      sourceSha,
      sourceRemoteUrl: pointer.sourceRemoteUrl,
      sourceRemoteRef: pointer.sourceRemoteRef,
      sourceRemoteSha: sourceSha,
      verifiedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    fs.writeFileSync(
      path.join(receipts, "source-provenance-20260723T120000Z.json"),
      `${JSON.stringify(receipt(value.sourceSha))}\n`,
    );
    fs.writeFileSync(
      path.join(receipts, "source-provenance-20260723T130000Z.json"),
      `${JSON.stringify(receipt("f".repeat(40)))}\n`,
    );

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(true);
  });

  it("rejects arbitrary directories that are not the declared Git checkout and object store", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    const arbitrary = path.join(value.homedir, "arbitrary");
    fs.mkdirSync(arbitrary);
    pointer.sourceRepo = arbitrary;
    pointer.sourceGitCommonDir = arbitrary;
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
  });

  it("marks a source without a durable Git object store as non-durable", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete pointer.sourceGitCommonDir;
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
  });

  it("rejects remote URLs with embedded credentials", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    pointer.sourceRemoteUrl = "https://secret@example.invalid/openclaw.git";
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
  });

  it("rejects Git remote helpers that can execute commands", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    pointer.sourceRemoteUrl = "ext::sh -c touch /tmp/should-not-run";
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      pointerPath: value.pointerPath,
      env: {},
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
    });

    expect(result.sourceDurable).toBe(false);
  });

  it("rejects ephemeral remote refs even when Git accepts their syntax", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    pointer.sourceRemoteRef = "refs/pull/31/head";
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
  });

  it("marks a source checkout outside the durable source root as non-durable", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    pointer.sourceRepo = temporaryDirectories.make("transient-openclaw-source-");
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.standardUpdateBlocked).toBe(true);
    expect(result.sourceDurable).toBe(false);
  });

  it("allows an explicit persistent source root outside the home directory", () => {
    const value = fixture();
    const externalRoot = fs.realpathSync(
      temporaryDirectories.make("openclaw-external-source-root-"),
    );
    const externalSource = path.join(externalRoot, "source");
    fs.cpSync(value.sourceRepo, externalSource, { recursive: true });
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    pointer.sourceRepo = externalSource;
    pointer.sourceGitCommonDir = path.join(externalSource, ".git");
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      durableSourceRoot: externalRoot,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(true);
  });

  it("rejects a symlinked source checkout", () => {
    const value = fixture();
    const pointer = JSON.parse(fs.readFileSync(value.pointerPath, "utf8")) as Record<
      string,
      unknown
    >;
    const sourceLink = path.join(value.homedir, "source-link");
    fs.symlinkSync(path.join(value.homedir, "source"), sourceLink);
    pointer.sourceRepo = sourceLink;
    fs.writeFileSync(value.pointerPath, `${JSON.stringify(pointer)}\n`);

    const result = resolveCustomRuntimeUpdatePolicy({
      homedir: value.homedir,
      argv: ["node", path.join(value.runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: value.runtimeRoot },
    });

    expect(result.sourceDurable).toBe(false);
  });
});
