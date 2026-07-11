// Runs PCC mutation proof only against a temporary Gateway and temporary ledger.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
    throw new Error("isolated disposable PCC E2E output contains an unredacted token");
  }
}

async function runChild(params: { cwd: string; env: NodeJS.ProcessEnv }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "node",
      ["--import", "tsx", "scripts/dev/control-ui-pcc-live-disposable-browser-e2e.ts"],
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
      console.log(
        `PCC isolated disposable browser child exited (code=${String(code)} signal=${String(signal)}).`,
      );
      assertNoTokenLeak(redact(output));
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `isolated disposable PCC E2E failed (code=${String(code)} signal=${String(signal)})`,
        ),
      );
    });
  });
}

async function cleanupIsolatedGateway(instance: OpenClawTestInstance): Promise<void> {
  // Do not use the helper's process-group cleanup here. The proof runner itself can
  // share the parent process group on macOS, which would end the runner before it
  // records the test result. The Gateway is a dedicated child, so direct shutdown is
  // sufficient before removing the temporary state.
  const child = instance.child;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
  await instance.state.cleanup();
}

async function main(): Promise<void> {
  const name = `pcc-live-disposable-${randomUUID().slice(0, 8)}`;
  const instance = await createOpenClawTestInstance({
    name,
    cwd: process.cwd(),
    config: {
      gateway: {
        controlUi: { enabled: true },
      },
    },
  });
  try {
    await instance.startGateway();
    console.log("PCC isolated disposable Gateway is ready.");
    const screenshotPath =
      process.env.OPENCLAW_PCC_LIVE_E2E_SCREENSHOT ??
      path.join(instance.state.root, "pcc-live-disposable-e2e.png");
    await runChild({
      cwd: process.cwd(),
      env: {
        ...instance.env,
        OPENCLAW_CONFIG_PATH: instance.configPath,
        OPENCLAW_GATEWAY_TOKEN: instance.gatewayToken,
        OPENCLAW_PCC_LIVE_E2E_ISOLATED: "1",
        OPENCLAW_PCC_LIVE_E2E_SCREENSHOT: screenshotPath,
      },
    });
    console.log("PCC isolated disposable browser E2E passed; temporary Gateway state removed.");
  } finally {
    console.log("PCC isolated disposable Gateway cleanup starting.");
    await cleanupIsolatedGateway(instance);
    console.log("PCC isolated disposable Gateway cleanup completed.");
  }
}

function runSelfTest(): void {
  const redacted = redact("http://127.0.0.1/projects#token=secret-token-123456");
  assertNoTokenLeak(redacted);
  console.log("PCC isolated disposable browser E2E self-test passed");
}

if (process.env.OPENCLAW_PCC_LIVE_E2E_SELF_TEST === "1") {
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
