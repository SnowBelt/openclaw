#!/usr/bin/env node
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const nodeModules = process.env.PATTERNLAB_NODE_MODULES;
const sharp = nodeModules ? require(path.join(nodeModules, "sharp")) : require("sharp");

const WIDTH = 1920;
const HEIGHT = 1080;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cssUrl(filePath) {
  const data = fsSyncRead(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const type =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".woff2"
          ? "font/woff2"
          : ext === ".ttf"
            ? "font/ttf"
            : "image/jpeg";
  return `data:${type};base64,${data.toString("base64")}`;
}

function fsSyncRead(filePath) {
  return fsSync.readFileSync(filePath);
}

function fontFaceCss(fonts) {
  return fonts
    .map((font) => {
      const url = cssUrl(font.absolute_path);
      return `@font-face{font-family:'${font.family}';src:url('${url}') format('woff2');font-weight:${font.weight || 900};font-style:normal;font-display:block;}`;
    })
    .join("\n");
}

function effectClass(effectId) {
  const known = new Set([
    "bold_white_black_stroke_yellow_shadow",
    "yellow_black_stroke_red_shadow",
    "red_banner_white_condensed",
    "sticker_outline_double_shadow",
    "city_anchor_photo_overlay",
    "slanted_urgent_label",
    "comic_pop_black_stroke_red_shadow",
    "sticker_cutout_yellow_slab",
    "deep_3d_urgent_white",
    "editorial_white_glow",
    "editorial_gold_ink",
  ]);
  return known.has(effectId) ? effectId : "bold_white_black_stroke_yellow_shadow";
}

function fontsForEntry(entry, fonts) {
  const wanted = new Set(
    [
      entry.city_font_family || entry.main_font_family,
      entry.main_font_family,
      entry.support_font_family || "Barlow Condensed",
    ].filter(Boolean),
  );
  return fonts.filter((font) => wanted.has(font.family));
}

function htmlFor(entry, fonts) {
  const entryFonts = fontsForEntry(entry, fonts);
  const bg = cssUrl(entry.image);
  const inset = entry.inset_image ? cssUrl(entry.inset_image) : "";
  const main = esc(entry.main).replaceAll("\\n", "<br/>");
  const cityFont = esc(entry.city_font_family || entry.main_font_family);
  const mainFont = esc(entry.main_font_family);
  const supportFont = esc(entry.support_font_family || "Barlow Condensed");
  const effect = effectClass(entry.effect_recipe_id);
  const textAlign = entry.main_align || "left";
  const mainLeft = entry.main_left ?? 74;
  const mainTop = entry.main_top ?? 274;
  const mainWidth = entry.main_width ?? 1140;
  const mainSize = entry.main_size ?? 190;
  const cityColor = entry.city_color || "#FFD600";
  const supportBg = entry.support_bg || "#ED0014";
  const supportColor = entry.support_color || "#FFFFFF";
  const supportText = esc(entry.support);
  const supportDisplay =
    entry.support_hidden || !String(entry.support || "").trim() ? "none" : "flex";
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
${fontFaceCss(entryFonts)}
*{box-sizing:border-box}html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:#050505}.thumb{position:relative;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:#050505;color:#fff;font-synthesis:none}.bg{position:absolute;inset:0;background-image:url('${bg}');background-size:cover;background-position:${entry.background_position || "center"};filter:saturate(${entry.saturation || 1.38}) brightness(${entry.brightness || 1.12}) contrast(${entry.contrast || 1.08});transform:scale(1.015)}.wash{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.18),rgba(0,0,0,.02) 48%,rgba(0,0,0,.22)),radial-gradient(circle at 72% 18%,rgba(255,214,0,.24),rgba(255,214,0,0) 28%),linear-gradient(180deg,rgba(255,255,255,.18),rgba(255,255,255,0) 28%)}.city{position:absolute;left:${entry.city_left ?? 52}px;top:${entry.city_top ?? 34}px;width:${entry.city_width ?? 1100}px;height:150px;font-family:'${cityFont}';font-size:${entry.city_size || 132}px;line-height:.9;letter-spacing:${entry.city_tracking ?? -2}px;color:${cityColor};-webkit-text-stroke:3px #050505;text-shadow:0 10px 0 rgba(0,0,0,.42),0 18px 36px rgba(0,0,0,.45);white-space:nowrap}.main{position:absolute;left:${mainLeft}px;top:${mainTop}px;width:${mainWidth}px;min-height:420px;font-family:'${mainFont}';font-size:${mainSize}px;line-height:.82;letter-spacing:${entry.main_tracking ?? -2}px;text-align:${textAlign};text-transform:uppercase}.main.bold_white_black_stroke_yellow_shadow{color:#fff;-webkit-text-stroke:3px #050505;text-shadow:8px 9px 0 #FFD600,13px 15px 0 rgba(0,0,0,.62),0 24px 48px rgba(0,0,0,.50)}.main.yellow_black_stroke_red_shadow{color:#FFD600;-webkit-text-stroke:3px #050505;text-shadow:8px 9px 0 #ED0014,13px 15px 0 rgba(0,0,0,.62),0 24px 48px rgba(0,0,0,.50)}.main.sticker_outline_double_shadow{color:#fff;-webkit-text-stroke:2px #050505;text-shadow:8px 8px 0 #ED0014,15px 15px 0 #FFD600,20px 22px 0 rgba(0,0,0,.56)}.main.comic_pop_black_stroke_red_shadow{color:#fff;-webkit-text-stroke:5px #050505;text-shadow:9px 9px 0 #ED0014,15px 15px 0 #FFD600,22px 24px 0 rgba(0,0,0,.65),0 28px 52px rgba(0,0,0,.58);filter:drop-shadow(0 0 2px #050505)}.main.sticker_cutout_yellow_slab{color:#FFD600;-webkit-text-stroke:5px #050505;text-shadow:8px 8px 0 #fff,15px 16px 0 #ED0014,22px 24px 0 rgba(0,0,0,.68);background:linear-gradient(90deg,rgba(5,5,5,.78),rgba(5,5,5,.30));border-radius:22px;padding:20px 34px}.main.deep_3d_urgent_white{color:#fff;-webkit-text-stroke:4px #050505;text-shadow:6px 6px 0 #ED0014,12px 12px 0 #7A000A,18px 19px 0 #050505,0 28px 62px rgba(0,0,0,.70)}.main.editorial_white_glow{color:#fff;-webkit-text-stroke:2px #050505;text-shadow:0 4px 0 #050505,0 10px 22px rgba(0,0,0,.64),7px 9px 0 rgba(237,0,20,.88)}.main.editorial_gold_ink{color:#FFD600;-webkit-text-stroke:2px #050505;text-shadow:0 4px 0 #050505,0 10px 22px rgba(0,0,0,.64),7px 9px 0 rgba(237,0,20,.88)}.main.red_banner_white_condensed{color:#fff;background:#ED0014;border:9px solid #050505;border-radius:14px;padding:26px 38px;transform:rotate(-2deg);box-shadow:18px 20px 0 #FFD600,0 30px 72px rgba(0,0,0,.58);-webkit-text-stroke:2px #050505}.support{position:absolute;left:${entry.support_left ?? 96}px;bottom:${entry.support_bottom ?? 88}px;width:${entry.support_width ?? 650}px;height:112px;display:${supportDisplay};align-items:center;justify-content:center;font-family:'${supportFont}';font-size:${entry.support_size ?? 58}px;line-height:.9;letter-spacing:${entry.support_tracking ?? 0}px;text-transform:uppercase;background:${supportBg};color:${supportColor};border:8px solid #050505;border-radius:12px;box-shadow:0 18px 42px rgba(0,0,0,.50);transform:rotate(${entry.support_rotate ?? -1}deg)}.support.yellow{background:#FFD600;color:#050505}.inset{position:absolute;right:${entry.inset_right ?? 82}px;top:${entry.inset_top ?? 124}px;width:${entry.inset_width ?? 610}px;height:${entry.inset_height ?? 390}px;background-image:url('${inset}');background-size:cover;background-position:center;border:13px solid ${entry.inset_border || "#FFD600"};box-shadow:0 28px 72px rgba(0,0,0,.56);transform:rotate(${entry.inset_rotate ?? 4}deg);display:${inset ? "block" : "none"}}.insetLabel{position:absolute;right:${entry.inset_right ?? 82}px;top:${(entry.inset_top ?? 124) + (entry.inset_height ?? 390) - 56}px;width:${entry.inset_width ?? 610}px;height:64px;background:#050505;color:#fff;font-family:'${supportFont}';font-size:36px;display:${inset && entry.inset_label ? "flex" : "none"};align-items:center;justify-content:center;letter-spacing:.4px;text-transform:uppercase;transform:rotate(${entry.inset_rotate ?? 4}deg)}.shine{position:absolute;left:-100px;top:-220px;width:920px;height:920px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.22),rgba(255,255,255,0) 58%)}.edge{position:absolute;right:-180px;bottom:-220px;width:680px;height:680px;border-radius:50%;background:radial-gradient(circle,rgba(237,0,20,.32),rgba(237,0,20,0) 58%)}</style></head><body><div class="thumb"><div class="bg"></div><div class="wash"></div><div class="shine"></div><div class="edge"></div><div class="city">${esc(entry.city)}</div><div class="inset"></div><div class="insetLabel">${esc(entry.inset_label || "")}</div><div class="main ${effect}">${main}</div><div class="support ${entry.support_variant || ""}">${supportText}</div></div></body></html>`;
}

async function makeOcrAudit(entry, workDir) {
  const auditDir = path.join(workDir, "ocr-audit");
  await fs.mkdir(auditDir, { recursive: true });
  const auditPath = path.join(auditDir, `${entry.variant_id}-ocr-audit.png`);
  const main = esc(entry.main).replaceAll("\\n", " ").replaceAll("\n", " ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
    <rect width="1200" height="675" fill="white"/>
    <text x="60" y="145" font-family="Arial, sans-serif" font-size="96" font-weight="900" fill="black">${esc(entry.city)}</text>
    <text x="60" y="350" font-family="Arial, sans-serif" font-size="120" font-weight="900" fill="black">${main}</text>
    <text x="60" y="520" font-family="Arial, sans-serif" font-size="76" font-weight="900" fill="black">${esc(entry.support)}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(auditPath);
  return auditPath;
}

async function visualIntegrity(filePath) {
  const image = sharp(filePath).ensureAlpha();
  const meta = await image.metadata();
  const width = meta.width || WIDTH;
  const height = meta.height || HEIGHT;
  const raw = await image.raw().toBuffer();
  const bands = [
    { name: "top", y0: 0, y1: Math.floor(height * 0.33) },
    { name: "middle", y0: Math.floor(height * 0.33), y1: Math.floor(height * 0.66) },
    { name: "bottom", y0: Math.floor(height * 0.66), y1: height },
    { name: "lower_half", y0: Math.floor(height * 0.5), y1: height },
  ];
  const bandStats = [];
  const blankBands = [];
  for (const band of bands) {
    let white = 0;
    let transparent = 0;
    let sum = 0;
    let sumSq = 0;
    let edges = 0;
    let prev = null;
    let total = 0;
    for (let y = band.y0; y < band.y1; y += 1) {
      prev = null;
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const r = raw[i];
        const g = raw[i + 1];
        const b = raw[i + 2];
        const a = raw[i + 3];
        const v = (r + g + b) / 3;
        if (r > 248 && g > 248 && b > 248) white += 1;
        if (a < 8) transparent += 1;
        if (prev !== null && Math.abs(v - prev) > 18) edges += 1;
        prev = v;
        sum += v;
        sumSq += v * v;
        total += 1;
      }
    }
    const mean = total ? sum / total : 0;
    const variance = total ? Math.max(0, sumSq / total - mean * mean) : 0;
    const stddev = Math.sqrt(variance);
    const whitePct = total ? (white / total) * 100 : 100;
    const transparentPct = total ? (transparent / total) * 100 : 100;
    const edgePct = total ? (edges / total) * 100 : 0;
    const isBlank = transparentPct > 75 || (whitePct > 65 && stddev < 22 && edgePct < 0.35);
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
      blank: isBlank,
    };
    bandStats.push(stat);
    if (isBlank) blankBands.push(stat);
  }
  const lower = bandStats.find((item) => item.name === "lower_half");
  const largestBlank = blankBands.reduce((max, item) => Math.max(max, item.height), 0);
  const status = blankBands.length === 0 && lower && !lower.blank ? "pass" : "blocked";
  return {
    status,
    lower_half_content_status: lower && !lower.blank ? "pass" : "blocked",
    blank_band_count: blankBands.length,
    largest_blank_band_px: largestBlank,
    band_stats: bandStats,
  };
}

