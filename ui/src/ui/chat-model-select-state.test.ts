// Control UI tests cover chat model select state behavior.
import { describe, expect, it } from "vitest";
import {
  isChatModelValueUnavailable,
  resolveChatModelOverrideValue,
  resolveChatModelSelectState,
} from "./chat-model-select-state.ts";
import {
  createModelCatalog,
  createSessionsListResult,
  DEEPSEEK_CHAT_MODEL,
  DEFAULT_CHAT_MODEL_CATALOG,
} from "./chat-model.test-helpers.ts";

type ChatModelStateInput = Parameters<typeof resolveChatModelSelectState>[0];

function createChatModelState(params: Partial<ChatModelStateInput> = {}): ChatModelStateInput {
  return {
    sessionKey: "main",
    chatModelOverrides: {},
    chatModelCatalog: [],
    sessionsResult: createSessionsListResult({ model: null, modelProvider: null }),
    ...params,
  };
}

describe("chat-model-select-state", () => {
  it("groups local and remote models by route, certification, and capability", () => {
    const state = createChatModelState({
      chatModelCatalog: createModelCatalog(
        {
          id: "qwen3.6:latest",
          name: "Qwen 3.6",
          provider: "ollama",
          route: "local",
          certification: "certified",
          input: ["text"],
        },
        {
          id: "gpt-5.5",
          name: "GPT-5.5",
          provider: "openai",
          route: "metered",
          certification: "candidate",
          input: ["text", "image"],
        },
      ),
      sessionsResult: createSessionsListResult({
        model: null,
        modelProvider: null,
        defaultsModel: null,
        defaultsProvider: null,
      }),
    });

    expect(resolveChatModelSelectState(state).optionGroups).toEqual([
      {
        label: "Local & self-hosted · Certified · Text & coding",
        options: [{ value: "ollama/qwen3.6:latest", label: "Qwen 3.6" }],
      },
      {
        label: "Metered API · Manual review · Vision",
        options: [{ value: "openai/gpt-5.5", label: "GPT-5.5" }],
      },
    ]);
  });

  it("uses the server-qualified value when the active session provider is present", () => {
    const state = createChatModelState({
      chatModelCatalog: createModelCatalog(DEEPSEEK_CHAT_MODEL),
      sessionsResult: createSessionsListResult({
        model: "deepseek-chat",
        modelProvider: "deepseek",
      }),
    });

    expect(resolveChatModelOverrideValue(state)).toBe("deepseek/deepseek-chat");
  });

  it("resolves the canonical default-main row for an aliased selected chat", () => {
    const sessionsResult = createSessionsListResult({
      model: "gpt-5-mini",
      modelProvider: "openai",
    });
    const row = sessionsResult.sessions[0];
    if (!row) {
      throw new Error("expected a main session row");
    }
    row.key = "agent:main:main";

    const state = createChatModelState({
      sessionKey: "main",
      sessionsResult,
      chatModelCatalog: createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG),
      chatModelOverrides: { "agent:main:main": { kind: "raw", value: "gpt-5" } },
    });

    expect(resolveChatModelOverrideValue(state)).toBe("openai/gpt-5");
  });

  it("falls back to the server-qualified value when catalog lookup fails", () => {
    const state = createChatModelState({
      sessionsResult: createSessionsListResult({
        model: "gpt-5-mini",
        modelProvider: "openai",
      }),
    });

    expect(resolveChatModelOverrideValue(state)).toBe("openai/gpt-5-mini");
  });

  it("normalizes cached bare overrides to the matching catalog option", () => {
    const state = createChatModelState({
      chatModelOverrides: { main: { kind: "raw", value: "gpt-5-mini" } },
      chatModelCatalog: createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG),
    });

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.currentOverride).toBe("openai/gpt-5-mini");
    expect(resolved.options).toEqual([
      { value: "openai/gpt-5", label: "GPT-5" },
      { value: "openai/gpt-5-mini", label: "GPT-5 Mini" },
    ]);
  });

  it("prefers catalog provider matches over stale session providers", () => {
    const state = createChatModelState({
      chatModelCatalog: createModelCatalog(DEEPSEEK_CHAT_MODEL),
      sessionsResult: createSessionsListResult({
        model: "deepseek-chat",
        modelProvider: "zai",
      }),
    });

    expect(resolveChatModelSelectState(state).currentOverride).toBe("deepseek/deepseek-chat");
  });

  it("preserves already-qualified active-session models when the provider is stale and the catalog is empty", () => {
    const state = createChatModelState({
      sessionsResult: createSessionsListResult({
        model: "openai/gpt-5-mini",
        modelProvider: "zai",
      }),
    });

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.currentOverride).toBe("openai/gpt-5-mini");
    expect(resolved.options).toEqual([
      { value: "openai/gpt-5-mini", label: "gpt-5-mini · openai" },
      { value: "openai/gpt-5", label: "gpt-5 · openai" },
    ]);
  });

  it("builds picker options without introducing a bare duplicate", () => {
    const state = createChatModelState({
      chatModelCatalog: createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG),
      sessionsResult: createSessionsListResult({
        model: "gpt-5-mini",
        modelProvider: "openai",
      }),
    });

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.currentOverride).toBe("openai/gpt-5-mini");
    expect(resolved.options).toEqual([
      { value: "openai/gpt-5", label: "GPT-5" },
      { value: "openai/gpt-5-mini", label: "GPT-5 Mini" },
    ]);
  });

  it("uses catalog names for the default label and matching picker options", () => {
    const state = createChatModelState({
      chatModelCatalog: createModelCatalog({
        id: "moonshotai/kimi-k2.5",
        alias: "Kimi K2.5 (NVIDIA)",
        name: "Kimi K2.5 (NVIDIA)",
        provider: "nvidia",
      }),
      sessionsResult: createSessionsListResult({
        model: "moonshotai/kimi-k2.5",
        modelProvider: "nvidia",
        defaultsModel: "moonshotai/kimi-k2.5",
        defaultsProvider: "nvidia",
      }),
    });

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.currentOverride).toBe("nvidia/moonshotai/kimi-k2.5");
    expect(resolved.defaultLabel).toBe("Default (Kimi K2.5 (NVIDIA))");
    expect(resolved.options).toEqual([
      {
        value: "nvidia/moonshotai/kimi-k2.5",
        label: "Kimi K2.5 (NVIDIA)",
      },
    ]);
  });

  it("disambiguates duplicate friendly names in picker options and default labels", () => {
    const state = createChatModelState({
      chatModelCatalog: createModelCatalog(
        {
          id: "claude-3-7-sonnet",
          name: "Claude Sonnet",
          provider: "anthropic",
        },
        {
          id: "claude-3-7-sonnet",
          name: "Claude Sonnet",
          provider: "openrouter",
        },
      ),
      sessionsResult: createSessionsListResult({
        model: "claude-3-7-sonnet",
        modelProvider: "anthropic",
        defaultsModel: "claude-3-7-sonnet",
        defaultsProvider: "openrouter",
      }),
    });

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.currentOverride).toBe("anthropic/claude-3-7-sonnet");
    expect(resolved.defaultLabel).toBe("Default (Claude Sonnet · openrouter)");
    expect(resolved.options).toEqual([
      {
        value: "anthropic/claude-3-7-sonnet",
        label: "Claude Sonnet · anthropic",
      },
      {
        value: "openrouter/claude-3-7-sonnet",
        label: "Claude Sonnet · openrouter",
      },
    ]);
  });

  it("falls back to id and provider when duplicate names share the same provider", () => {
    const state = createChatModelState({
      chatModelCatalog: createModelCatalog(
        {
          id: "claude-3-7-sonnet",
          name: "Claude Sonnet",
          provider: "anthropic",
        },
        {
          id: "claude-3-7-sonnet-thinking",
          name: "Claude Sonnet",
          provider: "anthropic",
        },
      ),
      sessionsResult: createSessionsListResult({
        model: "claude-3-7-sonnet",
        modelProvider: "anthropic",
        defaultsModel: "claude-3-7-sonnet-thinking",
        defaultsProvider: "anthropic",
      }),
    });

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.currentOverride).toBe("anthropic/claude-3-7-sonnet");
    expect(resolved.defaultLabel).toBe(
      "Default (Claude Sonnet · claude-3-7-sonnet-thinking · anthropic)",
    );
    expect(resolved.options).toEqual([
      {
        value: "anthropic/claude-3-7-sonnet",
        label: "Claude Sonnet · claude-3-7-sonnet · anthropic",
      },
      {
        value: "anthropic/claude-3-7-sonnet-thinking",
        label: "Claude Sonnet · claude-3-7-sonnet-thinking · anthropic",
      },
    ]);
  });

  it("does not offer unavailable models as selectable options", () => {
    const state = createChatModelState({
      chatModelCatalog: createModelCatalog(
        { id: "gpt-5.5", name: "GPT-5.5", provider: "openai", available: true },
        {
          id: "gpt-5.3-codex-spark",
          name: "GPT-5.3 Codex Spark",
          provider: "codex",
          available: false,
        },
      ),
      sessionsResult: createSessionsListResult({
        model: "gpt-5.5",
        modelProvider: "openai",
        defaultsModel: "gpt-5.5",
        defaultsProvider: "openai",
      }),
    });

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.options).toEqual([{ value: "openai/gpt-5.5", label: "GPT-5.5" }]);
    expect(resolved.currentModelAvailable).toBe(true);
    expect(isChatModelValueUnavailable("codex/gpt-5.3-codex-spark", state.chatModelCatalog)).toBe(
      true,
    );
  });

  it("preserves an unavailable current model and marks it for explicit replacement", () => {
    const state = createChatModelState({
      chatModelCatalog: createModelCatalog(
        { id: "gpt-5.5", name: "GPT-5.5", provider: "openai", available: true },
        {
          id: "gpt-5.3-codex-spark",
          name: "GPT-5.3 Codex Spark",
          provider: "openai",
          available: false,
        },
      ),
      sessionsResult: createSessionsListResult({
        model: "gpt-5.3-codex-spark",
        modelProvider: "openai",
        defaultsModel: "gpt-5.3-codex-spark",
        defaultsProvider: "openai",
      }),
    });

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.currentModelAvailable).toBe(false);
    expect(resolved.defaultSelectable).toBe(false);
    expect(resolved.options).toEqual([
      { value: "openai/gpt-5.5", label: "GPT-5.5" },
      {
        value: "openai/gpt-5.3-codex-spark",
        label: "Unavailable (gpt-5.3-codex-spark · openai)",
        unavailable: true,
      },
    ]);
  });
});
