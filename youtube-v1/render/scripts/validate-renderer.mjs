import { validateRenderManifest } from "../src/contract.mjs";

const fixture = {
  episodeId: "04",
  assets: [{ assetId: "map", evidenceFit: "direct", sourceClass: "historical_evidence" }],
  beats: [
    { beatId: "map-proof", role: "map_system", assetIds: ["map"], startSeconds: 0, endSeconds: 3 },
  ],
};
const errors = validateRenderManifest(fixture);
if (errors.length) throw new Error(errors.join("\n"));
console.log("Pattern Lab renderer contract: pass");
