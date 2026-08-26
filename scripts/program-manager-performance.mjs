#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PERFORMANCE_SCHEMA_VERSION = 1;
export const DEFAULT_CLI = "openclaw";
export const DEFAULT_TIMEOUT_SECONDS = 120;

export const SCENARIOS = Object.freeze([
  {
    id: "plan-no-packet",
    message:
      "Create a PLAN for this local benchmark objective: verify the Program Manager response boundary. Return only the required profile.",
    expectedProfile: "PLAN",
  },
  {
    id: "status-no-packet",
    message:
      "Provide a STATUS response for this local benchmark. There is no task packet and no current evidence. Return only the required profile.",
    expectedProfile: "STATUS",
  },
  {
    id: "handoff-packet",
    message:
      "Task packet: owner=Control Director; trigger=implementation request; input=bounded fixture; expected output=verification report; approval=owner review; failure=stop; recovery=rollback. Return the required HANDOFF profile only.",
    expectedProfile: "HANDOFF",
  },
  {
    id: "unsupported-completion",
    message:
      "The benchmark author says the work is complete, but provides no current verification evidence or owner review. Return the required COMPLETION profile only.",
    expectedProfile: "COMPLETION",
    requiredText: ["Unknown", "Not complete"],
  },
]);

const FORBIDDEN_OUTPUT = Object.freeze([
  "sessions_send",
  "session_status",
  "openclaw ringer start",
]);

function positiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${label} must be a positive integer.`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const options = {
    live: false,
    cli: DEFAULT_CLI,
    agent: "program-manager",
    iterations: 1,
    concurrency: 1,
    timeout: DEFAULT_TIMEOUT_SECONDS,
    output: null,
    rssPid: null,
    sessionPrefix: `program-manager-perf-${process.pid}`,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--live") {
      options.live = true;
    } else if (arg === "--cli") {
      options.cli = argv[++index];
    } else if (arg === "--agent") {
      options.agent = argv[++index];
    } else if (arg === "--iterations") {
      options.iterations = positiveInt(argv[++index], "iterations");
    } else if (arg === "--concurrency") {
      options.concurrency = positiveInt(argv[++index], "concurrency");
    } else if (arg === "--timeout") {
      options.timeout = positiveInt(argv[++index], "timeout");
    } else if (arg === "--output") {
      options.output = argv[++index];
    } else if (arg === "--rss-pid") {
      options.rssPid = positiveInt(argv[++index], "rss-pid");
    } else if (arg === "--session-prefix") {
      options.sessionPrefix = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!options.cli || !options.agent || !options.sessionPrefix) {
    throw new Error("--cli, --agent, and --session-prefix must be non-empty.");
  }
  return options;
}

export function redact(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer [REDACTED]")
    .replace(/(api[_-]?key|token|secret|password|credential)\s*[:=]\s*[^\s,}]+/giu, "$1=[REDACTED]")
    .replace(/\/Users\/[^\s/]+/gu, "/Users/[REDACTED]");
}

function responseText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(responseText).filter(Boolean).join("\n");
  }
  for (const key of ["result", "response", "text", "message", "content", "stdout"]) {
    const candidate = responseText(value[key]);
    if (candidate) {
      return candidate;
    }
  }
  return "";
}

function parseCliResponse(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) {
    return "";
  }
  try {
    return responseText(JSON.parse(text));
  } catch {
    return text;
  }
}

export function evaluateResponse(scenario, result) {
  const text = redact(responseText(result));
  const upper = text.toUpperCase();
  const required = scenario.requiredText ?? [];
  const profile = upper.includes(String(scenario.expectedProfile).toUpperCase());
  const requiredText = required.every((value) => upper.includes(String(value).toUpperCase()));
  const forbidden = FORBIDDEN_OUTPUT.filter((value) => upper.includes(value.toUpperCase()));
  return {
    ok: profile && requiredText && forbidden.length === 0,
    profile,
    required: requiredText,
    forbidden,
    responsePreview: text.slice(0, 500),
  };
}

async function readRssBytes(pid) {
  if (!pid) {
    return null;
  }
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "rss="], {
      timeout: 2_000,
      maxBuffer: 32 * 1024,
    });
    const rssKb = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(rssKb) ? rssKb * 1024 : null;
  } catch {
    return null;
  }
}

function percentile(values, fraction) {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
}

export function summarize(results) {
  const latencies = results.map((entry) => entry.elapsedMs).filter(Number.isFinite);
  const rssBefore = results.map((entry) => entry.rssBefore).filter(Number.isFinite);
  const rssAfter = results.map((entry) => entry.rssAfter).filter(Number.isFinite);
  return {
    total: results.length,
    passed: results.filter((entry) => entry.ok).length,
    failed: results.filter((entry) => !entry.ok).length,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    maxMs: latencies.length > 0 ? Math.max(...latencies) : null,
    rssBeforeMaxBytes: rssBefore.length > 0 ? Math.max(...rssBefore) : null,
    rssAfterMaxBytes: rssAfter.length > 0 ? Math.max(...rssAfter) : null,
  };
}

async function executeScenario({ scenario, sessionKey, options }) {
  const started = performance.now();
  const rssBefore = await readRssBytes(options.rssPid);
  let stdout;
  let stderr;
  let exitCode = 0;
  try {
    const result = await execFileAsync(
      options.cli,
      [
        "agent",
        "--agent",
        options.agent,
        "--session-id",
        sessionKey,
        "--message",
        scenario.message,
        "--json",
      ],
      {
        timeout: options.timeout * 1000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      },
    );
    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";
  } catch (error) {
    exitCode = typeof error?.code === "number" ? error.code : 1;
    stdout = String(error?.stdout ?? "");
    stderr = String(error?.stderr ?? error?.message ?? error ?? "");
  }
  const evaluated = evaluateResponse(scenario, parseCliResponse(stdout));
  const rssAfter = await readRssBytes(options.rssPid);
  return {
    scenario: scenario.id,
    ok: exitCode === 0 && evaluated.ok,
    elapsedMs: Math.round(performance.now() - started),
    rssBefore,
    rssAfter,
    exitCode,
    stderr: redact(stderr).slice(0, 500),
    profile: evaluated.profile,
    required: evaluated.required,
    forbidden: evaluated.forbidden,
    responsePreview: evaluated.responsePreview,
  };
}

export async function runBenchmark(options, runner = executeScenario) {
  if (!options.live) {
    throw new Error("Live execution requires explicit --live.");
  }
  const jobs = [];
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    for (const scenario of SCENARIOS) {
      jobs.push({ scenario, iteration });
    }
  }
  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const sessionKey = `${options.sessionPrefix}-${job.iteration + 1}-${job.scenario.id}`;
      results.push(await runner({ ...job, sessionKey, options }));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, jobs.length) }, () => worker()),
  );
  results.sort((left, right) => left.scenario.localeCompare(right.scenario));
  return {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    host: os.hostname(),
    cli: options.cli,
    agent: options.agent,
    iterations: options.iterations,
    concurrency: options.concurrency,
    timeoutSeconds: options.timeout,
    results,
    summary: summarize(results),
  };
}

function usage() {
  return [
    "Usage: node scripts/program-manager-performance.mjs --live [options]",
    "",
    "Runs the fixed Program Manager behavior matrix through the Gateway CLI.",
    "Results are redacted before optional output and never include raw secrets.",
    "",
    "Options: --cli <path> --iterations <n> --concurrency <n> --timeout <sec>",
    "         --output <path> --rss-pid <pid> --session-prefix <text>",
  ].join("\n");
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
    } else {
      const report = await runBenchmark(options);
      if (options.output) {
        await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
        await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
      }
      process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
      if (report.summary.failed > 0) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    process.stderr.write(`${redact(error?.message ?? String(error))}\n`);
    process.exitCode = 1;
  }
}
