#!/usr/bin/env python3
"""Resumable, non-overwriting Supabase Storage migration from a verified ZIP."""

from __future__ import annotations

import argparse
import csv
import hashlib
import http.client
import io
import json
import mimetypes
import os
import random
import ssl
import threading
import time
import urllib.parse
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path


PROJECT_HOST = "qjcetldbguawmfijuxrq.supabase.co"
EXPECTED_OBJECTS = 73_694
EXPECTED_BYTES = 155_951_499


@dataclass(frozen=True)
class ObjectSpec:
    bucket: str
    path: str
    size: int
    sha256: str
    content_type: str

    @property
    def archive_name(self) -> str:
        return f"files/{self.bucket}/{self.path}"

    @property
    def key(self) -> str:
        return f"{self.bucket}/{self.path}"


class Migration:
    def __init__(self, zip_path: Path, source_manifest: Path, secret_path: Path, state_dir: Path, workers: int):
        self.zip_path = zip_path
        self.source_manifest = source_manifest
        self.secret = secret_path.read_text(encoding="utf-8").strip()
        if not self.secret.startswith("sb_secret_"):
            raise RuntimeError("Invalid Supabase secret key file")
        self.state_dir = state_dir
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.checkpoint_path = state_dir / "checkpoint.jsonl"
        self.verify_checkpoint_path = state_dir / "verify-checkpoint.jsonl"
        self.workers = workers
        self.lock = threading.Lock()
        self.local = threading.local()
        self.specs = self._load_specs()
        self.done = self._load_checkpoint()
        self.verified = self._load_verify_checkpoint()

    def _load_specs(self) -> list[ObjectSpec]:
        with zipfile.ZipFile(self.zip_path) as archive:
            manifest = list(csv.DictReader(io.TextIOWrapper(archive.open("manifest.csv"), "utf-8-sig", newline="")))
            archive_names = {item.filename for item in archive.infolist() if not item.is_dir()}

        mime_by_key: dict[str, str] = {}
        with self.source_manifest.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                mime_by_key[f"{row['bucket_id']}/{row['name']}"] = row.get("mimetype") or ""

        specs = []
        for row in manifest:
            key = f"{row['bucket']}/{row['path']}"
            content_type = mime_by_key.get(key) or mimetypes.guess_type(row["path"])[0] or "application/octet-stream"
            spec = ObjectSpec(row["bucket"], row["path"], int(row["size_bytes"]), row["sha256"].lower(), content_type)
            if spec.archive_name not in archive_names:
                raise RuntimeError(f"ZIP entry missing: {spec.archive_name}")
            specs.append(spec)

        if len(specs) != EXPECTED_OBJECTS or sum(item.size for item in specs) != EXPECTED_BYTES:
            raise RuntimeError("Export totals do not match the approved migration gate")
        if len({item.key for item in specs}) != len(specs):
            raise RuntimeError("Duplicate bucket/path in export manifest")
        return specs

    def _load_checkpoint(self) -> set[str]:
        done: set[str] = set()
        if not self.checkpoint_path.exists():
            return done
        with self.checkpoint_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("status") == "uploaded":
                    done.add(row["key"])
        return done

    def _load_verify_checkpoint(self) -> set[str]:
        verified: set[str] = set()
        if not self.verify_checkpoint_path.exists():
            return verified
        with self.verify_checkpoint_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("status") == "verified":
                    verified.add(row["key"])
        return verified

    def _connection(self) -> http.client.HTTPSConnection:
        conn = getattr(self.local, "connection", None)
        if conn is None:
            conn = http.client.HTTPSConnection(PROJECT_HOST, timeout=90, context=ssl.create_default_context())
            self.local.connection = conn
        return conn

    def _reset_connection(self) -> None:
        conn = getattr(self.local, "connection", None)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        self.local.connection = None

    def _request(self, method: str, path: str, body: bytes, content_type: str) -> tuple[int, bytes]:
        headers = {
            "Authorization": f"Bearer {self.secret}",
            "apikey": self.secret,
            "Content-Type": content_type,
            "Content-Length": str(len(body)),
        }
        if method == "POST" and path.startswith("/storage/v1/object/"):
            headers["x-upsert"] = "false"
        conn = self._connection()
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        payload = response.read()
        return response.status, payload

    def ensure_buckets(self) -> None:
        for bucket in ("asp-validator-uploads", "highlightly-raw"):
            body = json.dumps({"id": bucket, "name": bucket, "public": False}).encode()
            for attempt in range(5):
                try:
                    status, payload = self._request("POST", "/storage/v1/bucket", body, "application/json")
                    if status in (200, 201):
                        print(f"bucket_created={bucket}")
                        break
                    text = payload.decode("utf-8", errors="replace")
                    if status in (400, 409) and "exist" in text.lower():
                        print(f"bucket_exists={bucket}")
                        break
                    raise RuntimeError(f"bucket status={status}: {text[:200]}")
                except Exception:
                    self._reset_connection()
                    if attempt == 4:
                        raise
                    time.sleep(2**attempt)

    def _zip(self) -> zipfile.ZipFile:
        archive = getattr(self.local, "archive", None)
        if archive is None:
            archive = zipfile.ZipFile(self.zip_path)
            self.local.archive = archive
        return archive

    def _record(self, spec: ObjectSpec, status: str) -> None:
        row = json.dumps({"key": spec.key, "size": spec.size, "sha256": spec.sha256, "status": status}, ensure_ascii=False)
        with self.lock:
            with self.checkpoint_path.open("a", encoding="utf-8", newline="\n") as handle:
                handle.write(row + "\n")
                handle.flush()
            if status == "uploaded":
                self.done.add(spec.key)

    def _record_verified(self, spec: ObjectSpec) -> None:
        row = json.dumps({"key": spec.key, "size": spec.size, "sha256": spec.sha256, "status": "verified"}, ensure_ascii=False)
        with self.lock:
            with self.verify_checkpoint_path.open("a", encoding="utf-8", newline="\n") as handle:
                handle.write(row + "\n")
                handle.flush()
            self.verified.add(spec.key)

    def upload_one(self, spec: ObjectSpec) -> tuple[str, str]:
        if spec.key in self.done:
            return spec.key, "skipped"
        data = self._zip().read(spec.archive_name)
        if len(data) != spec.size or hashlib.sha256(data).hexdigest() != spec.sha256:
            raise RuntimeError(f"Local integrity failure: {spec.key}")
        endpoint = "/storage/v1/object/" + urllib.parse.quote(spec.bucket, safe="") + "/" + urllib.parse.quote(spec.path, safe="/")
        last_error = ""
        for attempt in range(6):
            try:
                status, payload = self._request("POST", endpoint, data, spec.content_type)
                if status in (200, 201):
                    self._record(spec, "uploaded")
                    return spec.key, "uploaded"
                last_error = f"HTTP {status}: {payload[:160]!r}"
                if status not in (408, 425, 429, 500, 502, 503, 504):
                    break
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
            self._reset_connection()
            time.sleep(min(30, (2**attempt) + random.random()))
        return spec.key, "failed:" + last_error

    def canary(self) -> None:
        selected = []
        for bucket in ("asp-validator-uploads", "highlightly-raw"):
            selected.append(next(item for item in self.specs if item.bucket == bucket))
        for spec in selected:
            key, status = self.upload_one(spec)
            print(f"canary={status}|{key}")
            if status.startswith("failed"):
                raise RuntimeError(status)

    def run(self) -> None:
        pending = [item for item in self.specs if item.key not in self.done]
        print(f"total={len(self.specs)} done={len(self.done)} pending={len(pending)} workers={self.workers}")
        uploaded = failed = 0
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            futures = {pool.submit(self.upload_one, item): item for item in pending}
            for index, future in enumerate(as_completed(futures), 1):
                key, status = future.result()
                if status == "uploaded":
                    uploaded += 1
                elif status.startswith("failed"):
                    failed += 1
                    print(f"FAIL|{key}|{status}")
                if index % 1000 == 0 or index == len(pending):
                    print(f"progress={index}/{len(pending)} uploaded={uploaded} failed={failed}", flush=True)
        print(f"complete uploaded_now={uploaded} failed={failed} checkpoint_done={len(self.done)}")
        if failed:
            raise SystemExit(2)

    def verify_one(self, spec: ObjectSpec) -> tuple[str, str]:
        if spec.key in self.verified:
            return spec.key, "skipped"
        endpoint = "/storage/v1/object/" + urllib.parse.quote(spec.bucket, safe="") + "/" + urllib.parse.quote(spec.path, safe="/")
        last_error = ""
        for attempt in range(6):
            try:
                status, payload = self._request("GET", endpoint, b"", "application/octet-stream")
                if status == 200:
                    if len(payload) != spec.size:
                        last_error = f"size expected={spec.size} actual={len(payload)}"
                        break
                    digest = hashlib.sha256(payload).hexdigest()
                    if digest != spec.sha256:
                        last_error = f"sha256 expected={spec.sha256} actual={digest}"
                        break
                    self._record_verified(spec)
                    return spec.key, "verified"
                last_error = f"HTTP {status}: {payload[:160]!r}"
                if status not in (408, 425, 429, 500, 502, 503, 504):
                    break
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
            self._reset_connection()
            time.sleep(min(30, (2**attempt) + random.random()))
        return spec.key, "failed:" + last_error

    def verify(self) -> None:
        pending = [item for item in self.specs if item.key not in self.verified]
        print(f"verify_total={len(self.specs)} verified={len(self.verified)} pending={len(pending)} workers={self.workers}")
        verified_now = failed = 0
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            futures = {pool.submit(self.verify_one, item): item for item in pending}
            for index, future in enumerate(as_completed(futures), 1):
                key, status = future.result()
                if status == "verified":
                    verified_now += 1
                elif status.startswith("failed"):
                    failed += 1
                    print(f"VERIFY_FAIL|{key}|{status}")
                if index % 1000 == 0 or index == len(pending):
                    print(f"verify_progress={index}/{len(pending)} verified={verified_now} failed={failed}", flush=True)
        print(f"verify_complete verified_now={verified_now} failed={failed} checkpoint_verified={len(self.verified)}")
        if failed:
            raise SystemExit(3)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("ensure-buckets", "canary", "run", "verify"))
    parser.add_argument("--zip", required=True, type=Path)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--secret-file", required=True, type=Path)
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args()
    migration = Migration(args.zip, args.source_manifest, args.secret_file, args.state_dir, args.workers)
    if args.action == "ensure-buckets":
        migration.ensure_buckets()
    elif args.action == "canary":
        migration.canary()
    elif args.action == "run":
        migration.run()
    else:
        migration.verify()


if __name__ == "__main__":
    main()
