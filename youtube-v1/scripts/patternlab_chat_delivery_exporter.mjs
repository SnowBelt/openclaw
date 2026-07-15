#!/usr/bin/env node
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// The runtime worktree intentionally does not carry the full OpenClaw
// node_modules tree.  Resolve Sharp from the configured canonical install,
// exactly as the Chrome renderer does, so chat-safe delivery does not fail in
// an otherwise healthy sparse/worktree environment.
const require = createRequire(import.meta.url);
const nodeModules = process.env.PATTERNLAB_NODE_MODULES;
const sharp = nodeModules ? require(path.join(nodeModules, "sharp")) : require("sharp");

const CHAT_WIDTH = 1280;
const CHAT_HEIGHT = 720;
const CONTACT_TILE_WIDTH = 480;
const CONTACT_TILE_HEIGHT = 270;
const CONTACT_COLUMNS = 2;
const BACKGROUND = "#080808";

function safeStem(value) {
  return (
    String(value || "thumbnail")
      .replace(/[^a-zA-Z0-9_.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "thumbnail"
  );
}

function sha12(filePath) {
  const digest = crypto.createHash("sha256");
  const data = fsSync.readFileSync(filePath);
  digest.update(data);
  return digest.digest("hex").slice(0, 12);
}

async function visualIntegrity(filePath) {
  const image = sharp(filePath).ensureAlpha();
  const meta = await image.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) {
    return {
      status: "blocked",
      lower_half_content_status: "blocked",
      blank_band_count: 1,
      blockers: ["missing_or_unreadable_image_dimensions"],
    };
  }
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const bands = [
    { name: "top", y0: 0, y1: Math.floor(height * 0.5) },
    { name: "lower_half", y0: Math.floor(height * 0.5), y1: height },
  ];
  const stats = [];
  const blankBands = [];
  for (const band of bands) {
    let white = 0;
    let transparent = 0;
    let sum = 0;
    let sumSq = 0;
    let edges = 0;
    let total = 0;
    for (let y = band.y0; y < band.y1; y += 1) {
      let prev = null;
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * info.channels;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const a = data[offset + 3];
        const luma = (r + g + b) / 3;
        if (r > 248 && g > 248 && b > 248) white += 1;
        if (a < 8) transparent += 1;
        if (prev !== null && Math.abs(luma - prev) > 18) edges += 1;
        prev = luma;
        sum += luma;
        sumSq += luma * luma;
        total += 1;
      }
    }
    const mean = total ? sum / total : 0;
    const variance = total ? Math.max(0, sumSq / total - mean * mean) : 0;
    const stddev = Math.sqrt(variance);
    const whitePct = total ? (white / total) * 100 : 100;
    const transparentPct = total ? (transparent / total) * 100 : 100;
    const edgePct = total ? (edges / total) * 100 : 0;
    const blank = transparentPct > 75 || (whitePct > 65 && stddev < 22 && edgePct < 0.35);
    const stat = {
      name: band.name,
      y0: band.y0,
      y1: band.y1,
      height: band.y1 - band.y0,
      white_pct: Number(whitePct.toFixed(2)),
      transparent_pct: Number(transparentPct.toFixed(2)),
      mean_luma: Number(mean.toFixed(1)),
      stddev_luma: Number(stddev.toFixed(1)),
      edge_pct: Number(edgePct.toFixed(3)),
      blank,
    };
    stats.push(stat);
    if (blank) blankBands.push(stat);
  }
  const lower = stats.find((item) => item.name === "lower_half");
  return {
    status: blankBands.length === 0 && lower && !lower.blank ? "pass" : "blocked",
    lower_half_content_status: lower && !lower.blank ? "pass" : "blocked",
    blank_band_count: blankBands.length,
    largest_blank_band_px: blankBands.reduce((max, item) => Math.max(max, item.height), 0),
    band_stats: stats,
    blockers: blankBands.map((item) => `blank_${item.name}`),
  };
}

async function validatePreview(filePath) {
  const meta = await sharp(filePath).metadata();
  const integrity = await visualIntegrity(filePath);
  const blockers = [];
  if (meta.width !== CHAT_WIDTH || meta.height !== CHAT_HEIGHT) {
    blockers.push(`wrong_chat_preview_dimensions:${meta.width}x${meta.height}`);
  }
  if (meta.format !== "jpeg") blockers.push(`wrong_chat_preview_format:${meta.format}`);
  if (meta.hasAlpha) blockers.push("chat_preview_has_alpha");
  if (integrity.status !== "pass") blockers.push("chat_preview_lower_half_blank_or_missing");
  return {
    status: blockers.length === 0 ? "pass" : "blocked",
    width: meta.width,
    height: meta.height,
    format: meta.format,
    channels: meta.channels,
    has_alpha: Boolean(meta.hasAlpha),
    visual_integrity: integrity,
    blockers,
  };
}

async function exportPreview(sourcePath, destinationPath) {
  await sharp(sourcePath)
    .resize(CHAT_WIDTH, CHAT_HEIGHT, { fit: "cover", position: "center" })
    .flatten({ background: BACKGROUND })
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(destinationPath);
}

