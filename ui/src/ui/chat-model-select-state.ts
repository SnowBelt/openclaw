// Control UI module implements chat model select state behavior.
import type { AppViewState } from "./app-view-state.ts";
import {
  buildCatalogDisplayLookup,
  buildChatModelOptionFromLookup,
  formatCatalogChatModelDisplayFromLookup,
  normalizeChatModelOverrideValue,
  resolvePreferredServerChatModelValue,
} from "./chat-model-ref.ts";
import { pushUniqueTrimmedSelectOption } from "./select-options.ts";
import type { ModelCatalogEntry } from "./types.ts";

type ChatModelSelectStateInput = Pick<
  AppViewState,
  "sessionKey" | "chatModelOverrides" | "chatModelCatalog" | "sessionsResult"
>;

export type ChatModelSelectOption = {
  value: string;
  label: string;
};

export type ChatModelSelectOptionGroup = {
  label: string;
  options: ChatModelSelectOption[];
};

export type ChatModelSelectState = {
  currentOverride: string;
  defaultModel: string;
  defaultDisplay: string;
  defaultLabel: string;
  options: ChatModelSelectOption[];
  optionGroups: ChatModelSelectOptionGroup[];
};

function resolveModelRouteGroup(route?: ModelCatalogEntry["route"]): string {
  switch (route) {
    case "local":
      return "Local & self-hosted";
    case "subscription":
      return "Subscription";
    case "metered":
      return "Metered API";
    default:
      return "Other / unclassified";
  }
}

function resolveModelCapabilityGroup(entry: ModelCatalogEntry): string {
  const input = entry.input ?? ["text"];
  if (input.includes("image")) {
    return "Vision";
  }
  if (input.includes("document")) {
    return "Documents";
  }
  if (input.includes("audio")) {
    return "Audio";
  }
  if (input.includes("video")) {
    return "Video";
  }
  return "Text & coding";
}

function resolveModelCertificationGroup(entry: ModelCatalogEntry): string {
  switch (entry.certification) {
    case "certified":
      return "Certified";
    case "candidate":
      return "Manual review";
    default:
      return "Unverified";
  }
}

function resolveActiveSessionRow(state: ChatModelSelectStateInput) {
  return state.sessionsResult?.sessions?.find((row) => row.key === state.sessionKey);
}

export function resolveChatModelOverrideValue(state: ChatModelSelectStateInput): string {
  const catalog = state.chatModelCatalog ?? [];

  // Prefer the local cache — it reflects in-flight patches before sessionsResult refreshes.
  const cached = state.chatModelOverrides[state.sessionKey];
  if (cached) {
    return normalizeChatModelOverrideValue(cached, catalog);
  }
  if (cached === null) {
    return "";
  }

  const activeRow = resolveActiveSessionRow(state);
  return resolvePreferredServerChatModelValue(activeRow?.model, activeRow?.modelProvider, catalog);
}

function resolveDefaultModelValue(state: ChatModelSelectStateInput): string {
  return resolvePreferredServerChatModelValue(
    state.sessionsResult?.defaults?.model,
    state.sessionsResult?.defaults?.modelProvider,
    state.chatModelCatalog ?? [],
  );
}

function buildChatModelOptions(
  catalog: ModelCatalogEntry[],
  displayLookup: ReturnType<typeof buildCatalogDisplayLookup>,
  currentOverride: string,
  defaultModel: string,
): ChatModelSelectOption[] {
  const seen = new Set<string>();
  const options: ChatModelSelectOption[] = [];

  const addOption = (value: string, label?: string) => {
    pushUniqueTrimmedSelectOption(options, seen, value, (trimmed) => label ?? trimmed);
  };

  for (const entry of catalog) {
    const option = buildChatModelOptionFromLookup(entry, displayLookup);
    addOption(option.value, option.label);
  }

  if (currentOverride) {
    addOption(
      currentOverride,
      formatCatalogChatModelDisplayFromLookup(currentOverride, displayLookup),
    );
  }
  if (defaultModel) {
    addOption(defaultModel, formatCatalogChatModelDisplayFromLookup(defaultModel, displayLookup));
  }
  return options;
}

function groupChatModelOptions(
  catalog: ModelCatalogEntry[],
  displayLookup: ReturnType<typeof buildCatalogDisplayLookup>,
  options: ChatModelSelectOption[],
): ChatModelSelectOptionGroup[] {
  const groupsByValue = new Map<string, string>();
  for (const entry of catalog) {
    const option = buildChatModelOptionFromLookup(entry, displayLookup);
    groupsByValue.set(
      option.value.toLowerCase(),
      `${resolveModelRouteGroup(entry.route)} · ${resolveModelCertificationGroup(entry)} · ${resolveModelCapabilityGroup(entry)}`,
    );
  }
  const orderedLabels = [
    "Local & self-hosted",
    "Subscription",
    "Metered API",
    "Other / unclassified",
  ].flatMap((route) =>
    ["Certified", "Manual review", "Unverified"].flatMap((certification) =>
      ["Text & coding", "Vision", "Documents", "Audio", "Video"].map(
        (capability) => `${route} · ${certification} · ${capability}`,
      ),
    ),
  );
  const fallbackLabel = "Other / unclassified · Unverified · Text & coding";
  return orderedLabels
    .map((label) => ({
      label,
      options: options.filter(
        (option) => (groupsByValue.get(option.value.toLowerCase()) ?? fallbackLabel) === label,
      ),
    }))
    .filter((group) => group.options.length > 0);
}

export function resolveChatModelSelectState(
  state: ChatModelSelectStateInput,
): ChatModelSelectState {
  const catalog = state.chatModelCatalog ?? [];
  const displayLookup = buildCatalogDisplayLookup(catalog);
  const currentOverride = resolveChatModelOverrideValue(state);
  const defaultModel = resolveDefaultModelValue(state);
  const defaultDisplay = formatCatalogChatModelDisplayFromLookup(defaultModel, displayLookup);
  const options = buildChatModelOptions(catalog, displayLookup, currentOverride, defaultModel);

  return {
    currentOverride,
    defaultModel,
    defaultDisplay,
    defaultLabel: defaultModel ? `Default (${defaultDisplay})` : "Default model",
    options,
    optionGroups: groupChatModelOptions(catalog, displayLookup, options),
  };
}
