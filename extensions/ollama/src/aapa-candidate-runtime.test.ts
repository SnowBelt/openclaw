import { describe, expect, it } from "vitest";

import { normalizeOllamaStructuredOutput } from "./stream.js";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string" },
    items: { type: "array", minItems: 1, items: { type: "string" } },
  },
  required: ["status", "items"],
};

describe("sealed AAPA candidate Ollama parser", () => {
  it("recovers a truncated JSON envelope before schema validation", () => {
    const normalized = normalizeOllamaStructuredOutput('{"status":"ok","items":["backup"]', schema);
    expect(JSON.parse(normalized)).toEqual({ status: "ok", items: ["backup"] });
  });

  it("recovers an omitted comma between array values", () => {
    const normalized = normalizeOllamaStructuredOutput(
      '{"status":"ok","items":["backup" "validated"]}',
      schema,
    );
    expect(JSON.parse(normalized)).toEqual({
      status: "ok",
      items: ["backup", "validated"],
    });
  });
});
