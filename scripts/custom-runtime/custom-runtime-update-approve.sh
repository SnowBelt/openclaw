#!/bin/sh
# Promote one fully prepared custom-runtime candidate after explicit operator approval.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
releases_dir=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
pending=${OPENCLAW_CUSTOM_RUNTIME_PENDING_UPDATE:-"$runtime_home/pending-update.json"}
auth_helper=$(dirname "$0")/custom-runtime-auth.sh
[ -f "$auth_helper" ] || { printf '%s\n' 'custom runtime update helper is missing' >&2; exit 64; }
. "$auth_helper"
mkdir -p "$runtime_home/receipts"

usage() {
  printf '%s\n' 'usage: custom-runtime-update-approve.sh --sha EXACT_SHA [--receipt PATH]' >&2
  exit 64
}
receipt=$pending
expected_sha=
while [ $# -gt 0 ]; do
  case "$1" in
    --receipt) receipt=${2:-}; shift 2 ;;
    --sha) expected_sha=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$expected_sha" ] || usage
case "$expected_sha" in
  *[!0-9a-f]*|'') usage ;;
esac
[ "${#expected_sha}" -eq 40 ] || usage
stamp=$(date -u +%Y%m%dT%H%M%SZ)
if ! custom_runtime_update_lock_transition check "$runtime_home/update-preparation.lock" \
  "$runtime_home/receipts" "$stamp" preparation >/dev/null; then
  printf '%s\n' 'verified update preparation is active' >&2
  exit 75
fi
[ -f "$receipt" ] || { printf '%s\n' 'prepared update receipt is missing' >&2; exit 64; }
[ -f "$runtime_home/active-runtime.json" ] || { printf '%s\n' 'active runtime pointer is missing' >&2; exit 64; }

