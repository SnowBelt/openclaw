import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { WORKER_SCRIPT_PATH } from "./assets.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const servers: Server[] = [];

async function fixture(
  returnedModel = "qwen3-coder-next:latest",
  withStaleWorkspaceState = false,
  timeoutMs = 10_000,
  withUnresidentModel = false,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ringer-worker-test-"));
  roots.push(root);
  const taskdir = path.join(root, "task");
  await fs.mkdir(taskdir);
  if (withStaleWorkspaceState) {
    await fs.mkdir(path.join(taskdir, ".openclaw"));
    await fs.writeFile(path.join(taskdir, ".openclaw", "workspace-state.json"), '{"version":1}\n', {
      mode: 0o600,
    });
  }
  const mockCli = path.join(root, "openclaw-mock.mjs");
  await fs.writeFile(
    mockCli,
    `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const config = JSON.parse(fs.readFileSync(process.env.OPENCLAW_CONFIG_PATH, "utf8"));
const messageIndex = process.argv.indexOf("--message");
const message = messageIndex >= 0 ? process.argv[messageIndex + 1] : "";
const sessionIndex = process.argv.indexOf("--session-id");
const sessionId = sessionIndex >= 0 ? process.argv[sessionIndex + 1] : "";
if (!message.includes("adapter owns .local-ai-assist")) process.exit(29);
if (config.plugins.allow.join() !== "ollama") process.exit(20);
if (config.agents.defaults.sandbox.docker.network !== "none") process.exit(21);
if (config.agents.defaults.sandbox.scope !== "session") process.exit(22);
if (config.agents.defaults.sandbox.workspaceAccess !== "rw") process.exit(23);
if (config.agents.defaults.skipBootstrap !== true) process.exit(26);
if (config.agents.defaults.bootstrapMaxChars !== 4000) process.exit(31);
if (config.agents.defaults.bootstrapTotalMaxChars !== 8000) process.exit(32);
if (config.agents.defaults.skipOptionalBootstrapFiles.join() !== "SOUL.md,USER.md,HEARTBEAT.md,IDENTITY.md") process.exit(33);
if (config.agents.defaults.timeoutSeconds !== undefined) process.exit(27);
if (config.models.providers.ollama.timeoutSeconds !== 10) process.exit(28);
if (config.models.providers.ollama.models[0].params.keep_alive !== "10m") process.exit(30);
if (config.tools.allow.join() !== "read,write,edit,apply_patch") process.exit(24);
if (process.env.DOCKER_HOST !== "unix:///var/run/docker.sock") process.exit(25);
fs.mkdirSync(".openclaw", { recursive: true });
fs.writeFileSync(".openclaw/workspace-state.json", '{"version":1}\\n');
const trajectory = path.join(process.env.OPENCLAW_STATE_DIR, "agents", "local-ai-worker", "sessions", sessionId + ".trajectory.jsonl");
fs.mkdirSync(path.dirname(trajectory), { recursive: true });
fs.writeFileSync(trajectory, '{"type":"session.started"}\\n{"type":"model.completed"}\\n');
process.stdout.write(JSON.stringify({payloads:[{text:"done"}],meta:{agentMeta:{provider:"ollama",model:${JSON.stringify(returnedModel)}}}}));
`,
    { mode: 0o700 },
  );
  await fs.chmod(mockCli, 0o700);
  let resident = !withUnresidentModel;
  const server = createServer((request, response) => {
    if (request.url === "/api/ps") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          models: resident ? [{ name: "qwen3-coder-next:latest" }] : [],
        }),
      );
      return;
    }
    if (request.url === "/api/tags") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "qwen3-coder-next:latest" }] }));
      return;
    }
    if (request.url === "/api/chat") {
      resident = true;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ model: "qwen3-coder-next:latest", done: true }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock Ollama server did not expose a TCP address");
  }
  const contractPath = path.join(root, "worker.json");
  await fs.writeFile(
    contractPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        taskKey: "alpha",
        openclawCliPath: mockCli,
        modelRef: "ollama/qwen3-coder-next:latest",
        contextWindow: 32_768,
        maxTokens: 4_096,
        timeoutMs,
        stateRoot: path.join(root, "state"),
        ollamaBaseUrl: `http://127.0.0.1:${address.port}`,
        dockerHost: "unix:///var/run/docker.sock",
        dockerImage: "openclaw-sandbox:bookworm-slim",
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return { taskdir, contractPath, workerReceiptPath: path.join(root, "state", "worker.json") };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("openclaw-local Ringer worker", () => {
  it("generates the minimal sandboxed config and binds returned model identity", async () => {
    const { taskdir, contractPath, workerReceiptPath } = await fixture();
    const result = await execFileAsync(process.execPath, [
      WORKER_SCRIPT_PATH,
      "--taskdir",
      taskdir,
      "--model",
      "ollama/qwen3-coder-next:latest",
      "--spec",
      "Make the bounded fixture change.",
      "--contract",
      contractPath,
    ]);
    expect(result.stdout).toContain("model: ollama/qwen3-coder-next:latest");
    const receipt = JSON.parse(await fs.readFile(workerReceiptPath, "utf8"));
    expect(receipt.model).toBe("ollama/qwen3-coder-next:latest");
    expect(receipt).toMatchObject({ sessionAttempts: 1, modelCompletions: 1, sessionRetries: 0 });
    await expect(
      fs.access(path.join(taskdir, ".openclaw", "workspace-state.json")),
    ).rejects.toThrow();
  });

  it("rew warms an installed exact model when a retry finds it unloaded", async () => {
    const { taskdir, contractPath, workerReceiptPath } = await fixture(
      "qwen3-coder-next:latest",
      false,
      10_000,
      true,
    );
    const result = await execFileAsync(process.execPath, [
      WORKER_SCRIPT_PATH,
      "--taskdir",
      taskdir,
      "--model",
      "ollama/qwen3-coder-next:latest",
      "--spec",
      "Make the bounded fixture change.",
      "--contract",
      contractPath,
    ]);
    expect(result.stdout).toContain("model: ollama/qwen3-coder-next:latest");
    expect(JSON.parse(await fs.readFile(workerReceiptPath, "utf8"))).toMatchObject({
      model: "ollama/qwen3-coder-next:latest",
      sessionAttempts: 1,
    });
  });

  it("fails closed on returned model drift", async () => {
    const { taskdir, contractPath } = await fixture("different-model");
    await expect(
      execFileAsync(process.execPath, [
        WORKER_SCRIPT_PATH,
        "--taskdir",
        taskdir,
        "--model",
        "ollama/qwen3-coder-next:latest",
        "--spec",
        "Do work.",
        "--contract",
        contractPath,
      ]),
    ).rejects.toMatchObject({ stderr: expect.stringContaining("model identity mismatch") });
  });

  it("removes stale adapter-generated workspace metadata before a retry", async () => {
    const { taskdir, contractPath } = await fixture("qwen3-coder-next:latest", true);
    await execFileAsync(process.execPath, [
      WORKER_SCRIPT_PATH,
      "--taskdir",
      taskdir,
      "--model",
      "ollama/qwen3-coder-next:latest",
      "--spec",
      "Retry the bounded fixture change.",
      "--contract",
      contractPath,
    ]);
    await expect(
      fs.access(path.join(taskdir, ".openclaw", "workspace-state.json")),
    ).rejects.toThrow();
  });

  it("fails closed when the worker contract timeout is not positive", async () => {
    const { taskdir, contractPath } = await fixture("qwen3-coder-next:latest", false, 0);
    await expect(
      execFileAsync(process.execPath, [
        WORKER_SCRIPT_PATH,
        "--taskdir",
        taskdir,
        "--model",
        "ollama/qwen3-coder-next:latest",
        "--spec",
        "Do work.",
        "--contract",
        contractPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("timeoutMs must be a positive number"),
    });
  });

  it("fails closed when the exact Ollama model is not resident", async () => {
    const { taskdir, contractPath } = await fixture();
    const contract = JSON.parse(await fs.readFile(contractPath, "utf8"));
    contract.ollamaBaseUrl = "http://127.0.0.1:1";
    await fs.writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, { mode: 0o600 });
    await expect(
      execFileAsync(process.execPath, [
        WORKER_SCRIPT_PATH,
        "--taskdir",
        taskdir,
        "--model",
        "ollama/qwen3-coder-next:latest",
        "--spec",
        "Do work.",
        "--contract",
        contractPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Ollama model residency check or rewarm failed"),
    });
  });
});
