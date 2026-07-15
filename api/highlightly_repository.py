"""Supabase persistence for the Highlightly ingestion foundation.

This module is intentionally independent from FastAPI. A worker can use the same
repository to ingest from Highlightly or to replay a saved raw payload without
making another provider request.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import gzip
import hashlib
import json
import re
from typing import Any, Mapping, Sequence
from urllib.parse import quote, urlencode
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:  # requests is installed on the VM; the fallback keeps local tools dependency-free.
    import requests
except ModuleNotFoundError:  # pragma: no cover - exercised by the bundled test runtime
    requests = None  # type: ignore[assignment]


RAW_BUCKET = "highlightly-raw"
RAW_BUCKET_FILE_SIZE_LIMIT = 26_214_400
RAW_BUCKET_MIME_TYPES = ("application/json", "application/gzip", "application/x-gzip")
_SECRET_KEYS = re.compile(r"(api[-_]?key|authorization|token|secret|password)", re.IGNORECASE)
_PATH_TOKEN = re.compile(r"[^a-zA-Z0-9._-]+")


class HighlightlyRepositoryError(RuntimeError):
    """Raised when Supabase rejects an ingestion persistence operation."""

    def __init__(self, message: str, *, status: int | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


@dataclass(frozen=True)
class StoredRawObject:
    id: str
    storage_bucket: str
    storage_path: str
    sha256: str
    byte_size: int


class _UrllibResponse:
    def __init__(self, status_code: int, content: bytes):
        self.status_code = status_code
        self.content = content
        self.text = content.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.text)


class _UrllibSession:
    """Subset of requests.Session used when requests is unavailable."""

    def request(self, method: str, url: str, **kwargs: Any) -> _UrllibResponse:
        body = kwargs.get("data")
        json_body = kwargs.get("json")
        headers = dict(kwargs.get("headers") or {})
        if json_body is not None:
            body = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
            headers.setdefault("content-type", "application/json")
        request = Request(url, data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=kwargs.get("timeout")) as response:
                return _UrllibResponse(response.status, response.read())
        except HTTPError as exc:
            return _UrllibResponse(exc.code, exc.read())
        except URLError as exc:
            raise OSError(exc.reason) from exc


def redact_secrets(value: Any) -> Any:
    """Return a JSON-compatible copy with credential-like keys removed."""

    if isinstance(value, Mapping):
        return {
            str(key): "[REDACTED]" if _SECRET_KEYS.search(str(key)) else redact_secrets(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_secrets(item) for item in value]
    if isinstance(value, tuple):
        return [redact_secrets(item) for item in value]
    return value


def _path_token(value: str) -> str:
    token = _PATH_TOKEN.sub("-", value.strip()).strip("-.")
    return token[:100] or "unknown"


class HighlightlyRepository:
    """Small service-role Supabase client for jobs, runs and raw objects."""

    def __init__(
        self,
        supabase_url: str,
        service_role_key: str,
        *,
        timeout: float = 30.0,
        session: Any = None,
    ):
        if not supabase_url.strip():
            raise ValueError("Supabase URL must not be empty")
        if not service_role_key.strip():
            raise ValueError("Supabase service role key must not be empty")
        self.supabase_url = supabase_url.rstrip("/")
        self.service_role_key = service_role_key.strip()
        self.timeout = timeout
        self.session = session or (requests.Session() if requests is not None else _UrllibSession())

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        data: bytes | None = None,
        headers: Mapping[str, str] | None = None,
        expected: Sequence[int] = (200,),
    ) -> Any:
        request_headers = {
            "apikey": self.service_role_key,
            "authorization": f"Bearer {self.service_role_key}",
        }
        request_headers.update(headers or {})
        try:
            response = self.session.request(
                method,
                f"{self.supabase_url}{path}",
                json=json_body,
                data=data,
                headers=request_headers,
                timeout=self.timeout,
            )
        except Exception as exc:
            raise HighlightlyRepositoryError(f"Could not reach Supabase: {exc}") from exc

        body: Any = None
        if response.content:
            try:
                body = response.json()
            except ValueError:
                body = response.text
        if response.status_code not in expected:
            raise HighlightlyRepositoryError(
                f"Supabase returned HTTP {response.status_code}",
                status=response.status_code,
                body=body,
            )
        return body

    def rpc(self, function_name: str, payload: Mapping[str, Any]) -> Any:
        return self._request(
            "POST",
            f"/rest/v1/rpc/{quote(function_name, safe='')}",
            json_body=dict(payload),
            headers={"content-type": "application/json"},
            expected=(200,),
        )

    def select_rows(
        self,
        table: str,
        *,
        columns: str = "*",
        filters: Mapping[str, Any] | None = None,
        limit: int | None = None,
        order: str | None = None,
    ) -> list[dict[str, Any]]:
        """Read service-role rows using the small PostgREST subset needed by workers."""

        query: list[tuple[str, str]] = [("select", columns)]
        for key, value in (filters or {}).items():
            if isinstance(value, bool):
                encoded = "true" if value else "false"
            else:
                encoded = str(value)
            query.append((key, f"eq.{encoded}"))
        if limit is not None:
            query.append(("limit", str(limit)))
        if order:
            query.append(("order", order))
        result = self._request(
            "GET",
            f"/rest/v1/{quote(table, safe='')}?{urlencode(query)}",
            expected=(200,),
        )
        return [dict(row) for row in (result or [])]

    def upsert_rows(
        self,
        table: str,
        rows: Sequence[Mapping[str, Any]],
        *,
        on_conflict: str,
        chunk_size: int = 500,
    ) -> list[dict[str, Any]]:
        """Idempotently persist bounded batches and return their canonical rows."""

        if chunk_size < 1 or chunk_size > 1000:
            raise ValueError("chunk_size must be between 1 and 1000")
        saved: list[dict[str, Any]] = []
        for start in range(0, len(rows), chunk_size):
            chunk = [dict(row) for row in rows[start : start + chunk_size]]
            query = urlencode({"on_conflict": on_conflict})
            result = self._request(
                "POST",
                f"/rest/v1/{quote(table, safe='')}?{query}",
                json_body=chunk,
                headers={
                    "content-type": "application/json",
                    "prefer": "resolution=merge-duplicates,return=representation",
                },
                expected=(200, 201),
            )
            saved.extend(dict(row) for row in (result or []))
        return saved

    def patch_rows(
        self,
        table: str,
        values: Mapping[str, Any],
        *,
        filters: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        query = urlencode([(key, f"eq.{value}") for key, value in filters.items()])
        result = self._request(
            "PATCH",
            f"/rest/v1/{quote(table, safe='')}?{query}",
            json_body=dict(values),
            headers={"content-type": "application/json", "prefer": "return=representation"},
            expected=(200,),
        )
        return [dict(row) for row in (result or [])]

    def ingestion_context(self, sport: str) -> dict[str, Any]:
        providers = self.select_rows(
            "sports_providers",
            columns="id,code,contract_version,enabled",
            filters={"code": "highlightly"},
            limit=1,
        )
        sports = self.select_rows(
            "sports",
            columns="id,code,enabled",
            filters={"code": sport},
            limit=1,
        )
        if not providers or not sports:
            raise HighlightlyRepositoryError(f"Missing Highlightly provider or sport seed for {sport}")
        bookmakers = self.select_rows(
            "sports_bookmakers",
            columns="id,name,normalized_name,is_preferred,is_active",
            filters={"is_active": True},
        )
        return {
            "provider": providers[0],
            "sport": sports[0],
            "bookmakers": bookmakers,
        }

    def daily_request_usage(self, provider_id: str, request_date: str) -> int:
        rows = self.select_rows(
            "hl_rate_limit_usage",
            columns="requests_used",
            filters={"provider_id": provider_id, "request_date": request_date},
        )
        return sum(int(row.get("requests_used") or 0) for row in rows)

    def set_provider_enabled(self, provider_code: str, enabled: bool) -> dict[str, Any]:
        rows = self.patch_rows(
            "sports_providers",
            {"enabled": bool(enabled)},
            filters={"code": provider_code},
        )
        if len(rows) != 1 or bool(rows[0].get("enabled")) is not bool(enabled):
            raise HighlightlyRepositoryError(
                f"Could not set provider {provider_code} enabled={enabled}"
            )
        return rows[0]

    def upsert_odds_quote(self, quote_row: Mapping[str, Any]) -> dict[str, Any]:
        result = self.rpc("upsert_sports_odds_quote", quote_row)
        if isinstance(result, list):
            return dict(result[0]) if result else {}
        return dict(result or {})

    def upsert_odds_quotes(
        self,
        quote_rows: Sequence[Mapping[str, Any]],
        *,
        chunk_size: int = 500,
    ) -> list[dict[str, Any]]:
        if chunk_size < 1 or chunk_size > 1000:
            raise ValueError("chunk_size must be between 1 and 1000")
        saved: list[dict[str, Any]] = []
        for start in range(0, len(quote_rows), chunk_size):
            result = self.rpc(
                "upsert_sports_odds_quotes",
                {"p_quotes": [dict(row) for row in quote_rows[start : start + chunk_size]]},
            )
            saved.extend(dict(row) for row in (result or []))
        return saved

    def refresh_odds_consensus(
        self,
        match_id: str,
        *,
        snapshot_at: str | None = None,
        min_bookmakers: int = 5,
        max_bookmakers: int = 7,
    ) -> int:
        result = self.rpc(
            "refresh_sports_odds_consensus",
            {
                "p_match_id": match_id,
                "p_snapshot_at": snapshot_at or datetime.now(timezone.utc).isoformat(),
                "p_min_bookmakers": min_bookmakers,
                "p_max_bookmakers": max_bookmakers,
            },
        )
        return int(result or 0)

    def record_quality_issues(self, rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []
        return self.upsert_rows("hl_data_quality_issues", rows, on_conflict="id")

    def mark_raw_normalized(self, raw_object_id: str, *, schema_fingerprint: str) -> None:
        self.patch_rows(
            "hl_raw_objects",
            {
                "schema_fingerprint": schema_fingerprint,
                "normalized_at": datetime.now(timezone.utc).isoformat(),
            },
            filters={"id": raw_object_id},
        )

    def ensure_raw_bucket(self) -> dict[str, Any]:
        """Create or reconcile the private raw bucket through the Storage API.

        Lovable Cloud does not allow migrations to write directly to
        ``storage.buckets``. Keeping this operation in the deployment client makes
        bucket provisioning repeatable without coupling it to database internals.
        """

        path = f"/storage/v1/bucket/{quote(RAW_BUCKET, safe='')}"
        try:
            current = self._request("GET", path, expected=(200,))
        except HighlightlyRepositoryError as exc:
            if exc.status != 404:
                raise
            created = self._request(
                "POST",
                "/storage/v1/bucket",
                json_body={
                    "id": RAW_BUCKET,
                    "name": RAW_BUCKET,
                    "public": False,
                    "file_size_limit": RAW_BUCKET_FILE_SIZE_LIMIT,
                    "allowed_mime_types": list(RAW_BUCKET_MIME_TYPES),
                },
                headers={"content-type": "application/json"},
                expected=(200, 201),
            )
            return {"created": True, "bucket": RAW_BUCKET, "response": created}

        expected_mime_types = set(RAW_BUCKET_MIME_TYPES)
        current_mime_types = set((current or {}).get("allowed_mime_types") or [])
        needs_update = (
            bool((current or {}).get("public"))
            or (current or {}).get("file_size_limit") != RAW_BUCKET_FILE_SIZE_LIMIT
            or current_mime_types != expected_mime_types
        )
        if needs_update:
            updated = self._request(
                "PUT",
                path,
                json_body={
                    "public": False,
                    "file_size_limit": RAW_BUCKET_FILE_SIZE_LIMIT,
                    "allowed_mime_types": list(RAW_BUCKET_MIME_TYPES),
                },
                headers={"content-type": "application/json"},
                expected=(200,),
            )
            return {"created": False, "updated": True, "bucket": RAW_BUCKET, "response": updated}

        return {"created": False, "updated": False, "bucket": RAW_BUCKET}

    def enqueue_job(
        self,
        *,
        endpoint_key: str,
        sport: str,
        resource: str,
        dedupe_key: str,
        request_params: Mapping[str, Any] | None = None,
        cursor_data: Mapping[str, Any] | None = None,
        priority: int = 2,
        scheduled_at: str | None = None,
        max_attempts: int = 5,
        reprocess_raw_object_id: str | None = None,
    ) -> dict[str, Any]:
        result = self.rpc(
            "enqueue_highlightly_ingestion_job",
            {
                "p_endpoint_key": endpoint_key,
                "p_sport": sport,
                "p_resource": resource,
                "p_dedupe_key": dedupe_key,
                "p_request_params": redact_secrets(request_params or {}),
                "p_cursor_data": cursor_data or {},
                "p_priority": priority,
                "p_scheduled_at": scheduled_at or datetime.now(timezone.utc).isoformat(),
                "p_max_attempts": max_attempts,
                "p_reprocess_raw_object_id": reprocess_raw_object_id,
            },
        )
        return dict(result)

    def claim_job(self, worker_id: str, *, lock_seconds: int = 900) -> dict[str, Any] | None:
        result = self.rpc(
            "claim_highlightly_ingestion_job",
            {"p_worker_id": worker_id, "p_lock_seconds": lock_seconds},
        )
        return dict(result[0]) if result else None

    def finish_job(
        self,
        job_id: str,
        worker_id: str,
        outcome: str,
        *,
        error: str | None = None,
        retry_delay_seconds: int = 300,
    ) -> dict[str, Any]:
        result = self.rpc(
            "finish_highlightly_ingestion_job",
            {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_outcome": outcome,
                "p_error": error,
                "p_retry_delay_seconds": retry_delay_seconds,
            },
        )
        return dict(result)

    def create_run(self, job_id: str, worker_id: str) -> dict[str, Any]:
        result = self._request(
            "POST",
            "/rest/v1/hl_ingestion_runs",
            json_body={"job_id": job_id, "worker_id": worker_id, "status": "running"},
            headers={"content-type": "application/json", "prefer": "return=representation"},
            expected=(201,),
        )
        return dict(result[0])

    def finish_run(self, run_id: str, values: Mapping[str, Any]) -> dict[str, Any]:
        allowed = {
            "status",
            "http_status",
            "records_received",
            "records_normalized",
            "records_rejected",
            "duration_ms",
            "rate_limit",
            "rate_remaining",
            "error_code",
            "error_message",
            "finished_at",
        }
        update = {key: value for key, value in values.items() if key in allowed}
        update.setdefault("finished_at", datetime.now(timezone.utc).isoformat())
        query = urlencode({"id": f"eq.{run_id}"})
        result = self._request(
            "PATCH",
            f"/rest/v1/hl_ingestion_runs?{query}",
            json_body=update,
            headers={"content-type": "application/json", "prefer": "return=representation"},
            expected=(200,),
        )
        if not result:
            raise HighlightlyRepositoryError(f"Ingestion run {run_id} was not found")
        return dict(result[0])

    def store_raw_payload(
        self,
        payload: Any,
        *,
        provider_id: str,
        sport_id: str,
        sport: str,
        endpoint_key: str,
        job_id: str | None = None,
        run_id: str | None = None,
        request_metadata: Mapping[str, Any] | None = None,
        response_metadata: Mapping[str, Any] | None = None,
        retention_until: str | None = None,
        captured_at: datetime | None = None,
    ) -> StoredRawObject:
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
        digest = hashlib.sha256(raw).hexdigest()
        compressed = gzip.compress(raw, mtime=0)
        captured = captured_at or datetime.now(timezone.utc)
        storage_path = "/".join(
            (
                _path_token(sport),
                captured.strftime("%Y"),
                captured.strftime("%m"),
                captured.strftime("%d"),
                _path_token(endpoint_key),
                f"{digest}.json.gz",
            )
        )

        encoded_path = quote(storage_path, safe="/")
        self._request(
            "POST",
            f"/storage/v1/object/{RAW_BUCKET}/{encoded_path}",
            data=compressed,
            headers={"content-type": "application/gzip", "x-upsert": "true"},
            expected=(200,),
        )

        row = {
            "job_id": job_id,
            "run_id": run_id,
            "provider_id": provider_id,
            "sport_id": sport_id,
            "endpoint_key": endpoint_key,
            "storage_bucket": RAW_BUCKET,
            "storage_path": storage_path,
            "content_type": "application/json",
            "content_encoding": "gzip",
            "sha256": digest,
            "byte_size": len(compressed),
            "request_metadata": redact_secrets(request_metadata or {}),
            "response_metadata": redact_secrets(response_metadata or {}),
            "retention_until": retention_until,
        }
        query = urlencode({"on_conflict": "storage_bucket,storage_path"})
        result = self._request(
            "POST",
            f"/rest/v1/hl_raw_objects?{query}",
            json_body=row,
            headers={
                "content-type": "application/json",
                "prefer": "resolution=merge-duplicates,return=representation",
            },
            expected=(201,),
        )
        saved = result[0]
        return StoredRawObject(
            id=str(saved["id"]),
            storage_bucket=str(saved["storage_bucket"]),
            storage_path=str(saved["storage_path"]),
            sha256=str(saved["sha256"]),
            byte_size=int(saved["byte_size"]),
        )

    def load_raw_payload(self, raw_object: Mapping[str, Any]) -> Any:
        bucket = str(raw_object.get("storage_bucket") or RAW_BUCKET)
        path = str(raw_object["storage_path"])
        response = self.session.request(
            "GET",
            f"{self.supabase_url}/storage/v1/object/{quote(bucket, safe='')}/{quote(path, safe='/')}",
            headers={
                "apikey": self.service_role_key,
                "authorization": f"Bearer {self.service_role_key}",
            },
            timeout=self.timeout,
        )
        if response.status_code != 200:
            raise HighlightlyRepositoryError(
                f"Supabase returned HTTP {response.status_code} while loading raw payload",
                status=response.status_code,
            )
        raw = gzip.decompress(response.content) if raw_object.get("content_encoding") == "gzip" else response.content
        expected_sha = raw_object.get("sha256")
        actual_sha = hashlib.sha256(raw).hexdigest()
        if expected_sha and expected_sha != actual_sha:
            raise HighlightlyRepositoryError("Raw payload checksum does not match its registry record")
        return json.loads(raw.decode("utf-8"))

    def enqueue_reprocess(
        self,
        raw_object: Mapping[str, Any],
        *,
        normalizer_version: str,
        priority: int = 1,
    ) -> dict[str, Any]:
        raw_id = str(raw_object["id"])
        sport = str(raw_object["sport"])
        endpoint_key = str(raw_object["endpoint_key"])
        return self.enqueue_job(
            endpoint_key=endpoint_key,
            sport=sport,
            resource="raw_reprocess",
            dedupe_key=f"reprocess:{raw_id}:{normalizer_version}",
            request_params={"normalizer_version": normalizer_version},
            priority=priority,
            reprocess_raw_object_id=raw_id,
        )
