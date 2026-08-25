import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyWorkspaceTemplateAssets,
  WORKSPACE_RUNTIME_TEMPLATE_NAMES,
} from "../../scripts/lib/workspace-template-assets.mjs";

const tempRoots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-workspace-assets-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("copyWorkspaceTemplateAssets", () => {
  it("copies the required templates into the built runtime tree", () => {
    const root = makeRoot();
    const sourceDir = path.join(root, "docs", "reference", "templates");
    fs.mkdirSync(sourceDir, { recursive: true });
    for (const name of WORKSPACE_RUNTIME_TEMPLATE_NAMES) {
      fs.writeFileSync(path.join(sourceDir, name), `# ${name}\n`);
    }

    const outputs = copyWorkspaceTemplateAssets({ rootDir: root });

    expect(outputs).toHaveLength(WORKSPACE_RUNTIME_TEMPLATE_NAMES.length);
    for (const name of WORKSPACE_RUNTIME_TEMPLATE_NAMES) {
      expect(fs.readFileSync(path.join(root, "dist", "templates", name), "utf8")).toBe(
        `# ${name}\n`,
      );
    }
  });

  it("prefers runtime templates when a source checkout supplies both forms", () => {
    const root = makeRoot();
    const runtimeDir = path.join(root, "src", "agents", "templates");
    const docsDir = path.join(root, "docs", "reference", "templates");
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(docsDir, { recursive: true });
    for (const name of WORKSPACE_RUNTIME_TEMPLATE_NAMES) {
      fs.writeFileSync(path.join(docsDir, name), `# docs ${name}\n`);
    }
    fs.writeFileSync(path.join(runtimeDir, "HEARTBEAT.md"), "# runtime heartbeat\n");

    copyWorkspaceTemplateAssets({ rootDir: root });

    expect(fs.readFileSync(path.join(root, "dist", "templates", "HEARTBEAT.md"), "utf8")).toBe(
      "# runtime heartbeat\n",
    );
    expect(fs.readFileSync(path.join(root, "dist", "templates", "AGENTS.md"), "utf8")).toBe(
      "# docs AGENTS.md\n",
    );
  });
});
