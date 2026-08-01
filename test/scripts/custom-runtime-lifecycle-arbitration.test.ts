import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const authScript = path.join(process.cwd(), "scripts", "custom-runtime", "custom-runtime-auth.sh");
const promoteScript = path.join(
  process.cwd(),
  "scripts",
  "custom-runtime",
  "custom-runtime-promote.sh",
);
const activeSha = "1".repeat(40);
const candidateSha = "2".repeat(40);
const leaseBinding = [
  "--active-sha",
  activeSha,
  "--candidate-sha",
  candidateSha,
  "--owner",
  "codex:pr-41",
  "--operation-class",
  "release-certification",
  "--approval-id",
  "release-governor:pr-41",
  "--operation-id",
  "certification:pr-41",
  "--invocation-id",
  "certification-pr-41",
];

function fixture() {
  const home = mkdtempSync(path.join(os.tmpdir(), "openclaw-lifecycle-arbitration-"));
  roots.push(home);
  const runtimeHome = path.join(home, ".openclaw-custom-runtime");
  mkdirSync(path.join(runtimeHome, "receipts"), { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(runtimeHome, "active-runtime.json"),
    `${JSON.stringify({ sourceSha: activeSha })}\n`,
    { mode: 0o600 },
  );
  return {
    env: {
      ...process.env,
      HOME: home,
      OPENCLAW_CUSTOM_RUNTIME_HOME: runtimeHome,
    },
    home,
    runtimeHome,
  };
}

function lifecycleCommand(runtimeHome: string, operation: string, holdSeconds = 0) {
  return [
    "set -eu",
    `. "${authScript}"`,
    `custom_runtime_lifecycle_begin "${runtimeHome}" "${operation}" "${activeSha}" "${candidateSha}"`,
    holdSeconds > 0 ? `sleep ${holdSeconds}` : ":",
    `custom_runtime_lifecycle_finish "${runtimeHome}" "${operation}-complete" 0`,
  ].join("\n");
}

function runChild(command: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ status: number | null; stderr: string; stdout: string }>((resolve) => {
    const child = spawn("sh", ["-c", command], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (status) => {
      resolve({ status, stderr, stdout });
    });
  });
}

