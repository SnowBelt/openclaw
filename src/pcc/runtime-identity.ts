import fs from "node:fs";
import path from "node:path";

export type PccRuntimeIdentity = {
  runtimeSha: string | null;
  runtimeEntrypoint: string | null;
  expectedRuntimeRoot: string | null;
};

function nonEmpty(value: string): string | null {
  return value.trim() || null;
}

export function readPccRuntimeIdentity(): PccRuntimeIdentity {
  const expectedRuntimeRoot =
    process.env.OPENCLAW_PRODUCTION_RUNTIME_ROOT ||
    process.env.OPENCLAW_RUNTIME_ROOT ||
    process.cwd();
  const markerPath =
    process.env.OPENCLAW_PRODUCTION_SHA_FILE ||
    path.join(expectedRuntimeRoot, ".openclaw-production-sha");
  let runtimeSha: string | null;
  try {
    runtimeSha = nonEmpty(fs.readFileSync(markerPath, "utf8"));
  } catch {
    runtimeSha = null;
  }
  return {
    runtimeSha,
    runtimeEntrypoint: process.argv[1] ? path.resolve(process.argv[1]) : null,
    expectedRuntimeRoot: path.resolve(expectedRuntimeRoot),
  };
}
