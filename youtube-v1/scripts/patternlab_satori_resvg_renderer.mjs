#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";

const WIDTH = 1920;
const HEIGHT = 1080;
const fontPath = "/System/Library/Fonts/Supplemental/Arial Black.ttf";

function h(type, props, ...children) {
  return {
    type,
    props: { ...(props || {}), children: children.length === 1 ? children[0] : children },
  };
}

function fitText(text, maxSize) {
  const length = String(text || "").length;
  if (length > 18) return Math.max(84, maxSize - 36);
  if (length > 12) return Math.max(100, maxSize - 22);
  return maxSize;
}

function overlayTree(spec) {
  const accent = spec.layout === "water_won" ? "#ffd400" : "#ffffff";
  const cityAccent = spec.layout === "water_won" ? "#ffffff" : "#ffd400";
  const supportBg = spec.layout === "water_won" ? "#ffd400" : "#e30613";
  const supportColor = spec.layout === "water_won" ? "#050505" : "#ffffff";
  return h(
    "div",
    {
      style: {
        width: WIDTH,
        height: HEIGHT,
        position: "relative",
        display: "flex",
        backgroundColor: "rgba(0,0,0,0)",
        fontFamily: "Arial Black",
      },
    },
    h(
      "div",
      {
        style: {
          position: "absolute",
          left: 50,
          top: 72,
          width: 1820,
          height: 180,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          color: cityAccent,
          fontSize: fitText(spec.city, 158),
          letterSpacing: -5,
          WebkitTextStroke: "8px #000000",
          textShadow: "0 10px 0 rgba(0,0,0,0.55)",
        },
      },
      spec.city,
    ),
    h(
      "div",
      {
        style: {
          position: "absolute",
          left: 60,
          top: 585,
          width: 1800,
          height: 172,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          color: accent,
          fontSize: fitText(spec.main, 142),
          letterSpacing: -4,
          WebkitTextStroke: "7px #000000",
          textShadow: "0 8px 0 rgba(0,0,0,0.60)",
        },
      },
      spec.main,
    ),
    h(
      "div",
      {
        style: {
          position: "absolute",
          right: 110,
          bottom: 94,
          width: 680,
          height: 104,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: supportBg,
          color: supportColor,
          border: "8px solid #050505",
          borderRadius: 10,
          fontSize: fitText(spec.support, 54),
          letterSpacing: -1,
        },
      },
      spec.support,
    ),
  );
}

async function renderOne(spec, fontData) {
  await fs.mkdir(path.dirname(spec.out), { recursive: true });
  const svg = await satori(overlayTree(spec), {
    width: WIDTH,
    height: HEIGHT,
    fonts: [{ name: "Arial Black", data: fontData, weight: 900, style: "normal" }],
  });
  const overlay = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
  })
    .render()
    .asPng();
  const base = await sharp(spec.image)
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  await sharp(base)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toFile(spec.out);
  const meta = await sharp(spec.out).metadata();
  return {
    variant_id: spec.variant_id,
    status: meta.width === WIDTH && meta.height === HEIGHT ? "pass" : "blocked",
    path: spec.out,
    width: meta.width || 0,
    height: meta.height || 0,
    renderer: "satori_resvg_sharp",
  };
}

async function main() {
  const specPath = process.argv[2];
  const reportPath = process.argv[3];
  if (!specPath || !reportPath) {
    throw new Error("Usage: patternlab_satori_resvg_renderer.mjs <spec.json> <report.json>");
  }
  const specs = JSON.parse(await fs.readFile(specPath, "utf8"));
  const fontData = await fs.readFile(fontPath);
  const entries = [];
  for (const spec of specs) {
    entries.push(await renderOne(spec, fontData));
  }
  const payload = {
    status:
      entries.length > 0 && entries.every((entry) => entry.status === "pass") ? "pass" : "blocked",
    renderer: "satori_resvg_sharp",
    width: WIDTH,
    height: HEIGHT,
    font_path: fontPath,
    entries,
    public_youtube_mutation: "not_performed",
    paid_or_pro_assets: "not_used",
  };
  await fs.writeFile(reportPath, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    JSON.stringify({ status: payload.status, count: entries.length, report: reportPath }, null, 2),
  );
  if (payload.status !== "pass") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
