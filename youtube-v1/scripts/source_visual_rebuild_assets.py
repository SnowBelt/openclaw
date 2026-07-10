#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

from patternlab_common import append_ledger, display_path, ensure_dir, ffmpeg_cmd, media_duration_seconds, output_root, utc_now
from patternlab_visual_categories import classify_visual_category

USER_AGENT = "PatternLab/1.0 visual rebuild research"
MIN_HISTORICAL = 20
MIN_MODERN = 10

COMMONS_QUERIES = [
    "Detroit skyline",
    "Detroit downtown",
    "Detroit Michigan Renaissance Center",
    "Detroit Financial District",
    "Detroit street",
    "Detroit station",
    "Detroit factory",
    "Detroit Riverfront",
    "Michigan Central Station Detroit",
    "Fisher Building Detroit",
]


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def download(url, target):
    target = Path(target)
    if target.exists() and target.stat().st_size > 0:
        return
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as response:
        target.write_bytes(response.read())


def safe_slug(text, fallback):
    slug = re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")
    return (slug[:80] or fallback).strip("-")


def loc_search(page=1, count=80):
    params = {"fa": "location:detroit", "fo": "json", "c": str(count), "sp": str(page)}
    return fetch_json("https://www.loc.gov/photos/?" + urllib.parse.urlencode(params))


def largest_jpeg_from_loc_item(item_data):
    candidates = []
    for resource in item_data.get("resources", []):
        for file_group in resource.get("files", []):
            for file_info in file_group:
                if file_info.get("mimetype") != "image/jpeg":
                    continue
                url = file_info.get("url") or ""
                width = int(file_info.get("width") or 0)
                height = int(file_info.get("height") or 0)
                size = int(file_info.get("size") or 0)
                if width < 640 and height < 480:
                    continue
                candidates.append({"url": url, "width": width, "height": height, "size": size})
    if not candidates:
        return None
    practical = [item for item in candidates if item["size"] and item["size"] <= 900_000]
    pool = practical or candidates
    return sorted(pool, key=lambda item: (item["width"] * item["height"], -item["size"]), reverse=True)[0]


def source_loc_assets(root, video_id, out_dir):
    historical_dir = ensure_dir(out_dir / "historical")
    assets = []
    seen_urls = set()
    page = 1
    while len(assets) < MIN_HISTORICAL and page <= 8:
        data = loc_search(page=page)
        page += 1
        for result in data.get("results", []):
            item_url = result.get("url") or ""
            if not item_url or item_url in seen_urls:
                continue
            seen_urls.add(item_url)
            try:
                item_data = fetch_json(item_url.rstrip("/") + "/?fo=json")
            except Exception:
                continue
            item = item_data.get("item", {})
            rights = " ".join(str(item.get(key) or "") for key in ["rights_information", "rights_advisory"]).lower()
            if "no known restrictions" not in rights and "public domain" not in rights:
                continue
            image = largest_jpeg_from_loc_item(item_data)
            if not image:
                continue
            loc_id = item_url.rstrip("/").split("/")[-1]
            title = " ".join(item.get("title") or result.get("title") or [loc_id]) if isinstance(item.get("title"), list) else (item.get("title") or result.get("title") or loc_id)
            slug = safe_slug(title, loc_id)
            filename = f"loc-{loc_id}-{slug}.jpg"
            target = historical_dir / filename
            try:
                download(image["url"], target)
            except Exception:
                continue
            rel = target.relative_to(root)
            asset = {
                "asset_id": f"video-{video_id}-visual-rebuild-loc-{loc_id}",
                "asset_type": "image",
                "filename": str(rel),
                "local_path": str(rel),
                "tool": "Library of Congress API",
                "model_or_service": "LOC public JSON and image services",
                "source_prompt_or_source_file": image["url"],
                "source_title": title,
                "source_url": item_url,
                "creator": "; ".join(item.get("creators") or item.get("contributor_names") or ["Library of Congress collection item"]),
                "archive_or_platform": "Library of Congress",
                "source_class": "historical_evidence",
                "license_or_rights_basis": item.get("rights_information") or item.get("rights_advisory") or "No known restrictions on publication.",
                "license_status": item.get("rights_advisory") or item.get("rights_information") or "No known restrictions on publication.",
                "attribution_required": "no",
                "attribution_text": f"{title}. Library of Congress. {item_url}",
                "commercial_use_ok": "yes",
                "modification_ok": "yes",
                "recognizable_people_property_trademark_risk": "low: archival public collection item; owner review still required",
                "ai_reconstruction_disclosure": "not_ai_reconstruction",
                "created_at": utc_now(),
                "notes": "visual rebuild historical_evidence; supports Detroit city context and source trail",
                "human_review_required": "yes",
                "human_review_status": "pending",
                "width": image["width"],
                "height": image["height"],
            }
            asset.update(classify_visual_category(root, target, title, "historical_evidence", {str(rel): asset, target.name: asset}))
            append_ledger(root, asset)
            assets.append(asset)
            print(f"historical {len(assets)}/{MIN_HISTORICAL}: {filename}", flush=True)
            if len(assets) >= MIN_HISTORICAL:
                break
    return assets


