// Runs candidate browser proof against a temporary Gateway and a sealed build snapshot.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createOpenClawTestInstance,
  type OpenClawTestInstance,
} from "../../test/helpers/openclaw-test-instance.ts";

const TOKEN_PATTERN = /([#?&]token=)[^&/#]+/giu;
const PROFILE_VERSION = "2";

function redact(value: string): string {
  return value.replace(TOKEN_PATTERN, "$1<redacted>");
}

function assertNoTokenLeak(value: string): void {
  if (/token=[A-Za-z0-9._~+/=-]{8,}/iu.test(value)) {
    throw new Error("isolated candidate browser proof contains an unredacted token");
  }
}

function readRuntimeSha(runtimeRoot: string): string | null {
  try {
    const marker = fs
      .readFileSync(path.join(runtimeRoot, ".openclaw-production-sha"), "utf8")
      .trim();
    if (marker) {
      return marker;
    }
  } catch {
    // Try the snapshot below.
  }
  try {
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(runtimeRoot, "snapshot.json"), "utf8"),
    ) as {
      source?: { buildStamp?: { head?: unknown }; runtimePostbuildStamp?: { head?: unknown } };
    };
    const head = snapshot.source?.runtimePostbuildStamp?.head ?? snapshot.source?.buildStamp?.head;
    return typeof head === "string" && head.trim() ? head.trim() : null;
  } catch {
    return null;
  }
}

function resolveRuntimeRoot(expectedSha: string): string {
  const explicit = process.env.OPENCLAW_PCC_PROOF_RUNTIME_ROOT?.trim();
  if (explicit) {
    const resolved = fs.realpathSync(explicit);
    if (readRuntimeSha(resolved) !== expectedSha) {
      throw new Error(`sealed build snapshot does not match candidate SHA ${expectedSha}`);
    }
    return resolved;
  }
  const releasesRoot = path.join(
    process.cwd(),
    ".artifacts",
    "openclaw-gateway-runtime",
    "releases",
  );
  const candidates = fs
    .readdirSync(releasesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(releasesRoot, entry.name))
    .toSorted((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  const match = candidates.find((candidate) => readRuntimeSha(candidate) === expectedSha);
  if (!match) {
    throw new Error(`no sealed build snapshot found for candidate SHA ${expectedSha}`);
  }
  return fs.realpathSync(match);
}

async function cleanup(instance: OpenClawTestInstance): Promise<void> {
  await instance.stopGateway();
  await instance.state.cleanup();
}

async function runChild(params: {
  runtimeRoot: string;
  scriptPath: string;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("node", ["--import", "tsx", params.scriptPath], {
      cwd: params.runtimeRoot,
      env: params.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `isolated candidate PCC browser proof failed (code=${String(code)} signal=${String(signal)})`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  const candidateSha = process.env.OPENCLAW_PCC_EXPECTED_CANDIDATE_SHA?.trim();
  if (!candidateSha) {
    throw new Error("OPENCLAW_PCC_EXPECTED_CANDIDATE_SHA is required");
  }
  const runtimeRoot = resolveRuntimeRoot(candidateSha);
  const repoRoot = process.cwd();
  const name = `pcc-candidate-proof-${randomUUID().slice(0, 8)}`;
  const instance = await createOpenClawTestInstance({
    name,
    cwd: repoRoot,
    env: { OPENCLAW_PCC_LIVE_E2E_PLAN_FIXTURE: "1" },
    config: { gateway: { controlUi: { enabled: true } } },
  });
  const artifactDir = path.join(instance.state.root, "candidate-browser-proof");
  fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  const dashboardUrl = `http://127.0.0.1:${instance.port}/pcc#token=${encodeURIComponent(instance.gatewayToken)}`;
  try {
    await instance.startGateway();
    console.log(`PCC isolated candidate Gateway is ready (runtime=${runtimeRoot}).`);
    await runChild({
      runtimeRoot,
      scriptPath: path.join(
        repoRoot,
        "scripts/dev/control-ui-pcc-production-runtime-auth-proof.ts",
      ),
      env: {
        ...instance.env,
        OPENCLAW_CONFIG_PATH: instance.configPath,
        OPENCLAW_GATEWAY_TOKEN: instance.gatewayToken,
        OPENCLAW_DASHBOARD_AUTH_URL: dashboardUrl,
        OPENCLAW_PCC_RELEASE_PROOF_PROFILE: "mac_studio_control_director",
        OPENCLAW_PCC_PROOF_PROFILE_VERSION: PROFILE_VERSION,
        OPENCLAW_PCC_PROOF_PHASE: "candidate",
        OPENCLAW_PCC_EXPECTED_CANDIDATE_SHA: candidateSha,
        OPENCLAW_PCC_PROOF_SCREENSHOT: path.join(artifactDir, "candidate.png"),
        OPENCLAW_PCC_PROOF_RECEIPT: path.join(artifactDir, "candidate.receipt.json"),
        OPENCLAW_PCC_PROOF_PROJECT_TITLE: "Project Command Center",
      },
    });
    console.log("PCC isolated candidate browser proof passed; temporary Gateway state removed.");
  } finally {
    console.log("PCC isolated candidate Gateway cleanup starting.");
    await cleanup(instance);
    console.log("PCC isolated candidate Gateway cleanup completed.");
  }
}

function runSelfTest(): void {
  assertNoTokenLeak(redact("http://127.0.0.1:18789/pcc#token=secret-token-123456"));
  console.log("PCC isolated candidate browser proof self-test passed");
}

if (process.env.OPENCLAW_PCC_CANDIDATE_PROOF_SELF_TEST === "1") {
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
