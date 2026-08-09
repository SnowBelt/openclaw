// Defaults for agent metadata when upstream does not supply them.
// Keep this aligned with the product-level latest-model baseline.
import { CODEX_DEFAULT_MODEL_ID } from "./harness/codex-model-policy.js";

export const DEFAULT_PROVIDER = "openai";
export const DEFAULT_MODEL = CODEX_DEFAULT_MODEL_ID;
// Conservative fallback used when model metadata is unavailable.
export const DEFAULT_CONTEXT_TOKENS = 200_000;
