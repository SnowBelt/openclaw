import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCustomRuntimeRetentionPlan } from "../../scripts/custom-runtime/custom-runtime-retention-plan.js";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const script = path.resolve("scripts/custom-runtime/custom-runtime-retention-plan.ts");
const temporaryDirectories = useAutoCleanupTempDirTracker(afterEach);
const sourceSha = "a".repeat(40);

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function writeRelease(releases: string, releaseId: string, canonical = true): string {
  const release = path.join(releases, releaseId);
  fs.mkdirSync(path.join(release, "dist"), { recursive: true });
  if (canonical) {
    fs.writeFileSync(path.join(release, ".openclaw-production-sha"), `${sourceSha}\n`);
    fs.writeFileSync(path.join(release, "dist", "index.js"), "export {};\n");
  }
  return release;
}

function fixture() {
  const home = fs.realpathSync(temporaryDirectories.make("runtime-retention-"));
  const releases = path.join(home, "releases");
  const runtimeHome = path.join(home, "runtime-home");
  fs.mkdirSync(releases);
  fs.mkdirSync(runtimeHome);

  const releaseIds = {
    active: "20250101T000000Z-active",
    eligible: "20250102T000000Z-eligible",
    lastKnownGood: "20250103T000000Z-last-known-good",
    newest: "20250108T000000Z-newest",
    pending: "20250104T000000Z-pending",
    recent: "20260225T000000Z-recent",
    rollbackCandidate: "20250105T000000Z-rollback-candidate",
    rollbackTarget: "20250106T000000Z-rollback-target",
    unclassified: "20250107T000000Z-unclassified",
  };
  for (const releaseId of Object.values(releaseIds)) {
    writeRelease(releases, releaseId, releaseId !== releaseIds.unclassified);
  }
  writeJson(path.join(runtimeHome, "active-runtime.json"), {
    releaseId: releaseIds.active,
    runtimeRoot: path.join(releases, releaseIds.active),
  });
  writeJson(path.join(runtimeHome, "last-known-good.json"), {
    releaseId: releaseIds.lastKnownGood,
    runtimeRoot: path.join(releases, releaseIds.lastKnownGood),
  });
  writeJson(path.join(runtimeHome, "active-rollback.json"), {
    candidateReleaseId: releaseIds.rollbackCandidate,
    candidateRuntimeReleaseId: "runtime-snapshot-id",
    rollbackReleaseId: releaseIds.rollbackTarget,
  });
  writeJson(path.join(runtimeHome, "pending-update.json"), {
    release: path.join(releases, releaseIds.pending),
  });
  return { home, releaseIds, releases, runtimeHome };
}

function buildFixturePlan(input: ReturnType<typeof fixture>) {
  return buildCustomRuntimeRetentionPlan({
    releasesDirectory: input.releases,
    runtimeHome: input.runtimeHome,
  });
}

