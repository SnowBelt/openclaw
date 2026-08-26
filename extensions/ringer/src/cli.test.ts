import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../api.js";
import { registerRingerCli } from "./cli.js";
import type { ResolvedRingerConfig } from "./types.js";

const gatewayCall = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock("openclaw/plugin-sdk/gateway-runtime", () => ({
  addGatewayClientOptions: () => undefined,
  callGatewayFromCli: gatewayCall,
}));

const roots: string[] = [];

afterEach(async () => {
  gatewayCall.mockReset().mockResolvedValue({ ok: true });
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function config(stateDir: string): ResolvedRingerConfig {
  return {
    enabled: true,
    productionEnabled: false,
    stateDir,
    callerSecret: { source: "file", provider: "ringer", id: "value" },
  } as ResolvedRingerConfig;
}

describe("Local AI Assist CLI Gateway boundary", () => {
  it("requests least-privilege backend scope for snapshot and approval scope for mutation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-cli-test-"));
    roots.push(root);
    const secretPath = path.join(root, "caller.secret");
    await fs.writeFile(secretPath, "proof-secret-".repeat(4), { mode: 0o600 });
    const appConfig = {
      secrets: {
        providers: {
          ringer: { source: "file", path: secretPath, mode: "singleValue" },
        },
      },
    } as OpenClawConfig;
    const stateDir = path.join(root, "state");
    const canonicalRoot = await fs.realpath(root);
    const program = new Command();
    program.exitOverride();
    vi.spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    registerRingerCli(program, config(stateDir), appConfig);

    await program.parseAsync(["node", "test", "ringer", "snapshot"]);
    expect(gatewayCall).toHaveBeenNthCalledWith(
      1,
      "ringer.snapshot",
      expect.anything(),
      {},
      { scopes: ["operator.read"], clientName: "gateway-client", mode: "backend" },
    );

    await program.parseAsync([
      "node",
      "test",
      "ringer",
      "prepare",
      "--repo",
      root,
      "--head",
      "a".repeat(40),
    ]);
    expect(gatewayCall).toHaveBeenNthCalledWith(
      2,
      "ringer.prepare",
      expect.anything(),
      expect.objectContaining({
        repo: canonicalRoot,
        expectedHeadSha: "a".repeat(40),
        includeUntrackedPaths: [],
        auth: expect.objectContaining({ digest: expect.any(String) }),
      }),
      { scopes: ["operator.approvals"], clientName: "gateway-client", mode: "backend" },
    );
  });
});
