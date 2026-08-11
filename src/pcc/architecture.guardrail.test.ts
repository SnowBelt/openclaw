import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

function sourceFiles(relativeDirectory: string): string[] {
  return readdirSync(resolve(REPO_ROOT, relativeDirectory), { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"),
    )
    .map((entry) => `${relativeDirectory}/${entry.name}`)
    .toSorted();
}

function importSpecifiers(relativePath: string): string[] {
  const source = readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/gu)].map(
    (match) => match[1] ?? match[2] ?? "",
  );
}

function expectNoImport(relativePaths: readonly string[], forbidden: readonly RegExp[]): void {
  for (const relativePath of relativePaths) {
    for (const specifier of importSpecifiers(relativePath)) {
      for (const pattern of forbidden) {
        expect(`${relativePath} -> ${specifier}`).not.toMatch(pattern);
      }
    }
  }
}

describe("PCC clean architecture boundaries", () => {
  it("keeps domain policy independent from storage, read models, Gateway, and UI", () => {
    expectNoImport(sourceFiles("src/pcc/domain"), [
      /ledger-store/u,
      /read-model/u,
      /src\/gateway\//u,
      /server-methods/u,
      /ui\//u,
    ]);
  });

  it("keeps read models independent from storage, Gateway, and UI", () => {
    expectNoImport(sourceFiles("src/pcc/read-model"), [
      /ledger-store/u,
      /src\/gateway\//u,
      /server-methods/u,
      /ui\//u,
    ]);
  });

  it("keeps UI application and presentation modules independent from controllers and views", () => {
    expectNoImport(
      [...sourceFiles("ui/src/ui/pcc/application"), ...sourceFiles("ui/src/ui/pcc/presentation")],
      [/controllers\//u, /views\//u, /(?:^|\/)gateway\.ts$/u],
    );
  });

  it("keeps the PCC view on narrow application modules instead of the controller facade", () => {
    expect(importSpecifiers("ui/src/ui/views/pcc.ts")).not.toContain("../controllers/pcc.ts");
  });
});
