#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

from patternlab_common import BASE, display_path, ensure_dir, output_root, utc_now


def read_json(path):
    path = Path(path)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def read_text(path):
    path = Path(path)
    return path.read_text(encoding="utf-8") if path.exists() else ""


def selected_headlines(policy):
    return {item.get("filename", ""): item for item in policy.get("required_candidates", [])}


def city_possessive(city):
    city_upper = city.upper()
    return f"{city_upper}'" if city_upper.endswith("S") else f"{city_upper}'S"


def format_city_template(template, city):
    return template.replace("{CITY_POSSESSIVE}", city_possessive(city)).replace("{CITY}", city.upper())


def infer_city_from_text(text):
    match = re.match(r"^([A-Z][A-Za-z]*(?:\\s+[A-Z][A-Za-z]*){0,2})(?:\\b|')", (text or "").strip())
    if not match:
        return ""
    city = match.group(1).strip()
    return "" if city in {"The", "This", "What", "Why", "How", "Before", "After", "Not"} else city


def active_city(metadata, policy):
    for key in ("city", "active_city", "target_city"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for value in [metadata.get("default_title", ""), *(metadata.get("title_options") or [])]:
        inferred = infer_city_from_text(value)
        if inferred:
            return inferred
    return policy.get("city_name_policy", {}).get("active_city", "Detroit")


def build_review_concepts(policy, city):
    concepts = []
    for item in policy.get("review_concept_families", []):
        headline = format_city_template(item.get("headline_template", item.get("headline", "")), city)
        concepts.append(
            {
                "concept_id": item.get("concept_id", ""),
                "headline": headline,
                "family": item.get("family", ""),
                "city_name_requirement": "City name must be primary or co-primary text and readable in the local search shelf test.",
                "required_elements": item.get("required_elements", []),
                "composition_rules": [
                    "Make the active city name the largest or co-largest text element.",
                    "Every visible word must have viewer-facing intent; remove filler and internal terms.",
                    "Verify active-city spelling and no clipped/cut-off text after render.",
                    "Use one dominant rights-ledgered real photo, map, or document as the base.",
                    "Never stretch or squeeze source images; crop proportionally only.",
                    "Prefer the owner-rated current workflow baseline; do not default to the rejected major-experimental layouts unless explicitly requested.",
                    "For redrawn concepts, use a map, street grid, highway map, or map/photo hybrid.",
                    "For underground concepts, use tunnel, sewer, subway, utility, or hidden-system imagery; generic AI support must be non-proof.",
                    "For redacted concepts, redact complete words only and make the curiosity hook prominent.",
                    "For lost-streets concepts, use street, road-grid, map, block, demolition, or void imagery; never use rail/track-only photos for that promise.",
                    "For then/now concepts, keep THEN fully left, NOW fully right, and use a bright/current skyline or modern city image on NOW.",
                    "Keep main words and recognizable city subjects inside safe zones and away from the lower-right timestamp area.",
                    "Use one major proof mark only: route line, tear line, clean split, map glow, or document/redaction prop; arrows only when the story is literally about a route/map/path.",
                    "Use competitive search-result contrast: yellow/white city text, thick black stroke/shadow, one vivid accent, dark edges, bright focal point.",
                    "Reject source-board clutter, tiny source labels, multi-box research boards, generic AI cityscapes, fake archival proof, and public-facing labels such as SOURCE PHOTO, SOURCE, PROOF, or MAP PROOF.",
                    "Use style-specific realism: redacted documents need readable sentence fragments; newspaper designs need masthead/body columns/caption; then/now designs need THEN left and NOW right.",
                ],
            }
        )
    return concepts


def candidate_text(filename, role, policy, metadata):
    selected = selected_headlines(policy).get(filename, {})
    city = metadata.get("_active_city", "Detroit")
    if selected.get("headline_template"):
        return format_city_template(selected["headline_template"], city)
    if selected.get("headline"):
        return selected["headline"]
    default_title = metadata.get("default_title", "")
    if role == "emotional_mystery":
        return format_city_template("{CITY} WAS REDRAWN", city)
    if role == "map_system_proof":
        return format_city_template("{CITY_POSSESSIVE} HIDDEN MAP", city)
    return format_city_template("{CITY_POSSESSIVE} FALL EXPLAINED", city)


def build_candidates(policy, metadata):
    candidates = []
    for item in policy.get("required_candidates", []):
        role = item.get("role", "")
        filename = item.get("filename", "")
        text = candidate_text(filename, role, policy, metadata)
        candidates.append(
            {
                "filename": filename,
                "role": role,
                "goal": item.get("goal", ""),
                "thumbnail_text": text,
                "source_review_concept": item.get("source_review_concept", ""),
                "city_name_treatment": "The active city must be primary or co-primary, not a small tag; readable at phone and search-shelf size.",
                "city_anchor": "Use a clear active-city anchor: skyline, street, landmark, factory, station, route, neighborhood, waterfront, map label, or another instantly legible city clue.",
                "proof_object": "Use one logged proof object: route line, map scar, archival photo subject, dated source detail, building/station/factory clue, neighborhood outline, or simple then/now split.",
                "visual_contradiction": "Show one tension: city redrawn vs generic decline, old vs new, vanished place, route line cutting through place, familiar story vs source, or one object that explains the city.",
                "composition_rules": [
                    "Make the city name the primary or co-primary type block.",
                    "Every visible word must earn its place and map to city, curiosity, time comparison, source promise, or intentional prop text.",
                    "Verify spelling/OCR-readiness and no clipped text before owner review.",
                    "Use one dominant real photo/map/document as the base.",
                    "Preserve source aspect ratio; no stretched or squeezed city images.",
                    "Apply the owner-rated current workflow baseline; current high-rated redrawn/underground styles beat the rejected experimental set.",
                    "Match image semantics to text: redrawn needs map/grid, hidden/under-city needs underground support, lost streets needs streets/map/blocks, and then/now needs strict left/right split.",
                    "Redacted props must redact whole words only and should elevate the curiosity hook over administrative-looking labels.",
                    "Prefer people, workers, crowds, transit, street life, factories, attractions, landmarks, demolition, or strong place/action interest.",
                    "Keep important text and landmarks out of edge/timestamp danger zones.",
                    "Use at most one major proof mark: route line, tear line, clean split, map glow, or document/redaction prop; arrows only when route/map/path-specific.",
                    "Use thumbnail-grade contrast: yellow/white city text, darker edges, brighter focal point, one bold accent color, thick text stroke/shadow.",
                    "Reject source-board clutter, tiny captions, many boxes, thin grids, small labels, and internal words such as SOURCE PHOTO, SOURCE, PROOF, or MAP PROOF."
                ],
                "canva_brief": "Render as a city-first Pattern Lab historical-mystery thumbnail: dominant active-city text, one dominant real source photo, one proof cue, 2-4 intentional words, strong search-shelf contrast, no distortion, no cut-off text, no source-board clutter, no watermark, no Pro-locked Free-plan asset.",
            }
        )
    return candidates


def build_brief(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    metadata = read_json(approval / "upload-metadata.json")
    thumbnail_policy = read_json(BASE / "resources" / "thumbnail-click-policy.json")
    source_policy = read_json(BASE / "resources" / "source-media-policy.json")
    art_policy = read_json(BASE / "resources" / "thumbnail-10x-art-direction-policy.json")
    city = active_city(metadata, thumbnail_policy)
    metadata["_active_city"] = city
    prompts_path = BASE / "launch" / f"video-{video_id}" / "image-prompts.md"
    prompts = read_text(prompts_path)
    candidates = build_candidates(thumbnail_policy, metadata)
    review_concepts = build_review_concepts(thumbnail_policy, city)
    return {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "ready_for_canva_render",
        "active_city": city,
        "city_agnostic": True,
        "canonical_sequence": "OpenClaw strategy/source safety -> Canva plugin render -> OpenClaw validation -> owner review / YouTube test",
        "canva_role": "Canva is the rendering engine only. OpenClaw owns strategy, source safety, rights ledger checks, title-thumbnail promise matching, validation, owner review packet, and YouTube testing notes.",
        "canva_free_rule": thumbnail_policy.get("canva_renderer_policy", {}).get("canva_free_rule", ""),
        "hard_reject": thumbnail_policy.get("canva_renderer_policy", {}).get("hard_reject", []),
        "default_title": metadata.get("default_title", ""),
        "title_options": metadata.get("title_options", []),
        "default_thumbnail": metadata.get("default_thumbnail", "images/thumbnail_candidate_a.png"),
        "source_policy_path": "youtube-v1/resources/source-media-policy.json",
        "thumbnail_policy_path": "youtube-v1/resources/thumbnail-click-policy.json",
        "autonomous_architecture_path": "youtube-v1/workflows/autonomous-production-architecture.md",
        "image_prompts_path": display_path(prompts_path),
        "image_prompts_present": bool(prompts),
        "source_roles": source_policy.get("source_roles", {}),
        "ten_x_art_direction_policy_path": "youtube-v1/resources/thumbnail-10x-art-direction-policy.json",
        "current_thumbnail_renderer": art_policy.get("current_state", {}).get("final_renderer", "Swift/AppKit deterministic composite"),
        "current_image_generator": "none_for_final_thumbnail_rendering",
        "recommended_free_ai_support_generator": art_policy.get("image_generator_recommendation", {}).get("free_first", ""),
        "recommended_premium_ai_support_generator": art_policy.get("image_generator_recommendation", {}).get("best_quality_if_paid_or_subscription_is_approved", ""),
        "output_directory": display_path(root / "images"),
        "review_concepts": review_concepts,
        "candidates": candidates,
        "owner_review_notes": [
            "Owner must review the five city-first thumbnail concepts and the selected three production candidates before private/unlisted upload.",
            "Use the local thumbnail search shelf test before review; after publish, use YouTube A/B testing when available and choose by watch-time share first, then CTR and retention.",
            "Reject any design where the active city is a tiny tag, unreadable at phone/search-result size, watermarked, Pro-locked, unclear stock, fake archival proof, title-thumbnail mismatch, internal label, or random arrow.",
            "Reject any design with misspelled city text, cut-off headline text, distorted/squeezed images, meaningless filler words, overly dark/hidden focal subjects, or repeated owner-rejected title-bar/proof-card layout.",
            "Newspaper-style props require a fictional masthead, body columns, caption, and a pre-publication publication-name conflict check before public use.",
        ],
    }


def write_brief(video_id):
    root = output_root(video_id)
    approval = ensure_dir(root / "approval")
    payload = build_brief(video_id)
    json_path = approval / "canva-thumbnail-brief.json"
    md_path = approval / "canva-thumbnail-brief.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    lines = [
        f"# Pattern Lab Canva Thumbnail Brief: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Active city: {payload['active_city']}",
        f"City agnostic: {payload['city_agnostic']}",
        "",
        "## Required Sequence",
        "",
        f"`{payload['canonical_sequence']}`",
        "",
        "## Canva Role",
        "",
        payload["canva_role"],
        "",
        "## Canva Free Rule",
        "",
        payload["canva_free_rule"],
        "",
        "## Five City-First Review Concepts",
        "",
    ]
    for concept in payload.get("review_concepts", []):
        lines.extend([
            f"### {concept['headline']}: {concept['family']}",
            "",
            f"- City rule: {concept['city_name_requirement']}",
            "- Required elements:",
            *[f"  - {item}" for item in concept.get("required_elements", [])],
            "- Composition rules:",
            *[f"  - {rule}" for rule in concept.get("composition_rules", [])],
            "",
        ])
    lines.extend([
        "## Selected Production Candidates",
        "",
    ])
    for candidate in payload["candidates"]:
        lines.extend(
            [
                f"### {candidate['filename']}: {candidate['role']}",
                "",
                f"- Text: {candidate['thumbnail_text']}",
                f"- Goal: {candidate['goal']}",
                f"- City name treatment: {candidate['city_name_treatment']}",
                f"- City anchor: {candidate['city_anchor']}",
                f"- Proof object: {candidate['proof_object']}",
                f"- Visual contradiction: {candidate['visual_contradiction']}",
                "- Composition rules:",
                *[f"  - {rule}" for rule in candidate.get("composition_rules", [])],
                f"- Canva brief: {candidate['canva_brief']}",
                "",
            ]
        )
    lines.extend(
        [
            "## Hard Rejects",
            "",
            *[f"- {item}" for item in payload["hard_reject"]],
            "",
            "## Owner Review Notes",
            "",
            *[f"- {item}" for item in payload["owner_review_notes"]],
            "",
        ]
    )
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return payload, json_path, md_path


def main():
    parser = argparse.ArgumentParser(description="Generate a repo-local Canva thumbnail brief for Pattern Lab.")
    parser.add_argument("--video-id", default="03")
    args = parser.parse_args()
    payload, json_path, md_path = write_brief(args.video_id)
    print(f"Status: {payload['status']}")
    print(f"Canva thumbnail brief JSON: {display_path(json_path)}")
    print(f"Canva thumbnail brief Markdown: {display_path(md_path)}")


if __name__ == "__main__":
    main()
