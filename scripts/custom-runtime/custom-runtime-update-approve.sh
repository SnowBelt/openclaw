#!/bin/sh
# Promote one fully prepared custom-runtime candidate after explicit operator approval.
set -eu

runtime_home=${OPENCLAW_CUSTOM_RUNTIME_HOME:-"$HOME/.openclaw-custom-runtime"}
releases_dir=${OPENCLAW_CUSTOM_RUNTIME_RELEASES:-"$HOME/.openclaw-runtime-releases"}
durable_source_root=${OPENCLAW_CUSTOM_RUNTIME_DURABLE_SOURCE_ROOT:-"$HOME"}
pending=${OPENCLAW_CUSTOM_RUNTIME_PENDING_UPDATE:-"$runtime_home/pending-update.json"}
mkdir -p "$runtime_home/receipts"

usage() {
  printf '%s\n' 'usage: custom-runtime-update-approve.sh [--receipt PATH]' >&2
  exit 64
}
receipt=$pending
while [ $# -gt 0 ]; do
  case "$1" in
    --receipt) receipt=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[ -f "$receipt" ] || { printf '%s\n' 'prepared update receipt is missing' >&2; exit 64; }
[ -f "$runtime_home/active-runtime.json" ] || { printf '%s\n' 'active runtime pointer is missing' >&2; exit 64; }