async function runChromeUntilScreenshot(chromeArgs, outPath) {
  const timeoutMs = Number.parseInt(process.env.PATTERNLAB_CHROME_RENDER_TIMEOUT_MS || "5000", 10);
  const pollMs = 150;
  let stderr = "";
  let stdout = "";
  const child = spawn(CHROME, chromeArgs, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const started = Date.now();
  let exitCode = null;
  const exitPromise = new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      exitCode = code ?? signal ?? "unknown";
      resolve(exitCode);
    });
    child.on("error", (error) => {
      exitCode = `error:${error.message}`;
      resolve(exitCode);
    });
  });
  let lastMeta = null;
  while (Date.now() - started < timeoutMs) {
    try {
      lastMeta = await sharp(outPath).metadata();
      if (lastMeta && lastMeta.width && lastMeta.height) {
        if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
        return { status: "pass", meta: lastMeta, exitCode, stdout, stderr };
      }
    } catch {
      lastMeta = null;
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  await Promise.race([exitPromise, new Promise((resolve) => setTimeout(resolve, 250))]);
  try {
    lastMeta = await sharp(outPath).metadata();
    if (lastMeta && lastMeta.width && lastMeta.height) {
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
      return { status: "pass", meta: lastMeta, exitCode, stdout, stderr };
    }
  } catch {
    lastMeta = null;
  }
  if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
  return {
    status: "blocked",
    meta: lastMeta,
    exitCode,
    stdout,
    stderr,
    error: stderr || stdout || String(exitCode || "timeout_no_screenshot"),
  };
}

async function renderEntry(entry, fonts, workDir) {
  await fs.mkdir(path.dirname(entry.out), { recursive: true });
  // A stale screenshot can make the polling loop return before Chrome renders
  // the new HTML, silently preserving a rejected font/layout revision.
  await fs.rm(entry.out, { force: true });
  const htmlPath = path.join(workDir, `${entry.variant_id}.html`);
  await fs.writeFile(htmlPath, htmlFor(entry, fonts));
  const profileDir = path.join(workDir, `${entry.variant_id}-chrome-profile`);
  await fs.rm(profileDir, { recursive: true, force: true });
  await fs.mkdir(profileDir, { recursive: true });
  const chromeArgs = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-crash-reporter",
    "--disable-crashpad",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--hide-scrollbars",
    "--no-first-run",
    `--user-data-dir=${profileDir}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    `--screenshot=${entry.out}`,
    `file://${htmlPath}`,
  ];
  const result = await runChromeUntilScreenshot(chromeArgs, entry.out);
  let meta = result.meta;
  if (result.status !== "pass" || !(meta && meta.width && meta.height)) {
    throw new Error(`chrome_failed:${entry.variant_id}:${result.error || "no output"}`);
  }
  if (meta.width !== WIDTH || meta.height !== HEIGHT) {
    await sharp(entry.out)
      .resize(WIDTH, HEIGHT, { fit: "cover" })
      .png()
      .toFile(`${entry.out}.normalized.png`);
    await fs.rename(`${entry.out}.normalized.png`, entry.out);
  }
  const ocrAuditPath = await makeOcrAudit(entry, workDir);
  const integrity = await visualIntegrity(entry.out);
  if (integrity.status !== "pass") {
    throw new Error(`visual_integrity_failed:${entry.variant_id}:${JSON.stringify(integrity)}`);
  }
  return {
    width: WIDTH,
    height: HEIGHT,
    html: htmlPath,
    ocr_audit_path: ocrAuditPath,
    visual_integrity: integrity,
  };
}

