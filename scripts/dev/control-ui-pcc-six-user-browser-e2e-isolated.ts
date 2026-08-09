// Runs the six-context PCC proof only against a temporary Gateway and ledger.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createOpenClawTestInstance,
  type OpenClawTestInstance,
} from "../../test/helpers/openclaw-test-instance.ts";

const TOKEN_PATTERN = /([#?&]token=)[^&/#]+/giu;

function redact(value: string): string {
  return value.replace(TOKEN_PATTERN, "$1<redacted>");
}

function assertNoTokenLeak(value: string): void {
  if (/token=[A-Za-z0-9._~+/=-]{8,}/iu.test(value)) {
    throw new Error("isolated six-user PCC proof contains an unredacted token");
  }
}

async function runChild(params: { cwd: string; env: NodeJS.ProcessEnv }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "node",
      ["--import", "tsx", "scripts/dev/control-ui-pcc-six-user-browser-e2e.ts"],
      {
        cwd: params.cwd,
        env: params.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      process.stdout.write(redact(chunk));
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
      process.stderr.write(redact(chunk));
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      assertNoTokenLeak(redact(output));
      console.log(
        `PCC isolated six-user browser child exited (code=${String(code)} signal=${String(signal)}).`,
      );
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `isolated six-user PCC proof failed (code=${String(code)} signal=${String(signal)})`,
        ),
      );
    });
  });
}

async function cleanupIsolatedGateway(instance: OpenClawTestInstance): Promise<void> {
  const child = instance.child;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
      }),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 2_000);
      }),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
  await instance.state.cleanup();
}

async function main(): Promise<void> {
  const name = `pcc-six-user-${randomUUID().slice(0, 8)}`;
  const instance = await createOpenClawTestInstance({
    name,
    cwd: process.cwd(),
    env: { OPENCLAW_PCC_LIVE_E2E_PLAN_FIXTURE: "1" },
    config: { gateway: { controlUi: { enabled: true } } },
  });
  const artifactDir = path.join(instance.state.root, "six-user-artifacts");
  fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  try {
    await instance.startGateway();
    console.log("PCC isolated six-user Gateway is ready.");
    await runChild({
      cwd: process.cwd(),
      env: {
        ...instance.env,
        OPENCLAW_CONFIG_PATH: instance.configPath,
        OPENCLAW_GATEWAY_TOKEN: instance.gatewayToken,
        OPENCLAW_PCC_LIVE_E2E_ISOLATED: "1",
        OPENCLAW_PCC_SIX_USER_E2E_ARTIFACT_DIR: artifactDir,
      },
    });
    console.log("PCC isolated six-user browser proof passed; temporary Gateway state removed.");
  } finally {
    console.log("PCC isolated six-user Gateway cleanup starting.");
    await cleanupIsolatedGateway(instance);
    console.log("PCC isolated six-user Gateway cleanup completed.");
  }
}

function runSelfTest(): void {
  const redacted = redact("http://127.0.0.1:18789/pcc#token=secret-token-123456");
  assertNoTokenLeak(redacted);
  console.log("PCC isolated six-user browser E2E self-test passed");
}

if (process.env.OPENCLAW_PCC_SIX_USER_E2E_SELF_TEST === "1") {
  runSelfTest();
} else {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const output = redact(message);
    assertNoTokenLeak(output);
    console.error(output);
    process.exitCode = 1;
  });
}
