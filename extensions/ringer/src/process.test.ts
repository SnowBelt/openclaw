import { describe, expect, it } from "vitest";
import { runCommand } from "./process.js";

describe("Local AI Assist process confinement", () => {
  it("terminates a command that exceeds its bounded timeout", async () => {
    const started = Date.now();
    const result = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
      timeoutMs: 50,
    });
    expect(result.code).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
