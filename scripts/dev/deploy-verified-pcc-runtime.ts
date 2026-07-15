import { execFile } from "node:child_process";
// Deploy a verified PCC runtime only after its dashboard surface contract is intact.
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  parseCustomRuntimeCapabilityManifest,
  validateCustomRuntimeCapabilityManifest,
} from "../../src/pcc/custom-runtime-capabilities.ts";
import { DASHBOARD_SURFACES } from "../../ui/config/dashboard-surfaces.ts";

export const REQUIRED_PCC_DASHBOARD_SURFACES = DASHBOARD_SURFACES.map((surface) => surface.id);

type SurfaceManifest = {
  buildId?: unknown;
  surfaces?: Array<{ id?: unknown; assets?: unknown }>;
};

const execFileAsync = promisify(execFile);

export type VerifiedRuntimeDeployment = {
  source: string;
  runtime: string;
  backup: string;
  sha: string;
};

function requireArgument(name: string, args: string[]): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required ${name} argument.`);
  }
  return path.resolve(value);
}

function requireSha(args: string[]): string {
  const index = args.indexOf("--sha");
  const value = index >= 0 ? args[index + 1]?.trim() : "";
  if (!value || !/^[0-9a-f]{7,64}$/iu.test(value)) {
    throw new Error("Missing or invalid --sha. Refuse to deploy an unpinned runtime.");
  }
  return value;
}

export async function verifyPccDashboardSurfaceManifest(source: string): Promise<void> {
  const controlUiRoot = path.join(source, "dist", "control-ui");
  const manifestPath = path.join(controlUiRoot, "dashboard-surfaces.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SurfaceManifest;
  if (typeof manifest.buildId !== "string" || !manifest.buildId.trim()) {
    throw new Error("Dashboard surface manifest is missing a build identity.");
  }
  const surfaces = new Map(
    (manifest.surfaces ?? [])
      .filter(
        (surface): surface is { id: string; assets: string[] } =>
          typeof surface.id === "string" &&
          Array.isArray(surface.assets) &&
          surface.assets.every((asset) => typeof asset === "string"),
      )
      .map((surface) => [surface.id, surface]),
  );
  const missing = REQUIRED_PCC_DASHBOARD_SURFACES.filter((id) => {
    const surface = surfaces.get(id);
    return !surface || surface.assets.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(`Dashboard surface manifest is incomplete: ${missing.join(", ")}.`);
  }
  for (const id of REQUIRED_PCC_DASHBOARD_SURFACES) {
    for (const asset of surfaces.get(id)?.assets ?? []) {
      await stat(path.join(controlUiRoot, asset));
    }
  }
}

export async function verifyCustomRuntimeCapabilityManifest(source: string): Promise<void> {
  const manifestPath = path.join(source, "config", "custom-runtime-capabilities.json");
  const manifest = parseCustomRuntimeCapabilityManifest(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  if (!manifest) {
    throw new Error("Custom runtime capability manifest is invalid.");
  }
  const errors = validateCustomRuntimeCapabilityManifest({
    manifest,
    dashboardSurfaceIds: REQUIRED_PCC_DASHBOARD_SURFACES,
  });
  for (const capability of manifest.capabilities) {
    for (const requiredPath of capability.requiredPaths) {
      try {
        const required = await stat(path.join(source, requiredPath));
        if (!required.isFile()) {
          errors.push(
            `Custom capability ${capability.id} requires a non-file path: ${requiredPath}.`,
          );
        }
      } catch {
        errors.push(`Custom capability ${capability.id} is missing ${requiredPath}.`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Custom runtime capability manifest is incomplete: ${errors.join(" ")}`);
  }
}

export async function copyVerifiedRuntime(deployment: VerifiedRuntimeDeployment): Promise<void> {
  await verifyPccDashboardSurfaceManifest(deployment.source);
  await verifyCustomRuntimeCapabilityManifest(deployment.source);
  await verifySourceSha(deployment.source, deployment.sha);
  if (deployment.source === deployment.runtime || deployment.source === deployment.backup) {
    throw new Error("Source, runtime, and backup paths must be distinct.");
  }
  try {
    await stat(deployment.backup);
    throw new Error(`Backup path already exists: ${deployment.backup}`);
  } catch (error) {
    if (
      !(error as NodeJS.ErrnoException).code ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error;
    }
  }

  let previousMoved = false;
  try {
    await rename(deployment.runtime, deployment.backup);
    previousMoved = true;
    await mkdir(deployment.runtime, { recursive: true });
    await cp(deployment.source, deployment.runtime, {
      recursive: true,
      filter: (entry) => ![".git", ".artifacts"].includes(path.basename(entry)),
    });
    await writeFile(
      path.join(deployment.runtime, ".openclaw-production-sha"),
      `${deployment.sha}\n`,
    );
    await verifyPccDashboardSurfaceManifest(deployment.runtime);
    await verifyCustomRuntimeCapabilityManifest(deployment.runtime);
  } catch (error) {
    if (previousMoved) {
      await rm(deployment.runtime, { recursive: true, force: true });
      await rename(deployment.backup, deployment.runtime);
    }
    throw error;
  }
}

async function verifySourceSha(source: string, expectedSha: string): Promise<void> {
  try {
    await stat(path.join(source, ".git"));
  } catch {
    // Fixture sources used by the isolated smoke may intentionally omit Git metadata.
    return;
  }
  const { stdout } = await execFileAsync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  const actualSha = stdout.trim();
  if (actualSha !== expectedSha) {
    throw new Error(
      `Source SHA ${actualSha} does not match requested verified SHA ${expectedSha}.`,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const deployment: VerifiedRuntimeDeployment = {
    source: requireArgument("--source", args),
    runtime: requireArgument("--runtime", args),
    backup: requireArgument("--backup", args),
    sha: requireSha(args),
  };
  await copyVerifiedRuntime(deployment);
  process.stdout.write(`PCC_RUNTIME_DEPLOY_OK sha=${deployment.sha}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`PCC_RUNTIME_DEPLOY_FAILED ${String(error)}\n`);
    process.exitCode = 1;
  });
}
