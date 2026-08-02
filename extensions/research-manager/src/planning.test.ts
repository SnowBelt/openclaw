import { describe, expect, it, vi } from "vitest";
import { createSolOnlyConfig } from "./acceptance.js";
import { resolveResearchManagerConfig } from "./config.js";
import type { StructuredModelRunner } from "./model-runner.js";
import { createResearchPlan } from "./planning.js";

describe("createResearchPlan", () => {
  it("renumbers question IDs without discarding mapped model queries", async () => {
    const runJson = vi.fn(async () => ({
      value: {
        objective: "Explain WAL concurrency and limits",
        questions: [
          { id: "concurrency", question: "How does concurrency work?", priority: "required" },
          { id: "limits", question: "What are the limits?", priority: "required" },
        ],
        queries: [
          {
            query: "site:sqlite.org/wal.html wal concurrency",
            questionIds: ["concurrency"],
            preferredSourceTypes: ["primary"],
            freshnessDays: 30,
          },
          {
            query: "site:sqlite.org release changes 2026 wal limitations",
            questionIds: ["limits", "concurrency"],
            preferredSourceTypes: ["primary"],
            freshnessDays: 30,
          },
        ],
        sourceRequirements: ["SQLite primary documentation"],
        riskLevel: "normal",
        stopConditions: ["Both questions are supported"],
      },
      attempts: [],
    }));
    const runner = { runJson } as unknown as StructuredModelRunner;
    const result = await createResearchPlan({
      runner,
      config: resolveResearchManagerConfig(),
      request: { query: "Explain SQLite WAL." },
      mode: "certified",
    });
    expect(result.plan.questions.map((question) => question.id)).toEqual(["Q1", "Q2"]);
    expect(result.plan.queries).toEqual([
      expect.objectContaining({
        query: "site:sqlite.org wal.html wal concurrency",
        questionIds: ["Q1"],
      }),
      expect.objectContaining({
        query: "site:sqlite.org release changes 2026 wal limitations",
        questionIds: ["Q2", "Q1"],
        freshnessDays: 30,
      }),
    ]);
    expect(result.plan.queries[0]).not.toHaveProperty("freshnessDays");
    expect(runJson).toHaveBeenCalledWith(expect.objectContaining({ thinking: "high" }));
  });

  it("uses the provider maximum for the locked Sol-only comparator", async () => {
    const runJson = vi.fn(async () => ({
      value: {
        objective: "Test",
        questions: [{ id: "one", question: "What happened?", priority: "required" }],
        queries: [
          {
            query: "authoritative source",
            questionIds: ["one"],
            preferredSourceTypes: ["primary"],
          },
        ],
        sourceRequirements: ["primary"],
        riskLevel: "normal",
        stopConditions: ["supported"],
      },
      attempts: [],
    }));
    const runner = { runJson } as unknown as StructuredModelRunner;

    await createResearchPlan({
      runner,
      config: createSolOnlyConfig(resolveResearchManagerConfig()),
      request: { query: "Test" },
      mode: "certified",
    });

    expect(runJson).toHaveBeenCalledWith(expect.objectContaining({ thinking: "max" }));
  });

  it("repairs an obviously compound required question before retrieval", async () => {
    const runJson = vi
      .fn()
      .mockResolvedValueOnce({
        value: {
          objective: "Compare checkpoints",
          questions: [
            {
              id: "modes",
              question: "What are PASSIVE and FULL checkpoints, and how do they differ?",
              priority: "required",
            },
          ],
          queries: [
            {
              query: "site:sqlite.org wal checkpoint modes",
              questionIds: ["modes"],
              preferredSourceTypes: ["primary"],
            },
          ],
          sourceRequirements: ["SQLite primary documentation"],
          riskLevel: "normal",
          stopConditions: ["supported"],
        },
        attempts: [{ id: "first" }],
      })
      .mockResolvedValueOnce({
        value: {
          objective: "Compare checkpoints",
          questions: [
            {
              id: "passive",
              question: "How does a PASSIVE checkpoint operate?",
              priority: "required",
            },
            { id: "full", question: "How does a FULL checkpoint operate?", priority: "required" },
          ],
          queries: [
            {
              query: "site:sqlite.org passive checkpoint",
              questionIds: ["passive"],
              preferredSourceTypes: ["primary"],
            },
            {
              query: "site:sqlite.org full checkpoint",
              questionIds: ["full"],
              preferredSourceTypes: ["primary"],
            },
          ],
          sourceRequirements: ["SQLite primary documentation"],
          riskLevel: "normal",
          stopConditions: ["supported"],
        },
        attempts: [{ id: "repair" }],
      });
    const result = await createResearchPlan({
      runner: { runJson } as unknown as StructuredModelRunner,
      config: resolveResearchManagerConfig(),
      request: { query: "Compare SQLite checkpoint modes." },
      mode: "certified",
    });
    expect(runJson).toHaveBeenCalledTimes(2);
    expect(String(runJson.mock.calls[1]?.[0].prompt)).toMatch(/atomicity audit failed/i);
    expect(result.plan.questions.map((question) => question.question)).toEqual([
      "How does a PASSIVE checkpoint operate?",
      "How does a FULL checkpoint operate?",
    ]);
    expect(result.attempts).toHaveLength(2);
  });

  it("fails closed when the bounded atomicity repair remains compound", async () => {
    const compoundPlan = {
      objective: "Compare checkpoints",
      questions: [
        {
          id: "modes",
          question: "What are PASSIVE and FULL checkpoints, and how do they differ?",
          priority: "required" as const,
        },
      ],
      queries: [
        {
          query: "site:sqlite.org wal checkpoint modes",
          questionIds: ["modes"],
          preferredSourceTypes: ["primary"],
        },
      ],
      sourceRequirements: ["SQLite primary documentation"],
      riskLevel: "normal" as const,
      stopConditions: ["supported"],
    };
    const runJson = vi.fn(async () => ({ value: compoundPlan, attempts: [] }));
    await expect(
      createResearchPlan({
        runner: { runJson } as unknown as StructuredModelRunner,
        config: resolveResearchManagerConfig(),
        request: { query: "Compare SQLite checkpoint modes." },
        mode: "certified",
      }),
    ).rejects.toThrow("atomicity repair retained compound required questions");
    expect(runJson).toHaveBeenCalledTimes(2);
  });

  it("fails closed when required or important questions lack distinct query capacity", async () => {
    const runner = {
      runJson: vi.fn(async () => ({
        value: {
          objective: "Cover both requirements",
          questions: [
            { id: "one", question: "What is the first fact?", priority: "required" },
            { id: "two", question: "What is the second fact?", priority: "important" },
          ],
          queries: [
            {
              query: "primary source for both facts",
              questionIds: ["one", "two"],
              preferredSourceTypes: ["primary"],
            },
          ],
          sourceRequirements: ["primary"],
          riskLevel: "normal",
          stopConditions: ["supported"],
        },
        attempts: [],
      })),
    } as unknown as StructuredModelRunner;

    await expect(
      createResearchPlan({
        runner,
        config: resolveResearchManagerConfig({ retrieval: { queryCount: 1 } }),
        request: { query: "Cover both facts" },
        mode: "certified",
      }),
    ).rejects.toThrow("one mapped search query per required or important question");
  });
});