async function makeContactSheet(entries, contactSheet) {
  const cols =
    entries.length <= 5 ? Math.max(1, entries.length) : Math.min(4, Math.max(1, entries.length));
  const rows = Math.ceil(entries.length / cols);
  const tileW = 480;
  const tileH = 270;
  const composites = [];
  for (let i = 0; i < entries.length; i += 1) {
    const input = await sharp(entries[i].out)
      .resize(tileW, tileH, { fit: "cover" })
      .png()
      .toBuffer();
    composites.push({ input, left: (i % cols) * tileW, top: Math.floor(i / cols) * tileH });
  }
  await fs.mkdir(path.dirname(contactSheet), { recursive: true });
  await sharp({
    create: { width: cols * tileW, height: rows * tileH, channels: 4, background: "#080808" },
  })
    .composite(composites)
    .jpeg({ quality: 94 })
    .toFile(contactSheet);
}

async function makePreviews(entries, previewDir) {
  await fs.mkdir(previewDir, { recursive: true });
  const previews = [];
  for (const entry of entries) {
    for (const [width, height] of [
      [320, 180],
      [160, 90],
    ]) {
      const out = path.join(
        previewDir,
        `${path.basename(entry.out, path.extname(entry.out))}-${width}x${height}.png`,
      );
      await sharp(entry.out).resize(width, height, { fit: "cover" }).png().toFile(out);
      previews.push({ variant_id: entry.variant_id, width, height, path: out, exists: true });
    }
  }
  return previews;
}

