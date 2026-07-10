#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

from patternlab_comment_prompts import is_generic_comment_prompt, local_source_lead_terms_present
from patternlab_common import BASE, display_path, ensure_dir, output_root, read_text, strip_markdown_for_voiceover, utc_now


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def script_path(video_id):
    return BASE / "launch" / f"video-{video_id}" / "final-script.md"


def metadata_for(video_id):
    approval_metadata = output_root(video_id) / "approval" / "upload-metadata.json"
    metadata = read_json(approval_metadata)
    if metadata:
        return metadata, approval_metadata
    package_path = BASE / "launch" / f"video-{video_id}" / "package.json"
    package = read_json(package_path) or {}
    return package.get("upload_metadata") or {}, package_path


def script_comment_ask(clean):
    lower = clean.lower()
    subscribe_index = lower.rfind("subscribe")
    comment_terms = ["leave the name", "comments", "comment", "source trail", "family remembers", "detroit locals"]
    positions = [lower.rfind(term) for term in comment_terms if lower.rfind(term) >= 0]
    ask_index = max(positions) if positions else -1
    if ask_index < 0:
        return "", ask_index, subscribe_index
    start = max(0, ask_index - 260)
    end = min(len(clean), ask_index + 420)
    return clean[start:end], ask_index, subscribe_index


def shorts_comment_prompts(metadata):
    prompts = []
    for short in metadata.get("shorts") or []:
        if short.get("pinned_comment"):
            prompts.append((short.get("id", "short"), short.get("pinned_comment")))
    guru = metadata.get("guru_growth_system") or {}
    concepts = (guru.get("shorts_discovery_funnel") or {}).get("concepts") or guru.get("shorts_concepts") or []
    for concept in concepts:
        if concept.get("comment_prompt"):
            prompts.append((concept.get("id", "guru-short"), concept.get("comment_prompt")))
    return prompts


def build_comment_quality_report(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    checks = []
    blockers = []
    warnings = []

    def check(name, passed, detail, blocker=True):
        checks.append({"name": name, "passed": bool(passed), "detail": detail, "blocker": bool(blocker)})
        if passed:
            return
        if blocker:
            blockers.append(f"{name}: {detail}")
        else:
            warnings.append(f"{name}: {detail}")

    spath = script_path(video_id)
    clean = strip_markdown_for_voiceover(read_text(spath)) if spath.exists() else ""
    metadata, metadata_path = metadata_for(video_id)
    pinned = metadata.get("pinned_comment") or ""
    ask, ask_index, subscribe_index = script_comment_ask(clean)
    pinned_terms = local_source_lead_terms_present(pinned)
    ask_terms = local_source_lead_terms_present(ask)
    generic_pinned = is_generic_comment_prompt(pinned)
    generic_ask = is_generic_comment_prompt(ask)

    check("script_exists", spath.exists(), display_path(spath))
    check("metadata_exists", bool(metadata), display_path(metadata_path))
    check("pinned_comment_present", bool(pinned.strip()), pinned[:220] or "missing")
    check("pinned_comment_not_generic", bool(pinned.strip()) and not generic_pinned, pinned[:220] or "missing")
    check("pinned_comment_local_source_terms", len(pinned_terms) >= 2, f"terms={pinned_terms}; pinned={pinned[:220]}")
    check(
        "pinned_comment_source_lead_framing",
        "source" in pinned.lower() and ("lead" in pinned.lower() or "memory" in pinned.lower() or "name" in pinned.lower()),
        "pinned comment must treat viewer comments as source leads, not facts",
    )
    check("script_comment_ask_present", bool(ask.strip()), ask[:220] or "missing")
    check("script_comment_ask_before_subscribe", ask_index >= 0 and subscribe_index >= 0 and ask_index < subscribe_index, f"ask_index={ask_index}; subscribe_index={subscribe_index}")
    check("script_comment_ask_not_generic", bool(ask.strip()) and not generic_ask, ask[:220] or "missing")
    check("script_comment_ask_local_source_terms", len(ask_terms) >= 2, f"terms={ask_terms}; ask={ask[:220]}")

    short_prompts = shorts_comment_prompts(metadata)
    source_specific_short_prompts = [item for item in short_prompts if len(local_source_lead_terms_present(item[1])) >= 1 and not is_generic_comment_prompt(item[1])]
    check("shorts_comment_prompt_source_leads", len(source_specific_short_prompts) >= min(5, max(1, len(short_prompts))), f"{len(source_specific_short_prompts)}/{len(short_prompts)} source-specific Shorts prompts")

    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "pass" if not blockers else "blocked",
        "script": display_path(spath),
        "metadata": display_path(metadata_path),
        "pinned_comment": pinned,
        "script_comment_excerpt": ask,
        "shorts_comment_prompt_count": len(short_prompts),
        "source_specific_shorts_comment_prompt_count": len(source_specific_short_prompts),
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
    }
    json_path = approval / "comment-quality-report.json"
    md_path = approval / "comment-quality-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Comment Quality: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        "",
        "## Pinned Comment",
        "",
        pinned or "missing",
        "",
        "## Checks",
        "",
    ]
    for item in checks:
        lines.append(f"- {item['name']}: {'pass' if item['passed'] else 'fail'} ({item['detail']})")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab local source-lead comment quality.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_comment_quality_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Comment quality report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
