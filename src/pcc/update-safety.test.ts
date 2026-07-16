import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPccUpdateSafety } from "./update-safety.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("PCC update safety", () => {
  it("reports a protected durable runtime and pending approval", () => {
    const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-safety-"));
    temporaryDirectories.push(homedir);
    const runtimeHome = path.join(homedir, ".openclaw-custom-runtime");
    const runtimeRoot = path.join(homedir, ".openclaw-runtime-releases", "release-1");
    const sourceRepo = path.join(homedir, "source");
    const pointerPath = path.join(runtimeHome, "active-runtime.json");
    fs.mkdirSync(path.join(runtimeHome, "bin"), { recursive: true });
    fs.mkdirSync(path.join(runtimeHome, "receipts"), { recursive: true });
    fs.mkdirSync(path.join(homedir, "Library", "LaunchAgents"), { recursive: true });
    fs.writeFileSync(path.join(runtimeHome, "bin", "custom-runtime-updater.sh"), "");
    fs.writeFileSync(path.join(runtimeHome, "bin", "custom-runtime-update-approve.sh"), "");
    fs.writeFileSync(
      path.join(
        homedir,
        "Library",
        "LaunchAgents",
        "ai.openclaw.custom-runtime.update-weekly.plist",
      ),
      "",
    );
    fs.writeFileSync(
      pointerPath,
      `${JSON.stringify({
        releaseId: "release-1",
        runtimeRoot,
        entrypoint: path.join(runtimeRoot, "dist", "index.js"),
        sourceSha: "a".repeat(40),
        sourceRepo,
        sourceBranch: "codex/custom-runtime",
      })}\n`,
    );
    fs.writeFileSync(
      path.join(runtimeHome, "pending-update.json"),
      '{"result":"ready_for_approval"}\n',
    );
    fs.writeFileSync(
      path.join(runtimeHome, "receipts", "update-20260715T000000Z.json"),
      '{"at":"20260715T000000Z","result":"ready_for_approval"}\n',
    );

    expect(
      readPccUpdateSafety({
        homedir,
        runtimeHome,
        pointerPath,
        argv: ["node", path.join(runtimeRoot, "dist", "index.js")],
        env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: runtimeRoot },
      }),
    ).toEqual({
      status: "protected",
      standardUpdateBlocked: true,
      sourceDurable: true,
      brokerConfigured: true,
      approvalPending: true,
      sourceSha: "a".repeat(40),
      sourceBranch: "codex/custom-runtime",
      activeRelease: "release-1",
      lastReceipt: {
        at: "20260715T000000Z",
        result: "ready_for_approval",
        stage: null,
      },
      issues: [],
    });
  });
});