describe("custom runtime retention plan", () => {
  it("protects every live recovery identity and selects only old canonical releases", () => {
    const input = fixture();
    const plan = buildCustomRuntimeRetentionPlan({
      keepNewest: 1,
      minimumAgeDays: 14,
      now: new Date("2026-03-01T00:00:00Z"),
      releasesDirectory: input.releases,
      runtimeHome: input.runtimeHome,
    });
    const entry = (releaseId: string) =>
      plan.releases.find((release) => release.releaseId === releaseId);

    expect(entry(input.releaseIds.active)).toMatchObject({
      action: "retain",
      reasons: ["active_runtime"],
    });
    expect(entry(input.releaseIds.lastKnownGood)?.reasons).toContain("last_known_good");
    expect(entry(input.releaseIds.pending)?.reasons).toContain("pending_update");
    expect(entry(input.releaseIds.rollbackCandidate)?.reasons).toContain(
      "registered_rollback_candidate",
    );
    expect(entry(input.releaseIds.rollbackTarget)?.reasons).toContain("registered_rollback_target");
    expect(entry(input.releaseIds.recent)?.reasons).toEqual([
      "newest_canonical_release",
      "within_minimum_age",
    ]);
    expect(entry(input.releaseIds.unclassified)).toMatchObject({
      action: "retain",
      classification: "unclassified",
    });
    expect(entry(input.releaseIds.eligible)).toMatchObject({
      action: "eligible_for_quarantine",
      classification: "canonical",
      reasons: [],
    });
    expect(plan.destructiveOperationsPermitted).toBe(false);
  });

  it("is deterministic for the same filesystem state and evaluation time", () => {
    const input = fixture();
    const options = {
      keepNewest: 2,
      minimumAgeDays: 30,
      now: new Date("2026-03-01T00:00:00Z"),
      releasesDirectory: input.releases,
      runtimeHome: input.runtimeHome,
    };
    const first = buildCustomRuntimeRetentionPlan(options);
    const second = buildCustomRuntimeRetentionPlan(options);

    expect(second).toEqual(first);
    expect(first.planHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed when a protected pointer is malformed", () => {
    const input = fixture();
    fs.writeFileSync(path.join(input.runtimeHome, "active-runtime.json"), "{not-json\n");

    expect(() => buildFixturePlan(input)).toThrow(/invalid retention protection state/u);
  });

  it("fails closed when the active runtime protection state is missing", () => {
    const input = fixture();
    fs.rmSync(path.join(input.runtimeHome, "active-runtime.json"));

    expect(() => buildFixturePlan(input)).toThrow("active runtime protection state is missing");
  });

  it.each([
    {
      expected: "active runtime release identity is invalid",
      field: "releaseId",
      name: "releaseId",
    },
    {
      expected: "active runtime runtimeRoot does not identify an immutable release",
      field: "runtimeRoot",
      name: "runtimeRoot",
    },
  ] as const)("fails closed when active runtime $name is missing", ({ expected, field }) => {
    const input = fixture();
    const activePath = path.join(input.runtimeHome, "active-runtime.json");
    const active = JSON.parse(fs.readFileSync(activePath, "utf8")) as Record<string, unknown>;
    delete active[field];
    writeJson(activePath, active);

    expect(() => buildFixturePlan(input)).toThrow(expected);
  });

  it.each(["releaseId", "runtimeRoot"] as const)(
    "fails closed when last-known-good runtime %s is missing",
    (field) => {
      const input = fixture();
      const statePath = path.join(input.runtimeHome, "last-known-good.json");
      const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
      delete state[field];
      writeJson(statePath, state);

      expect(() => buildFixturePlan(input)).toThrow(
        field === "releaseId"
          ? "last-known-good runtime release identity is invalid"
          : "last-known-good runtime runtimeRoot does not identify an immutable release",
      );
    },
  );

  it.each([
    ["candidateReleaseId", "registered rollback candidate release identity is invalid"],
    ["candidateRuntimeReleaseId", "registered rollback candidate runtime identity is invalid"],
    ["rollbackReleaseId", "registered rollback target release identity is invalid"],
  ] as const)("fails closed when rollback %s is missing", (field, expected) => {
    const input = fixture();
    const statePath = path.join(input.runtimeHome, "active-rollback.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
    delete state[field];
    writeJson(statePath, state);

    expect(() => buildFixturePlan(input)).toThrow(expected);
  });

  it("fails closed when the pending update release identity is missing", () => {
    const input = fixture();
    writeJson(path.join(input.runtimeHome, "pending-update.json"), {
      sourceSha,
    });

    expect(() => buildFixturePlan(input)).toThrow(
      "pending update does not identify an immutable release",
    );
  });

  it.each(["active", "lastKnownGood", "rollbackCandidate", "rollbackTarget", "pending"] as const)(
    "fails closed when the protected %s release is absent",
    (protectedState) => {
      const input = fixture();
      const releaseId = input.releaseIds[protectedState];
      fs.rmSync(path.join(input.releases, releaseId), { recursive: true });

      expect(() => buildFixturePlan(input)).toThrow(`protected release is missing: ${releaseId}`);
    },
  );

  it("allows absent optional recovery and update records", () => {
    const input = fixture();
    for (const stateFile of [
      "last-known-good.json",
      "active-rollback.json",
      "pending-update.json",
    ]) {
      fs.rmSync(path.join(input.runtimeHome, stateFile));
    }

    const plan = buildFixturePlan(input);

    expect(
      plan.releases.find((release) => release.releaseId === input.releaseIds.active),
    ).toMatchObject({
      action: "retain",
      reasons: ["active_runtime"],
    });
  });

  it("fails closed when a pointer release identity conflicts with its runtime root", () => {
    const input = fixture();
    writeJson(path.join(input.runtimeHome, "active-runtime.json"), {
      releaseId: input.releaseIds.active,
      runtimeRoot: path.join(input.releases, input.releaseIds.eligible),
    });

    expect(() => buildFixturePlan(input)).toThrow(/releaseId does not match runtimeRoot/u);
  });

  it("has no apply or delete mode", () => {
    const input = fixture();
    const before = fs.readdirSync(input.releases).toSorted();
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        script,
        "--releases-dir",
        input.releases,
        "--runtime-home",
        input.runtimeHome,
        "--apply",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(64);
    expect(result.stderr).toContain("unsupported argument: --apply");
    expect(fs.readdirSync(input.releases).toSorted()).toEqual(before);
  });
});
