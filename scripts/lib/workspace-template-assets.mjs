import fs from "node:fs";
import path from "node:path";

/** Workspace files used by the agent bootstrap path. */
export const WORKSPACE_RUNTIME_TEMPLATE_NAMES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
];

function resolveTemplateSource(rootDir, name, fsImpl) {
  const candidates = [
    path.join(rootDir, "src", "agents", "templates", name),
    path.join(rootDir, "docs", "reference", "templates", name),
  ];
  return candidates.find((candidate) => {
    try {
      return fsImpl.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/** Copies non-secret workspace templates into the built runtime tree. */
export function copyWorkspaceTemplateAssets(params = {}) {
  const rootDir = path.resolve(params.rootDir ?? process.cwd());
  const distDir = path.resolve(params.distDir ?? path.join(rootDir, "dist"));
  const fsImpl = params.fs ?? fs;
  const targetDir = path.join(distDir, "templates");

  fsImpl.mkdirSync(targetDir, { recursive: true });
  for (const name of WORKSPACE_RUNTIME_TEMPLATE_NAMES) {
    const source = resolveTemplateSource(rootDir, name, fsImpl);
    if (!source) {
      throw new Error(`Missing workspace runtime template: ${name}`);
    }
    fsImpl.copyFileSync(source, path.join(targetDir, name));
  }
  return WORKSPACE_RUNTIME_TEMPLATE_NAMES.map((name) => path.join("dist", "templates", name));
}