fields=$(python3 - "$receipt" "$runtime_home/active-runtime.json" "$releases_dir" "$runtime_home" "$expected_sha" <<'PY'
import datetime, hashlib, json, os, re, sys
receipt_path, active_path, releases_dir, runtime_home, expected_sha = sys.argv[1:]
with open(receipt_path, encoding="utf-8") as f:
    receipt = json.load(f)
with open(active_path, encoding="utf-8") as f:
    active = json.load(f)
if receipt.get("schema") != "openclaw.custom-runtime-update-candidate.v1":
    raise SystemExit("prepared update receipt schema is invalid")
if receipt.get("result") != "ready_for_approval":
    raise SystemExit("prepared update is not awaiting approval")
release = os.path.realpath(str(receipt.get("release", "")))
root = os.path.realpath(releases_dir)
if not release.startswith(root + os.sep):
    raise SystemExit("prepared update release is outside immutable releases")
source_sha = str(receipt.get("sourceSha", ""))
base_sha = str(receipt.get("baseSha", ""))
if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
    raise SystemExit("prepared update source SHA is invalid")
if source_sha != expected_sha:
    raise SystemExit("prepared update does not match the explicitly approved SHA")
if not re.fullmatch(r"[0-9a-f]{40}", base_sha):
    raise SystemExit("prepared update base SHA is invalid")
if active.get("sourceSha") != base_sha:
    raise SystemExit("prepared update is stale because the active runtime changed")
if receipt.get("verificationResult") != "passed":
    raise SystemExit("prepared update verification result is not passed")
proof_binding = receipt.get("preservationProof")
if not isinstance(proof_binding, dict):
    raise SystemExit("prepared update preservationProof is missing")
proof_path = os.path.realpath(str(proof_binding.get("path", "")))
proof_root = os.path.realpath(os.path.join(runtime_home, "receipts"))
if not proof_path.startswith(proof_root + os.sep) or not os.path.isfile(proof_path):
    raise SystemExit("prepared update preservation proof is outside runtime receipts")
proof_sha = str(proof_binding.get("sha256", "")).lower()
if not re.fullmatch(r"[0-9a-f]{64}", proof_sha):
    raise SystemExit("prepared update preservation proof digest is invalid")
with open(proof_path, "rb") as f:
    actual_proof_sha = hashlib.sha256(f.read()).hexdigest()
if actual_proof_sha != proof_sha:
    raise SystemExit("prepared update preservation proof digest changed after verification")
with open(proof_path, encoding="utf-8") as f:
    proof = json.load(f)
if proof_binding.get("schema") != "openclaw.custom-runtime-update-survival.v1" or proof.get("schema") != proof_binding.get("schema"):
    raise SystemExit("prepared update preservation proof schema is invalid")
if proof.get("mode") != "candidate-merge" or proof.get("passed") is not True or proof.get("sourceClean") is not True:
    raise SystemExit("prepared update preservation proof did not pass")
if proof.get("sourceSha") != source_sha or proof.get("candidateSha") != source_sha or proof.get("activeSha") != base_sha:
    raise SystemExit("prepared update preservation proof identity is stale")
if proof.get("contractVersion") != 2 or proof.get("sourceStrategy") != "merge_from_active_sha" or proof.get("dashboardChangePolicy") != "register_verify_and_block" or proof.get("approvalPolicy") != "explicit_exact_candidate" or proof.get("proofCommand") != "pnpm custom-runtime:update-survival":
    raise SystemExit("prepared update preservation proof policy is invalid")
active_manifest_version = proof.get("activeManifestVersion")
candidate_manifest_version = proof.get("candidateManifestVersion")
if not isinstance(active_manifest_version, int) or not isinstance(candidate_manifest_version, int) or candidate_manifest_version < active_manifest_version:
    raise SystemExit("prepared update preservation manifest version is invalid")
required_capabilities = proof.get("requiredCapabilities")
required_path_digests = proof.get("requiredPathDigests")
if not isinstance(required_capabilities, list) or "runtime:update-safe-customizations" not in required_capabilities or not isinstance(required_path_digests, dict) or not re.fullmatch(r"[0-9a-f]{64}", str(required_path_digests.get("config/custom-runtime-capabilities.json", ""))):
    raise SystemExit("prepared update preservation capability ledger is invalid")
for relative_path, expected_digest in required_path_digests.items():
    if not isinstance(relative_path, str) or not relative_path or os.path.isabs(relative_path) or os.path.normpath(relative_path) != relative_path or relative_path == ".." or relative_path.startswith("../"):
        raise SystemExit("prepared update preservation path ledger is unsafe")
    if not isinstance(expected_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
        raise SystemExit("prepared update preservation path digest is invalid")
    release_path = os.path.join(release, relative_path)
    if os.path.islink(release_path) or not os.path.isfile(release_path):
        raise SystemExit("prepared release omitted a preservation-bound path")
    with open(release_path, "rb") as f:
        release_digest = hashlib.sha256(f.read()).hexdigest()
    if release_digest != expected_digest:
        raise SystemExit("prepared release changed a preservation-bound path")
canonical_commands = proof.get("verificationCommands")
executed_commands = proof.get("executedVerificationCommands")
receipt_commands = receipt.get("verificationCommands")
if not isinstance(canonical_commands, list) or not canonical_commands or any(not isinstance(item, str) or not item.strip() for item in canonical_commands):
    raise SystemExit("prepared update preservation proof commands are invalid")
expected_commands = [command.replace("<candidate-sha>", source_sha) for command in canonical_commands]
if executed_commands != expected_commands or receipt_commands != expected_commands or proof.get("verificationResult") != "passed":
    raise SystemExit("prepared update preservation verification ledger is invalid")
try:
    datetime.datetime.fromisoformat(str(proof.get("verifiedAt", "")).replace("Z", "+00:00"))
except ValueError:
    raise SystemExit("prepared update preservation verification timestamp is invalid") from None
official_sha = str(proof.get("officialSha", ""))
if not re.fullmatch(r"[0-9a-f]{40}", official_sha) or proof.get("mergeParents") != [base_sha, official_sha]:
    raise SystemExit("prepared update preservation proof parents are invalid")
backup_binding = receipt.get("verifiedBackup")
if not isinstance(backup_binding, dict) or backup_binding.get("schema") != "openclaw.custom-runtime-update-backup.v2" or backup_binding.get("sourceSha") != base_sha:
    raise SystemExit("prepared update verified backup binding is invalid")
backup_path = os.path.realpath(str(backup_binding.get("path", "")))
if not backup_path.startswith(proof_root + os.sep) or not os.path.isfile(backup_path):
    raise SystemExit("prepared update verified backup receipt is outside runtime receipts")
backup_sha = str(backup_binding.get("sha256", "")).lower()
if not re.fullmatch(r"[0-9a-f]{64}", backup_sha):
    raise SystemExit("prepared update verified backup digest is invalid")
with open(backup_path, "rb") as f:
    if hashlib.sha256(f.read()).hexdigest() != backup_sha:
        raise SystemExit("prepared update verified backup digest changed after preparation")
github_binding = receipt.get("repositoryProof")
if not isinstance(github_binding, dict) or github_binding.get("schema") != "openclaw.custom-runtime-github-proof.v1" or github_binding.get("sourceSha") != source_sha:
    raise SystemExit("prepared update repository proof binding is invalid")
github_path = os.path.realpath(str(github_binding.get("path", "")))
if not github_path.startswith(proof_root + os.sep) or not os.path.isfile(github_path):
    raise SystemExit("prepared update repository proof receipt is outside runtime receipts")
github_sha = str(github_binding.get("sha256", "")).lower()
if not re.fullmatch(r"[0-9a-f]{64}", github_sha):
    raise SystemExit("prepared update repository proof digest is invalid")
with open(github_path, "rb") as f:
    if hashlib.sha256(f.read()).hexdigest() != github_sha:
        raise SystemExit("prepared update repository proof digest changed after preparation")
gateway_environment = receipt.get("gatewayEnvironment")
if not isinstance(gateway_environment, dict):
    raise SystemExit("prepared update Gateway environment binding is missing")
gateway_paths = []
for key in ("wrapper", "file"):
    binding = gateway_environment.get(key)
    if not isinstance(binding, dict):
        raise SystemExit(f"prepared update Gateway environment {key} binding is missing")
    file_path = str(binding.get("path", ""))
    expected_digest = str(binding.get("sha256", "")).lower()
    if not os.path.isabs(file_path) or not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
        raise SystemExit(f"prepared update Gateway environment {key} binding is invalid")
    try:
        info = os.lstat(file_path)
    except OSError:
        raise SystemExit(f"prepared update Gateway environment {key} is unavailable") from None
    if not os.path.isfile(file_path) or os.path.islink(file_path):
        raise SystemExit(f"prepared update Gateway environment {key} is not a regular file")
    with open(file_path, "rb") as f:
        if hashlib.sha256(f.read()).hexdigest() != expected_digest:
            raise SystemExit(f"prepared update Gateway environment {key} changed after preparation")
    gateway_paths.append(file_path)
gateway_launch_agent = receipt.get("gatewayLaunchAgent")
if not isinstance(gateway_launch_agent, dict):
    raise SystemExit("prepared update Gateway LaunchAgent binding is missing")
gateway_plist = str(gateway_launch_agent.get("path", ""))
gateway_plist_sha = str(gateway_launch_agent.get("sha256", "")).lower()
if not os.path.isabs(gateway_plist) or not re.fullmatch(r"[0-9a-f]{64}", gateway_plist_sha):
    raise SystemExit("prepared update Gateway LaunchAgent binding is invalid")
try:
    gateway_plist_info = os.lstat(gateway_plist)
except OSError:
    raise SystemExit("prepared update Gateway LaunchAgent is unavailable") from None
if not os.path.isfile(gateway_plist) or os.path.islink(gateway_plist):
    raise SystemExit("prepared update Gateway LaunchAgent is not a regular file")
with open(gateway_plist, "rb") as f:
    if hashlib.sha256(f.read()).hexdigest() != gateway_plist_sha:
        raise SystemExit("prepared update Gateway LaunchAgent changed after preparation")
try:
    import plistlib
    with open(gateway_plist, "rb") as f:
        launch_agent = plistlib.load(f)
except (OSError, plistlib.InvalidFileException):
    raise SystemExit("prepared update Gateway LaunchAgent is invalid") from None
arguments = launch_agent.get("ProgramArguments")
expected_arguments = [os.path.realpath(item) for item in gateway_paths]
actual_arguments = (
    [os.path.realpath(item) for item in arguments[:2]]
    if isinstance(arguments, list)
    and len(arguments) >= 3
    and all(isinstance(item, str) and item for item in arguments[:3])
    else []
)
if actual_arguments != expected_arguments or os.path.basename(arguments[2]) != "custom-runtime-launcher.sh":
    raise SystemExit("prepared update Gateway LaunchAgent environment contract changed")
for value in (release, source_sha, str(receipt.get("sourceRepo", "")), str(receipt.get("sourceBranch", "")), proof_path, proof_sha, backup_path, backup_sha, github_path, github_sha, *gateway_paths, gateway_plist):
    print(value)
PY
) || exit 64
release=$(printf '%s\n' "$fields" | sed -n '1p')
source_sha=$(printf '%s\n' "$fields" | sed -n '2p')
source_repo=$(printf '%s\n' "$fields" | sed -n '3p')
source_branch=$(printf '%s\n' "$fields" | sed -n '4p')
preservation_proof=$(printf '%s\n' "$fields" | sed -n '5p')
preservation_proof_sha=$(printf '%s\n' "$fields" | sed -n '6p')
backup_receipt=$(printf '%s\n' "$fields" | sed -n '7p')
backup_receipt_sha=$(printf '%s\n' "$fields" | sed -n '8p')
github_proof_receipt=$(printf '%s\n' "$fields" | sed -n '9p')
github_proof_receipt_sha=$(printf '%s\n' "$fields" | sed -n '10p')
gateway_env_wrapper=$(printf '%s\n' "$fields" | sed -n '11p')
gateway_env_file=$(printf '%s\n' "$fields" | sed -n '12p')
gateway_plist=$(printf '%s\n' "$fields" | sed -n '13p')
backup_verifier="$runtime_home/bin/custom-runtime-update-backup.mjs"
[ -f "$backup_verifier" ] && [ ! -L "$backup_verifier" ] || {
  printf '%s\n' 'verified backup tool is unavailable' >&2
  exit 64
}
"${OPENCLAW_NODE_BIN:-node}" "$backup_verifier" verify --runtime-home "$runtime_home" \
  --receipt "$backup_receipt" --expected-sha "$(python3 - "$runtime_home/active-runtime.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8")).get("sourceSha", ""))
PY
)" >/dev/null || {
  printf '%s\n' 'prepared update verified backup is stale or unavailable' >&2
  exit 64
}
github_proof_verifier="$runtime_home/bin/custom-runtime-update-github-proof.mjs"
[ -f "$github_proof_verifier" ] && [ ! -L "$github_proof_verifier" ] || {
  printf '%s\n' 'repository-native proof verifier is unavailable' >&2
  exit 64
}
"${OPENCLAW_NODE_BIN:-node}" "$github_proof_verifier" verify \
  --receipt "$github_proof_receipt" --expected-sha "$source_sha" >/dev/null || {
  printf '%s\n' 'repository-native exact-SHA proof is stale or unavailable' >&2
  exit 64
}
[ -d "$source_repo/.git" ] || git -C "$source_repo" rev-parse --git-dir >/dev/null 2>&1 || {
  printf '%s\n' 'prepared update source repository is unavailable' >&2
  exit 64
}
source_is_bare=$(git -C "$source_repo" rev-parse --is-bare-repository 2>/dev/null) || {
  printf '%s\n' 'prepared update source repository type is unavailable' >&2
  exit 64
}
if [ "$source_is_bare" = true ]; then
  source_alternates=$(git -C "$source_repo" rev-parse --git-path objects/info/alternates 2>/dev/null) || {
    printf '%s\n' 'prepared update source alternates path is unavailable' >&2
    exit 64
  }
  [ ! -s "$source_alternates" ] || {
    printf '%s\n' 'prepared update source repository uses Git alternates' >&2
    exit 64
  }
  [ "$(git -C "$source_repo" rev-parse --is-shallow-repository 2>/dev/null)" = false ] || {
    printf '%s\n' 'prepared update source repository is shallow' >&2
    exit 64
  }
