// Narrow PCC doctor tests keep state migration isolated from unrelated doctor repairs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPccDoctor } from "./doctor-pcc.js";

const mocks = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(),
  runDoctorHealthRepairs: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  readConfigFileSnapshot: mocks.readConfigFileSnapshot,
}));

vi.mock("../flows/doctor-repair-flow.js", () => ({
  runDoctorHealthRepairs: mocks.runDoctorHealthRepairs,
}));

const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };

describe("runPccDoctor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfigFileSnapshot.mockResolvedValue({
      config: {},
      path: "/tmp/openclaw.json",
    });
  });

  it("checks only PCC ledger and proof-binding health checks", async () => {
    const report = await runPccDoctor({ mode: "check", runtime });

    expect(report.checksRun).toBe(2);
    expect(report.findings.every((finding) => finding.checkId.startsWith("core/doctor/pcc-"))).toBe(
      true,
    );
    expect(mocks.runDoctorHealthRepairs).not.toHaveBeenCalled();
  });

  it("repairs only PCC ledger and proof-binding health checks", async () => {
    mocks.runDoctorHealthRepairs.mockResolvedValue({
      checksRun: 2,
      findings: [],
      remainingFindings: [],
      changes: ["Migrated PCC ledger"],
      warnings: [],
    });

    const report = await runPccDoctor({ mode: "fix", runtime });

    expect(report).toMatchObject({ ok: true, repaired: true, checksRun: 2 });
    expect(mocks.runDoctorHealthRepairs).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "fix" }),
      {
        checks: expect.arrayContaining([
          expect.objectContaining({ id: "core/doctor/pcc-ledger-storage" }),
          expect.objectContaining({ id: "core/doctor/pcc-production-truth-bindings" }),
        ]),
      },
    );
  });
});
