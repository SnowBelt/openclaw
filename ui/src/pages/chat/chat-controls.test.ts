/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { UiSettings } from "../../app/settings.ts";
import { t } from "../../i18n/index.ts";
import {
  isControlDirectorAgentRole,
  isControlDirectorCodexLunaSelection,
} from "../../lib/chat/control-director-thinking.ts";
import { renderChatControls } from "./components/chat-controls.ts";

type ChatControlsProps = Parameters<typeof renderChatControls>[0];

vi.mock("../../components/icons.ts", () => ({
  icons: {},
}));

function createSettings(): UiSettings {
  return {
    gatewayUrl: "ws://localhost:18789",
    token: "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    theme: "claw",
    themeMode: "dark",
    chatShowThinking: true,
    chatShowToolCalls: true,
    chatPersistCommentary: false,
    chatAutoScroll: "near-bottom",
    splitRatio: 0.6,
    navCollapsed: false,
    navWidth: 280,
    sidebarPinnedRoutes: ["overview", "workboard", "agents"],
    sidebarMoreExpanded: false,
    borderRadius: 50,
  };
}

function createProps(overrides: Record<string, unknown> = {}): ChatControlsProps {
  return {
    paneId: "test-pane",
    agentsList: null,
    connected: true,
    hideCronSessions: true,
    loading: false,
    manualRefreshInFlight: false,
    model: {
      activeRunId: null,
      connected: true,
      draftScope: {},
      gatewayAvailable: true,
      loading: false,
      modelCatalog: [],
      modelSwitching: false,
      sending: false,
      sessionKey: "main",
      sessionsResult: null,
      stream: null,
    },
    onboarding: false,
    runId: null,
    sending: false,
    settings: createSettings(),
    settingsOpen: true,
    sessionKey: "main",
    sessionsResult: null,
    stream: null,
    onRefresh: () => undefined,
    onSettingsChange: () => undefined,
    onSettingsOpenChange: () => undefined,
    realtimeTalkOptions: {
      model: "",
      voice: "marin",
      vadThreshold: "",
    },
    realtimeTalkInputDevices: [
      { deviceId: "built-in", label: "Built-in Microphone" },
      { deviceId: "usb", label: "USB Audio Interface" },
    ],
    realtimeTalkInputDeviceId: "built-in",
    onRealtimeTalkInputRefresh: () => undefined,
    onRealtimeTalkInputSelect: () => undefined,
    onRealtimeTalkOptionsChange: () => undefined,
    ...overrides,
  } as unknown as ChatControlsProps;
}

