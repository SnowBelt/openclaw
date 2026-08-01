import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildControlDirectorSourceConfig,
  buildControlDirectorSourceGateReceipt,
  buildControlDirectorSourceGatePlan,
  CONTROL_DIRECTOR_CERTIFICATION_MODEL,
  CONTROL_DIRECTOR_VERIFY_REPO_ROOT,
  validateControlDirectorSourceIdentity,
} from "../../scripts/control-director-verify.mjs";

const sha = "a".repeat(40);

describe("control-director-verify", () => {
  it("derives a stable repository root instead of trusting the process cwd", () => {
    expect(existsSync(join(CONTROL_DIRECTOR_VERIFY_REPO_ROOT, "package.json"))).toBe(true);
  });

  it("fails closed unless the checkout is clean and matches an immutable expected SHA", () => {
    expect(
      validateControlDirectorSourceIdentity({ head: sha, expectedSha: sha, status: "" }),
    ).toEqual({ ok: true, head: sha });
    expect(
      validateControlDirectorSourceIdentity({ head: sha, expectedSha: "b".repeat(40), status: "" }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("mismatch") });
    expect(
      validateControlDirectorSourceIdentity({ head: sha, expectedSha: sha, status: " M file.ts" }),
    ).toEqual({ ok: false, reason: "Source checkout is not clean." });
    expect(
      validateControlDirectorSourceIdentity({ head: "main", expectedSha: sha, status: "" }),
    ).toEqual({ ok: false, reason: "HEAD is not an immutable 40-character SHA." });
  });

  it("selects the required Qwen certification route without changing role scope", () => {
    const config = buildControlDirectorSourceConfig();
    expect(config.agents.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "control-director",
          role: "control_director",
          model: {
            primary: CONTROL_DIRECTOR_CERTIFICATION_MODEL,
            fallbacks: ["ollama/openclaw-control-gemma4-31b-q8:latest"],
          },
        }),
        { id: "program-manager", role: "program_manager" },
        { id: "independent-judge", role: "judge" },
      ]),
    );
    expect(config.models.providers.ollama.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "openclaw-control-qwen25-32b:latest" }),
      ]),
    );
    expect(config.agents.defaults.models).toHaveProperty(CONTROL_DIRECTOR_CERTIFICATION_MODEL);
  });

  it("binds the source-gate receipt to the clean exact source identity", () => {
    expect(buildControlDirectorSourceGateReceipt(sha, [], "/tmp/clean-source")).toMatchObject({
      schemaVersion: 2,
      sourceSha: sha,
      expectedSha: sha,
      sourceRoot: "/tmp/clean-source",
      sourceClean: true,
      identityVerified: true,
      passed: false,
      chaos: { passed: false },
    });
  });

  it("keeps every required source gate sequential and explicit", () => {
    const plan = buildControlDirectorSourceGatePlan();
    expect(plan.map((entry) => entry.id)).toEqual([
      "protocol-coverage",
      "protocol-generated",
      "torture",
      "chaos",
      "tests",
      "ui-tests",
      "extension-tests",
      "ui-i18n",
      "deployment-consistency",
      "custom-runtime-contracts",
      "update-survival",
      "pcc-contracts",
      "plugin-sdk-api",
      "docs-mdx",
      "docs-links",
      "lint-scripts",
      "format-check",
      "typecheck-core",
      "typecheck-ui",
      "typecheck-extensions",
      "build",
    ]);
    expect(plan.find((entry) => entry.id === "tests")?.args).toContain(
      "test/scripts/control-ui-production-chat-stack.test.ts",
    );
    expect(plan.find((entry) => entry.id === "tests")?.args).toContain(
      "test/scripts/control-director-role-config.test.ts",
    );
    expect(plan.find((entry) => entry.id === "tests")?.args).toContain(
      "test/scripts/control-director-roadmap-proof.test.ts",
    );
    expect(plan.find((entry) => entry.id === "tests")?.args).toContain(
      "test/scripts/custom-runtime-lifecycle.test.ts",
    );
    expect(plan.find((entry) => entry.id === "tests")?.args).toContain(
      "test/scripts/custom-runtime-stage-promote.test.ts",
    );
    expect(plan.find((entry) => entry.id === "tests")?.args).toContain(
      "test/scripts/custom-runtime-update-survival.test.ts",
    );
    expect(plan.find((entry) => entry.id === "update-survival")?.args).toEqual([
      "custom-runtime:update-survival",
    ]);
    expect(plan.find((entry) => entry.id === "tests")?.args).toContain(
      "src/tasks/pursue-goal-blocker.test.ts",
    );
    expect(plan.find((entry) => entry.id === "tests")?.args).toContain(
      "packages/gateway-protocol/src/schema/tasks.test.ts",
    );
    expect(plan.find((entry) => entry.id === "tests")?.args).toContain(
      "src/gateway/server-methods/tasks.test.ts",
    );
    expect(plan.find((entry) => entry.id === "tests")?.args).toEqual(
      expect.arrayContaining([
        "src/gateway/server-maintenance.test.ts",
        "src/self-improvement/background.test.ts",
      ]),
    );
    expect(plan.find((entry) => entry.id === "ui-tests")?.args).toContain(
      "ui/src/ui/views/chat.test.ts",
    );
    expect(plan.find((entry) => entry.id === "tests")?.args).toContain(
      "test/scripts/control-ui-i18n.test.ts",
    );
    expect(plan.find((entry) => entry.id === "ui-i18n")?.args).toEqual(["ui:i18n:check"]);
    expect(plan.find((entry) => entry.id === "deployment-consistency")?.args).toEqual([
      "control-director:deployment-consistency",
      "--",
      "--source-only",
    ]);
    expect(plan.find((entry) => entry.id === "protocol-coverage")?.args).toEqual([
      "check:protocol-coverage",
    ]);
    expect(plan.find((entry) => entry.id === "protocol-generated")?.args).toEqual([
      "protocol:check",
    ]);
    expect(plan.find((entry) => entry.id === "lint-scripts")?.args).toEqual(["lint:scripts"]);
  });
});