async function waitForPath(target: string) {
  const deadline = Date.now() + 5_000;
  while (!existsSync(target)) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${target}`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("custom runtime lifecycle arbitration", () => {
  it("requires an exact owner-authorized transition before same-candidate promotion", () => {
    const input = fixture();
    const acquired = spawnSync(
      "sh",
      [promoteScript, "--lease-acquire", ...leaseBinding, "--ttl-seconds", "600"],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(acquired.status, acquired.stderr).toBe(0);
    const replayedAcquire = spawnSync(
      "sh",
      [promoteScript, "--lease-acquire", ...leaseBinding, "--ttl-seconds", "600"],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(replayedAcquire.status, replayedAcquire.stderr).toBe(0);
    expect(replayedAcquire.stdout.trim()).toBe(acquired.stdout.trim());

    const premature = spawnSync(
      "sh",
      [
        "-c",
        `. "${authScript}"
custom_runtime_certification_lease verify-promotion "$OPENCLAW_CUSTOM_RUNTIME_HOME" "${activeSha}" "${candidateSha}" "" "" "" "" "" "" ""`,
      ],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(premature.status).toBe(75);
    expect(premature.stderr).toContain("same-candidate promotion is not owner-authorized yet");

    const wrongOwner = spawnSync(
      "sh",
      [
        promoteScript,
        "--lease-authorize-promotion",
        ...leaseBinding.map((value) => (value === "codex:pr-41" ? "codex:other" : value)),
      ],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(wrongOwner.status).toBe(78);

    const wrongActor = spawnSync(
      "sh",
      [promoteScript, "--lease-authorize-promotion", ...leaseBinding],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...input.env, OPENCLAW_CUSTOM_RUNTIME_LIFECYCLE_ACTOR: "other-actor" },
      },
    );
    expect(wrongActor.status).toBe(78);
    expect(wrongActor.stderr).toContain("lease actor does not match");

    const authorized = spawnSync(
      "sh",
      [promoteScript, "--lease-authorize-promotion", ...leaseBinding],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(authorized.status, authorized.stderr).toBe(0);
    const replayedAuthorization = spawnSync(
      "sh",
      [promoteScript, "--lease-authorize-promotion", ...leaseBinding],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(replayedAuthorization.status, replayedAuthorization.stderr).toBe(0);
    expect(replayedAuthorization.stdout.trim()).toBe(authorized.stdout.trim());
    expect(
      JSON.parse(readFileSync(path.join(input.runtimeHome, "certification-lease.json"), "utf8")),
    ).toMatchObject({
      activeSha,
      candidateSha,
      state: "promotion-authorized",
    });

    const verified = spawnSync(
      "sh",
      [
        "-c",
        `. "${authScript}"
custom_runtime_certification_lease verify-promotion "$OPENCLAW_CUSTOM_RUNTIME_HOME" "${activeSha}" "${candidateSha}" "" "" "" "" "" "" ""`,
      ],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(verified.status, verified.stderr).toBe(0);
  });

  it("retains one exact rollback-and-restoration drill under the promoted lease", () => {
    const input = fixture();
    const leasePath = path.join(input.runtimeHome, "certification-lease.json");
    const runLeaseAction = (action: string, fromSha: string, toSha: string) =>
      spawnSync(
        "sh",
        [
          "-c",
          `. "${authScript}"
custom_runtime_certification_lease "${action}" "$OPENCLAW_CUSTOM_RUNTIME_HOME" "${fromSha}" "${toSha}" "" "" "" "" "" "" ""`,
        ],
        { cwd: process.cwd(), encoding: "utf8", env: input.env },
      );
    const writePointer = (sourceSha: string) => {
      writeFileSync(
        path.join(input.runtimeHome, "active-runtime.json"),
        `${JSON.stringify({ sourceSha })}\n`,
        { mode: 0o600 },
      );
    };

    expect(
      spawnSync("sh", [promoteScript, "--lease-acquire", ...leaseBinding, "--ttl-seconds", "600"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: input.env,
      }).status,
    ).toBe(0);
    expect(
      spawnSync("sh", [promoteScript, "--lease-authorize-promotion", ...leaseBinding], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: input.env,
      }).status,
    ).toBe(0);
    writePointer(candidateSha);
    const promoted = runLeaseAction("record-promoted", activeSha, candidateSha);
    expect(promoted.status, promoted.stderr).toBe(0);
    const replayedPromotion = runLeaseAction("record-promoted", activeSha, candidateSha);
    expect(replayedPromotion.status, replayedPromotion.stderr).toBe(0);
    expect(replayedPromotion.stdout.trim()).toBe(promoted.stdout.trim());

    const wrongTarget = runLeaseAction("verify-rollback", candidateSha, "3".repeat(40));
    expect(wrongTarget.status).toBe(75);
    expect(wrongTarget.stderr).toContain(
      "rollback drill does not match the certified active/candidate pair",
    );

    const authorized = runLeaseAction("verify-rollback", candidateSha, activeSha);
    expect(authorized.status, authorized.stderr).toBe(0);
    expect(JSON.parse(readFileSync(authorized.stdout.trim(), "utf8"))).toMatchObject({
      result: "rollback-authorized",
    });

    writePointer(activeSha);
    const rolledBack = runLeaseAction("record-rolled-back", candidateSha, activeSha);
    expect(rolledBack.status, rolledBack.stderr).toBe(0);
    expect(JSON.parse(readFileSync(leasePath, "utf8"))).toMatchObject({
      activeSha,
      candidateSha,
      rollbackSha: activeSha,
      state: "rollback-drill",
    });

    const heartbeat = spawnSync("sh", [promoteScript, "--lease-heartbeat", ...leaseBinding], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: input.env,
    });
    expect(heartbeat.status, heartbeat.stderr).toBe(0);
    expect(runLeaseAction("verify-restart", activeSha, activeSha).status).toBe(0);

    const repeatedRollback = runLeaseAction("verify-rollback", candidateSha, activeSha);
    expect(repeatedRollback.status).toBe(75);
    expect(repeatedRollback.stderr).toContain(
      "rollback drill requires the certified candidate to be promoted",
    );

    expect(runLeaseAction("verify-promotion", activeSha, candidateSha).status).toBe(0);
    writePointer(candidateSha);
    const restored = runLeaseAction("record-promoted", activeSha, candidateSha);
    expect(restored.status, restored.stderr).toBe(0);
    expect(JSON.parse(readFileSync(restored.stdout.trim(), "utf8"))).toMatchObject({
      result: "restored",
    });
    expect(JSON.parse(readFileSync(leasePath, "utf8"))).toMatchObject({
      activeSha,
      candidateSha,
      rollbackSha: activeSha,
      state: "promoted",
    });
  });

  it("binds a distinct rollback SHA and releases for same-active certification", () => {
    const input = fixture();
    const rollbackSha = "3".repeat(40);
    writeFileSync(
      path.join(input.runtimeHome, "active-runtime.json"),
      `${JSON.stringify({ sourceSha: activeSha, releaseId: "release-active" })}\n`,
      { mode: 0o600 },
    );
    const sameActiveBinding = [
      "--active-sha",
      activeSha,
      "--candidate-sha",
      activeSha,
      "--owner",
      "codex:same-active",
      "--operation-class",
      "release-certification",
      "--approval-id",
      "release-governor:same-active",
      "--operation-id",
      "certification:same-active",
      "--invocation-id",
      "certification-same-active",
    ];
    const acquired = spawnSync(
      "sh",
      [
        promoteScript,
        "--lease-acquire",
        ...sameActiveBinding,
        "--rollback-sha",
        rollbackSha,
        "--active-release-id",
        "release-active",
        "--rollback-release-id",
        "release-rollback",
        "--ttl-seconds",
        "600",
      ],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(acquired.status, acquired.stderr).toBe(0);
    expect(
      JSON.parse(readFileSync(path.join(input.runtimeHome, "certification-lease.json"), "utf8")),
    ).toMatchObject({
      activeSha,
      candidateSha: activeSha,
      rollbackSha,
      activeReleaseId: "release-active",
      rollbackReleaseId: "release-rollback",
    });

    expect(
      spawnSync("sh", [promoteScript, "--lease-authorize-promotion", ...sameActiveBinding], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: input.env,
      }).status,
    ).toBe(0);
    const promoted = spawnSync(
      "sh",
      [
        "-c",
        `. "${authScript}"
custom_runtime_certification_lease record-promoted "$OPENCLAW_CUSTOM_RUNTIME_HOME" "${activeSha}" "${activeSha}" "" "" "" "" "" "" ""`,
      ],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(promoted.status, promoted.stderr).toBe(0);
    const rollback = spawnSync(
      "sh",
      [
        "-c",
        `. "${authScript}"
custom_runtime_certification_lease verify-rollback "$OPENCLAW_CUSTOM_RUNTIME_HOME" "${activeSha}" "${rollbackSha}" "" "" "" "" "" "" "" "" "${rollbackSha}" "release-active" "release-rollback"`,
      ],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(rollback.status, rollback.stderr).toBe(0);
  });

  it("fails closed for malformed, future-dated, and excessive-duration leases", () => {
    const input = fixture();
    const leasePath = path.join(input.runtimeHome, "certification-lease.json");
    const status = () =>
      spawnSync("sh", [promoteScript, "--lease-status"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: input.env,
      });

    writeFileSync(leasePath, "{broken\n", { mode: 0o600 });
    const malformed = status();
    expect(malformed.status).toBe(78);
    expect(malformed.stderr).toContain("lease is malformed");

    const baseLease = {
      activeSha,
      actor: "codex",
      approvalId: "release-governor:pr-41",
      candidateSha,
      rollbackSha: activeSha,
      invocationId: "certification-pr-41",
      operationClass: "release-certification",
      operationId: "certification:pr-41",
      owner: "codex:pr-41",
      pid: process.pid,
      schema: "openclaw.custom-runtime-certification-lease.v2",
      state: "acquired",
    };
    writeFileSync(
      leasePath,
      `${JSON.stringify({
        ...baseLease,
        createdAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      })}\n`,
      { mode: 0o600 },
    );
    const future = status();
    expect(future.status).toBe(78);
    expect(future.stderr).toContain("creation time is in the future");

    writeFileSync(
      leasePath,
      `${JSON.stringify({
        ...baseLease,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 25 * 60 * 60_000).toISOString(),
      })}\n`,
      { mode: 0o600 },
    );
    const excessive = status();
    expect(excessive.status).toBe(78);
    expect(excessive.stderr).toContain("lease duration exceeds the maximum");

    writeFileSync(
      leasePath,
      `${JSON.stringify({
        ...baseLease,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        heartbeatAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        heartbeatRequired: true,
        heartbeatSequence: 1,
      })}\n`,
      { mode: 0o600 },
    );
    const futureHeartbeat = status();
    expect(futureHeartbeat.status).toBe(78);
    expect(futureHeartbeat.stderr).toContain("heartbeat time is in the future");

    writeFileSync(
      leasePath,
      `${JSON.stringify({
        ...baseLease,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        heartbeatAt: new Date().toISOString(),
        heartbeatRequired: true,
        heartbeatSequence: -1,
      })}\n`,
      { mode: 0o600 },
    );
    const malformedHeartbeat = status();
    expect(malformedHeartbeat.status).toBe(78);
    expect(malformedHeartbeat.stderr).toContain("heartbeat sequence is missing or invalid");
  });

  it("serializes concurrent promote, activate, restart, rollback, and guard contenders", async () => {
    const input = fixture();
    const lockOwner = path.join(input.runtimeHome, "locks", "lifecycle.lock", "owner.json");
    const holder = runChild(lifecycleCommand(input.runtimeHome, "promotion", 2), input.env);
    await waitForPath(lockOwner);

    const operations = ["activation", "promotion", "restart", "rollback", "guard"];
    const contenders = await Promise.all(
      Array.from({ length: 15 }, (_, index) =>
        runChild(
          lifecycleCommand(input.runtimeHome, operations[index % operations.length] ?? "guard"),
          input.env,
        ),
      ),
    );
    for (const contender of contenders) {
      expect(contender.status).toBe(75);
      expect(contender.stderr).toContain("lifecycle operation is active");
    }
    const held = await holder;
    expect(held.status, held.stderr).toBe(0);
    expect(existsSync(path.dirname(lockOwner))).toBe(false);

    const receipts = readdirSync(path.join(input.runtimeHome, "receipts")).filter((name) =>
      name.startsWith("lifecycle-promotion-"),
    );
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(
      readFileSync(path.join(input.runtimeHome, "receipts", receipts[0] ?? ""), "utf8"),
    );
    expect(receipt).toMatchObject({
      activeSha,
      actor: expect.any(String),
      approvalId: "pending:release-governor-verification",
      candidateSha,
      exitCode: 0,
      invocationId: expect.any(String),
      operation: "promotion",
      operationId: "custom-runtime:promotion",
      pid: expect.any(Number),
      result: "promotion-complete",
      schema: "openclaw.custom-runtime-lifecycle-receipt.v1",
    });
    expect(receipt.createdAt).toEqual(expect.any(String));
    expect(receipt.finishedAt).toEqual(expect.any(String));
  });

  it("serializes heartbeat and orphan recovery with every managed lifecycle mutation", async () => {
    const input = fixture();
    const leasePath = path.join(input.runtimeHome, "certification-lease.json");
    const lockOwner = path.join(input.runtimeHome, "locks", "lifecycle.lock", "owner.json");
    const acquired = spawnSync(
      "sh",
      [promoteScript, "--lease-acquire", ...leaseBinding, "--ttl-seconds", "600"],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(acquired.status, acquired.stderr).toBe(0);

    const holder = runChild(lifecycleCommand(input.runtimeHome, "promotion", 2), input.env);
    await waitForPath(lockOwner);
    const heartbeat = runChild(
      [promoteScript, "--lease-heartbeat", ...leaseBinding]
        .map((part) => `'${part.replaceAll("'", "'\\''")}'`)
        .join(" "),
      input.env,
    );
    const orphanRecovery = runChild(
      [
        promoteScript,
        "--lease-recover-orphaned",
        ...leaseBinding,
        "--recovery-approval-id",
        "release-governor:orphan-recovery:approved",
        "--activity-proof",
        path.join(input.runtimeHome, "unused-proof.json"),
        "--github-repo",
        "SnowBelt/openclaw",
        "--reason",
        "owner-heartbeat-stale",
      ]
        .map((part) => `'${part.replaceAll("'", "'\\''")}'`)
        .join(" "),
      input.env,
    );
    const [heartbeatResult, recoveryResult] = await Promise.all([heartbeat, orphanRecovery]);
    for (const contender of [heartbeatResult, recoveryResult]) {
      expect(contender.status).toBe(75);
      expect(contender.stderr).toContain("lifecycle operation is active");
    }
    const lease = JSON.parse(readFileSync(leasePath, "utf8"));
    expect(lease).toMatchObject({ heartbeatSequence: 0, state: "acquired" });

    const held = await holder;
    expect(held.status, held.stderr).toBe(0);
  });

  it("invalidates certification only through an approved typed emergency receipt", () => {
    const input = fixture();
    const acquired = spawnSync(
      "sh",
      [promoteScript, "--lease-acquire", ...leaseBinding, "--ttl-seconds", "600"],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(acquired.status, acquired.stderr).toBe(0);
    const leasePath = path.join(input.runtimeHome, "certification-lease.json");

    const denied = spawnSync(
      "sh",
      [
        "-c",
        `. "${authScript}"
