import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalModelAdmissionError } from "../../src/agents/local-model-admission.js";
import {
  LOCAL_MODEL_COMPATIBILITY_AGENT_ID,
  LOCAL_MODEL_COMPATIBILITY_MODEL,
  runLocalModelCompatibilitySmoke,
  type CompatibilitySmokeParams,
} from "./custom-runtime-local-model-smoke.js";

const roots: string[] = [];
const SOURCE_COMMIT = "a".repeat(40);
const SOURCE_SHA = "b".repeat(64);
const ARTIFACT_SHA = "c".repeat(64);
const CLOSURE_SHA = "d".repeat(64);
const ACTIVE_BASELINE_SHA = "e".repeat(64);
const VERIFIER_SHA = "f".repeat(64);

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function candidate(): CompatibilitySmokeParams {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-local-model-smoke-test-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist", "index.js"), "// candidate\n");
  fs.writeFileSync(path.join(root, "openclaw.mjs"), "#!/usr/bin/env node\n");
  const manifestPath = path.join(root, "config", "custom-runtime-capabilities.json");
  fs.writeFileSync(manifestPath, '{"schema":"test"}\n');
  const manifestSha = crypto
    .createHash("sha256")
    .update(fs.readFileSync(manifestPath))
    .digest("hex");
  fs.writeFileSync(
    path.join(root, "snapshot.json"),
    `${JSON.stringify({
      version: 2,
      releaseId: "candidate-release",
      root,
      artifactHash: ARTIFACT_SHA,
      runtimeClosureHash: CLOSURE_SHA,
      source: { commit: SOURCE_COMMIT },
      paths: { entrypoint: path.join(root, "dist", "index.js") },
    })}\n`,
  );
  return {
    runtimeRoot: root,
    candidateReleaseId: "candidate-release",
    sourceCommit: SOURCE_COMMIT,
    sourceSha256: SOURCE_SHA,
    artifactSha256: ARTIFACT_SHA,
    runtimeClosureSha256: CLOSURE_SHA,
    manifestSha256: manifestSha,
    activeRuntimeBaselineSha256: ACTIVE_BASELINE_SHA,
    configuredModel: LOCAL_MODEL_COMPATIBILITY_MODEL,
    verifierSha256: VERIFIER_SHA,
    reportPath: path.join(root, "report.json"),
    receiptPath: path.join(root, "receipt.json"),
  };
}

function lease(release = vi.fn(async () => undefined)) {
  return {
    schema: "openclaw.local-model-admission.v1" as const,
    token: "lease-token",
    owner: "test",
    mode: "exclusive" as const,
    acquiredAt: 1,
    expiresAt: 2,
    statePath: "/tmp/openclaw-local-model-admission/state.json",
    borrowed: false,
    samples: [
      {
        observedAt: "2026-08-28T00:00:00.000Z",
        activeOpenClawWorkerCount: 0,
        activeOllamaClientCount: 0,
      },
      {
        observedAt: "2026-08-28T00:00:05.000Z",
        activeOpenClawWorkerCount: 0,
        activeOllamaClientCount: 0,
      },
      {
        observedAt: "2026-08-28T00:00:10.000Z",
        activeOpenClawWorkerCount: 0,
        activeOllamaClientCount: 0,
      },
    ],
    renew: vi.fn(async () => undefined),
    release,
  };
}

describe("custom runtime local-model compatibility smoke", () => {
  it("runs only the isolated installed-model command and writes a bound receipt", async () => {
    const params = candidate();
    const admitted = lease();
    const acquire = vi.fn(async () => admitted);
    const execute = vi.fn(async (input) => {
      expect(input.args).toContain("--local");
      expect(input.args).toContain(LOCAL_MODEL_COMPATIBILITY_AGENT_ID);
      expect(input.args).toContain("--timeout");
      expect(input.args).toContain("180");
      expect(input.env.OPENAI_API_KEY).toBeUndefined();
      expect(input.env.OPENCLAW_SKIP_CHANNELS).toBe("1");
      expect(input.env.OPENCLAW_SKIP_PROVIDERS).toBe("1");
      expect(input.env.HTTP_PROXY).toBeUndefined();
      expect(input.env.OPENCLAW_LOCAL_MODEL_ADMISSION_TOKEN).toBe("lease-token");
      const isolatedConfig = JSON.parse(
        fs.readFileSync(input.env.OPENCLAW_CONFIG_PATH!, "utf8"),
      ) as {
        plugins: { enabled: boolean };
        browser: { enabled: boolean };
        cron: { enabled: boolean; triggers: { enabled: boolean } };
      };
      expect(isolatedConfig).toMatchObject({
        plugins: { enabled: false },
        browser: { enabled: false },
        cron: { enabled: false, triggers: { enabled: false } },
      });
      return {
        status: 0,
        signal: null,
        stdout: JSON.stringify({
          result: { payloads: [{ text: "PATTERNLAB_RUNTIME_COMPAT_OK" }] },
        }),
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        ownedProcessCleanup: true,
      };
    });
    const report = await runLocalModelCompatibilitySmoke({
      ...params,
      runtime: {
        acquire,
        execute,
        now: () => new Date("2026-08-28T00:00:15.000Z"),
      },
    });

    expect(report.status).toBe("pass");
    expect(report.consumed).toBe(true);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(admitted.release).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(params.receiptPath, "utf8"))).toMatchObject({
      checkId: "isolated_local_model_compatibility",
      localModelCompatibility: {
        candidateReleaseId: "candidate-release",
        configuredModel: LOCAL_MODEL_COMPATIBILITY_MODEL,
        responseMarker: "PATTERNLAB_RUNTIME_COMPAT_OK",
      },
    });
  });

  it("does not consume the smoke when shared admission is contended", async () => {
    const params = candidate();
    const acquire = vi.fn(async () => {
      throw new LocalModelAdmissionError("resource_contention", "blocked_resource_contention:test");
    });
    const report = await runLocalModelCompatibilitySmoke({
      ...params,
      runtime: { acquire },
    });

    expect(report).toMatchObject({
      status: "blocked",
      consumed: false,
      blockers: ["resource_contention"],
    });
    expect(fs.existsSync(params.receiptPath)).toBe(false);
  });

  it("fails closed on timeout and retains only redacted bounded evidence", async () => {
    const params = candidate();
    const admitted = lease();
    const report = await runLocalModelCompatibilitySmoke({
      ...params,
      runtime: {
        acquire: vi.fn(async () => admitted),
        execute: vi.fn(async () => ({
          status: null,
          signal: "SIGTERM" as const,
          stdout: "token=super-secret",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: true,
          ownedProcessCleanup: true,
        })),
      },
    });

    expect(report).toMatchObject({ status: "blocked", blockers: ["smoke_timeout"] });
    expect(report.stdoutTail).toContain("[REDACTED]");
    expect(fs.existsSync(params.receiptPath)).toBe(false);
  });
});
