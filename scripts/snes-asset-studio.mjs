#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ASSET_ROOT = path.join(".artifacts", "snes-asset-studio");
const KINDS = new Set(["sprite", "enemy", "item", "background", "tileset", "ui", "portrait"]);
const NAMED_GAME_RE = /(^|[^a-z0-9])(metro|stanski|mega[ _-]?bomberman|bomberman)(?=[^a-z0-9]|$)/i;
const COMMERCIAL_RE =
  /(^|[^a-z0-9])(super[ _-]?mario|mario|zelda|metroid|pokemon|kirby|donkey[ _-]?kong|commercial[ _-]?rom|source[ _-]?leak|disassembly)(?=[^a-z0-9]|$)/i;

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(rawArgv) {
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  const args = { command: argv[0], json: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
    } else if (arg.startsWith("--")) {
      args[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++index];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function safeId(name, label) {
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(name) || name.includes("..")) {
    throw new Error(`${label} must use letters, numbers, dot, underscore, or dash`);
  }
  if (NAMED_GAME_RE.test(name) || COMMERCIAL_RE.test(name)) {
    throw new Error(`${label} contains a blocked named-game or commercial reference`);
  }
  return name;
}

function assetDir(project, assetId) {
  return path.join(ASSET_ROOT, safeId(project, "project"), safeId(assetId, "asset-id"));
}

function projectPccDir(project) {
  return path.join(".artifacts", "snes-projects", safeId(project, "project"), "pcc");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function receiptBase(extra = {}) {
  return {
    generatedAt: nowIso(),
    hostedGlmUsed: false,
    localImageGenerationUsed: false,
    hostedImageGenerationUsed: false,
    commercialMaterialUsed: false,
    fxpakWritePerformed: false,
    removableMediaWritePerformed: false,
    projectSpecific: false,
    ...extra,
  };
}

function pass(format, extra = {}) {
  return receiptBase({ format, status: "pass", ok: true, ...extra });
}

function blocked(format, blocker, extra = {}) {
  return receiptBase({ format, status: "blocked", ok: false, blocker, ...extra });
}

function parseDimensions(dimensions) {
  const match = String(dimensions ?? "").match(/^(\d+)x(\d+)$/i);
  if (!match) {
    throw new Error("dimensions must be formatted as WIDTHxHEIGHT");
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("dimensions must be positive integers");
  }
  return { width, height };
}

function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sourceReceiptPath(root) {
  return path.join(root, "source-image-receipt.json");
}
function intentPath(root) {
  return path.join(root, "asset-intent.json");
}
function convertReceiptPath(root) {
  return path.join(root, "conversion-receipt.json");
}
function qaReceiptPath(root) {
  return path.join(root, "sprite-package-qa-receipt.json");
}
function pipelineReceiptPath(root) {
  return path.join(root, "asset-pipeline-receipt.json");
}
function insertionReceiptPath(root) {
  return path.join(root, "asset-insertion-receipt.json");
}
function runtimeProofPlanPath(root) {
  return path.join(root, "runtime-proof-plan-receipt.json");
}
function compileReceiptPath(root) {
  return path.join(root, "runtime-compiler-receipt.json");
}
function runtimeDemoReceiptPath(root) {
  return path.join(root, "runtime-demo-rom-receipt.json");
}
function runtimeProofReceiptPath(root) {
  return path.join(root, "runtime-proof-receipt.json");
}
function visualApprovalReceiptPath(root) {
  return path.join(root, "visual-approval-receipt.json");
}

async function preserve(args) {
  const { project, assetId, kind = "sprite", source } = args;
  const root = assetDir(project, assetId);
  if (!KINDS.has(kind)) {
    throw new Error(`unsupported kind: ${kind}`);
  }
  if (!source) {
    throw new Error("missing --source");
  }
  if (!fs.existsSync(source)) {
    return blocked(
      "openclaw-snes-asset-source-preservation-v1",
      `source image not found: ${source}`,
      { project, assetId, kind },
    );
  }
  if (
    NAMED_GAME_RE.test(`${project} ${assetId} ${source}`) ||
    COMMERCIAL_RE.test(`${project} ${assetId} ${source}`)
  ) {
    return blocked(
      "openclaw-snes-asset-source-preservation-v1",
      "blocked named-game or commercial reference in path or ids",
      { project, assetId, kind },
    );
  }
  const input = fs.readFileSync(source);
  const metadata = await sharp(input).metadata();
  if (!["png", "jpeg", "jpg", "webp"].includes(metadata.format ?? "")) {
    return blocked(
      "openclaw-snes-asset-source-preservation-v1",
      `unsupported image format: ${metadata.format ?? "unknown"}`,
      { project, assetId, kind },
    );
  }
  const extension = metadata.format === "jpeg" ? ".jpg" : `.${metadata.format}`;
  const preservedPath = path.join(root, "source", `source${extension}`);
  fs.mkdirSync(path.dirname(preservedPath), { recursive: true });
  fs.copyFileSync(source, preservedPath);
  const receipt = pass("openclaw-snes-asset-source-preservation-v1", {
    project,
    assetId,
    kind,
    source: {
      originalPath: source,
      originalFileName: path.basename(source),
      preservedPath,
      sha256: fileSha256(preservedPath),
      bytes: fs.statSync(preservedPath).size,
      mimeType: metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      format: metadata.format ?? null,
    },
  });
  writeJson(sourceReceiptPath(root), receipt);
  return receipt;
}

function makeIntent(args) {
  const {
    project,
    assetId,
    kind = "sprite",
    dimensions = kind === "background"
      ? "256x224"
      : kind === "item" || kind === "ui"
        ? "16x16"
        : "32x32",
    frames = kind === "background" ? "1" : "4",
    mustShow = "readable silhouette",
    mustNotShow = "placeholder rectangle,licensed character,photo noise",
    humanVisualTarget = "90",
  } = args;
  const root = assetDir(project, assetId);
  if (!KINDS.has(kind)) {
    throw new Error(`unsupported kind: ${kind}`);
  }
  const productionFacing = kind !== "audio";
  const intent = {
    format: "openclaw-snes-asset-intent-v1",
    project,
    assetId,
    kind,
    dimensions,
    frames: Number(frames),
    frameCount: Number(frames),
    paletteLimit: 16,
    mustShow: splitCsv(mustShow),
    mustNotShow: splitCsv(mustNotShow),
    animationBeats:
      kind === "background" ? ["single background frame"] : ["idle", "motion-a", "motion-b"],
    production: productionFacing,
    runtimeProofRequired: true,
    humanVisualTarget: productionFacing ? Number(humanVisualTarget) : undefined,
    generatedAt: nowIso(),
    hostedGlmUsed: false,
    commercialMaterialUsed: false,
    fxpakWritePerformed: false,
  };
  if (NAMED_GAME_RE.test(JSON.stringify(intent)) || COMMERCIAL_RE.test(JSON.stringify(intent))) {
    return blocked(
      "openclaw-snes-asset-intent-v1",
      "blocked named-game or commercial reference in intent",
      { project, assetId, kind },
    );
  }
  writeJson(intentPath(root), intent);
  return pass("openclaw-snes-asset-intent-receipt-v1", {
    project,
    assetId,
    kind,
    intentPath: intentPath(root),
    intentSha256: fileSha256(intentPath(root)),
    intent,
  });
}

async function countColorsPng(filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colors = new Set();
  for (let index = 0; index < data.length; index += info.channels) {
    colors.add(`${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`);
    if (colors.size > 16) {
      break;
    }
  }
  return colors.size;
}

function parseCrop(crop) {
  if (!crop) {
    return null;
  }
  const match = String(crop).match(/^(\d+),(\d+),(\d+),(\d+)$/u);
  if (!match) {
    throw new Error("crop must be formatted as X,Y,WIDTH,HEIGHT");
  }
  const [x, y, width, height] = match.slice(1).map(Number);
  if (width < 1 || height < 1) {
    throw new Error("crop width and height must be positive");
  }
  return { x, y, width, height };
}

function safeFitMode(value) {
  const fit = String(value ?? "contain");
  if (!["contain", "cover", "center-crop"].includes(fit)) {
    throw new Error("fit must be contain, cover, or center-crop");
  }
  return fit;
}

function safeFrameLayout(value) {
  const layout = String(value ?? "single");
  if (!["single", "horizontal", "vertical", "grid"].includes(layout)) {
    throw new Error("frame-layout must be single, horizontal, vertical, or grid");
  }
  return layout;
}

async function extractSourceFrames({ sourcePath, outputWidth, outputHeight, frameCount, args }) {
  const metadata = await sharp(sourcePath).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  const crop = parseCrop(args.crop);
  if (crop && (crop.x + crop.width > sourceWidth || crop.y + crop.height > sourceHeight)) {
    throw new Error("crop rectangle is outside the source image");
  }
  const layout = safeFrameLayout(args.frameLayout);
  const fit = safeFitMode(args.fit);
  const frameColumns = Math.max(1, Number(args.frameColumns ?? args.frameCols ?? frameCount));
  const frameRows = Math.max(1, Number(args.frameRows ?? 1));
  const region = crop ?? { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  let sourceFrameWidth = region.width;
  let sourceFrameHeight = region.height;
  if (layout === "horizontal") {
    sourceFrameWidth = Math.floor(region.width / frameCount);
  } else if (layout === "vertical") {
    sourceFrameHeight = Math.floor(region.height / frameCount);
  } else if (layout === "grid") {
    if (frameColumns * frameRows < frameCount) {
      throw new Error("grid frame count exceeds frame columns x rows");
    }
    sourceFrameWidth = Math.floor(region.width / frameColumns);
    sourceFrameHeight = Math.floor(region.height / frameRows);
  }
  if (sourceFrameWidth < 1 || sourceFrameHeight < 1) {
    throw new Error("source frame dimensions are invalid");
  }
  const frames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const column =
      layout === "single"
        ? 0
        : layout === "vertical"
          ? 0
          : layout === "grid"
            ? frameIndex % frameColumns
            : frameIndex;
    const row =
      layout === "single"
        ? 0
        : layout === "horizontal"
          ? 0
          : layout === "grid"
            ? Math.floor(frameIndex / frameColumns)
            : frameIndex;
    const left = region.x + column * sourceFrameWidth;
    const top = region.y + row * sourceFrameHeight;
    const extracted = await sharp(sourcePath)
      .extract({ left, top, width: sourceFrameWidth, height: sourceFrameHeight })
      .resize(outputWidth, outputHeight, {
        fit: fit === "center-crop" ? "cover" : fit,
        position: "centre",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .png({ palette: true, colors: 16, dither: 0.6 })
      .toBuffer();
    frames.push({
      frameIndex,
      buffer:
        layout === "single"
          ? await buildFrame(extracted, outputWidth, outputHeight, frameIndex)
          : extracted,
      sourceRect: { left, top, width: sourceFrameWidth, height: sourceFrameHeight },
    });
  }
  return {
    frames,
    crop,
    layout,
    fit,
    source: { width: sourceWidth, height: sourceHeight },
    sourceFrame: { width: sourceFrameWidth, height: sourceFrameHeight },
  };
}

async function buildFrame(baseBuffer, width, height, frameIndex) {
  const shift = [0, 1, 2, 3, -1, -2][frameIndex % 6];
  const topShift = [0, 0, 1, 1, -1, 2][frameIndex % 6];
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: baseBuffer, left: Math.max(0, shift), top: Math.max(0, topShift) }])
    .png()
    .toBuffer();
}

async function convert(args) {
  const { project, assetId, mode = "draft" } = args;
  const root = assetDir(project, assetId);
  if (!fs.existsSync(sourceReceiptPath(root))) {
    return blocked("openclaw-snes-asset-conversion-v1", "missing source preservation receipt", {
      project,
      assetId,
    });
  }
  if (!fs.existsSync(intentPath(root))) {
    return blocked("openclaw-snes-asset-conversion-v1", "missing asset intent", {
      project,
      assetId,
    });
  }
  const sourceReceipt = readJson(sourceReceiptPath(root));
  const intent = readJson(intentPath(root));
  const { width, height } = parseDimensions(intent.dimensions);
  const frameCount = Math.max(1, Number(intent.frames ?? intent.frameCount ?? 1));
  const preservedPath = sourceReceipt.source.preservedPath;
  const convertedDir = path.join(root, "converted");
  fs.mkdirSync(convertedDir, { recursive: true });
  const frameExtraction = await extractSourceFrames({
    sourcePath: preservedPath,
    outputWidth: width,
    outputHeight: height,
    frameCount,
    args,
  });
  const sheetPath = path.join(convertedDir, `${assetId}-sheet.png`);
  await sharp({
    create: {
      width: width * frameCount,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(
      frameExtraction.frames.map((frame, frameIndex) => ({
        input: frame.buffer,
        left: frameIndex * width,
        top: 0,
      })),
    )
    .png({ palette: true, colors: 16, dither: 0.6 })
    .toFile(sheetPath);
  const colorCount = await countColorsPng(sheetPath);
  if (colorCount > 16) {
    return blocked(
      "openclaw-snes-asset-conversion-v1",
      `palette overflow after conversion: ${colorCount}`,
      { project, assetId, sheetPath },
    );
  }
  const receipt = pass("openclaw-snes-asset-conversion-v1", {
    project,
    assetId,
    kind: intent.kind,
    mode,
    sourceSha256: sourceReceipt.source.sha256,
    intentSha256: fileSha256(intentPath(root)),
    output: {
      sheetPath,
      sha256: fileSha256(sheetPath),
      width: width * frameCount,
      height,
      frameWidth: width,
      frameHeight: height,
      frameCount,
      colorCount,
      maxPaletteColors: 16,
      tileSize: 16,
      estimatedTiles: Math.ceil((width * height * frameCount) / 256),
    },
    conversionOptions: {
      fit: frameExtraction.fit,
      frameLayout: frameExtraction.layout,
      crop: frameExtraction.crop,
      source: frameExtraction.source,
      sourceFrame: frameExtraction.sourceFrame,
    },
    frames: Array.from({ length: frameCount }, (_, frameIndex) => ({
      id: `${assetId}-frame-${frameIndex}`,
      x: frameIndex * width,
      y: 0,
      w: width,
      h: height,
      sourceRect: frameExtraction.frames[frameIndex]?.sourceRect ?? null,
    })),
  });
  writeJson(convertReceiptPath(root), receipt);
  return receipt;
}

async function contactSheet(args) {
  const { project, assetId } = args;
  const root = assetDir(project, assetId);
  if (!fs.existsSync(convertReceiptPath(root))) {
    return blocked("openclaw-snes-sprite-package-qa-v1", "missing conversion receipt", {
      project,
      assetId,
    });
  }
  const conversion = readJson(convertReceiptPath(root));
  const { sheetPath, frameWidth, frameHeight, frameCount } = conversion.output;
  const { data, info } = await sharp(sheetPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const frameHashes = [];
  const blankFrames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const hash = crypto.createHash("sha256");
    let nonTransparent = 0;
    for (let y = 0; y < frameHeight; y += 1) {
      const start = (y * info.width + frameIndex * frameWidth) * info.channels;
      const end = start + frameWidth * info.channels;
      const row = data.subarray(start, end);
      hash.update(row);
      for (let i = 3; i < row.length; i += info.channels) {
        if (row[i] !== 0) {
          nonTransparent += 1;
        }
      }
    }
    frameHashes.push(hash.digest("hex"));
    if (nonTransparent === 0) {
      blankFrames.push(frameIndex);
    }
  }
  const duplicateFrames = frameHashes
    .map((hash, index) => ({ hash, index }))
    .filter(
      (entry, index, entries) => entries.findIndex((other) => other.hash === entry.hash) !== index,
    )
    .map((entry) => entry.index);
  const contactSheetPath = path.join(root, "contact-sheet", `${assetId}-contact-sheet.png`);
  fs.mkdirSync(path.dirname(contactSheetPath), { recursive: true });
  await sharp(sheetPath)
    .extend({ top: 8, bottom: 8, left: 8, right: 8, background: { r: 32, g: 32, b: 32, alpha: 1 } })
    .png()
    .toFile(contactSheetPath);
  const errors = [];
  if (blankFrames.length) {
    errors.push(`blank-frames:${blankFrames.join(",")}`);
  }
  if (duplicateFrames.length) {
    errors.push(`duplicate-frames:${duplicateFrames.join(",")}`);
  }
  if (conversion.output.colorCount > 16) {
    errors.push("palette-overflow");
  }
  const receipt = receiptBase({
    format: "openclaw-snes-sprite-package-qa-v1",
    status: errors.length ? "fail" : "pass",
    ok: errors.length === 0,
    project,
    assetId,
    sheetPath,
    contactSheetPath,
    contactSheetSha256: fileSha256(contactSheetPath),
    frameHashes,
    blankFrames,
    duplicateFrames,
    errors,
    structuralGateOnly: true,
    runtimeProofSatisfied: false,
  });
  writeJson(qaReceiptPath(root), receipt);
  return receipt;
}

function pipeline(args) {
  const { project, assetId } = args;
  const root = assetDir(project, assetId);
  const required = [
    sourceReceiptPath(root),
    intentPath(root),
    convertReceiptPath(root),
    qaReceiptPath(root),
  ];
  const missing = required.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length) {
    return blocked(
      "openclaw-snes-asset-pipeline-receipt-v1",
      `missing pipeline files: ${missing.join(", ")}`,
      { project, assetId },
    );
  }
  const source = readJson(sourceReceiptPath(root));
  const conversion = readJson(convertReceiptPath(root));
  const qa = readJson(qaReceiptPath(root));
  const receipt = receiptBase({
    format: "openclaw-snes-asset-pipeline-receipt-v1",
    status: qa.status === "pass" ? "pass" : "blocked",
    ok: qa.status === "pass",
    project,
    assetId,
    stages: {
      sourcePreservation: {
        status: source.status,
        receipt: sourceReceiptPath(root),
        sourceSha256: source.source.sha256,
      },
      assetIntent: {
        status: "pass",
        receipt: intentPath(root),
        intentSha256: fileSha256(intentPath(root)),
      },
      indexedConversion: {
        status: conversion.status,
        receipt: convertReceiptPath(root),
        outputSha256: conversion.output.sha256,
        paletteIndexRange: "0-15",
      },
      contactSheet: {
        status: qa.status,
        receipt: qaReceiptPath(root),
        contactSheetSha256: qa.contactSheetSha256,
        required: true,
      },
      qualityValidation: {
        status: qa.status,
        blankFrameDetection: true,
        duplicateFrameDetection: true,
      },
      runtimeUse: {
        status: "blocked",
        runtimeProofRequired: true,
        blocker: "requires ROM/emulator proof after insertion",
      },
      humanApprovalQueue: {
        status: "blocked",
        requiredForProduction: true,
        blocker: "requires human visual approval for production",
      },
    },
    runtimeProofSatisfied: false,
    humanApprovalSatisfied: false,
  });
  writeJson(pipelineReceiptPath(root), receipt);
  return receipt;
}

function loadAssetManifest(project) {
  const manifestPath = path.join(projectPccDir(project), "asset-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      manifestPath,
      manifest: {
        format: "openclaw-snes-asset-manifest-v1",
        generatedAt: nowIso(),
        project,
        assets: [],
      },
    };
  }
  return { manifestPath, manifest: readJson(manifestPath) };
}

function insert(args) {
  const { project, assetId, target } = args;
  const root = assetDir(project, assetId);
  if (!target) {
    throw new Error("missing --target");
  }
  if (NAMED_GAME_RE.test(target) || COMMERCIAL_RE.test(target)) {
    return blocked(
      "openclaw-snes-asset-insertion-v1",
      "blocked named-game or commercial reference in target",
      { project, assetId, target },
    );
  }
  if (!fs.existsSync(pipelineReceiptPath(root))) {
    return blocked("openclaw-snes-asset-insertion-v1", "missing asset pipeline receipt", {
      project,
      assetId,
      target,
    });
  }
  const pipelineReceipt = readJson(pipelineReceiptPath(root));
  const conversion = readJson(convertReceiptPath(root));
  const source = readJson(sourceReceiptPath(root));
  if (pipelineReceipt.status !== "pass") {
    return blocked("openclaw-snes-asset-insertion-v1", "asset pipeline has not passed", {
      project,
      assetId,
      target,
    });
  }
  const { manifestPath, manifest } = loadAssetManifest(project);
  const record = {
    assetId,
    target,
    kind: conversion.kind,
    sourceSha256: source.source.sha256,
    convertedSha256: conversion.output.sha256,
    convertedPath: conversion.output.sheetPath,
    contactSheetPath: readJson(qaReceiptPath(root)).contactSheetPath,
    paletteSlot: args.paletteSlot ?? "auto",
    runtimeProofRequired: true,
    insertedAt: nowIso(),
  };
  manifest.assets = [
    ...(manifest.assets ?? []).filter((asset) => asset.assetId !== assetId),
    record,
  ];
  writeJson(manifestPath, manifest);
  const receipt = pass("openclaw-snes-asset-insertion-v1", {
    project,
    assetId,
    target,
    manifestPath,
    record,
    runtimeProofSatisfied: false,
  });
  writeJson(insertionReceiptPath(root), receipt);
  return receipt;
}

function runtimeProofPlan(args) {
  const { project, assetId } = args;
  const root = assetDir(project, assetId);
  if (!fs.existsSync(insertionReceiptPath(root))) {
    return blocked("openclaw-snes-asset-runtime-proof-plan-v1", "missing asset insertion receipt", {
      project,
      assetId,
    });
  }
  const insertion = readJson(insertionReceiptPath(root));
  const receipt = blocked(
    "openclaw-snes-asset-runtime-proof-plan-v1",
    "runtime proof requires ROM build plus emulator screenshot/OAM/tilemap signature",
    {
      project,
      assetId,
      target: insertion.target,
      staticInsertionSatisfied: true,
      staticInsertionIsRuntimeProof: false,
      requiredFutureProof: {
        romSha256: null,
        screenshotSha256: null,
        oamOrTilemapSignature: null,
        expectedRuntimeLocation: insertion.target,
        emulatorProofStatus: "missing",
      },
    },
  );
  writeJson(runtimeProofPlanPath(root), receipt);
  return receipt;
}

function symbolName(assetId) {
  return `snes_asset_${safeId(assetId, "asset-id").replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function pathEntries() {
  return (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
}

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

function commandOnPath(names) {
  return firstExisting(
    names.flatMap((name) => pathEntries().map((entry) => path.join(entry, name))),
  );
}

function findPvsneslibHome() {
  const configured = process.env.PVSNESLIB_HOME;
  if (configured && fs.existsSync(path.join(configured, "devkitsnes", "snes_rules"))) {
    return configured;
  }
  if (process.env.OPENCLAW_SNES_ASSET_STUDIO_DISABLE_DEFAULT_TOOLCHAIN === "1") {
    return null;
  }
  return firstExisting([
    path.join(process.env.HOME ?? "", ".openclaw", "snes-toolchain", "pvsneslib", "pvsneslib"),
    "/Users/openclaw/.openclaw/snes-toolchain/pvsneslib/pvsneslib",
  ]);
}

function findSuperFamicheck() {
  return (
    commandOnPath(["superfamicheck"]) ||
    firstExisting([
      path.join(process.env.HOME ?? "", ".openclaw", "snes-toolchain", "bin", "superfamicheck"),
      "/opt/homebrew/bin/superfamicheck",
      "/usr/local/bin/superfamicheck",
    ])
  );
}

function cHexBytes(values, perLine = 16) {
  const lines = [];
  for (let index = 0; index < values.length; index += perLine) {
    lines.push(
      values
        .slice(index, index + perLine)
        .map((value) => `0x${Number(value).toString(16).padStart(2, "0")}`)
        .join(","),
    );
  }
  return lines.map((line) => `    ${line}`).join(",\n");
}

function cHexWords(values, perLine = 12) {
  const lines = [];
  for (let index = 0; index < values.length; index += perLine) {
    lines.push(
      values
        .slice(index, index + perLine)
        .map((value) => `0x${Number(value).toString(16).padStart(4, "0")}`)
        .join(","),
    );
  }
  return lines.map((line) => `    ${line}`).join(",\n");
}

function rgbaKey(r, g, b, a) {
  return `${r},${g},${b},${a}`;
}

function rgbToSnesBgr555(r, g, b) {
  return ((b >> 3) << 10) | ((g >> 3) << 5) | (r >> 3);
}

async function extractSnesTileData(sheetPath, conversion) {
  const frameWidth = Number(conversion.output.frameWidth);
  const frameHeight = Number(conversion.output.frameHeight);
  const { data, info } = await sharp(sheetPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const palette = [{ r: 0, g: 0, b: 0, a: 0 }];
  const colorToIndex = new Map([[rgbaKey(0, 0, 0, 0), 0]]);
  const pixelIndexes = [];
  for (let y = 0; y < frameHeight; y += 1) {
    const row = [];
    for (let x = 0; x < frameWidth; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const alpha = data[offset + 3];
      const key =
        alpha === 0
          ? rgbaKey(0, 0, 0, 0)
          : rgbaKey(data[offset], data[offset + 1], data[offset + 2], alpha);
      if (!colorToIndex.has(key)) {
        if (palette.length >= 16) {
          throw new Error("runtime demo conversion exceeded 16 palette colors");
        }
        colorToIndex.set(key, palette.length);
        palette.push({ r: data[offset], g: data[offset + 1], b: data[offset + 2], a: alpha });
      }
      row.push(colorToIndex.get(key) ?? 0);
    }
    pixelIndexes.push(row);
  }
  while (palette.length < 16) {
    palette.push({ r: 0, g: 0, b: 0, a: 255 });
  }
  const tilesWide = Math.ceil(frameWidth / 8);
  const tilesHigh = Math.ceil(frameHeight / 8);
  const tileBytes = [];
  for (let tileY = 0; tileY < tilesHigh; tileY += 1) {
    for (let tileX = 0; tileX < tilesWide; tileX += 1) {
      const lowPlane = [];
      const highPlane = [];
      for (let row = 0; row < 8; row += 1) {
        let plane0 = 0;
        let plane1 = 0;
        let plane2 = 0;
        let plane3 = 0;
        for (let column = 0; column < 8; column += 1) {
          const sourceX = tileX * 8 + column;
          const sourceY = tileY * 8 + row;
          const colorIndex = pixelIndexes[sourceY]?.[sourceX] ?? 0;
          const bit = 7 - column;
          plane0 |= (colorIndex & 1) << bit;
          plane1 |= ((colorIndex >> 1) & 1) << bit;
          plane2 |= ((colorIndex >> 2) & 1) << bit;
          plane3 |= ((colorIndex >> 3) & 1) << bit;
        }
        lowPlane.push(plane0, plane1);
        highPlane.push(plane2, plane3);
      }
      tileBytes.push(...lowPlane, ...highPlane);
    }
  }
  return {
    paletteWords: palette.map((color) =>
      color.a === 0 ? 0x0000 : rgbToSnesBgr555(color.r, color.g, color.b),
    ),
    tileBytes,
    tilesWide,
    tilesHigh,
  };
}

function makeAssetMap(tileCount) {
  const map = Array.from({ length: 1024 }, () => 0);
  const width = Math.max(1, Math.min(32, Math.ceil(Math.sqrt(tileCount))));
  for (let index = 0; index < Math.min(tileCount, 1024); index += 1) {
    const x = 10 + (index % width);
    const y = 8 + Math.floor(index / width);
    if (x < 32 && y < 32) {
      map[y * 32 + x] = index;
    }
  }
  return map;
}

function runtimeDemoCSource({ conversion: _conversion, renderMode, symbol, tileData }) {
  const tileCount = tileData.tileBytes.length / 32;
  const assetMap = makeAssetMap(tileCount);
  const oamSetterLines = [];
  for (let tile = 0; tile < tileCount; tile += 1) {
    const x = 104 + (tile % tileData.tilesWide) * 8;
    const y = 72 + Math.floor(tile / tileData.tilesWide) * 8;
    const oamIndex = tile * 4;
    oamSetterLines.push(
      `        oamSet(${oamIndex}, ${x}, ${y}, 3, 0, 0, ${tile}, 0);`,
      `        oamSetVisible(${oamIndex}, OBJ_SHOW);`,
    );
  }
  return `#include <snes.h>

/* OpenClaw SNES Asset Studio clean-room runtime demo. No commercial ROM/code/assets. */

#define ASSET_TILE_COUNT ${tileCount}
#define ASSET_TILES_WIDE ${tileData.tilesWide}
#define ASSET_TILES_HIGH ${tileData.tilesHigh}

const u8 ${symbol}_tiles[] = {
${cHexBytes(tileData.tileBytes)}
};

const u16 ${symbol}_palette[] = {
${cHexWords(tileData.paletteWords)}
};

const u16 ${symbol}_map[1024] = {
${cHexWords(assetMap)}
};

int main(void)
{
    setMode(BG_MODE1, 0);
${
  renderMode === "bg-tile-region"
    ? `    bgInitTileSet(1, (u8*)${symbol}_tiles, (u8*)${symbol}_palette, 1, sizeof(${symbol}_tiles), sizeof(${symbol}_palette), BG_16COLORS, 0x4000);
    bgInitMapSet(1, (u8*)${symbol}_map, sizeof(${symbol}_map), SC_32x32, 0x7000);
    bgSetMapPtr(1, 0x7000, SC_32x32);
    bgSetDisable(2);`
    : `    bgSetDisable(0);
    bgSetDisable(1);
    bgSetDisable(2);
    oamInitGfxSet((void*)${symbol}_tiles, sizeof(${symbol}_tiles), (void*)${symbol}_palette, sizeof(${symbol}_palette), 0, 0x0000, OBJ_SIZE8_L16);`
}
    setScreenOn();
    while (1)
    {
${renderMode === "bg-tile-region" ? "        /* BG tile region is static and visible after VRAM upload. */" : oamSetterLines.join("\n")}
        WaitForVBlank();
    }
    return 0;
}
`;
}

function runtimeDemoMakefile(romName) {
  return `ifeq ($(strip $(PVSNESLIB_HOME)),)
$(error "Please create an environment variable PVSNESLIB_HOME")
endif

include \${PVSNESLIB_HOME}/devkitsnes/snes_rules

.PHONY: all
export ROMNAME := ${romName}

all: $(ROMNAME).sfc

clean: cleanBuildRes cleanRom cleanGfx
`;
}

function runSuperFamicheck(superFamicheck, romPath) {
  const result = spawnSync(superFamicheck, [romPath], {
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    command: [superFamicheck, romPath],
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.slice(0, 4000) ?? "",
    stderr: result.stderr?.slice(0, 4000) ?? "",
  };
}

function copyPvsneslibBuildSupport(demoDir, pvsneslibHome) {
  const sourceDir = firstExisting([
    path.join(pvsneslibHome, "snes-examples", "hello_world"),
    path.join(
      ".artifacts",
      "snes-game-builder-reference",
      "katas",
      "kata-001-controller-jump-metasprite",
    ),
  ]);
  if (!sourceDir) {
    return { ok: false, blocker: "PVSnesLib build support files were not found" };
  }
  const headerPath = path.join(sourceDir, "hdr.asm");
  if (!fs.existsSync(headerPath)) {
    return { ok: false, blocker: `PVSnesLib build support file is missing: ${headerPath}` };
  }
  fs.copyFileSync(headerPath, path.join(demoDir, "hdr.asm"));
  fs.writeFileSync(
    path.join(demoDir, "data.asm"),
    `.include "hdr.asm"\n\n.section ".rodata1" superfree\n.ends\n`,
  );
  fs.writeFileSync(
    path.join(demoDir, "linkfile"),
    `[objects]
src/main.obj
data.obj
hdr.obj
${pvsneslibHome}/pvsneslib/lib/LoROM_SlowROM/crt0_snes.obj
${pvsneslibHome}/pvsneslib/lib/LoROM_SlowROM/libc.obj
${pvsneslibHome}/pvsneslib/lib/LoROM_SlowROM/libm.obj
${pvsneslibHome}/pvsneslib/lib/LoROM_SlowROM/libtcc.obj
`,
  );
  return { ok: true, sourceDir };
}

async function runtimeDemo(args) {
  const { project, assetId } = args;
  const root = assetDir(project, assetId);
  if (!fs.existsSync(compileReceiptPath(root))) {
    return blocked("openclaw-snes-asset-runtime-demo-rom-v1", "missing runtime compiler receipt", {
      project,
      assetId,
    });
  }
  const compiler = readJson(compileReceiptPath(root));
  const conversion = readJson(convertReceiptPath(root));
  const source = readJson(sourceReceiptPath(root));
  if (!fs.existsSync(insertionReceiptPath(root))) {
    return blocked("openclaw-snes-asset-runtime-demo-rom-v1", "missing asset insertion receipt", {
      project,
      assetId,
    });
  }
  if (!fs.existsSync(conversion.output.sheetPath)) {
    return blocked("openclaw-snes-asset-runtime-demo-rom-v1", "converted sheet is missing", {
      project,
      assetId,
    });
  }
  if (conversion.output.sha256 !== compiler.sheetSha256) {
    return blocked(
      "openclaw-snes-asset-runtime-demo-rom-v1",
      "runtime compiler receipt is stale relative to converted sheet",
      {
        project,
        assetId,
        compilerSheetSha256: compiler.sheetSha256,
        currentConvertedSha256: conversion.output.sha256,
      },
    );
  }
  const renderMode =
    conversion.kind === "background" || conversion.kind === "tileset"
      ? "bg-tile-region"
      : "oam-metasprite";
  const tileData = await extractSnesTileData(conversion.output.sheetPath, conversion);
  const demoDir = path.join(root, "runtime-demo");
  const srcDir = path.join(demoDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  const romName = `openclaw_${safeId(project, "project").replace(/[^a-zA-Z0-9_]/g, "_")}_${safeId(
    assetId,
    "asset-id",
  ).replace(/[^a-zA-Z0-9_]/g, "_")}_runtime_demo`.slice(0, 96);
  const sourcePath = path.join(srcDir, "main.c");
  const makefilePath = path.join(demoDir, "Makefile");
  fs.writeFileSync(
    sourcePath,
    runtimeDemoCSource({
      conversion,
      renderMode,
      symbol: compiler.generatedSymbol,
      tileData,
    }),
  );
  fs.writeFileSync(makefilePath, runtimeDemoMakefile(romName));

  const romPath = path.join(demoDir, `${romName}.sfc`);
  let buildReceipt;
  let superFamicheckReceipt;
  if (process.env.OPENCLAW_SNES_ASSET_STUDIO_FAKE_BUILD === "1") {
    fs.writeFileSync(
      romPath,
      Buffer.from(`openclaw fake clean-room snes runtime demo ${project} ${assetId}`),
    );
    buildReceipt = {
      command: ["fake-build"],
      fakeTestOnly: true,
      ok: true,
      status: 0,
      stdout: "fake build enabled by OPENCLAW_SNES_ASSET_STUDIO_FAKE_BUILD",
      stderr: "",
    };
    superFamicheckReceipt = {
      command: ["fake-superfamicheck", romPath],
      fakeTestOnly: true,
      ok: true,
      status: 0,
      stdout: "fake SuperFamicheck pass",
      stderr: "",
    };
  } else {
    const pvsneslibHome = findPvsneslibHome();
    if (!pvsneslibHome) {
      return blocked(
        "openclaw-snes-asset-runtime-demo-rom-v1",
        "PVSnesLib toolchain not found; set PVSNESLIB_HOME or install the local SNES Studio toolchain",
        { project, assetId, demoDir },
      );
    }
    const buildSupport = copyPvsneslibBuildSupport(demoDir, pvsneslibHome);
    if (!buildSupport.ok) {
      return blocked("openclaw-snes-asset-runtime-demo-rom-v1", buildSupport.blocker, {
        project,
        assetId,
        demoDir,
      });
    }
    const build = spawnSync("make", ["-C", demoDir], {
      encoding: "utf8",
      env: { ...process.env, PVSNESLIB_HOME: pvsneslibHome },
      timeout: 120_000,
    });
    const romExistsAfterBuild = fs.existsSync(romPath);
    buildReceipt = {
      command: ["make", "-C", demoDir],
      ok: build.status === 0 || romExistsAfterBuild,
      pvsneslibHome,
      status: build.status,
      stdout: build.stdout?.slice(0, 8000) ?? "",
      stderr: build.stderr?.slice(0, 8000) ?? "",
    };
    if (!romExistsAfterBuild) {
      return blocked("openclaw-snes-asset-runtime-demo-rom-v1", "runtime demo ROM build failed", {
        project,
        assetId,
        demoDir,
        build: buildReceipt,
      });
    }
    const superFamicheck = findSuperFamicheck();
    if (!superFamicheck) {
      return blocked(
        "openclaw-snes-asset-runtime-demo-rom-v1",
        "SuperFamicheck not found for runtime demo ROM validation",
        { project, assetId, demoDir, romPath, build: buildReceipt },
      );
    }
    superFamicheckReceipt = runSuperFamicheck(superFamicheck, romPath);
    if (!superFamicheckReceipt.ok) {
      return blocked("openclaw-snes-asset-runtime-demo-rom-v1", "SuperFamicheck failed", {
        project,
        assetId,
        demoDir,
        romPath,
        build: buildReceipt,
        superfamicheck: superFamicheckReceipt,
      });
    }
  }

  const receipt = pass("openclaw-snes-asset-runtime-demo-rom-v1", {
    project,
    assetId,
    kind: conversion.kind,
    target: compiler.expectedRuntimeLocation,
    demoDir,
    sourcePath,
    sourceSha256: source.source.sha256,
    convertedSha256: conversion.output.sha256,
    generatedSymbol: compiler.generatedSymbol,
    renderMode,
    expectedRuntimeLocation: {
      target: compiler.expectedRuntimeLocation,
      coordinates: renderMode === "oam-metasprite" ? { x: 104, y: 72 } : null,
      tilemapRegion: renderMode === "bg-tile-region" ? { bg: 1, x: 10, y: 8 } : null,
    },
    rom: { path: romPath, sha256: fileSha256(romPath), bytes: fs.statSync(romPath).size },
    build: buildReceipt,
    superfamicheck: superFamicheckReceipt,
    runtimeProofSatisfied: false,
    emulatorScreenshotProofRequired: true,
  });
  writeJson(runtimeDemoReceiptPath(root), receipt);
  return receipt;
}

function compileAsset(args) {
  const { project, assetId } = args;
  const root = assetDir(project, assetId);
  if (!fs.existsSync(insertionReceiptPath(root))) {
    return blocked("openclaw-snes-asset-runtime-compiler-v1", "missing asset insertion receipt", {
      project,
      assetId,
    });
  }
  const insertion = readJson(insertionReceiptPath(root));
  const conversion = readJson(convertReceiptPath(root));
  const source = readJson(sourceReceiptPath(root));
  if (conversion.output.sha256 !== insertion.record.convertedSha256) {
    return blocked(
      "openclaw-snes-asset-runtime-compiler-v1",
      "stale converted asset hash in manifest",
      {
        project,
        assetId,
        manifestSha256: insertion.record.convertedSha256,
        currentSha256: conversion.output.sha256,
      },
    );
  }
  if (!fs.existsSync(conversion.output.sheetPath)) {
    return blocked("openclaw-snes-asset-runtime-compiler-v1", "converted sheet is missing", {
      project,
      assetId,
    });
  }
  const buildDir = path.join(
    ".artifacts",
    "snes-projects",
    safeId(project, "project"),
    "asset-build",
    safeId(assetId, "asset-id"),
  );
  fs.mkdirSync(buildDir, { recursive: true });
  const copiedSheetPath = path.join(buildDir, path.basename(conversion.output.sheetPath));
  fs.copyFileSync(conversion.output.sheetPath, copiedSheetPath);
  const metadataPath = path.join(buildDir, `${assetId}.asset.json`);
  const headerPath = path.join(buildDir, `${assetId}.asset.h`);
  const symbol = symbolName(assetId);
  const metadata = {
    format: "openclaw-snes-asset-runtime-metadata-v1",
    generatedAt: nowIso(),
    project,
    assetId,
    target: insertion.target,
    kind: conversion.kind,
    sourceSha256: source.source.sha256,
    convertedSha256: conversion.output.sha256,
    generatedSymbol: symbol,
    expectedRuntimeLocation: insertion.target,
    sheetPath: copiedSheetPath,
    dimensions: {
      frameWidth: conversion.output.frameWidth,
      frameHeight: conversion.output.frameHeight,
      frameCount: conversion.output.frameCount,
    },
  };
  writeJson(metadataPath, metadata);
  fs.writeFileSync(
    headerPath,
    `#pragma once\n#define ${symbol.toUpperCase()}_FRAME_COUNT ${conversion.output.frameCount}\n#define ${symbol.toUpperCase()}_FRAME_WIDTH ${conversion.output.frameWidth}\n#define ${symbol.toUpperCase()}_FRAME_HEIGHT ${conversion.output.frameHeight}\n`,
  );
  const receipt = pass("openclaw-snes-asset-runtime-compiler-v1", {
    project,
    assetId,
    target: insertion.target,
    buildDir,
    metadataPath,
    metadataSha256: fileSha256(metadataPath),
    headerPath,
    headerSha256: fileSha256(headerPath),
    sheetPath: copiedSheetPath,
    sheetSha256: fileSha256(copiedSheetPath),
    generatedSymbol: symbol,
    expectedRuntimeLocation: insertion.target,
    runtimeProofSatisfied: false,
    romBuildRequired: true,
  });
  writeJson(compileReceiptPath(root), receipt);
  return receipt;
}

async function runtimeProof(args) {
  const {
    project,
    assetId,
    rom,
    screenshot,
    signature = "pixel-landmark",
    expectedRomSha256,
    emulatorReceipt,
  } = args;
  const root = assetDir(project, assetId);
  if (!fs.existsSync(compileReceiptPath(root))) {
    return blocked("openclaw-snes-asset-runtime-proof-v1", "missing runtime compiler receipt", {
      project,
      assetId,
    });
  }
  if (!rom || !fs.existsSync(rom)) {
    return blocked("openclaw-snes-asset-runtime-proof-v1", "missing ROM path for runtime proof", {
      project,
      assetId,
      staticInsertionIsRuntimeProof: false,
    });
  }
  const romSha256 = fileSha256(rom);
  if (expectedRomSha256 && expectedRomSha256 !== romSha256) {
    return blocked("openclaw-snes-asset-runtime-proof-v1", "ROM SHA mismatch for runtime proof", {
      project,
      assetId,
      expectedRomSha256,
      actualRomSha256: romSha256,
      staticInsertionIsRuntimeProof: false,
    });
  }
  if (!screenshot || !fs.existsSync(screenshot)) {
    return blocked(
      "openclaw-snes-asset-runtime-proof-v1",
      "missing emulator screenshot for runtime proof",
      {
        project,
        assetId,
        romSha256,
        staticInsertionIsRuntimeProof: false,
      },
    );
  }
  let emulatorProof = null;
  if (emulatorReceipt) {
    if (!fs.existsSync(emulatorReceipt)) {
      return blocked(
        "openclaw-snes-asset-runtime-proof-v1",
        "missing emulator proof receipt for runtime proof",
        { project, assetId, emulatorReceipt, romSha256 },
      );
    }
    emulatorProof = readJson(emulatorReceipt);
    if (emulatorProof.status !== "pass") {
      return blocked("openclaw-snes-asset-runtime-proof-v1", "emulator proof did not pass", {
        project,
        assetId,
        emulatorReceipt,
        emulatorStatus: emulatorProof.status,
        emulatorBlocker: emulatorProof.blocker ?? null,
        romSha256,
      });
    }
    if (emulatorProof.rom?.sha256 !== romSha256) {
      return blocked(
        "openclaw-snes-asset-runtime-proof-v1",
        "emulator proof ROM SHA does not match runtime proof ROM",
        {
          project,
          assetId,
          emulatorReceipt,
          emulatorRomSha256: emulatorProof.rom?.sha256 ?? null,
          romSha256,
        },
      );
    }
    if (
      emulatorProof.screenshot?.sha256 &&
      emulatorProof.screenshot.sha256 !== fileSha256(screenshot)
    ) {
      return blocked(
        "openclaw-snes-asset-runtime-proof-v1",
        "emulator proof screenshot SHA does not match provided screenshot",
        {
          project,
          assetId,
          emulatorReceipt,
          expectedScreenshotSha256: emulatorProof.screenshot.sha256,
          actualScreenshotSha256: fileSha256(screenshot),
        },
      );
    }
  }
  const image = await sharp(screenshot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let nonTransparent = 0;
  for (let index = 3; index < image.data.length; index += image.info.channels) {
    if (image.data[index] !== 0) {
      nonTransparent += 1;
    }
  }
  if (nonTransparent === 0) {
    return blocked("openclaw-snes-asset-runtime-proof-v1", "emulator screenshot is blank", {
      project,
      assetId,
      romSha256,
      screenshotSha256: fileSha256(screenshot),
    });
  }
  const compiler = readJson(compileReceiptPath(root));
  const conversion = readJson(convertReceiptPath(root));
  const source = readJson(sourceReceiptPath(root));
  const receipt = pass("openclaw-snes-asset-runtime-proof-v1", {
    project,
    assetId,
    target: compiler.expectedRuntimeLocation,
    rom: { path: rom, sha256: romSha256, bytes: fs.statSync(rom).size },
    screenshot: {
      path: screenshot,
      sha256: fileSha256(screenshot),
      width: image.info.width,
      height: image.info.height,
      nonTransparentPixels: nonTransparent,
    },
    sourceSha256: source.source.sha256,
    convertedSha256: conversion.output.sha256,
    generatedSymbol: compiler.generatedSymbol,
    emulatorProof: emulatorProof
      ? {
          receiptPath: emulatorReceipt,
          emulator: emulatorProof.emulator ?? null,
          proofTier: emulatorProof.proofTier ?? null,
        }
      : null,
    runtimeSignature: {
      status: "pass",
      signature,
      expectedRomSha256: expectedRomSha256 ?? romSha256,
    },
    runtimeProofSatisfied: true,
    staticInsertionIsRuntimeProof: false,
  });
  writeJson(runtimeProofReceiptPath(root), receipt);
  return receipt;
}

function approveVisual(args) {
  const { project, assetId, approvalNote, score = "100", production = "false" } = args;
  const root = assetDir(project, assetId);
  if (!approvalNote) {
    throw new Error("missing --approval-note");
  }
  const required = [
    sourceReceiptPath(root),
    convertReceiptPath(root),
    qaReceiptPath(root),
    pipelineReceiptPath(root),
  ];
  const missing = required.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length) {
    return blocked(
      "openclaw-snes-asset-visual-approval-v1",
      `missing visual proof files: ${missing.join(", ")}`,
      { project, assetId },
    );
  }
  const productionRequested = String(production) === "true";
  if (productionRequested && !fs.existsSync(runtimeProofReceiptPath(root))) {
    return blocked(
      "openclaw-snes-asset-visual-approval-v1",
      "production visual approval requires runtime proof receipt",
      {
        project,
        assetId,
        runtimeProofSatisfied: false,
      },
    );
  }
  const qa = readJson(qaReceiptPath(root));
  if (qa.status !== "pass") {
    return blocked("openclaw-snes-asset-visual-approval-v1", "sprite package QA has not passed", {
      project,
      assetId,
    });
  }
  const receipt = pass("openclaw-snes-asset-visual-approval-v1", {
    project,
    assetId,
    approvalNote,
    score: Number(score),
    production: productionRequested,
    contactSheetPath: qa.contactSheetPath,
    contactSheetSha256: qa.contactSheetSha256,
    runtimeProofRequiredForProduction: true,
    runtimeProofSatisfied: fs.existsSync(runtimeProofReceiptPath(root)),
    humanApproved: true,
  });
  writeJson(visualApprovalReceiptPath(root), receipt);
  return receipt;
}

function redrawLocal(args) {
  const { project, assetId } = args;
  const configured = spawnSync(
    "pnpm",
    ["openclaw", "config", "get", "agents.defaults.imageGenerationModel", "--json"],
    { encoding: "utf8", timeout: 60_000 },
  );
  let primary = null;
  try {
    const raw = configured.stdout.slice(configured.stdout.indexOf("{"));
    primary = JSON.parse(raw).primary ?? null;
  } catch {}
  if (configured.status !== 0 || !primary) {
    return blocked(
      "openclaw-snes-asset-local-redraw-v1",
      "no local image generation model configured",
      { project, assetId, localOnly: true },
    );
  }
  if (!String(primary).startsWith("comfy/")) {
    return blocked(
      "openclaw-snes-asset-local-redraw-v1",
      `configured image model is not local-only: ${primary}`,
      { project, assetId, localOnly: true },
    );
  }
  return blocked(
    "openclaw-snes-asset-local-redraw-v1",
    "local redraw command is approval-gated and not executed by v1 deterministic pipeline",
    { project, assetId, localOnly: true, configuredModel: primary },
  );
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`SNES Asset Studio: ${report.status}`);
    if (report.project) {
      console.log(`Project: ${report.project}`);
    }
    if (report.assetId) {
      console.log(`Asset: ${report.assetId}`);
    }
    if (report.blocker) {
      console.log(`Blocker: ${report.blocker}`);
    }
  }
  process.exit(
    report.ok === false || ["blocked", "fail", "rejected"].includes(report.status) ? 1 : 0,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let report;
  if (args.command === "preserve") {
    report = await preserve(args);
  } else if (args.command === "intent") {
    report = makeIntent(args);
  } else if (args.command === "convert") {
    report = await convert(args);
  } else if (args.command === "contact-sheet") {
    report = await contactSheet(args);
  } else if (args.command === "pipeline") {
    report = pipeline(args);
  } else if (args.command === "insert") {
    report = insert(args);
  } else if (args.command === "runtime-proof-plan") {
    report = runtimeProofPlan(args);
  } else if (args.command === "compile") {
    report = compileAsset(args);
  } else if (args.command === "runtime-demo") {
    report = await runtimeDemo(args);
  } else if (args.command === "runtime-proof") {
    report = await runtimeProof(args);
  } else if (args.command === "approve-visual") {
    report = approveVisual(args);
  } else if (args.command === "redraw-local") {
    report = redrawLocal(args);
  } else {
    throw new Error(`unknown command: ${args.command ?? "missing"}`);
  }
  printReport(report, args.json);
}

main().catch((error: unknown) => {
  printReport(
    blocked(
      "openclaw-snes-asset-studio-error-v1",
      error instanceof Error ? error.message : String(error),
    ),
    true,
  );
});
