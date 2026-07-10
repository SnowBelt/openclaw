#!/usr/bin/env python3
"""Pattern Lab episode-standard gate.

This gate enforces the channel rule: one city, one hidden-history question, one
proof trail, and one visual payoff. It is intentionally editorial and strict;
a package that reads like a production memo or decorates narration with generic
visuals should not reach owner review.
"""

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from patternlab_common import display_path, ensure_dir, launch_root, output_root, read_text, utc_now


MAX_MEANINGFUL_VISUAL_GAP_SECONDS = 40.0
FIRST_30_SECONDS = 30.0
MIN_VISUAL_BEATS = 12
MIN_FIRST_30_PROOF_BEATS = 1

BANNED_META_PATTERNS = {
    "this package": "talks about the production package instead of the episode topic",
    "production decision": "describes internal approval instead of city history",
    "the strongest videos will": "discusses channel strategy instead of the promised topic",
    "pattern lab would": "frames the episode as a hypothetical Pattern Lab plan",
    "what pattern lab would do": "frames the episode as a production plan",
    "the version that survives": "describes topic-selection mechanics instead of the story",
    "channel promise": "switches from episode payoff to channel positioning",
    "conditional approval": "mentions internal gatekeeping in viewer narration",
    "this topic belongs": "talks about slate/lane decisions instead of evidence",
    "public publishing still waits": "mentions internal publication status in narration",
    "owner review": "mentions owner-review mechanics in narration",
    "review package": "mentions internal review mechanics in narration",
}

STOPWORDS = {
    "the",
    "and",
    "that",
    "this",
    "with",
    "from",
    "into",
    "just",
    "about",
    "what",
    "when",
    "where",
    "why",
    "how",
    "was",
    "were",
    "did",
    "does",
    "not",
    "its",
    "his",
    "her",
    "their",
    "your",
    "our",
    "for",
    "one",
    "city",
    "cities",
    "story",
    "history",
    "pattern",
    "lab",
    "video",
    "episode",
    "source",
    "sources",
    "proof",
    "object",
    "file",
    "hidden",
    "american",
}

PROOF_ROLES = {"source_proof", "map_system", "archive_evidence", "then_now"}
PROOF_SOURCE_ROLES = {"historical_evidence", "source_grounded_overlay", "archive_evidence", "source_proof"}
CONTEXT_ONLY_ROLES = {"context_only", "modern_context"}

ALLOWED_REPEAT_PURPOSE_TERMS = {
    "crop",
    "closeup",
    "close-up",
    "zoom",
    "highlight",
    "label",
    "overlay",
    "comparison",
    "then_now",
    "then/now",
    "reveal",
    "trace",
    "route",
    "document_closeup",
    "source zoom",
    "map_zoom_trace",
    "new angle",
    "pan_left",
    "pan_right",
    "push",
    "split",
    "circled",
    "callout",
}

BEAT_RE = re.compile(
    r"^-\s*(?P<index>\d+):\s*(?P<start>[0-9.]+)s-(?P<end>[0-9.]+)s\s*\|\s*(?P<asset>[^|]+)\|\s*(?P<rest>.*)$",
    re.MULTILINE,
)

FIELD_RE = re.compile(r"\b(?P<key>[a-zA-Z_][a-zA-Z0-9_-]*)=(?P<value>[^|]+)")


