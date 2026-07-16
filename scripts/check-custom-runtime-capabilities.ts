import fs from "node:fs";
import path from "node:path";
import {
  CUSTOM_RUNTIME_CAPABILITY_SCHEMA,
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
  if (parsed.schema !== CUSTOM_RUNTIME_CAPABILITY_SCHEMA || parsed.version !== 2) {
    errors.push("Canonical custom runtime capability manifest must use schema v2.");
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
