import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const providerStream = vi.hoisted(() => vi.fn());

vi.mock("../plugins/provider-runtime.js", () => ({
  resolveProviderStreamFn: vi.fn(() => providerStream),
}));

import { createAssistantMessageEventStream } from "../llm/utils/event-stream.js";
import { registerProviderStreamForModel } from "./provider-stream.js";
import { buildAssistantMessageWithZeroUsage } from "./stream-message-shared.js";

const admissionEnv = "OPENCLAW_LOCAL_MODEL_ADMISSION_PATH";
const originalAdmissionPath = process.env[admissionEnv];

afterEach(() => {
  providerStream.mockReset();
  if (originalAdmissionPath === undefined) {
    delete process.env[admissionEnv];
  } else {
    process.env[admissionEnv] = originalAdmissionPath;
  }
});

describe("provider stream local-model admission", () => {
  it("holds a shared Ollama lease until the provider stream completes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-provider-stream-test-"));
    const statePath = path.join(root, "state.json");
    process.env[admissionEnv] = statePath;
    const response = createAssistantMessageEventStream();
    providerStream.mockReturnValue(response);
    const streamFn = registerProviderStreamForModel({
      model: { api: "ollama", provider: "ollama", id: "qwen3.6:27b-q8_0" } as never,
    });

    expect(streamFn).toBeTypeOf("function");
    const stream = await streamFn!(
      { api: "ollama", provider: "ollama", id: "qwen3.6:27b-q8_0" } as never,
      {
        messages: [],
      } as never,
    );
    const during = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      leases: Array<{ mode: string }>;
    };
    expect(during.leases).toHaveLength(1);
    expect(during.leases[0]?.mode).toBe("shared");

    response.end(
      buildAssistantMessageWithZeroUsage({
        model: { api: "ollama", provider: "ollama", id: "qwen3.6:27b-q8_0" },
        content: [{ type: "text", text: "ok" }],
        stopReason: "stop",
      }),
    );
    await stream.result();
    const after = JSON.parse(fs.readFileSync(statePath, "utf8")) as { leases: unknown[] };
    expect(after.leases).toEqual([]);
  });
});