def read_json(path):
    path = Path(path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def read_optional_text(path):
    path = Path(path)
    if not path.exists():
        return ""
    return read_text(path)


def read_ledger(path):
    path = Path(path)
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def normalize_key(value):
    text = str(value or "").strip().lower().replace("\\", "/")
    text = re.sub(r"^youtube-v1/", "", text)
    text = re.sub(r"^local-output/video-[^/]+/", "", text)
    text = re.sub(r"^launch/video-[^/]+/", "", text)
    text = re.sub(r"/+", "/", text)
    return text


def asset_match_keys(asset):
    normalized = normalize_key(asset)
    path = Path(normalized)
    keys = {normalized, path.name.lower()}
    parts = normalized.split("/")
    for index in range(len(parts)):
        keys.add("/".join(parts[index:]))
    return {key for key in keys if key}


def ledger_keys(rows):
    keys = set()
    by_key = defaultdict(list)
    for row in rows:
        for field in ("filename", "local_path", "source_prompt_or_source_file"):
            value = normalize_key(row.get(field, ""))
            if not value:
                continue
            variants = {value, Path(value).name.lower()}
            parts = value.split("/")
            for index in range(len(parts)):
                variants.add("/".join(parts[index:]))
            for variant in variants:
                if variant:
                    keys.add(variant)
                    by_key[variant].append(row)
    return keys, by_key


def parse_fields(rest):
    fields = {}
    for match in FIELD_RE.finditer(rest):
        fields[match.group("key").strip()] = match.group("value").strip()
    return fields


def parse_visual_plan(path):
    text = read_optional_text(path)
    beats = []
    for match in BEAT_RE.finditer(text):
        start = float(match.group("start"))
        end = float(match.group("end"))
        fields = parse_fields(match.group("rest"))
        rest = match.group("rest").strip()
        excerpt = ""
        if "Excerpt:" in rest:
            excerpt = rest.split("Excerpt:", 1)[1].strip()
        beats.append(
            {
                "index": int(match.group("index")),
                "start": start,
                "end": end,
                "duration": max(0.0, end - start),
                "asset": match.group("asset").strip(),
                "role": fields.get("role", ""),
                "source_role": fields.get("source_role", ""),
                "motion_style": fields.get("motion_style", ""),
                "match_strength": fields.get("match_strength", ""),
                "visual_category": fields.get("visual_category", ""),
                "rest": rest,
                "excerpt": excerpt,
            }
        )
    return text, beats


def add_check(checks, blockers, warnings, name, passed, detail, blocker=True):
    check = {"name": name, "passed": bool(passed), "detail": detail, "blocker": bool(blocker)}
    checks.append(check)
    if passed:
        return
    if blocker:
        blockers.append(f"{name}: {detail}")
    else:
        warnings.append(f"{name}: {detail}")


def banned_meta_hits(text, label):
    hits = []
    lowered = text.lower()
    lines = text.splitlines()
    for phrase, reason in BANNED_META_PATTERNS.items():
        if phrase not in lowered:
            continue
        for number, line in enumerate(lines, 1):
            if phrase in line.lower():
                hits.append({"source": label, "line": number, "phrase": phrase, "reason": reason, "text": line.strip()[:240]})
    return hits


def tokenize(text):
    return [token for token in re.findall(r"[a-z0-9]+", str(text or "").lower()) if token not in STOPWORDS and len(token) > 2]


def topic_keywords(metadata, script_text):
    title = metadata.get("selected_title") or metadata.get("default_title") or ""
    description = metadata.get("description") or ""
    guru = metadata.get("guru_growth_system") or {}
    locked = (guru.get("packaging_lock_before_script") or {}).get("locked_fields") or {}
    proof_object = locked.get("proof_object", "")
    first_hook = locked.get("first_hook", "")
    candidates = Counter(tokenize(" ".join([title, description, proof_object, first_hook, script_text[:800]])))
    return [token for token, count in candidates.most_common(12) if count >= 1]


def repeated_visual_issues(beats):
    blockers = []
    warnings = []
    by_asset = defaultdict(list)
    for beat in beats:
        by_asset[normalize_key(beat["asset"])].append(beat)
    for previous, current in zip(beats, beats[1:]):
        if normalize_key(previous["asset"]) != normalize_key(current["asset"]):
            continue
        combined = " ".join([previous.get("rest", ""), current.get("rest", ""), current.get("motion_style", "")]).lower()
        has_new_purpose = any(term in combined for term in ALLOWED_REPEAT_PURPOSE_TERMS)
        if not has_new_purpose or current.get("rest") == previous.get("rest"):
            blockers.append(
                {
                    "asset": current["asset"],
                    "previous_index": previous["index"],
                    "current_index": current["index"],
                    "reason": "reused adjacent visual without a new crop, label, comparison, motion purpose, or evidence reveal",
                }
            )
    for asset, asset_beats in by_asset.items():
        if len(asset_beats) <= 2:
            continue
        purposes = {
            "|".join([beat.get("role", ""), beat.get("source_role", ""), beat.get("motion_style", ""), beat.get("visual_category", "")])
            for beat in asset_beats
        }
        if len(purposes) < min(3, len(asset_beats)):
            warnings.append(
                {
                    "asset": asset,
                    "count": len(asset_beats),
                    "reason": "asset appears repeatedly; verify each reuse reveals new information",
                }
            )
    return blockers, warnings


def rights_coverage(beats, rows):
    keys, by_key = ledger_keys(rows)
    missing = []
    matched = []
    for beat in beats:
        candidates = asset_match_keys(beat["asset"])
        hit = sorted(candidates & keys)
        if hit:
            matched.append({"beat": beat["index"], "asset": beat["asset"], "ledger_key": hit[0]})
        else:
            missing.append({"beat": beat["index"], "asset": beat["asset"]})
    return matched, missing, by_key


def first_30_report(beats, metadata, script_text):
    first = [beat for beat in beats if beat["start"] < FIRST_30_SECONDS]
    proof = [
        beat
        for beat in first
        if beat.get("role") in PROOF_ROLES
        or beat.get("source_role") in PROOF_SOURCE_ROLES
        or "source" in beat.get("visual_category", "")
        or "map" in beat.get("visual_category", "")
    ]
    context_only = [beat for beat in first if beat.get("role") in CONTEXT_ONLY_ROLES or beat.get("source_role") in CONTEXT_ONLY_ROLES]
    keyword_list = topic_keywords(metadata, script_text)
    first_text = " ".join(" ".join([beat.get("asset", ""), beat.get("rest", ""), beat.get("excerpt", "")]) for beat in first).lower()
    present_keywords = [keyword for keyword in keyword_list if keyword in first_text]
    city_terms = [keyword for keyword in keyword_list if keyword in {"detroit", "cleveland", "chicago", "miami", "pittsburgh", "buffalo", "atlanta", "stlouis", "st", "louis"}]
    city_present = not city_terms or any(term in first_text for term in city_terms)
    return {
        "beat_count": len(first),
        "proof_beat_count": len(proof),
        "context_only_beat_count": len(context_only),
        "topic_keywords": keyword_list,
        "present_keywords": present_keywords,
        "city_present": city_present,
        "proof_beats": [beat["index"] for beat in proof],
        "context_only_beats": [beat["index"] for beat in context_only],
    }


def retention_gaps(beats):
    if not beats:
        return []
    gaps = []
    previous_end = 0.0
    for beat in beats:
        if beat["start"] - previous_end > MAX_MEANINGFUL_VISUAL_GAP_SECONDS:
            gaps.append({"from": previous_end, "to": beat["start"], "gap_seconds": beat["start"] - previous_end})
        if beat["duration"] > MAX_MEANINGFUL_VISUAL_GAP_SECONDS:
            gaps.append({"from": beat["start"], "to": beat["end"], "gap_seconds": beat["duration"], "beat": beat["index"]})
        previous_end = max(previous_end, beat["end"])
    return gaps


def ai_policy(rows, beats):
    ai_rows = []
    blockers = []
    beat_text = "\n".join(" ".join([beat["asset"], beat.get("rest", "")]) for beat in beats).lower()
    for row in rows:
        source_class = str(row.get("source_class", "")).lower()
        disclosure = str(row.get("ai_reconstruction_disclosure", "")).strip().lower()
        row_text = " ".join(str(row.get(field, "")) for field in ("filename", "local_path", "notes", "tool", "source_title")).lower()
        is_ai = source_class == "ai_reconstruction" or "ai reconstruction" in row_text or "generated reconstruction" in row_text
        if not is_ai:
            continue
        ai_rows.append(row)
        if not disclosure or disclosure == "not_ai_reconstruction":
            blockers.append({"asset": row.get("filename") or row.get("local_path"), "reason": "AI reconstruction lacks explicit disclosure"})
        if (row.get("filename") and row.get("filename", "").lower() in beat_text) and "archival" in beat_text:
            blockers.append({"asset": row.get("filename"), "reason": "AI reconstruction may be framed as archival evidence"})
    return {"ai_reconstruction_rows": len(ai_rows), "blockers": blockers}


def build_episode_standard_report(video_id):
    root = output_root(video_id)
    launch = launch_root(video_id)
    approval = ensure_dir(root / "approval")
    script_path = launch / "final-script.md"
    voiceover_path = root / "audio" / "voiceover_full.txt"
    visual_plan_path = root / "video" / f"pattern-lab-video-{video_id}-visual-beat-plan.md"
    metadata_path = approval / "upload-metadata.json"
    ledger_path = root / "rights-ledger.csv"

    script = read_optional_text(script_path)
    voiceover = read_optional_text(voiceover_path)
    visual_text, beats = parse_visual_plan(visual_plan_path)
    metadata = read_json(metadata_path) or {}
    rows = read_ledger(ledger_path)
    checks = []
    blockers = []
    warnings = []

    meta_hits = banned_meta_hits(script, display_path(script_path)) + banned_meta_hits(voiceover, display_path(voiceover_path))
    add_check(
        checks,
        blockers,
        warnings,
        "no_meta_production_language",
        not meta_hits,
        f"{len(meta_hits)} banned narration/meta-language hit(s)",
    )
    add_check(checks, blockers, warnings, "visual_plan_exists", bool(visual_text), display_path(visual_plan_path))
    add_check(checks, blockers, warnings, "visual_beat_count", len(beats) >= MIN_VISUAL_BEATS, f"{len(beats)} parsed visual beats")

    first_30 = first_30_report(beats, metadata, script)
    add_check(
        checks,
        blockers,
        warnings,
        "first_30_has_proof_payoff",
        first_30["proof_beat_count"] >= MIN_FIRST_30_PROOF_BEATS,
        f"{first_30['proof_beat_count']} proof beat(s) in first 30 seconds",
    )
    add_check(
        checks,
        blockers,
        warnings,
        "first_30_matches_title_topic",
        first_30["city_present"] and len(first_30["present_keywords"]) >= 2,
        f"present topic keywords: {', '.join(first_30['present_keywords'][:8]) or 'none'}",
    )
    add_check(
        checks,
        blockers,
        warnings,
        "stock_context_not_first_proof",
        first_30["proof_beat_count"] > 0 and first_30["context_only_beat_count"] <= first_30["proof_beat_count"],
        f"proof={first_30['proof_beat_count']}, context_only={first_30['context_only_beat_count']} in first 30 seconds",
    )

    repeat_blockers, repeat_warnings = repeated_visual_issues(beats)
    for warning in repeat_warnings:
        warnings.append(f"repeated_visual_warning: {warning['asset']} used {warning['count']} times; {warning['reason']}")
    add_check(
        checks,
        blockers,
        warnings,
        "no_unpurposeful_repeated_images",
        not repeat_blockers,
        f"{len(repeat_blockers)} repeated visual blocker(s)",
    )

    matched_assets, missing_assets, _ledger_by_key = rights_coverage(beats, rows)
    add_check(checks, blockers, warnings, "rights_ledger_exists", bool(rows), f"{len(rows)} rights-ledger row(s)")
    add_check(
        checks,
        blockers,
        warnings,
        "all_visual_assets_rights_logged",
        not missing_assets,
        f"{len(matched_assets)}/{len(beats)} beat asset(s) matched rights ledger; {len(missing_assets)} missing",
    )

    gaps = retention_gaps(beats)
    add_check(
        checks,
        blockers,
        warnings,
        "meaningful_visual_event_every_20_to_40_seconds",
        not gaps,
        f"{len(gaps)} visual gap/duration issue(s); max allowed {MAX_MEANINGFUL_VISUAL_GAP_SECONDS:.0f}s",
    )

    ai = ai_policy(rows, beats)
    add_check(
        checks,
        blockers,
        warnings,
        "ai_reconstructions_labeled_not_archival",
        not ai["blockers"],
        f"{ai['ai_reconstruction_rows']} AI reconstruction row(s); {len(ai['blockers'])} blocker(s)",
    )

    narrative_topic_terms = [keyword for keyword in first_30["topic_keywords"] if keyword in (script + " " + voiceover).lower()]
    add_check(
        checks,
        blockers,
        warnings,
        "script_answers_thumbnail_topic",
        len(narrative_topic_terms) >= 4,
        f"script/voiceover contains topic terms: {', '.join(narrative_topic_terms[:10]) or 'none'}",
    )

    status = "pass" if not blockers else "blocked"
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": status,
        "inputs": {
            "script": display_path(script_path),
            "voiceover_transcript": display_path(voiceover_path),
            "visual_plan": display_path(visual_plan_path),
            "upload_metadata": display_path(metadata_path),
            "rights_ledger": display_path(ledger_path),
        },
        "checks": checks,
        "blockers": blockers,
        "warnings": warnings,
        "meta_language_hits": meta_hits,
        "first_30": first_30,
        "repeated_visual_blockers": repeat_blockers,
        "rights_coverage": {
            "matched_count": len(matched_assets),
            "missing_count": len(missing_assets),
            "missing_assets": missing_assets[:100],
        },
        "retention_gaps": gaps,
        "ai_policy": ai,
    }

    json_path = approval / "episode-standard-report.json"
    md_path = approval / "episode-standard-report.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    lines = [
        f"# Pattern Lab Episode Standard: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {status}",
        "",
        "## Rule",
        "",
        "One city, one hidden-history question, one proof trail, and one visual payoff.",
        "",
        "## Checks",
        "",
    ]
    for check in checks:
        lines.append(f"- {check['name']}: {'pass' if check['passed'] else 'fail'} ({check['detail']})")
    lines.extend(["", "## Blockers", ""])
    lines.extend([f"- {blocker}" for blocker in blockers] or ["- none"])
    lines.extend(["", "## Meta-Language Hits", ""])
    if meta_hits:
        for hit in meta_hits[:50]:
            lines.append(f"- {hit['source']}:{hit['line']} `{hit['phrase']}` — {hit['text']}")
    else:
        lines.append("- none")
    lines.extend(["", "## Repeated Visual Blockers", ""])
    if repeat_blockers:
        for item in repeat_blockers[:50]:
            lines.append(f"- Beats {item['previous_index']}->{item['current_index']}: {item['asset']} ({item['reason']})")
    else:
        lines.append("- none")
    lines.extend(["", "## Rights Coverage", ""])
    lines.append(f"- Matched visual assets: {len(matched_assets)}/{len(beats)}")
    if missing_assets:
        for item in missing_assets[:50]:
            lines.append(f"- Missing ledger row for beat {item['beat']}: {item['asset']}")
    lines.extend(["", "## Warnings", ""])
    lines.extend([f"- {warning}" for warning in warnings] or ["- none"])
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Validate Pattern Lab episode/editorial standard gates.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, _json_path, md_path = build_episode_standard_report(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Episode standard report: {display_path(md_path)}")
    for blocker in payload["blockers"]:
        print(f"- {blocker}")
    raise SystemExit(0 if payload["status"] == "pass" else 1)


if __name__ == "__main__":
    main()