else
  [ -z "$(git -C "$source_repo" status --porcelain --untracked-files=all)" ] || {
    printf '%s\n' 'prepared update source repository is dirty' >&2
    exit 64
  }
fi
git -C "$source_repo" cat-file -e "$source_sha^{commit}" 2>/dev/null || {
  printf '%s\n' 'prepared update source commit is unavailable' >&2
  exit 64
}
branch_sha=$(git -C "$source_repo" rev-parse --verify "$source_branch^{commit}" 2>/dev/null) || {
  printf '%s\n' 'prepared update source branch is unavailable' >&2
  exit 64
}
[ "$branch_sha" = "$source_sha" ] || {
  printf '%s\n' 'prepared update source branch does not identify the candidate commit' >&2
  exit 64
}
[ -f "$release/.openclaw-production-sha" ] || { printf '%s\n' 'prepared release source stamp is missing' >&2; exit 64; }
[ "$(tr -d '[:space:]' < "$release/.openclaw-production-sha")" = "$source_sha" ] || {
  printf '%s\n' 'prepared release source stamp changed after proof' >&2
  exit 64
}
seal_verifier="$runtime_home/bin/custom-runtime-seal.sh"
[ -x "$seal_verifier" ] || {
  printf '%s\n' 'active runtime seal verifier is unavailable' >&2
  exit 64
}
"$seal_verifier" --verify --release "$release" >/dev/null || {
  printf '%s\n' 'prepared immutable release seal verification failed' >&2
  exit 64
}