fields=$(python3 - "$receipt" "$runtime_home/active-runtime.json" "$releases_dir" "$runtime_home" <<'PY'
import datetime, hashlib, json, os, re, sys
receipt_path, active_path, releases_dir, runtime_home = sys.argv[1:]
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
if not re.fullmatch(r"[0-9a-fA-F]{40}", source_sha):
    raise SystemExit("prepared update source SHA is invalid")
if not re.fullmatch(r"[0-9a-fA-F]{40}", base_sha):
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
for value in (
    release,
    source_sha,
    str(receipt.get("sourceRepo", "")),
    str(receipt.get("sourceGitCommonDir", "")),
    str(receipt.get("sourceBranch", "")),
    str(receipt.get("sourceRemoteUrl", "")),
    str(receipt.get("sourceRemoteRef", "")),
    str(receipt.get("sourceRemoteSha", "")),
    proof_path,
    proof_sha,
):
    print(value)
PY
) || exit 64
release=$(printf '%s\n' "$fields" | sed -n '1p')
source_sha=$(printf '%s\n' "$fields" | sed -n '2p')
source_repo=$(printf '%s\n' "$fields" | sed -n '3p')
source_git_common_dir=$(printf '%s\n' "$fields" | sed -n '4p')
source_branch=$(printf '%s\n' "$fields" | sed -n '5p')
source_remote_url=$(printf '%s\n' "$fields" | sed -n '6p')
source_remote_ref=$(printf '%s\n' "$fields" | sed -n '7p')
source_remote_sha=$(printf '%s\n' "$fields" | sed -n '8p')
preservation_proof=$(printf '%s\n' "$fields" | sed -n '9p')
preservation_proof_sha=$(printf '%s\n' "$fields" | sed -n '10p')
[ -d "$source_repo/.git" ] || git -C "$source_repo" rev-parse --git-dir >/dev/null 2>&1 || {
  printf '%s\n' 'prepared update source repository is unavailable' >&2
  exit 64
}
source_repo=$(cd "$source_repo" && pwd -P)
durable_source_root=$(cd "$durable_source_root" && pwd -P)
case "$source_repo" in
  "$durable_source_root"|"$durable_source_root"/*) ;;
  *)
    printf '%s\n' 'prepared update source repository is outside the durable source root' >&2
    exit 64
    ;;
esac
[ -z "$(git -C "$source_repo" status --porcelain)" ] || {
  printf '%s\n' 'prepared update source repository is dirty' >&2
  exit 64
}
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
actual_git_common_dir=$(git -C "$source_repo" rev-parse --git-common-dir) || {
  printf '%s\n' 'prepared update source Git object store is unavailable' >&2
  exit 64
}
case "$actual_git_common_dir" in
  /*) ;;
  *) actual_git_common_dir="$source_repo/$actual_git_common_dir" ;;
esac
actual_git_common_dir=$(cd "$(dirname "$actual_git_common_dir")" && pwd -P)/$(basename "$actual_git_common_dir")
if [ -z "$source_git_common_dir" ]; then
  source_git_common_dir=$actual_git_common_dir
elif [ "$source_git_common_dir" != "$actual_git_common_dir" ]; then
  printf '%s\n' 'prepared update source Git object store does not match provenance' >&2
  exit 64
fi
if [ -z "$source_remote_url" ]; then
  source_remote_url=$source_repo
fi
if [ -z "$source_remote_ref" ]; then
  case "$source_branch" in
    refs/heads/*|refs/tags/*) source_remote_ref=$source_branch ;;
    *) source_remote_ref="refs/heads/$source_branch" ;;
  esac
fi
if [ -z "$source_remote_sha" ]; then
  source_remote_sha=$source_sha
fi
validate_source_remote_url() {
  python3 - "$1" <<'PY'
import os
import re
import sys
from urllib.parse import urlsplit

value = sys.argv[1]
if not value or any(character in value for character in ("\r", "\n", "\0")):
    raise SystemExit(1)
if os.path.isabs(value):
    raise SystemExit(0)
if "://" not in value:
    if not re.fullmatch(r"(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+", value):
        raise SystemExit(1)
    raise SystemExit(0)
parsed = urlsplit(value)
if parsed.scheme not in {"file", "git", "https", "ssh"}:
    raise SystemExit(1)
if parsed.password or parsed.query or parsed.fragment:
    raise SystemExit(1)
if parsed.username and parsed.scheme != "ssh":
    raise SystemExit(1)
PY
}
validate_source_remote_url "$source_remote_url" || {
  printf '%s\n' 'prepared update recovery source remote URL is invalid or credential-bearing' >&2
  exit 64
}
case "$source_remote_url" in
  /*)
    [ -d "$source_remote_url" ] || {
      printf '%s\n' 'prepared update recovery source repository is unavailable' >&2
      exit 64
    }
    source_remote_url=$(cd "$source_remote_url" && pwd -P) || {
      printf '%s\n' 'prepared update recovery source repository cannot be resolved' >&2
      exit 64
    }
    case "$source_remote_url" in
      "$durable_source_root"|"$durable_source_root"/*) ;;
      *)
        printf '%s\n' 'prepared update recovery source repository is outside the durable source root' >&2
        exit 64
        ;;
    esac
    ;;
esac
[ "$source_remote_sha" = "$source_sha" ] || {
  printf '%s\n' 'prepared update recovery SHA does not match the candidate' >&2
  exit 64
}
case "$source_remote_ref" in
  refs/heads/*|refs/tags/*) ;;
  *)
    printf '%s\n' 'prepared update recovery ref must be a branch or tag ref' >&2
    exit 64
    ;;
esac
git check-ref-format "$source_remote_ref" >/dev/null 2>&1 || {
  printf '%s\n' 'prepared update recovery ref is invalid' >&2
  exit 64
}
remote_result=$(git ls-remote --exit-code -- "$source_remote_url" "$source_remote_ref" "${source_remote_ref}^{}" 2>/dev/null) || {
  printf '%s\n' 'prepared update recovery ref is unavailable' >&2
  exit 64
}
remote_sha=$(printf '%s\n' "$remote_result" | awk -v peeled="${source_remote_ref}^{}" '
  $2 == peeled { peeled_sha = $1 }
  !first_sha { first_sha = $1 }
  END { print peeled_sha ? peeled_sha : first_sha }
')
[ "$remote_sha" = "$source_sha" ] || {
  printf '%s\n' 'prepared update recovery ref does not identify the candidate' >&2
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

"$release/scripts/custom-runtime/custom-runtime-activate.sh" \
  --release "$release" --source-sha "$source_sha" --source-repo "$source_repo" \
  --source-branch "$source_branch" --source-git-common-dir "$source_git_common_dir" \
  --source-remote-url "$source_remote_url" --source-remote-ref "$source_remote_ref" \
  --source-remote-sha "$source_remote_sha" --stage-port 18790 --port 18789

stamp=$(date -u +%Y%m%dT%H%M%SZ)
approval_receipt="$runtime_home/receipts/update-approval-$stamp.json"
python3 - "$approval_receipt" "$receipt" "$stamp" "$release" "$source_sha" \
  "$preservation_proof" "$preservation_proof_sha" <<'PY'
import json, os, sys
target, prepared, at, release, source_sha, proof_path, proof_sha = sys.argv[1:]
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
    }, f, indent=2, sort_keys=True)
    f.write("\n")
os.replace(target + ".tmp", target)
PY
rm -f "$pending"
printf '%s\n' "CUSTOM_RUNTIME_UPDATE_APPROVED release=$(basename "$release") sourceSha=$source_sha"
