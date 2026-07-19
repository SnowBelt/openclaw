#!/usr/bin/env node
// Assemble a production-readiness receipt only from exact-SHA runtime evidence files.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const MINIMUM_SOAK_MS = 300_000;
const SURFACES = [
  "desktop",
  "tablet",
  "mobile",
  "restartRecovery",
  "soak",
  "rollback",
  "liveDiagnostic",
] as const;

type Surface = (typeof SURFACES)[number];
type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function readJson(filePath: string): JsonObject {
  return object(JSON.parse(fs.readFileSync(filePath, "utf8")), filePath);
}

function digest(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function exactSha(value: unknown, expected: string, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} sourceSha does not match ${expected}.`);
  }
}

function validateSurface(surface: Surface, value: JsonObject, sourceSha: string): void {
  if (value.passed !== true) {
    throw new Error(`${surface} evidence has not passed.`);
  }
  exactSha(value.sourceSha, sourceSha, surface);
  if (typeof value.checkedAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt))) {
    throw new Error(`${surface} evidence requires a valid checkedAt timestamp.`);
  }
  if (strings(value.evidenceRefs).length === 0) {
    throw new Error(`${surface} evidence requires at least one evidenceRef.`);
  }
  if (surface === "soak") {
    const durationMs = typeof value.durationMs === "number" ? value.durationMs : 0;
    if (durationMs < MINIMUM_SOAK_MS) {
      throw new Error(`soak evidence must cover at least ${MINIMUM_SOAK_MS}ms.`);
    }
    const startedAt =
      typeof value.startedAt === "string" ? Date.parse(value.startedAt) : Number.NaN;
    const endedAt = typeof value.endedAt === "string" ? Date.parse(value.endedAt) : Number.NaN;
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(endedAt) ||
      endedAt - startedAt < durationMs
    ) {
      throw new Error("soak evidence timestamps do not cover the claimed duration.");
    }
  }
}

export function buildControlDirectorRuntimeProof(params: {
  sourceSha: string;
  lineageReceipt: JsonObject;
  modelEval: JsonObject;
  surfaces: Record<Surface, JsonObject>;
  artifacts?: Record<string, { path: string; sha256: string }>;
  generatedAt?: string;
}): JsonObject {
  const sourceSha = params.sourceSha.trim().toLowerCase();
  if (!SHA_PATTERN.test(sourceSha)) {
    throw new Error("sourceSha must be an immutable 40-character SHA.");
  }
  if (params.lineageReceipt.passed !== true) {
    throw new Error("lineage evidence has not passed.");
  }
  exactSha(params.lineageReceipt.sourceSha, sourceSha, "lineage");
  if (
    typeof params.lineageReceipt.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(params.lineageReceipt.checkedAt))
  ) {
    throw new Error("lineage evidence requires a valid checkedAt timestamp.");
  }
  if (strings(params.lineageReceipt.evidenceRefs).length === 0) {
    throw new Error("lineage evidence requires at least one evidenceRef.");
  }
  if (params.lineageReceipt.sigBackgroundEnabled !== true) {
    throw new Error("lineage evidence requires managed SIG background processing.");
  }
  const lineage = object(params.lineageReceipt.lineage, "lineage");
  if (lineage.status !== "ready" || lineage.sourceSha !== sourceSha) {
    throw new Error("lineage must report ready from the exact source SHA.");
  }
  if (params.modelEval.passed !== true || params.modelEval.exactRuntime !== true) {
    throw new Error("model evaluation must be an exact-runtime pass.");
  }
  exactSha(params.modelEval.sourceSha, sourceSha, "modelEval");
  if (
    params.modelEval.passRate !== 100 ||
    params.modelEval.criticalOmissions !== 0 ||
    params.modelEval.coveragePassed !== true
  ) {
    throw new Error(
      "model evaluation requires 100% pass rate, full coverage, and zero critical omissions.",
    );
  }
  for (const surface of SURFACES) {
    validateSurface(surface, params.surfaces[surface], sourceSha);
  }
  return {
    schemaVersion: 2,
    sourceSha,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    sigBackgroundEnabled: true,
    lineage,
    modelEval: params.modelEval,
    ...params.surfaces,
    artifacts: params.artifacts ?? {},
  };
}

function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") {
      continue;
    }
    if (!key?.startsWith("--")) {
      throw new Error(`Unknown argument: ${key ?? ""}`);
    }
    const value = argv[++index];
    if (!value) {
      throw new Error(`Missing value for ${key}.`);
    }
    values.set(key.slice(2), value);
  }
  const required = ["source-sha", "lineage", "model-eval", ...SURFACES, "output"];
  for (const key of required) {
    if (!values.get(key)) {
      throw new Error(`Missing --${key}.`);
    }
  }
  return values;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const sourceSha = args.get("source-sha")!;
  const inputPaths = {
    lineage: path.resolve(args.get("lineage")!),
    modelEval: path.resolve(args.get("model-eval")!),
    ...Object.fromEntries(SURFACES.map((surface) => [surface, path.resolve(args.get(surface)!)])),
  } as Record<string, string>;
  const surfaces = Object.fromEntries(
    SURFACES.map((surface) => [surface, readJson(inputPaths[surface]!)]),
  ) as Record<Surface, JsonObject>;
  const proof = buildControlDirectorRuntimeProof({
    sourceSha,
    lineageReceipt: readJson(inputPaths.lineage!),
    modelEval: readJson(inputPaths.modelEval!),
    surfaces,
    artifacts: Object.fromEntries(
      Object.entries(inputPaths).map(([name, filePath]) => [
        name,
        { path: filePath, sha256: digest(filePath) },
      ]),
    ),
  });
  const output = path.resolve(args.get("output")!);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${output}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
