import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PCC_ROOT = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = join(PCC_ROOT, "..");

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function importSpecifiers(path: string): string[] {
  return [...source(path).matchAll(/\bfrom\s+["']([^"']+)["']/gu)].map((match) => match[1] ?? "");
}

function expectNoImports(path: string, forbidden: readonly string[]): void {
  const imports = importSpecifiers(path);
  for (const fragment of forbidden) {
    expect(imports, `${relative(UI_ROOT, path)} must not import ${fragment}`).not.toContain(
      fragment,
    );
    expect(
      imports.some((specifier) => specifier.includes(fragment)),
      `${relative(UI_ROOT, path)} must not cross into ${fragment}`,
    ).toBe(false);
  }
}

describe("PCC clean architecture boundaries", () => {
  it("keeps presentation independent from the controller and Gateway adapter", () => {
    expectNoImports(join(UI_ROOT, "views/pcc.ts"), ["controllers/pcc", "infrastructure/"]);
    expectNoImports(join(PCC_ROOT, "presentation/interactions.ts"), [
      "controllers/",
      "views/",
      "application/",
      "infrastructure/",
    ]);
    expectNoImports(join(PCC_ROOT, "presentation/project-selectors.ts"), [
      "controllers/",
      "views/",
      "application/",
      "infrastructure/",
    ]);
    expectNoImports(join(PCC_ROOT, "presentation/dashboard-read-model.ts"), [
      "controllers/",
      "views/",
      "application/",
      "infrastructure/",
    ]);
    expectNoImports(join(PCC_ROOT, "presentation/formatters.ts"), [
      "controllers/",
      "views/",
      "application/",
      "infrastructure/",
    ]);
    expectNoImports(join(PCC_ROOT, "presentation/autopilot-panel.ts"), [
      "controllers/",
      "views/",
      "infrastructure/",
    ]);
  });

  it("keeps application policy independent from UI rendering and infrastructure", () => {
    expectNoImports(join(PCC_ROOT, "application/execution-team.ts"), [
      "controllers/",
      "views/",
      "presentation/",
      "infrastructure/",
    ]);
    expectNoImports(join(PCC_ROOT, "application/detail-cache.ts"), [
      "controllers/",
      "views/",
      "presentation/",
      "infrastructure/",
    ]);
  });

  it("keeps contracts free of concrete controller and view implementations", () => {
    expectNoImports(join(PCC_ROOT, "contracts.ts"), [
      "controllers/",
      "views/",
      "application/",
      "presentation/",
      "infrastructure/",
      "gateway.ts",
    ]);
  });

  it("keeps Gateway payload shaping isolated from application and presentation", () => {
    expectNoImports(join(PCC_ROOT, "infrastructure/gateway-payloads.ts"), [
      "controllers/",
      "views/",
      "application/",
      "presentation/",
    ]);
  });

  it("preserves the legacy controller and view facades", () => {
    const controller = source(join(UI_ROOT, "controllers/pcc.ts"));
    const view = source(join(UI_ROOT, "views/pcc.ts"));
    expect(controller).toContain('from "../pcc/contracts.ts"');
    expect(controller).toContain('from "../pcc/application/execution-team.ts"');
    expect(controller).toContain('from "../pcc/infrastructure/gateway-payloads.ts"');
    expect(view).toContain("export function renderPccDashboard");
    expect(view).toContain('export type { PccDashboardProps } from "../pcc/contracts.ts"');
    expect(view).toContain('from "../pcc/presentation/autopilot-panel.ts"');
  });
});
