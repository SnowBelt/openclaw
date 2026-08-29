import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../api.js";
import { CallerProofVerifier } from "./auth.js";
import { createCallerAuth } from "./crypto.js";
import type { ResolvedRingerConfig } from "./types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Local AI Assist replay protection", () => {
  it("resolves only a private file-backed secret and consumes each nonce once", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-auth-test-"));
    roots.push(root);
    const secretPath = path.join(root, "secret");
    const secret = "proof-secret-".repeat(4);
    await fs.writeFile(secretPath, secret, { mode: 0o600 });
    const callerSecret = { source: "file", provider: "ringer", id: "value" } as const;
    const appConfig = {
      secrets: {
        providers: {
          ringer: { source: "file", path: secretPath, mode: "singleValue" },
        },
      },
    } as OpenClawConfig;
    const config = { stateDir: path.join(root, "state"), callerSecret } as ResolvedRingerConfig;
    const verifier = new CallerProofVerifier(config, appConfig);
    const payload = { repo: "/repo", expectedHeadSha: "a".repeat(40) };
    const auth = createCallerAuth(payload, secret);
    await expect(verifier.verifyAndConsume(payload, auth)).resolves.toBeUndefined();
    await expect(verifier.verifyAndConsume(payload, auth)).rejects.toThrow(/already been used/u);
    expect((await fs.stat(path.join(config.stateDir, "auth", "nonces.json"))).mode & 0o777).toBe(
      0o600,
    );
  });

  it("rejects a symlinked nonce directory before writing outside stateDir", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-auth-symlink-dir-test-"));
    roots.push(root);
    const secretPath = path.join(root, "secret");
    const secret = "proof-secret-".repeat(4);
    await fs.writeFile(secretPath, secret, { mode: 0o600 });
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    const stateDir = path.join(root, "state");
    await fs.mkdir(stateDir);
    await fs.symlink(outside, path.join(stateDir, "auth"));
    const appConfig = {
      secrets: {
        providers: {
          ringer: { source: "file", path: secretPath, mode: "singleValue" },
        },
      },
    } as OpenClawConfig;
    const config = {
      stateDir,
      callerSecret: { source: "file", provider: "ringer", id: "value" },
    } as ResolvedRingerConfig;
    const payload = { repo: "/repo", expectedHeadSha: "a".repeat(40) };
    await expect(
      new CallerProofVerifier(config, appConfig).verifyAndConsume(
        payload,
        createCallerAuth(payload, secret),
      ),
    ).rejects.toThrow(/real directory/u);
    await expect(fs.readdir(outside)).resolves.toEqual([]);
  });

  it("rejects a symlinked or broadly-permissioned nonce file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-auth-symlink-file-test-"));
    roots.push(root);
    const secretPath = path.join(root, "secret");
    const secret = "proof-secret-".repeat(4);
    await fs.writeFile(secretPath, secret, { mode: 0o600 });
    const stateDir = path.join(root, "state");
    const authDir = path.join(stateDir, "auth");
    await fs.mkdir(authDir, { recursive: true, mode: 0o700 });
    const outside = path.join(root, "outside-nonces.json");
    await fs.writeFile(outside, "{}\n", { mode: 0o600 });
    const nonceFile = path.join(authDir, "nonces.json");
    await fs.symlink(outside, nonceFile);
    const appConfig = {
      secrets: {
        providers: {
          ringer: { source: "file", path: secretPath, mode: "singleValue" },
        },
      },
    } as OpenClawConfig;
    const config = {
      stateDir,
      callerSecret: { source: "file", provider: "ringer", id: "value" },
    } as ResolvedRingerConfig;
    const payload = { repo: "/repo", expectedHeadSha: "a".repeat(40) };
    await expect(
      new CallerProofVerifier(config, appConfig).verifyAndConsume(
        payload,
        createCallerAuth(payload, secret),
      ),
    ).rejects.toThrow(/private regular file/u);

    await fs.rm(nonceFile);
    await fs.writeFile(nonceFile, "{}\n", { mode: 0o644 });
    await expect(
      new CallerProofVerifier(config, appConfig).verifyAndConsume(
        payload,
        createCallerAuth(payload, secret),
      ),
    ).rejects.toThrow(/0600 permissions/u);
  });

  it("serializes nonce consumption across independent verifier instances", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-auth-concurrent-test-"));
    roots.push(root);
    const secretPath = path.join(root, "secret");
    const secret = "proof-secret-".repeat(4);
    await fs.writeFile(secretPath, secret, { mode: 0o600 });
    const appConfig = {
      secrets: {
        providers: {
          ringer: { source: "file", path: secretPath, mode: "singleValue" },
        },
      },
    } as OpenClawConfig;
    const config = {
      stateDir: path.join(root, "state"),
      callerSecret: { source: "file", provider: "ringer", id: "value" },
    } as ResolvedRingerConfig;
    const firstPayload = { repo: "/repo", expectedHeadSha: "a".repeat(40), request: "first" };
    const secondPayload = { repo: "/repo", expectedHeadSha: "a".repeat(40), request: "second" };
    const first = new CallerProofVerifier(config, appConfig);
    const second = new CallerProofVerifier(config, appConfig);
    const firstAuth = createCallerAuth(firstPayload, secret);
    const secondAuth = createCallerAuth(secondPayload, secret);
    await Promise.all([
      first.verifyAndConsume(firstPayload, firstAuth),
      second.verifyAndConsume(secondPayload, secondAuth),
    ]);
    const state = JSON.parse(
      await fs.readFile(path.join(config.stateDir, "auth", "nonces.json"), "utf8"),
    ) as Record<string, string>;
    expect(Object.keys(state)).toHaveLength(2);
    await expect(first.verifyAndConsume(firstPayload, firstAuth)).rejects.toThrow(
      /already been used/u,
    );
  });
});
