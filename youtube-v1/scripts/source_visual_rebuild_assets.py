#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path

from patternlab_common import append_ledger, display_path, ensure_dir, ffmpeg_cmd, launch_root, media_duration_seconds, output_root, utc_now
from patternlab_visual_categories import classify_visual_category

USER_AGENT = "PatternLab/1.0 visual rebuild research"
MIN_HISTORICAL = 20
MIN_MODERN = 10
DEFAULT_HISTORICAL_MAX_YEAR = 1965

EVIDENCE_QUERY_FILE = "evidence-queries.json"


class ProviderRateLimited(RuntimeError):
    """A public source provider asked Pattern Lab to stop requesting content."""


class ProviderUnavailable(RuntimeError):
    """A sanctioned provider timed out or became temporarily unavailable."""


def provider_label(url):
    host = urllib.parse.urlparse(url).netloc.lower()
    if "loc.gov" in host:
        return "library_of_congress"
    if "wikimedia.org" in host:
        return "wikimedia_commons"
    return host or "public_source"


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise ProviderRateLimited(f"provider_rate_limited:{provider_label(url)}") from exc
        if exc.code >= 500:
            raise ProviderUnavailable(f"provider_unavailable:{provider_label(url)}:http_{exc.code}") from exc
        raise
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ProviderUnavailable(f"provider_unavailable:{provider_label(url)}") from exc


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


def flatten_metadata(value):
    """Normalize LOC's string-or-list metadata without changing source meaning."""
    if isinstance(value, (list, tuple)):
        return " ".join(flatten_metadata(item) for item in value if flatten_metadata(item))
    if value is None:
        return ""
    return str(value)


