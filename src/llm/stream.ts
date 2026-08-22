// Streams LLM responses through registered providers and normalizes events.
// This facade owns the process-default AI runtime wiring: it installs the
// OpenClaw host policy ports and registers built-in providers exactly once,
// before any caller imports the stream API.
import { createApiRegistry, createLlmRuntime } from "@openclaw/ai";
import { defaultApiRegistry } from "@openclaw/ai/internal/runtime";
import { registerBuiltInApiProviders } from "@openclaw/ai/providers";
import "./ai-transport-host.js";

registerBuiltInApiProviders(defaultApiRegistry);

// The Judge gets a private built-in-only registry.  Plugin/custom-provider
// registration can replace entries in the compatibility registry, but it can
// never intercept this runtime because its registry is not exported.
const judgeApiRegistry = createApiRegistry();
registerBuiltInApiProviders(judgeApiRegistry);
const judgeRuntime = createLlmRuntime(judgeApiRegistry);

export {
  complete,
  completeSimple,
  getEnvApiKey,
  stream,
  streamSimple,
} from "@openclaw/ai/internal/runtime";

export const completeJudgeSimple = judgeRuntime.completeSimple;
