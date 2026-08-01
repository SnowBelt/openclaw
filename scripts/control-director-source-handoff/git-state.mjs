import { commandLabel, defaultRunCommand, executeCommand } from "./command.mjs";
import { CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT, redactSensitiveText } from "./shared.mjs";

export function readSourceHandoffGitState({
  repoRoot = CONTROL_DIRECTOR_SOURCE_HANDOFF_REPO_ROOT,
  remoteName = "SnowBelt",
  runCommand: injectedRunCommand,
} = {}) {
  const run = injectedRunCommand ?? defaultRunCommand;
  const errors = [];
  const commands = [];
  const read = (args, field) => {
    commands.push(commandLabel("git", args));
    const result = executeCommand(run, "git", args, repoRoot);
    if (result.status !== 0) {
      errors.push({
        field,
        message: redactSensitiveText(
          result.stderr || result.stdout || `git ${args.join(" ")} failed`,
        ),
      });
      return "";
    }
    return result.stdout;
  };
  return {
    repoRoot: read(["rev-parse", "--show-toplevel"], "repoRoot"),
    headSha: read(["rev-parse", "HEAD"], "headSha").toLowerCase(),
    branch: read(["branch", "--show-current"], "branch"),
    status: read(["status", "--porcelain=v1", "--untracked-files=all"], "status"),
    remoteUrl: read(["remote", "get-url", remoteName], "remoteUrl"),
    errors,
    commands,
  };
}
