import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { reserveAutomaticDailySpendBudget } from "./model-spend-budget.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createLedgerPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-model-spend-budget-"));
  tempDirs.push(dir);
  return path.join(dir, "usage", "automatic-model-spend.json");
}

function cfg(): OpenClawConfig {
  return {
    models: {
      routing: {
        automaticDailyMaxCostUsd: 0.5,
      },
      providers: {
        local: {
          baseUrl: "http://127.0.0.1:11434",
          api: "ollama",
          models: [
            {
              id: "small",
              name: "Small",
              reasoning: false,
              input: ["text"],
              contextWindow: 32_000,
              maxTokens: 4_000,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
        paid: {
          baseUrl: "https://api.example.test",
          route: { location: "remote", billing: "metered" },
          models: [
            {
              id: "paid",
              name: "Paid",
              reasoning: false,
              input: ["text"],
              contextWindow: 100_000,
              maxTokens: 10_000,
              cost: { input: 2, output: 5, cacheRead: 3, cacheWrite: 4 },
            },
          ],
        },
      },
    },
  } as OpenClawConfig;
}

describe("automatic daily spend budget", () => {
  it("atomically reserves metered fallback capacity across automatic runs", async () => {
    const ledgerPath = await createLedgerPath();
    const params = {
      cfg: cfg(),
      ledgerPath,
      agentId: "worker",
      nowMs: new Date(2026, 6, 12, 13, 30).getTime(),
      candidates: [
        { provider: "local", model: "small" },
        { provider: "paid", model: "paid" },
      ],
    };

    await expect(reserveAutomaticDailySpendBudget(params)).resolves.toEqual({
      candidates: [
        { provider: "local", model: "small" },
        { provider: "paid", model: "paid" },
      ],
      blocked: [],
    });
    await expect(reserveAutomaticDailySpendBudget(params)).resolves.toEqual({
      candidates: [{ provider: "local", model: "small" }],
      blocked: [{ provider: "paid", model: "paid", route: "metered" }],
    });
    await expect(
      reserveAutomaticDailySpendBudget({ ...params, agentId: "other-worker" }),
    ).resolves.toEqual({
      candidates: [
        { provider: "local", model: "small" },
        { provider: "paid", model: "paid" },
      ],
      blocked: [],
    });

    const ledger = JSON.parse(await fs.readFile(ledgerPath, "utf8")) as {
      days: Record<
        string,
        { agents: Record<string, { reservedUsd: number; reservations: unknown[] }> }
      >;
    };
    expect(ledger.days["2026-07-12"]?.agents.worker?.reservedUsd).toBeCloseTo(0.45, 8);
    expect(ledger.days["2026-07-12"]?.agents.worker?.reservations).toHaveLength(1);
    expect(ledger.days["2026-07-12"]?.agents["other-worker"]?.reservedUsd).toBeCloseTo(0.45, 8);
  });

  it("keeps local routes available when a ledger write cannot be established", async () => {
    const result = await reserveAutomaticDailySpendBudget({
      cfg: cfg(),
      ledgerPath: "/dev/null/automatic-model-spend.json",
      candidates: [
        { provider: "local", model: "small" },
        { provider: "paid", model: "paid" },
      ],
    });

    expect(result.candidates).toEqual([{ provider: "local", model: "small" }]);
    expect(result.blocked).toEqual([{ provider: "paid", model: "paid", route: "metered" }]);
  });

  it("fails closed for metered routes when the durable ledger is corrupt", async () => {
    const ledgerPath = await createLedgerPath();
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    await fs.writeFile(ledgerPath, "{not-json\n");

    await expect(
      reserveAutomaticDailySpendBudget({
        cfg: cfg(),
        ledgerPath,
        candidates: [
          { provider: "local", model: "small" },
          { provider: "paid", model: "paid" },
        ],
      }),
    ).resolves.toEqual({
      candidates: [{ provider: "local", model: "small" }],
      blocked: [{ provider: "paid", model: "paid", route: "metered" }],
    });
  });

  it("keeps project reservations separate and blocks unassigned automatic metered work", async () => {
    const ledgerPath = await createLedgerPath();
    const params = {
      cfg: {
        ...cfg(),
        models: {
          ...cfg().models,
          routing: {
            ...cfg().models?.routing,
            automaticProjectDailyMaxCostUsd: 0.5,
          },
        },
      },
      ledgerPath,
      agentId: "worker",
      projectId: "project-a",
      nowMs: new Date(2026, 6, 12, 13, 30).getTime(),
      candidates: [
        { provider: "local", model: "small" },
        { provider: "paid", model: "paid" },
      ],
    };

    await expect(reserveAutomaticDailySpendBudget(params)).resolves.toMatchObject({
      candidates: [
        { provider: "local", model: "small" },
        { provider: "paid", model: "paid" },
      ],
    });
    await expect(
      reserveAutomaticDailySpendBudget({ ...params, agentId: "other-worker" }),
    ).resolves.toEqual({
      candidates: [{ provider: "local", model: "small" }],
      blocked: [{ provider: "paid", model: "paid", route: "metered" }],
    });
    await expect(
      reserveAutomaticDailySpendBudget({ ...params, projectId: undefined }),
    ).resolves.toEqual({
      candidates: [{ provider: "local", model: "small" }],
      blocked: [{ provider: "paid", model: "paid", route: "metered" }],
    });
  });
});
