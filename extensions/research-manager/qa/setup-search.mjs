#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const composePath = path.join(qaDir, "searxng", "compose.yaml");
const settingsTemplatePath = path.join(qaDir, "searxng", "settings.yml.template");
const image =
  "docker.io/searxng/searxng@sha256:04ddbd037d72775540527eb41f03f0cb30827bc69b91b2fe209346bf7d330179";
const containerName = "openclaw-research-searxng";

function parseArgs(argv) {
  const options = {
    stateDir: process.env.OPENCLAW_STATE_DIR ?? path.join(os.homedir(), ".openclaw"),
    port: 8888,
    verifyOnly: false,
    stop: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--verify-only") {
      options.verifyOnly = true;
      continue;
    }
    if (argument === "--stop") {
      options.stop = true;
      continue;
    }
    if (argument === "--state-dir" || argument === "--port" || argument === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a value.`);
      }
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] =
        argument === "--port" ? Number(value) : value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${argument}.`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65_535) {
    throw new Error("--port must be an integer from 1024 through 65535.");
  }
  if (options.stop && options.verifyOnly) {
    throw new Error("--stop and --verify-only cannot be combined.");
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeAtomic(file, contents, mode) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, contents, { mode });
  await fs.rename(temporary, file);
}

function runDocker(args, env) {
  const result = spawnSync("docker", args, {
    cwd: qaDir,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [result.stderr, result.stdout]
        .map((value) => value?.trim())
        .filter(Boolean)
        .join("\n") || `docker ${args.join(" ")} exited ${result.status}`,
    );
  }
  return result.stdout.trim();
}

async function probeSearch(baseUrl) {
  const startedAt = Date.now();
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", "site:sqlite.org WAL database concurrency");
  url.searchParams.set("format", "json");
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`SearXNG readiness search returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const results =
    payload && typeof payload === "object" && Array.isArray(payload.results) ? payload.results : [];
  const publicResults = results.filter((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.url !== "string") {
      return false;
    }
    try {
      const parsed = new URL(entry.url);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  });
  if (publicResults.length === 0) {
    throw new Error("SearXNG readiness search returned no public HTTP results.");
  }
  return {
    ok: true,
    resultCount: publicResults.length,
    durationMs: Date.now() - startedAt,
    domains: [
      ...new Set(publicResults.map((entry) => new URL(entry.url).hostname.toLowerCase())),
    ].slice(0, 10),
  };
}

async function waitForSearch(baseUrl) {
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await probeSearch(baseUrl);
    } catch (error) {
      lastError = error;
      await delay(2_000);
    }
  }
  throw new Error(
    `SearXNG did not become search-ready within 120 seconds: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stateRoot = path.join(path.resolve(options.stateDir), "research-manager", "searxng");
  const configDir = path.join(stateRoot, "config");
  const settingsPath = path.join(configDir, "settings.yml");
  const baseUrl = `http://127.0.0.1:${options.port}`;
  const dockerEnv = {
    ...process.env,
    RESEARCH_MANAGER_SEARXNG_CONFIG_DIR: configDir,
    RESEARCH_MANAGER_SEARXNG_PORT: String(options.port),
  };

  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  let settingsCreated = false;
  let settings;
  try {
    settings = await fs.readFile(settingsPath, "utf8");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
    const template = await fs.readFile(settingsTemplatePath, "utf8");
    settings = template.replace("__SECRET_KEY__", randomBytes(32).toString("hex"));
    await writeAtomic(settingsPath, settings, 0o600);
    settingsCreated = true;
  }
  if (!/formats:\s*[\s\S]*?- json\b/.test(settings)) {
    throw new Error(`${settingsPath} does not enable the SearXNG JSON search format.`);
  }

  const composeArgs = ["compose", "-p", "openclaw-research-manager", "-f", composePath];
  if (options.stop) {
    runDocker([...composeArgs, "down"], dockerEnv);
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, program: "research-manager-search", status: "stopped", stoppedAt: new Date().toISOString(), containerName }, null, 2)}\n`,
    );
    return;
  }
  if (!options.verifyOnly) {
    runDocker([...composeArgs, "pull", "searxng"], dockerEnv);
    runDocker([...composeArgs, "up", "-d", "searxng"], dockerEnv);
  }

  const searchProbe = await waitForSearch(baseUrl);
  const inspected = JSON.parse(
    runDocker(["inspect", containerName, "--format", "{{json .State}}"], dockerEnv),
  );
  const receipt = {
    schemaVersion: 1,
    program: "research-manager-search",
    status: "ready",
    checkedAt: new Date().toISOString(),
    baseUrl,
    image,
    containerName,
    containerState: {
      status: inspected.Status,
      running: inspected.Running,
      startedAt: inspected.StartedAt,
    },
    settingsPath,
    settingsCreated,
    settingsSha256: sha256(settings),
    searchProbe,
  };
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await writeAtomic(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 0o600);
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

await main();
