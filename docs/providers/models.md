---
summary: "Model providers (LLMs) supported by OpenClaw"
read_when:
  - You want to choose a model provider
  - You want quick setup examples for LLM auth + model selection
title: "Model provider quickstart"
---

OpenClaw can use many LLM providers. Pick one, authenticate, then set the default
model as `provider/model`.

## Quick start (two steps)

1. Authenticate with the provider (usually via `openclaw onboard`).
2. Set the default model:

```json5
{
  agents: { defaults: { model: { primary: "anthropic/claude-opus-4-6" } } },
}
```

## Supported providers (starter set)

- [Alibaba Model Studio](/providers/alibaba)
- [Amazon Bedrock](/providers/bedrock)
- [Anthropic (API + Claude CLI)](/providers/anthropic)
- [BytePlus (International)](/concepts/model-providers#byteplus-international)
- [Chutes](/providers/chutes)
- [Cohere](/providers/cohere)
- [ComfyUI](/providers/comfy)
- [Cloudflare AI Gateway](/providers/cloudflare-ai-gateway)
- [DeepInfra](/providers/deepinfra)
- [fal](/providers/fal)
- [Fireworks](/providers/fireworks)
- [MiniMax](/providers/minimax)
- [Mistral](/providers/mistral)
- [Moonshot AI (Kimi + Kimi Coding)](/providers/moonshot)
- [OpenAI (API + Codex)](/providers/openai)
- [OpenCode (Zen + Go)](/providers/opencode)
- [OpenRouter](/providers/openrouter)
- [Qianfan](/providers/qianfan)
- [Qwen](/providers/qwen)
- [Runway](/providers/runway)
- [StepFun](/providers/stepfun)
- [Synthetic](/providers/synthetic)
- [Vercel AI Gateway](/providers/vercel-ai-gateway)
- [Venice (Venice AI)](/providers/venice)
- [xAI](/providers/xai)
- [Z.AI (GLM)](/providers/zai)

## Additional provider variants

- `anthropic-vertex` - install `@openclaw/anthropic-vertex-provider` for implicit Anthropic on Google Vertex support when Vertex credentials are available; no separate onboarding auth choice
- `copilot-proxy` - local VS Code Copilot Proxy bridge; use `openclaw onboard --auth-choice copilot-proxy`
- `google-gemini-cli` - unofficial Gemini CLI OAuth flow; requires a local `gemini` install (`brew install gemini-cli` or `npm install -g @google/gemini-cli`); default model `google-gemini-cli/gemini-3-flash-preview`; use `openclaw onboard --auth-choice google-gemini-cli` or `openclaw models auth login --provider google-gemini-cli --set-default`

## Local-first automatic routing

Model selectors group catalog rows by route, certification, and capability instead of placing every model in one undifferentiated list. Routes are provider-neutral:

- **Local and self-hosted:** no remote model request is required.
- **Subscription:** remote capacity is included in an operator-owned subscription.
- **Metered API:** the attempt can create incremental usage charges.
- **Other or unclassified:** OpenClaw cannot prove the cost or location and does not assume it is free.

An explicit user model selection stays explicit. The routing policy applies only when OpenClaw is choosing automatically. This example prefers local models and prevents automatic paid or unclassified requests:

```json5
{
  models: {
    routing: {
      preference: "local-first",
      automaticMetered: "deny",
      automaticUnknown: "deny",
      automaticProfiles: {
        general: ["ollama/local-general"],
        vision: ["ollama/local-vision"],
        coding: ["ollama/local-code"],
      },
      requireCertifiedForAutomatic: true,
      certifications: {
        "ollama/local-general": {
          state: "certified",
          verifiedAt: "2026-07-12T00:00:00.000Z",
          evidence: "local-general-smoke-v1",
        },
      },
    },
    providers: {
      ollama: {
        route: { location: "local", billing: "included" },
      },
    },
  },
}
```

When metered automatic routing is explicitly allowed, at least one per-attempt, per-agent daily, or per-project daily ceiling is required. OpenClaw reserves the conservative maximum in a local durable ledger before attempting candidates governed by a daily ceiling. Missing permission, cost ceiling, price, token-limit, project, or route facts fail closed rather than estimating optimistically.

Provider-owned catalogs can refresh without hard-coding model release names:

```json5
{
  models: {
    catalogRefresh: { enabled: true, intervalMinutes: 60 },
  },
}
```

Periodic refresh is opt-in. A failed refresh retains the previous known-good catalog, and a manual refresh remains available through the model list UI. Catalog appearance does not certify a model for automatic work; certification remains an operator-owned evidence gate.

For the full provider catalog (xAI, Groq, Mistral, etc.) and advanced configuration,
see [Model providers](/concepts/model-providers).

## Related

- [Model selection](/concepts/model-providers)
- [Model failover](/concepts/model-failover)
- [Models CLI](/cli/models)
