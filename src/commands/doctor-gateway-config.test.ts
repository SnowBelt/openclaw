// Gateway config doctor tests cover narrow config repair without broad doctor side effects.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGatewayConfigDoctor } from "./doctor-gateway-config.js";

const originalEnv = { ...process.env };
let tempDir: string;
let configPath: string;

async function writeConfig(value: unknown) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function readConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(configPath, "utf-8")) as Record<string, unknown>;
}

describe("runGatewayConfigDoctor", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gateway-config-doctor-"));
    configPath = path.join(tempDir, "openclaw.json");
    process.env = {
      ...originalEnv,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_STATE_DIR: tempDir,
      OPENCLAW_TEST_FAST: "1",
      VITEST: "true",
    };
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("reports retired gateway.tailscale.required during check without writing", async () => {
    await writeConfig({
      gateway: { mode: "local", tailscale: { mode: "serve", required: false } },
    });

    const report = await runGatewayConfigDoctor({ mode: "check" });

    expect(report.ok).toBe(false);
    expect(report.repaired).toBe(false);
    expect(report.changedPaths).toEqual(["gateway.tailscale.required"]);
    expect(report.issues.join("\n")).toContain("gateway.tailscale");
    const after = await readConfig();
    expect(
      ((after.gateway as Record<string, unknown>).tailscale as Record<string, unknown>).required,
    ).toBe(false);
  });

  it("fixes retired gateway.tailscale.required and writes a backup", async () => {
    await writeConfig({
      gateway: { mode: "local", tailscale: { mode: "serve", required: false } },
    });

    const report = await runGatewayConfigDoctor({ mode: "fix" });

    expect(report.ok).toBe(true);
    expect(report.repaired).toBe(true);
    expect(report.backupPath).toContain("gateway-config-doctor");
    const after = await readConfig();
    expect(
      ((after.gateway as Record<string, unknown>).tailscale as Record<string, unknown>).required,
    ).toBeUndefined();
    await expect(fs.stat(report.backupPath ?? "")).resolves.toBeTruthy();
  });

  it("is idempotent after the config is already canonical", async () => {
    await writeConfig({ gateway: { mode: "local", tailscale: { mode: "serve" } } });

    const report = await runGatewayConfigDoctor({ mode: "fix" });

    expect(report.ok).toBe(true);
    expect(report.repaired).toBe(false);
    expect(report.changedPaths).toEqual([]);
    expect(report.backupPath).toBeNull();
  });
});