def commons_search_titles(query, limit=12):
    params = {
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srnamespace": "6",
        "srlimit": str(limit),
        "format": "json",
        "origin": "*",
    }
    data = fetch_json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params))
    return [item["title"] for item in data.get("query", {}).get("search", [])]


def commons_info(title):
    params = {
        "action": "query",
        "titles": title,
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|mime",
        "iiurlwidth": "1920",
        "format": "json",
        "origin": "*",
    }
    data = fetch_json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params))
    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        infos = page.get("imageinfo") or []
        if infos:
            return infos[0]
    return None


def clean_html(text):
    text = re.sub(r"<[^>]+>", "", str(text or ""))
    return re.sub(r"\s+", " ", text).strip()


def license_compatible(short_name):
    lowered = str(short_name or "").lower()
    blocked = ["noncommercial", "no derivatives", "nd", "nc", "fair use"]
    return lowered and not any(term in lowered for term in blocked) and any(
        term in lowered for term in ["cc", "public domain", "pd", "gfdl"]
    )


def source_commons_assets(root, video_id, out_dir):
    modern_dir = ensure_dir(out_dir / "modern-context")
    assets = []
    seen_titles = set()
    for query in COMMONS_QUERIES:
        if len(assets) >= MIN_MODERN:
            break
        for title in commons_search_titles(query):
            if title in seen_titles or len(assets) >= MIN_MODERN:
                continue
            seen_titles.add(title)
            try:
                info = commons_info(title)
            except Exception:
                continue
            if not info or not str(info.get("mime", "")).startswith("image/"):
                continue
            meta = info.get("extmetadata") or {}
            license_short = clean_html((meta.get("LicenseShortName") or {}).get("value"))
            if not license_compatible(license_short):
                continue
            source_url = clean_html((meta.get("UsageTerms") or {}).get("value"))
            description_url = info.get("descriptionurl") or "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
            download_url = info.get("thumburl") or info.get("url")
            if not download_url:
                continue
            ext = ".jpg"
            if ".png" in download_url.lower():
                ext = ".png"
            slug = safe_slug(title.replace("File:", ""), f"commons-{len(assets)+1:02d}")
            target = modern_dir / f"commons-{len(assets)+1:02d}-{slug}{ext}"
            try:
                download(download_url, target)
            except Exception:
                continue
            rel = target.relative_to(root)
            artist = clean_html((meta.get("Artist") or {}).get("value")) or "Wikimedia Commons contributor"
            credit = clean_html((meta.get("Credit") or {}).get("value"))
            license_url = clean_html((meta.get("LicenseUrl") or {}).get("value")) or description_url
            asset = {
                "asset_id": f"video-{video_id}-visual-rebuild-commons-{len(assets)+1:02d}",
                "asset_type": "image",
                "filename": str(rel),
                "local_path": str(rel),
                "tool": "Wikimedia Commons API",
                "model_or_service": "Commons imageinfo API",
                "source_prompt_or_source_file": download_url,
                "source_title": title.replace("File:", ""),
                "source_url": description_url,
                "creator": artist,
                "archive_or_platform": "Wikimedia Commons",
                "source_class": "modern_context",
                "license_or_rights_basis": f"{license_short}; item page {description_url}; license {license_url}",
                "license_status": license_short,
                "attribution_required": "yes" if "cc" in license_short.lower() or "gfdl" in license_short.lower() else "no",
                "attribution_text": f"{title.replace('File:', '')}; {artist}; {license_short}; {description_url}",
                "commercial_use_ok": "yes",
                "modification_ok": "yes",
                "recognizable_people_property_trademark_risk": "low: cityscape/building/street context; owner review still required",
                "ai_reconstruction_disclosure": "not_ai_reconstruction",
                "created_at": utc_now(),
                "notes": "modern city context only; supports pacing and atmosphere",
                "human_review_required": "yes",
                "human_review_status": "pending",
                "license_url": license_url,
                "credit": credit,
            }
            asset.update(classify_visual_category(root, target, title, "modern_context", {str(rel): asset, target.name: asset}))
            append_ledger(root, asset)
            assets.append(asset)
    return assets




