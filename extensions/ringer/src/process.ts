import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";
import path from "node:path";

export const SAFE_EXEC_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].join(
  path.delimiter,
);

export type CommandResult = {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
};

export async function runCommand(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio & { input?: Buffer | string; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const { input, timeoutMs = 60_000, ...spawnOptions } = options;
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      ...spawnOptions,
      detached: spawnOptions.detached ?? process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    let forceTimer: NodeJS.Timeout | undefined;
    const clearTimers = () => {
      clearTimeout(timer);
      if (forceTimer) {
        clearTimeout(forceTimer);
      }
    };
    const killProcessGroup = (signal: NodeJS.Signals) => {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {}
      }
      child.kill(signal);
    };
    const timer = setTimeout(() => {
      killProcessGroup("SIGTERM");
      forceTimer = setTimeout(() => killProcessGroup("SIGKILL"), 2_000);
      forceTimer.unref();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimers();
      reject(error);
    });
    child.once("close", (code) => {
      clearTimers();
      resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

export function commandFailure(command: string, args: string[], result: CommandResult): Error {
  const detail = Buffer.concat([result.stdout, result.stderr]).toString("utf8").trim();
  return new Error(
    `${command} ${args.join(" ")} failed with exit ${String(result.code)}${detail ? `: ${detail}` : ""}`,
  );
}
