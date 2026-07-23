import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { readPccUpdateSafety } from "./update-safety.js";

const temporaryDirectories = useAutoCleanupTempDirTracker(afterEach);

describe("PCC update safety", () => {
  it("reports a protected durable runtime and pending approval", () => {
    const homedir = temporaryDirectories.make("openclaw-update-safety-");
    const runtimeHome = path.join(homedir, ".openclaw-custom-runtime");
    const runtimeRoot = path.join(homedir, ".openclaw-runtime-releases", "release-1");
    const sourceRepo = path.join(homedir, "source");
    const pointerPath = path.join(runtimeHome, "active-runtime.json");
    fs.mkdirSync(path.join(runtimeHome, "bin"), { recursive: true });
    fs.mkdirSync(sourceRepo);
    expect(spawnSync("git", ["init", "-q", sourceRepo]).status).toBe(0);
    expect(
      spawnSync("git", ["-C", sourceRepo, "config", "user.email", "test@example.invalid"]).status,
    ).toBe(0);
    expect(spawnSync("git", ["-C", sourceRepo, "config", "user.name", "Test"]).status).toBe(0);
    fs.writeFileSync(path.join(sourceRepo, "source.txt"), "source\n");
    expect(spawnSync("git", ["-C", sourceRepo, "add", "source.txt"]).status).toBe(0);
    expect(spawnSync("git", ["-C", sourceRepo, "commit", "-qm", "source"]).status).toBe(0);
    const sourceSha = spawnSync("git", ["-C", sourceRepo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).stdout.trim();
    const sourceBranch = spawnSync("git", ["-C", sourceRepo, "branch", "--show-current"], {
      encoding: "utf8",
    }).stdout.trim();
    const sourceGitCommonDir = path.join(sourceRepo, ".git");
    fs.mkdirSync(path.join(runtimeHome, "receipts"), { recursive: true });
    fs.mkdirSync(path.join(homedir, "Library", "LaunchAgents"), { recursive: true });
    fs.writeFileSync(path.join(runtimeHome, "bin", "custom-runtime-updater.sh"), "#!/bin/sh\n", {
      mode: 0o700,
    });
    fs.writeFileSync(
      path.join(runtimeHome, "bin", "custom-runtime-update-approve.sh"),
      "#!/bin/sh\n",
      { mode: 0o700 },
    );
    const launchAgentPath = path.join(
      homedir,
      "Library",
      "LaunchAgents",
      "ai.openclaw.custom-runtime.update-weekly.plist",
    );
    fs.writeFileSync(
      launchAgentPath,
      `<?xml version="1.0"?>
<plist version="1.0"><dict>
<key>Label</key><string>ai.openclaw.custom-runtime.update-weekly</string>
<key>ProgramArguments</key><array><string>${path.join(runtimeHome, "bin", "custom-runtime-updater.sh")}</string></array>
<key>RunAtLoad</key><false/>
<key>StartCalendarInterval</key><dict>
<key>Weekday</key><integer>0</integer>
<key>Hour</key><integer>3</integer>
<key>Minute</key><integer>30</integer>
</dict>
<key>StandardOutPath</key><string>${path.join(homedir, "Library", "Logs", "openclaw", "custom-runtime-update.log")}</string>
<key>StandardErrorPath</key><string>${path.join(homedir, "Library", "Logs", "openclaw", "custom-runtime-update-error.log")}</string>
</dict></plist>
`,
    );
    fs.writeFileSync(
      pointerPath,
      `${JSON.stringify({
        releaseId: "release-1",
        runtimeRoot,
        entrypoint: path.join(runtimeRoot, "dist", "index.js"),
        sourceSha,
        sourceRepo,
        sourceGitCommonDir,
        sourceBranch,
        sourceRemoteUrl: "https://github.com/SnowBelt/openclaw.git",
        sourceRemoteRef: `refs/heads/${sourceBranch}`,
        sourceRemoteSha: sourceSha,
        sourceRemoteVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
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

    const options = {
      homedir,
      runtimeHome,
      pointerPath,
      argv: ["node", path.join(runtimeRoot, "dist", "index.js")],
      env: { OPENCLAW_RUNTIME_SNAPSHOT_ROOT: runtimeRoot },
    };
    expect(readPccUpdateSafety(options)).toEqual({
      status: "protected",
      standardUpdateBlocked: true,
      sourceDurable: true,
      brokerConfigured: true,
      approvalPending: true,
      sourceSha,
      sourceBranch,
      activeRelease: "release-1",
      lastReceipt: {
        at: "20260715T000000Z",
        result: "ready_for_approval",
        stage: null,
      },
      issues: [],
    });

    fs.chmodSync(launchAgentPath, 0o622);
    expect(readPccUpdateSafety(options)).toMatchObject({
      status: "attention",
      brokerConfigured: false,
    });
    fs.chmodSync(launchAgentPath, 0o600);

    const launchAgentTarget = `${launchAgentPath}.target`;
    fs.renameSync(launchAgentPath, launchAgentTarget);
    fs.symlinkSync(launchAgentTarget, launchAgentPath);
    expect(readPccUpdateSafety(options)).toMatchObject({
      status: "attention",
      brokerConfigured: false,
    });
    fs.unlinkSync(launchAgentPath);
    fs.renameSync(launchAgentTarget, launchAgentPath);

    fs.writeFileSync(launchAgentPath, '<?xml version="1.0"?><plist></plist>\n');
    expect(readPccUpdateSafety(options)).toMatchObject({
      status: "attention",
      brokerConfigured: false,
      issues: ["The verified custom-runtime update broker is not fully installed."],
    });
  });
});
