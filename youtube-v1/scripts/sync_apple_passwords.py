#!/usr/bin/env python3
import argparse
import getpass
import os
import stat
import subprocess
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]
ENV_PATH = BASE / ".env"


KEYCHAIN_ITEMS = {
    "OPENAI_API_KEY": {
        "servers": ["platform.openai.com", "openai.com"],
        "account": "PatternLabImages",
        "labels": ["OpenAI API - Pattern Lab", "Pattern Lab - OpenAI API"],
    },
    "ELEVENLABS_API_KEY": {
        "servers": ["elevenlabs.io", "api.elevenlabs.io"],
        "account": "PatternLabVoice",
        "labels": ["ElevenLabs API - Pattern Lab", "Pattern Lab - ElevenLabs API"],
    },
}


DEFAULTS = {
    "ELEVENLABS_VOICE_ID": "replace_me",
    "OPENAI_IMAGE_MODEL": "gpt-image-1",
    "PATTERNLAB_OUTPUT_ROOT": "local-output/video-01",
    "YOUTUBE_CLIENT_SECRETS_FILE": "replace_me",
    "YOUTUBE_TOKEN_FILE": "local-output/youtube-oauth-token.json",
}


def valid_secret(value):
    return bool(value and value.strip() and value.strip() != "replace_me")


def existing_env():
    values = {}
    if not ENV_PATH.exists():
        return values
    for raw_line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def keychain_password(servers, account, labels):
    commands = []
    for server in servers:
        commands.append(["/usr/bin/security", "find-internet-password", "-w", "-s", server, "-a", account])
        commands.append(["/usr/bin/security", "find-internet-password", "-w", "-s", server])
    for label in labels:
        commands.extend(
            [
                ["/usr/bin/security", "find-generic-password", "-w", "-s", label, "-a", account],
                ["/usr/bin/security", "find-generic-password", "-w", "-s", label],
                ["/usr/bin/security", "find-generic-password", "-w", "-l", label, "-a", account],
                ["/usr/bin/security", "find-generic-password", "-w", "-l", label],
            ],
        )
    for command in commands:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    raise RuntimeError(
        "No matching CLI-readable Keychain item found "
        f"(checked account {account}, servers {', '.join(servers)}, labels {', '.join(labels)})."
    )


def store_generic_password(label, account, secret):
    subprocess.run(
        [
            "/usr/bin/security",
            "add-generic-password",
            "-U",
            "-s",
            label,
            "-a",
            account,
            "-w",
            secret,
        ],
        capture_output=True,
        text=True,
        check=True,
    )


def clipboard_text():
    result = subprocess.run(["/usr/bin/pbpaste"], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def write_env(values):
    lines = [
        "# Generated locally from Apple Passwords. Do not commit this file.",
        f"OPENAI_API_KEY={values.get('OPENAI_API_KEY', 'replace_me')}",
        f"ELEVENLABS_API_KEY={values.get('ELEVENLABS_API_KEY', 'replace_me')}",
        f"ELEVENLABS_VOICE_ID={values.get('ELEVENLABS_VOICE_ID', 'replace_me')}",
        f"OPENAI_IMAGE_MODEL={values.get('OPENAI_IMAGE_MODEL', 'gpt-image-1')}",
        f"PATTERNLAB_OUTPUT_ROOT={values.get('PATTERNLAB_OUTPUT_ROOT', 'local-output/video-01')}",
        f"YOUTUBE_CLIENT_SECRETS_FILE={values.get('YOUTUBE_CLIENT_SECRETS_FILE', 'replace_me')}",
        f"YOUTUBE_TOKEN_FILE={values.get('YOUTUBE_TOKEN_FILE', 'local-output/youtube-oauth-token.json')}",
        "",
    ]
    ENV_PATH.write_text("\n".join(lines), encoding="utf-8")
    os.chmod(ENV_PATH, stat.S_IRUSR | stat.S_IWUSR)


def prompt_secret(label, current=""):
    suffix = " [leave blank to keep existing]" if valid_secret(current) else ""
    value = getpass.getpass(f"{label}{suffix}: ").strip()
    return value or current


def main():
    parser = argparse.ArgumentParser(
        description="Sync Pattern Lab API keys from Apple Passwords into the ignored local .env file."
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Prompt for missing secrets using hidden terminal input.",
    )
    parser.add_argument(
        "--repair-keychain",
        action="store_true",
        help="Prompt for missing secrets and store them as CLI-readable generic macOS Keychain items.",
    )
    parser.add_argument(
        "--clipboard",
        choices=["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"],
        action="append",
        default=[],
        help="Read one value from the Mac clipboard and store it without printing it. Repeat for multiple keys.",
    )
    args = parser.parse_args()

    values = {**DEFAULTS, **existing_env()}
    found = []
    missing = []
    for env_name, item in KEYCHAIN_ITEMS.items():
        if valid_secret(values.get(env_name)):
            found.append(f"{env_name} (.env)")
            continue
        try:
            secret = keychain_password(item["servers"], item["account"], item["labels"])
            values[env_name] = secret
            found.append(f"{env_name} (Keychain)")
        except Exception as error:
            missing.append((env_name, str(error)))

    if args.interactive or args.repair_keychain:
        for env_name, _error in missing:
            values[env_name] = prompt_secret(env_name, values.get(env_name, ""))
            if args.repair_keychain and valid_secret(values.get(env_name)):
                item = KEYCHAIN_ITEMS[env_name]
                store_generic_password(item["labels"][0], item["account"], values[env_name])
        values["ELEVENLABS_VOICE_ID"] = prompt_secret(
            "ELEVENLABS_VOICE_ID",
            values.get("ELEVENLABS_VOICE_ID", ""),
        )
        missing = [(name, error) for name, error in missing if not valid_secret(values.get(name))]

    for env_name in args.clipboard:
        value = clipboard_text()
        if not valid_secret(value):
            raise SystemExit(f"Clipboard did not contain a usable value for {env_name}.")
        values[env_name] = value
        if env_name in KEYCHAIN_ITEMS and not args.dry_run:
            item = KEYCHAIN_ITEMS[env_name]
            store_generic_password(item["labels"][0], item["account"], value)
        missing = [(name, error) for name, error in missing if name != env_name]

    print(f"Found secrets: {', '.join(found) if found else 'none'}")
    if missing:
        print("Missing secrets:")
        for name, error in missing:
            print(f"- {name}: {error}")

    if args.dry_run:
        print("Dry run only. No file written.")
        return

    if not (args.interactive or args.repair_keychain or args.clipboard) and missing and not any(
        valid_secret(values.get(name)) for name, _error in missing
    ):
        print(
            "No usable secrets found. Re-run with --interactive to enter values without echoing them, "
            "or --repair-keychain to also save CLI-readable Keychain items."
        )
        return

    write_env(values)
    print("Wrote youtube-v1/.env with owner-only file permissions. Secret values were not printed.")
    if args.repair_keychain:
        print("Updated Pattern Lab generic Keychain items for future non-interactive syncs.")
    if args.clipboard:
        print("Stored clipboard-provided Pattern Lab value(s). Secret values were not printed.")
    if values.get("ELEVENLABS_VOICE_ID") == "replace_me":
        print("ELEVENLABS_VOICE_ID is still replace_me. Run generate_voiceover.py --list-voices after the API key is synced.")


if __name__ == "__main__":
    main()
