import { describe, expect, it } from "vitest";
import { parseOperationsProcessTable } from "./process-probe.js";

describe("Operations Room process probe", () => {
  it("sorts by RSS, classifies processes, and drops command arguments", () => {
    const rows = parseOperationsProcessTable(
      `
        12 1 2048 2.5 /usr/local/bin/ollama runner --secret token-value
        11 1 1024 1.2 /opt/homebrew/bin/node /private/app/dist/index.js --token hidden
        13 1 512 0.4 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --profile x
        malformed
      `,
      { gatewayPid: 11 },
    );

    expect(rows.map((row) => row.kind)).toEqual(["local_model", "gateway", "browser"]);
    expect(rows[0]).toMatchObject({ pid: 12, rssBytes: 2_097_152 });
    expect(rows.map((row) => row.command).join(" ")).not.toContain("secret");
    expect(rows.map((row) => row.command).join(" ")).not.toContain("token-value");
  });

  it("does not label unrelated Node processes as the Gateway", () => {
    const rows = parseOperationsProcessTable(
      "42 1 204800 3.2 /opt/homebrew/bin/node\n88 1 102400 0.2 /opt/homebrew/bin/node\n",
      { gatewayPid: 42 },
    );

    expect(rows.find((row) => row.pid === 42)?.kind).toBe("gateway");
    expect(rows.find((row) => row.pid === 88)?.kind).toBe("other");
  });
});
