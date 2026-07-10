import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";

const W = 1920,
  H = 1080;
const root = "/Users/openclaw/OpenClaw/youtube-v1/local-output/video-cleveland-test";
const outDir = `${root}/review/canva-quality-fallback`;
const fontData = await fs.readFile("/System/Library/Fonts/Supplemental/Arial Black.ttf");
await fs.mkdir(outDir, { recursive: true });
function h(type, props, ...children) {
  return {
    type,
    props: { ...(props || {}), children: children.length === 1 ? children[0] : children },
  };
}
function textBox({
  x,
  y,
  w,
  h: hh,
  text,
  size,
  color = "#fff",
  stroke = "#050505",
  bg,
  rotate = 0,
  shadow = true,
  align = "center",
}) {
  const child = h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: align === "left" ? "flex-start" : "center",
        width: w,
        height: hh,
        padding: align === "left" ? "0 42px" : "0",
        color,
        fontSize: size,
        letterSpacing: -4,
        lineHeight: 0.92,
        WebkitTextStroke: `8px ${stroke}`,
        textShadow: shadow ? "0 12px 0 rgba(0,0,0,.62)" : "none",
        fontFamily: "Arial Black",
        textAlign: align,
      },
    },
    text,
  );
  return h(
    "div",
    {
      style: {
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: hh,
        display: "flex",
        transform: `rotate(${rotate}deg)`,
        backgroundColor: bg || "transparent",
        borderRadius: bg ? 20 : 0,
        boxShadow: bg ? "0 24px 60px rgba(0,0,0,.45)" : "none",
      },
    },
    child,
  );
}
function badge({ x, y, w, text, bg = "#E30613", color = "#fff" }) {
  return h(
    "div",
    {
      style: {
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: 104,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        color,
        border: "9px solid #050505",
        borderRadius: 12,
        fontSize: 46,
        letterSpacing: -1,
        fontFamily: "Arial Black",
        boxShadow: "0 16px 40px rgba(0,0,0,.48)",
      },
    },
    text,
  );
}
function overlay(spec) {
  const dark = h("div", {
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      width: W,
      height: H,
      display: "flex",
      background:
        "linear-gradient(90deg, rgba(0,0,0,.70) 0%, rgba(0,0,0,.22) 48%, rgba(0,0,0,.72) 100%)",
    },
  });
  const vignette = h("div", {
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      width: W,
      height: H,
      display: "flex",
      background:
        "radial-gradient(circle at 50% 45%, rgba(255,255,255,.08) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,.52) 100%)",
    },
  });
  const city = textBox({
    x: 70,
    y: 42,
    w: 940,
    h: 156,
    text: "CLEVELAND",
    size: 118,
    color: "#FFD400",
  });
  const main = textBox({
    x: 70,
    y: 240,
    w: 1200,
    h: 410,
    text: spec.main,
    size: spec.size || 168,
    color: spec.color || "#fff",
    bg: "rgba(5,5,5,.50)",
    align: "left",
  });
  const label = badge({
    x: 96,
    y: 815,
    w: spec.badgeW || 720,
    text: spec.badge,
    bg: spec.badgeBg || "#E30613",
    color: spec.badgeColor || "#fff",
  });
  const hook = h(
    "div",
    {
      style: {
        position: "absolute",
        right: 86,
        top: 78,
        width: 530,
        height: 530,
        display: "flex",
        borderRadius: 265,
        border: "14px solid #FFD400",
        backgroundColor: "rgba(227,6,19,.88)",
        boxShadow: "0 25px 80px rgba(0,0,0,.55)",
        alignItems: "center",
        justifyContent: "center",
        transform: spec.circleRotate ? `rotate(${spec.circleRotate}deg)` : "rotate(0deg)",
      },
    },
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 440,
          height: 300,
          color: "#fff",
          fontSize: spec.circleSize || 86,
          lineHeight: 0.9,
          textAlign: "center",
          WebkitTextStroke: "6px #050505",
          fontFamily: "Arial Black",
        },
      },
      spec.circle,
    ),
  );
  return h(
    "div",
    {
      style: {
        width: W,
        height: H,
        position: "relative",
        display: "flex",
        fontFamily: "Arial Black",
      },
    },
    dark,
    vignette,
    city,
    main,
    label,
    hook,
  );
}
async function render(spec, i) {
  const base = await sharp(spec.image)
    .resize(W, H, { fit: "cover", position: spec.pos || "centre" })
    .modulate({ saturation: 1.22, brightness: spec.brightness || 0.82 })
    .sharpen()
    .png()
    .toBuffer();
  const svg = await satori(overlay(spec), {
    width: W,
    height: H,
    fonts: [{ name: "Arial Black", data: fontData, weight: 900, style: "normal" }],
  });
  const overlayPng = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  const file = `${outDir}/premium_cleveland_${String(i).padStart(2, "0")}_${spec.slug}.png`;
  await sharp(base)
    .composite([{ input: overlayPng, top: 0, left: 0 }])
    .png()
    .toFile(file);
  const meta = await sharp(file).metadata();
  return {
    file,
    width: meta.width,
    height: meta.height,
    main: spec.main,
    badge: spec.badge,
    source: spec.image,
  };
}
const assets = {
  map: `${root}/approval/canva-source-bridge/source_bridge_01_video-cleveland-test-real-city-city-source-map.png`,
  street: `${root}/source-packet/visual-rebuild/historical/commons-historic_street-euclid-avenue-looking-east-from-e-3rd-street-cleveland-ohio-dpla-c5c187eb1cca79c89ceb37480.jpg`,
  skyline: `${root}/source-packet/visual-rebuild/modern-context/commons-modern_skyline-cleveland-skyline-from-edgewater-park-may-2025-jpg.jpg`,
  transit: `${root}/source-packet/visual-rebuild/historical/commons-underground_or_transit-cleveland-airport-subway-2-jpg.jpg`,
  tower: `${root}/source-packet/visual-rebuild/historical/commons-historic_landmark-downtown-architecture-at-night-02-cleveland-ohio-2014-10-09-by-adam-jones-jpg.jpg`,
};
const specs = [
  {
    slug: "who_cut_it",
    image: assets.map,
    main: "WHO CUT\nIT?",
    badge: "ROUTE CUT",
    circle: "THE MAP\nCHANGED",
    size: 190,
    circleSize: 78,
    color: "#fff",
    badgeW: 580,
    brightness: 0.78,
  },
  {
    slug: "water_won",
    image: assets.skyline,
    main: "THE WATER\nWON",
    badge: "LAKE VS CITY",
    circle: "BUILT\nON EDGE",
    size: 164,
    color: "#FFD400",
    badgeBg: "#FFD400",
    badgeColor: "#050505",
    badgeW: 650,
    brightness: 0.72,
    pos: "north",
  },
  {
    slug: "almost_erased",
    image: assets.street,
    main: "ALMOST\nERASED",
    badge: "SAVED OR LOST?",
    circle: "WHO\nDECIDED?",
    size: 168,
    badgeW: 720,
    brightness: 0.72,
  },
  {
    slug: "hidden_map",
    image: assets.transit,
    main: "HIDDEN\nMAP",
    badge: "SOURCE TRAIL",
    circle: "UNDER\nCLEVELAND",
    size: 182,
    badgeW: 650,
    brightness: 0.7,
  },
  {
    slug: "lost_streets",
    image: assets.tower,
    main: "LOST\nSTREETS",
    badge: "BLOCKS VANISHED",
    circle: "WHAT\nVANISHED?",
    size: 174,
    badgeW: 760,
    brightness: 0.7,
    pos: "centre",
  },
];
const entries = [];
for (let i = 0; i < specs.length; i++) entries.push(await render(specs[i], i + 1));
// contact sheet
const thumbs = [];
for (const e of entries) {
  thumbs.push(await sharp(e.file).resize(640, 360, { fit: "cover" }).png().toBuffer());
}
await sharp({
  create: { width: 640 * entries.length, height: 360, channels: 4, background: "#111" },
})
  .composite(thumbs.map((input, i) => ({ input, left: i * 640, top: 0 })))
  .jpeg({ quality: 92 })
  .toFile(`${outDir}/premium_cleveland_contact_sheet.jpg`);
await fs.writeFile(
  `${root}/approval/premium-cleveland-fallback-render-report.json`,
  JSON.stringify(
    {
      status: "pass",
      renderer: "satori_resvg_sharp_premium",
      entries,
      contact_sheet: `${outDir}/premium_cleveland_contact_sheet.jpg`,
      public_youtube_mutation: "not_performed",
      paid_or_pro_assets: "not_used",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      status: "pass",
      count: entries.length,
      contact_sheet: `${outDir}/premium_cleveland_contact_sheet.jpg`,
    },
    null,
    2,
  ),
);