async function makeContactSheet(artifacts, contactPath) {
  const rows = Math.max(1, Math.ceil(artifacts.length / CONTACT_COLUMNS));
  const composites = [];
  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index];
    const input = await sharp(artifact.chat_preview_path)
      .resize(CONTACT_TILE_WIDTH, CONTACT_TILE_HEIGHT, { fit: "cover", position: "center" })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    composites.push({
      input,
      left: (index % CONTACT_COLUMNS) * CONTACT_TILE_WIDTH,
      top: Math.floor(index / CONTACT_COLUMNS) * CONTACT_TILE_HEIGHT,
    });
  }
  await sharp({
    create: {
      width: CONTACT_COLUMNS * CONTACT_TILE_WIDTH,
      height: rows * CONTACT_TILE_HEIGHT,
      channels: 3,
      background: BACKGROUND,
    },
  })
    .composite(composites)
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(contactPath);
  const meta = await sharp(contactPath).metadata();
  const integrity = await visualIntegrity(contactPath);
  const blockers = [];
  if (meta.format !== "jpeg") blockers.push(`wrong_contact_sheet_format:${meta.format}`);
  if (meta.width > 1280) blockers.push(`contact_sheet_too_wide_for_chat:${meta.width}`);
  if (meta.height < CONTACT_TILE_HEIGHT) blockers.push(`contact_sheet_too_short:${meta.height}`);
  if (integrity.status !== "pass") blockers.push("contact_sheet_lower_half_blank_or_missing");
  return {
    path: contactPath,
    width: meta.width,
    height: meta.height,
    format: meta.format,
    layout: `${CONTACT_COLUMNS}x${rows}`,
    visual_integrity: integrity,
    status: blockers.length === 0 ? "pass" : "blocked",
    blockers,
  };
}

async function main() {
  const specPath = process.argv[2];
  const reportPath = process.argv[3];
  if (!specPath || !reportPath) {
    throw new Error("Usage: patternlab_chat_delivery_exporter.mjs <spec.json> <report.json>");
  }
  const spec = JSON.parse(await fs.readFile(specPath, "utf8"));
  const outputDir = spec.output_dir;
  const entries = Array.isArray(spec.entries) ? spec.entries : [];
  const blockers = [];
  await fs.mkdir(outputDir, { recursive: true });
  const artifacts = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const sourcePath = String(entry.path || "");
    if (!sourcePath || !fsSync.existsSync(sourcePath)) {
      blockers.push(`missing_rendered_thumbnail:${sourcePath || entry.variant_id || index + 1}`);
      continue;
    }
    const digest = sha12(sourcePath);
    const stem = safeStem(path.basename(sourcePath, path.extname(sourcePath)));
    const productionPath = path.join(
      outputDir,
      `thumb_${String(index + 1).padStart(2, "0")}_${stem}_${digest}_full.png`,
    );
    const chatPreviewPath = path.join(
      outputDir,
      `thumb_${String(index + 1).padStart(2, "0")}_${stem}_${digest}_chat.jpg`,
    );
    await fs.copyFile(sourcePath, productionPath);
    await exportPreview(sourcePath, chatPreviewPath);
    const validation = await validatePreview(chatPreviewPath);
    if (validation.status !== "pass")
      blockers.push(...validation.blockers.map((item) => `${stem}:${item}`));
    artifacts.push({
      variant_id: entry.variant_id || "",
      source_path: sourcePath,
      production_delivery_path: productionPath,
      chat_preview_path: chatPreviewPath,
      delivery_path: chatPreviewPath,
      sha12: digest,
      exists: fsSync.existsSync(chatPreviewPath),
      production_exists: fsSync.existsSync(productionPath),
      chat_preview_width: validation.width,
      chat_preview_height: validation.height,
      chat_preview_format: validation.format,
      chat_preview_has_alpha: validation.has_alpha,
      lower_half_content_status: validation.visual_integrity.lower_half_content_status,
      visual_integrity: validation.visual_integrity,
      validation_status: validation.status,
      blockers: validation.blockers,
    });
  }
  const contactSheetPath = path.join(
    outputDir,
    `contact_sheet_${crypto
      .createHash("sha256")
      .update(artifacts.map((artifact) => artifact.sha12).join(":"))
      .digest("hex")
      .slice(0, 12)}_chat.jpg`,
  );
  let contactSheet = {
    path: "",
    status: "blocked",
    blockers: ["no_artifacts_for_contact_sheet"],
  };
  if (artifacts.length > 0) {
    contactSheet = await makeContactSheet(artifacts, contactSheetPath);
    if (contactSheet.status !== "pass") blockers.push(...contactSheet.blockers);
  }
  const lowerHalfPassCount = artifacts.filter(
    (artifact) => artifact.lower_half_content_status === "pass",
  ).length;
  const status =
    artifacts.length === entries.length &&
    entries.length > 0 &&
    lowerHalfPassCount === artifacts.length &&
    contactSheet.status === "pass" &&
    blockers.length === 0
      ? "pass"
      : "blocked";
  const payload = {
    status,
    renderer: "sharp_chat_safe_delivery_exporter",
    preview_format: "jpeg_rgb_1280x720",
    contact_sheet_layout: contactSheet.layout || "missing",
    artifact_count: artifacts.length,
    required_artifact_count: entries.length,
    lower_half_pass_count: lowerHalfPassCount,
    required_lower_half_pass_count: entries.length,
    contact_sheet: contactSheet.path || "",
    contact_sheet_status: contactSheet.status,
    contact_sheet_width: contactSheet.width || 0,
    contact_sheet_height: contactSheet.height || 0,
    artifacts,
    blockers,
  };
  await fs.writeFile(reportPath, JSON.stringify(payload, null, 2) + "\n");
  console.log(JSON.stringify({ status: payload.status, report: reportPath }, null, 2));
}

main().catch(async (error) => {
  const reportPath = process.argv[3];
  const payload = {
    status: "blocked",
    renderer: "sharp_chat_safe_delivery_exporter",
    blockers: [error && error.stack ? error.stack : String(error)],
  };
  if (reportPath) {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(payload, null, 2) + "\n");
  }
  console.error(payload.blockers[0]);
  process.exit(1);
});
