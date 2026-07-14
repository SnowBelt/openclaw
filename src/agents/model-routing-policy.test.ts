import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  applyAutomaticModelRoutingPolicy,
  orderModelCatalogByRoutingPolicy,
  resolveAutomaticModelRoutingDecision,
  resolveAutomaticModelRoutingProfile,
  resolveAutomaticModelSpendEstimate,
  resolveModelCatalogEntryRoute,
} from "./model-routing-policy.js";

function config(overrides: Partial<OpenClawConfig> = {}): OpenClawConfig {
  return {
    models: {
      routing: {
        preference: "local-first",
        automaticMetered: "deny",
        automaticUnknown: "deny",
      },
      providers: {
        local: {
          baseUrl: "http://127.0.0.1:11434",
          api: "ollama",
          models: [{ id: "small", name: "Small local" }],
        },
        codex: {
          baseUrl: "https://subscription.example.test",
          route: { location: "remote", billing: "included" },
          models: [{ id: "included", name: "Included" }],
        },
        paid: {
          baseUrl: "https://api.example.test",
          route: { location: "remote", billing: "metered" },
          models: [{ id: "expensive", name: "Expensive" }],
        },
      },
    },
    ...overrides,
  } as OpenClawConfig;
}

describe("model routing policy", () => {
  it("classifies local transport, included subscriptions, and metered routes without vendor ids", () => {
    const cfg = config();

    expect(
      resolveModelCatalogEntryRoute({
        cfg,
        entry: { provider: "local", id: "small", api: "ollama" },
      }),
    ).toBe("local");
    expect(
      resolveAutomaticModelRoutingDecision({ cfg, provider: "codex", model: "included" }),
    ).toEqual({ route: "subscription", certification: "unlisted", eligible: true });
    expect(
      resolveAutomaticModelRoutingDecision({ cfg, provider: "paid", model: "expensive" }),
    ).toEqual({ route: "metered", certification: "unlisted", eligible: false });
  });

  it("honors explicit remote route facts before inferring locality from an Ollama adapter", () => {
    const cfg = config({
      models: {
        routing: { automaticUnknown: "deny" },
        providers: {
          "remote-ollama": {
            api: "ollama",
            baseUrl: "https://remote-ollama.example.test",
            route: { location: "remote", billing: "included" },
            models: [
              {
                id: "remote",
                name: "Remote Ollama",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 8_192,
                maxTokens: 1_024,
              },
            ],
          },
        },
      },
    });

    expect(
      resolveAutomaticModelRoutingDecision({ cfg, provider: "remote-ollama", model: "remote" }),
    ).toEqual({ route: "subscription", certification: "unlisted", eligible: true });
  });

  it("moves local models first and blocks metered and unknown automatic candidates", () => {
    const cfg = config();
    const result = applyAutomaticModelRoutingPolicy({
      cfg,
      candidates: [
        { provider: "paid", model: "expensive" },
        { provider: "codex", model: "included" },
        { provider: "local", model: "small" },
        { provider: "unclassified", model: "mystery" },
      ],
    });

    expect(result.candidates).toEqual([
      { provider: "local", model: "small" },
      { provider: "codex", model: "included" },
    ]);
    expect(result.blocked).toEqual([
      { provider: "paid", model: "expensive", route: "metered" },
      { provider: "unclassified", model: "mystery", route: "unknown" },
    ]);
  });

  it("keeps catalog order unchanged when the policy is absent but annotates routes", () => {
    const result = orderModelCatalogByRoutingPolicy({
      cfg: {} as OpenClawConfig,
      entries: [
        { provider: "remote", id: "a", name: "Remote" },
        { provider: "local", id: "b", name: "Local", baseUrl: "http://localhost:8080" },
      ],
    });

    expect(result.map((entry) => entry.provider)).toEqual(["remote", "local"]);
    expect(result.map((entry) => entry.route)).toEqual([undefined, "local"]);
  });

  it("requires a current operator certification only for automatic work", () => {
    const cfg = config({
      models: {
        ...config().models,
        routing: {
          preference: "local-first",
          requireCertifiedForAutomatic: true,
          certifications: {
            "local/small": {
              state: "certified",
              verifiedAt: "2026-07-12T00:00:00.000Z",
              evidence: "local-smoke-v1",
            },
            "codex/included": { state: "candidate" },
          },
        },
      },
    });

    expect(
      resolveAutomaticModelRoutingDecision({ cfg, provider: "local", model: "small" }),
    ).toEqual({ route: "local", certification: "certified", eligible: true });
    expect(
      resolveAutomaticModelRoutingDecision({ cfg, provider: "codex", model: "included" }),
    ).toEqual({ route: "subscription", certification: "candidate", eligible: false });

    const result = applyAutomaticModelRoutingPolicy({
      cfg,
      candidates: [
        { provider: "codex", model: "included" },
        { provider: "local", model: "small" },
      ],
    });
    expect(result.candidates).toEqual([{ provider: "local", model: "small" }]);
    expect(result.blocked).toEqual([
      { provider: "codex", model: "included", route: "subscription" },
    ]);
  });

  it("adds an evidence status to catalog rows without leaking receipt text", () => {
    const cfg = config({
      models: {
        ...config().models,
        routing: {
          certifications: {
            "local/small": { state: "certified", evidence: "private receipt" },
          },
        },
      },
    });
    const [entry] = orderModelCatalogByRoutingPolicy({
      cfg,
      entries: [{ provider: "local", id: "small", name: "Small local", api: "ollama" }],
    });

    expect(entry).toMatchObject({ route: "local", certification: "certified" });
    expect(entry).not.toHaveProperty("evidence");
  });

  it("blocks automatic metered attempts whose pessimistic configured maximum exceeds the cap", () => {
    const baseline = config();
    const baselineModels = baseline.models!;
    const baselineProviders = baselineModels.providers!;
    const cfg = config({
      models: {
        ...baselineModels,
        routing: {
          automaticMetered: "allow",
          automaticMaxCostUsd: 0.2,
        },
        providers: {
          ...baselineProviders,
          paid: {
            ...baselineProviders.paid,
            models: [
              {
                id: "expensive",
                name: "Expensive",
                reasoning: true,
                input: ["text"],
                contextWindow: 100_000,
                maxTokens: 10_000,
                cost: { input: 2, output: 5, cacheRead: 3, cacheWrite: 4 },
              },
            ],
          },
        },
      },
    });

    expect(
      resolveAutomaticModelSpendEstimate({ cfg, provider: "paid", model: "expensive" }),
    ).toEqual({ inputTokens: 100_000, outputTokens: 10_000, maximumCostUsd: 0.45 });
    expect(
      resolveAutomaticModelRoutingDecision({ cfg, provider: "paid", model: "expensive" }),
    ).toEqual({ route: "metered", certification: "unlisted", eligible: false });

    cfg.models!.routing!.automaticMaxCostUsd = 0.45;
    expect(
      resolveAutomaticModelRoutingDecision({ cfg, provider: "paid", model: "expensive" }),
    ).toEqual({ route: "metered", certification: "unlisted", eligible: true });
  });

  it("fails closed on a capped automatic metered model without configured pricing limits", () => {
    const cfg = config({
      models: {
        ...config().models,
        routing: { automaticMetered: "allow", automaticMaxCostUsd: 1 },
      },
    });

    expect(resolveAutomaticModelSpendEstimate({ cfg, provider: "paid", model: "expensive" })).toBe(
      undefined,
    );
    expect(
      resolveAutomaticModelRoutingDecision({ cfg, provider: "paid", model: "expensive" }),
    ).toEqual({ route: "metered", certification: "unlisted", eligible: false });
  });

  it("requires both explicit metered permission and a cost ceiling", () => {
    const baseline = config();
    const paid = {
      ...baseline.models!.providers!.paid,
      models: [
        {
          id: "expensive",
          name: "Expensive",
          reasoning: true,
          input: ["text" as const],
          contextWindow: 32_000,
          maxTokens: 4_000,
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    };
    const withoutPermission = config({
      models: {
        routing: { automaticMaxCostUsd: 1 },
        providers: { paid },
      },
    });
    const withoutBudget = config({
      models: {
        routing: { automaticMetered: "allow" },
        providers: { paid },
      },
    });

    expect(
      resolveAutomaticModelRoutingDecision({
        cfg: withoutPermission,
        provider: "paid",
        model: "expensive",
      }).eligible,
    ).toBe(false);
    expect(
      resolveAutomaticModelRoutingDecision({
        cfg: withoutBudget,
        provider: "paid",
        model: "expensive",
      }).eligible,
    ).toBe(false);
  });

  it("keeps operator-configured purpose profiles deterministic and rejects a missing required input", () => {
    const baseline = config();
    const baselineModels = baseline.models!;
    const baselineProviders = baselineModels.providers!;
    const cfg = config({
      models: {
        ...baselineModels,
        routing: {
          automaticProfiles: { vision: ["local/vision", "paid/expensive"] },
          automaticMetered: "allow",
        },
        providers: {
          ...baselineProviders,
          local: {
            ...baselineProviders.local,
            models: [
              {
                id: "vision",
                name: "Local vision",
                reasoning: true,
                input: ["text", "image"],
                contextWindow: 32_000,
                maxTokens: 4_000,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
          paid: {
            ...baselineProviders.paid,
            models: [
              {
                id: "expensive",
                name: "Text only",
                reasoning: true,
                input: ["text"],
                contextWindow: 32_000,
                maxTokens: 4_000,
                cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      },
    });

    expect(resolveAutomaticModelRoutingProfile({ cfg, purpose: "vision" })).toEqual([
      "local/vision",
      "paid/expensive",
    ]);
    const result = applyAutomaticModelRoutingPolicy({
      cfg,
      requiredInput: "image",
      candidates: [
        { provider: "local", model: "vision" },
        { provider: "paid", model: "expensive" },
      ],
    });
    expect(result.candidates).toEqual([{ provider: "local", model: "vision" }]);
    expect(result.blocked).toEqual([{ provider: "paid", model: "expensive", route: "metered" }]);
  });
});
