import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CustomizationDisposition =
  | "bounded_core_patch"
  | "extract_to_plugin"
  | "generated_contract"
  | "product_app_owned"
  | "plugin_owned"
  | "supporting_proof"
  | "supporting_tooling"
  | "manual_classification_required";

export type CustomizationInventoryEntry = {
  additions: number;
  capabilities: string[];
  category: string;
  deletions: number;
  disposition: CustomizationDisposition;
  owner: string;
  path: string;
};

export type CustomRuntimeCustomizationInventory = {
  baseRef: string;
  capabilityCoverage: {
    changedPathsCovered: number;
    changedPathsTotal: number;
    percent: number;
  };
  changedLines: {
    additions: number;
    deletions: number;
  };
  divergence: {
    ahead: number;
    behind: number;
    equivalentPatches: number;
    nonEquivalentPatches: number;
  };
  headRef: string;
  inventoryHash: string;
  mergeBase: string;
  paths: CustomizationInventoryEntry[];
  schema: "openclaw.custom-runtime-customization-inventory.v1";
  summary: {
    byDisposition: Record<string, number>;
    byOwner: Record<string, number>;
    changedPaths: number;
    manualClassificationRequired: number;
  };
  upstreamRef: string;
};

type BuildInventoryOptions = {
  capabilityManifestPath: string;
  headRef: string;
  repoRoot: string;
  upstreamRef: string;
};

type Ownership = {
  category: string;
  disposition: CustomizationDisposition;
  owner: string;
};

const DASHBOARD_PREFIXES = new Map([
  ["ui/src/ui/views/app-studio", "app-studio"],
  ["ui/src/ui/views/music-studio", "music-studio"],
  ["ui/src/ui/views/snes-studio", "snes-studio"],
  ["ui/src/ui/views/book-writer", "book-writer"],
  ["ui/src/ui/views/kalshi", "kalshi"],
  ["ui/src/ui/views/pattern-lab", "pattern-lab"],
  ["ui/src/ui/controllers/app-studio", "app-studio"],
  ["ui/src/ui/controllers/book-writer", "book-writer"],
  ["ui/src/ui/controllers/kalshi", "kalshi"],
  ["ui/src/ui/controllers/pattern-lab", "pattern-lab"],
  ["ui/src/styles/app-studio", "app-studio"],
  ["ui/src/styles/music-studio", "music-studio"],
  ["ui/src/styles/snes-studio", "snes-studio"],
  ["ui/src/styles/kalshi", "kalshi"],
]);

function runGit(repoRoot: string, args: string[]): string {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function capabilityOwners(rawManifest: string): Map<string, string[]> {
  const raw = JSON.parse(rawManifest) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("capability manifest must be an object");
  }
  const capabilities = (raw as Record<string, unknown>).capabilities;
  if (!Array.isArray(capabilities)) {
    throw new Error("capability manifest entries are missing");
  }
  const owners = new Map<string, string[]>();
  for (const value of capabilities) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("capability manifest entry must be an object");
    }
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !Array.isArray(item.requiredPaths)) {
      throw new Error("capability manifest entry is incomplete");
    }
    for (const requiredPath of item.requiredPaths) {
      if (typeof requiredPath !== "string" || requiredPath.length === 0) {
        throw new Error(`capability ${item.id} has an invalid required path`);
      }
      const list = owners.get(requiredPath) ?? [];
      list.push(item.id);
      owners.set(requiredPath, list);
    }
  }
  return owners;
}