approval_receipt="$runtime_home/receipts/update-approval-$stamp.json"
installation_lock="$runtime_home/update-installation.lock"
acquire_result=$(custom_runtime_update_lock_transition \
  acquire "$installation_lock" "$runtime_home/receipts" "$stamp" installation "$$") || {
  printf '%s\n' 'verified update installation is already running or locked' >&2
  exit 64
}
[ "$acquire_result" = acquired ] || exit 64
approval_completed=false
activation_completed=false
finish_installation() {
  code=$?
  trap - EXIT
  rm -f "$installation_lock/owner.json"
  rmdir "$installation_lock" 2>/dev/null || true
  if [ "$approval_completed" != true ]; then
    if [ "$activation_completed" = true ]; then
      failure_stage=installation-finalization-failed
    else
      failure_stage=activation-failed
    fi
    python3 - "$approval_receipt" "$stamp" "$failure_stage" "$release" "$source_sha" <<'PY' || true
import json, os, sys

target, at, stage, release, source_sha = sys.argv[1:]
with open(target + ".tmp", "w", encoding="utf-8") as f:
    json.dump({
        "schema": "openclaw.custom-runtime-update-approval.v1",
        "at": at,
        "result": "failed",
        "stage": stage,
        "release": release,
        "sourceSha": source_sha,
    }, f, indent=2, sort_keys=True)
    f.write("\n")
os.replace(target + ".tmp", target)
PY
  fi
  exit "$code"
}
trap finish_installation EXIT
if ! custom_runtime_update_lock_transition check "$runtime_home/update-preparation.lock" \
  "$runtime_home/receipts" "$stamp" preparation >/dev/null; then
  printf '%s\n' 'verified update preparation started during approval' >&2
  exit 75
