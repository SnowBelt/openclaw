#!/usr/bin/env node
import { parseGlm52RuntimeArgs, runGlm52Runtime } from "./lib/glm52-local-runtime.mjs";

try {
  const options = parseGlm52RuntimeArgs();
  const report = await runGlm52Runtime(options);
  process.stdout.write(`${JSON.stringify(report, null, options.json ? 0 : 2)}\n`);
  if (report.ok === false) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      blocker: error instanceof Error ? error.message : String(error),
      ok: false,
      status: "blocked",
    })}\n`,
  );
  process.exitCode = 1;
}