function classify(filePath: string): Ownership {
  if (filePath.includes(".generated.") || filePath.endsWith(".generated.ts")) {
    return {
      category: "generated",
      disposition: "generated_contract",
      owner: "generated-contracts",
    };
  }
  for (const [prefix, dashboard] of DASHBOARD_PREFIXES) {
    if (filePath.startsWith(prefix)) {
      return {
        category: "dashboard",
        disposition: "extract_to_plugin",
        owner: `dashboard:${dashboard}`,
      };
    }
  }
  if (filePath.startsWith("extensions/")) {
    const pluginId = filePath.split("/")[1] || "unknown";
    return {
      category: "plugin",
      disposition: "plugin_owned",
      owner: `plugin:${pluginId}`,
    };
  }
  if (filePath.startsWith("apps/")) {
    const appId = filePath.split("/")[1] || "unknown";
    return {
      category: "product-app",
      disposition: "product_app_owned",
      owner: `app:${appId}`,
    };
  }
  if (
    filePath.startsWith("test/") ||
    filePath.includes(".test.") ||
    filePath.includes(".spec.") ||
    filePath.startsWith("tests/")
  ) {
    return {
      category: "test",
      disposition: "supporting_proof",
      owner: "verification",
    };
  }
  if (
    filePath.startsWith("docs/") ||
    ["CHANGELOG.md", "CONTRIBUTING.md", "README.md", "SECURITY.md"].includes(filePath)
  ) {
    return {
      category: "documentation",
      disposition: "supporting_proof",
      owner: "documentation",
    };
  }
  if (filePath.startsWith(".github/")) {
    return {
      category: "ci",
      disposition: "supporting_proof",
      owner: "release-engineering",
    };
  }
  if (filePath.startsWith("scripts/") || filePath.startsWith(".agents/")) {
    return {
      category: "tooling",
      disposition: "supporting_tooling",
      owner: "developer-tooling",
    };
  }
  if (filePath.startsWith("fixtures/") || filePath.startsWith("qa/")) {
    return {
      category: "test-fixture",
      disposition: "supporting_proof",
      owner: "verification",
    };
  }
  if (filePath.startsWith("work/")) {
    const projectId = filePath.split("/")[2] || "unknown";
    return {
      category: "project-tooling",
      disposition: "supporting_tooling",
      owner: `project:${projectId}`,
    };
  }
  if (filePath.startsWith("src/pcc/")) {
    return {
      category: "core",
      disposition: "bounded_core_patch",
      owner: "core:pcc",
    };
  }
  if (filePath.startsWith("src/operations/") || filePath.includes("operations-room")) {
    return {
      category: "core",
      disposition: "bounded_core_patch",
      owner: "core:operations",
    };
  }
  if (filePath.includes("control-director")) {
    return {
      category: "core",
      disposition: "bounded_core_patch",
      owner: "core:control-director",
    };
  }
  if (filePath.startsWith("ui/")) {
    return {
      category: "core-ui",
      disposition: "bounded_core_patch",
      owner: "core:control-ui",
    };
  }
  if (filePath.startsWith("src/")) {
    return {
      category: "core-runtime",
      disposition: "bounded_core_patch",
      owner: "core:runtime",
    };
  }
  if (filePath.startsWith("packages/")) {
    return {
      category: "core-package",
      disposition: "bounded_core_patch",
      owner: "core:packages",
    };
  }
  if (
    filePath.startsWith("config/") ||
    filePath === ".gitignore" ||
    filePath === "AGENTS.md" ||
    filePath === "package.json" ||
    filePath === "openclaw.mjs" ||
    filePath === "pnpm-workspace.yaml" ||
    filePath === "taxonomy.yaml" ||
    filePath === "tsconfig.json" ||
    filePath === "tsdown.config.ts" ||
    filePath.endsWith("lock.yaml") ||
    filePath.endsWith("shrinkwrap.json")
  ) {
    return {
      category: "repository-contract",
      disposition: "bounded_core_patch",
      owner: "repository-foundation",
    };
  }
  return {
    category: "unclassified",
    disposition: "manual_classification_required",
    owner: "unowned",
  };
}

