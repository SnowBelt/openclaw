#!/usr/bin/env node
// Promotes a completed local source build into an immutable managed-Gateway runtime release.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_VERSION = 2;
const SNAPSHOT_RELATIVE_DIR = path.join(".artifacts", "openclaw-gateway-runtime");

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`Expected an object in ${filePath}`);
  }
  return parsed;
}

function readTextIfPresent(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim() || null;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function parseBooleanFlag(value) {
  if (value === undefined || value === "") {
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`OPENCLAW_GATEWAY_RUNTIME_SNAPSHOT has invalid boolean value: ${value}`);
}

export function resolveGatewayRuntimeSnapshotPromotionPolicy(env = process.env) {
  const configured = parseBooleanFlag(env.OPENCLAW_GATEWAY_RUNTIME_SNAPSHOT);
  if (configured === false) {
    return { enabled: false, reason: "disabled" };
  }
  if (env.CI && configured !== true) {
    return { enabled: false, reason: "ci" };
  }
  return { enabled: true };
}

function hashArtifactTree(rootDir, relativePaths) {
  const hash = createHash("sha256");
  const visit = (absolutePath, relativePath) => {
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      hash.update(`L\0${relativePath}\0${fs.readlinkSync(absolutePath)}\0`);
      return;
    }
    if (stat.isDirectory()) {
      hash.update(`D\0${relativePath}\0`);
      for (const entry of fs.readdirSync(absolutePath).toSorted((a, b) => a.localeCompare(b))) {
        visit(path.join(absolutePath, entry), path.join(relativePath, entry));
      }
      return;
    }
    if (!stat.isFile()) {
      throw new Error(`Unsupported runtime snapshot artifact: ${absolutePath}`);
    }
    hash.update(`F\0${relativePath}\0${stat.size}\0`);
    hash.update(fs.readFileSync(absolutePath));
    hash.update("\0");
  };
  for (const relativePath of [...relativePaths].toSorted((a, b) => a.localeCompare(b))) {
    visit(path.join(rootDir, relativePath), relativePath);
  }
  return hash.digest("hex");
}

function compactTimestamp(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid build timestamp: ${String(value)}`);
  }
  return parsed.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".000", "");
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function requireRuntimeArtifacts(rootDir) {
  const required = [
    "dist/index.js",
    "dist/entry.js",
    "dist/control-ui/index.html",
    "dist-runtime/extensions",
    "dist/build-info.json",
    "package.json",
  ];
  for (const relativePath of required) {
    if (!fs.existsSync(path.join(rootDir, relativePath))) {
      throw new Error(
        `Gateway runtime snapshot promotion requires ${relativePath}; run the full build first.`,
      );
    }
  }
}

export function promoteGatewayRuntimeSnapshot(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? defaultRootDir);
  const env = options.env ?? process.env;
  const policy = resolveGatewayRuntimeSnapshotPromotionPolicy(env);
  if (!policy.enabled) {
    return { promoted: false, reason: policy.reason };
  }
  requireRuntimeArtifacts(rootDir);

  const buildInfo = readJson(path.join(rootDir, "dist", "build-info.json"));
  const packageJson = readJson(path.join(rootDir, "package.json"));
  const builtAt = typeof buildInfo.builtAt === "string" ? buildInfo.builtAt : null;
  const packageVersion =
    typeof buildInfo.version === "string"
      ? buildInfo.version
      : typeof packageJson.version === "string"
        ? packageJson.version
        : null;
  const sourceCommit = typeof buildInfo.commit === "string" ? buildInfo.commit : null;
  if (!builtAt || !packageVersion) {
    throw new Error("Gateway runtime snapshot promotion requires complete dist/build-info.json.");
  }

  const snapshotDir = path.join(rootDir, SNAPSHOT_RELATIVE_DIR);
  const releasesDir = path.join(snapshotDir, "releases");
  fs.mkdirSync(releasesDir, { recursive: true, mode: 0o700 });
  const temporaryRoot = fs.mkdtempSync(path.join(releasesDir, ".promoting-"));
  try {
    fs.cpSync(path.join(rootDir, "dist"), path.join(temporaryRoot, "dist"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    fs.cpSync(path.join(rootDir, "dist-runtime"), path.join(temporaryRoot, "dist-runtime"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    fs.copyFileSync(path.join(rootDir, "package.json"), path.join(temporaryRoot, "package.json"));
    const artifactPaths = ["dist", "dist-runtime", "package.json"];
    const artifactHash = hashArtifactTree(temporaryRoot, artifactPaths);
    const releaseId = `${compactTimestamp(builtAt)}-${artifactHash.slice(0, 12)}`;
    const releaseRoot = path.join(releasesDir, releaseId);
    const manifest = {
      version: SNAPSHOT_VERSION,
      releaseId,
      root: releaseRoot,
      createdAt: builtAt,
      packageVersion,
      artifactHash,
      source: {
        root: rootDir,
        commit: sourceCommit,
        buildStamp: readTextIfPresent(path.join(rootDir, "dist", ".buildstamp")),
        runtimePostbuildStamp: readTextIfPresent(
          path.join(rootDir, "dist", ".runtime-postbuildstamp"),
        ),
      },
      schemas: {
        runtimeSnapshot: SNAPSHOT_VERSION,
        selfImprovementLedger: 1,
        selfImprovementRecommendationStore: 3,
        selfImprovementSignal: 1,
      },
      paths: {
        entrypoint: path.join(releaseRoot, "dist", "index.js"),
        controlUi: path.join(releaseRoot, "dist", "control-ui"),
        bundledPlugins: path.join(releaseRoot, "dist-runtime", "extensions"),
      },
    };
    writeJsonAtomic(path.join(temporaryRoot, "snapshot.json"), manifest);

    if (fs.existsSync(releaseRoot)) {
      const existing = readJson(path.join(releaseRoot, "snapshot.json"));
      if (existing.artifactHash !== artifactHash || existing.packageVersion !== packageVersion) {
        throw new Error(`Refusing to overwrite mismatched immutable runtime release ${releaseId}.`);
      }
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    } else {
      fs.renameSync(temporaryRoot, releaseRoot);
    }
    writeJsonAtomic(path.join(snapshotDir, "latest.json"), manifest);
    return { promoted: true, releaseId, releaseRoot, artifactHash, manifest };
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isMainModule()) {
  try {
    const result = promoteGatewayRuntimeSnapshot();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
