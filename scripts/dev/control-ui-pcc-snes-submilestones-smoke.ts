import { runPccSubMilestoneSmoke } from "./pcc-submilestone-smoke-helper.ts";

runPccSubMilestoneSmoke("snes").catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
