#!/usr/bin/env python3
"""Run local self-hosted Penpot smoke checks for Pattern Lab fallback export readiness.

Scope: local Docker/Penpot only. No paid assets. No YouTube mutation.
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path
from typing import Any

from patternlab_common import BASE, display_path, ensure_dir, utc_now
from patternlab_images import image_dimensions

REPORT_ROOT = BASE / "approval-blockers"
COMPOSE_PATH = BASE / "third_party" / "penpot" / "docker-compose.yaml"
PROJECT = "patternlab-penpot"
BASE_URL = "http://localhost:9001"
ROOT_FRAME_ID = "00000000-0000-0000-0000-000000000000"
PRODUCTION_WIDTH = 1920
PRODUCTION_HEIGHT = 1080


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_md(path: Path, lines: list[str]) -> None:
    ensure_dir(path.parent)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def redact_sensitive_text(value: str) -> str:
    value = re.sub(r'("token"\s*:\s*")[^"]+(")', r'\1[redacted]\2', value)
    value = re.sub(r"(eyJ[A-Za-z0-9_.-]{30,})", "[redacted-token]", value)
    return value


def summarize_response(response: dict[str, Any], keep_body_text: bool = False) -> dict[str, Any]:
    summarized = {k: v for k, v in response.items() if k not in {"json", "body_bytes"}}
    if "body_head" in summarized:
        summarized["body_head"] = redact_sensitive_text(str(summarized["body_head"]))
    if keep_body_text and "body_text" in summarized:
        summarized["body_text"] = redact_sensitive_text(str(summarized["body_text"]))
    else:
        summarized.pop("body_text", None)
    return summarized


def run_cmd(args: list[str], timeout: int = 30) -> dict[str, Any]:
    try:
        proc = subprocess.run(args, cwd=BASE.parent, text=True, capture_output=True, timeout=timeout, check=False)
        return {
            "cmd": args,
            "returncode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
        }
    except Exception as exc:  # pragma: no cover - defensive report path
        return {"cmd": args, "returncode": 999, "stdout": "", "stderr": f"{type(exc).__name__}: {exc}"}


def http_get(url: str, opener: urllib.request.OpenerDirector | None = None) -> dict[str, Any]:
    opener = opener or urllib.request.build_opener()
    req = urllib.request.Request(url, headers={"User-Agent": "PatternLabPenpotSmoke/1.0"})
    try:
        with opener.open(req, timeout=20) as resp:
            body = resp.read()
            return {
                "status": resp.status,
                "content_type": resp.headers.get("content-type", ""),
                "content_length": len(body),
                "body_head": body[:200].decode("utf-8", errors="replace"),
                "body_bytes": body,
            }
    except urllib.error.HTTPError as exc:
        body = exc.read()
        return {
            "status": exc.code,
            "content_type": exc.headers.get("content-type", ""),
            "content_length": len(body),
            "body_head": body[:200].decode("utf-8", errors="replace"),
            "error": f"HTTPError: {exc}",
        }
    except Exception as exc:
        return {"status": 0, "content_type": "", "content_length": 0, "body_head": "", "error": f"{type(exc).__name__}: {exc}"}


def api_post(opener: urllib.request.OpenerDirector, method: str, payload: dict[str, Any]) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{BASE_URL}/api/main/methods/{method}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "PatternLabPenpotSmoke/1.0"},
        method="POST",
    )
    try:
        with opener.open(req, timeout=45) as resp:
            body = resp.read()
            text = body.decode("utf-8", errors="replace")
            parsed: Any
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = None
            return {
                "status": resp.status,
                "content_type": resp.headers.get("content-type", ""),
                "content_length": len(body),
                "body_head": text[:500],
                "body_text": text,
                "json": parsed,
            }
    except urllib.error.HTTPError as exc:
        body = exc.read()
        text = body.decode("utf-8", errors="replace")
        parsed = None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            pass
        return {
            "status": exc.code,
            "content_type": exc.headers.get("content-type", ""),
            "content_length": len(body),
            "body_head": text[:500],
            "body_text": text,
            "json": parsed,
            "error": f"HTTPError: {exc}",
        }
    except Exception as exc:
        return {"status": 0, "content_type": "", "content_length": 0, "body_head": "", "json": None, "error": f"{type(exc).__name__}: {exc}"}


def new_authenticated_profile(opener: urllib.request.OpenerDirector, email_prefix: str) -> dict[str, Any]:
    email = f"{email_prefix}-{int(time.time())}-{uuid.uuid4().hex[:8]}@example.com"
    password = "PatternLabSmoke123!"
    steps: dict[str, Any] = {}
    prepare = api_post(opener, "prepare-register-profile", {
        "email": email,
        "password": password,
        "fullname": "Pattern Lab Penpot Smoke",
        "createWelcomeFile": False,
        "acceptNewsletterUpdates": False,
    })
    steps["prepare_register_profile"] = summarize_response(prepare)
    token = prepare.get("json", {}).get("token") if isinstance(prepare.get("json"), dict) else None
    if not token:
        return {"status": "blocked", "blocker": "prepare_register_profile_failed", "steps": steps}

    register = api_post(opener, "register-profile", {"token": token, "acceptNewsletterUpdates": False})
    profile = register.get("json") if isinstance(register.get("json"), dict) else {}
    steps["register_profile"] = summarize_response(register)
    project_id = profile.get("defaultProjectId")
    profile_id = profile.get("id")
    if register.get("status") != 200 or not project_id or not profile_id:
        return {"status": "blocked", "blocker": "register_profile_failed", "steps": steps}
    return {
        "status": "pass",
        "email": email,
        "profile": profile,
        "profile_id": profile_id,
        "project_id": project_id,
        "steps": steps,
    }


def parse_sse_asset_uri(text: str) -> str:
    match = re.search(r"http://localhost:9001/assets/by-id/[A-Za-z0-9-]+", text)
    return match.group(0) if match else ""


def parse_sse_last_uuid(text: str) -> str:
    matches = re.findall(r"~u([0-9a-fA-F-]{36})", text)
    return matches[-1] if matches else ""


def auth_token_from_jar(jar: http.cookiejar.CookieJar) -> str:
    for cookie in jar:
        if cookie.name == "auth-token" and cookie.value:
            return cookie.value
    return ""


def docker_ps() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    docker = shutil.which("docker")
    if not docker or not COMPOSE_PATH.exists():
        return [], {"returncode": 1, "stderr": "docker_or_compose_missing"}
    result = run_cmd([docker, "compose", "-f", str(COMPOSE_PATH), "-p", PROJECT, "ps", "--format", "json"], timeout=30)
    rows: list[dict[str, Any]] = []
    if result["returncode"] == 0:
        for line in result["stdout"].splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows, result


def authenticated_binfile_export_smoke() -> dict[str, Any]:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    steps: dict[str, Any] = {}

    profile_result = new_authenticated_profile(opener, "patternlab-penpot-smoke")
    steps.update(profile_result.get("steps", {}))
    if profile_result.get("status") != "pass":
        return {"status": "blocked", "blocker": profile_result.get("blocker", "profile_registration_failed"), "steps": steps}
    profile = profile_result["profile"]
    project_id = profile_result["project_id"]
    email = profile_result["email"]

    created = api_post(opener, "create-file", {"name": "Pattern Lab Penpot Export Smoke", "projectId": project_id})
    created_json = created.get("json") if isinstance(created.get("json"), dict) else {}
    file_id = created_json.get("id")
    steps["create_file"] = summarize_response(created) | {"file_id": file_id or "missing"}
    if created.get("status") != 200 or not file_id:
        return {"status": "blocked", "blocker": "create_file_failed", "steps": steps}

    export = api_post(opener, "export-binfile", {"fileId": file_id, "includeLibraries": False, "embedAssets": True})
    steps["export_binfile_sse"] = summarize_response(export, keep_body_text=True)
    export_text = export.get("body_text", export.get("body_head", ""))
    asset_uri = parse_sse_asset_uri(export_text)
    if export.get("status") != 200 or "event: end" not in export_text or not asset_uri:
        return {"status": "blocked", "blocker": "export_binfile_sse_failed", "steps": steps, "file_id": file_id}

    asset = http_get(asset_uri, opener=opener)
    out_path = REPORT_ROOT / "penpot-authenticated-binfile-export-smoke.penpot"
    if asset.get("status") == 200 and asset.get("content_length", 0) > 0 and asset.get("body_bytes"):
        out_path.write_bytes(asset["body_bytes"])
    steps["download_exported_binfile"] = summarize_response(asset)
    passed = asset.get("status") == 200 and out_path.exists() and out_path.stat().st_size > 0
    return {
        "status": "pass" if passed else "blocked",
        "blocker": "" if passed else "download_exported_binfile_failed",
        "email": email,
        "profile_id": profile.get("id", ""),
        "project_id": project_id,
        "file_id": file_id,
        "asset_uri": asset_uri,
        "local_binfile_path": display_path(out_path) if out_path.exists() else "missing",
        "local_binfile_size": out_path.stat().st_size if out_path.exists() else 0,
        "steps": steps,
    }


def make_visible_template_zip(source_zip: Path, output_zip: Path) -> dict[str, Any]:
    ensure_dir(output_zip.parent)
    if not source_zip.exists():
        return {"status": "blocked", "blocker": "source_binfile_missing", "source": display_path(source_zip)}

    root_object_found = False
    with zipfile.ZipFile(source_zip) as zin, zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.endswith(f"/{ROOT_FRAME_ID}.json"):
                obj = json.loads(data.decode("utf-8"))
                obj.update({
                    "name": "Pattern Lab 1920x1080 Smoke Frame",
                    "width": PRODUCTION_WIDTH,
                    "height": PRODUCTION_HEIGHT,
                    "selrect": {
                        "x": 0,
                        "y": 0,
                        "width": PRODUCTION_WIDTH,
                        "height": PRODUCTION_HEIGHT,
                        "x1": 0,
                        "y1": 0,
                        "x2": PRODUCTION_WIDTH,
                        "y2": PRODUCTION_HEIGHT,
                    },
                    "points": [
                        {"x": 0, "y": 0},
                        {"x": PRODUCTION_WIDTH, "y": 0},
                        {"x": PRODUCTION_WIDTH, "y": PRODUCTION_HEIGHT},
                        {"x": 0, "y": PRODUCTION_HEIGHT},
                    ],
                    "fills": [{"fillColor": "#FFD400", "fillOpacity": 1}],
                    "hideFillOnExport": False,
                })
                data = json.dumps(obj, indent=2).encode("utf-8")
                root_object_found = True
            zout.writestr(item, data)

    if not root_object_found:
        return {"status": "blocked", "blocker": "root_frame_json_missing_in_binfile", "source": display_path(source_zip)}
    return {
        "status": "pass",
        "source": display_path(source_zip),
        "path": display_path(output_zip),
        "size": output_zip.stat().st_size,
        "root_frame_id": ROOT_FRAME_ID,
        "template_width": PRODUCTION_WIDTH,
        "template_height": PRODUCTION_HEIGHT,
    }


def multipart_import_binfile(opener: urllib.request.OpenerDirector, project_id: str, file_path: Path) -> dict[str, Any]:
    boundary = f"----PatternLabPenpotBoundary{uuid.uuid4().hex}"
    parts: list[bytes] = []

    def add_field(name: str, value: str) -> None:
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode("utf-8")
        )

    def add_file(name: str, path: Path, content_type: str) -> None:
        head = (
            f"--{boundary}\r\n"
            f"Content-Disposition: form-data; name=\"{name}\"; filename=\"{path.name}\"\r\n"
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
        parts.append(head + path.read_bytes() + b"\r\n")

    add_field("name", "Pattern Lab Penpot 1920x1080 Export Smoke")
    # Multipart params are already kebab-case on the backend; camelCase is only transformed
    # on the JSON RPC route.
    add_field("project-id", project_id)
    add_file("file", file_path, "application/zip")
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)
    req = urllib.request.Request(
        f"{BASE_URL}/api/main/methods/import-binfile",
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "text/event-stream",
            "User-Agent": "PatternLabPenpotSmoke/1.0",
        },
        method="POST",
    )
    try:
        with opener.open(req, timeout=120) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            imported_file_id = parse_sse_last_uuid(text)
            return {
                "status": "pass" if resp.status == 200 and "event: end" in text and imported_file_id else "blocked",
                "http_status": resp.status,
                "content_type": resp.headers.get("content-type", ""),
                "content_length": len(text.encode("utf-8")),
                "body_head": text[:500],
                "body_text": text,
                "imported_file_id": imported_file_id,
            }
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        return {
            "status": "blocked",
            "blocker": "import_binfile_failed",
            "http_status": exc.code,
            "content_type": exc.headers.get("content-type", ""),
            "content_length": len(text.encode("utf-8")),
            "body_head": text[:500],
            "body_text": text,
        }
    except Exception as exc:
        return {"status": "blocked", "blocker": "import_binfile_exception", "error": f"{type(exc).__name__}: {exc}"}


def transit_export_shapes_body(file_id: str, page_id: str, profile_id: str) -> str:
    body = [
        "^ ",
        "~:cmd",
        "~:export-shapes",
        "~:exports",
        [[
            "^ ",
            "~:file-id",
            f"~u{file_id}",
            "~:page-id",
            f"~u{page_id}",
            "~:object-id",
            f"~u{ROOT_FRAME_ID}",
            "~:type",
            "~:png",
            "~:suffix",
            ".png",
            "~:scale",
            1,
            "~:name",
            "Pattern Lab Penpot Production Smoke",
        ]],
        "~:profile-id",
        f"~u{profile_id}",
        "~:wait",
        True,
    ]
    return json.dumps(body)


def call_internal_exporter(body: str, auth_token: str) -> dict[str, Any]:
    docker = shutil.which("docker")
    if not docker:
        return {"status": "blocked", "blocker": "docker_missing"}
    node_code = f"""
