import { spawnSync } from "node:child_process";
import { normalizeText } from "./shared.mjs";

export function defaultRunCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function executeCommand(commandRunner, command, args, cwd) {
  const result = commandRunner(command, args, cwd);
  if (!result || typeof result.status !== "number") {
    throw new Error(`${command} runner returned an invalid result.`);
  }
  return {
    status: result.status,
    stdout: normalizeText(result.stdout),
    stderr: normalizeText(result.stderr),
  };
}

export function commandLabel(command, args) {
  return [command, ...args].join(" ");
}
