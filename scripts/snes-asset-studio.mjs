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
    if (arg === "--json") args.json = true;
    else if (arg.startsWith("--"))
      args[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
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

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
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
  if (!match) throw new Error("dimensions must be formatted as WIDTHxHEIGHT");
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

async function preserve(args) {
  const { project, assetId, kind = "sprite", source } = args;
  const root = assetDir(project, assetId);
  if (!KINDS.has(kind)) throw new Error(`unsupported kind: ${kind}`);
  if (!source) throw new Error("missing --source");
  if (!fs.existsSync(source))
    return blocked(
      "openclaw-snes-asset-source-preservation-v1",
      `source image not found: ${source}`,
      { project, assetId, kind },
    );
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
  if (!KINDS.has(kind)) throw new Error(`unsupported kind: ${kind}`);
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
    if (colors.size > 16) break;
  }
  return colors.size;
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
  if (!fs.existsSync(sourceReceiptPath(root)))
    return blocked("openclaw-snes-asset-conversion-v1", "missing source preservation receipt", {
      project,
      assetId,
    });
  if (!fs.existsSync(intentPath(root)))
    return blocked("openclaw-snes-asset-conversion-v1", "missing asset intent", {
      project,
      assetId,
    });
  const sourceReceipt = readJson(sourceReceiptPath(root));
  const intent = readJson(intentPath(root));
  const { width, height } = parseDimensions(intent.dimensions);
  const frameCount = Math.max(1, Number(intent.frames ?? intent.frameCount ?? 1));
  const preservedPath = sourceReceipt.source.preservedPath;
  const convertedDir = path.join(root, "converted");
  fs.mkdirSync(convertedDir, { recursive: true });
  const baseBuffer = await sharp(preservedPath)
    .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png({ palette: true, colors: 16, dither: 0.6 })
    .toBuffer();
  const frames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    frames.push(await buildFrame(baseBuffer, width, height, frameIndex));
  }
  const sheetPath = path.join(convertedDir, `${assetId}-sheet.png`);
  await sharp({
    create: {
      width: width * frameCount,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(frames.map((input, frameIndex) => ({ input, left: frameIndex * width, top: 0 })))
    .png({ palette: true, colors: 16, dither: 0.6 })
    .toFile(sheetPath);
  const colorCount = await countColorsPng(sheetPath);
  if (colorCount > 16)
    return blocked(
      "openclaw-snes-asset-conversion-v1",
      `palette overflow after conversion: ${colorCount}`,
      { project, assetId, sheetPath },
    );
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
    frames: Array.from({ length: frameCount }, (_, frameIndex) => ({
      id: `${assetId}-frame-${frameIndex}`,
      x: frameIndex * width,
      y: 0,
      w: width,
      h: height,
    })),
  });
  writeJson(convertReceiptPath(root), receipt);
  return receipt;
}

async function contactSheet(args) {
  const { project, assetId } = args;
  const root = assetDir(project, assetId);
  if (!fs.existsSync(convertReceiptPath(root)))
    return blocked("openclaw-snes-sprite-package-qa-v1", "missing conversion receipt", {
      project,
      assetId,
    });
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
      for (let i = 3; i < row.length; i += info.channels) if (row[i] !== 0) nonTransparent += 1;
    }
    frameHashes.push(hash.digest("hex"));
    if (nonTransparent === 0) blankFrames.push(frameIndex);
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
  if (blankFrames.length) errors.push(`blank-frames:${blankFrames.join(",")}`);
  if (duplicateFrames.length) errors.push(`duplicate-frames:${duplicateFrames.join(",")}`);
  if (conversion.output.colorCount > 16) errors.push("palette-overflow");
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
  if (missing.length)
    return blocked(
      "openclaw-snes-asset-pipeline-receipt-v1",
      `missing pipeline files: ${missing.join(", ")}`,
      { project, assetId },
    );
  const source = readJson(sourceReceiptPath(root));
  const intent = readJson(intentPath(root));
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
  if (!target) throw new Error("missing --target");
  if (NAMED_GAME_RE.test(target) || COMMERCIAL_RE.test(target))
    return blocked(
      "openclaw-snes-asset-insertion-v1",
      "blocked named-game or commercial reference in target",
      { project, assetId, target },
    );
  if (!fs.existsSync(pipelineReceiptPath(root)))
    return blocked("openclaw-snes-asset-insertion-v1", "missing asset pipeline receipt", {
      project,
      assetId,
      target,
    });
  const pipelineReceipt = readJson(pipelineReceiptPath(root));
  const conversion = readJson(convertReceiptPath(root));
  const source = readJson(sourceReceiptPath(root));
  if (pipelineReceipt.status !== "pass")
    return blocked("openclaw-snes-asset-insertion-v1", "asset pipeline has not passed", {
      project,
      assetId,
      target,
    });
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
  if (!fs.existsSync(insertionReceiptPath(root)))
    return blocked("openclaw-snes-asset-runtime-proof-plan-v1", "missing asset insertion receipt", {
      project,
      assetId,
    });
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
  if (configured.status !== 0 || !primary)
    return blocked(
      "openclaw-snes-asset-local-redraw-v1",
      "no local image generation model configured",
      { project, assetId, localOnly: true },
    );
  if (!String(primary).startsWith("comfy/"))
    return blocked(
      "openclaw-snes-asset-local-redraw-v1",
      `configured image model is not local-only: ${primary}`,
      { project, assetId, localOnly: true },
    );
  return blocked(
    "openclaw-snes-asset-local-redraw-v1",
    "local redraw command is approval-gated and not executed by v1 deterministic pipeline",
    { project, assetId, localOnly: true, configuredModel: primary },
  );
}

function printReport(report, json) {
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`SNES Asset Studio: ${report.status}`);
    if (report.project) console.log(`Project: ${report.project}`);
    if (report.assetId) console.log(`Asset: ${report.assetId}`);
    if (report.blocker) console.log(`Blocker: ${report.blocker}`);
  }
  process.exit(
    report.ok === false || ["blocked", "fail", "rejected"].includes(report.status) ? 1 : 0,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let report;
  if (args.command === "preserve") report = await preserve(args);
  else if (args.command === "intent") report = makeIntent(args);
  else if (args.command === "convert") report = await convert(args);
  else if (args.command === "contact-sheet") report = await contactSheet(args);
  else if (args.command === "pipeline") report = pipeline(args);
  else if (args.command === "insert") report = insert(args);
  else if (args.command === "runtime-proof-plan") report = runtimeProofPlan(args);
  else if (args.command === "redraw-local") report = redrawLocal(args);
  else throw new Error(`unknown command: ${args.command ?? "missing"}`);
  printReport(report, args.json);
}

main().catch((error) => {
  printReport(
    blocked(
      "openclaw-snes-asset-studio-error-v1",
      error instanceof Error ? error.message : String(error),
    ),
    true,
  );
});
