import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const ALLOWED_ACTIONS = new Set([
  "approve",
  "reject",
  "repair",
  "regenerate",
  "revise_hook",
  "kill_topic",
]);
const BLOCKED_ACTIONS = new Set([
  "approve_private",
  "upload",
  "publish",
  "public_publish",
  "comment",
  "pin",
  "set_related_video",
  "change_title",
  "change_thumbnail",
]);

function parsePayload(raw) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (typeof value.action !== "string" || typeof value.videoId !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

function executeReview({ repoRoot, payload }) {
  const script = resolve(repoRoot, "youtube-v1/scripts/patternlab_review_action.py");
  const python = resolve(repoRoot, "youtube-v1/.venv-youtube-3.12/bin/python");
  if (!existsSync(script) || !existsSync(python)) {
    return Promise.resolve({
      ok: false,
      output: "Pattern Lab local review runtime is unavailable.",
    });
  }
  const callback = `patternlab:${JSON.stringify(payload)}`;
  return new Promise((resolvePromise) => {
    const child = spawn(
      python,
      [
        script,
        "--video-id",
        payload.videoId,
        "--callback",
        callback,
        "--no-auto-repair",
        "--no-auto-upload",
      ],
      {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", (error) => resolvePromise({ ok: false, output: String(error) }));
    child.on("close", (code) => resolvePromise({ ok: code === 0, output: output.slice(-800) }));
  });
}

export default definePluginEntry({
  id: "patternlab-discord-review",
  name: "Pattern Lab Discord Review",
  description: "Owner-only Pattern Lab feedback controls with no YouTube mutation path.",
  register(api) {
    const configured = api.pluginConfig?.repoRoot;
    const repoRoot =
      typeof configured === "string" && configured.trim()
        ? configured.trim()
        : "/Users/openclaw/OpenClaw";
    api.registerInteractiveHandler({
      channel: "discord",
      namespace: "patternlab",
      async handler(ctx) {
        if (!ctx.auth.isAuthorizedSender) {
          await ctx.respond.reply({
            text: "Blocked: Pattern Lab review controls are owner-only.",
            ephemeral: true,
          });
          return { handled: true };
        }
        const payload = parsePayload(ctx.interaction.payload);
        if (!payload) {
          await ctx.respond.reply({
            text: "Blocked: invalid Pattern Lab review control.",
            ephemeral: true,
          });
          return { handled: true };
        }
        if (BLOCKED_ACTIONS.has(payload.action) || !ALLOWED_ACTIONS.has(payload.action)) {
          await ctx.respond.reply({
            text: "Blocked: this control cannot mutate YouTube. Use the separately approved offline release path.",
            ephemeral: true,
          });
          return { handled: true };
        }
        const result = await executeReview({ repoRoot, payload });
        await ctx.respond.reply({
          text: result.ok
            ? `Recorded Pattern Lab ${payload.action} feedback for Video ${payload.videoId}. No YouTube action was performed.`
            : `Blocked: Pattern Lab feedback was not recorded. ${result.output}`,
          ephemeral: true,
        });
        return { handled: true };
      },
    });
  },
});
