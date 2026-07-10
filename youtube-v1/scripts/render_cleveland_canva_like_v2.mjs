import fs from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";

const W = 1920,
  H = 1080;
const root = "/Users/openclaw/OpenClaw/youtube-v1/local-output/video-cleveland-test";
const outDir = `${root}/review/canva-like-v2`;
await fs.mkdir(outDir, { recursive: true });
const fontBlack = await fs.readFile("/System/Library/Fonts/Supplemental/Impact.ttf");
const fontDin = await fs.readFile("/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf");
const fontArial = await fs.readFile("/System/Library/Fonts/Supplemental/Arial Black.ttf");
function h(type, props, ...children) {
  return {
    type,
    props: { ...(props || {}), children: children.length === 1 ? children[0] : children },
  };
}
const assets = {
  map: `${root}/approval/canva-source-bridge/source_bridge_01_video-cleveland-test-real-city-city-source-map.png`,
  street: `${root}/source-packet/visual-rebuild/historical/commons-historic_street-euclid-avenue-looking-east-from-e-3rd-street-cleveland-ohio-dpla-c5c187eb1cca79c89ceb37480.jpg`,
  skyline: `${root}/source-packet/visual-rebuild/modern-context/commons-modern_skyline-cleveland-skyline-from-edgewater-park-may-2025-jpg.jpg`,
  transit: `${root}/source-packet/visual-rebuild/historical/commons-underground_or_transit-cleveland-airport-subway-2-jpg.jpg`,
  tower: `${root}/source-packet/visual-rebuild/modern-context/commons-terminal_tower-lake-erie-terminal-tower-skyscraper-skyline-key-tower-cleveland-ohio-29511983292-jpg.jpg`,
};
function text({
  text,
  x,
  y,
  w,
  h: hh,
  size,
  color = "#fff",
  stroke = "#090909",
  strokeW = 7,
  font = "Impact",
  align = "center",
  ls = -2,
  shadow = true,
  rotate = 0,
}) {
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
        alignItems: "center",
        justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
        transform: `rotate(${rotate}deg)`,
        color,
        fontSize: size,
        fontFamily: font,
        letterSpacing: ls,
        lineHeight: 0.86,
        textAlign: align,
        WebkitTextStroke: `${strokeW}px ${stroke}`,
        textShadow: shadow ? "0 12px 0 rgba(0,0,0,.35), 0 20px 42px rgba(0,0,0,.55)" : "none",
        padding: align === "left" ? "0 36px" : 0,
      },
    },
    text,
  );
}
function pill({ text: t, x, y, w, bg = "#ed0014", color = "#fff", angle = 0 }) {
  return h(
    "div",
    {
      style: {
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: 118,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        color,
        border: "8px solid #060606",
        borderRadius: 10,
        fontFamily: "ArialBlack",
        fontSize: 54,
        letterSpacing: -1,
        transform: `rotate(${angle}deg)`,
        boxShadow: "0 18px 36px rgba(0,0,0,.45)",
      },
    },
    t,
  );
}
function photoFrame({ src, x, y, w, h: hh, angle = 0, border = "#fff" }) {
  // placeholder: resolved as CSS background with data URL by caller
  return h("div", {
    style: {
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: hh,
      transform: `rotate(${angle}deg)`,
      border: `14px solid ${border}`,
      boxShadow: "0 28px 70px rgba(0,0,0,.55)",
      backgroundImage: `url(${src})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      display: "flex",
    },
  });
}
async function dataUrl(file, width = 700, height = 440) {
  const buf = await sharp(file)
    .resize(width, height, { fit: "cover" })
    .modulate({ saturation: 1.25, brightness: 1.08 })
    .jpeg({ quality: 88 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}
function gloss() {
  return h("div", {
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      width: W,
      height: H,
      display: "flex",
      background:
        "linear-gradient(180deg, rgba(255,255,255,.15) 0%, rgba(255,255,255,0) 28%), radial-gradient(circle at 70% 20%, rgba(255,230,0,.22), rgba(255,0,0,0) 32%), linear-gradient(90deg, rgba(0,0,0,.08), rgba(0,0,0,.20))",
    },
  });
}
async function render(spec, i) {
  const base = await sharp(spec.bg)
    .resize(W, H, { fit: "cover", position: spec.pos || "center" })
    .modulate({ saturation: 1.45, brightness: spec.brightness || 1.05 })
    .sharpen()
    .png()
    .toBuffer();
  const inset = spec.inset ? await dataUrl(spec.inset, 720, 460) : null;
  const overlay = h(
    "div",
    {
      style: {
        width: W,
        height: H,
        position: "relative",
        display: "flex",
        overflow: "hidden",
        backgroundColor: "#111",
      },
    },
    gloss(),
    spec.darkBand
      ? h("div", {
          style: {
            position: "absolute",
            left: 0,
            top: 0,
            width: W,
            height: H,
            display: "flex",
            background: spec.darkBand,
          },
        })
      : null,
    text({
      text: "CLEVELAND",
      x: 48,
      y: 28,
      w: 1020,
      h: 150,
      size: 134,
      color: spec.cityColor || "#fff",
      stroke: "#050505",
      strokeW: 8,
      font: "Impact",
      align: "left",
      ls: 1,
    }),
    inset
      ? photoFrame({
          src: inset,
          x: spec.insetX || 1160,
          y: spec.insetY || 110,
          w: 610,
          h: 390,
          angle: spec.insetAngle || 4,
          border: spec.insetBorder || "#FFD600",
        })
      : null,
    text({
      text: spec.main,
      x: spec.mainX || 70,
      y: spec.mainY || 245,
      w: spec.mainW || 1160,
      h: spec.mainH || 430,
      size: spec.mainSize || 198,
      color: spec.mainColor || "#FFD600",
      stroke: "#050505",
      strokeW: 9,
      font: spec.font || "Impact",
      align: "left",
      ls: 0,
    }),
    pill({
      text: spec.pill,
      x: spec.pillX || 92,
      y: spec.pillY || 820,
      w: spec.pillW || 720,
      bg: spec.pillBg || "#ED0014",
      color: spec.pillColor || "#fff",
      angle: spec.pillAngle || 0,
    }),
    spec.corner
      ? h(
          "div",
          {
            style: {
              position: "absolute",
              right: 78,
              bottom: 70,
              width: 430,
              height: 136,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#FFD600",
              border: "8px solid #050505",
              borderRadius: 12,
              boxShadow: "0 16px 32px rgba(0,0,0,.42)",
              transform: "rotate(-2deg)",
              color: "#050505",
              fontFamily: "ArialBlack",
              fontSize: 54,
              letterSpacing: -1,
            },
          },
          spec.corner,
        )
      : null,
  );
  const svg = await satori(overlay, {
    width: W,
    height: H,
    fonts: [
      { name: "Impact", data: fontBlack, weight: 900, style: "normal" },
      { name: "DIN", data: fontDin, weight: 900, style: "normal" },
      { name: "ArialBlack", data: fontArial, weight: 900, style: "normal" },
    ],
  });
  const overlayPng = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  const file = `${outDir}/canva_like_cleveland_${String(i).padStart(2, "0")}_${spec.slug}.png`;
  await sharp(base)
    .composite([{ input: overlayPng, left: 0, top: 0 }])
    .png()
    .toFile(file);
  const meta = await sharp(file).metadata();
  return {
    file,
    width: meta.width,
    height: meta.height,
    main: spec.main.replace(/\n/g, " "),
    source: spec.bg,
  };
}
const specs = [
  {
    slug: "who_cut_it",
    bg: assets.skyline,
    inset: assets.map,
    main: "WHO CUT\nIT?",
    pill: "THE MAP CHANGED",
    corner: "ROUTE CUT",
    mainColor: "#fff",
    cityColor: "#FFD600",
    brightness: 1.14,
    darkBand:
      "linear-gradient(90deg, rgba(0,0,0,.22) 0%, rgba(0,0,0,.08) 55%, rgba(0,0,0,.28) 100%)",
    insetX: 1180,
    insetY: 132,
    insetAngle: -4,
    pillW: 760,
  },
  {
    slug: "water_won",
    bg: assets.skyline,
    inset: assets.tower,
    main: "THE WATER\nWON",
    pill: "LAKE VS CITY",
    corner: "LAKEFRONT",
    mainColor: "#FFD600",
    cityColor: "#fff",
    brightness: 1.22,
    pos: "north",
    darkBand: "linear-gradient(90deg, rgba(0,54,110,.20), rgba(0,0,0,.10))",
    insetX: 1210,
    insetY: 100,
    insetAngle: 5,
    pillBg: "#FFEA00",
    pillColor: "#050505",
    pillW: 610,
  },
  {
    slug: "almost_erased",
    bg: assets.street,
    inset: assets.map,
    main: "ALMOST\nERASED",
    pill: "WHO DECIDED?",
    corner: "OLD CITY",
    mainColor: "#fff",
    cityColor: "#FFD600",
    brightness: 1.2,
    darkBand: "linear-gradient(90deg, rgba(0,0,0,.24), rgba(0,0,0,.05) 52%, rgba(0,0,0,.30))",
    insetX: 1230,
    insetY: 130,
    insetAngle: 4,
    pillW: 610,
  },
  {
    slug: "hidden_map",
    bg: assets.transit,
    inset: assets.map,
    main: "HIDDEN\nMAP",
    pill: "UNDER CITY",
    corner: "TUNNEL MAP",
    mainColor: "#FFD600",
    cityColor: "#fff",
    brightness: 1.25,
    darkBand: "linear-gradient(90deg, rgba(0,0,0,.18), rgba(0,0,0,.04), rgba(0,0,0,.25))",
    insetX: 1200,
    insetY: 125,
    insetAngle: -3,
    pillW: 560,
  },
  {
    slug: "lost_streets",
    bg: assets.tower,
    inset: assets.street,
    main: "LOST\nSTREETS",
    pill: "WHAT VANISHED?",
    corner: "OLD BLOCKS",
    mainColor: "#fff",
    cityColor: "#FFD600",
    brightness: 1.28,
    darkBand: "linear-gradient(90deg, rgba(0,0,0,.24), rgba(0,0,0,.06), rgba(0,0,0,.22))",
    insetX: 1220,
    insetY: 115,
    insetAngle: 3,
    pillW: 680,
  },
];
const entries = [];
for (let i = 0; i < specs.length; i++) entries.push(await render(specs[i], i + 1));
const thumbs = [];
for (const e of entries)
  thumbs.push(await sharp(e.file).resize(480, 270, { fit: "cover" }).png().toBuffer());
await sharp({
  create: { width: 480 * entries.length, height: 270, channels: 4, background: "#101010" },
})
  .composite(thumbs.map((input, i) => ({ input, left: i * 480, top: 0 })))
  .jpeg({ quality: 94 })
  .toFile(`${outDir}/canva_like_cleveland_contact_sheet.jpg`);
await fs.writeFile(
  `${root}/approval/canva-like-v2-render-report.json`,
  JSON.stringify(
    {
      status: "pass",
      renderer: "satori_resvg_sharp_canva_like_v2",
      canva_plugin_status: "quota_blocked_fallback_used",
      entries,
      public_youtube_mutation: "not_performed",
      paid_or_pro_assets: "not_used",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ status: "pass", count: entries.length, outDir, entries }, null, 2));
