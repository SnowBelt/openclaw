/* oxlint-disable eslint/no-promise-executor-return eslint/no-useless-assignment -- The smoke harness intentionally retains callback and lifecycle state for failure diagnostics. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBookWriterSmokeStdout } from "./control-ui-book-writer-completion-audit.ts";

const MODEL_ID = "Qwen/Qwen3-30B-A3B-Instruct-2507";
const GATEWAY_TOKEN = "smoke-token";
const DEFAULT_ARTIFACT_ROOT = ".artifacts/control-ui-book-writer-local-smoke";

type ChildResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

type SmokeWrapperSummary = {
  ok: boolean;
  gatewayPort: number;
  modelPort: number;
  artifactDir: string;
  gatewayLogPath: string;
  smokeStdoutPath: string;
  smokeStderrPath: string;
  bookWriterSummaryPath?: string;
  bookWriterSummaryParseError?: string;
  uiBuildLogPath: string;
  uiBuildExitCode: number | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseRequestedParagraphIds(prompt: string): string[] {
  const ids: string[] = [];
  for (const match of prompt.matchAll(/-\s+((?:para|paragraph)-[A-Za-z0-9_-]+):/g)) {
    const id = match[1];
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids.length > 0 ? ids : ["para-1", "para-2", "para-3"];
}

function paragraphText(id: string, prompt: string): string {
  const witness = /protect the witness/i.test(prompt);
  const clue = /clue|invoice|bridge|ledger|witness/i.test(prompt);
  const numeric = Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const names = ["Mara", "Eli", "June", "Caleb", "Nora"];
  const places = [
    "inspection trailer",
    "rain-dark bridge deck",
    "records room",
    "council hallway",
    "river overlook",
  ];
  const name = names[numeric % names.length] ?? "Mara";
  const hero = /Primary Voice/i.test(prompt) ? "Primary Voice" : name;
  const place = places[numeric % places.length] ?? "records room";
  if (witness) {
    return `${hero} lowers their voice in the ${place}, because the new witness warning changes what can safely happen next. The bridge invoices, the nervous glance, and the promise to protect a source now point in the same direction, so the investigation advances without disturbing any locked wording or approved facts. By the time the door closes, the danger has become specific enough for the next scene to settle. A rusted bolt, a copied signature, and a quiet promise give the moment weight, while the honest bridge inspector keeps choosing evidence over fear. The torn maintenance map, the damp concrete smell, and the clerk's careful silence all sharpen the choice in front of Primary Voice. Instead of rushing, the inspector marks the invoice number, protects the source, and carries one clean question into the next room: who benefited when the repair was signed off before the bridge was safe, and who tried to bury the warning twice?`;
  }
  if (clue) {
    const openings = [
      `${hero} spreads the bridge ledger across the ${place} and circles a receipt that refuses to match the work order.`,
      `Rain taps the ${place} windows while ${hero} compares the invoice dates with the inspection photographs.`,
      `${hero} follows a copied signature from the bridge file to a payment record nobody wanted logged.`,
      `The rust sample on ${hero}'s desk makes the neat invoice total look suddenly dishonest.`,
      `${hero} listens to the clerk's careful pause and writes the missing receipt number in the margin.`,
    ];
    const middles = [
      "The detail gives the choice urgency because a nervous witness, a skipped repair, and a public crossing now sit in the same chain of cause and consequence.",
      "Each fact narrows the lie: the money moved before the crew arrived, the warning vanished after lunch, and the safest explanation no longer fits.",
      "No one says fraud aloud, but the copied initials, damp concrete smell, and locked cabinet make silence feel like evidence.",
      "The inspector protects the source by asking smaller questions, saving the larger accusation until the pattern can stand on its own.",
      "A bolt, a photograph, and a late-night voicemail turn suspicion into a path that can be checked without guessing.",
    ];
    const endings = [
      "By the end of the exchange, Primary Voice has one clean question for the next room: who signed off before the bridge was safe?",
      "The discovery leaves Primary Voice steadier, not louder, and the next step points toward the person who profited from the missing repair.",
      "That pressure carries forward as practical courage, with the source protected and the evidence strong enough to survive denial.",
      "Primary Voice closes the file slowly, knowing the next conversation must expose motive without risking the witness.",
      "The answer is not complete yet, but the trail now has direction, consequence, and a fair test waiting in the next scene.",
    ];
    return `${openings[numeric % openings.length]} ${middles[numeric % middles.length]} ${endings[numeric % endings.length]}`;
  }
  return `${hero} pauses in the ${place} long enough to choose courage over convenience. The decision carries the earlier clue forward, changes the next conversation, and keeps the book's clean suspense focused on evidence, consequence, and a fair resolution. That pressure gives the next scene urgency and a promise worth keeping. A rusted bolt, a copied signature, and a quiet promise give the moment weight, while the honest bridge inspector keeps choosing evidence over fear. The torn maintenance map, the damp concrete smell, and the clerk's careful silence all sharpen the choice in front of Primary Voice. Instead of rushing, the inspector marks the invoice number, protects the source, and carries one clean question into the next room: who benefited when the repair was signed off before the bridge was safe, and who tried to bury the warning twice?`;
}

function contentForPrompt(prompt: string): string {
  if (
    /Return only compact JSON with keys: title, summary, readerPromise, targetWords, tone, audience/i.test(
      prompt,
    )
  ) {
    return JSON.stringify({
      title: "The Bridge Ledger",
      summary:
        "A clean commercial mystery about a bridge inspector who finds invoice fraud, protects a nervous witness, and follows the clues to a public-facing resolution.",
      readerPromise:
        "A clear, suspenseful mystery where every clue has a fair payoff and no explicit content.",
      targetWords: 12000,
      tone: "clean, suspenseful, practical, and humane",
      audience:
        "Readers who like fair-play mysteries with practical courage and satisfying closure.",
    });
  }

  if (/Return only compact JSON with a chapters array/i.test(prompt)) {
    const ids = [...prompt.matchAll(/(chapter-[A-Za-z0-9_-]+): Chapter \d+:/g)]
      .map((match) => match[1])
      .filter((id): id is string => Boolean(id));
    const chapterIds = ids.length > 0 ? ids : ["chapter-1", "chapter-2", "chapter-3"];
    return JSON.stringify({
      chapters: chapterIds.map((id, index) => ({
        id,
        title:
          ["The Rust Under the Paint", "A Witness in the Rain", "The Ledger Answers"][index] ??
          `The Clue Turns ${index + 1}`,
        description: `Chapter ${index + 1} turns the bridge mystery through a specific clue, a human consequence, and a setup that pays off later.`,
        styleDirection: "Keep the chapter clean, tense, concrete, and easy to follow.",
        role: {
          storyThread: index === chapterIds.length - 1 ? "resolution" : "main-story",
          plotJob: index === chapterIds.length - 1 ? "payoff" : index === 0 ? "setup" : "clue",
          readerFeeling: "suspenseful",
          notes: "Preserve continuity and make each clue matter.",
        },
      })),
    });
  }

  if (
    /Return shape:\s*\{"paragraphs"/i.test(prompt) ||
    /Output exactly one entry for each requested paragraph id/i.test(prompt)
  ) {
    return JSON.stringify({
      paragraphs: parseRequestedParagraphIds(prompt).map((id) => ({
        id,
        text: paragraphText(id, prompt),
      })),
    });
  }

  return paragraphText("scene", prompt);
}

function messageContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content == null) {
    return "";
  }
  return JSON.stringify(content);
}

async function readRequestBody(req: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function startMockModelServer(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === "GET" && (req.url === "/v1/models" || req.url === "/models")) {
        jsonResponse(res, 200, {
          data: [{ id: MODEL_ID, object: "model", owned_by: "local-smoke" }],
        });
        return;
      }

      if (
        req.method === "POST" &&
        (req.url === "/v1/chat/completions" || req.url === "/chat/completions")
      ) {
        const raw = await readRequestBody(req);
        let prompt = "";
        try {
          const body = JSON.parse(raw || "{}") as { messages?: Array<{ content?: unknown }> };
          const messages = Array.isArray(body.messages) ? body.messages : [];
          prompt = messages.map((message) => messageContentText(message.content)).join("\n");
        } catch {
          prompt = "";
        }
        jsonResponse(res, 200, {
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          model: MODEL_ID,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: contentForPrompt(prompt) },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });
        return;
      }

      jsonResponse(res, 404, { error: "not found" });
    })().catch((error: unknown) => {
      jsonResponse(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }
        reject(new Error("Could not allocate a free local port."));
      });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function startGateway(params: {
  port: number;
  configPath: string;
  stateDir: string;
  homeDir: string;
  logPath: string;
}): ChildProcessWithoutNullStreams {
  const child = spawn(
    "pnpm",
    [
      "openclaw",
      "gateway",
      "run",
      "--port",
      String(params.port),
      "--bind",
      "custom",
      "--auth",
      "token",
      "--token",
      GATEWAY_TOKEN,
      "--tailscale",
      "off",
      "--allow-unconfigured",
    ],
    {
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=8192",
        OPENCLAW_CONFIG_PATH: params.configPath,
        OPENCLAW_STATE_DIR: params.stateDir,
        HOME: params.homeDir,
      },
      stdio: "pipe",
    },
  );
  const log = (chunk: Buffer) => {
    writeFileSync(params.logPath, chunk, { flag: "a" });
  };
  child.stdout.on("data", log);
  child.stderr.on("data", log);
  return child;
}

async function waitForGateway(port: number, child: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 240_000;
  let lastError = "Gateway did not respond yet.";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Gateway exited before readiness with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) {
        return;
      }
      lastError = `Gateway health returned HTTP ${response.status}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Gateway did not become ready: ${lastError}`);
}

async function runChild(command: string, args: string[], options: { env: NodeJS.ProcessEnv }) {
  const child = spawn(command, args, {
    env: options.env,
    stdio: "pipe",
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stdout += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderr += text;
    process.stderr.write(text);
  });
  return await new Promise<ChildResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function rebuildControlUi(logPath: string): Promise<ChildResult> {
  const result = await runChild("pnpm", ["ui:build"], {
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=8192",
    },
  });
  writeFileSync(
    logPath,
    ["$ pnpm ui:build", "", "## stdout", result.stdout, "", "## stderr", result.stderr, ""].join(
      "\n",
    ),
  );
  if (result.code !== 0) {
    throw new Error(`Control UI build failed before Book Writer smoke with code ${result.code}.`);
  }
  return result;
}

async function main(): Promise<void> {
  const artifactRoot =
    process.env.OPENCLAW_CONTROL_UI_BOOK_WRITER_ARTIFACT_DIR?.trim() || DEFAULT_ARTIFACT_ROOT;
  mkdirSync(artifactRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  const artifactDir = join(artifactRoot, stamp);
  mkdirSync(artifactDir, { recursive: true });

  const gatewayPort = await findFreePort();
  const modelPort = await findFreePort();
  const tempRoot = mkdtempSync(join(tmpdir(), "openclaw-book-writer-local-smoke-"));
  const stateDir = join(tempRoot, "state");
  const homeDir = join(tempRoot, "home");
  const outputDir = join(stateDir, "book-writer", "books");
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  const configPath = join(tempRoot, "openclaw-book-writer-smoke.json");
  const gatewayLogPath = join(artifactDir, "gateway.log");
  const summaryPath = join(artifactDir, "summary.json");
  const smokeStdoutPath = join(artifactDir, "smoke.stdout.log");
  const smokeStderrPath = join(artifactDir, "smoke.stderr.log");
  const bookWriterSummaryPath = join(artifactDir, "book-writer-summary.json");
  const uiBuildLogPath = join(artifactDir, "ui-build.log");
  const uiBuild = await rebuildControlUi(uiBuildLogPath);

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        gateway: {
          port: gatewayPort,
          bind: "custom",
          auth: { mode: "token", token: GATEWAY_TOKEN },
          customBindHost: "127.0.0.1",
        },
        plugins: {
          entries: {
            "book-writer": {
              enabled: true,
              config: {
                outputDir,
                localProvider: "lmstudio",
                localModel: MODEL_ID,
                localBaseUrl: `http://127.0.0.1:${modelPort}/v1`,
                qualityThresholds: {
                  minWords: 250,
                  minQualityScore: 0.74,
                  maxInternalSimilarity: 0.34,
                },
              },
            },
          },
        },
      },
      null,
      2,
    ),
  );

  const mockServer = await startMockModelServer(modelPort);
  const gateway = startGateway({
    port: gatewayPort,
    configPath,
    stateDir,
    homeDir,
    logPath: gatewayLogPath,
  });

  try {
    await waitForGateway(gatewayPort, gateway);
    const result = await runChild(
      process.execPath,
      ["--import", "tsx", "scripts/dev/control-ui-book-writer-smoke.ts"],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=8192",
          OPENCLAW_CONFIG_PATH: configPath,
          OPENCLAW_STATE_DIR: stateDir,
          HOME: homeDir,
          OPENCLAW_CONTROL_UI_SMOKE_URL: `http://127.0.0.1:${gatewayPort}/book-writer#token=${GATEWAY_TOKEN}`,
          OPENCLAW_CONTROL_UI_BOOK_WRITER_SMOKE_ALLOW_MUTATION: "1",
          OPENCLAW_CONTROL_UI_SMOKE_PERSIST_PROFILE: "0",
        },
      },
    );
    writeFileSync(smokeStdoutPath, result.stdout);
    writeFileSync(smokeStderrPath, result.stderr);
    let parsedBookWriterSummaryPath: string | undefined;
    let bookWriterSummaryParseError: string | undefined;
    try {
      const smokeSummary = parseBookWriterSmokeStdout(result.stdout);
      writeFileSync(bookWriterSummaryPath, `${JSON.stringify(smokeSummary, null, 2)}\n`);
      parsedBookWriterSummaryPath = bookWriterSummaryPath;
    } catch (error) {
      bookWriterSummaryParseError = error instanceof Error ? error.message : String(error);
    }
    const smokeOk = result.code === 0 && Boolean(parsedBookWriterSummaryPath);
    const summary: SmokeWrapperSummary = {
      ok: smokeOk,
      gatewayPort,
      modelPort,
      artifactDir,
      gatewayLogPath,
      smokeStdoutPath,
      smokeStderrPath,
      ...(parsedBookWriterSummaryPath
        ? { bookWriterSummaryPath: parsedBookWriterSummaryPath }
        : {}),
      ...(bookWriterSummaryParseError ? { bookWriterSummaryParseError } : {}),
      uiBuildLogPath,
      uiBuildExitCode: uiBuild.code,
      exitCode: result.code,
      signal: result.signal,
    };
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log("control-ui-book-writer-local-smoke: summary", JSON.stringify(summary, null, 2));
    if (!smokeOk) {
      process.exitCode = result.code ?? 1;
    }
  } finally {
    gateway.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (gateway.exitCode === null) {
      gateway.kill("SIGKILL");
    }
    await closeServer(mockServer);
  }
}

main().catch((error: unknown) => {
  console.error(
    "control-ui-book-writer-local-smoke: failed",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