def load_evidence_queries(root, video_id):
    """Load explicit episode entities; never fall back to generic city scenery."""
    source_path = launch_root(video_id) / EVIDENCE_QUERY_FILE
    local_path = root / "source-packet" / "rebuild-v2" / EVIDENCE_QUERY_FILE
    path = source_path if source_path.exists() else local_path
    if not path.exists():
        raise SystemExit(
            f"Missing {display_path(path)}. Create explicit historical and modern evidence queries before sourcing media."
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Invalid evidence query file: {exc}") from exc
    historical = [str(item).strip() for item in payload.get("historical_queries", []) if str(item).strip()]
    modern = [str(item).strip() for item in payload.get("modern_context_queries", []) if str(item).strip()]
    entities = [str(item).strip().lower() for item in payload.get("required_entity_terms", []) if str(item).strip()]
    city_terms = [str(item).strip().lower() for item in payload.get("required_city_terms", []) if str(item).strip()]
    if not historical or not entities or not city_terms:
        raise SystemExit("Evidence query file requires historical_queries, required_entity_terms, and required_city_terms.")
    max_year = int(payload.get("historical_max_year", DEFAULT_HISTORICAL_MAX_YEAR))
    if max_year < 1800 or max_year > 2025:
        raise SystemExit("Evidence query file historical_max_year must be between 1800 and 2025.")
    return {"path": path, "historical": historical, "modern": modern, "entities": entities, "city_terms": city_terms, "historical_max_year": max_year}


def loc_search(query, page=1, count=80):
    params = {"q": query, "fo": "json", "c": str(count), "sp": str(page)}
    return fetch_json("https://www.loc.gov/photos/?" + urllib.parse.urlencode(params))


def entity_relevant(text, entities):
    lowered = str(text or "").lower()
    return any(entity in lowered for entity in entities)


def query_entity_terms(query, entities):
    """Return episode entities explicitly named by this individual source query."""
    lowered = str(query or "").lower()
    matched = [entity for entity in entities if entity in lowered]
    if not matched:
        raise ValueError(f"evidence_query_missing_required_entity:{query}")
    return matched


def metadata_years(value):
    """Extract plausible years from nested LOC metadata deterministically."""
    return [int(item) for item in re.findall(r"(?<!\d)(1[6-9]\d{2}|20\d{2})(?!\d)", flatten_metadata(value))]


def historical_date_eligible(item, max_year):
    """A proof asset must disclose a dated pre-cutover historical record."""
    values = [
        item.get("date"), item.get("created_published_date"), item.get("created"),
        item.get("date_created"), item.get("original_format"),
        item.get("DateTimeOriginal"), item.get("DateTime"),
    ]
    years = [year for value in values for year in metadata_years(value)]
    return bool(years) and min(years) <= max_year


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


def source_loc_assets(root, video_id, out_dir, queries):
    historical_dir = ensure_dir(out_dir / "historical")
    assets = []
    seen_urls = set()
    seen_titles = set()
    city_terms = queries.get("city_terms", ["detroit"])
    for query in queries["historical"]:
        query_entities = query_entity_terms(query, queries["entities"])
        page = 1
        while len(assets) < MIN_HISTORICAL and page <= 4:
            try:
                data = loc_search(query, page=page)
            except ProviderRateLimited as exc:
                print(f"historical provider paused: {exc}", flush=True)
                return assets
            except ProviderUnavailable as exc:
                print(f"historical provider unavailable: {exc}", flush=True)
                return assets
            except Exception as exc:
                print(f"historical query failed: {query}: {exc}", flush=True)
                break
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
                if not historical_date_eligible(item, queries["historical_max_year"]):
                    continue
                image = largest_jpeg_from_loc_item(item_data)
                if not image:
                    continue
                loc_id = item_url.rstrip("/").split("/")[-1]
                title = " ".join(item.get("title") or result.get("title") or [loc_id]) if isinstance(item.get("title"), list) else (item.get("title") or result.get("title") or loc_id)
                title_key = re.sub(r"\s+", " ", flatten_metadata(title).lower()).strip()
                if title_key in seen_titles:
                    continue
                relevance_text = " ".join([
                    flatten_metadata(title),
                    flatten_metadata(result.get("description", "")),
                    flatten_metadata(item.get("subject") or []),
                ])
                if not entity_relevant(relevance_text, query_entities) or not entity_relevant(relevance_text, city_terms):
                    continue
                seen_titles.add(title_key)
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
                    "notes": f"visual rebuild historical_evidence; query={query}; query-entity-matched source proof only",
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
            if len(assets) >= MIN_HISTORICAL:
                break
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


def source_commons_assets(root, video_id, out_dir, queries):
    modern_dir = ensure_dir(out_dir / "modern-context")
    assets = []
    seen_titles = set()
    for query in queries["modern"]:
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
            if not entity_relevant(title, queries["entities"]):
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


def commons_metadata_value(meta, key):
    return clean_html((meta.get(key) or {}).get("value"))


def source_commons_historical_assets(root, video_id, out_dir, queries, existing=None):
    """Use only dated, query-specific, commercially reusable Commons records as proof.

    Commons is a sanctioned fallback after LOC throttles.  It is deliberately
    stricter than the modern-context collector: a candidate needs a disclosed
    pre-cutover historical date, an episode-entity match in its item metadata,
    and a compatible item-level license before it can enter the evidence lane.
    """
    historical_dir = ensure_dir(out_dir / "historical")
    assets = list(existing or [])
    seen_titles = {str(item.get("source_title", "")).strip().lower() for item in assets}
    city_terms = queries.get("city_terms", ["detroit"])
    for query in queries["historical"]:
        if len(assets) >= MIN_HISTORICAL:
            break
        query_entities = query_entity_terms(query, queries["entities"])
        try:
            titles = commons_search_titles(query, limit=30)
        except (ProviderRateLimited, ProviderUnavailable) as exc:
            print(f"historical provider paused: {exc}", flush=True)
            break
        except Exception as exc:
            print(f"historical Commons query failed: {query}: {exc}", flush=True)
            continue
        for title in titles:
            if len(assets) >= MIN_HISTORICAL or title.lower() in seen_titles:
                continue
            try:
                info = commons_info(title)
            except (ProviderRateLimited, ProviderUnavailable) as exc:
                print(f"historical provider paused: {exc}", flush=True)
                return assets
            except Exception:
                continue
            if not info or not str(info.get("mime", "")).startswith("image/"):
                continue
            meta = info.get("extmetadata") or {}
            license_short = commons_metadata_value(meta, "LicenseShortName")
            if not license_compatible(license_short):
                continue
            item_date = commons_metadata_value(meta, "DateTimeOriginal") or commons_metadata_value(meta, "DateTime")
            if not historical_date_eligible({"DateTimeOriginal": item_date}, queries["historical_max_year"]):
                continue
            description = commons_metadata_value(meta, "ImageDescription")
            categories = commons_metadata_value(meta, "Categories")
            relevance_text = " ".join([title, description, categories])
            if not entity_relevant(relevance_text, query_entities) or not entity_relevant(relevance_text, city_terms):
                continue
            description_url = info.get("descriptionurl") or "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
            download_url = info.get("thumburl") or info.get("url")
            if not download_url:
                continue
            extension = ".png" if ".png" in download_url.lower() else ".jpg"
            clean_title = title.replace("File:", "")
            slug = safe_slug(clean_title, f"commons-historical-{len(assets) + 1:02d}")
            target = historical_dir / f"commons-historical-{len(assets) + 1:02d}-{slug}{extension}"
            try:
                download(download_url, target)
            except Exception:
                continue
            rel = target.relative_to(root)
            artist = commons_metadata_value(meta, "Artist") or "Wikimedia Commons contributor"
            license_url = commons_metadata_value(meta, "LicenseUrl") or description_url
            asset = {
                "asset_id": f"video-{video_id}-visual-rebuild-commons-historical-{len(assets) + 1:02d}",
                "asset_type": "image",
                "filename": str(rel),
                "local_path": str(rel),
                "tool": "Wikimedia Commons API",
                "model_or_service": "Commons imageinfo API",
                "source_prompt_or_source_file": download_url,
                "source_title": clean_title,
                "source_url": description_url,
                "creator": artist,
                "archive_or_platform": "Wikimedia Commons",
                "source_class": "historical_evidence",
                "license_or_rights_basis": f"{license_short}; item page {description_url}; license {license_url}",
                "license_status": license_short,
                "attribution_required": "yes" if "cc" in license_short.lower() or "gfdl" in license_short.lower() else "no",
                "attribution_text": f"{clean_title}; {artist}; {license_short}; {description_url}",
                "commercial_use_ok": "yes",
                "modification_ok": "yes",
                "recognizable_people_property_trademark_risk": "low: historical collection item; owner review still required",
                "ai_reconstruction_disclosure": "not_ai_reconstruction",
                "created_at": utc_now(),
                "notes": f"visual rebuild historical_evidence; query={query}; historical date={item_date}; query-entity-matched source proof only",
                "human_review_required": "yes",
                "human_review_status": "pending",
                "license_url": license_url,
                "historical_date": item_date,
            }
            asset.update(classify_visual_category(root, target, clean_title, "historical_evidence", {str(rel): asset, target.name: asset}))
            append_ledger(root, asset)
            assets.append(asset)
            seen_titles.add(title.lower())
            print(f"historical {len(assets)}/{MIN_HISTORICAL}: {target.name}", flush=True)
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


def write_reports(root, video_id, out_dir, historical, modern, queries):
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
        "evidence_query_file": display_path(queries["path"]),
        "historical_queries": queries["historical"],
        "modern_context_queries": queries["modern"],
        "required_entity_terms": queries["entities"],
        "required_city_terms": queries.get("city_terms", []),
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
        f"Query file: {payload['evidence_query_file']}",
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
    parser = argparse.ArgumentParser(description="Source claim-specific, rights-safe real media for a Pattern Lab visual rebuild.")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--reuse-if-ready", action="store_true", help="Skip network sourcing when the visual rebuild manifest already meets production floors.")
    args = parser.parse_args()
    root = output_root(args.video_id)
    out_dir = ensure_dir(root / "source-packet" / "visual-rebuild")
    queries = load_evidence_queries(root, args.video_id)
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
                queries,
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
    historical = source_loc_assets(root, args.video_id, out_dir, queries)
    if len(historical) < MIN_HISTORICAL:
        historical = source_commons_historical_assets(root, args.video_id, out_dir, queries, existing=historical)
    modern = source_pexels_frame_assets(root, args.video_id, out_dir)
    if len(modern) < MIN_MODERN:
        try:
            modern = source_commons_assets(root, args.video_id, out_dir, queries)
        except Exception as exc:
            print(f"modern context Commons fallback skipped: {exc}", flush=True)
    payload, manifest, md = write_reports(root, args.video_id, out_dir, historical, modern, queries)
    print(json.dumps({"status": payload["status"], "historical_count": len(historical), "modern_context_count": len(modern), "manifest": display_path(manifest), "report": display_path(md)}, indent=2))
    if payload["status"] != "ready":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