custom_runtime_certification_lease break-emergency "$OPENCLAW_CUSTOM_RUNTIME_HOME" "" "" "" "" "" "" "" "" "operator-recovery"`,
      ],
      { cwd: process.cwd(), encoding: "utf8", env: input.env },
    );
    expect(denied.status).toBe(78);
    expect(denied.stderr).toContain("Release Governor approval identity is missing");
    expect(existsSync(leasePath)).toBe(true);

    const invalidated = spawnSync(
      "sh",
      [
        "-c",
        `. "${authScript}"
custom_runtime_certification_lease break-emergency "$OPENCLAW_CUSTOM_RUNTIME_HOME" "" "" "" "" "" "" "" "" "operator-recovery"`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...input.env,
          OPENCLAW_RELEASE_GOVERNANCE_APPROVAL_ID: "release-governor:rollback:approved",
        },
      },
    );
    expect(invalidated.status, invalidated.stderr).toBe(0);
    expect(existsSync(leasePath)).toBe(false);
    const receipt = JSON.parse(readFileSync(invalidated.stdout.trim(), "utf8"));
    expect(receipt).toMatchObject({
      activeSha,
      approvalId: "release-governor:pr-41",
      candidateSha,
      reason: "operator-recovery",
      result: "certification-invalidated",
      schema: "openclaw.custom-runtime-certification-lease-receipt.v2",
    });
    expect(receipt.actor).toEqual(expect.any(String));
    expect(receipt.invocationId).toBe("certification-pr-41");
    expect(receipt.operationId).toBe("certification:pr-41");
    expect(receipt.pid).toEqual(expect.any(Number));
  });

  it("wires every managed mutation entrypoint to the global lifecycle contract", () => {
    const scripts = ["activate", "promote", "restart", "rollback", "guard"];
    for (const name of scripts) {
      const source = readFileSync(
        path.join(process.cwd(), "scripts", "custom-runtime", `custom-runtime-${name}.sh`),
        "utf8",
      );
      expect(source).toContain("custom_runtime_lifecycle_begin");
      expect(source).toContain("custom_runtime_lifecycle_finish");
      expect(source).not.toMatch(/locks\/(?:activation|promotion|restart|rollback|guard)\.lock/);
    }
  });

  it("fails closed when a global lifecycle lock owner is malformed", () => {
    const input = fixture();
    const lock = path.join(input.runtimeHome, "locks", "lifecycle.lock");
    mkdirSync(lock, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(lock, "owner.json"), "{broken\n", { mode: 0o600 });
    chmodSync(lock, 0o700);

    const result = spawnSync("sh", ["-c", lifecycleCommand(input.runtimeHome, "restart")], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: input.env,
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain("global lifecycle lock owner is malformed");
  });

  it("recovers only a valid, dead, stale global lifecycle lock with a receipt", () => {
    const input = fixture();
    const lock = path.join(input.runtimeHome, "locks", "lifecycle.lock");
    mkdirSync(lock, { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(lock, "owner.json"),
      `${JSON.stringify({
        activeSha,
        actor: "codex",
        approvalId: "release-governor:promotion:test",
        candidateSha,
        createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        invocationId: "dead-stale-invocation",
        operation: "promotion",
        operationId: "custom-runtime:promotion",
        pid: 2_147_483_647,
        schema: "openclaw.custom-runtime-lifecycle-lock.v1",
      })}\n`,
      { mode: 0o600 },
    );

    const recovered = spawnSync("sh", ["-c", lifecycleCommand(input.runtimeHome, "restart")], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: input.env,
    });
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(existsSync(lock)).toBe(false);
    const receipts = readdirSync(path.join(input.runtimeHome, "receipts"));
    expect(receipts.some((name) => name.startsWith("lifecycle-lock-recovered-"))).toBe(true);
    expect(receipts.some((name) => name.startsWith("lifecycle-restart-"))).toBe(true);
  });
});
