import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const guard = fs.readFileSync(
  path.resolve("scripts/custom-runtime/custom-runtime-guard.sh"),
  "utf8",
);

describe("custom runtime guard verification cache", () => {
  it("keeps the cheap process check and binds the full proof to all runtime identities", () => {
    expect(guard).toContain("full_verification_ttl=900");
    expect(guard).toContain("openclaw.custom-runtime-guard-verification.v1");
    expect(guard).toContain("pointerSha256");
    expect(guard).toContain("launcherSha256");
    expect(guard).toContain("plistSha256");
    expect(guard).toContain('pgrep -f "$runtime_root/dist/index.js gateway"');
    expect(guard).toContain('"$launcher" --verify');
    expect(guard).toContain("os.lstat(path)");
    expect(guard).toContain("os.replace(temporary, target)");
  });
});
