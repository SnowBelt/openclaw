import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

describe("auth-preflight", () => {
  it("writes a passing receipt without exposing credentials or account identity", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "research-manager-auth-"));
    temporaryDirectories.push(directory);
    const codexHome = path.join(directory, "codex-home");
    const output = path.join(directory, "receipt.json");
    const preflight = path.join(directory, "preflight.json");
    await fs.mkdir(codexHome);
    await fs.writeFile(
      path.join(codexHome, "auth.json"),
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: jwt({ iat: 1_700_000_000, exp: 4_000_000_000 }),
          refresh_token: "private-refresh-token",
          account_id: "private-account",
        },
        last_refresh: "2026-07-16T00:00:00.000Z",
      }),
      { mode: 0o600 },
    );
    await fs.writeFile(
      preflight,
      JSON.stringify({
        codexCatalog: {
          reachable: true,
          models: [{ id: "gpt-5.6-sol", reasoningEfforts: ["max", "ultra"] }],
        },
      }),
    );

    const result = spawnSync(
      process.execPath,
      [
        path.join(qaDir, "auth-preflight.mjs"),
        "--codex-home",
        codexHome,
        "--preflight",
        preflight,
        "--output",
        output,
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    const serialized = await fs.readFile(output, "utf8");
    expect(serialized).not.toContain("private-refresh-token");
    expect(serialized).not.toContain("private-account");
    expect(JSON.parse(serialized)).toMatchObject({
      status: "passed",
      accessTokenPresent: true,
      refreshTokenPresent: true,
    });
  });
});
