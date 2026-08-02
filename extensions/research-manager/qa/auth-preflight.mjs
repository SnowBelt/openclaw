#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    codexHome: process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--codex-home" || argument === "--preflight" || argument === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a value.`);
      }
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${argument}.`);
  }
  return options;
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decodeJwtTimes(token) {
  const payload = token.split(".")[1];
  if (!payload) {
    return {};
  }
  try {
    const parsed = asRecord(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return {
      issuedAtMs: typeof parsed.iat === "number" ? parsed.iat * 1_000 : undefined,
      expiresAtMs: typeof parsed.exp === "number" ? parsed.exp * 1_000 : undefined,
    };
  } catch {
    return {};
  }
}

async function writeAtomic(file, contents) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temporary, contents, { mode: 0o600 });
  await fs.rename(temporary, file);
}

function readCatalogGate(preflight) {
  const catalog = asRecord(asRecord(preflight).codexCatalog);
  const models = Array.isArray(catalog.models) ? catalog.models : [];
  const sol = models.map(asRecord).find((model) => model.id === "gpt-5.6-sol");
  const efforts = Array.isArray(sol?.reasoningEfforts) ? sol.reasoningEfforts : [];
  return catalog.reachable === true && efforts.includes("max") && efforts.includes("ultra");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const authPath = path.join(path.resolve(options.codexHome), "auth.json");
  const [raw, stat] = await Promise.all([fs.readFile(authPath, "utf8"), fs.stat(authPath)]);
  const auth = asRecord(JSON.parse(raw));
  const tokens = asRecord(auth.tokens);
  const accessToken = readString(tokens.access_token);
  const refreshToken = readString(tokens.refresh_token);
  const now = Date.now();
  const tokenTimes = accessToken ? decodeJwtTimes(accessToken) : {};
  const preflight = options.preflight
    ? JSON.parse(await fs.readFile(path.resolve(options.preflight), "utf8"))
    : undefined;
  const gates = [
    {
      id: "auth-file-private",
      passed: (stat.mode & 0o077) === 0,
      detail: `mode ${(stat.mode & 0o777).toString(8).padStart(3, "0")}`,
    },
    {
      id: "chatgpt-auth-mode",
      passed: auth.auth_mode === "chatgpt",
      detail: readString(auth.auth_mode) ?? "missing",
    },
    {
      id: "access-token-present",
      passed: Boolean(accessToken),
      detail: accessToken ? "present" : "missing",
    },
    {
      id: "refresh-token-present",
      passed: Boolean(refreshToken),
      detail: refreshToken ? "present" : "missing",
    },
    {
      id: "access-token-unexpired",
      passed: typeof tokenTimes.expiresAtMs === "number" && tokenTimes.expiresAtMs > now,
      detail:
        typeof tokenTimes.expiresAtMs === "number"
          ? new Date(tokenTimes.expiresAtMs).toISOString()
          : "JWT expiry unavailable",
    },
    ...(preflight
      ? [
          {
            id: "sol-ultra-live-catalog",
            passed: readCatalogGate(preflight),
            detail: readCatalogGate(preflight) ? "max and ultra advertised" : "not advertised",
          },
        ]
      : []),
  ];
  const receiptWithoutHash = {
    schemaVersion: 1,
    program: "research-manager-codex-auth",
    status: gates.every((gate) => gate.passed) ? "passed" : "failed",
    checkedAt: new Date(now).toISOString(),
    authPath,
    authMode: readString(auth.auth_mode) ?? "missing",
    accessTokenPresent: Boolean(accessToken),
    refreshTokenPresent: Boolean(refreshToken),
    ...(typeof tokenTimes.issuedAtMs === "number"
      ? { accessTokenIssuedAt: new Date(tokenTimes.issuedAtMs).toISOString() }
      : {}),
    ...(typeof tokenTimes.expiresAtMs === "number"
      ? {
          accessTokenExpiresAt: new Date(tokenTimes.expiresAtMs).toISOString(),
          accessTokenRemainingMs: Math.max(0, tokenTimes.expiresAtMs - now),
        }
      : {}),
    ...(readString(auth.last_refresh) ? { lastRefreshAt: readString(auth.last_refresh) } : {}),
    gates,
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