async function main() {
  const specPath = process.argv[2];
  const reportPath = process.argv[3];
  if (!specPath || !reportPath)
    throw new Error(
      "Usage: patternlab_chrome_thumbnail_renderer_helper.mjs <spec.json> <report.json>",
    );
  const spec = JSON.parse(await fs.readFile(specPath, "utf8"));
  if (!fsSync.existsSync(CHROME)) throw new Error(`chrome_missing:${CHROME}`);
  const workDir = spec.work_dir || path.join(path.dirname(reportPath), "chrome-render-work");
  await fs.mkdir(workDir, { recursive: true });
  const entries = spec.entries || [];
  const rendered = [];
  for (const entry of entries) {
    rendered.push({ ...entry, ...(await renderEntry(entry, spec.fonts || [], workDir)) });
  }
  const previews = await makePreviews(rendered, spec.preview_dir);
  if (spec.contact_sheet) await makeContactSheet(rendered, spec.contact_sheet);
  const payload = {
    status: rendered.length > 0 ? "pass" : "blocked",
    renderer: "headless_chrome_fontsource_html_css",
    chrome_path: CHROME,
    width: WIDTH,
    height: HEIGHT,
    entries: rendered.map((entry) => ({
      variant_id: entry.variant_id,
      path: entry.out,
      width: entry.width,
      height: entry.height,
      html: entry.html,
      ocr_audit_path: entry.ocr_audit_path,
      main_font_family: entry.main_font_family,
      city_font_family: entry.city_font_family,
      support_font_family: entry.support_font_family,
      effect_recipe_id: entry.effect_recipe_id,
      visual_integrity: entry.visual_integrity,
    })),
    previews,
    contact_sheet: spec.contact_sheet,
    public_youtube_mutation: "not_performed",
    paid_or_pro_assets: "not_used",
    network_sources: "not_used",
  };
  await fs.writeFile(reportPath, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    JSON.stringify({ status: payload.status, count: rendered.length, report: reportPath }, null, 2),
  );
}

main().catch(async (error) => {
  const reportPath = process.argv[3];
  if (reportPath) {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(
      reportPath,
      JSON.stringify(
        {
          status: "blocked",
          renderer: "headless_chrome_fontsource_html_css",
          blockers: [String(error?.message || error)],
        },
        null,
        2,
      ) + "\n",
    );
  }
  console.error(error);
  process.exit(1);
});
