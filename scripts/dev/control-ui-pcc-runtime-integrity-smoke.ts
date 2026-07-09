// Prove the built dashboard and fail-closed runtime deployment contract are intact.
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  copyVerifiedRuntime,
  verifyPccDashboardSurfaceManifest,
} from "./deploy-verified-pcc-runtime.ts";

const source = process.cwd();
await verifyPccDashboardSurfaceManifest(source);

const surfaceIds = [
  "pcc",
  "app-studio",
  "music-studio",
  "snes-studio",
  "book-writer",
  "kalshi",
  "pattern-lab",
];
const temp = await mkdtemp(path.join(os.tmpdir(), "openclaw-pcc-runtime-integrity-"));
try {
  const fixtureSource = path.join(temp, "source");
  const runtime = path.join(temp, "runtime");
  const backup = path.join(temp, "backup");
  const assets = path.join(fixtureSource, "dist", "control-ui", "assets");
  await mkdir(assets, { recursive: true });
  await Promise.all(
    surfaceIds.map(async (id) => writeFile(path.join(assets, `${id}.js`), `// ${id}\n`)),
  );
  await writeFile(
    path.join(fixtureSource, "dist", "control-ui", "dashboard-surfaces.json"),
    JSON.stringify({
      buildId: "fixture-build",
      surfaces: surfaceIds.map((id) => ({ id, assets: [`assets/${id}.js`] })),
    }),
  );
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, "previous-runtime.txt"), "previous");

  await copyVerifiedRuntime({ source: fixtureSource, runtime, backup, sha: "abcdef1" });
  if (
    (await readFile(path.join(runtime, ".openclaw-production-sha"), "utf8")).trim() !== "abcdef1"
  ) {
    throw new Error("Runtime deployment did not write the verified SHA marker.");
  }
  if ((await readFile(path.join(backup, "previous-runtime.txt"), "utf8")).trim() !== "previous") {
    throw new Error("Runtime deployment did not preserve the rollback backup.");
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
process.stdout.write("PCC_RUNTIME_INTEGRITY_SMOKE_OK\n");