describe("chat composer settings", () => {
  it("uses the configured Control Director role instead of a fixed agent id", () => {
    expect(isControlDirectorAgentRole("control_director")).toBe(true);
    expect(isControlDirectorAgentRole("director")).toBe(false);
    expect(
      isControlDirectorCodexLunaSelection({
        agentRole: "control_director",
        provider: "openai",
        model: "openai/gpt-5.6-luna",
        agentRuntime: "codex",
      }),
    ).toBe(true);
    expect(
      isControlDirectorCodexLunaSelection({
        agentRole: "general",
        provider: "openai",
        model: "openai/gpt-5.6-luna",
        agentRuntime: "codex",
      }),
    ).toBe(false);
  });

  it("shows local contention and lets the Control Director set a model default", async () => {
    const onSetControlDirectorDefault = vi.fn(async () => true);
    const container = document.createElement("div");
    render(
      renderChatControls(
        createProps({
          model: {
            ...createProps().model,
            agentDefaultModel: "gpt-5.6-luna",
            controlDirector: true,
            modelCatalog: [
              {
                id: "gpt-5.6-luna",
                name: "GPT-5.6 Luna",
                provider: "openai",
                available: true,
                contextWindow: 272_000,
                contextTokens: 128_000,
                route: "subscription",
              },
              {
                id: "qwen3.6:27b-q8_0",
                name: "Qwen 3.6 27B",
                provider: "ollama",
                available: true,
                contextWindow: 131_072,
                route: "local",
              },
            ],
            onSetControlDirectorDefault,
            sessionsResult: {
              defaults: { model: "gpt-5.6-luna", modelProvider: "openai" },
              sessions: [
                {
                  key: "main",
                  model: "gpt-5.6-luna",
                  modelProvider: "openai",
                },
              ],
            },
            allAgentSessionsResult: {
              defaults: { model: "gpt-5.6-luna", modelProvider: "openai" },
              sessions: [
                {
                  key: "agent:coder:main",
                  model: "qwen3.6:27b-q8_0",
                  modelProvider: "ollama",
                  hasActiveRun: true,
                  status: "running",
                },
              ],
            },
          },
        }),
      ),
      container,
    );

    const qwenDefault = container.querySelector<HTMLButtonElement>(
      '[data-chat-model-set-default="ollama/qwen3.6:27b-q8_0"]',
    );
    const lunaDefault = container.querySelector<HTMLButtonElement>(
      '[data-chat-model-set-default="openai/gpt-5.6-luna"]',
    );
    expect(qwenDefault).toBeInstanceOf(HTMLButtonElement);
    expect(lunaDefault?.disabled).toBe(true);
    expect(
      container.querySelector('[data-chat-control-director-reset="true"]')?.textContent,
    ).toContain("Reset to Control Director default");
    expect(container.querySelector('[data-chat-model-contention="true"]')).not.toBeNull();
    const lunaMetadata = container
      .querySelector<HTMLButtonElement>('[data-chat-model-option="openai/gpt-5.6-luna"]')
      ?.querySelector<HTMLElement>(".chat-controls__model-option-provider")?.textContent;
    expect(lunaMetadata).toContain("128k context");
    expect(lunaMetadata).not.toContain("272k context");
    qwenDefault?.click();
    await vi.waitFor(() => {
      expect(onSetControlDirectorDefault).toHaveBeenCalledWith("ollama/qwen3.6:27b-q8_0");
    });
  });

  it("keeps the Control Director default action for aliased providers", () => {
    const container = document.createElement("div");
    render(
      renderChatControls(
        createProps({
          model: {
            ...createProps().model,
            agentDefaultModel: "google-gemini-cli/gemini-cli",
            controlDirector: true,
            modelCatalog: [
              {
                id: "gemini-cli",
                name: "Gemini CLI",
                provider: "google-gemini-cli",
                available: true,
                route: "subscription",
              },
            ],
            onSetControlDirectorDefault: vi.fn(async () => true),
            sessionsResult: {
              defaults: {
                model: "gemini-cli",
                modelProvider: "google-gemini-cli",
              },
              sessions: [
                {
                  key: "main",
                  model: "gemini-cli",
                  modelProvider: "google-gemini-cli",
                },
              ],
            },
          },
        }),
      ),
      container,
    );

    expect(
      container.querySelector('[data-chat-model-set-default="google-gemini-cli/gemini-cli"]'),
    ).toBeInstanceOf(HTMLButtonElement);
  });

  it("keeps distinct provider routes independently selectable as Control Director defaults", () => {
    const container = document.createElement("div");
    render(
      renderChatControls(
        createProps({
          model: {
            ...createProps().model,
            agentDefaultModel: "google/gemini",
            controlDirector: true,
            modelCatalog: [
              {
                id: "gemini",
                name: "Gemini",
                provider: "google",
                available: true,
              },
              {
                id: "gemini",
                name: "Gemini CLI",
                provider: "google-gemini-cli",
                available: true,
              },
            ],
            onSetControlDirectorDefault: vi.fn(async () => true),
            sessionsResult: {
              defaults: { model: "gemini", modelProvider: "google" },
              sessions: [
                {
                  key: "main",
                  model: "gemini",
                  modelProvider: "google",
                },
              ],
            },
          },
        }),
      ),
      container,
    );

    const googleDefault = container.querySelector<HTMLButtonElement>(
      '[data-chat-model-set-default="google/gemini"]',
    );
    const geminiCliDefault = container.querySelector<HTMLButtonElement>(
      '[data-chat-model-set-default="google-gemini-cli/gemini"]',
    );
    expect(googleDefault?.textContent).toContain("Default");
    expect(googleDefault?.disabled).toBe(true);
    expect(geminiCliDefault?.textContent).toContain("Set default");
    expect(geminiCliDefault?.disabled).toBe(false);
  });

  it("normalizes a legacy Codex-qualified Control Director default", () => {
    const container = document.createElement("div");
    render(
      renderChatControls(
        createProps({
          model: {
            ...createProps().model,
            agentDefaultModel: "codex/gpt-5.6-luna",
            controlDirector: true,
            modelCatalog: [
              {
                id: "gpt-5.6-luna",
                name: "GPT-5.6 Luna",
                provider: "openai",
                available: true,
              },
            ],
            onSetControlDirectorDefault: vi.fn(async () => true),
            sessionsResult: {
              defaults: { model: "gpt-5.6-luna", modelProvider: "openai" },
              sessions: [
                {
                  key: "main",
                  model: "gpt-5.6-luna",
                  modelProvider: "openai",
                },
              ],
            },
          },
        }),
      ),
      container,
    );

    expect(
      container.querySelector('[data-chat-model-set-default="openai/gpt-5.6-luna"]')?.textContent,
    ).toContain("Default");
    expect(
      (
        container.querySelector(
          '[data-chat-model-set-default="openai/gpt-5.6-luna"]',
        ) as HTMLButtonElement | null
      )?.disabled,
    ).toBe(true);
  });

  it("surfaces an unavailable active model without hiding the recovery path", () => {
    const container = document.createElement("div");
    render(
      renderChatControls(
        createProps({
          model: {
            ...createProps().model,
            modelCatalog: [
              {
                id: "gpt-5.6-luna",
                name: "GPT-5.6 Luna",
                provider: "openai",
                available: true,
              },
              {
                id: "gpt-5.5",
                name: "GPT-5.5",
                provider: "openai",
                available: false,
              },
            ],
            sessionsResult: {
              defaults: { model: "gpt-5.5", modelProvider: "openai" },
              sessions: [
                {
                  key: "main",
                  model: "gpt-5.5",
                  modelProvider: "openai",
                },
              ],
            },
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-controls__model-unavailable")).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('[data-chat-model-option="openai/gpt-5.5"]')
        ?.disabled,
    ).toBe(true);
  });

  it("combines chat and voice controls in one Settings menu", () => {
    const container = document.createElement("div");
    render(renderChatControls(createProps()), container);

    expect(container.querySelectorAll(`button[aria-label="${t("chat.settings")}"]`)).toHaveLength(
      1,
    );
    expect(container.querySelector('[aria-label="Talk settings"]')).toBeNull();
    expect(
      Array.from(container.querySelectorAll(".chat-settings-popover__label")).map((node) =>
        node.textContent?.trim(),
      ),
    ).toEqual(["Chat", "Voice"]);
    expect(container.querySelector('[aria-label="Voice options"]')).not.toBeNull();
    expect(container.querySelector('[data-talk-select="microphone"] select')).not.toBeNull();
  });

  it("keeps voice options editable from Settings", () => {
    const container = document.createElement("div");
    const onRealtimeTalkOptionsChange = vi.fn();
    render(renderChatControls(createProps({ onRealtimeTalkOptionsChange })), container);

    const voice = container.querySelector<HTMLSelectElement>('[data-talk-select="voice"] select');
    expect(voice).toBeInstanceOf(HTMLSelectElement);
    if (!(voice instanceof HTMLSelectElement)) {
      throw new Error("expected voice select");
    }
    voice.value = "cedar";
    voice.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onRealtimeTalkOptionsChange).toHaveBeenCalledWith({ voice: "cedar" });
  });

  it("keeps microphone selection in Voice settings", () => {
    const container = document.createElement("div");
    const onRealtimeTalkInputSelect = vi.fn();
    render(renderChatControls(createProps({ onRealtimeTalkInputSelect })), container);

    const microphone = container.querySelector<HTMLSelectElement>(
      '[data-talk-select="microphone"] select',
    );
    expect(microphone).toBeInstanceOf(HTMLSelectElement);
    if (!(microphone instanceof HTMLSelectElement)) {
      throw new Error("expected microphone select");
    }
    expect(microphone.value).toBe("built-in");
    microphone.value = "usb";
    microphone.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onRealtimeTalkInputSelect).toHaveBeenCalledWith("usb");
  });

  it("refreshes microphone access from Voice settings", () => {
    const container = document.createElement("div");
    const onRealtimeTalkInputRefresh = vi.fn();
    render(renderChatControls(createProps({ onRealtimeTalkInputRefresh })), container);

    const refresh = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Refresh: Microphone input"]',
    );
    expect(refresh).toBeInstanceOf(HTMLButtonElement);
    refresh?.click();

    expect(onRealtimeTalkInputRefresh).toHaveBeenCalledOnce();
  });

  it("keeps the composer control cluster limited to model and Settings controls", () => {
    const container = document.createElement("div");
    render(renderChatControls(createProps()), container);

    expect(Array.from(container.children).map((node) => node.className)).toEqual([
      "chat-settings-popover-wrapper",
      "chat-composer-model-control",
    ]);
    expect(container.querySelector('[data-chat-provider-usage="true"]')).toBeNull();
  });
});
