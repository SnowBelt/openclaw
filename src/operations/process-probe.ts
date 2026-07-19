// Bounded host process probe. It intentionally returns only command names and
// resource counters; command arguments are discarded to avoid leaking secrets.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OperationsProcessSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);
const PROCESS_LIMIT = 30;

function classifyProcess(params: {
  command: string;
  pid: number;
  gatewayPid: number;
}): OperationsProcessSnapshot["kind"] {
  if (params.pid === params.gatewayPid) {
    return "gateway";
  }
  const command = params.command;
  const normalized = command.toLowerCase();
  if (normalized.includes("openclaw")) {
    return "gateway";
  }
  if (
    normalized.includes("ollama") ||
    normalized.includes("llama") ||
    normalized.includes("lm studio") ||
    normalized.includes("vllm")
  ) {
    return "local_model";
  }
  if (normalized.includes("chrome") || normalized.includes("safari")) {
    return "browser";
  }
  return "other";
}

export function parseOperationsProcessTable(
  raw: string,
  opts?: { gatewayPid?: number },
): OperationsProcessSnapshot[] {
  const gatewayPid = opts?.gatewayPid ?? process.pid;
  const rows: OperationsProcessSnapshot[] = [];
  for (const line of raw.split(/\r?\n/)) {
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
    const command = commandRaw.trim().split(/\s+/)[0] ?? "unknown";
    rows.push({
      pid,
      parentPid,
      command,
      rssBytes: Math.max(0, Math.round(rssKb * 1024)),
      cpuPercent: Math.max(0, cpuPercent),
      kind: classifyProcess({ command: commandRaw, pid, gatewayPid }),
    });
  }
  return rows
    .toSorted((left, right) => right.rssBytes - left.rssBytes || left.pid - right.pid)
    .slice(0, PROCESS_LIMIT);
}

export async function collectOperationsProcesses(): Promise<OperationsProcessSnapshot[]> {
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,rss=,pcpu=,comm="], {
      timeout: 2_000,
      maxBuffer: 512 * 1024,
    });
    return parseOperationsProcessTable(stdout);
  } catch {
    return [];
  }
}
