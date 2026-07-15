import assert from "node:assert/strict";
import test from "node:test";
import { renderSafeCaption, validateRenderManifest } from "../src/contract.mjs";

test("rejects context visual as historical proof", () => {
  const errors = validateRenderManifest({
    episodeId: "04",
    assets: [{ assetId: "skyline", evidenceFit: "context_only", sourceClass: "modern_context" }],
    beats: [
      {
        beatId: "bad-proof",
        role: "source_proof",
        assetIds: ["skyline"],
        startSeconds: 0,
        endSeconds: 2,
      },
    ],
  });
  assert.ok(errors.some((error) => error.includes("proof role requires direct evidence")));
});

test("accepts a direct historical proof beat", () => {
  const errors = validateRenderManifest({
    episodeId: "04",
    assets: [{ assetId: "map", evidenceFit: "direct", sourceClass: "historical_evidence" }],
    beats: [
      { beatId: "proof", role: "map_system", assetIds: ["map"], startSeconds: 0, endSeconds: 2 },
    ],
  });
  assert.deepEqual(errors, []);
});

test("rejects caption that cannot fit a mobile-safe layout", () => {
  assert.throws(() => renderSafeCaption("x".repeat(97)));
});
