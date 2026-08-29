import { describe, expect, it } from "vitest";
import { collectRingerSecurityFindings } from "./security.js";

function collectFindings(config: Record<string, unknown>) {
  return collectRingerSecurityFindings({
    config,
    sourceConfig: config,
    env: {} as NodeJS.ProcessEnv,
    stateDir: "/tmp/openclaw-state",
    configPath: "/tmp/openclaw.json",
  } as Parameters<typeof collectRingerSecurityFindings>[0]);
}

describe("Local AI Assist security audit collector", () => {
  it("does not report a disabled plugin", async () => {
    await expect(
      collectFindings({
        plugins: {
          entries: {
            ringer: { config: { enabled: false } },
          },
        },
      }),
    ).resolves.toStrictEqual([]);
  });

  it("reports incomplete enabled configuration before inspecting runtime state", async () => {
    await expect(
      collectFindings({
        plugins: {
          entries: {
            ringer: { config: { enabled: true } },
          },
        },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "ringer.config.invalid",
          severity: "critical",
        }),
      ]),
    );
  });
});
