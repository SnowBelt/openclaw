#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const youtubeRoot = resolve(scriptDir, "..");
const repoRoot = resolve(youtubeRoot, "..");
const python = process.env.PYTHON || "python3";

function run(args, options = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ""}`,
    },
  });
  if (options.allowFailure) {
    return result.status ?? 1;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return 0;
}

function runStep(label, args) {
  const status = run(args, { allowFailure: true });
  console.log(`${label}: ${status === 0 ? "ok" : `blocked (${status})`}`);
  return status;
}

function slateHasTopic(videoId) {
  const slatePath = resolve(youtubeRoot, "state/monetization/content-slate.json");
  if (!existsSync(slatePath)) {
    return false;
  }
  const slate = JSON.parse(readFileSync(slatePath, "utf8"));
  return (slate.topics || []).some((topic) => topic.video_id === videoId);
}

function usage() {
  console.log(`Pattern Lab automation

Usage:
  node youtube-v1/scripts/youtube-v1-automation.mjs daily [video-id]
  node youtube-v1/scripts/youtube-v1-automation.mjs weekly
  node youtube-v1/scripts/youtube-v1-automation.mjs next [video-id]
  node youtube-v1/scripts/youtube-v1-automation.mjs health [video-id]
  node youtube-v1/scripts/youtube-v1-automation.mjs validate
  node youtube-v1/scripts/youtube-v1-automation.mjs continue [video-id] [--live-upload]
  node youtube-v1/scripts/youtube-v1-automation.mjs preflight [video-id]
  node youtube-v1/scripts/youtube-v1-automation.mjs run-once [--video-id NN]
  node youtube-v1/scripts/youtube-v1-automation.mjs shorts [video-id]
`);
}

const [command, maybeVideoId] = process.argv.slice(2);
const commandArgs = process.argv.slice(3);

if (!command || command === "--help" || command === "-h") {
  usage();
  process.exit(0);
}

if (command === "validate") {
  run([python, "youtube-v1/scripts/validate_monetization_strategy.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/analyze_performance.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/build_video_ffmpeg.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/generate_images.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/generate_proof_footage.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/generate_shorts_ffmpeg.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/generate_upload_metadata.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/generate_voiceover.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/monetization_gates.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/patternlab_common.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/patternlab_continue_until_blocked.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/patternlab_daily_factory.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/patternlab_daily_loop.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/patternlab_dashboard_server.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/patternlab_media_pipeline.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/patternlab_review_action.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/private_upload_readiness.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/public_publish_readiness.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/send_daily_review_to_discord.py"]);
  run([python, "-m", "py_compile", "youtube-v1/scripts/upload_private_youtube.py"]);
  console.log("Pattern Lab validation passed.");
  process.exit(0);
}

if (command === "daily") {
  const args = [python, "youtube-v1/scripts/patternlab_daily_loop.py", "--dry-run"];
  if (maybeVideoId) {
    args.push("--video-id", maybeVideoId.padStart(2, "0"));
  }
  run(args);
  process.exit(0);
}

if (command === "weekly") {
  run([python, "youtube-v1/scripts/patternlab_content_calendar.py"]);
  process.exit(0);
}

if (command === "next") {
  const videoId = (maybeVideoId || "01").padStart(2, "0");
  runStep("upload_metadata", [
    python,
    "youtube-v1/scripts/generate_upload_metadata.py",
    "--video-id",
    videoId,
  ]);
  runStep("monetization_gates", [
    python,
    "youtube-v1/scripts/monetization_gates.py",
    "--video-id",
    videoId,
  ]);
  runStep("voiceover_dry_run", [
    python,
    "youtube-v1/scripts/generate_voiceover.py",
    "--video-id",
    videoId,
    "--dry-run",
  ]);
  runStep("long_form_dry_run", [
    python,
    "youtube-v1/scripts/build_video_ffmpeg.py",
    "--video-id",
    videoId,
    "--dry-run",
  ]);
  runStep("shorts_dry_run", [
    python,
    "youtube-v1/scripts/generate_shorts_ffmpeg.py",
    "--video-id",
    videoId,
    "--dry-run",
  ]);
  runStep("private_upload_readiness", [
    python,
    "youtube-v1/scripts/private_upload_readiness.py",
    "--video-id",
    videoId,
  ]);
  runStep("public_publish_readiness", [
    python,
    "youtube-v1/scripts/public_publish_readiness.py",
    "--video-id",
    videoId,
  ]);
  runStep("preflight", [
    python,
    "youtube-v1/scripts/patternlab_preflight.py",
    "--video-id",
    videoId,
  ]);
  console.log(`Pattern Lab launch package refresh completed for video ${videoId}.`);
  process.exit(0);
}

if (command === "health") {
  const videoId = (maybeVideoId || "01").padStart(2, "0");
  run([python, "youtube-v1/scripts/patternlab_preflight.py", "--video-id", videoId]);
  process.exit(0);
}

if (command === "continue") {
  const videoId = (maybeVideoId || "02").padStart(2, "0");
  const args = [
    python,
    "youtube-v1/scripts/patternlab_continue_until_blocked.py",
    "--video-id",
    videoId,
  ];
  if (commandArgs.includes("--live-upload")) {
    args.push("--live-upload");
  }
  run(args);
  process.exit(0);
}

if (command === "preflight") {
  const videoId = (maybeVideoId || "02").padStart(2, "0");
  run([python, "youtube-v1/scripts/patternlab_preflight.py", "--video-id", videoId]);
  process.exit(0);
}

if (command === "run-once") {
  const videoIndex = commandArgs.indexOf("--video-id");
  const videoId = videoIndex >= 0 ? commandArgs[videoIndex + 1] : undefined;
  const args = [python, "youtube-v1/scripts/patternlab_daily_factory.py"];
  if (videoId) {
    args.push("--video-id", videoId.padStart(2, "0"));
  }
  run(args);
  process.exit(0);
}

if (command === "shorts") {
  const videoId = (maybeVideoId || "01").padStart(2, "0");
  if (slateHasTopic(videoId)) {
    run([python, "youtube-v1/scripts/patternlab_daily_factory.py", "--video-id", videoId]);
  } else {
    run([
      python,
      "youtube-v1/scripts/generate_shorts_ffmpeg.py",
      "--video-id",
      videoId,
      "--dry-run",
    ]);
  }
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
usage();
process.exit(2);
