import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  createOpenClawTestInstance,
  type OpenClawTestInstance,
} from "../../test/helpers/openclaw-test-instance.ts";

const TOKEN_PATTERN = /([#?&]token=)[^&/#]+/giu;

function redact(value: string): string {
  return value.replace(TOKEN_PATTERN, "$1<redacted>");
}

async function stopInstance(instance: OpenClawTestInstance): Promise<void> {
  const child = instance.child;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
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

async function runProof(instance: OpenClawTestInstance): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "node",
      ["--import", "tsx", "scripts/dev/control-ui-pcc-six-user-browser-e2e.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...instance.env,
          OPENCLAW_CONFIG_PATH: instance.configPath,
          OPENCLAW_GATEWAY_TOKEN: instance.gatewayToken,
          OPENCLAW_PCC_LIVE_E2E_ISOLATED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => process.stdout.write(redact(chunk)));
    child.stderr.on("data", (chunk: string) => process.stderr.write(redact(chunk)));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`six-user PCC browser child failed (code=${code} signal=${signal})`));
    });
  });
}

async function main(): Promise<void> {
  const instance = await createOpenClawTestInstance({
    name: `pcc-six-user-${randomUUID().slice(0, 8)}`,
    cwd: process.cwd(),
    env: { OPENCLAW_PCC_LIVE_E2E_PLAN_FIXTURE: "1" },
    config: { gateway: { controlUi: { enabled: true } } },
  });
  try {
    await instance.startGateway();
    await runProof(instance);
    console.log("PCC isolated six-user Chrome proof passed.");
  } finally {
    await stopInstance(instance);
  }
}

await main().catch((error: unknown) => {
  console.error(redact(error instanceof Error ? (error.stack ?? error.message) : String(error)));
  process.exitCode = 1;
});
