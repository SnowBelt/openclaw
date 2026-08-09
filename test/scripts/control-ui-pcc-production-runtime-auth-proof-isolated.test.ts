import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const proofScript = path.resolve(
  "scripts/dev/control-ui-pcc-production-runtime-auth-proof-isolated.ts",
);
const source = readFileSync(proofScript, "utf8");

describe("isolated PCC candidate browser proof", () => {
  it("starts the Gateway and child proof from the sealed runtime", () => {
    expect(source).toContain("cwd: runtimeRoot");
    expect(source).toContain('const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");');
    expect(source).toContain('spawn("node", ["--import", TSX_LOADER, params.scriptPath]');
    expect(source).toContain('TSX_TSCONFIG_PATH: path.join(repoRoot, "tsconfig.json")');
    expect(source).toContain(
      'scriptPath: path.join(\n        repoRoot,\n        "scripts/dev/control-ui-pcc-production-runtime-auth-proof.ts",',
    );
  });
});
