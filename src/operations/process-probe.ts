// Bounded host process probe. It intentionally returns only command names and
// resource counters; command arguments are discarded to avoid leaking secrets.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { OperationsProcessSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);
const PROCESS_LIMIT = 30;
const LOCAL_MODEL_EXECUTABLES = new Set([
  "ollama",
  "llama-server",
  "lm studio",
  "vllm",
  "vllm serve",
]);
const BROWSER_EXECUTABLES = new Set(["google chrome", "safari"]);

export type OperationsProcessCollectionResult = {
  processes: OperationsProcessSnapshot[];
  total: number;
  rejectedRows: number;
  status: "available" | "partial" | "unavailable";
};

function executableName(raw: string): string {
  const trimmed = raw.trim();
  const appExecutable = trimmed.match(/\/Contents\/MacOS\/(.+?)(?:\s+--[^\s]|$)/)?.[1];
  if (appExecutable) {
    return appExecutable.trim();
  }
  const executablePath = trimmed.split(/\s+/, 1)[0] ?? "unknown";
  return path.basename(executablePath) || "unknown";
}

function classifyProcess(params: {
  command: string;
  pid: number;
  gatewayPid: number;
}): OperationsProcessSnapshot["kind"] {
  if (params.pid === params.gatewayPid) {
    return "gateway";
  }
  const normalized = executableName(params.command).toLowerCase();
  if (LOCAL_MODEL_EXECUTABLES.has(normalized) || normalized.startsWith("llama-server")) {
    return "local_model";
  }
  if (
    BROWSER_EXECUTABLES.has(normalized) ||
    normalized.startsWith("google chrome helper") ||
    normalized.startsWith("safari web content")
  ) {
    return "browser";
  }
  return "other";
}

export function parseOperationsProcessTableResult(
  raw: string,
  opts?: { gatewayPid?: number },
): OperationsProcessCollectionResult {
  const gatewayPid = opts?.gatewayPid ?? process.pid;
  const rows: OperationsProcessSnapshot[] = [];
  const lines = raw.split(/\r?\n/);
  const nonblankLineCount = lines.filter((line) => line.trim().length > 0).length;
  for (const line of lines) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
    if (!match) {
      continue;
    }
    const [, pidRaw, parentPidRaw, rssKbRaw, cpuRaw, commandRaw] = match;
    const pid = Number(pidRaw);
    const parentPid = Number(parentPidRaw);
    const rssKb = Number(rssKbRaw);
    const cpuPercent = Number(cpuRaw);
    if (![pid, parentPid, rssKb, cpuPercent].every(Number.isFinite)) {
      continue;
    }
    const command = executableName(commandRaw);
    rows.push({
      pid,
      parentPid,
      command,
      rssBytes: Math.max(0, Math.round(rssKb * 1024)),
      cpuPercent: Math.max(0, cpuPercent),
      kind: classifyProcess({ command: commandRaw, pid, gatewayPid }),
    });
  }
  const sorted = rows.toSorted(
    (left, right) => right.rssBytes - left.rssBytes || left.pid - right.pid,
  );
  const rejectedRows = Math.max(0, nonblankLineCount - sorted.length);
  return {
    processes: sorted.slice(0, PROCESS_LIMIT),
    total: sorted.length,
    rejectedRows,
    status:
      nonblankLineCount === 0 || sorted.length === 0
        ? "unavailable"
        : rejectedRows > 0
          ? "partial"
          : "available",
  };
}

export function parseOperationsProcessTable(
  raw: string,
  opts?: { gatewayPid?: number },
): OperationsProcessSnapshot[] {
  return parseOperationsProcessTableResult(raw, opts).processes;
}

export async function collectOperationsProcessesResult(): Promise<OperationsProcessCollectionResult> {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,rss=,pcpu=,comm="], {
      timeout: 2_000,
      maxBuffer: 512 * 1024,
    });
    return parseOperationsProcessTableResult(stdout);
  } catch {
    return { processes: [], total: 0, rejectedRows: 0, status: "unavailable" };
  }
}

export async function collectOperationsProcesses(): Promise<OperationsProcessSnapshot[]> {
  return (await collectOperationsProcessesResult()).processes;
}
