import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { resolveOpenClawStateSqlitePath } from "../state/openclaw-state-db.paths.js";

const providerStream = vi.hoisted(() => vi.fn());

vi.mock("../plugins/provider-runtime.js", () => ({
  resolveProviderStreamFn: vi.fn(() => providerStream),
}));

import { createAssistantMessageEventStream } from "../llm/utils/event-stream.js";
import { LOCAL_MODEL_ADMISSION_STATE_DIR_ENV } from "./local-model-admission.js";
import { registerProviderStreamForModel } from "./provider-stream.js";
import { buildAssistantMessageWithZeroUsage } from "./stream-message-shared.js";

const originalStateDir = process.env[LOCAL_MODEL_ADMISSION_STATE_DIR_ENV];
const stateRoots: string[] = [];

afterEach(() => {
  providerStream.mockReset();
  if (originalStateDir === undefined) {
    delete process.env[LOCAL_MODEL_ADMISSION_STATE_DIR_ENV];
  } else {
    process.env[LOCAL_MODEL_ADMISSION_STATE_DIR_ENV] = originalStateDir;
  }
  for (const root of stateRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("provider stream local-model admission", () => {
  it("holds a shared Ollama lease until the provider stream completes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-provider-stream-test-"));
    stateRoots.push(root);
    const env = {
      ...process.env,
      [LOCAL_MODEL_ADMISSION_STATE_DIR_ENV]: root,
    };
    const response = createAssistantMessageEventStream();
    providerStream.mockReturnValue(response);
    const streamFn = registerProviderStreamForModel({
      model: { api: "ollama", provider: "ollama", id: "qwen3.6:27b-q8_0" } as never,
      env,
    });

    expect(streamFn).toBeTypeOf("function");
    const stream = await streamFn!(
      { api: "ollama", provider: "ollama", id: "qwen3.6:27b-q8_0" } as never,
      {
        messages: [],
      } as never,
    );
    const sqlite = requireNodeSqlite();
    const db = new sqlite.DatabaseSync(resolveOpenClawStateSqlitePath(env), { readOnly: true });
    try {
      const during = db
        .prepare("SELECT payload_json AS payloadJson FROM state_leases WHERE scope = ?")
        .all("local-model") as Array<{ payloadJson: string }>;
      expect(during).toHaveLength(1);
      expect(JSON.parse(during[0]!.payloadJson)).toMatchObject({ mode: "shared" });
    } finally {
      db.close();
    }

    response.end(
      buildAssistantMessageWithZeroUsage({
        model: { api: "ollama", provider: "ollama", id: "qwen3.6:27b-q8_0" },
        content: [{ type: "text", text: "ok" }],
        stopReason: "stop",
      }),
    );
    await stream.result();
    const afterDb = new sqlite.DatabaseSync(resolveOpenClawStateSqlitePath(env), {
      readOnly: true,
    });
    try {
      expect(
        afterDb.prepare("SELECT 1 FROM state_leases WHERE scope = ?").all("local-model"),
      ).toEqual([]);
    } finally {
      afterDb.close();
    }
  });
});
