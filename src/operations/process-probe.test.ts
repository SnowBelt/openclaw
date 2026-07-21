import { describe, expect, it } from "vitest";
import { parseOperationsProcessTable, parseOperationsProcessTableResult } from "./process-probe.js";

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

  it("reports the exact total before the display cap", () => {
    const raw = Array.from(
      { length: 35 },
      (_, index) => `${index + 1} 1 ${index + 1} 0.1 /usr/bin/process-${index + 1}`,
    ).join("\n");
    const result = parseOperationsProcessTableResult(raw, { gatewayPid: 1_000 });

    expect(result.total).toBe(35);
    expect(result.processes).toHaveLength(30);
    expect(result.rejectedRows).toBe(0);
    expect(result.status).toBe("available");
  });

  it("does not label unrelated Node processes as the Gateway", () => {
    const rows = parseOperationsProcessTable(
      "42 1 204800 3.2 /opt/homebrew/bin/node\n88 1 102400 0.2 /opt/homebrew/bin/node\n",
      { gatewayPid: 42 },
    );

    expect(rows.find((row) => row.pid === 42)?.kind).toBe("gateway");
    expect(rows.find((row) => row.pid === 88)?.kind).toBe("other");
  });

  it("never classifies a home path substring as the Gateway", () => {
    const rows = parseOperationsProcessTable(
      "77 1 1024 0.1 /Users/openclaw/OpenClaw/.venv/bin/python\n",
      { gatewayPid: 42 },
    );

    expect(rows[0]).toMatchObject({ command: "python", kind: "other" });
  });

  it("does not infer Gateway ownership from an executable name", () => {
    const rows = parseOperationsProcessTable("77 1 1024 0.1 /usr/local/bin/openclaw-agent\n", {
      gatewayPid: 42,
    });

    expect(rows[0]).toMatchObject({ command: "openclaw-agent", kind: "other" });
  });

  it("marks mixed process output partial and counts rejected rows", () => {
    expect(
      parseOperationsProcessTableResult("42 1 1024 0.1 /opt/homebrew/bin/node\nmalformed row\n", {
        gatewayPid: 42,
      }),
    ).toMatchObject({ total: 1, rejectedRows: 1, status: "partial" });
  });

  it("fails closed when process output is empty", () => {
    expect(parseOperationsProcessTableResult("\n\t\n")).toEqual({
      processes: [],
      total: 0,
      rejectedRows: 0,
      status: "unavailable",
    });
  });

  it("fails closed when non-empty process output is entirely malformed", () => {
    expect(parseOperationsProcessTableResult("PID PPID RSS CPU COMMAND\nmalformed row")).toEqual({
      processes: [],
      total: 0,
      rejectedRows: 2,
      status: "unavailable",
    });
  });
});
