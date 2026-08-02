#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(qaDir, "../../..");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--output requires a value.");
      }
      options.output = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${argument}.`);
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (absolute === path.join(qaDir, "artifacts")) {
        continue;
      }
      files.push(...(await walk(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

async function sourceFingerprint() {
  const pluginRoot = path.resolve(qaDir, "..");
  const explicit = [
    path.join(repoRoot, "docs/plugins/research-manager.md"),
    path.join(repoRoot, "docs/plugins/reference/research-manager.md"),
    path.join(repoRoot, "extensions/codex/provider.ts"),
    path.join(repoRoot, "extensions/codex/provider.test.ts"),
    path.join(repoRoot, "extensions/codex/src/app-server/thread-lifecycle.ts"),
    path.join(repoRoot, "extensions/codex/src/app-server/thread-lifecycle.test.ts"),
  ];
  const candidates = [...(await walk(pluginRoot)), ...explicit];
  const existing = [];
  for (const file of candidates) {
    try {
      const stat = await fs.stat(file);
      if (stat.isFile()) {
        existing.push(file);
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
  const hash = createHash("sha256");
  const relativeFiles = [
    ...new Set(existing.map((file) => path.relative(repoRoot, file))),
  ].toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  for (const relative of relativeFiles) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(repoRoot, relative)));
    hash.update("\0");
  }
  return { sha256: hash.digest("hex"), files: relativeFiles.length };
}

function runCheck(id, args) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const result = spawnSync("pnpm", args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENCLAW_VITEST_MAX_WORKERS: "4",
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    id,
    command: ["pnpm", ...args].join(" "),
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status ?? 1,
    startedAt,
    durationMs: Date.now() - startedMs,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
  };
}

async function writeAtomic(file, contents) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temporary, contents, { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checks = [
    runCheck("format", [
      "exec",
      "oxfmt",
      "--check",
      "--threads=1",
      "extensions/research-manager",
      "docs/plugins/research-manager.md",
    ]),
    runCheck("research-manager-tests", ["test", "extensions/research-manager"]),
    runCheck("extension-typecheck", ["tsgo:extensions"]),
    runCheck("codex-auth-and-effort-tests", [
      "test",
      "extensions/codex/src/app-server/auth-bridge.test.ts",
      "extensions/codex/provider.test.ts",
      "extensions/codex/src/app-server/thread-lifecycle.test.ts",
    ]),
    runCheck("docs-mdx", ["docs:check-mdx"]),
    runCheck("docs-internal-links", ["docs:check-links"]),
  ];
  const fingerprint = await sourceFingerprint();
  const receiptWithoutHash = {
    schemaVersion: 1,
    program: "research-manager-verification",
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checkedAt: new Date().toISOString(),
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    sourceFingerprint: fingerprint,
    checks,
  };
  const receipt = {
    ...receiptWithoutHash,
    receiptSha256: sha256(JSON.stringify(receiptWithoutHash)),
  };
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (options.output) {
    await writeAtomic(path.resolve(options.output), serialized);
  }
  process.stdout.write(serialized);
  if (receipt.status !== "passed") {
    process.exitCode = 1;
  }
}

await main();