fi

runtime_guard="$runtime_home/bin/custom-runtime-guard.sh"
[ -x "$runtime_guard" ] && [ ! -L "$runtime_guard" ] || {
  printf '%s\n' 'active runtime guard is unavailable' >&2
  exit 64
}
OPENCLAW_GATEWAY_PLIST="$gateway_plist" \
  /bin/sh "$gateway_env_wrapper" "$gateway_env_file" "$runtime_guard" --verify-only >/dev/null || {
  printf '%s\n' 'active runtime guard verification failed before activation' >&2
  exit 64
}

OPENCLAW_GATEWAY_ENV_WRAPPER="$gateway_env_wrapper" \
OPENCLAW_GATEWAY_ENV_FILE="$gateway_env_file" \
OPENCLAW_GATEWAY_PLIST="$gateway_plist" \
  "$release/scripts/custom-runtime/custom-runtime-activate.sh" \
  --release "$release" --source-sha "$source_sha" --source-repo "$source_repo" \
  --source-branch "$source_branch" --stage-port 18790 --port 18789
activation_completed=true

python3 - "$approval_receipt" "$receipt" "$stamp" "$release" "$source_sha" \
  "$preservation_proof" "$preservation_proof_sha" "$backup_receipt" \
  "$backup_receipt_sha" "$github_proof_receipt" "$github_proof_receipt_sha" <<'PY'
import json, os, sys
target, prepared, at, release, source_sha, proof_path, proof_sha, backup_path, backup_sha, github_path, github_sha = sys.argv[1:]
with open(target + ".tmp", "w", encoding="utf-8") as f:
    json.dump({
        "schema": "openclaw.custom-runtime-update-approval.v1",
        "at": at,
        "result": "promoted",
        "preparedReceipt": os.path.realpath(prepared),
        "release": release,
        "sourceSha": source_sha,
        "preservationProof": {
            "path": proof_path,
            "sha256": proof_sha,
            "schema": "openclaw.custom-runtime-update-survival.v1",
        },
        "verifiedBackup": {
            "path": backup_path,
            "sha256": backup_sha,
            "schema": "openclaw.custom-runtime-update-backup.v2",
        },
        "repositoryProof": {
            "path": github_path,
            "sha256": github_sha,
            "schema": "openclaw.custom-runtime-github-proof.v1",
        },
    }, f, indent=2, sort_keys=True)
    f.write("\n")
os.replace(target + ".tmp", target)
PY
rm -f "$pending"
approval_completed=true
printf '%s\n' "CUSTOM_RUNTIME_UPDATE_APPROVED release=$(basename "$release") sourceSha=$source_sha"
