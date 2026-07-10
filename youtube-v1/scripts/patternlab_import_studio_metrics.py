#!/usr/bin/env python3
"""Validate or import manually exported YouTube Studio metrics for Pattern Lab."""
from __future__ import annotations

import argparse
import csv
import json
import shutil
from pathlib import Path

from patternlab_common import display_path, ensure_dir, output_root, utc_now
from patternlab_post_public_metrics import METRIC_FIELDS

SUPPORTED_MANUAL_FIELDS = {
    'video_id', 'surface', 'hours_since_publish', 'views', 'impressions', 'ctr_percent',
    'average_view_duration_seconds', 'average_percentage_viewed', 'retention_30s_percent',
    'shorts_viewed_percent', 'shorts_swiped_away_percent', 'related_video_clicks',
    'estimated_revenue_usd', 'rpm_usd', 'browse_ctr_percent', 'suggested_ctr_percent',
    'search_ctr_percent', 'watch_hours', 'subscribers_gained', 'returning_viewers',
}


def read_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding='utf-8', newline='') as handle:
        return list(csv.DictReader(handle))


def write_rows(path: Path, rows: list[dict[str, str]]) -> None:
    ensure_dir(path.parent)
    with path.open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=METRIC_FIELDS)
        writer.writeheader()
        writer.writerows([{field: row.get(field, '') for field in METRIC_FIELDS} for row in rows])


def metric_key(row: dict[str, str]) -> tuple[str, str, str]:
    return (
        row.get('youtube_video_id') or row.get('video_id') or '',
        row.get('surface') or '',
        str(row.get('hours_since_publish') or ''),
    )


def dedupe_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    by_key: dict[tuple[str, str, str], dict[str, str]] = {}
    ordered: list[dict[str, str]] = []
    for row in rows:
        key = metric_key(row)
        if not all(key):
            ordered.append(dict(row))
            continue
        if key not in by_key:
            by_key[key] = dict(row)
            ordered.append(by_key[key])
            continue
        target = by_key[key]
        for field, value in row.items():
            if value not in {None, ''}:
                target[field] = value
    return ordered


def build_report(video_id: str, import_file: Path | None, dry_run: bool) -> tuple[dict, Path, Path]:
    root = output_root(video_id)
    metrics_dir = ensure_dir(root / 'metrics')
    metrics_path = metrics_dir / f'video-{video_id}-performance.csv'
    existing_rows = read_rows(metrics_path)
    original_row_count = len(existing_rows)
    existing_rows = dedupe_rows(existing_rows)
    imported_rows = dedupe_rows(read_rows(import_file)) if import_file else []
    blockers: list[str] = []
    warnings: list[str] = []
    applied = 0
    if import_file and not import_file.exists():
        blockers.append(f'import_file_missing:{display_path(import_file)}')
    if imported_rows:
        unknown_fields = sorted(set(imported_rows[0].keys()) - SUPPORTED_MANUAL_FIELDS - set(METRIC_FIELDS))
        if unknown_fields:
            warnings.append('unknown_import_fields:' + ','.join(unknown_fields))
        by_key = {metric_key(row): row for row in existing_rows if all(metric_key(row))}
        for row in imported_rows:
            key = metric_key(row)
            if not all(key):
                blockers.append('import_row_missing_video_id_or_hours_since_publish')
                continue
            target = by_key.setdefault(key, {'video_id': row.get('video_id', ''), 'hours_since_publish': row.get('hours_since_publish', '')})
            for field in SUPPORTED_MANUAL_FIELDS:
                if row.get(field, '') != '':
                    target[field] = row[field]
            target['metrics_import_status'] = 'manual_studio_imported'
            target['metrics_source'] = 'YouTube Studio export/manual import'
            applied += 1
        if not dry_run and not blockers:
            backup_dir = ensure_dir(metrics_path.parent / 'backups')
            backup_path = backup_dir / f'{metrics_path.stem}.before-studio-import-{utc_now().replace(":", "").replace("-", "")}.csv'
            if metrics_path.exists():
                shutil.copy2(metrics_path, backup_path)
            write_rows(metrics_path, list(by_key.values()))
    elif not dry_run and original_row_count != len(existing_rows):
        backup_dir = ensure_dir(metrics_path.parent / 'backups')
        backup_path = backup_dir / f'{metrics_path.stem}.before-dedupe-{utc_now().replace(":", "").replace("-", "")}.csv'
        if metrics_path.exists():
            shutil.copy2(metrics_path, backup_path)
        write_rows(metrics_path, existing_rows)
    payload = {
        'generated_at': utc_now(),
        'video_id': video_id,
        'status': 'blocked' if blockers else ('dry_run_ready' if dry_run else 'pass'),
        'metrics_csv': display_path(metrics_path),
        'import_file': display_path(import_file) if import_file else '',
        'existing_row_count': len(existing_rows),
        'original_row_count': original_row_count,
        'deduplicated_row_count': len(existing_rows),
        'import_row_count': len(imported_rows),
        'rows_applied': applied,
        'dry_run': dry_run,
        'manual_supported_fields': sorted(SUPPORTED_MANUAL_FIELDS),
        'warnings': warnings,
        'blockers': blockers,
        'youtube_mutation': 'not_performed',
    }
    json_path = metrics_dir / f'video-{video_id}-studio-metrics-import-report.json'
    md_path = metrics_dir / f'video-{video_id}-studio-metrics-import-report.md'
    json_path.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
    lines = [f'# Pattern Lab Studio Metrics Import: Video {video_id}', '', f"Generated: {payload['generated_at']}", f"Status: {payload['status']}", f"Dry run: {dry_run}", f"Rows applied: {applied}", '', '## Blockers', '']
    lines.extend([f'- {b}' for b in blockers] or ['- none'])
    lines.extend(['', '## Warnings', ''])
    lines.extend([f'- {w}' for w in warnings] or ['- none'])
    md_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return payload, json_path, md_path


def main() -> None:
    parser = argparse.ArgumentParser(description='Import Pattern Lab YouTube Studio metrics CSV.')
    parser.add_argument('--video-id', default='04')
    parser.add_argument('--import-file')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    payload, _, md = build_report(args.video_id, Path(args.import_file) if args.import_file else None, args.dry_run)
    print(f"Status: {payload['status']}")
    print(f"Studio metrics import report: {display_path(md)}")
    if payload['status'] == 'blocked':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
