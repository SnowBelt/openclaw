import { describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream } from "../llm/utils/event-stream.js";
import { createLocalModelAdmissionStreamFn } from "./local-model-admission-stream.js";
import { buildAssistantMessageWithZeroUsage } from "./stream-message-shared.js";

describe("local model admission stream wrapper", () => {
  it("holds the lease until the stream result resolves", async () => {
    const release = vi.fn(async () => undefined);
    const acquire = vi.fn(async () => ({
      schema: "openclaw.local-model-admission.v1" as const,
      token: "token",
      owner: "test",
      mode: "shared" as const,
      acquiredAt: 1,
      expiresAt: 2,
      statePath: "/tmp/state.json",
      borrowed: false,
      samples: [],
      renew: vi.fn(async () => undefined),
      release,
    }));
    const streamFn = vi.fn(() => {
      const stream = createAssistantMessageEventStream();
      stream.end(
        buildAssistantMessageWithZeroUsage({
          model: { api: "ollama", provider: "ollama", id: "local" },
          content: [{ type: "text", text: "ok" }],
          stopReason: "stop",
        }),
      );
      return stream;
    });
    const wrapped = createLocalModelAdmissionStreamFn({
      streamFn,
      owner: "test",
      acquire,
    });

    const stream = await wrapped(
      { api: "ollama", provider: "ollama", id: "local" } as never,
      { messages: [] } as never,
    );
    expect(release).not.toHaveBeenCalled();
    await stream.result();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases the lease when provider stream construction fails", async () => {
    const release = vi.fn(async () => undefined);
    const acquire = vi.fn(async () => ({
      schema: "openclaw.local-model-admission.v1" as const,
      token: "token",
      owner: "test",
      mode: "shared" as const,
      acquiredAt: 1,
      expiresAt: 2,
      statePath: "/tmp/state.json",
      borrowed: false,
      samples: [],
      renew: vi.fn(async () => undefined),
      release,
    }));
    const wrapped = createLocalModelAdmissionStreamFn({
      streamFn: () => {
        throw new Error("provider construction failed");
      },
      owner: "test",
      acquire,
    });
    await expect(
      wrapped(
        { api: "ollama", provider: "ollama", id: "local" } as never,
        { messages: [] } as never,
      ),
    ).rejects.toThrow("provider construction failed");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
