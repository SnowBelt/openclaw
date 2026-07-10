const PROOF_ROLES = new Set(["source_proof", "map_system", "archive_evidence", "document_detail"]);
const ALL_ROLES = new Set([
  ...PROOF_ROLES,
  "then_now",
  "context_only",
  "labeled_reconstruction",
  "city_file_cta",
]);

export function validateRenderManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") return ["manifest must be an object"];
  if (!/^\d{2}$/.test(String(manifest.episodeId || "")))
    errors.push("episodeId must be two digits");
  if (!Array.isArray(manifest.beats) || !manifest.beats.length)
    errors.push("beats must be non-empty");
  const assets = new Map((manifest.assets || []).map((asset) => [asset.assetId, asset]));
  for (const beat of manifest.beats || []) {
    if (!ALL_ROLES.has(beat.role)) errors.push(`invalid role:${beat.role}`);
    if (
      !Number.isFinite(beat.startSeconds) ||
      !Number.isFinite(beat.endSeconds) ||
      beat.endSeconds <= beat.startSeconds
    )
      errors.push(`invalid timing:${beat.beatId || "unknown"}`);
    if (!Array.isArray(beat.assetIds) || !beat.assetIds.length)
      errors.push(`missing assets:${beat.beatId || "unknown"}`);
    for (const assetId of beat.assetIds || []) {
      const asset = assets.get(assetId);
      if (!asset) errors.push(`unknown asset:${assetId}`);
      if (asset && PROOF_ROLES.has(beat.role) && asset.evidenceFit !== "direct")
        errors.push(`proof role requires direct evidence:${assetId}`);
      if (
        asset &&
        beat.role === "labeled_reconstruction" &&
        asset.sourceClass !== "ai_reconstruction"
      )
        errors.push(`reconstruction role requires reconstruction asset:${assetId}`);
    }
  }
  return errors;
}

export function renderSafeCaption(text) {
  const normalized = String(text || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) throw new Error("caption is required");
  if (normalized.length > 96) throw new Error("caption exceeds mobile-safe length");
  return normalized;
}
