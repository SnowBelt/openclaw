import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
  findUnregisteredCustomRuntimePaths,
  parseCustomRuntimeCapabilityManifest,
  validateCustomRuntimeCapabilityManifest,
} from "../src/pcc/custom-runtime-capabilities.js";
import { DASHBOARD_SURFACES } from "../ui/config/dashboard-surfaces.js";

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, "config", "custom-runtime-capabilities.json");
const parsed = parseCustomRuntimeCapabilityManifest(
  JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown,
);
if (!parsed) {
  console.error("Custom runtime capability manifest is invalid.");
  process.exitCode = 1;
} else {
  const errors = validateCustomRuntimeCapabilityManifest({
    manifest: parsed,
    dashboardSurfaceIds: DASHBOARD_SURFACES.map((surface) => surface.id),
  });
  if (parsed.schema !== CUSTOM_RUNTIME_CAPABILITY_SCHEMA || parsed.version !== 5) {
    errors.push("Canonical custom runtime capability manifest must use schema v2 revision 5.");
  }
  const standardsRegistry = parsed.preservation?.standardsRegistry;
  if (
    !standardsRegistry ||
    !fs.existsSync(path.join(repoRoot, standardsRegistry)) ||
    !fs.statSync(path.join(repoRoot, standardsRegistry)).isFile()
  ) {
    errors.push("Custom runtime preservation standards registry is missing.");
  }
  for (const capability of parsed.capabilities) {
    for (const requiredPath of capability.requiredPaths) {
      const absolutePath = path.join(repoRoot, requiredPath);
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        errors.push(`Custom capability ${capability.id} is missing ${requiredPath}.`);
      }
    }
  }
  const trackedCustomRuntimeFiles = spawnSync("git", ["ls-files", "--", "scripts/custom-runtime"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (trackedCustomRuntimeFiles.status !== 0) {
    errors.push(
      `Could not enumerate tracked custom-runtime files: ${(
        trackedCustomRuntimeFiles.stderr || trackedCustomRuntimeFiles.stdout
      ).trim()}`,
    );
  } else {
    for (const unregisteredPath of findUnregisteredCustomRuntimePaths(
      parsed,
      trackedCustomRuntimeFiles.stdout.split(/\r?\n/u).filter(Boolean),
    )) {
      errors.push(
        `Tracked custom-runtime control-plane file has no capability owner: ${unregisteredPath}.`,
      );
    }
  }
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`Custom runtime capability guard: ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify(
        {
          schema: parsed.schema,
          version: parsed.version,
          capabilityIds: parsed.capabilities.map((capability) => capability.id),
          result: "passed",
        },
        null,
        2,
      ),
    );
  }
}
