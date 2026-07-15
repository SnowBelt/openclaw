import { describe, expect, it } from "vitest";
import {
  appendControlUiTokenFragment,
  redactControlUiSmokeSecrets,
} from "../../scripts/dev/control-ui-smoke-url.ts";

describe("control UI smoke URL helpers", () => {
  it("places the gateway token in the URL fragment and preserves the route", () => {
    expect(
      appendControlUiTokenFragment("http://127.0.0.1:18789/self-improvement", "smoke token"),
    ).toBe("http://127.0.0.1:18789/self-improvement#token=smoke+token");
  });

  it("replaces a stale fragment token instead of appending another credential", () => {
    expect(
      appendControlUiTokenFragment("http://127.0.0.1:18789/#view=health&token=stale", "fresh"),
    ).toBe("http://127.0.0.1:18789/#view=health&token=fresh");
  });

  it("redacts both query and fragment credentials from smoke diagnostics", () => {
    const redacted = redactControlUiSmokeSecrets(
      "http://127.0.0.1:18789/?token=query-secret#token=fragment-secret",
    );
    expect(redacted).not.toContain("query-secret");
    expect(redacted).not.toContain("fragment-secret");
    expect(redacted).toContain("#token=***");
  });
});