def source_pexels_frame_assets(root, video_id, out_dir):
    modern_dir = ensure_dir(out_dir / "modern-context")
    source_video = root / "source-packet" / "media" / "pexels-970170-detroit-context.mp4"
    if not source_video.exists():
        return []
    try:
        duration = max(media_duration_seconds(source_video), 10.0)
    except Exception:
        duration = 40.0
    assets = []
    for index in range(1, MIN_MODERN + 1):
        timestamp = min(duration - 0.5, max(0.5, duration * index / (MIN_MODERN + 1)))
        target = modern_dir / f"pexels-970170-detroit-context-frame-{index:02d}.jpg"
        if not target.exists() or target.stat().st_size == 0:
            subprocess.run(
                [
                    ffmpeg_cmd(),
                    "-y",
                    "-ss",
                    f"{timestamp:.2f}",
                    "-i",
                    str(source_video),
                    "-frames:v",
                    "1",
                    "-q:v",
                    "2",
                    str(target),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        rel = target.relative_to(root)
        asset = {
            "asset_id": f"video-{video_id}-visual-rebuild-pexels-frame-{index:02d}",
            "asset_type": "image",
            "filename": str(rel),
            "local_path": str(rel),
            "tool": "FFmpeg frame extraction",
            "model_or_service": "Pexels stock video still frame",
            "source_prompt_or_source_file": str(source_video.relative_to(root)),
            "source_title": f"Detroit modern context stock video still {index:02d}",
            "source_url": "https://www.pexels.com/search/videos/detroit%20city/",
            "creator": "Pexels contributor; item-level creator not exposed in local source packet",
            "archive_or_platform": "Pexels",
            "source_class": "modern_context",
            "license_or_rights_basis": "Pexels License; free for commercial use and modification; https://www.pexels.com/license/",
            "license_status": "Pexels License",
            "attribution_required": "no",
            "attribution_text": "Pexels stock video still; attribution not required by Pexels license.",
            "commercial_use_ok": "yes",
            "modification_ok": "yes",
            "recognizable_people_property_trademark_risk": "low: city context frame; owner review still required",
            "ai_reconstruction_disclosure": "not_ai_reconstruction",
            "created_at": utc_now(),
            "notes": "modern city context only; supports pacing and atmosphere",
            "human_review_required": "yes",
            "human_review_status": "pending",
        }
        asset.update(classify_visual_category(root, target, asset["source_title"], "modern_context", {str(rel): asset, target.name: asset}))
        append_ledger(root, asset)
        assets.append(asset)
        print(f"modern {len(assets)}/{MIN_MODERN}: {target.name}", flush=True)
    return assets

def annotate_asset_categories(root, assets):
    annotated = []
    for asset in assets:
        rel = asset.get("local_path") or asset.get("filename") or ""
        path = root / rel if rel else Path(asset.get("filename", ""))
        source_role = asset.get("source_class", "")
        category = classify_visual_category(root, path, asset.get("source_title", ""), source_role, {rel: asset, Path(rel).name: asset})
        annotated.append({**asset, **category})
    return annotated


def write_reports(root, video_id, out_dir, historical, modern):
    approval = ensure_dir(root / "approval")
    historical = annotate_asset_categories(root, historical)
    modern = annotate_asset_categories(root, modern)
    category_counts = {}
    for item in historical + modern:
        category = item.get("visual_category", "unknown_context")
        category_counts[category] = category_counts.get(category, 0) + 1
    old_uploads = []
    for path in sorted(approval.glob("youtube-upload-report*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        old_uploads.append({"report": display_path(path), "youtube_url": data.get("youtube_url", ""), "privacy": data.get("privacy", ""), "status": data.get("status", "")})
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "status": "ready" if len(historical) >= MIN_HISTORICAL and len(modern) >= MIN_MODERN else "blocked",
        "visual_rebuild_dir": display_path(out_dir),
        "historical_count": len(historical),
        "modern_context_count": len(modern),
        "historical_assets": historical,
        "modern_context_assets": modern,
        "visual_category_counts": category_counts,
        "superseded_private_uploads": old_uploads,
        "public_publish": "blocked_due_failed_visual_review",
    }
    manifest = out_dir / "visual-rebuild-manifest.json"
    manifest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md = out_dir / "visual-rebuild-manifest.md"
    lines = [
        f"# Pattern Lab Visual Rebuild Source Pack: Video {video_id}",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Historical assets: {len(historical)}",
        f"Modern context assets: {len(modern)}",
        f"Visual categories: {', '.join(f'{key}={value}' for key, value in sorted(category_counts.items()))}",
        "",
        "## Failed Private Review Draft",
        "",
        "The prior private upload is frozen as a failed visual-review draft. Do not publish it.",
    ]
    lines.extend([f"- {item['youtube_url']} ({item['privacy']}, {item['status']})" for item in old_uploads] or ["- none recorded"])
    lines.extend(["", "## Historical Assets", ""])
    lines.extend([f"- `{item['filename']}` — {item['source_title']} — {item.get('visual_category', 'unknown_context')} ({item['source_url']})" for item in historical])
    lines.extend(["", "## Modern Context Assets", ""])
    lines.extend([f"- `{item['filename']}` — {item['source_title']} — {item.get('visual_category', 'unknown_context')} ({item['source_url']})" for item in modern])
    md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    repair = approval / "visual-rebuild-repair-note.md"
    repair.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return payload, manifest, md


def main():
    parser = argparse.ArgumentParser(description="Source rights-safe real media for the Pattern Lab Video 03 visual rebuild.")
    parser.add_argument("--video-id", default="03")
    parser.add_argument("--reuse-if-ready", action="store_true", help="Skip network sourcing when the visual rebuild manifest already meets production floors.")
    args = parser.parse_args()
    root = output_root(args.video_id)
    out_dir = ensure_dir(root / "source-packet" / "visual-rebuild")
    manifest = out_dir / "visual-rebuild-manifest.json"
    if args.reuse_if_ready and manifest.exists():
        try:
            payload = json.loads(manifest.read_text(encoding="utf-8"))
        except Exception:
            payload = {}
        historical_count = int(payload.get("historical_count") or 0)
        modern_count = int(payload.get("modern_context_count") or 0)
        if historical_count >= MIN_HISTORICAL and modern_count >= MIN_MODERN:
            refreshed, manifest, md = write_reports(
                root,
                args.video_id,
                out_dir,
                payload.get("historical_assets", []),
                payload.get("modern_context_assets", []),
            )
            print(json.dumps({
                "status": "ready",
                "mode": "reused-existing-source-pack-with-category-refresh",
                "historical_count": refreshed.get("historical_count", historical_count),
                "modern_context_count": refreshed.get("modern_context_count", modern_count),
                "visual_category_counts": refreshed.get("visual_category_counts", {}),
                "manifest": display_path(manifest),
                "report": display_path(md),
            }, indent=2))
            return
    historical = source_loc_assets(root, args.video_id, out_dir)
    modern = source_pexels_frame_assets(root, args.video_id, out_dir)
    if len(modern) < MIN_MODERN:
        try:
            modern = source_commons_assets(root, args.video_id, out_dir)
        except Exception as exc:
            print(f"modern context Commons fallback skipped: {exc}", flush=True)
    payload, manifest, md = write_reports(root, args.video_id, out_dir, historical, modern)
    print(json.dumps({"status": payload["status"], "historical_count": len(historical), "modern_context_count": len(modern), "manifest": display_path(manifest), "report": display_path(md)}, indent=2))
    if payload["status"] != "ready":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
