import json
from os import getenv
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import HTTPException, status


DEFAULT_BUCKET = "task-attachments"


def _storage_config():
    url = (getenv("SUPABASE_URL") or "").strip().rstrip("/")
    key = (getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    bucket = (getenv("SUPABASE_STORAGE_BUCKET") or DEFAULT_BUCKET).strip()
    if not url or not key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase Storage is not configured",
        )
    return url, key, bucket


def _headers(key: str, content_type: str | None = None):
    headers = {
        "apikey": key,
        "User-Agent": "TeamTaskManagerBackend/1.0",
    }
    if key.startswith("sb_secret_"):
        headers["Authorization"] = key
    else:
        headers["Authorization"] = f"Bearer {key}"
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _error_detail(prefix: str, exc: HTTPError):
    body = exc.read().decode("utf-8", errors="replace").strip()
    return f"{prefix} ({exc.code}): {body or exc.reason}"


def _object_url(base_url: str, bucket: str, object_path: str):
    encoded_bucket = quote(bucket, safe="")
    encoded_path = quote(object_path, safe="/")
    return f"{base_url}/storage/v1/object/{encoded_bucket}/{encoded_path}"


def check_storage():
    base_url, key, bucket = _storage_config()
    request = Request(
        f"{base_url}/storage/v1/bucket/{quote(bucket, safe='')}",
        headers=_headers(key),
        method="GET",
    )
    try:
        with urlopen(request, timeout=15) as response:
            response.read()
            return {"status": "ok", "bucket": bucket}
    except HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_error_detail("Supabase Storage check failed", exc)) from exc
    except URLError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Supabase Storage check failed: {exc.reason}") from exc


def upload_object(object_path: str, content: bytes, content_type: str | None):
    base_url, key, bucket = _storage_config()
    request = Request(
        _object_url(base_url, bucket, object_path),
        data=content,
        headers={**_headers(key, content_type or "application/octet-stream"), "x-upsert": "false"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            response.read()
    except HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_error_detail("Supabase upload failed", exc)) from exc
    except URLError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Supabase upload failed: {exc.reason}") from exc


def download_object(object_path: str):
    base_url, key, bucket = _storage_config()
    request = Request(_object_url(base_url, bucket, object_path), headers=_headers(key), method="GET")
    try:
        with urlopen(request, timeout=30) as response:
            return response.read(), response.headers.get("content-type")
    except HTTPError as exc:
        if exc.code == 404:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment file not found") from exc
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_error_detail("Supabase download failed", exc)) from exc
    except URLError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Supabase download failed: {exc.reason}") from exc


def delete_objects(object_paths: list[str]):
    if not object_paths:
        return
    base_url, key, bucket = _storage_config()
    request = Request(
        f"{base_url}/storage/v1/object/{quote(bucket, safe='')}",
        data=json.dumps({"prefixes": object_paths}).encode("utf-8"),
        headers=_headers(key, "application/json"),
        method="DELETE",
    )
    try:
        with urlopen(request, timeout=30) as response:
            response.read()
    except (HTTPError, URLError):
        # Best-effort rollback cleanup. The database transaction still remains the source of truth.
        return