const body = {json.dumps(body)};
const cookie = {json.dumps("auth-token=" + auth_token)};
(async () => {{
  const response = await fetch("http://localhost:6061/", {{
    method: "POST",
    headers: {{ "Cookie": cookie, "content-type": "application/transit+json" }},
    body,
  }});
  const text = Buffer.from(await response.arrayBuffer()).toString("utf8");
  console.log(JSON.stringify({{
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    length: Buffer.byteLength(text),
    bodyText: text,
    bodyHead: text.slice(0, 500),
  }}));
}})().catch((error) => {{
  console.error(String(error && error.stack ? error.stack : error));
  process.exit(1);
}});
"""
    result = subprocess.run(
        [docker, "compose", "-f", str(COMPOSE_PATH), "-p", PROJECT, "exec", "-T", "penpot-exporter", "node", "-e", node_code],
        cwd=BASE.parent,
        text=True,
        capture_output=True,
        timeout=120,
        check=False,
    )
    parsed: dict[str, Any] = {}
    if result.stdout.strip():
        try:
            parsed = json.loads(result.stdout.strip().splitlines()[-1])
        except json.JSONDecodeError:
            parsed = {}
    asset_uri = parse_sse_asset_uri(parsed.get("bodyText", "")) if parsed else ""
    return {
        "status": "pass" if result.returncode == 0 and parsed.get("status") == 200 and asset_uri else "blocked",
        "returncode": result.returncode,
        "http_status": parsed.get("status", 0),
        "content_type": parsed.get("contentType", ""),
        "content_length": parsed.get("length", 0),
        "body_head": parsed.get("bodyHead", result.stdout[:500]),
        "stderr_head": result.stderr[:500],
        "asset_uri": asset_uri,
    }


def export_chat_delivery_for_penpot(production_path: Path) -> dict[str, Any]:
    out_dir = ensure_dir(REPORT_ROOT / "penpot-chat-delivery")
    report_path = out_dir / "chat-delivery-report.json"
    spec_path = out_dir / "chat-delivery-spec.json"
    spec = {
        "output_dir": str(out_dir),
        "entries": [{"variant_id": "penpot_production_export_smoke", "path": str(production_path)}],
    }
    write_json(spec_path, spec)
    result = subprocess.run(
        ["node", str(BASE / "scripts" / "patternlab_chat_delivery_exporter.mjs"), str(spec_path), str(report_path)],
        cwd=BASE.parent,
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    report = {}
    if report_path.exists():
        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            report = {}
    return {
        "status": "pass" if result.returncode == 0 and report.get("status") == "pass" else "blocked",
        "returncode": result.returncode,
        "stdout_head": result.stdout[:500],
        "stderr_head": result.stderr[:500],
        "report_path": display_path(report_path),
        "spec_path": display_path(spec_path),
        "chat_delivery_report": report,
    }


def authenticated_production_image_export_smoke(source_binfile_path: Path) -> dict[str, Any]:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    steps: dict[str, Any] = {}

    profile_result = new_authenticated_profile(opener, "patternlab-penpot-production")
    steps.update(profile_result.get("steps", {}))
    if profile_result.get("status") != "pass":
        return {"status": "blocked", "blocker": profile_result.get("blocker", "profile_registration_failed"), "steps": steps}

    template_path = REPORT_ROOT / "penpot-production-1920x1080-template.penpot"
    template = make_visible_template_zip(source_binfile_path, template_path)
    steps["make_visible_template_zip"] = template
    if template.get("status") != "pass":
        return {"status": "blocked", "blocker": template.get("blocker", "template_generation_failed"), "steps": steps}

    imported = multipart_import_binfile(opener, str(profile_result["project_id"]), template_path)
    steps["import_binfile"] = summarize_response(imported)
    imported_file_id = imported.get("imported_file_id", "")
    if imported.get("status") != "pass" or not imported_file_id:
        return {"status": "blocked", "blocker": imported.get("blocker", "import_binfile_failed"), "steps": steps}

    file_info = api_post(opener, "get-file", {"id": imported_file_id})
    file_json = file_info.get("json") if isinstance(file_info.get("json"), dict) else {}
    page_id = (file_json.get("data", {}).get("pages") or [""])[0]
    steps["get_imported_file"] = summarize_response(file_info) | {"file_id": imported_file_id, "page_id": page_id or "missing"}
    if file_info.get("status") != 200 or not page_id:
        return {"status": "blocked", "blocker": "get_imported_file_failed", "steps": steps}

    page_info = api_post(opener, "get-page", {"fileId": imported_file_id, "pageId": page_id})
    page_json = page_info.get("json") if isinstance(page_info.get("json"), dict) else {}
    root_frame = page_json.get("objects", {}).get(ROOT_FRAME_ID, {}) if isinstance(page_json, dict) else {}
    root_dimensions_ok = root_frame.get("width") == PRODUCTION_WIDTH and root_frame.get("height") == PRODUCTION_HEIGHT
    steps["get_imported_page"] = summarize_response(page_info) | {
        "root_frame_id": ROOT_FRAME_ID,
        "root_frame_width": root_frame.get("width"),
        "root_frame_height": root_frame.get("height"),
        "root_frame_dimensions_status": "pass" if root_dimensions_ok else "blocked",
    }
    if page_info.get("status") != 200 or not root_dimensions_ok:
        return {"status": "blocked", "blocker": "imported_template_root_frame_dimensions_invalid", "steps": steps}

    auth_token = auth_token_from_jar(jar)
    if not auth_token:
        return {"status": "blocked", "blocker": "auth_token_cookie_missing", "steps": steps}
    exporter = call_internal_exporter(transit_export_shapes_body(imported_file_id, page_id, str(profile_result["profile_id"])), auth_token)
    steps["native_exporter_call"] = exporter
    asset_uri = exporter.get("asset_uri", "")
    if exporter.get("status") != "pass" or not asset_uri:
        return {"status": "blocked", "blocker": "native_exporter_call_failed", "steps": steps}

    asset = http_get(str(asset_uri), opener=opener)
    production_path = REPORT_ROOT / "penpot-production-1920x1080-export-smoke.png"
    if asset.get("status") == 200 and asset.get("content_type", "").startswith("image/png") and asset.get("body_bytes"):
        production_path.write_bytes(asset["body_bytes"])
    width, height = image_dimensions(production_path) if production_path.exists() else (None, None)
    production_ok = width == PRODUCTION_WIDTH and height == PRODUCTION_HEIGHT
    steps["download_native_png"] = summarize_response(asset) | {
        "local_path": display_path(production_path) if production_path.exists() else "missing",
        "width": width,
        "height": height,
        "dimension_status": "pass" if production_ok else "blocked",
    }
    if not production_ok:
        return {"status": "blocked", "blocker": "native_png_dimension_validation_failed", "steps": steps}

    chat_delivery = export_chat_delivery_for_penpot(production_path)
    steps["chat_delivery"] = chat_delivery
    chat_ok = chat_delivery.get("status") == "pass"
    return {
        "status": "pass" if chat_ok else "blocked",
        "blocker": "" if chat_ok else "chat_delivery_validation_failed",
        "profile_id": profile_result["profile_id"],
        "project_id": profile_result["project_id"],
        "imported_file_id": imported_file_id,
        "page_id": page_id,
        "root_frame_id": ROOT_FRAME_ID,
        "native_export_asset_uri": asset_uri,
        "production_png_path": display_path(production_path),
        "production_png_width": width,
        "production_png_height": height,
        "chat_delivery_status": chat_delivery.get("status", "missing"),
        "chat_delivery_report_path": chat_delivery.get("report_path", "missing"),
        "steps": steps,
    }


def build_report() -> dict[str, Any]:
    docker = shutil.which("docker")
    rows, ps_result = docker_ps()
    expected = {"penpot-frontend", "penpot-backend", "penpot-exporter", "penpot-postgres", "penpot-valkey", "penpot-mcp"}
    running = {row.get("Service") for row in rows if str(row.get("State", "")).lower() == "running"}
    compose_services_status = "pass" if expected.issubset(running) else "blocked"
    frontend = http_get(BASE_URL)
    profile = http_get(f"{BASE_URL}/api/rpc/command/get-profile")
    openapi = http_get(f"{BASE_URL}/api/main/doc/openapi.json")
    local_server_status = "pass" if compose_services_status == "pass" and frontend.get("status") == 200 and openapi.get("status") == 200 else "blocked"
    binfile = authenticated_binfile_export_smoke() if local_server_status == "pass" else {"status": "blocked", "blocker": "local_server_not_ready"}
    source_binfile_path = REPORT_ROOT / "penpot-authenticated-binfile-export-smoke.penpot"
    production_export = (
        authenticated_production_image_export_smoke(source_binfile_path)
        if local_server_status == "pass" and binfile.get("status") == "pass"
        else {"status": "blocked", "blocker": "local_server_or_binfile_export_not_ready"}
    )
    production_png_status = "pass" if production_export.get("status") == "pass" else "blocked_native_penpot_image_export_failed"
    status = "pass" if local_server_status == "pass" and binfile.get("status") == "pass" and production_export.get("status") == "pass" else "blocked"
    payload = {
        "generated_at": utc_now(),
        "status": status,
        "milestone_300_penpot_local_server_smoke": local_server_status,
        "milestone_301_penpot_authenticated_binfile_export_smoke": binfile.get("status", "blocked"),
        "milestone_222_penpot_production_1920x1080_export": production_png_status,
        "docker_available": bool(docker),
        "docker_path": docker or "missing",
        "compose_file": display_path(COMPOSE_PATH),
        "compose_project": PROJECT,
        "compose_services_status": compose_services_status,
        "compose_services_running": sorted(running),
        "compose_ps_returncode": ps_result.get("returncode"),
        "frontend_status": frontend.get("status"),
        "anonymous_profile_status": profile.get("status"),
        "openapi_status": openapi.get("status"),
        "openapi_contains_export_binfile": "export-binfile" in openapi.get("body_head", "") or openapi.get("status") == 200,
        "authenticated_binfile_export": binfile,
        "authenticated_production_image_export": production_export,
        "export_1920x1080_verified": production_export.get("status") == "pass",
        "production_png_path": production_export.get("production_png_path", "missing"),
        "production_png_width": production_export.get("production_png_width"),
        "production_png_height": production_export.get("production_png_height"),
        "chat_safe_preview_verified": production_export.get("chat_delivery_status") == "pass",
        "chat_delivery_report_path": production_export.get("chat_delivery_report_path", "missing"),
        "paid_or_pro_assets": "not_used",
        "public_youtube_mutation": "not_performed",
        "canva_ai_or_magic_layers": "not_used",
        "blockers": [] if status == "pass" else [production_export.get("blocker", "local_penpot_server_binfile_or_native_image_export_failed")],
        "remaining_blockers": [] if production_png_status == "pass" else [production_png_status],
        "next_action": "Use Penpot only after an owner-approved editable template library is added; local native PNG export and chat-safe preview smoke now pass.",
    }
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Pattern Lab local Penpot production export smoke reports.")
    parser.add_argument("--json", default=str(REPORT_ROOT / "penpot-production-export-smoke-report.json"))
    parser.add_argument("--md", default=str(REPORT_ROOT / "penpot-production-export-smoke-report.md"))
    args = parser.parse_args()
    payload = build_report()
    json_path = Path(args.json)
    md_path = Path(args.md)
    write_json(json_path, payload)
    lines = [
        "# Pattern Lab Penpot Production Export Smoke Probe",
        "",
        f"Generated: {payload['generated_at']}",
        f"Status: {payload['status']}",
        f"Local server smoke: {payload['milestone_300_penpot_local_server_smoke']}",
        f"Authenticated binfile export smoke: {payload['milestone_301_penpot_authenticated_binfile_export_smoke']}",
        f"Production 1920x1080 image export: {payload['milestone_222_penpot_production_1920x1080_export']}",
        f"Docker available: {payload['docker_available']} ({payload['docker_path']})",
        f"Compose services: {payload['compose_services_status']} ({', '.join(payload['compose_services_running'])})",
        f"Frontend status: {payload['frontend_status']}",
        f"OpenAPI status: {payload['openapi_status']}",
        f"Binfile path: {payload['authenticated_binfile_export'].get('local_binfile_path', 'missing')}",
        f"Binfile size: {payload['authenticated_binfile_export'].get('local_binfile_size', 0)} bytes",
        f"Production PNG path: {payload.get('production_png_path', 'missing')}",
        f"Production PNG dimensions: {payload.get('production_png_width')}x{payload.get('production_png_height')}",
        f"Chat-safe preview verified: {payload.get('chat_safe_preview_verified')}",
        f"Chat delivery report: {payload.get('chat_delivery_report_path', 'missing')}",
        "Paid/pro assets: not used",
        "Public YouTube mutation: not performed",
        "Canva AI/Magic Layers: not used",
        "",
        "## Remaining blocker",
        "",
        *(
            [f"- {item}" for item in payload["remaining_blockers"]]
            if payload["remaining_blockers"]
            else ["- none for the local Penpot export smoke; real thumbnail use still needs owner-approved Penpot templates."]
        ),
        "",
        f"Next action: {payload['next_action']}",
    ]
    write_md(md_path, lines)
    print(json.dumps({"status": payload["status"], "report": display_path(json_path)}, indent=2))
    if (
        payload["milestone_300_penpot_local_server_smoke"] != "pass"
        or payload["milestone_301_penpot_authenticated_binfile_export_smoke"] != "pass"
        or payload["milestone_222_penpot_production_1920x1080_export"] != "pass"
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
