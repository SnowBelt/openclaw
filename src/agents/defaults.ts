// Defaults for agent metadata when upstream does not supply them.
// Keep this aligned with the product-level latest-model baseline.
export const DEFAULT_PROVIDER = "openai";
export const DEFAULT_MODEL = "gpt-5.5";
// Conservative fallback used when model metadata is unavailable.
export const DEFAULT_CONTEXT_TOKENS = 200_000;
// Codex OAuth exposes a 400k native window with a 272k runtime default.
// Keep this separate from the generic fallback so local models do not inherit
// a hosted-model budget when discovery is unavailable.
export const DEFAULT_OPENAI_CODEX_CONTEXT_TOKENS = 272_000;

export function resolveDefaultContextTokens(provider?: string, model?: string): number {
  const normalizedProvider = provider?.trim().toLowerCase();
  if (normalizedProvider !== "openai" && normalizedProvider !== "codex") {
    return DEFAULT_CONTEXT_TOKENS;
  }
  const normalizedModel = model?.trim().toLowerCase() ?? "";
  const modelFamily = normalizedModel.includes("/")
    ? (normalizedModel.split("/").at(-1) ?? normalizedModel)
    : normalizedModel;
  return /^gpt-[0-9]/.test(modelFamily)
    ? DEFAULT_OPENAI_CODEX_CONTEXT_TOKENS
    : DEFAULT_CONTEXT_TOKENS;
}
