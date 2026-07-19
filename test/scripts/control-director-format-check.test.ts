import { describe, expect, it } from "vitest";
import {
  readControlDirectorBaselineSha,
  selectControlDirectorFormatPaths,
} from "../../scripts/control-director-format-check.mjs";

describe("Control Director scoped format check", () => {
  it("reads only an immutable roadmap baseline", () => {
    expect(readControlDirectorBaselineSha({ baseline: { sourceSha: "A".repeat(40) } })).toBe(
      "a".repeat(40),
    );
    expect(() => readControlDirectorBaselineSha({ baseline: { sourceSha: "main" } })).toThrow(
      "immutable 40-character SHA",
    );
  });

  it("selects deterministic changed source paths without artifact receipts", () => {
    expect(
      selectControlDirectorFormatPaths(
        "src/z.ts\n.artifacts/control-director/gate.json\nsrc/a.ts\n\n",
      ),
    ).toEqual(["src/a.ts", "src/z.ts"]);
  });
});
