#!/usr/bin/env python3
import argparse
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


def main():
    parser = argparse.ArgumentParser(description="Schedule robust one-off wake windows for OpenClaw morning jobs.")
    parser.add_argument("--tz", default="America/New_York")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    now = datetime.now(ZoneInfo(args.tz))
    print(f"now: {now.isoformat(timespec='seconds')}")
    for label, target_time in WAKE_WINDOWS:
        schedule_wake(label, next_occurrence(now, target_time), args.dry_run)


if __name__ == "__main__":
    main()