function countBy(entries: CustomizationInventoryEntry[], key: "disposition" | "owner") {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const value = entry[key];
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function hashInventory(value: Omit<CustomRuntimeCustomizationInventory, "inventoryHash">): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildCustomRuntimeCustomizationInventory(
  options: BuildInventoryOptions,
): CustomRuntimeCustomizationInventory {
  const repoRoot = fs.realpathSync(options.repoRoot);
  const headRef = runGit(repoRoot, ["rev-parse", "--verify", `${options.headRef}^{commit}`]);
  const upstreamRef = runGit(repoRoot, [
    "rev-parse",
    "--verify",
    `${options.upstreamRef}^{commit}`,
  ]);
  const mergeBase = runGit(repoRoot, ["merge-base", upstreamRef, headRef]);
  const manifestPath = path.resolve(options.capabilityManifestPath);
  const relativeManifestPath = path.relative(repoRoot, manifestPath);
  if (relativeManifestPath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeManifestPath)) {
    throw new Error("capability manifest must be inside the repository");
  }
  const capabilities = capabilityOwners(
    runGit(repoRoot, ["show", `${headRef}:${relativeManifestPath.split(path.sep).join("/")}`]),
  );
  const diff = runGit(repoRoot, ["diff", "--no-renames", "--numstat", "-z", mergeBase, headRef]);
  const fields = diff ? diff.split("\0").filter(Boolean) : [];
  const paths = fields
    .map((field) => {
      const [rawAdditions, rawDeletions, ...rawPath] = field.split("\t");
      const filePath = rawPath.join("\t");
      const additions = rawAdditions === "-" ? 0 : Number(rawAdditions);
      const deletions = rawDeletions === "-" ? 0 : Number(rawDeletions);
      if (!filePath || !Number.isSafeInteger(additions) || !Number.isSafeInteger(deletions)) {
        throw new Error(`invalid Git numstat record: ${field}`);
      }
      const ownership = classify(filePath);
      const pathCapabilities = (capabilities.get(filePath) ?? []).toSorted();
      const disposition =
        ownership.disposition === "bounded_core_patch" && pathCapabilities.length === 0
          ? "manual_classification_required"
          : ownership.disposition;
      return {
        additions,
        capabilities: pathCapabilities,
        category: ownership.category,
        deletions,
        disposition,
        owner: ownership.owner,
        path: filePath,
      };
    })
    .toSorted((left, right) => left.path.localeCompare(right.path));

  const [aheadText, behindText] = runGit(repoRoot, [
    "rev-list",
    "--left-right",
    "--count",
    `${headRef}...${upstreamRef}`,
  ]).split(/\s+/u);
  const cherry = runGit(repoRoot, ["cherry", upstreamRef, headRef]);
  const equivalentPatches = cherry
    ? cherry.split("\n").filter((line) => line.startsWith("-")).length
    : 0;
  const nonEquivalentPatches = cherry
    ? cherry.split("\n").filter((line) => line.startsWith("+")).length
    : 0;
  const changedPathsCovered = paths.filter((entry) => entry.capabilities.length > 0).length;
  const base = {
    baseRef: mergeBase,
    capabilityCoverage: {
      changedPathsCovered,
      changedPathsTotal: paths.length,
      percent:
        paths.length === 0 ? 100 : Number(((changedPathsCovered / paths.length) * 100).toFixed(2)),
    },
    changedLines: {
      additions: paths.reduce((sum, entry) => sum + entry.additions, 0),
      deletions: paths.reduce((sum, entry) => sum + entry.deletions, 0),
    },
    divergence: {
      ahead: Number(aheadText),
      behind: Number(behindText),
      equivalentPatches,
      nonEquivalentPatches,
    },
    headRef,
    mergeBase,
    paths,
    schema: "openclaw.custom-runtime-customization-inventory.v1" as const,
    summary: {
      byDisposition: countBy(paths, "disposition"),
      byOwner: countBy(paths, "owner"),
      changedPaths: paths.length,
      manualClassificationRequired: paths.filter(
        (entry) => entry.disposition === "manual_classification_required",
      ).length,
    },
    upstreamRef,
  };
  return { ...base, inventoryHash: hashInventory(base) };
}

function usage(message?: string): never {
  if (message) {
    process.stderr.write(`${message}\n`);
  }
  process.stderr.write(
    "usage: custom-runtime-customization-inventory.ts --upstream-ref REF " +
      "[--head-ref REF] [--manifest PATH] [--repo PATH]\n",
  );
  process.exit(64);
}

function main(): void {
  let repoRoot = process.cwd();
  let headRef = "HEAD";
  let upstreamRef = "";
  let manifestPath = "";
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--repo":
        repoRoot = argv[++index] ?? usage("missing --repo value");
        break;
      case "--head-ref":
        headRef = argv[++index] ?? usage("missing --head-ref value");
        break;
      case "--upstream-ref":
        upstreamRef = argv[++index] ?? usage("missing --upstream-ref value");
        break;
      case "--manifest":
        manifestPath = argv[++index] ?? usage("missing --manifest value");
        break;
      default:
        usage(`unsupported argument: ${argv[index]}`);
    }
  }
  if (!upstreamRef) {
    usage("--upstream-ref is required");
  }
  if (!manifestPath) {
    manifestPath = path.join(repoRoot, "config", "custom-runtime-capabilities.json");
  }
  try {
    const inventory = buildCustomRuntimeCustomizationInventory({
      capabilityManifestPath: manifestPath,
      headRef,
      repoRoot,
      upstreamRef,
    });
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
