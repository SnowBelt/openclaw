#!/usr/bin/env python3
import argparse
import re
import subprocess
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo


WAKE_WINDOWS = [
    # One early one-off wake covers 2:00 maintenance and 2:15 backup. The Mac's
    # no-sleep AC profile then keeps it awake through the existing 4:10 repeating
    # wake backup, Pattern Lab at 4:25, and acquisition jobs from 4:45 onward.
    ("overnight-prewake", time(1, 55)),
]


def next_occurrence(now, target_time):
    candidate = datetime.combine(now.date(), target_time, tzinfo=now.tzinfo)
    if candidate <= now + timedelta(minutes=2):
        candidate += timedelta(days=1)
    return candidate


def pmset_date(value):
    return value.strftime("%m/%d/%y %H:%M:%S")


def schedule_wake(label, when, dry_run):
    command = ["pmset", "schedule", "wakeorpoweron", pmset_date(when), f"pattern-lab-{label}"]
    print("+ " + " ".join(command))
    if not dry_run:
        subprocess.run(command, check=True)


OWNED_EVENT_RE = re.compile(
    r"^\s*\[[0-9]+\]\s+wakeorpoweron at "
    r"(?P<when>[^\n]+?) by 'pattern-lab-(?P<label>[^']+)'\s*$"
)


def cancel_owned_wakes(dry_run):
    """Cancel only Pattern Lab's one-time wakes, never unrelated system events."""
    scheduled = subprocess.run(
        ["pmset", "-g", "sched"], check=True, text=True, capture_output=True
    ).stdout
    for line in scheduled.splitlines():
        match = OWNED_EVENT_RE.match(line)
        if not match:
            continue
        raw_when = match.group("when")
        try:
            when = datetime.strptime(raw_when, "%m/%d/%Y %H:%M:%S")
        except ValueError:
            try:
                when = datetime.strptime(raw_when, "%m/%d/%y %H:%M:%S")
            except ValueError as exc:
                raise RuntimeError(f"cannot safely parse owned wake: {line}") from exc
        owner = f"pattern-lab-{match.group('label')}"
        command = ["pmset", "schedule", "cancel", "wakeorpoweron", pmset_date(when), owner]
        print("+ " + " ".join(command))
        if not dry_run:
            subprocess.run(command, check=True)


def main():
    parser = argparse.ArgumentParser(description="Schedule robust one-off wake windows for OpenClaw morning jobs.")
    parser.add_argument("--tz", default="America/New_York")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--replace-owned",
        action="store_true",
        help="cancel only existing Pattern Lab one-time wakes before scheduling the next one",
    )
    args = parser.parse_args()

    now = datetime.now(ZoneInfo(args.tz))
    print(f"now: {now.isoformat(timespec='seconds')}")
    if args.replace_owned:
        cancel_owned_wakes(args.dry_run)
    for label, target_time in WAKE_WINDOWS:
        schedule_wake(label, next_occurrence(now, target_time), args.dry_run)


if __name__ == "__main__":
    main()
