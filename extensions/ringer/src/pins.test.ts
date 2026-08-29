import { describe, expect, it } from "vitest";
import { computePolicyDigest, renderPinnedRingerConfig } from "./pins.js";
import type { ResolvedRingerConfig } from "./types.js";

describe("Local AI Assist pin contracts", () => {
  it("renders a canonical no-update, no-full-access local engine", () => {
    const source = renderPinnedRingerConfig({ stateDir: "/private/state" });
    expect(source).toContain("allow_full_access = false");
    expect(source).toContain("[update]\nauto = false");
    expect(source).toContain("[engines.openclaw-local]");
    expect(source).toContain('"{taskdir}"');
    expect(source).toContain('"{engine_args}"');
    expect(source).toContain("sandbox_args = []");
    expect(source).toContain("full_access_args = []");
  });

  it("binds policy fields while excluding only the expected digest itself", () => {
    const config = {
      enabled: true,
      productionEnabled: false,
      expectedPolicySha256: "a".repeat(64),
      stateDir: "/state",
      allowedRepositories: [],
    } as unknown as ResolvedRingerConfig;
    const first = computePolicyDigest(config);
    expect(computePolicyDigest({ ...config, expectedPolicySha256: "b".repeat(64) })).toBe(first);
    expect(computePolicyDigest({ ...config, productionEnabled: true })).not.toBe(first);
  });
});
